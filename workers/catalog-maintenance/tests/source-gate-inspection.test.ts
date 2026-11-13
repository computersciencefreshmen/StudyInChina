import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ModelAdmission } from '../src/admission'
import { handleFetch } from '../src/index'
import { handleModelStateMigration, MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { inspectFrozenSourceGate, requestLedgerSummary } from '../src/non-temporal-permit-recovery'
import { canonical, digest } from '../src/util'
import { makeEnv, MemoryStorage } from './fixture'

const now = Date.parse('2026-11-14T05:00:00.000Z'), migrationId = 'private-gate-inspection-test'
const binding = { migrationId, role: 'source' as const, sourceAccountId: '1'.repeat(32), targetAccountId: '2'.repeat(32) }
class Storage extends MemoryStorage {
  reads: string[] = []; writes = 0; deletes = 0; lists = 0
  override async get<T>(key: string) { this.reads.push(key); return super.get<T>(key) }
  override async put<T>(key: string, value: T) { this.writes++; return super.put(key, value) }
  override async delete(key: string) { this.deletes++; return super.delete(key) }
  async list<T>(): Promise<Map<string, T>> { this.lists++; throw Error('Inspection must never enumerate request history') }
}
const databases: Array<ReturnType<typeof makeEnv>['db']> = []
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close() })
function fixture() {
  const f = makeEnv(), storage = new Storage(); databases.push(f.db)
  let active = 0, calls = 0
  Object.assign(f.env, { MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: 'source', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: binding.sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: binding.targetAccountId })
  const lock = { version: 1, ...binding, phase: 'frozen', frozenAt: new Date(now - 121000).toISOString(), pages: [],
    states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false }
  const gate = { fetches: [{ token: 'PRIVATE-ORIGINAL-PERMIT', expiresAt: Number.MAX_SAFE_INTEGER }], models: [],
    nextHost: { 'PRIVATE-NON-HOST-KEY': now + 10000 }, successes: 0, cooldownUntil: 0, modelLimit: 2,
    unknownPrivateExtension: { private: 'PRIVATE-UNKNOWN-GATE-CONTENT', negativeZero: -0 } }
  storage.values.set(MODEL_STATE_MIGRATION_KEY, structuredClone(lock)); storage.values.set('gate', structuredClone(gate))
  storage.values.set(`request:${'a'.repeat(64)}`, { private: 'PRIVATE-REQUEST-MUST-NOT-BE-READ' })
  const admission = new ModelAdmission({ storage }, f.env, async () => { calls++; throw Error('Inspection must not call providers') })
  f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => admission.fetch(request) }) }
  const inspect = () => inspectFrozenSourceGate(storage, binding, MODEL_STATE_MIGRATION_KEY, () => active, now)
  return { ...f, storage, gate, lock, inspect, calls: () => calls, setActive: (value: number) => { active = value } }
}

test('private inspection reads only lock and the full bounded gate; it never interprets or changes a rejected schema', async () => {
  const f = fixture(), before = structuredClone(f.storage.values), result = await f.inspect()
  assert.equal(result.canonicalGateJson, canonical(f.gate)); assert.equal(result.gateSha256, await digest(canonical(f.gate)))
  assert.equal(result.gateByteLength, new TextEncoder().encode(result.canonicalGateJson).length); assert.equal(result.negativeZeroValueCount, 1)
  assert.equal(result.cutoverReady, false); assert.equal(result.modelCalls, false); assert.equal(result.mutation, false); assert.equal(result.sourceUnlocked, false)
  assert.equal(result.state, 'frozen'); assert.equal(result.pageCount, 0); assert.equal(result.activeOperations, 0)
  assert.deepEqual(f.storage.reads, [MODEL_STATE_MIGRATION_KEY, 'gate']); assert.equal(f.storage.lists, 0)
  assert.equal(f.storage.writes, 0); assert.equal(f.storage.deletes, 0); assert.deepEqual(f.storage.values, before)
  assert.equal(f.calls(), 0); assert.equal(JSON.stringify(result).includes('PRIVATE-REQUEST-MUST-NOT-BE-READ'), false)
  assert.equal((await handleModelStateMigration(f.storage, f.env, '/model-state-migration/status', {}, 0, now)).status, 200)
  assert.equal((await handleModelStateMigration(f.storage, f.env, '/model-state-migration/export', { migrationId, pageIndex: 0 }, 0, now)).status, 409)
  assert.deepEqual(f.storage.values, before, 'the original export hasInflight guard remains unchanged')
})

