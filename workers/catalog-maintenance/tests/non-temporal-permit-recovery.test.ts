import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ModelAdmission } from '../src/admission'
import { handleFetch } from '../src/index'
import { handleModelStateMigration, MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { MAX_TEMPORAL_MILLISECONDS, recoverNonTemporalPermits, requestLedgerSummary } from '../src/non-temporal-permit-recovery'
import type { DurableStorage } from '../src/types'
import { canonical, digest, gateRequest } from '../src/util'
import { makeEnv, MemoryStorage } from './fixture'

const now = Date.parse('2026-11-14T04:00:00.000Z'), migrationId = 'non-temporal-private-local-test'
const binding = { migrationId, sourceAccountId: '1'.repeat(32), targetAccountId: '2'.repeat(32), role: 'source' as const }
class Storage extends MemoryStorage {
  writes: string[] = []
  private recoveryTurn = Promise.resolve()
  async list<T>(options: { startAfter?: string; limit: number }): Promise<Map<string, T>> {
    return new Map([...this.values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key]) => options.startAfter === undefined || key > options.startAfter)
      .slice(0, options.limit).map(([key, value]) => [key, structuredClone(value) as T]))
  }
  override async put<T>(key: string, value: T) { this.writes.push(key); await super.put(key, value) }
  override async transaction<T>(body: (txn: DurableStorage) => Promise<T>): Promise<T> {
    const previousTurn = this.recoveryTurn; let release!: () => void
    this.recoveryTurn = new Promise<void>(resolve => { release = resolve }); await previousTurn
    const before = structuredClone(this.values)
    try { return await body(this) } catch (error) { this.values.clear(); for (const [key, value] of before) this.values.set(key, value); throw error } finally { release() }
  }
}
const databases: Array<ReturnType<typeof makeEnv>['db']> = []
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close() })
async function fixture(requests = 4) {
  let modelCalls = 0, active = 0
  const f = makeEnv(async () => { modelCalls++; throw Error('No external request is allowed') }), storage = new Storage()
  databases.push(f.db)
  Object.assign(f.env, { MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: 'source',
    MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: binding.sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: binding.targetAccountId })
  const lock = { version: 1, ...binding, phase: 'frozen', frozenAt: new Date(now - 120000).toISOString(), pages: [], states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false }
  const originalGate = { fetches: [{ token: 'PRIVATE-ANOMALOUS-FETCH', host: 'private.edu.cn', expiresAt: Number.MAX_SAFE_INTEGER }, { token: 'PRIVATE-EXPIRED-FETCH', expiresAt: now }],
    models: [{ token: 'PRIVATE-EXPIRED-MODEL', lane: 'expansion', expiresAt: now - 1 }],
    nextHost: { 'private.edu.cn': now + 50000 }, successes: 7, cooldownUntil: now + 90000, modelLimit: 3 }
  await storage.put(MODEL_STATE_MIGRATION_KEY, lock); await storage.put('gate', originalGate)
  const states = ['send_started', 'completed', 'unknown', 'known_failed']
  for (let index = 0; index < requests; index++) {
    const state = states[index % 4], attemptId = `original-attempt-${index}`
    await storage.put(`request:${index.toString(16).padStart(64, '0')}`, { state, attemptId, requestSha256: 'a'.repeat(64), attemptCount: 7,
      ...(state === 'known_failed' ? { retryable: true, notBefore: now + 1000 } : {}),
      ...(state === 'completed' ? { result: { attemptId, output: { PRIVATE_ORIGINAL_TEXT: '中文 original evidence', numberValue: 0 }, artifactKey: 'maintenance/models/original.json', artifactSha256: 'b'.repeat(64), reused: false } } : {}) })
  }
  storage.writes.length = 0
  const summary = () => requestLedgerSummary(storage, binding, MODEL_STATE_MIGRATION_KEY, () => active, now)
  const body = async () => { const s = await summary(); return { migrationId, operationId: 'root-reviewed-local-action-v1', expectedGateSha256: s.gateSha256!, expectedRequestLedgerSha256: s.requestLedgerSha256,
    expectedNonTemporalSlots: { fetch: 1, model: 0 }, observedAt: s.observedAt,
    operator: { operatorId: 'root-independent-review', decision: 'retire_non_temporal_fetch_slots_preserve_requests' as const, reason: 'Actual non-temporal fetch slots were independently observed; no request outcome is changed.', reviewedAt: new Date(now).toISOString() } } }
  const recover = (value: unknown, at = now) => recoverNonTemporalPermits(storage, binding, MODEL_STATE_MIGRATION_KEY, value, () => active, at)
  const admission = new ModelAdmission({ storage }, f.env, async () => { modelCalls++; throw Error('No external request is allowed') })
  f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => admission.fetch(request) }) }
  return { ...f, storage, lock, originalGate, summary, body, recover, modelCalls: () => modelCalls, setActive: (value: number) => { active = value } }
}
const immutableState = (storage: Storage) => new Map([...storage.values].filter(([key]) => key !== 'gate'))

