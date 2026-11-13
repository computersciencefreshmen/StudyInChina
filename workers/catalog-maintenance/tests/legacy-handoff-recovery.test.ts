import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ModelAdmission } from '../src/admission'
import { inspectFrozenStorage, recoverHandoffOperation } from '../src/legacy-handoff-recovery'
import { validateLegacyAuxiliaryEntry, validateLegacyOfflineGate } from '../src/legacy-offline-state'
import { handleModelStateMigration, MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { recoverNonTemporalPermits } from '../src/non-temporal-permit-recovery'
import { seed, setControls } from '../src/repository'
import type { DurableStorage } from '../src/types'
import { canonical, digest } from '../src/util'
import { makeEnv, MemoryStorage, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

const now = Date.parse('2026-11-14T06:00:00.000Z'), migrationId = 'legacy-handoff-local-private-test', batchId = 'offline-local-test'
const binding = { migrationId, sourceAccountId: '1'.repeat(32), targetAccountId: '2'.repeat(32), role: 'source' as const }
class Storage extends MemoryStorage {
  writes: string[] = []
  async list<T>(o: { startAfter?: string; limit: number }): Promise<Map<string, T>> { return new Map([...this.values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .filter(([k]) => o.startAfter === undefined || k > o.startAfter).slice(0, o.limit).map(([k, v]) => [k, structuredClone(v) as T])) }
  override async put<T>(key: string, value: T) { this.writes.push(key); return super.put(key, value) }
  override async transaction<T>(f: (s: DurableStorage) => Promise<T>): Promise<T> { return super.transaction(async s => { const before = structuredClone(this.values)
    try { return await f(s) } catch (e) { this.values.clear(); for (const [k, v] of before) this.values.set(k, v); throw e } }) }
}
const dbs: Array<ReturnType<typeof makeEnv>['db']> = []
afterEach(() => { for (const db of dbs.splice(0)) db.sqlite.close() })
async function fixture(count = 4) {
  const f = makeEnv(), storage = new Storage(); dbs.push(f.db); let active = 0, network = 0
  Object.assign(f.env, { MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: 'source', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: binding.sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: binding.targetAccountId })
  const fence = { batchId, phase: 'held_for_handoff', tokenSha256: '3'.repeat(64), scopeRegistrySha256: '4'.repeat(64), inputCatalogSha256: '5'.repeat(64),
    acquiredAt: new Date(now - 86400000).toISOString(), manifestSha256: '6'.repeat(64), releaseRequestedAt: new Date(now - 3600000).toISOString(),
    seedSha256: '7'.repeat(64), legacyGuardSha256: '8'.repeat(64), sourceManifestSha256: '9'.repeat(64), epoch: 1,
    retiredManifests: ['a'.repeat(64)], sourceManifestHistory: ['b'.repeat(64)], rowsStarted: false }
  const gate = { fetches: [{ token: 'PRIVATE-ORIGINAL-HANDOFF-PERMIT', kind: 'handoff', batchId, manifestSha256: fence.manifestSha256, expiresAt: Number.MAX_SAFE_INTEGER }],
    models: [], nextHost: { 'example.edu.cn': now + 5000 }, successes: 6, cooldownUntil: now + 5000, modelLimit: 2, offlineFence: fence }
  storage.values.set(MODEL_STATE_MIGRATION_KEY, { version: 1, ...binding, phase: 'frozen', frozenAt: new Date(now - 121000).toISOString(), pages: [], states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false })
  storage.values.set('gate', gate); storage.values.set(`offline-fence:${batchId}`, structuredClone(fence)); storage.values.set(`offline-adoption:${batchId}`, {})
  for (let i = 0; i < count; i++) storage.values.set(`request:${i.toString(16).padStart(64, '0')}`, { state: ['send_started', 'completed', 'unknown', 'known_failed'][i % 4], attemptId: `original-${i}`, requestSha256: 'c'.repeat(64) })
  const inspect = (pageIndex = 0, expectedStorageSha256?: string) => inspectFrozenStorage(storage, binding, MODEL_STATE_MIGRATION_KEY, { pageIndex, ...(expectedStorageSha256 ? { expectedStorageSha256 } : {}) }, () => active, now)
  const body = async () => { const s = await inspect(); return { migrationId, operationId: 'root-explicit-handoff-operation-v1', expectedGateSha256: await digest(canonical(gate)), expectedLedgerSha256: s.ledgerSha256,
    expectedFenceSha256: await digest(canonical(fence)), expectedHistorySha256: await digest(canonical(fence)), expectedTokenSha256: fence.tokenSha256, batchId, manifestSha256: fence.manifestSha256,
    observedAt: new Date(now).toISOString(), operator: { operatorId: 'root-reviewed-local-test', decision: 'release_quiescent_handoff_operation_preserve_intent', reason: 'Known legacy handoff operation is quiescent; every original intent and request stays unchanged.', reviewedAt: new Date(now).toISOString() } } }
  const recover = (b: Record<string, unknown>, at = now) => recoverHandoffOperation(storage, binding, MODEL_STATE_MIGRATION_KEY, b, () => active, at)
  return { ...f, storage, fence, gate, body, inspect, recover, setActive: (n: number) => { active = n }, network: () => network,
    admission: () => new ModelAdmission({ storage }, f.env, async () => { network++; throw Error('No providers') }) }
}

test('private typed inspection covers every key and does not export or write; reviewed recovery releases only its mutex', async () => {
  const f = await fixture(), before = structuredClone(f.storage.values), s = await f.inspect(), b = await f.body()
  assert.equal(s.entryCount, 8); assert.equal(s.requestCount, 4); assert.equal(s.auxiliaryEntryCount, 2)
  assert.deepEqual(JSON.parse(s.pageBytes).entries.map((e: { key: string }) => e.key), [...before.keys()].sort())
  assert.equal(s.pageSha256, await digest(s.pageBytes)); assert.equal(s.cutoverReady, false); assert.equal(s.modelCalls, false); assert.equal(s.mutation, false)
  assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  await assert.rejects(recoverNonTemporalPermits(f.storage, binding, MODEL_STATE_MIGRATION_KEY, { migrationId, operationId: 'valid-generic-action-must-not-retire-handoff',
    expectedGateSha256: b.expectedGateSha256, expectedRequestLedgerSha256: 'd'.repeat(64), expectedNonTemporalSlots: { fetch: 1, model: 0 }, observedAt: new Date(now).toISOString(),
    operator: { operatorId: 'root-test', decision: 'retire_non_temporal_fetch_slots_preserve_requests', reason: 'A well-formed generic request must still reject the intentional handoff.', reviewedAt: new Date(now).toISOString() } }, () => 0, now), /gate_schema_unknown/)
  const result = await f.recover(b), after = await f.storage.get<Record<string, unknown>>('gate')
  assert.equal(result.intentCompleted, false); assert.equal(result.modelCalls, false); assert.equal(result.requestValuesChanged, false)
  assert.deepEqual(f.storage.writes, ['gate']); assert.deepEqual(after!.offlineFence, f.fence); assert.deepEqual(after!.fetches, [])
  for (const [key, value] of before) if (key !== 'gate') assert.deepEqual(f.storage.values.get(key), value)
  const audit = after!.offlineHandoffOperationRecovery as Record<string, unknown>
  assert.equal(audit.originalGateJson, canonical(f.gate)); assert.deepEqual(audit.originalPermit, f.gate.fetches[0]); assert.equal(audit.beforeLedgerSha256, audit.afterLedgerSha256)
  assert.equal(JSON.stringify(result).includes('PRIVATE-'), false); validateLegacyOfflineGate(after)
  assert.equal((await f.inspect()).ledgerSha256, s.ledgerSha256)
  assert.equal((await f.recover(b, now + 3600000)).reused, true); assert.deepEqual(f.storage.writes, ['gate'])
  await assert.rejects(f.recover({ ...b, operationId: 'new-action-cannot-reset-audit' }), /audit_conflict/)
})

test('complete migration preserves auxiliary records and held intent; activated target still refuses all paid/fetch admissions', async () => {
  const f = await fixture(), b = await f.body(); await f.recover(b)
  const exported = await (await handleModelStateMigration(f.storage, f.env, '/model-state-migration/export', { migrationId, pageIndex: 0 }, 0, now)).json() as Record<string, unknown>
  const manifest = exported.manifest as Record<string, unknown>; assert.equal(manifest.auxiliaryEntryCount, 2); assert.equal(manifest.requestCount, 4); assert.equal(manifest.entryCount, 7)
  const target = new Storage(), env = { ...f.env, MODEL_STATE_MIGRATION_ROLE: 'target', MAINTENANCE_ENABLED: 'false' }
  assert.equal((await handleModelStateMigration(target, env, '/model-state-migration/import', { migrationId, ...exported }, 0, now)).status, 200)
  assert.equal((await handleModelStateMigration(target, env, '/model-state-migration/finalize', { migrationId, manifestSha256: exported.manifestSha256 }, 0, now)).status, 200)
  for (const [key, value] of f.storage.values) if (key !== MODEL_STATE_MIGRATION_KEY) assert.deepEqual(target.values.get(key), value)
  for (const key of ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete (env as Record<string, unknown>)[key]
  let calls = 0; env.PIPELINE_DB = { prepare: () => { calls++; throw Error('Must deny before D1') }, batch: async () => { calls++; return [] } }
  const admission = new ModelAdmission({ storage: target }, env, async () => { calls++; throw Error('Must deny before provider') })
  for (const [path, body] of [['/fetch/acquire', { host: 'example.edu.cn' }], ['/model/run', { reservationKey: 'd'.repeat(64), sourceId: 'e'.repeat(64), snapshotSha256: 'f'.repeat(64), pass: 'primary', lane: 'maintenance', payload: '{}', universityIds: ['school'] }]] as const) {
    const response = await admission.fetch(new Request('https://admission' + path, { method: 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    assert.equal(response.status, 429); assert.match((await response.json() as { error: string }).error, /offline_fenced/)
  }
  assert.equal(calls, 0)
})

test('fresh gate/ledger/fence/history/token/manifest CAS conflicts and held intent changes never release a permit', async () => {
  for (const field of ['expectedGateSha256', 'expectedLedgerSha256', 'expectedFenceSha256', 'expectedHistorySha256', 'expectedTokenSha256', 'manifestSha256', 'batchId']) {
    const f = await fixture(), b = await f.body(), before = structuredClone(f.storage.values)
    await assert.rejects(f.recover({ ...b, [field]: field === 'batchId' ? 'different-batch' : '0'.repeat(64) }))
    assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  }
  for (const kind of ['rows', 'history', 'model', 'another-fetch', 'normal-fetch', 'active', 'young', 'old-observation', 'unknown-key', 'request-extension'] as const) {
    const f = await fixture(), b = await f.body()
    if (kind === 'active') f.setActive(1)
    else if (kind === 'young') { const l = await f.storage.get<Record<string, unknown>>(MODEL_STATE_MIGRATION_KEY); f.storage.values.set(MODEL_STATE_MIGRATION_KEY, { ...l, frozenAt: new Date(now - 119999).toISOString() }) }
    else if (kind === 'old-observation') b.observedAt = new Date(now - 300001).toISOString()
    else if (kind === 'unknown-key') f.storage.values.set('unrecognized-private-category', {})
    else if (kind === 'request-extension') f.storage.values.set(`request:${'0'.repeat(64)}`, { state: 'invalid-future-state', attemptId: 'old', requestSha256: 'a'.repeat(64) })
    else if (kind === 'history') f.storage.values.set(`offline-fence:${batchId}`, { ...f.fence, epoch: 2 })
    else { const g = structuredClone(f.gate)
      if (kind === 'rows') g.offlineFence.rowsStarted = true
      if (kind === 'model') (g.models as unknown[]).push({ token: 'MODEL', expiresAt: Number.MAX_SAFE_INTEGER })
      if (kind === 'another-fetch') g.fetches.push({ ...g.fetches[0], token: 'another' })
      if (kind === 'normal-fetch') (g.fetches as unknown[])[0] = { token: 'normal', host: 'example.edu.cn', expiresAt: now + 60000 }
      f.storage.values.set('gate', g)
    }
    const before = structuredClone(f.storage.values); await assert.rejects(f.recover(b), kind)
    assert.deepEqual(f.storage.values, before); assert.deepEqual(f.storage.writes, [])
  }
})

test('typed full-storage pages bind all values, expose unknown JSON privately but never permit unknown migration/recovery', async () => {
  const f = await fixture(70), first = await f.inspect(), next = await f.inspect(1, first.storageSha256)
  assert.equal(JSON.parse(first.pageBytes).entries.length, 32); assert.equal(JSON.parse(next.pageBytes).entries.length, 32)
  assert.equal(first.storageSha256, next.storageSha256)
  await assert.rejects(f.inspect(1), /inspection_request_invalid/); await assert.rejects(f.inspect(1, '0'.repeat(64)), /hash_conflict/)
  f.storage.values.set('opaque-private-future-key', { unknown: 'privately inspectable' })
  const changed = await f.inspect(); assert.notEqual(changed.storageSha256, first.storageSha256)
  await assert.rejects(f.inspect(1, first.storageSha256), /hash_conflict/)
  const b = await f.body(); await assert.rejects(f.recover(b), /unknown_storage_key/)
  assert.deepEqual(f.storage.writes, [])
  const huge = await fixture(); huge.storage.values.set('opaque-private-future-key', { body: 'x'.repeat(4 * 1024 * 1024) })
  await assert.rejects(huge.inspect(), /entry_too_large/)
  const many = await fixture(4093); await assert.rejects(many.inspect(), /oversized_scan/)
})

test('legacy auxiliary schemas are exact and cannot invent outcomes or ignore unfamiliar fields', async () => {
  const f = await fixture()
  assert.equal(validateLegacyAuxiliaryEntry(`offline-fence:${batchId}`, f.fence), true)
  assert.equal(validateLegacyAuxiliaryEntry(`offline-adoption:${batchId}`, { [`request:${'a'.repeat(64)}`]: { reservationKey: 'a'.repeat(64), state: 'unknown', attemptId: 'uncertain', requestSha256: 'b'.repeat(64) } }), true)
  for (const [key, value] of [[`offline-fence:${batchId}`, { ...f.fence, futureFlag: true }], ['offline-fence:different', f.fence], ['offline-other:future', {}],
    [`offline-adoption:${batchId}`, { [`request:${'a'.repeat(64)}`]: { reservationKey: 'a'.repeat(64), state: 'unknown', retryable: true, attemptId: 'uncertain', requestSha256: 'b'.repeat(64) } }]] as const) assert.throws(() => validateLegacyAuxiliaryEntry(key, value), /invalid/)
})

test('an auxiliary counter is missing-default-zero only; null, strings, negatives and wrong totals cannot import', async () => {
  const f = await fixture(); await f.recover(await f.body())
  const exported = await (await handleModelStateMigration(f.storage, f.env, '/model-state-migration/export', { migrationId, pageIndex: 0 }, 0, now)).json() as Record<string, unknown>
  const env = { ...f.env, MODEL_STATE_MIGRATION_ROLE: 'target', MAINTENANCE_ENABLED: 'false' }
  for (const counter of [null, '2', -1, 0, 3]) {
    const target = new Storage(), manifest = { ...(exported.manifest as object), auxiliaryEntryCount: counter }
    const response = await handleModelStateMigration(target, env, '/model-state-migration/import', { migrationId, ...exported, manifest, manifestSha256: await digest(canonical(manifest)) }, 0, now)
    assert.equal(response.status, 409); assert.equal(target.values.size, 0)
  }
})

test('write/readback races roll back and ordinary cleanup never deletes the intentional mutex', async () => {
  const f = await fixture(), b = await f.body(), before = structuredClone(f.storage.values), put = f.storage.put.bind(f.storage)
  f.storage.put = async (key, value) => { await put(key, value); if (key === 'gate') f.setActive(1) }
  await assert.rejects(f.recover(b)); assert.deepEqual(f.storage.values, before)
  f.setActive(0)
  const env = { ...f.env }; for (const key of ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete (env as Record<string, unknown>)[key]
  f.storage.values.delete(MODEL_STATE_MIGRATION_KEY)
  const admission = new ModelAdmission({ storage: f.storage }, env)
  await admission.fetch(new Request('https://admission/fetch/release', { method: 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ token: f.gate.fetches[0].token }) }))
  assert.deepEqual((await f.storage.get<typeof f.gate>('gate'))!.fetches, f.gate.fetches)
})

test('a legacy fence appearing during quota refresh is checked again atomically before any paid send', async () => {
  const f = await fixture(), env = { ...f.env }; let sends = 0
  for (const key of ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete (env as Record<string, unknown>)[key]
  f.storage.values.clear()
  await seed(env, seedInput()); await setControls(env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  const sourceId = await digest('https://test.edu.cn/catalog'), raw = 'd'.repeat(64)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=? WHERE source_id=?').run(raw, 'e'.repeat(64), sourceId)
  const admission = new ModelAdmission({ storage: f.storage }, env, async url => {
    if (String(url).includes('token_plan')) { f.storage.values.set('gate', { ...f.gate, fetches: [] }); return quotaResponse() }
    sends++; throw Error('No model may pass a newly acquired legacy fence')
  })
  const response = await admission.fetch(new Request('https://admission/model/run', { method: 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationKey: 'f'.repeat(64), sourceId, snapshotSha256: raw, pass: 'primary', lane: 'maintenance', payload: '{}', universityIds: ['uni-000'] }) }))
  assert.equal(response.status, 429); assert.equal((await response.json() as { error: string }).error, 'model_capacity_or_reserved')
  assert.equal(sends, 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  assert.deepEqual((await f.storage.get<typeof f.gate>('gate'))!.offlineFence, f.fence)
  assert.equal(f.storage.values.has(`request:${'f'.repeat(64)}`), false)
})

test('an unfamiliar or falsy stored offline fence cannot silently enable default admissions', async () => {
  const f = await fixture(), env = { ...f.env }; let external = 0
  for (const key of ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete (env as Record<string, unknown>)[key]
  f.storage.values.delete(MODEL_STATE_MIGRATION_KEY)
  env.PIPELINE_DB = { prepare: () => { external++; throw Error('No D1 before fence denial') }, batch: async () => { external++; return [] } }
  const admission = new ModelAdmission({ storage: f.storage }, env, async () => { external++; throw Error('No provider') })
  for (const offlineFence of [null, false, 0, undefined]) {
    f.storage.values.set('gate', { ...f.gate, offlineFence })
    const response = await admission.fetch(new Request('https://admission/fetch/acquire', { method: 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ host: 'example.edu.cn' }) }))
    assert.equal(response.status, 429); assert.equal((await response.json() as { error: string }).error, 'fetch_capacity_offline_fenced')
  }
  assert.equal(external, 0)
})
