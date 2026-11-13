import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import worker from '../src/index'
import { sha256Hex } from '../src/hash'
import {
  D1_QUOTA_WAIT_KEY,
  ensureReadBudgetIndexes,
  READ_BUDGET_INDEXES_SQL,
  READ_BUDGET_RECEIPT_KEY,
} from '../src/read-budget-indexes'
import type { IngestionEnv } from '../src/types'
import { discoveryDatabase, discoveryEnvironment } from './discovery-fixtures'

const NOW = '2026-11-13T07:00:00.000Z'
const clock = () => new Date(NOW)
const dailyError = 'D1_ERROR: daily database rows read quota exceeded'
const indexNames = ['idx_ingestion_sources_url_owner', 'idx_ingestion_sources_school_source', 'idx_source_discoveries_pending_due']
type PutOptions = { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }

class Bucket {
  objects = new Map<string, { body: string; etag: string }>()
  writes: string[] = []
  sequence = 0
  failReceipt = false
  beforePut?: (key: string) => void
  seed(key: string, value: unknown) {
    this.objects.set(key, { body: JSON.stringify(value), etag: String(++this.sequence) })
  }
  async get(key: string) {
    const item = this.objects.get(key)
    if (!item) return null
    const bytes = new TextEncoder().encode(item.body)
    return { etag: item.etag, size: bytes.byteLength, async arrayBuffer() { return bytes.buffer }, customMetadata: {} }
  }
  async head() { return null }
  async delete() { throw new Error('Quota waits and migration receipts must not be deleted') }
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: PutOptions) {
    this.beforePut?.(key)
    if (this.failReceipt && key === READ_BUDGET_RECEIPT_KEY) throw new Error('R2 unavailable')
    const old = this.objects.get(key)
    if ((options?.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches)
      || (options?.onlyIf?.etagDoesNotMatch === '*' && old)) return null
    assert.equal(typeof value, 'string')
    this.objects.set(key, { body: value as string, etag: String(++this.sequence) })
    this.writes.push(key)
    return {}
  }
}

function wait(observedAt = NOW) {
  const date = new Date(observedAt)
  return { format: 'studyinchina.d1-quota-wait', version: 1, observedAt,
    retryAt: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString() }
}

function fixture() {
  const db = discoveryDatabase()
  for (const name of indexNames) db.exec(`DROP INDEX ${name}`)
  const base = discoveryEnvironment(db)
  const bucket = new Bucket()
  const calls = { prepare: 0, batch: 0, sent: 0 }
  const env: IngestionEnv = { ...base, SNAPSHOTS_BUCKET: bucket,
    INGESTION_DB: {
      prepare(sql) { calls.prepare++; return base.INGESTION_DB.prepare(sql) },
      async batch(statements) { calls.batch++; return base.INGESTION_DB.batch(statements) },
    },
    INGESTION_QUEUE: { async send() { calls.sent++ } },
  }
  const installed = () => db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name IN (?,?,?) ORDER BY name").all(...indexNames)
  return { db, bucket, calls, env, installed }
}

test('the only executable DDL exactly matches migration 0023 and remains idempotent', () => {
  const migration = readFileSync('infra/d1/pipeline/migrations/0023_ingestion_read_budget_indexes.sql', 'utf8')
  const normalize = (sql: string) => sql.replace(/--[^\n]*/gu, '').replace(/\s+/gu, ' ').trim()
  assert.equal(normalize(migration), normalize(READ_BUDGET_INDEXES_SQL.join('\n')))
  assert.equal(READ_BUDGET_INDEXES_SQL.length, 3)
  const f = fixture()
  try {
    f.db.exec(migration)
    f.db.exec(migration)
    assert.deepEqual(f.installed().map(row => row.name).sort(), [...indexNames].sort())
  } finally { f.db.close() }
})

test('an active shared quota wait prevents DDL, heartbeat, scheduling and all D1 access', async () => {
  const f = fixture()
  try {
    // Worker uses the actual wall clock; helper additionally exercises a fixed reset boundary.
    const realWait = wait(new Date().toISOString())
    f.bucket.seed(D1_QUOTA_WAIT_KEY, realWait)
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.UTC(2026, 10, 12) }, f.env)
    assert.deepEqual(f.calls, { prepare: 0, batch: 0, sent: 0 })
    assert.equal(f.bucket.writes.length, 0)
    f.bucket.seed(D1_QUOTA_WAIT_KEY, wait())
    assert.deepEqual(await ensureReadBudgetIndexes(f.env, clock), { state: 'quota_wait', retryAt: '2026-11-14T00:00:00.000Z' })
    assert.deepEqual(f.calls, { prepare: 0, batch: 0, sent: 0 })
  } finally { f.db.close() }
})

