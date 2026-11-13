import { isDailyD1QuotaError } from '../../catalog-maintenance/src/backend-errors'
import { sha256Hex } from './hash'
import type { IngestionEnv, R2ObjectBody } from './types'

// Exactly migration 0023. This is not an arbitrary SQL or migration endpoint.
// A test compares these statements with the versioned migration byte-for-byte
// after removing comments and insignificant whitespace.
export const READ_BUDGET_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_ingestion_sources_url_owner
  ON ingestion_sources (
    json_extract(manifest_json, '$.officialUrl'),
    json_extract(manifest_json, '$.institutionId'),
    enabled, source_id
  );`,
  `CREATE INDEX IF NOT EXISTS idx_ingestion_sources_school_source
  ON ingestion_sources (json_extract(manifest_json, '$.institutionId'), source_id);`,
  `CREATE INDEX IF NOT EXISTS idx_source_discoveries_pending_due
  ON source_discoveries (
    discovery_status, source_role, julianday(updated_at), institution_id, discovery_id
  )
  WHERE registered_source_id IS NULL;`,
] as const

export const D1_QUOTA_WAIT_KEY = 'maintenance/runtime/d1-quota-wait.v1.json'
export const READ_BUDGET_RECEIPT_KEY = 'ingestion/runtime/read-budget-indexes/0023.v1.json'
const MAX_RECEIPT_BYTES = 4096
const jsonMetadata = { contentType: 'application/json' }
type Environment = Pick<IngestionEnv, 'INGESTION_DB' | 'SNAPSHOTS_BUCKET'>
type QuotaWait = { format: 'studyinchina.d1-quota-wait'; version: 1; observedAt: string; retryAt: string }
type IndexReceipt = {
  format: 'studyinchina.ingestion-read-budget-indexes'
  version: 1
  migration: '0023'
  schemaSha256: string
  installedAt: string
}
export type ReadBudgetPreflight = { state: 'ready'; indexes: 'installed' | 'already_installed' }
  | { state: 'quota_wait'; retryAt: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function nextReset(now: number): string {
  const date = new Date(now)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString()
}

function quotaWait(value: unknown, now: number): QuotaWait | null {
  const row = record(value)
  const observed = Date.parse(String(row?.observedAt ?? ''))
  const retry = Date.parse(String(row?.retryAt ?? ''))
  return row?.format === 'studyinchina.d1-quota-wait' && row.version === 1
    && Number.isFinite(observed) && observed <= now && retry > now && row.retryAt === nextReset(observed)
    ? row as QuotaWait : null
}

function etag(object: R2ObjectBody): string | null {
  return 'etag' in object && typeof object.etag === 'string' && object.etag.length > 0 ? object.etag : null
}

async function readJson(env: Environment, key: string): Promise<{ object: R2ObjectBody; value: unknown } | null> {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object) return null
  if ('size' in object && typeof object.size === 'number' && object.size > MAX_RECEIPT_BYTES) {
    throw new Error('ingestion_read_budget_receipt_too_large')
  }
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new Error('ingestion_read_budget_receipt_too_large')
  return { object, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
}

function validReceipt(value: unknown, schemaSha256: string, now: number): boolean {
  const row = record(value)
  const installed = Date.parse(String(row?.installedAt ?? ''))
  return row?.format === 'studyinchina.ingestion-read-budget-indexes' && row.version === 1
    && row.migration === '0023' && row.schemaSha256 === schemaSha256
    && Number.isFinite(installed) && installed <= now
}

/** Preserve a newer shared wait even if another isolate writes while DDL fails. */
async function rememberQuotaWait(env: Environment, observedAt: string, attemptedAt: number): Promise<QuotaWait | null> {
  const now = Date.parse(observedAt)
  const wait: QuotaWait = { format: 'studyinchina.d1-quota-wait', version: 1, observedAt, retryAt: nextReset(now) }
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await readJson(env, D1_QUOTA_WAIT_KEY)
    const previousObserved = Date.parse(String(record(previous?.value)?.observedAt ?? ''))
    const previousValue = record(previous?.value)
    // A read/write recovery completed after this DDL request began. Its later
    // proof wins even if an old in-flight quota error reaches us afterwards.
    if (previousValue?.format === 'studyinchina.d1-quota-recovery' && previousValue.version === 1
      && Number.isFinite(previousObserved) && previousObserved >= attemptedAt) return null
    // An overlapping isolate may already have observed a later failure. Do not
    // replace that newer receipt merely because our captured clock is earlier.
    const existing = previous ? quotaWait(previous.value, Math.max(now, previousObserved || now)) : null
    if (existing && existing.observedAt >= observedAt) return existing
    const previousEtag = previous ? etag(previous.object) : null
    if (previous && !previousEtag) throw new Error('ingestion_read_budget_quota_etag_unavailable')
    const options = { httpMetadata: jsonMetadata,
      onlyIf: previousEtag ? { etagMatches: previousEtag } : { etagDoesNotMatch: '*' } }
    const saved = await env.SNAPSHOTS_BUCKET.put(D1_QUOTA_WAIT_KEY, JSON.stringify(wait), options)
    if (saved !== null) return wait
  }
  throw new Error('ingestion_read_budget_quota_receipt_conflict')
}

/** Runs before the scheduler heartbeat, so a cached daily wait performs no D1
 * read or write. After recovery, all three fixed indexes are one atomic batch;
 * only its successful completion can produce a reusable R2 receipt. */
export async function ensureReadBudgetIndexes(
  env: Environment,
  clock: () => Date = () => new Date(),
): Promise<ReadBudgetPreflight> {
  const now = clock().getTime()
  if (!Number.isFinite(now)) throw new Error('ingestion_read_budget_clock_invalid')
  const cachedWait = await readJson(env, D1_QUOTA_WAIT_KEY)
  const waiting = cachedWait ? quotaWait(cachedWait.value, now) : null
  if (waiting) return { state: 'quota_wait', retryAt: waiting.retryAt }

  const schemaSha256 = await sha256Hex(READ_BUDGET_INDEXES_SQL.join('\n'))
  const previous = await readJson(env, READ_BUDGET_RECEIPT_KEY)
  if (previous) {
    if (!validReceipt(previous.value, schemaSha256, now)) throw new Error('ingestion_read_budget_receipt_invalid')
    return { state: 'ready', indexes: 'already_installed' }
  }
  const attemptedAt = clock().getTime()
  try {
    const results = await env.INGESTION_DB.batch(READ_BUDGET_INDEXES_SQL.map(sql => env.INGESTION_DB.prepare(sql)))
    if (results.length !== READ_BUDGET_INDEXES_SQL.length || results.some(result => !result.success)) {
      throw new Error(results.find(result => !result.success)?.error ?? 'ingestion_read_budget_index_batch_failed')
    }
  } catch (error) {
    if (!isDailyD1QuotaError(error)) throw error
    const wait = await rememberQuotaWait(env, clock().toISOString(), attemptedAt)
    if (!wait) throw error
    return { state: 'quota_wait', retryAt: wait.retryAt }
  }

  const receipt: IndexReceipt = { format: 'studyinchina.ingestion-read-budget-indexes', version: 1,
    migration: '0023', schemaSha256, installedAt: clock().toISOString() }
  const options = { httpMetadata: jsonMetadata, onlyIf: { etagDoesNotMatch: '*' } }
  await env.SNAPSHOTS_BUCKET.put(READ_BUDGET_RECEIPT_KEY, JSON.stringify(receipt), options)
  // A lost receipt write (including a concurrent installer) never claims ready
  // until the exact durable schema receipt is observed. Reinstalling is safe.
  const saved = await readJson(env, READ_BUDGET_RECEIPT_KEY)
  if (!saved || !validReceipt(saved.value, schemaSha256, clock().getTime())) {
    throw new Error('ingestion_read_budget_receipt_not_persisted')
  }
  return { state: 'ready', indexes: 'installed' }
}
