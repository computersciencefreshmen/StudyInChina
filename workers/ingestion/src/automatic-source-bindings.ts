import { sha256Hex, snapshotObjectKey } from './hash'
import { assertSafeSourceUrl, normalizeAllowedHost, validateManifest } from './security'
import type { IngestionEnv, SourceManifestV1 } from './types'

type Environment = Pick<IngestionEnv, 'INGESTION_DB' | 'SNAPSHOTS_BUCKET'>
type PendingSource = {
  source_id: string; manifest_json: string; institution_id: string
  official_url: string; admissions_url: string | null; publisher_name: string | null
  snapshot_id: string; r2_key: string; raw_sha256: string; canonical_sha256: string
  content_type: string; byte_length: number; final_url: string; fetched_at: string
}
const AUTOMATIC_ID = /^(?:auto-seed-[a-f0-9]{24}|auto-discovery-d[12]-[a-f0-9]{40})$/u
const CATEGORIES = new Set(['catalog_anchor', 'international_admissions_home', 'undergraduate_catalog', 'masters_catalog', 'doctoral_catalog', 'non_degree_catalog', 'current_guide', 'program_detail', 'university_scholarship', 'faculty_scholarship'])

/** Bind an observed official source to its registered owner; this grants no fact publication. */
export async function registerAutomaticSourceBindings(environment: Environment, now: string, maximum = 25) {
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid binding evaluation time')
  const limit = Math.max(1, Math.min(100, Math.floor(maximum) || 25))
  const pending = await environment.INGESTION_DB.prepare(`
    WITH latest AS (
      SELECT snapshot.*, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY fetched_at DESC, snapshot_id) AS snapshot_rank
      FROM ingestion_snapshots snapshot
    ), eligible AS (
      SELECT source.source_id, source.manifest_json,
        organization.record_id AS institution_id, organization.official_url, institution.admissions_url,
        (SELECT text_value FROM localized_content WHERE record_id = organization.record_id
          AND field_name = 'name' AND translation_status IN ('reviewed', 'published')
          ORDER BY CASE locale WHEN 'en' THEN 0 WHEN 'zh' THEN 1 ELSE 2 END, locale LIMIT 1) AS publisher_name,
        snapshot.snapshot_id, snapshot.r2_key, snapshot.raw_sha256, snapshot.canonical_sha256,
        snapshot.content_type, snapshot.byte_length, snapshot.final_url, snapshot.fetched_at,
        ROW_NUMBER() OVER (PARTITION BY organization.record_id ORDER BY RANDOM()) AS institution_rank
      FROM ingestion_sources source
      JOIN organizations organization ON organization.record_id = json_extract(source.manifest_json, '$.institutionId')
      JOIN institutions institution ON institution.record_id = organization.record_id
      JOIN records record ON record.id = organization.record_id
      JOIN latest snapshot ON snapshot.source_id = source.source_id AND snapshot.snapshot_rank = 1
      WHERE source.enabled = 1
        AND (source.source_id GLOB 'auto-seed-*' OR source.source_id GLOB 'auto-discovery-*')
        AND json_extract(source.manifest_json, '$.sourceCategory') NOT IN ('contacts', 'government_scholarship')
        AND record.kind = 'organization' AND record.workflow_status IN ('validated', 'applied', 'published', 'stale')
        AND NOT EXISTS (SELECT 1 FROM promotion_source_bindings binding WHERE binding.source_id = source.source_id)
    ) SELECT * FROM eligible ORDER BY institution_rank, RANDOM() LIMIT ?1
  `).bind(limit).all<PendingSource>()
  if (!pending.success) throw new Error('Could not list automatic source bindings')
  const result = { examined: 0, registered: 0, deferred: 0, reasons: {} as Record<string, number> }
  const defer = (reason: string) => { result.deferred += 1; result.reasons[reason] = (result.reasons[reason] ?? 0) + 1 }
  const failures: unknown[] = []
  for (const row of pending.results ?? []) {
    result.examined += 1
    let manifest: SourceManifestV1
    let url: URL
    let finalUrl: URL
    try {
      manifest = validateManifest(JSON.parse(row.manifest_json))
      if (!AUTOMATIC_ID.test(row.source_id) || manifest.id !== row.source_id || manifest.institutionId !== row.institution_id
        || !manifest.enabled || manifest.robots.mode !== 'enforce' || !CATEGORIES.has(manifest.sourceCategory)) throw new Error('source_policy')
      url = assertSafeSourceUrl(manifest.officialUrl, manifest.allowedHosts)
      finalUrl = assertSafeSourceUrl(row.final_url, [...manifest.allowedHosts, ...(manifest.allowedRedirectHosts ?? [])])
      url.hash = ''; finalUrl.hash = ''
      if (!Number.isInteger(row.byte_length) || row.byte_length < 1 || row.byte_length > 10 * 1024 * 1024
        || !/^[a-f0-9]{64}$/u.test(row.raw_sha256) || !/^[a-f0-9]{64}$/u.test(row.canonical_sha256)
        || row.r2_key !== snapshotObjectKey(row.source_id, row.raw_sha256, row.content_type)
        || row.snapshot_id !== await sha256Hex(`${row.source_id}:${row.raw_sha256}`)
        || !Number.isFinite(Date.parse(row.fetched_at)) || Date.parse(row.fetched_at) > Date.parse(now)) throw new Error('snapshot_policy')
    } catch { defer('invalid_manifest_or_snapshot'); continue }
    try {
      // Trust comes from the independent organization registry, never a hostname suffix
      // or the new manifest's own allowlist. Existing official documents may add exact hosts.
      const known = await environment.INGESTION_DB.prepare(`
        SELECT domain AS host, NULL AS url FROM organization_domains WHERE organization_id = ?1
        UNION ALL SELECT NULL, canonical_url FROM source_documents
          WHERE publisher_organization_id = ?1 AND official = 1 AND active = 1
            AND authority_level IN ('primary_official', 'secondary_official') AND robots_policy = 'enforce'
      `).bind(row.institution_id).all<{ host: string | null; url: string | null }>()
      if (!known.success) throw new Error('Could not load official host registry')
      const trustedHosts = new Set<string>()
      const hostEvidence = new Map<string, { kind: string; value: string }>()
      for (const value of [{ host: null, url: row.official_url }, { host: null, url: row.admissions_url }, ...(known.results ?? [])]) {
        try {
          if (value.host) {
            const host = normalizeAllowedHost(value.host)
            trustedHosts.add(host)
            if (!hostEvidence.has(host)) hostEvidence.set(host, { kind: 'domain', value: value.host })
          }
          if (value.url) {
            const host = normalizeAllowedHost(new URL(value.url).hostname)
            trustedHosts.add(host)
            const kind = value.url === row.official_url ? 'official' : value.url === row.admissions_url ? 'admissions' : 'document'
            if (!hostEvidence.has(host)) hostEvidence.set(host, { kind, value: value.url })
          }
        } catch { /* An invalid registry entry cannot enlarge trust. */ }
      }
      if (!trustedHosts.has(url.hostname) || !trustedHosts.has(finalUrl.hostname)) { defer('host_not_registered_to_school'); continue }
      const object = await environment.SNAPSHOTS_BUCKET.get(row.r2_key)
      if (!object) { defer('snapshot_body_missing'); continue }
      const bytes = await object.arrayBuffer()
      if (bytes.byteLength !== row.byte_length || await sha256Hex(bytes) !== row.raw_sha256
        || object.customMetadata?.sourceId !== row.source_id || object.customMetadata?.rawSha256 !== row.raw_sha256
        || object.customMetadata?.canonicalSha256 !== row.canonical_sha256 || object.customMetadata?.fetchedAt !== row.fetched_at) {
        defer('snapshot_body_mismatch'); continue
      }
      const documentId = `source-document-${(await sha256Hex(url.href)).slice(0, 24)}`
      const sourceKind = manifest.sourceCategory.includes('scholarship') ? 'scholarship'
        : manifest.sourceCategory === 'program_detail' || manifest.sourceCategory.endsWith('_catalog') ? 'program' : 'institution'
      // This is a source label, not an asserted programme title or a new fact verification date.
      const title = `Official source: ${url.hostname}${url.pathname}${url.search}`.slice(0, 1000)
      const publisher = row.publisher_name?.trim() || row.institution_id
      const guard = `EXISTS (SELECT 1 FROM ingestion_sources current
        JOIN organizations organization ON organization.record_id = ?3
        JOIN institutions institution ON institution.record_id = organization.record_id
        JOIN records record ON record.id = organization.record_id
        JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = ?4 AND snapshot.source_id = current.source_id
        WHERE current.source_id = ?1 AND current.manifest_json = ?2 AND current.enabled = 1
          AND organization.official_url = ?5 AND institution.admissions_url IS ?6
          AND record.workflow_status IN ('validated', 'applied', 'published', 'stale')
          AND NOT EXISTS (SELECT 1 FROM json_each(?8) proof WHERE NOT (
            (json_extract(proof.value, '$.kind') = 'official' AND organization.official_url = json_extract(proof.value, '$.value'))
            OR (json_extract(proof.value, '$.kind') = 'admissions' AND institution.admissions_url = json_extract(proof.value, '$.value'))
            OR (json_extract(proof.value, '$.kind') = 'domain' AND EXISTS (SELECT 1 FROM organization_domains domain
              WHERE domain.organization_id = ?3 AND domain.domain = json_extract(proof.value, '$.value')))
            OR (json_extract(proof.value, '$.kind') = 'document' AND EXISTS (SELECT 1 FROM source_documents trusted
              WHERE trusted.publisher_organization_id = ?3 AND trusted.canonical_url = json_extract(proof.value, '$.value')
                AND trusted.official = 1 AND trusted.active = 1 AND trusted.robots_policy = 'enforce'
                AND trusted.authority_level IN ('primary_official', 'secondary_official'))))))
        AND NOT EXISTS (SELECT 1 FROM promotion_source_bindings binding WHERE binding.source_id = ?1)
        AND NOT EXISTS (SELECT 1 FROM ingestion_sources other WHERE other.enabled = 1
          AND json_extract(other.manifest_json, '$.officialUrl') = ?7
          AND json_extract(other.manifest_json, '$.institutionId') <> ?3)`
      const values = [row.source_id, row.manifest_json, row.institution_id, row.snapshot_id, row.official_url, row.admissions_url, url.href, JSON.stringify([...new Set([url.hostname, finalUrl.hostname])].map(host => hostEvidence.get(host)))]
      const consistentDocument = `canonical_url = ?7 AND publisher_organization_id = ?3
        AND official = 1 AND active = 1 AND robots_policy = 'enforce'
        AND authority_level IN ('primary_official', 'secondary_official')`
      const statements = [
        environment.INGESTION_DB.prepare(`INSERT OR IGNORE INTO source_documents
          (id, public_id, canonical_url, publisher_organization_id, source_kind, authority_level, official,
            language_code, active, fetch_cadence_minutes, robots_policy, created_at, updated_at)
          SELECT ?9, ?9, ?7, ?3, ?10, 'primary_official', 1, 'other', 1, ?11, 'enforce', ?12, ?12
          WHERE ${guard}`).bind(...values, documentId, sourceKind, manifest.schedule.intervalHours * 60, now),
        environment.INGESTION_DB.prepare(`INSERT OR IGNORE INTO publication_source_metadata
          (source_id, title, publisher, reviewed_by, reviewed_at, updated_at)
          SELECT id, ?9, ?10, 'automatic-official-source-binding-v1', ?11, ?12
          FROM source_documents WHERE ${consistentDocument} AND ${guard}`)
          .bind(...values, title, publisher, row.fetched_at, now),
        environment.INGESTION_DB.prepare(`INSERT OR IGNORE INTO promotion_source_bindings
          (source_id, source_document_id, enabled, created_at, updated_at)
          SELECT ?1, id, 1, ?9, ?9 FROM source_documents WHERE ${consistentDocument} AND ${guard}`)
          .bind(...values, now),
      ]
      const writes = await environment.INGESTION_DB.batch(statements)
      if (writes.some(write => !write.success)) throw new Error('Could not persist automatic source binding')
      if (Number(writes.at(-1)?.meta?.changes ?? 0) === 1) result.registered += 1
      else defer('ownership_conflict_or_concurrent_change')
    } catch (error) { failures.push(error); defer('infrastructure_error') }
  }
  if (failures.length) throw new AggregateError(failures, 'Some automatic source bindings could not be registered')
  return result
}
