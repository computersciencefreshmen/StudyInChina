import { validateManifest } from './security'
import type {
  D1PreparedStatement,
  D1Result,
  ExtractionCandidate,
  ExtractedEntityCandidate,
  IngestionEnv,
  IngestionJob,
  SnapshotRecord,
  SourceManifestV1,
  SourceState,
} from './types'

type SourceRow = {
  source_id: string
  manifest_json: string
  etag: string | null
  last_modified: string | null
  raw_sha256: string | null
  canonical_sha256: string | null
  next_fetch_at: string | null
  consecutive_failures: number | null
}

type DueSourceRow = { source_id: string }

export type DomainLease = { host: string; token: string }

export type RobotsCacheRow = {
  host: string
  body: string | null
  statusCode: number
  fetchedAt: string
  expiresAt: string
}

function ensureSuccess(result: D1Result, operation: string): void {
  if (!result.success) throw new Error(`${operation} failed: ${result.error ?? 'unknown D1 error'}`)
}

function ensureBatch(results: D1Result[], operation: string): void {
  for (const result of results) ensureSuccess(result, operation)
}

const MAX_D1_BATCH_STATEMENTS = 80

function entityPersistenceStatements(
  database: IngestionEnv['INGESTION_DB'],
  candidate: ExtractedEntityCandidate,
): D1PreparedStatement[] {
  return [
    database.prepare(
      `INSERT INTO source_discoveries
        (discovery_id, institution_id, discovered_from_source_id,
         discovered_from_snapshot_id, canonical_url, url_sha256, source_role,
         link_text, discovery_context_json, discovery_status, discovered_at,
         last_seen_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'discovered', ?10, ?10, ?10, ?10)
       ON CONFLICT(institution_id, canonical_url) DO UPDATE SET
         link_text = excluded.link_text,
         discovery_context_json = excluded.discovery_context_json,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
    ).bind(
      candidate.discoveryId,
      candidate.institutionId,
      candidate.sourceId,
      candidate.snapshotId,
      candidate.officialUrl,
      candidate.urlSha256,
      candidate.entityType === 'program' ? 'program_detail' : 'scholarship_detail',
      String(candidate.facts.name ?? '').slice(0, 1_000),
      JSON.stringify({
        entityKey: candidate.entityKey,
        entityType: candidate.entityType,
        extractor: candidate.extractor,
      }),
      candidate.createdAt,
    ),
    database.prepare(
      `INSERT OR IGNORE INTO extracted_entity_candidates
        (candidate_id, institution_id, entity_type, entity_key, source_id,
         snapshot_id, source_discovery_id, ingestion_job_id, extractor,
         candidate_status, facts_json, evidence_json, issues_json,
         entity_sha256, confidence_ppm, created_at, processed_at, registered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'registered',
               ?10, ?11, '[]', ?12, 1000000, ?13, ?13, ?13)`,
    ).bind(
      candidate.candidateId,
      candidate.institutionId,
      candidate.entityType,
      candidate.entityKey,
      candidate.sourceId,
      candidate.snapshotId,
      candidate.discoveryId,
      candidate.ingestionJobId,
      candidate.extractor,
      JSON.stringify(candidate.facts),
      JSON.stringify(candidate.evidence),
      candidate.entitySha256,
      candidate.createdAt,
    ),
    database.prepare(
      `INSERT INTO entity_registry
        (registry_id, institution_id, entity_type, entity_key, identity_sha256,
         registry_status, first_candidate_id, latest_candidate_id,
         first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6, ?7, ?7, ?7, ?7)
       ON CONFLICT(institution_id, entity_type, entity_key) DO UPDATE SET
         latest_candidate_id = excluded.latest_candidate_id,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
    ).bind(
      candidate.registryId,
      candidate.institutionId,
      candidate.entityType,
      candidate.entityKey,
      candidate.identitySha256,
      candidate.candidateId,
      candidate.createdAt,
    ),
    database.prepare(
      `INSERT OR IGNORE INTO catalog_reconciliation_items
        (reconciliation_id, institution_id, source_id, snapshot_id,
         catalog_item_key, entity_type, entity_key, candidate_id, registry_id,
         disposition, evidence_json, first_seen_at, last_seen_at,
         created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?7, ?8, 'pending',
               ?9, ?10, ?10, ?10, ?10)`,
    ).bind(
      candidate.reconciliationId,
      candidate.institutionId,
      candidate.sourceId,
      candidate.snapshotId,
      candidate.entityKey,
      candidate.entityType,
      candidate.candidateId,
      candidate.registryId,
      JSON.stringify(candidate.evidence),
      candidate.createdAt,
    ),
  ]
}