test('only authenticated external GET can receive private state; other methods and ordinary status do not expose it', async () => {
  const f = fixture(), path = '/model-state-migration/gate-inspection', headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` }
  const before = structuredClone(f.storage.values)
  assert.equal((await handleFetch(new Request('https://worker' + path), f.env)).status, 401); assert.deepEqual(f.storage.reads, [])
  const wrongMethod = await handleFetch(new Request('https://worker' + path, { method: 'POST', headers }), f.env)
  assert.equal(wrongMethod.status, 404); assert.deepEqual(f.storage.reads, [])
  const response = await handleFetch(new Request('https://worker' + path, { headers }), f.env)
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json() as { canonicalGateJson: string }).canonicalGateJson, canonical(f.gate))
  const status = await handleFetch(new Request('https://worker/model-state-migration/status', { headers }), f.env)
  assert.equal(JSON.stringify(await status.json()).includes('PRIVATE-'), false)
  assert.deepEqual(f.storage.values, before); assert.equal(f.storage.writes, 0); assert.equal(f.storage.lists, 0); assert.equal(f.calls(), 0)
})

test('target, unmatched binding, missing/changed lock or a started export cannot inspect a gate', async () => {
  for (const kind of ['target', 'id', 'account', 'missing', 'phase', 'pages', 'manifest'] as const) {
    const f = fixture()
    if (kind === 'target') f.env.MODEL_STATE_MIGRATION_ROLE = 'target'
    else if (kind === 'id') f.env.MODEL_STATE_MIGRATION_ID = 'different-private-migration'
    else if (kind === 'account') f.env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID = '3'.repeat(32)
    else if (kind === 'missing') f.storage.values.delete(MODEL_STATE_MIGRATION_KEY)
    else f.storage.values.set(MODEL_STATE_MIGRATION_KEY, { ...f.lock, ...(kind === 'phase' ? { phase: 'exported' } : kind === 'pages' ? { pages: [{}] } : { manifestSha256: 'a'.repeat(64) }) })
    const response = await handleModelStateMigration(f.storage, f.env, '/model-state-migration/gate-inspection', { migrationId: f.env.MODEL_STATE_MIGRATION_ID }, 0, now)
    assert.equal(response.status, 409, kind); assert.equal(JSON.stringify(await response.json()).includes('PRIVATE-'), false)
    assert.equal(f.storage.reads.includes('gate'), false, kind); assert.equal(f.storage.writes, 0); assert.equal(f.storage.lists, 0)
  }
})

test('a live operation before the read or appearing during it prevents private inspection without mutation', async () => {
  for (const later of [false, true]) {
    const f = fixture()
    if (!later) f.setActive(1)
    else {
      const get = f.storage.get.bind(f.storage)
      f.storage.get = async <T>(key: string) => { const value = await get<T>(key); if (key === 'gate') f.setActive(1); return value }
    }
    await assert.rejects(f.inspect(), /active_operations/)
    assert.equal(f.storage.writes, 0); assert.equal(f.storage.deletes, 0); assert.equal(f.storage.lists, 0); assert.equal(f.calls(), 0)
  }
})

test('oversized or non-JSON gates hold without truncation, mutation or a raw error message', async () => {
  for (const value of [{ payload: '中'.repeat(23000) }, { invalidNumber: Infinity }, { invalidValue: undefined }, undefined]) {
    const f = fixture(); f.storage.values.set('gate', value)
    const before = structuredClone(f.storage.values)
    const response = await handleModelStateMigration(f.storage, f.env, '/model-state-migration/gate-inspection', { migrationId }, 0, now)
    assert.equal(response.status, 409); assert.equal(JSON.stringify(await response.json()).includes('canonicalGateJson'), false)
    assert.deepEqual(f.storage.values, before); assert.equal(f.storage.writes, 0); assert.equal(f.storage.lists, 0)
  }
})

test('inspection does not relax the separate recovery schema or enumerate even an unknown request envelope', async () => {
  const f = fixture()
  await f.inspect()
  await assert.rejects(requestLedgerSummary(f.storage, binding, MODEL_STATE_MIGRATION_KEY, () => 0, now), /must never enumerate/)
  assert.equal(f.storage.writes, 0)
})
