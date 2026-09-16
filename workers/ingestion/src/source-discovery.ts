import { sha256Hex } from './hash'
import { assertSafeSourceUrl, validateManifest } from './security'
import { htmlToText } from './rules'
import { boundedInteger } from './retry'
import type { D1PreparedStatement, IngestionEnv, SnapshotRecord, SourceManifestV1 } from './types'

export const MAX_DISCOVERY_DEPTH = 2
export const MAX_AUTOMATIC_SOURCES_PER_INSTITUTION = 100
const AUTO_SOURCE_PREFIX = 'auto-discovery-'
type DiscoveryRole = 'admissions_home' | 'program_catalog' | 'program_detail' | 'scholarship_catalog' | 'scholarship_detail'
type OfficialLink = { officialUrl: string; linkText: string; role: DiscoveryRole }
type DiscoveryRow = {
  discovery_id: string
  institution_id: string
  canonical_url: string
  source_role: DiscoveryRole
  manifest_json: string
  parent_id: string
  parent_enabled: number
  snapshot_url: string
}

function sourceDepth(sourceId: string): number {
  if (!sourceId.startsWith(AUTO_SOURCE_PREFIX)) return 0
  const match = /^auto-discovery-d([1-9])-/u.exec(sourceId)
  return match ? Number(match[1]) : MAX_DISCOVERY_DEPTH
}

/** Links are crawl hints only. Their labels never become verified entity facts. */
export function discoverOfficialLinks(html: string, manifest: SourceManifestV1, sourceUrl: string): OfficialLink[] {
  if (sourceDepth(manifest.id) >= MAX_DISCOVERY_DEPTH) return []
  const allowedHosts = [...manifest.allowedHosts, ...(manifest.allowedRedirectHosts ?? [])]
  const base = assertSafeSourceUrl(sourceUrl, allowedHosts)
  const links = new Map<string, OfficialLink>()
  // Bound both input and number of links; remove executable/comment bodies before scanning.
  const input = html.slice(0, 5_000_000)
  const lowerInput = input.toLowerCase()
  const ignoredBodies = /<!--|<(script|style)\b/giu
  const chunks: string[] = []
  let cursor = 0
  let ignored: RegExpExecArray | null
  while ((ignored = ignoredBodies.exec(input)) !== null) {
    chunks.push(input.slice(cursor, ignored.index))
    const closing = ignored[0] === '<!--' ? '-->' : `</${ignored[1]!.toLowerCase()}`
    const closingStart = lowerInput.indexOf(closing, ignored.index + ignored[0].length)
    const closingEnd = closingStart < 0 ? -1 : lowerInput.indexOf('>', closingStart)
    cursor = closingEnd < 0 ? input.length : closingEnd + 1
    ignoredBodies.lastIndex = cursor
  }
  chunks.push(input.slice(cursor))
  const content = chunks.join('')
  const anchors = /<a\b([^>]{0,8192})>/giu
  const lowerContent = content.toLowerCase()
  let match: RegExpExecArray | null
  while ((match = anchors.exec(content)) !== null) {
    if (links.size >= 100) break
    const bodyStart = match.index + match[0].length
    const bodyEnd = lowerContent.indexOf('</a', bodyStart)
    if (bodyEnd < 0) break
    anchors.lastIndex = bodyEnd + 3
    // Bound labels independently so malformed nested markup cannot cause quadratic scans.
    if (bodyEnd - bodyStart > 16_384) continue
    const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(match[1]!)
    const rawHref = href?.[1] ?? href?.[2] ?? href?.[3]
    if (!rawHref || rawHref.trim().startsWith('#')) continue
    const linkText = htmlToText(content.slice(bodyStart, bodyEnd)).replace(/\s+/gu, ' ').trim().slice(0, 1000)
    let role: DiscoveryRole
    if (/(?:scholarships?|fellowships?|奖学金|资助)/iu.test(linkText)) role = 'scholarship_catalog'
    else if (/(?:program(?:me)?s?|catalog(?:ue)?|majors?|专业|课程|项目|本科|硕士|博士|汉语)/iu.test(linkText)) role = 'program_catalog'
    else if (/(?:admissions?|application guide|国际招生|招生简章|申请指南|留学生招生)/iu.test(linkText)) role = 'admissions_home'
    else continue
    try {
      // The URL constructor handles relative links; the existing network safety policy enforces exact hosts.
      const url = assertSafeSourceUrl(new URL(rawHref.replace(/&amp;/giu, '&'), base), allowedHosts)
      url.hash = ''
      if (url.href === base.href || /\.(?:png|jpe?g|gif|svg|zip|exe)(?:$|\?)/iu.test(url.href)) continue
      links.set(url.href, { officialUrl: url.href, linkText, role })
    } catch { /* Unsafe or off-host links never enter the discovery registry. */ }
  }
  return [...links.values()]
}