export async function hasEntityExtraction(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  sourceId: string,
  snapshotId: string,
  extractor: string,
): Promise<boolean> {
  const row = await environment.INGESTION_DB.prepare(
    `SELECT 1 AS present
       FROM entity_extraction_runs
      WHERE source_id = ?1 AND snapshot_id = ?2 AND extractor = ?3
      LIMIT 1`,
  ).bind(sourceId, snapshotId, extractor).first<{ present: number }>()
  return row?.present === 1
}

export async function loadSourceState(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  sourceId: string,
): Promise<SourceState | null> {
  const row = await environment.INGESTION_DB.prepare(
    `SELECT source_id, manifest_json, etag, last_modified, raw_sha256,
            canonical_sha256, next_fetch_at, consecutive_failures
       FROM ingestion_sources
      WHERE source_id = ?1 AND enabled = 1`,
  )
    .bind(sourceId)
    .first<SourceRow>()
  if (!row) return null
  const parsed = JSON.parse(row.manifest_json) as SourceManifestV1
  const manifest = validateManifest(parsed)
  if (manifest.id !== row.source_id) throw new Error('Manifest id does not match source_id')
  return {
    manifest,
    etag: row.etag,
    lastModified: row.last_modified,
    rawSha256: row.raw_sha256,
    canonicalSha256: row.canonical_sha256,
    nextFetchAt: row.next_fetch_at,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
  }
}

export async function listDueSourceIds(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  now: string,
  limit: number,
  includeDiscovery = true,
): Promise<string[]> {
  const result = await environment.INGESTION_DB.prepare(
    `SELECT source_id
      FROM ingestion_sources
      WHERE enabled = 1
        AND (next_fetch_at IS NULL OR next_fetch_at <= ?1)
        AND (?3 = 1 OR json_extract(manifest_json, '$.sourceCategory') <> 'catalog_anchor')
        AND NOT EXISTS (
          SELECT 1
            FROM ingestion_jobs
           WHERE ingestion_jobs.source_id = ingestion_sources.source_id
             AND ingestion_jobs.status IN ('queued', 'running', 'retrying')
        )
      ORDER BY COALESCE(next_fetch_at, '1970-01-01T00:00:00.000Z'), source_id
      LIMIT ?2`,
  )
    .bind(now, limit, includeDiscovery ? 1 : 0)
    .all<DueSourceRow>()
  ensureSuccess(result, 'list due sources')
  return (result.results ?? []).map((row) => row.source_id)
}

export async function markEnqueueFailed(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  jobId: string,
  now: string,
  message: string,
): Promise<void> {
  const result = await environment.INGESTION_DB.prepare(
    `UPDATE ingestion_jobs
        SET status = 'failed', error_code = 'queue_send_failed', error_message = ?2,
            completed_at = ?3, updated_at = ?3
      WHERE job_id = ?1`,
  )
    .bind(jobId, message.slice(0, 1_000), now)
    .run()
  ensureSuccess(result, 'mark enqueue failed')
}

export async function claimJob(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  job: IngestionJob,
): Promise<boolean> {
  const result = await environment.INGESTION_DB.prepare(
    `INSERT OR IGNORE INTO ingestion_jobs
      (job_id, source_id, status, reason, scheduled_at, created_at, updated_at)
     VALUES (?1, ?2, 'queued', ?3, ?4, ?4, ?4)`,
  )
    .bind(job.jobId, job.sourceId, job.reason, job.scheduledAt)
    .run()
  ensureSuccess(result, 'claim ingestion job')
  return Number(result.meta?.changes ?? 0) > 0
}