test('after reset one atomic batch installs all indexes before the exact durable receipt', async () => {
  const f = fixture()
  try {
    const oldWait = wait('2026-11-12T07:00:00.000Z')
    f.bucket.seed(D1_QUOTA_WAIT_KEY, oldWait)
    f.bucket.beforePut = key => { if (key === READ_BUDGET_RECEIPT_KEY) assert.equal(f.installed().length, 3) }
    assert.deepEqual(await ensureReadBudgetIndexes(f.env, clock), { state: 'ready', indexes: 'installed' })
    assert.equal(f.calls.batch, 1)
    assert.equal(f.calls.prepare, 3)
    const receipt = JSON.parse(f.bucket.objects.get(READ_BUDGET_RECEIPT_KEY)!.body)
    assert.equal(receipt.schemaSha256, await sha256Hex(READ_BUDGET_INDEXES_SQL.join('\n')))
    assert.equal(receipt.installedAt, NOW)
    assert.deepEqual(JSON.parse(f.bucket.objects.get(D1_QUOTA_WAIT_KEY)!.body), oldWait)
    assert.deepEqual(f.bucket.writes, [READ_BUDGET_RECEIPT_KEY])
    await ensureReadBudgetIndexes(f.env, clock)
    assert.equal(f.calls.batch, 1)
    assert.equal(f.calls.prepare, 3, 'a valid receipt performs no schema query')
  } finally { f.db.close() }
})

test('an installed receipt never bypasses a later shared quota wait', async () => {
  const f = fixture()
  try {
    await ensureReadBudgetIndexes(f.env, clock)
    f.bucket.seed(D1_QUOTA_WAIT_KEY, wait())
    assert.equal((await ensureReadBudgetIndexes(f.env, clock)).state, 'quota_wait')
    assert.equal(f.calls.batch, 1)
    assert.equal(f.calls.prepare, 3)
  } finally { f.db.close() }
})

test('a late DDL failure rolls the whole SQLite batch back and saves no completion receipt', async () => {
  const f = fixture()
  try {
    f.db.exec(`CREATE TABLE ${indexNames[1]} (collision TEXT)`)
    await assert.rejects(ensureReadBudgetIndexes(f.env, clock), /already a table/iu)
    assert.equal(f.calls.batch, 1)
    assert.equal(f.installed().length, 0)
    assert.equal(f.bucket.writes.length, 0)
  } finally { f.db.close() }
})

for (const returnedFailure of [false, true]) {
  test(`a ${returnedFailure ? 'returned' : 'thrown'} proven daily quota failure persists the shared wait`, async () => {
    const f = fixture()
    try {
      f.env.INGESTION_DB.batch = async () => {
        f.calls.batch++
        if (!returnedFailure) throw new Error(dailyError)
        return [{ success: false, error: dailyError }]
      }
      const expected = { state: 'quota_wait', retryAt: '2026-11-14T00:00:00.000Z' }
      assert.deepEqual(await ensureReadBudgetIndexes(f.env, clock), expected)
      assert.deepEqual(JSON.parse(f.bucket.objects.get(D1_QUOTA_WAIT_KEY)!.body), wait())
      assert.equal(f.bucket.objects.has(READ_BUDGET_RECEIPT_KEY), false)
      assert.deepEqual(await ensureReadBudgetIndexes(f.env, clock), expected)
      assert.equal(f.calls.batch, 1)
      assert.equal(f.calls.prepare, 3)
    } finally { f.db.close() }
  })
}

test('numeric 7500 or an ordinary SQL error never becomes a false daily quota wait', async () => {
  for (const message of ['D1_ERROR: 7500', 'no such table: ingestion_sources']) {
    const f = fixture()
    try {
      f.env.INGESTION_DB.batch = async () => { throw new Error(message) }
      await assert.rejects(ensureReadBudgetIndexes(f.env, clock), error => error instanceof Error && error.message === message)
      assert.equal(f.bucket.writes.length, 0)
    } finally { f.db.close() }
  }
})

test('a receipt-storage crash can safely reinstall without claiming incomplete work succeeded', async () => {
  const f = fixture()
  try {
    f.bucket.failReceipt = true
    await assert.rejects(ensureReadBudgetIndexes(f.env, clock), /R2 unavailable/u)
    assert.equal(f.installed().length, 3)
    assert.equal(f.bucket.objects.has(READ_BUDGET_RECEIPT_KEY), false)
    f.bucket.failReceipt = false
    assert.equal((await ensureReadBudgetIndexes(f.env, clock)).state, 'ready')
    assert.equal(f.calls.batch, 2)
    assert.equal(f.installed().length, 3)
  } finally { f.db.close() }
})

test('concurrent installers use IF NOT EXISTS and accept only the same durable receipt', async () => {
  const f = fixture()
  try {
    const outcomes = await Promise.all([ensureReadBudgetIndexes(f.env, clock), ensureReadBudgetIndexes(f.env, clock)])
    assert.equal(outcomes.every(result => result.state === 'ready'), true)
    assert.equal(f.installed().length, 3)
    assert.equal(f.bucket.writes.filter(key => key === READ_BUDGET_RECEIPT_KEY).length, 1)
  } finally { f.db.close() }
})

