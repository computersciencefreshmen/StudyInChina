import { z } from 'zod'
import { maintenanceProposalSchema, officialUrlSchema, sha256Schema as hash, timestampSchema as stamp } from '../../../scripts/maintenance/contracts'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/u)
const integer = z.number().int().nonnegative().safe()
const nullableStamp = stamp.nullable(), nullableHash = hash.nullable()
const code = z.string().min(1).max(240).nullable()
const json = (schema: z.ZodType = z.unknown(), max = 256 * 1024) => z.string().max(max).refine(value => {
  try { return schema.safeParse(JSON.parse(value)).success } catch { return false }
}, 'Invalid bounded JSON')
const host = z.string().regex(/^[a-z0-9.-]{3,253}$/u).refine(value => !value.includes('..'))
export const offlineArtifactKeySchema = z.string().max(1024).regex(/^maintenance\/(?:snapshots\/[a-f0-9]{64}\/[a-f0-9]{64}\.(?:bin|json)|text\/[a-f0-9]{64}\/[a-f0-9]{64}\.txt|models\/[a-f0-9]{64}\/[a-f0-9]{64}\.json|(?:reviews|exports)\/[a-zA-Z0-9_-]{1,200}\/[a-f0-9]{64}\.json|(?:frontiers|discovery-lineage)\/[a-f0-9]{64}\.json|frontier-checkpoints\/[a-f0-9]{64}\/[0-9]{1,8}\.json|extraction-cache\/[a-zA-Z0-9_-]{1,200}(?:\/[a-zA-Z0-9_-]{1,200}){0,3}\.json)$/u)
const key = offlineArtifactKeySchema, nullableKey = key.nullable()

const rowSchemas = {
  maintenance_sources: z.object({ source_id: hash, url: officialUrlSchema, allowed_hosts_json: json(z.array(host).min(1).max(16), 8192),
    category: z.string().regex(/^[a-z_]{1,80}$/u), categories_json: json(z.array(z.string().regex(/^[a-z_]{1,80}$/u)).max(32), 8192),
    enabled: z.union([z.literal(0), z.literal(1)]), interval_hours: integer.min(1).max(2160), due_at: stamp,
    last_attempt_at: nullableStamp, last_success_at: nullableStamp, raw_sha256: nullableHash, canonical_sha256: nullableHash,
    snapshot_key: nullableKey, etag: z.string().max(512).nullable(), failures: integer, error_code: code, discovery_depth: integer.max(2) }).strict(),
  maintenance_source_schools: z.object({ source_id: hash, university_id: id }).strict(),
  maintenance_observations: z.object({ observation_id: id, job_id: id, source_id: hash, checked_at: stamp, final_url: officialUrlSchema,
    http_status: integer.min(100).max(599), raw_sha256: nullableHash, canonical_sha256: nullableHash, snapshot_key: nullableKey,
    content_type: z.string().max(512).nullable(), outcome: z.string().min(1).max(120), candidate_count: integer.max(10000) }).strict(),
  maintenance_jobs: z.object({ job_id: id, source_id: hash, stage: z.enum(['capture', 'extract', 'award', 'maintain']),
    status: z.enum(['queued', 'retry', 'done', 'held', 'unknown']), priority: integer.max(100000), due_at: stamp, created_at: stamp, updated_at: stamp,
    attempt: integer, lease_token: z.null(), lease_until: z.null(), snapshot_sha256: nullableHash, snapshot_key: nullableKey,
    error_code: code, enqueued_at: nullableStamp, target_ids_json: json().nullable() }).strict(),
  maintenance_model_attempts: z.object({ reservation_key: hash, attempt_id: id, source_id: hash, snapshot_sha256: hash,
    pass: z.enum(['primary', 'independent-review']), request_sha256: hash, model: z.literal('MiniMax-M3'),
    status: z.enum(['reserved', 'send_started', 'completed', 'known_failed', 'unknown']), started_at: stamp, completed_at: nullableStamp,
    output_key: nullableKey, output_sha256: nullableHash, usage_json: json().nullable(), quota_json: json(), error_code: code }).strict(),
  maintenance_proposals: z.object({ proposal_id: id, university_id: id, source_id: hash, snapshot_sha256: hash,
    status: z.enum(['ready', 'held', 'exported']), proposal_json: json(maintenanceProposalSchema), created_at: stamp,
    export_id: id.nullable(), acknowledgement_sha256: z.null() }).strict(),
  maintenance_exports: z.object({ batch_id: id, input_catalog_sha256: hash, scope_sha256: hash, object_key: key, sha256: hash,
    created_at: stamp, status: z.literal('prepared'), acknowledgement_sha256: z.null(), acknowledgement_json: z.null() }).strict(),
  maintenance_document_derivatives: z.object({ source_id: hash, raw_sha256: hash, snapshot_key: key, raw_key: key, text_key: key,
    text_sha256: hash, parser: z.enum(['poppler', 'tesseract']), page_count: integer.min(1).max(100), processed_at: stamp }).strict(),
  maintenance_document_failures: z.object({ source_id: hash, raw_sha256: hash, reason: z.string().min(1).max(240), reported_at: stamp }).strict(),
} as const