export async function officialLinkDiscoveryStatements(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  manifest: SourceManifestV1,
  snapshot: SnapshotRecord,
  html: string,
): Promise<D1PreparedStatement[]> {
  const links = discoverOfficialLinks(html, manifest, snapshot.finalUrl)
  const statements: D1PreparedStatement[] = []
  for (const link of links) {
    const urlHash = await sha256Hex(link.officialUrl)
    const id = await sha256Hex(`source-discovery:${manifest.institutionId}:${link.officialUrl}`)
    statements.push(environment.INGESTION_DB.prepare(`
      INSERT INTO source_discoveries (
        discovery_id, institution_id, discovered_from_source_id, discovered_from_snapshot_id,
        canonical_url, url_sha256, source_role, link_text, discovery_context_json,
        discovery_status, discovered_at, last_seen_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'discovered', ?10, ?10, ?10, ?10)
      ON CONFLICT(institution_id, canonical_url) DO UPDATE SET
        last_seen_at = MAX(source_discoveries.last_seen_at, excluded.last_seen_at)
    `).bind(id, manifest.institutionId, manifest.id, snapshot.snapshotId,
      link.officialUrl, urlHash, link.role, link.linkText,
      JSON.stringify({ extractor: 'official-links-v1', locator: 'a[href]', quote: link.linkText }),
      snapshot.fetchedAt))
  }
  return statements
}

export async function buildDiscoveredSourceManifest(
  parent: SourceManifestV1,
  discovery: { institutionId: string; officialUrl: string; role: DiscoveryRole },
): Promise<SourceManifestV1> {
  parent = validateManifest(parent)
  if (!parent.enabled || parent.robots.mode !== 'enforce') throw new Error('parent_collection_blocked')
  if (parent.institutionId !== discovery.institutionId) throw new Error('institution_mismatch')
  const depth = sourceDepth(parent.id) + 1
  if (depth > MAX_DISCOVERY_DEPTH) throw new Error('discovery_depth_limit')
  const trustedHosts = [...parent.allowedHosts, ...(parent.allowedRedirectHosts ?? [])]
  const url = assertSafeSourceUrl(discovery.officialUrl, trustedHosts)
  url.hash = ''
  const idHash = await sha256Hex(`${discovery.institutionId}:${url.href}`)
  const scholarship = discovery.role.startsWith('scholarship')
  return validateManifest({
    version: 1,
    id: `${AUTO_SOURCE_PREFIX}d${depth}-${idHash.slice(0, 40)}`,
    institutionId: discovery.institutionId,
    entityType: scholarship ? 'scholarship' : 'program',
    sourceCategory: discovery.role === 'program_detail' ? 'program_detail'
      : scholarship ? 'university_scholarship' : 'catalog_anchor',
    officialUrl: url.href,
    // No trust widening, parent extraction rules, browser execution, or copied critical fields.
    allowedHosts: [url.hostname],
    allowedRedirectHosts: trustedHosts.filter((host) => host !== url.hostname),
    enabled: true,
    schedule: { intervalHours: 168, jitterMinutes: 60 },
    fetch: { renderMode: 'http', timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, documentConversion: 'disabled' },
    robots: { mode: 'enforce' },
    extraction: {
      mode: 'rules-only', schemaVersion: 'auto-discovery-page-v1',
      fields: [{ path: 'pageTitle', type: 'string', required: false }],
      rules: [{ kind: 'regex', fieldPath: 'pageTitle', pattern: '<title[^>]*>([^<]+)</title>', flags: 'i' }],
    },
  })
}