test('summary is complete and read-only; a reviewed recovery changes only gate and retains the full original audit', async () => {
  const f = await fixture(), all = structuredClone(f.storage.values), s = await f.summary()
  assert.equal(s.complete, true); assert.equal(s.eligible, true); assert.equal(s.requestCount, 4); assert.equal(s.storageEntries, 6)
  assert.deepEqual(s.requestStates, { send_started: 1, completed: 1, unknown: 1, known_failed: 1 }); assert.equal(s.gateSha256, await digest(canonical(f.originalGate)))
  assert.deepEqual(f.storage.values, all); assert.deepEqual(f.storage.writes, [])
  const before = immutableState(f.storage), body = await f.body(), result = await f.recover(body), stored = await f.storage.get<Record<string, unknown>>('gate')
  assert.equal(result.reused, false); assert.equal(result.requestLedgerSha256, s.requestLedgerSha256); assert.equal(result.sourceUnlocked, false)
  assert.deepEqual(immutableState(f.storage), before); assert.deepEqual(f.storage.writes, ['gate'])
  const audit = stored!.nonTemporalFetchPermitRecovery as Record<string, unknown>
  assert.equal(audit.originalGateJson, canonical(f.originalGate)); assert.equal(audit.originalGateSha256, s.gateSha256)
  assert.deepEqual(audit.operator, body.operator); assert.equal(audit.beforeRequestLedgerSha256, audit.afterRequestLedgerSha256)
  assert.deepEqual(audit.removedSlots, [{ kind: 'fetch', index: 0, permit: f.originalGate.fetches[0] }])
  assert.deepEqual({ ...stored, nonTemporalFetchPermitRecovery: undefined }, { ...f.originalGate, fetches: [f.originalGate.fetches[1]], nonTemporalFetchPermitRecovery: undefined })
  for (const marker of ['PRIVATE-', 'private.edu.cn', 'request:', '中文 original evidence', body.operator.reason]) assert.equal(JSON.stringify([s, result]).includes(marker), false)
  assert.equal(f.modelCalls(), 0)
})
test('same operation and preimage hashes are idempotent, including a later lost-response retry; a new id cannot overwrite audit', async () => {
  const f = await fixture(), body = await f.body(), first = await f.recover(body), before = structuredClone(f.storage.values)
  const second = await f.recover(body, now + 3600000)
  assert.equal(second.reused, true); assert.equal(second.gateSha256, first.gateSha256); assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, ['gate'])
  await assert.rejects(f.recover({ ...body, operationId: 'different-operation-v2' }), /operation_conflict/)
  await assert.rejects(f.recover({ ...body, operator: { ...body.operator, reason: 'Different decision cannot overwrite history.' } }), /operation_conflict/)
  assert.deepEqual(f.storage.values, before)
})
test('concurrent identical actions commit once and a competing operation cannot reuse its authorization', async () => {
  const f = await fixture(), body = await f.body(), results = await Promise.all([f.recover(body), f.recover(body)])
  assert.deepEqual(results.map(r => r.reused).sort(), [false, true]); assert.deepEqual(f.storage.writes, ['gate'])
  await assert.rejects(f.recover({ ...body, operationId: 'another-concurrent-root-action' }), /operation_conflict/)
})
test('fresh gate and complete request-ledger hash conflicts never write a gate', async () => {
  for (const kind of ['gate', 'request', 'nested-result-value'] as const) {
    const f = await fixture(), body = await f.body()
    if (kind === 'gate') f.storage.values.set('gate', { ...f.originalGate, successes: 6 })
    else { const key = `request:${'1'.padStart(64, '0')}`, value = await f.storage.get<Record<string, unknown>>(key)
      if (kind === 'request') value!.state = 'unknown'
      else ((value!.result as Record<string, unknown>).output as Record<string, unknown>).numberValue = 1
      f.storage.values.set(key, value)
    }
    const before = structuredClone(f.storage.values)
    await assert.rejects(f.recover(body), /gate_conflict|request_ledger_conflict/); assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  }
})
test('normal future permits, the exact Date maximum, active operations and young freezes remain stopped', async () => {
  for (const kind of ['future', 'future-model', 'date-maximum', 'active', 'young'] as const) {
    const f = await fixture(), body = await f.body()
    if (kind === 'active') f.setActive(1)
    else if (kind === 'young') f.storage.values.set(MODEL_STATE_MIGRATION_KEY, { ...f.lock, frozenAt: new Date(now - 119999).toISOString() })
    else { const value = structuredClone(f.originalGate)
      if (kind === 'future-model') value.models[0].expiresAt = now + 1
      else value.fetches[1].expiresAt = kind === 'future' ? now + 1 : MAX_TEMPORAL_MILLISECONDS
      f.storage.values.set('gate', value); body.expectedGateSha256 = await digest(canonical(value)) }
    const before = structuredClone(f.storage.values)
    await assert.rejects(f.recover(body), /normal_permits_active|active_operations|freeze_too_young/); assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  }
})
test('any non-temporal model permit requires separate review; this action never changes models', async () => {
  const f = await fixture(), body = await f.body(), value = structuredClone(f.originalGate)
  value.models[0].expiresAt = Number.MAX_SAFE_INTEGER; f.storage.values.set('gate', value)
  body.expectedGateSha256 = await digest(canonical(value))
  assert.equal((await f.summary()).eligible, false)
  const before = structuredClone(f.storage.values)
  await assert.rejects(f.recover(body), /model_permit_requires_separate_review/)
  await assert.rejects(f.recover({ ...body, expectedNonTemporalSlots: { fetch: 1, model: 1 } }), /explicit_fresh_operator_decision_required/)
  assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
})
test('wrong role, id, unknown lock shape or any started export cannot perform recovery', async () => {
  for (const kind of ['role', 'id', 'pages', 'phase', 'manifest', 'missing'] as const) {
    const f = await fixture(), body = await f.body()
    if (kind === 'role') await assert.rejects(recoverNonTemporalPermits(f.storage, { ...binding, role: 'target' }, MODEL_STATE_MIGRATION_KEY, body, () => 0, now), /unsealed_source_freeze_required/)
    else if (kind === 'id') await assert.rejects(f.recover({ ...body, migrationId: 'different-migration-id' }), /explicit_fresh_operator_decision_required/)
    else { const l = { ...f.lock, ...(kind === 'phase' ? { phase: 'exporting' } : kind === 'pages' ? { pages: [{}] } : { manifestSha256: 'a'.repeat(64) }) }
      if (kind === 'missing') f.storage.values.delete(MODEL_STATE_MIGRATION_KEY); else f.storage.values.set(MODEL_STATE_MIGRATION_KEY, l)
      await assert.rejects(f.recover(body), /unsealed_source_freeze_required|incomplete_or_changed_scan/)
    }
    assert.deepEqual(f.storage.writes, [])
  }
})
test('unknown KV categories and request/gate/permit extensions or nonfinite values hold the complete scan', async () => {
  for (const kind of ['key', 'request', 'gate', 'permit', 'negative', 'infinity', 'undefined', 'negative-zero'] as const) {
    const f = await fixture(), body = await f.body()
    if (kind === 'key') f.storage.values.set('PRIVATE-UNRECOGNIZED-KEY', { private: 'must not be disclosed' })
    else if (kind === 'request') { const key = `request:${'0'.repeat(64)}`, r = await f.storage.get<Record<string, unknown>>(key); f.storage.values.set(key, { ...r, futureUnknownEnvelope: true }) }
    else if (kind === 'negative-zero') { const key = `request:${'1'.padStart(64, '0')}`, value = await f.storage.get<Record<string, unknown>>(key)
      const output = (value!.result as Record<string, unknown>).output as Record<string, unknown>
      output.numberValue = -0
      f.storage.values.set(key, value)
    } else { const value = structuredClone(f.originalGate) as Record<string, unknown>
      if (kind === 'gate') value.futureGateField = true
      else { const permits = value.fetches as Array<Record<string, unknown>>; if (kind === 'permit') permits[0].unknownMeaning = true
        else if (kind === 'undefined') permits[0].host = undefined
        else permits[0].expiresAt = kind === 'negative' ? -1 : Infinity }
      f.storage.values.set('gate', value)
    }
    const before = structuredClone(f.storage.values)
    await assert.rejects(f.recover(body), /unknown_storage_key_category|schema_unknown|non_json_value/); assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  }
})
test('a truncated or unordered storage enumeration cannot produce a complete summary or mutation', async () => {
  for (const kind of ['truncated', 'unordered'] as const) {
    const f = await fixture(), body = await f.body(), list = f.storage.list.bind(f.storage); let first = true
    f.storage.list = async <T>(options: { startAfter?: string; limit: number }) => { const rows = await list<T>(options); if (!first) return rows; first = false
      return new Map(kind === 'truncated' ? [...rows].slice(0, 1) : [...rows].reverse()) }
    await assert.rejects(f.recover(body), /incomplete_or_unordered_scan/); assert.deepEqual(f.storage.writes, [])
  }
})
test('entry and byte limits stop without truncating the ledger, and a too-large full gate audit is never written', async () => {
  const tooMany = await fixture(4095)
  await assert.rejects(tooMany.summary(), /ledger_entry_limit/); assert.deepEqual(tooMany.storage.writes, [])
  const huge = await fixture(), key = `request:${'1'.padStart(64, '0')}`, value = await huge.storage.get<Record<string, unknown>>(key)
  const output = (value!.result as Record<string, unknown>).output as Record<string, unknown>
  output.large = 'x'.repeat(9 * 1024 * 1024)
  huge.storage.values.set(key, value); await assert.rejects(huge.summary(), /ledger_byte_limit/)
  const largeGate = await fixture(), g = { ...largeGate.originalGate, fetches: Array.from({ length: 64 }, (_, i) => ({ token: `${i}-` + 'p'.repeat(498), host: 'h'.repeat(190) + '.edu.cn', expiresAt: Number.MAX_VALUE })) }
  largeGate.storage.values.set('gate', g); const body = await largeGate.body(); body.expectedNonTemporalSlots.fetch = 64
  await assert.rejects(largeGate.recover(body), /gate_audit_too_large/); assert.deepEqual(largeGate.storage.writes, [])
})
test('a gate write/readback failure or an operation becoming active rolls the whole transaction back', async () => {
  for (const kind of ['write', 'active-after-write', 'ledger-after-write'] as const) {
    const f = await fixture(), body = await f.body(), before = structuredClone(f.storage.values), put = f.storage.put.bind(f.storage)
    f.storage.put = async (key, value) => { await put(key, value)
      if (kind === 'write') throw Error('simulated write acknowledgment loss')
      if (kind === 'active-after-write') f.setActive(1)
      if (kind === 'ledger-after-write') f.storage.values.set(`request:${'0'.repeat(64)}`, { state: 'unknown', attemptId: 'changed', requestSha256: 'c'.repeat(64) })
    }
    await assert.rejects(f.recover(body), /simulated|atomic_readback_conflict/); assert.deepEqual(f.storage.values, before)
  }
})
test('HTTP requires authentication and a dedicated explicit operator body; no normal request or status recovers automatically', async () => {
  const f = await fixture(), body = await f.body(), path = '/model-state-migration/non-temporal-fetch-permit-recovery'
  f.storage.values.set(MODEL_STATE_MIGRATION_KEY, { ...f.lock, frozenAt: new Date(Date.now() - 120000).toISOString() })
  assert.equal((await handleFetch(new Request('https://worker' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), f.env)).status, 401)
  const headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }
  assert.equal((await handleFetch(new Request('https://worker/model-state-migration/ledger-summary', { headers }), f.env)).status, 200)
  assert.equal((await handleModelStateMigration(f.storage, f.env, '/model-state-migration/export', { migrationId, pageIndex: 0 }, 0, now)).status, 409)
  assert.equal((await gateRequest(f.env, '/fetch/acquire', { host: 'other.edu.cn' })).status, 409)
  assert.equal((await gateRequest(f.env, path, { migrationId })).status, 409)
  assert.deepEqual(f.storage.writes, [])
  assert.equal(f.modelCalls(), 0)
})