/** Fixed identifiers only. Callers bind values in this order; incoming SQL/column names are never accepted. */
export const OFFLINE_TABLES = {
  maintenance_sources: { columns: ['source_id', 'url', 'allowed_hosts_json', 'category', 'categories_json', 'enabled', 'interval_hours', 'due_at', 'last_attempt_at', 'last_success_at', 'raw_sha256', 'canonical_sha256', 'snapshot_key', 'etag', 'failures', 'error_code', 'discovery_depth'], primaryKeys: ['source_id'] },
  maintenance_source_schools: { columns: ['source_id', 'university_id'], primaryKeys: ['source_id', 'university_id'] },
  maintenance_observations: { columns: ['observation_id', 'job_id', 'source_id', 'checked_at', 'final_url', 'http_status', 'raw_sha256', 'canonical_sha256', 'snapshot_key', 'content_type', 'outcome', 'candidate_count'], primaryKeys: ['observation_id'] },
  maintenance_jobs: { columns: ['job_id', 'source_id', 'stage', 'status', 'priority', 'due_at', 'created_at', 'updated_at', 'attempt', 'lease_token', 'lease_until', 'snapshot_sha256', 'snapshot_key', 'error_code', 'enqueued_at', 'target_ids_json'], primaryKeys: ['job_id'] },
  maintenance_model_attempts: { columns: ['reservation_key', 'attempt_id', 'source_id', 'snapshot_sha256', 'pass', 'request_sha256', 'model', 'status', 'started_at', 'completed_at', 'output_key', 'output_sha256', 'usage_json', 'quota_json', 'error_code'], primaryKeys: ['attempt_id'] },
  maintenance_proposals: { columns: ['proposal_id', 'university_id', 'source_id', 'snapshot_sha256', 'status', 'proposal_json', 'created_at', 'export_id', 'acknowledgement_sha256'], primaryKeys: ['proposal_id'] },
  maintenance_exports: { columns: ['batch_id', 'input_catalog_sha256', 'scope_sha256', 'object_key', 'sha256', 'created_at', 'status', 'acknowledgement_sha256', 'acknowledgement_json'], primaryKeys: ['batch_id'] },
  maintenance_document_derivatives: { columns: ['source_id', 'raw_sha256', 'snapshot_key', 'raw_key', 'text_key', 'text_sha256', 'parser', 'page_count', 'processed_at'], primaryKeys: ['source_id', 'raw_sha256'] },
  maintenance_document_failures: { columns: ['source_id', 'raw_sha256', 'reason', 'reported_at'], primaryKeys: ['source_id', 'raw_sha256'] },
} as const
export type OfflineTableName = keyof typeof OFFLINE_TABLES

export const offlineRequestReservationSchema = z.object({ reservationKey: hash, state: z.enum(['completed', 'known_failed', 'unknown', 'send_started']),
  attemptId: id, requestSha256: hash, retryable: z.boolean().optional(), notBefore: integer.optional(), attemptCount: integer.min(1).optional(),
}).strict().refine(value => value.state === 'known_failed' || value.retryable !== true, 'Unknown/completed requests cannot become retryable')
export type OfflineRequestReservation = z.infer<typeof offlineRequestReservationSchema>