export async function markJobRunning(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  job: IngestionJob,
  attempt: number,
  now: string,
): Promise<void> {
  const result = await environment.INGESTION_DB.prepare(
    `UPDATE ingestion_jobs
        SET status = 'running', attempt = ?2, started_at = COALESCE(started_at, ?3), updated_at = ?3
      WHERE job_id = ?1`,
  )
    .bind(job.jobId, attempt, now)
    .run()
  ensureSuccess(result, 'mark ingestion job running')
}

export async function recordNoChange(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  parameters: {
    job: IngestionJob
    sourceId: string
    checkedAt: string
    nextFetchAt: string
    etag: string | null
    lastModified: string | null
    rawSha256?: string | null
    outcome: 'not-modified' | 'raw-duplicate' | 'canonical-duplicate'
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_sources
          SET etag = COALESCE(?2, etag),
              last_modified = COALESCE(?3, last_modified),
              raw_sha256 = COALESCE(?4, raw_sha256),
              last_checked_at = ?5,
              last_success_at = ?5,
              next_fetch_at = ?6,
              consecutive_failures = 0,
              last_error_code = NULL,
              updated_at = ?5
        WHERE source_id = ?1`,
    ).bind(
      parameters.sourceId,
      parameters.etag,
      parameters.lastModified,
      parameters.rawSha256 ?? null,
      parameters.checkedAt,
      parameters.nextFetchAt,
    ),
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_jobs
          SET status = 'completed', outcome = ?2, completed_at = ?3, updated_at = ?3
        WHERE job_id = ?1`,
    ).bind(parameters.job.jobId, parameters.outcome, parameters.checkedAt),
  ]
  ensureBatch(await environment.INGESTION_DB.batch(statements), 'record unchanged source')
}