test('quota-wait CAS preserves a newer overlapping observation instead of overwriting it', async () => {
  const f = fixture()
  try {
    f.env.INGESTION_DB.batch = async () => { throw new Error(dailyError) }
    const newer = wait('2026-11-13T07:00:01.000Z')
    let raced = false
    f.bucket.beforePut = key => {
      if (key === D1_QUOTA_WAIT_KEY && !raced) { raced = true; f.bucket.seed(key, newer) }
    }
    assert.deepEqual(await ensureReadBudgetIndexes(f.env, clock), { state: 'quota_wait', retryAt: newer.retryAt })
    assert.deepEqual(JSON.parse(f.bucket.objects.get(D1_QUOTA_WAIT_KEY)!.body), newer)
    assert.equal(f.bucket.writes.length, 0)
  } finally { f.db.close() }
})

for (const raceDuringCas of [false, true]) {
  test(`a newer recovery ${raceDuringCas ? 'during CAS' : 'during DDL'} wins over an old delayed quota failure`, async () => {
    const f = fixture()
    try {
      const recovery = { format: 'studyinchina.d1-quota-recovery', version: 1,
        observedAt: '2026-11-13T07:00:01.000Z', previousWaitSha256: 'a'.repeat(64),
        receiptKey: `maintenance/runtime/backend-rechecks/${'b'.repeat(64)}.json`, receiptSha256: 'b'.repeat(64) }
      const original = new Error(dailyError)
      let delayedFailure = false
      f.env.INGESTION_DB.batch = async () => {
        f.calls.batch++
        if (!raceDuringCas) f.bucket.seed(D1_QUOTA_WAIT_KEY, recovery)
        delayedFailure = true
        throw original
      }
      // Error delivery is later than both request start and successful recovery;
      // compare recovery with the DDL start, not with catch-time wall clock.
      const delayedClock = () => new Date(delayedFailure ? '2026-11-13T07:00:02.000Z' : NOW)
      let raced = false
      f.bucket.beforePut = key => {
        if (raceDuringCas && key === D1_QUOTA_WAIT_KEY && !raced) { raced = true; f.bucket.seed(key, recovery) }
      }
      await assert.rejects(ensureReadBudgetIndexes(f.env, delayedClock), error => error === original)
      assert.deepEqual(JSON.parse(f.bucket.objects.get(D1_QUOTA_WAIT_KEY)!.body), recovery)
      assert.equal(f.bucket.objects.has(READ_BUDGET_RECEIPT_KEY), false)
      assert.equal(f.bucket.writes.length, 0)
      // The next real attempt may retry normally; a recovery is not an index receipt.
      const base = discoveryEnvironment(f.db)
      f.env.INGESTION_DB.batch = statements => base.INGESTION_DB.batch(statements)
      assert.deepEqual(await ensureReadBudgetIndexes(f.env, delayedClock), { state: 'ready', indexes: 'installed' })
      assert.equal(f.installed().length, 3)
    } finally { f.db.close() }
  })
}

test('corrupt or mismatched completion receipts fail closed without a D1 probe', async () => {
  const f = fixture()
  try {
    f.bucket.seed(READ_BUDGET_RECEIPT_KEY, { migration: '0023', schemaSha256: 'wrong' })
    await assert.rejects(ensureReadBudgetIndexes(f.env, clock), /receipt_invalid/u)
    assert.equal(f.calls.prepare, 0)
  } finally { f.db.close() }
})

test('the indexes replace source ownership scans and range-filter the weekly discovery cooldown', () => {
  const f = fixture()
  try {
    f.db.exec(READ_BUDGET_INDEXES_SQL.join('\n'))
    const explain = (sql: string, ...values: Array<string | number>) => f.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => String(row.detail)).join('\n')
    const owner = explain(`SELECT source_id,enabled FROM ingestion_sources
      WHERE json_extract(manifest_json,'$.institutionId')=?1 AND json_extract(manifest_json,'$.officialUrl')=?2
      ORDER BY source_id LIMIT 1`, 'school', 'https://example.edu.cn/')
    assert.match(owner, /SEARCH ingestion_sources USING (?:COVERING )?INDEX idx_ingestion_sources_(?:url_owner|school_source)/u)
    assert.doesNotMatch(owner, /SCAN ingestion_sources/u)
    assert.match(explain(`SELECT 1 FROM ingestion_sources other WHERE other.enabled=1
      AND json_extract(other.manifest_json,'$.officialUrl')=?1
      AND json_extract(other.manifest_json,'$.institutionId')<>?2`, 'https://example.edu.cn/', 'school'), /SEARCH other USING COVERING INDEX idx_ingestion_sources_url_owner/u)
    assert.match(explain(`SELECT COUNT(*) FROM ingestion_sources WHERE source_id GLOB 'auto-discovery-*'
      AND json_extract(manifest_json,'$.institutionId')=?1`, 'school'), /SEARCH ingestion_sources USING COVERING INDEX idx_ingestion_sources_school_source.*source_id>/u)
    assert.match(explain(`SELECT discovery_id FROM source_discoveries WHERE registered_source_id IS NULL
      AND source_role='program_catalog' AND discovery_status='stale'
      AND julianday(updated_at)<=julianday(?1)-7`, NOW), /SEARCH source_discoveries USING INDEX idx_source_discoveries_pending_due.*<expr></u)
  } finally { f.db.close() }
})
