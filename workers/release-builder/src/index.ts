import { CATALOG_COLUMNS } from './catalog-schema'
import {
  parseArtifact,
  ReleaseValidationError,
  sha256,
  stableJson,
} from './artifact'
import { buildArtifactFromPipeline } from './snapshot'
import type {
  D1Database,
  D1PreparedStatement,
  QueueMessageBatch,
  ReleaseArtifact,
  ReleaseBuilderEnv,
  ReleaseFailure,
  ReleaseQueueJob,
  ReleaseTableName,
  ScheduledControllerLike,
  SqlRow,
} from './types'
import { RELEASE_TABLES } from './types'

const SERVICE_VERSION = '1.0.0'
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,199}$/

type SnapshotRow = {
  publication_job_id: string
  catalog_release_id: string
  artifact_key: string
  content_sha256: string
  byte_length: number
  counts_json: string
  captured_at: string
}

type ClaimedEventRow = {
  payload_json: string
  aggregate_id: string
  lease_owner: string | null
}

type CatalogReleaseRow = {
  release_status: string
  content_sha256: string | null
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function prepared(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): D1PreparedStatement {
  return database.prepare(sql).bind(...values)
}

async function run(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<number> {
  const result = await prepared(database, sql, ...values).run()
  if (!result.success) throw new Error(result.error ?? 'D1 statement failed')
  return Number(result.meta?.changes ?? 0)
}

async function first<T>(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<T | null> {
  return prepared(database, sql, ...values).first<T>()
}

function ensureBatch(results: Array<{ success: boolean; error?: string }>, label: string): void {
  const failure = results.find((result) => !result.success)
  if (failure) throw new Error(`${label}: ${failure.error ?? 'D1 batch failed'}`)
}

export function isReleaseQueueJob(value: unknown): value is ReleaseQueueJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Record<string, unknown>
  return job.version === 1
    && typeof job.outboxEventId === 'string'
    && IDENTIFIER.test(job.outboxEventId)
    && typeof job.publicationJobId === 'string'
    && IDENTIFIER.test(job.publicationJobId)
    && typeof job.catalogReleaseId === 'string'
    && IDENTIFIER.test(job.catalogReleaseId)
    && typeof job.requestedAt === 'string'
    && !Number.isNaN(new Date(job.requestedAt).getTime())
}

function parseOutboxPayload(text: string, expected: ReleaseQueueJob): void {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ReleaseValidationError('invalid_outbox_payload', 'release outbox payload is not JSON')
  }
  if (!payload || typeof payload !== 'object') {
    throw new ReleaseValidationError('invalid_outbox_payload', 'release outbox payload is not an object')
  }
  const object = payload as Record<string, unknown>
  if (
    object.version !== 1
    || object.publicationJobId !== expected.publicationJobId
    || object.catalogReleaseId !== expected.catalogReleaseId
  ) {
    throw new ReleaseValidationError(
      'outbox_contract_mismatch',
      'release outbox payload does not match its relational identities',
    )
  }
}

async function claimEvent(
  environment: ReleaseBuilderEnv,
  job: ReleaseQueueJob,
  leaseOwner: string,
  now: Date,
): Promise<boolean> {
  const leaseSeconds = boundedInteger(environment.EVENT_LEASE_SECONDS, 900, 60, 3_600)
  const nowIso = now.toISOString()
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString()
  const changes = await run(
    environment.PIPELINE_DB,
    `UPDATE outbox_events
        SET event_status = 'processing', lease_owner = ?2, lease_expires_at = ?3,
            attempt_count = attempt_count + 1, last_error = NULL
      WHERE id = ?1 AND event_type = 'catalog.release.requested'
        AND aggregate_id = ?4
        AND (
          (event_status = 'pending' AND available_at <= ?5)
          OR (event_status = 'processing' AND lease_expires_at <= ?5)
        )`,
    job.outboxEventId,
    leaseOwner,
    leaseExpiresAt,
    job.publicationJobId,
    nowIso,
  )
  if (changes !== 1) return false

  const event = await first<ClaimedEventRow>(
    environment.PIPELINE_DB,
    `SELECT payload_json, aggregate_id, lease_owner
       FROM outbox_events WHERE id = ?1`,
    job.outboxEventId,
  )
  if (!event || event.aggregate_id !== job.publicationJobId || event.lease_owner !== leaseOwner) {
    throw new ReleaseValidationError('outbox_claim_lost', 'release outbox lease could not be verified')
  }
  parseOutboxPayload(event.payload_json, job)

  const publicationChanges = await run(
    environment.PIPELINE_DB,
    `UPDATE publication_jobs
        SET job_status = 'building', error_detail = NULL
      WHERE id = ?1 AND catalog_release_id = ?2
        AND job_status IN ('queued', 'building', 'failed')`,
    job.publicationJobId,
    job.catalogReleaseId,
  )
  if (publicationChanges !== 1) {
    throw new ReleaseValidationError(
      'publication_job_unavailable',
      'publication job is missing, mismatched, or already terminal',
    )
  }
  return true
}

async function loadSnapshot(
  database: D1Database,
  publicationJobId: string,
): Promise<SnapshotRow | null> {
  return first<SnapshotRow>(
    database,
    `SELECT publication_job_id, catalog_release_id, artifact_key,
            content_sha256, byte_length, counts_json, captured_at
       FROM release_build_snapshots WHERE publication_job_id = ?1`,
    publicationJobId,
  )
}

async function readSnapshotArtifact(
  environment: ReleaseBuilderEnv,
  snapshot: SnapshotRow,
): Promise<{ artifact: ReleaseArtifact; text: string; contentSha256: string }> {
  const object = await environment.RELEASE_ARTIFACTS.get(snapshot.artifact_key)
  if (!object) {
    throw new ReleaseValidationError('release_artifact_missing', 'immutable release artifact is missing')
  }
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength !== snapshot.byte_length) {
    throw new ReleaseValidationError('release_artifact_size_mismatch', 'release artifact size changed')
  }
  const contentSha256 = await sha256(bytes)
  if (contentSha256 !== snapshot.content_sha256) {
    throw new ReleaseValidationError('release_artifact_checksum_mismatch', 'release artifact checksum changed')
  }
  const text = new TextDecoder().decode(bytes)
  const artifact = await parseArtifact(text)
  if (
    artifact.manifest.releaseId !== snapshot.catalog_release_id
    || stableJson(artifact.manifest.counts) !== snapshot.counts_json
  ) {
    throw new ReleaseValidationError('release_snapshot_mismatch', 'release artifact no longer matches snapshot metadata')
  }
  return { artifact, text, contentSha256 }
}