export const offlineHandoffSchema = z.object({ format: z.literal('studyinchina.offline-maintenance-handoff'), version: z.literal(1), batchId: id,
  scopeRegistrySha256: hash, inputCatalogSha256: hash, seedSha256: hash, legacyGuardSha256: hash,
  artifacts: z.array(z.object({ objectKey: key, sha256: hash, byteLength: integer.max(10 * 1024 * 1024) }).strict()).max(10000),
  tableRows: z.object({
    maintenance_sources: z.array(rowSchemas.maintenance_sources).max(10000), maintenance_source_schools: z.array(rowSchemas.maintenance_source_schools).max(20000),
    maintenance_observations: z.array(rowSchemas.maintenance_observations).max(10000), maintenance_jobs: z.array(rowSchemas.maintenance_jobs).max(10000),
    maintenance_model_attempts: z.array(rowSchemas.maintenance_model_attempts).max(10000), maintenance_proposals: z.array(rowSchemas.maintenance_proposals).max(5000),
    maintenance_exports: z.array(rowSchemas.maintenance_exports).max(100), maintenance_document_derivatives: z.array(rowSchemas.maintenance_document_derivatives).max(10000),
    maintenance_document_failures: z.array(rowSchemas.maintenance_document_failures).max(10000),
  }).strict(), requestReservations: z.array(offlineRequestReservationSchema).max(10000),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  const artifacts = new Map(value.artifacts.map(item => [item.objectKey, item]))
  if (artifacts.size !== value.artifacts.length || value.artifacts.reduce((sum, item) => sum + item.byteLength, 0) > 512 * 1024 * 1024) fail('Duplicate artifacts or handoff size limit')
  let total = 0
  for (const table of Object.keys(OFFLINE_TABLES) as OfflineTableName[]) {
    const rows = value.tableRows[table], primaryKeys = OFFLINE_TABLES[table].primaryKeys
    total += rows.length
    const keys = rows.map(row => JSON.stringify(primaryKeys.map(column => (row as Record<string, unknown>)[column])))
    if (new Set(keys).size !== rows.length) fail(`Duplicate primary key: ${table}`)
  }
  if (total > 50000) fail('Handoff row limit')
  const sources = new Set(value.tableRows.maintenance_sources.map(row => row.source_id))
  const associations = new Set(value.tableRows.maintenance_source_schools.map(row => `${row.source_id}:${row.university_id}`))
  const reference = (objectKey: string | null, expectedHash?: string | null) => {
    if (objectKey !== null && (!artifacts.has(objectKey) || expectedHash && artifacts.get(objectKey)?.sha256 !== expectedHash)) fail('Missing or mismatched immutable artifact')
  }
  for (const table of Object.keys(OFFLINE_TABLES) as OfflineTableName[]) {
    for (const row of value.tableRows[table]) {
      if ('source_id' in row && !sources.has(row.source_id)) fail('Source outside handoff')
      if ('snapshot_key' in row) reference(row.snapshot_key)
    }
  }
  for (const source of value.tableRows.maintenance_sources) {
    const hostname = new URL(source.url).hostname, hosts = JSON.parse(source.allowed_hosts_json) as string[]
    if (!hosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) fail('Source host outside declared boundary')
  }
  const exports = new Map(value.tableRows.maintenance_exports.map(row => [row.batch_id, row]))
  for (const row of exports.values()) {
    if (row.input_catalog_sha256 !== value.inputCatalogSha256 || row.scope_sha256 !== value.scopeRegistrySha256) fail('Export catalogue/scope mismatch')
    reference(row.object_key)
  }
  for (const row of value.tableRows.maintenance_proposals) {
    const proposal = maintenanceProposalSchema.parse(JSON.parse(row.proposal_json))
    if (proposal.id !== row.proposal_id || proposal.universityId !== row.university_id || proposal.source.id !== row.source_id
      || proposal.source.snapshotSha256 !== row.snapshot_sha256 || !associations.has(`${row.source_id}:${row.university_id}`)) fail('Proposal row scope mismatch')
    if (row.status === 'exported' ? !row.export_id || !exports.has(row.export_id) : row.export_id !== null) fail('Proposal export mismatch')
    reference(proposal.source.objectKey, proposal.source.snapshotSha256)
    for (const evidence of proposal.fieldEvidence) reference(evidence.objectKey, evidence.snapshotSha256)
    if (proposal.source.textArtifact) reference(proposal.source.textArtifact.objectKey, proposal.source.textArtifact.sha256)
    if (proposal.review?.artifactKey) reference(proposal.review.artifactKey, proposal.review.reviewArtifactSha256)
  }
  for (const row of value.tableRows.maintenance_model_attempts) {
    if (row.status === 'completed') {
      if (!row.completed_at || !row.output_key || !row.output_sha256) fail('Completed model output missing')
      else reference(row.output_key, row.output_sha256)
    } else if (row.output_key !== null || row.output_sha256 !== null) fail('Unresolved model output cannot imply success')
  }
  for (const row of value.tableRows.maintenance_document_derivatives) { reference(row.raw_key, row.raw_sha256); reference(row.text_key, row.text_sha256) }
  const reservations = new Set<string>()
  const latestAttempts = new Map<string, (typeof value.tableRows.maintenance_model_attempts)[number]>()
  for (const attempt of value.tableRows.maintenance_model_attempts) {
    const old = latestAttempts.get(attempt.reservation_key)
    if (!old || Date.parse(attempt.started_at) > Date.parse(old.started_at) || Date.parse(attempt.started_at) === Date.parse(old.started_at) && attempt.attempt_id > old.attempt_id) latestAttempts.set(attempt.reservation_key, attempt)
  }
  for (const reservation of value.requestReservations) {
    const attempt = value.tableRows.maintenance_model_attempts.find(row => row.attempt_id === reservation.attemptId)
    if (reservations.has(reservation.reservationKey) || !attempt || attempt.reservation_key !== reservation.reservationKey || attempt.request_sha256 !== reservation.requestSha256
      || latestAttempts.get(reservation.reservationKey)?.attempt_id !== reservation.attemptId
      || reservation.state !== attempt.status && !(reservation.state === 'unknown' && ['send_started', 'reserved'].includes(attempt.status))) fail('Reservation attempt binding mismatch')
    if (reservation.retryable && attempt && !['model_http_429', 'stopped_before_send', 'model_not_sent'].includes(attempt.error_code ?? '')) fail('Retryable failure is not definitively unsent/rejected')
    reservations.add(reservation.reservationKey)
  }
  if (reservations.size !== latestAttempts.size || [...latestAttempts.keys()].some(key => !reservations.has(key))) fail('Every model reservation requires its durable no-replay state')
})
export type OfflineHandoff = z.infer<typeof offlineHandoffSchema>
export const OFFLINE_HANDOFF_TABLES = OFFLINE_TABLES
export type OfflineMaintenanceHandoff = OfflineHandoff