/** Enrollment grants permission to fetch, never permission to publish facts. */
export async function registerDiscoveredSources(
  environment: Pick<IngestionEnv, 'INGESTION_DB' | 'DISCOVERY_REGISTER_LIMIT'>,
  now: string,
): Promise<{ registered: number; deferred: number }> {
  const limit = boundedInteger(environment.DISCOVERY_REGISTER_LIMIT, 20, 1, 100)
  const result = await environment.INGESTION_DB.prepare(`
    WITH eligible AS (
      SELECT discovery.*, parent.manifest_json, parent.source_id AS parent_id,
        parent.enabled AS parent_enabled, snapshot.final_url AS snapshot_url,
        ROW_NUMBER() OVER (PARTITION BY discovery.institution_id
          ORDER BY discovery.updated_at, discovery.discovery_id) AS institution_rank
      FROM source_discoveries discovery
      JOIN ingestion_sources parent ON parent.source_id = discovery.discovered_from_source_id
      JOIN ingestion_snapshots snapshot ON snapshot.snapshot_id = discovery.discovered_from_snapshot_id
        AND snapshot.source_id = parent.source_id
      WHERE discovery.registered_source_id IS NULL
        AND discovery.source_role IN ('admissions_home', 'program_catalog', 'program_detail', 'scholarship_catalog', 'scholarship_detail')
        AND (discovery.discovery_status IN ('discovered', 'queued')
          OR (discovery.discovery_status IN ('stale', 'rejected') AND julianday(discovery.updated_at) <= julianday(?1) - 7))
    )
    SELECT * FROM eligible ORDER BY institution_rank, updated_at, discovery_id LIMIT ?2
  `).bind(now, limit).all<DiscoveryRow>()
  if (!result.success) throw new Error('Could not list official source discoveries')
  let registered = 0
  let deferred = 0
  for (const row of result.results ?? []) {
    let manifest: SourceManifestV1
    try {
      const parent = validateManifest(JSON.parse(row.manifest_json))
      if (parent.id !== row.parent_id || row.parent_enabled !== 1) throw new Error('parent_collection_blocked')
      assertSafeSourceUrl(row.snapshot_url, [...parent.allowedHosts, ...(parent.allowedRedirectHosts ?? [])])
      manifest = await buildDiscoveredSourceManifest(parent, {
        institutionId: row.institution_id, officialUrl: row.canonical_url, role: row.source_role,
      })
    } catch {
      const rejected = await environment.INGESTION_DB.prepare(`
        UPDATE source_discoveries SET discovery_status = 'rejected', updated_at = ?2,
          discovery_context_json = json_set(COALESCE(discovery_context_json, '{}'), '$.automationDisposition', 'policy_rejected')
        WHERE discovery_id = ?1 AND registered_source_id IS NULL
      `).bind(row.discovery_id, now).run()
      if (!rejected.success) throw new Error('Could not quarantine unsafe discovery')
      deferred += 1
      continue
    }
    // A manually disabled or specialized manifest wins over automatic enrollment.
    const existing = await environment.INGESTION_DB.prepare(`
      SELECT source_id, enabled FROM ingestion_sources
      WHERE json_extract(manifest_json, '$.institutionId') = ?1
        AND json_extract(manifest_json, '$.officialUrl') = ?2
      ORDER BY source_id LIMIT 1
    `).bind(row.institution_id, manifest.officialUrl).first<{ source_id: string; enabled: number }>()
    if (existing?.enabled === 0) {
      const disabled = await environment.INGESTION_DB.prepare(`
        UPDATE source_discoveries SET discovery_status = 'stale', updated_at = ?2
        WHERE discovery_id = ?1 AND registered_source_id IS NULL
      `).bind(row.discovery_id, now).run()
      if (!disabled.success) throw new Error('Could not defer disabled discovery')
      deferred += 1
      continue
    }
    const sourceId = existing?.source_id ?? manifest.id
    const statements = []
    if (!existing) statements.push(environment.INGESTION_DB.prepare(`
      INSERT OR IGNORE INTO ingestion_sources (source_id, manifest_json, enabled, next_fetch_at, created_at, updated_at)
      SELECT ?1, ?2, 1, ?3, ?3, ?3
      WHERE (SELECT COUNT(*) FROM ingestion_sources
        WHERE source_id GLOB 'auto-discovery-*'
          AND json_extract(manifest_json, '$.institutionId') = ?4) < ?5
        AND NOT EXISTS (SELECT 1 FROM ingestion_sources
          WHERE json_extract(manifest_json, '$.institutionId') = ?4
            AND json_extract(manifest_json, '$.officialUrl') = ?6)
    `).bind(sourceId, JSON.stringify(manifest), now, row.institution_id,
      MAX_AUTOMATIC_SOURCES_PER_INSTITUTION, manifest.officialUrl))
    statements.push(environment.INGESTION_DB.prepare(`
      UPDATE source_discoveries SET discovery_status = 'registered', registered_source_id = ?2, updated_at = ?3,
        discovery_context_json = json_set(COALESCE(discovery_context_json, '{}'), '$.automationDepth', ?4)
      WHERE discovery_id = ?1 AND registered_source_id IS NULL
        AND EXISTS (SELECT 1 FROM ingestion_sources WHERE source_id = ?2 AND enabled = 1)
    `).bind(row.discovery_id, sourceId, now, sourceDepth(manifest.id)))
    const results = await environment.INGESTION_DB.batch(statements)
    if (results.some((item) => !item.success)) throw new Error('Could not register official source discovery')
    if (Number(results.at(-1)?.meta?.changes ?? 0) > 0) registered += 1
    else {
      // Revisit capped work weekly; it must not monopolize each next cron batch.
      const capped = await environment.INGESTION_DB.prepare(`
        UPDATE source_discoveries SET discovery_status = 'stale', updated_at = ?2,
          discovery_context_json = json_set(COALESCE(discovery_context_json, '{}'), '$.automationDisposition', 'capacity_deferred')
        WHERE discovery_id = ?1 AND registered_source_id IS NULL
      `).bind(row.discovery_id, now).run()
      if (!capped.success) throw new Error('Could not defer capped discovery')
      deferred += 1
    }
  }
  return { registered, deferred }
}