async function loadOrCreateArtifact(
  environment: ReleaseBuilderEnv,
  job: ReleaseQueueJob,
): Promise<{ artifact: ReleaseArtifact; text: string; contentSha256: string }> {
  let snapshot = await loadSnapshot(environment.PIPELINE_DB, job.publicationJobId)
  if (snapshot) return readSnapshotArtifact(environment, snapshot)

  const capturedAt = new Date(job.requestedAt)
  const built = await buildArtifactFromPipeline(environment.PIPELINE_DB, job, capturedAt)
  const artifactKey = `releases/${job.catalogReleaseId}/catalog-release.v1.json`
  const byteLength = new TextEncoder().encode(built.text).byteLength
  const countsJson = stableJson(built.artifact.manifest.counts)
  await environment.RELEASE_ARTIFACTS.put(artifactKey, built.text, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      contentSha256: built.contentSha256,
      releaseId: job.catalogReleaseId,
    },
  })
  await run(
    environment.PIPELINE_DB,
    `INSERT OR IGNORE INTO release_build_snapshots (
       publication_job_id, catalog_release_id, artifact_format_version,
       artifact_key, content_sha256, byte_length, counts_json, captured_at
     ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)`,
    job.publicationJobId,
    job.catalogReleaseId,
    artifactKey,
    built.contentSha256,
    byteLength,
    countsJson,
    capturedAt.toISOString(),
  )
  snapshot = await loadSnapshot(environment.PIPELINE_DB, job.publicationJobId)
  if (!snapshot) throw new Error('release snapshot metadata was not persisted')
  return readSnapshotArtifact(environment, snapshot)
}