export async function persistChangedResult(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  parameters: {
    job: IngestionJob
    snapshot: SnapshotRecord
    candidate: ExtractionCandidate
    entityExtraction?: {
      extractor: string
      institutionId: string
      candidates: ExtractedEntityCandidate[]
    }
    nextFetchAt: string
  },
): Promise<void> {
  const { snapshot, candidate, job } = parameters
  const statements: D1PreparedStatement[] = [
    environment.INGESTION_DB.prepare(
      `INSERT OR IGNORE INTO ingestion_snapshots
        (snapshot_id, source_id, r2_key, raw_sha256, canonical_sha256, content_type,
         byte_length, final_url, fetched_at, etag, last_modified)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      snapshot.snapshotId,
      snapshot.sourceId,
      snapshot.r2Key,
      snapshot.rawSha256,
      snapshot.canonicalSha256,
      snapshot.contentType,
      snapshot.byteLength,
      snapshot.finalUrl,
      snapshot.fetchedAt,
      snapshot.etag,
      snapshot.lastModified,
    ),
    ...(snapshot.derivative ? [
      environment.INGESTION_DB.prepare(
        `INSERT OR IGNORE INTO ingestion_snapshot_derivatives
          (snapshot_id, source_id, derivative_kind, r2_key, content_sha256,
           content_type, byte_length, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        snapshot.snapshotId,
        snapshot.sourceId,
        snapshot.derivative.kind,
        snapshot.derivative.r2Key,
        snapshot.derivative.contentSha256,
        snapshot.derivative.contentType,
        snapshot.derivative.byteLength,
        snapshot.fetchedAt,
      ),
    ] : []),
    ...(parameters.entityExtraction?.candidates ?? []).flatMap((item) =>
      entityPersistenceStatements(environment.INGESTION_DB, item)),
    ...(parameters.entityExtraction ? [
      environment.INGESTION_DB.prepare(
        `INSERT INTO entity_extraction_runs
          (snapshot_id, source_id, institution_id, extractor, extraction_status,
           candidate_count, issues_json, completed_at)
         VALUES (?1, ?2, ?3, ?4, 'completed', ?5, '[]', ?6)
         ON CONFLICT(snapshot_id, extractor) DO UPDATE SET
           extraction_status = excluded.extraction_status,
           candidate_count = excluded.candidate_count,
           issues_json = excluded.issues_json,
           completed_at = excluded.completed_at`,
      ).bind(
        snapshot.snapshotId,
        snapshot.sourceId,
        parameters.entityExtraction.institutionId,
        parameters.entityExtraction.extractor,
        parameters.entityExtraction.candidates.length,
        snapshot.fetchedAt,
      ),
    ] : []),

    environment.INGESTION_DB.prepare(
      `INSERT OR IGNORE INTO ingestion_candidates
        (candidate_id, source_id, snapshot_id, extractor, gate_status,
         facts_json, issues_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      candidate.candidateId,
      candidate.sourceId,
      candidate.snapshotId,
      candidate.extractor,
      candidate.gateStatus,
      JSON.stringify(candidate.facts),
      JSON.stringify(candidate.issues),
      candidate.createdAt,
    ),
    environment.INGESTION_DB.prepare(
      `INSERT OR IGNORE INTO ingestion_candidate_provenance
        (candidate_id, schema_version, model_name, prompt_fingerprint,
         extractor_fingerprint, primary_extraction_json,
         secondary_extraction_json, field_evidence_json, contains_critical,
         created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      candidate.candidateId,
      candidate.provenance.schemaVersion,
      candidate.provenance.model,
      candidate.provenance.promptFingerprint,
      candidate.provenance.extractorFingerprint,
      candidate.provenance.primaryExtraction === null
        ? null
        : JSON.stringify(candidate.provenance.primaryExtraction),
      candidate.provenance.secondaryExtraction === null
        ? null
        : JSON.stringify(candidate.provenance.secondaryExtraction),
      JSON.stringify(candidate.provenance.fieldEvidence),
      candidate.provenance.containsCritical ? 1 : 0,
      candidate.createdAt,
    ),
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_sources
          SET etag = ?2,
              last_modified = ?3,
              raw_sha256 = ?4,
              canonical_sha256 = ?5,
              last_checked_at = ?6,
              last_success_at = ?6,
              next_fetch_at = ?7,
              consecutive_failures = 0,
              last_error_code = NULL,
              updated_at = ?6
        WHERE source_id = ?1`,
    ).bind(
      snapshot.sourceId,
      snapshot.etag,
      snapshot.lastModified,
      snapshot.rawSha256,
      snapshot.canonicalSha256,
      snapshot.fetchedAt,
      parameters.nextFetchAt,
    ),
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_jobs
          SET status = 'completed', outcome = ?2, completed_at = ?3, updated_at = ?3
        WHERE job_id = ?1`,
    ).bind(job.jobId, candidate.gateStatus, snapshot.fetchedAt),
  ]
  for (let offset = 0; offset < statements.length; offset += MAX_D1_BATCH_STATEMENTS) {
    const batch = statements.slice(offset, offset + MAX_D1_BATCH_STATEMENTS)
    ensureBatch(
      await environment.INGESTION_DB.batch(batch),
      'persist changed ingestion result',
    )
}
  }