function rowStatements(
  database: D1Database,
  table: ReleaseTableName,
  rows: SqlRow[],
): D1PreparedStatement[] {
  const columns = CATALOG_COLUMNS[table]
  const allowed = new Set(columns)
  return rows.map((row, index) => {
    const extras = Object.keys(row).filter((key) => !allowed.has(key))
    if (extras.length > 0) {
      throw new ReleaseValidationError(
        'artifact_column_mismatch',
        `${table}[${index}] contains unsupported columns: ${extras.join(', ')}`,
      )
    }
    const placeholders = columns.map(() => '?').join(', ')
    const quoted = columns.map((column) => `"${column}"`).join(', ')
    return prepared(
      database,
      `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`,
      ...columns.map((column) => row[column] ?? null),
    )
  })
}

async function importArtifact(
  environment: ReleaseBuilderEnv,
  artifact: ReleaseArtifact,
  contentSha256: string,
  now: Date,
): Promise<'published' | 'already-published'> {
  const releaseId = artifact.manifest.releaseId
  const existing = await first<CatalogReleaseRow>(
    environment.CATALOG_DB,
    `SELECT release_status, content_sha256 FROM catalog_releases WHERE release_id = ?1`,
    releaseId,
  )
  if (existing && ['active', 'retired'].includes(existing.release_status)) {
    if (existing.content_sha256 !== contentSha256) {
      throw new ReleaseValidationError(
        'published_release_checksum_mismatch',
        'published release identity is bound to different content',
      )
    }
    return 'already-published'
  }

  await run(environment.CATALOG_DB, 'DELETE FROM search_documents WHERE release_id = ?1', releaseId)
  await run(
    environment.CATALOG_DB,
    `DELETE FROM catalog_releases
      WHERE release_id = ?1 AND release_status IN ('building', 'ready', 'failed')`,
    releaseId,
  )
  await run(
    environment.CATALOG_DB,
    `INSERT INTO catalog_releases (
       release_id, data_version, schema_version, release_status, data_date,
       generated_at, source_pipeline_run_id, content_sha256, counts_json, created_at
     ) VALUES (?1, ?2, ?3, 'building', ?4, ?5, ?6, ?7, ?8, ?9)`,
    releaseId,
    artifact.manifest.dataVersion,
    artifact.manifest.schemaVersion,
    artifact.manifest.dataDate,
    artifact.manifest.generatedAt,
    artifact.manifest.sourcePipelineRunId,
    contentSha256,
    stableJson(artifact.manifest.counts),
    now.toISOString(),
  )

  const batchSize = boundedInteger(environment.CATALOG_WRITE_BATCH_SIZE, 50, 1, 100)
  for (const table of RELEASE_TABLES) {
    const statements = rowStatements(environment.CATALOG_DB, table, artifact.tables[table])
    for (let offset = 0; offset < statements.length; offset += batchSize) {
      ensureBatch(
        await environment.CATALOG_DB.batch(statements.slice(offset, offset + batchSize)),
        `load ${table}`,
      )
    }
  }

  for (const table of RELEASE_TABLES) {
    const count = await first<{ count: number }>(
      environment.CATALOG_DB,
      `SELECT count(*) AS count FROM "${table}" WHERE release_id = ?1`,
      releaseId,
    )
    if (Number(count?.count ?? -1) !== artifact.tables[table].length) {
      throw new ReleaseValidationError(
        'catalog_table_count_mismatch',
        `${table} row count does not match immutable artifact`,
      )
    }
  }

  const requestedAt = now.toISOString()
  const activationId = `activate-${releaseId}`
  const countsJson = stableJson(artifact.manifest.counts)
  const finalResults = await environment.CATALOG_DB.batch([
    prepared(
      environment.CATALOG_DB,
      `UPDATE catalog_releases
          SET release_status = 'ready', validated_at = ?2
        WHERE release_id = ?1 AND release_status = 'building'`,
      releaseId,
      requestedAt,
    ),
    prepared(
      environment.CATALOG_DB,
      `INSERT INTO release_activation_requests (
         request_id, release_id, expected_content_sha256, expected_counts_json,
         actor, requested_at, previous_release_id, completed_at
       ) VALUES (?1, ?2, ?3, ?4, 'release-builder-worker', ?5, NULL, NULL)`,
      activationId,
      releaseId,
      contentSha256,
      countsJson,
      requestedAt,
    ),
  ])
  ensureBatch(finalResults, 'activate catalog release')
  const current = await first<{ current_release_id: string | null }>(
    environment.CATALOG_DB,
    'SELECT current_release_id FROM release_pointer WHERE singleton_id = 1',
  )
  if (current?.current_release_id !== releaseId) {
    throw new ReleaseValidationError('release_activation_failed', 'catalog release pointer did not switch')
  }
  return 'published'
}