export async function recordJobFailure(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  parameters: {
    job: IngestionJob
    sourceId: string
    attempt: number
    code: string
    message: string
    retrying: boolean
    now: string
    nextFetchAt?: string
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_sources
          SET last_checked_at = ?2,
              next_fetch_at = COALESCE(?3, next_fetch_at),
              consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
              last_error_code = ?4,
              updated_at = ?2
        WHERE source_id = ?1`,
    ).bind(
      parameters.sourceId,
      parameters.now,
      parameters.nextFetchAt ?? null,
      parameters.code,
    ),
    environment.INGESTION_DB.prepare(
      `UPDATE ingestion_jobs
          SET status = ?2,
              attempt = ?3,
              error_code = ?4,
              error_message = ?5,
              completed_at = CASE WHEN ?2 = 'failed' THEN ?6 ELSE completed_at END,
              updated_at = ?6
        WHERE job_id = ?1`,
    ).bind(
      parameters.job.jobId,
      parameters.retrying ? 'retrying' : 'failed',
      parameters.attempt,
      parameters.code,
      parameters.message.slice(0, 1_000),
      parameters.now,
    ),
  ]
  ensureBatch(await environment.INGESTION_DB.batch(statements), 'record ingestion failure')
}

export async function readRobotsCache(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  host: string,
  now: string,
): Promise<RobotsCacheRow | null> {
  const row = await environment.INGESTION_DB.prepare(
    `SELECT host, body, status_code, fetched_at, expires_at
       FROM ingestion_robots_cache
      WHERE host = ?1 AND expires_at > ?2`,
  )
    .bind(host, now)
    .first<{
      host: string
      body: string | null
      status_code: number
      fetched_at: string
      expires_at: string
    }>()
  if (!row) return null
  return {
    host: row.host,
    body: row.body,
    statusCode: row.status_code,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
  }
}

export async function writeRobotsCache(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  cache: RobotsCacheRow,
): Promise<void> {
  const result = await environment.INGESTION_DB.prepare(
    `INSERT INTO ingestion_robots_cache
      (host, body, status_code, fetched_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(host) DO UPDATE SET
       body = excluded.body,
       status_code = excluded.status_code,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
  )
    .bind(cache.host, cache.body, cache.statusCode, cache.fetchedAt, cache.expiresAt)
    .run()
  ensureSuccess(result, 'write robots cache')
}

export async function acquireDomainLease(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  host: string,
  now: Date,
  options: { leaseSeconds?: number; minimumSpacingSeconds?: number } = {},
): Promise<DomainLease | null> {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost || normalizedHost.includes('/') || normalizedHost.includes(':')) {
    throw new Error('Cannot lease an invalid source host')
  }
  const leaseSeconds = options.leaseSeconds ?? 180
  const minimumSpacingSeconds = options.minimumSpacingSeconds ?? 5
  const nowIso = now.toISOString()
  const availableBefore = new Date(now.getTime() - minimumSpacingSeconds * 1_000).toISOString()
  const leasedUntil = new Date(now.getTime() + leaseSeconds * 1_000).toISOString()
  const token = crypto.randomUUID()

  const inserted = await environment.INGESTION_DB.prepare(
    `INSERT OR IGNORE INTO ingestion_domain_leases
      (host, lease_token, leased_until, last_request_at, updated_at)
     VALUES (?1, NULL, NULL, NULL, ?2)`,
  ).bind(normalizedHost, nowIso).run()
  ensureSuccess(inserted, 'initialize domain lease')

  const acquired = await environment.INGESTION_DB.prepare(
    `UPDATE ingestion_domain_leases
        SET lease_token = ?2, leased_until = ?3, updated_at = ?4
      WHERE host = ?1
        AND (lease_token IS NULL OR leased_until <= ?4)
        AND (last_request_at IS NULL OR last_request_at <= ?5)`,
  ).bind(normalizedHost, token, leasedUntil, nowIso, availableBefore).run()
  ensureSuccess(acquired, 'acquire domain lease')
  return Number(acquired.meta?.changes ?? 0) > 0
    ? { host: normalizedHost, token }
    : null
}

export async function releaseDomainLease(
  environment: Pick<IngestionEnv, 'INGESTION_DB'>,
  lease: DomainLease,
  completedAt: Date,
): Promise<void> {
  const completedAtIso = completedAt.toISOString()
  const result = await environment.INGESTION_DB.prepare(
    `UPDATE ingestion_domain_leases
        SET lease_token = NULL,
            leased_until = NULL,
            last_request_at = ?3,
            updated_at = ?3
      WHERE host = ?1 AND lease_token = ?2`,
  ).bind(lease.host, lease.token, completedAtIso).run()
  ensureSuccess(result, 'release domain lease')
}