async function markDelivered(
  environment: ReleaseBuilderEnv,
  job: ReleaseQueueJob,
  leaseOwner: string,
  artifact: ReleaseArtifact,
  contentSha256: string,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString()
  ensureBatch(
    await environment.PIPELINE_DB.batch([
      prepared(
        environment.PIPELINE_DB,
        `UPDATE publication_jobs
            SET job_status = 'published', expected_counts_json = ?2,
                content_sha256 = ?3, finished_at = ?4, error_detail = NULL
          WHERE id = ?1 AND catalog_release_id = ?5`,
        job.publicationJobId,
        stableJson(artifact.manifest.counts),
        contentSha256,
        nowIso,
        job.catalogReleaseId,
      ),
      prepared(
        environment.PIPELINE_DB,
        `UPDATE outbox_events
            SET event_status = 'delivered', delivered_at = ?3,
                lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
          WHERE id = ?1 AND lease_owner = ?2 AND event_status = 'processing'`,
        job.outboxEventId,
        leaseOwner,
        nowIso,
      ),
    ]),
    'mark release delivered',
  )
}

async function recordFailure(
  environment: ReleaseBuilderEnv,
  job: ReleaseQueueJob,
  leaseOwner: string,
  message: string,
  terminal: boolean,
  now: Date,
): Promise<void> {
  const status = terminal ? 'dead_letter' : 'pending'
  const jobStatus = terminal ? 'failed' : 'queued'
  const delaySeconds = boundedInteger(environment.MAX_QUEUE_ATTEMPTS, 4, 1, 10) * 30
  const availableAt = terminal
    ? now.toISOString()
    : new Date(now.getTime() + delaySeconds * 1_000).toISOString()
  ensureBatch(
    await environment.PIPELINE_DB.batch([
      prepared(
        environment.PIPELINE_DB,
        `UPDATE publication_jobs SET job_status = ?2, error_detail = ?3
          WHERE id = ?1 AND job_status <> 'published'`,
        job.publicationJobId,
        jobStatus,
        message.slice(0, 1_000),
      ),
      prepared(
        environment.PIPELINE_DB,
        `UPDATE outbox_events
            SET event_status = ?3, available_at = ?4, lease_owner = NULL,
                lease_expires_at = NULL, last_error = ?5
          WHERE id = ?1 AND lease_owner = ?2 AND event_status = 'processing'`,
        job.outboxEventId,
        leaseOwner,
        status,
        availableAt,
        message.slice(0, 1_000),
      ),
    ]),
    'record release failure',
  )
}

export async function processReleaseJob(
  environment: ReleaseBuilderEnv,
  job: ReleaseQueueJob,
  now = new Date(),
): Promise<'published' | 'already-published' | 'busy'> {
  const leaseOwner = `release-builder-${crypto.randomUUID()}`
  if (!(await claimEvent(environment, job, leaseOwner, now))) return 'busy'
  const built = await loadOrCreateArtifact(environment, job)
  const status = await importArtifact(environment, built.artifact, built.contentSha256, now)
  await markDelivered(environment, job, leaseOwner, built.artifact, built.contentSha256, now)
  return status
}

export async function scheduleReleaseJobs(
  controller: ScheduledControllerLike,
  environment: ReleaseBuilderEnv,
): Promise<void> {
  const nowIso = new Date(controller.scheduledTime).toISOString()
  const limit = boundedInteger(environment.SCHEDULE_BATCH_LIMIT, 20, 1, 100)
  const result = await environment.PIPELINE_DB.prepare(
    `SELECT event.id AS outbox_event_id, job.id AS publication_job_id,
            job.catalog_release_id, event.created_at
       FROM outbox_events event
       JOIN publication_jobs job ON job.id = event.aggregate_id
      WHERE event.event_type = 'catalog.release.requested'
        AND (
          (event.event_status = 'pending' AND event.available_at <= ?1)
          OR (event.event_status = 'processing' AND event.lease_expires_at <= ?1)
        )
      ORDER BY event.created_at, event.id LIMIT ?2`,
  ).bind(nowIso, limit).all<{
    outbox_event_id: string
    publication_job_id: string
    catalog_release_id: string
    created_at: string
  }>()
  if (!result.success) throw new Error(result.error ?? 'release scheduler query failed')
  for (const row of result.results ?? []) {
    await environment.RELEASE_QUEUE.send({
      version: 1,
      outboxEventId: row.outbox_event_id,
      publicationJobId: row.publication_job_id,
      catalogReleaseId: row.catalog_release_id,
      requestedAt: row.created_at,
    })
  }
}

export async function handleQueue(
  batch: QueueMessageBatch<unknown>,
  environment: ReleaseBuilderEnv,
): Promise<void> {
  const maximumAttempts = boundedInteger(environment.MAX_QUEUE_ATTEMPTS, 4, 1, 10)
  for (const message of batch.messages) {
    if (!isReleaseQueueJob(message.body)) {
      await environment.RELEASE_BUILDER_DLQ.send({
        version: 1,
        job: {
          version: 1,
          outboxEventId: 'invalid-message',
          publicationJobId: 'invalid-message',
          catalogReleaseId: 'invalid-message',
          requestedAt: new Date().toISOString(),
        },
        failedAt: new Date().toISOString(),
        attempt: message.attempts,
        code: 'invalid_release_job',
        message: 'Queue message did not match ReleaseQueueJob version 1',
      })
      message.ack()
      continue
    }
    const job = message.body
    try {
      const result = await processReleaseJob(environment, job)
      if (result === 'busy') message.retry({ delaySeconds: 60 })
      else message.ack()
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      const code = error instanceof ReleaseValidationError ? error.code : 'release_builder_runtime_failure'
      const terminal = message.attempts >= maximumAttempts
      const leaseOwnerRow = await first<{ lease_owner: string | null }>(
        environment.PIPELINE_DB,
        'SELECT lease_owner FROM outbox_events WHERE id = ?1',
        job.outboxEventId,
      )
      if (leaseOwnerRow?.lease_owner) {
        await recordFailure(environment, job, leaseOwnerRow.lease_owner, text, terminal, new Date())
      }
      if (terminal) {
        const failure: ReleaseFailure = {
          version: 1,
          job,
          failedAt: new Date().toISOString(),
          attempt: message.attempts,
          code,
          message: text.slice(0, 1_000),
        }
        await environment.RELEASE_BUILDER_DLQ.send(failure)
        message.ack()
      } else {
        message.retry({ delaySeconds: Math.min(3_600, 60 * 2 ** (message.attempts - 1)) })
      }
    }
  }
}

export function handleFetch(request: Request): Response {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json(
      { ok: true, service: 'studyinchina-release-builder', version: SERVICE_VERSION },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    )
  }
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
}

const worker = {
  fetch: handleFetch,
  queue: handleQueue,
  scheduled: scheduleReleaseJobs,
}

export default worker
