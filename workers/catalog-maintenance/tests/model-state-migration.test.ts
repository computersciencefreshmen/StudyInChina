import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelAdmission } from '../src/admission'
import { handleFetch } from '../src/index'
import { assertModelStateBusinessOpen, handleModelStateMigration, MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { seed, setControls } from '../src/repository'
import type { DurableStorage, MaintenanceEnv, ModelRequest } from '../src/types'
import { canonical, digest, gateRequest } from '../src/util'
import { makeEnv, MemoryStorage, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

const migrationId = 'gmail-account-migration-test', sourceAccountId = '1'.repeat(32), targetAccountId = '2'.repeat(32)
class Storage extends MemoryStorage {
  readonly limits: number[] = []
  async list<T>(options: { startAfter?: string; limit: number }): Promise<Map<string, T>> {
    this.limits.push(options.limit)
    return new Map([...this.values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .filter(([key]) => options.startAfter === undefined || key > options.startAfter).slice(0, options.limit).map(([key, value]) => [key, structuredClone(value) as T]))
  }
  override async transaction<T>(body: (txn: DurableStorage) => Promise<T>): Promise<T> {
    return super.transaction(async txn => {
      const previous = structuredClone(this.values)
      try { return await body(txn) } catch (error) { this.values.clear(); for (const [key, value] of previous) this.values.set(key, value); throw error }
    })
  }
}
function configure(env: MaintenanceEnv, role: 'source' | 'target') {
  Object.assign(env, { MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: role,
    MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: targetAccountId })
  if (role === 'target') env.MAINTENANCE_ENABLED = 'false'
}
function unconfigure(env: MaintenanceEnv) {
  delete env.MODEL_STATE_MIGRATION_ID; delete env.MODEL_STATE_MIGRATION_ROLE
  delete env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID; delete env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID
}
const gate = () => ({ fetches: [], models: [], nextHost: { 'old.edu.cn': Date.now() + 50000 }, successes: 5, cooldownUntil: Date.now() + 50000, modelLimit: 1, retainedField: { version: 'future-compatible' } })
function reservation(index: number, state = 'unknown') {
  return { key: `request:${index.toString(16).padStart(64, '0')}`, value: { state, attemptId: `old-attempt-${index}`, requestSha256: 'a'.repeat(64), retryable: state === 'known_failed', notBefore: 123456789, attemptCount: 7, retainedField: ['original', index] } }
}
function fixture(role?: 'source' | 'target') {
  const f = makeEnv(), storage = new Storage()
  if (role) configure(f.env, role)
  return { ...f, storage }
}
const call = (f: ReturnType<typeof fixture>, path: string, body: Record<string, unknown> = {}, active = 0, now = Date.now()) =>
  handleModelStateMigration(f.storage, f.env, `/model-state-migration/${path}`, { migrationId, ...body }, active, now)
async function exported(f: ReturnType<typeof fixture>) {
  assert.equal((await call(f, 'freeze')).status, 200)
  const pages: Array<{ pageBytes: string; pageSha256: string }> = []
  let result: { state: string; pageBytes: string; pageSha256: string; nextPageIndex: number | null; manifest: unknown; manifestSha256: string }
  do {
    const response = await call(f, 'export', { pageIndex: pages.length })
    result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); pages.push(result)
  } while (result.nextPageIndex !== null)
  return { pages, manifest: result.manifest, manifestSha256: result.manifestSha256 }
}
async function importAll(f: ReturnType<typeof fixture>, data: Awaited<ReturnType<typeof exported>>) {
  for (const page of data.pages) {
    const response = await call(f, 'import', { ...page, manifest: data.manifest, manifestSha256: data.manifestSha256 })
    assert.equal(response.status, 200, await response.clone().text())
  }
}

test('migration is opt-in, bound to role/id/accounts, and both HTTP layers require admin authentication', async () => {
  const f = fixture(), admission = new ModelAdmission({ storage: f.storage }, f.env)
  try {
    assert.equal((await (await call(f, 'freeze')).json()).error, 'model_state_migration_disabled')
    assert.equal(f.storage.values.size, 0)
    configure(f.env, 'source'); f.env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID = sourceAccountId
    assert.equal((await (await call(f, 'freeze')).json()).error, 'model_state_migration_configuration_invalid')
    configure(f.env, 'target')
    assert.equal((await (await call(f, 'freeze')).json()).error, 'model_state_migration_role_mismatch')
    configure(f.env, 'source')
    assert.equal((await (await call(f, 'freeze', { migrationId: 'different-migration' })).json()).error, 'model_state_migration_id_mismatch')
    assert.equal((await admission.fetch(new Request('https://admission/model-state-migration/freeze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 401)
    assert.equal((await handleFetch(new Request('https://worker/model-state-migration/status'), f.env)).status, 401)
    let called = ''
    f.env.MODEL_ADMISSION = { idFromName(name) { called = name; return name }, get: () => ({ fetch: request => admission.fetch(request) }) }
    const response = await handleFetch(new Request('https://worker/model-state-migration/status', { headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` } }), f.env)
    assert.equal(response.status, 200); assert.equal(called, 'subscription-account-v1')
    assert.equal((await response.text()).includes('test-only-subscription'), false)
  } finally { f.db.sqlite.close() }
})

test('frozen source exports every gate/reservation field in bounded canonical pages with stable retries', async () => {
  const f = fixture('source')
  try {
    const originalGate = gate(); await f.storage.put('gate', originalGate)
    for (let i = 0; i < 70; i++) { const entry = reservation(i, ['unknown', 'send_started', 'completed', 'known_failed'][i % 4]); await f.storage.put(entry.key, entry.value) }
    const data = await exported(f), manifest = data.manifest as { entryCount: number; requestCount: number; states: Record<string, number>; pages: unknown[] }
    assert.equal(data.pages.length, 3); assert.equal(manifest.entryCount, 71); assert.equal(manifest.requestCount, 70)
    assert.deepEqual(manifest.states, { send_started: 18, completed: 17, unknown: 18, known_failed: 17 })
    assert.equal(await digest(canonical(data.manifest)), data.manifestSha256)
    const entries = data.pages.flatMap(p => (JSON.parse(p.pageBytes) as { entries: Array<{ key: string; value: unknown }> }).entries)
    assert.equal(entries.length, 71); assert.deepEqual(entries[0], { key: 'gate', value: originalGate })
    for (let i = 0; i < data.pages.length; i++) {
      assert.equal(canonical(JSON.parse(data.pages[i].pageBytes)), data.pages[i].pageBytes)
      const repeated = await (await call(f, 'export', { pageIndex: i })).json()
      assert.equal(repeated.pageBytes, data.pages[i].pageBytes); assert.equal(repeated.manifestSha256, data.manifestSha256)
      assert.equal(repeated.nextPageIndex, i + 1 < data.pages.length ? i + 1 : null, 'restarting a relay at page zero must enumerate every already-exported page')
    }
    assert.ok(f.storage.limits.length > 0); assert.ok(f.storage.limits.every(n => n === 34))
    unconfigure(f.env); await assert.rejects(assertModelStateBusinessOpen(f.storage, f.env), /model_state_migration_locked/)
    assert.equal(f.bucket.objects.size, 0, 'raw migration state must not enter readable R2 artifacts')
  } finally { f.db.sqlite.close() }
})

test('source persists freeze while permits drain, rejects export/inflight and blocks all new permits', async () => {
  const f = fixture('source'), admission = new ModelAdmission({ storage: f.storage }, f.env), now = Date.now()
  try {
    await f.storage.put('gate', { ...gate(), fetches: [{ token: 'inflight-fetch', host: 'old.edu.cn', expiresAt: now + 1000 }] })
    assert.equal((await call(f, 'freeze', {}, 0, now)).status, 409)
    assert.ok(f.storage.values.has(MODEL_STATE_MIGRATION_KEY))
    assert.equal((await call(f, 'export', { pageIndex: 0 }, 0, now)).status, 409)
    const request = (path: string, body: unknown) => admission.fetch(new Request(`https://admission${path}`, { method: 'POST', headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    assert.equal((await (await request('/fetch/acquire', { host: 'new.edu.cn' })).json()).error, 'model_state_migration_locked')
    assert.equal((await request('/fetch/release', { token: 'inflight-fetch' })).status, 200)
    assert.equal((await call(f, 'export', { pageIndex: 0 }, 1, now + 2000)).status, 409, 'active operations still block an expired permit window')
    assert.equal((await call(f, 'export', { pageIndex: 0 }, 0, now + 2000)).status, 200)
    assert.equal((await request('/fetch/release', { token: 'late-release' })).status, 409, 'sealed snapshot cannot change')
  } finally { f.db.sqlite.close() }
})

test('unknown DO keys fail explicitly instead of silently producing a partial manifest', async () => {
  const f = fixture('source')
  try {
    await f.storage.put('unexpected-history', { retained: true }); await call(f, 'freeze')
    const result = await call(f, 'export', { pageIndex: 0 })
    assert.equal((await result.json()).error, 'model_state_migration_unknown_key')
    assert.equal((await (await call(f, 'status')).json()).state, 'frozen')
  } finally { f.db.sqlite.close() }
})

test('a malformed existing gate cannot roll back the durable source freeze', async () => {
  const f = fixture('source')
  try {
    await f.storage.put('gate', { unexpected: 'uninterpretable original state' })
    assert.equal((await (await call(f, 'freeze')).json()).error, 'model_state_migration_gate_invalid')
    assert.equal((await (await call(f, 'status')).json()).error, 'model_state_migration_gate_invalid')
    assert.ok(f.storage.values.has(MODEL_STATE_MIGRATION_KEY))
    unconfigure(f.env); await assert.rejects(assertModelStateBusinessOpen(f.storage, f.env), /model_state_migration_locked/)
  } finally { f.db.sqlite.close() }
})

test('read-only diagnostics distinguish future permits from operations without revealing private gate fields', async () => {
  const f = fixture('source'), now = Date.parse('2026-11-14T17:30:00.000Z')
  try {
    const original = { ...gate(), fetches: [{ token: 'PRIVATE-FETCH-TOKEN', host: 'PRIVATE-HOST.edu.cn', expiresAt: now + 86400000 }, { token: 'expired', expiresAt: now }],
      models: [{ token: 'PRIVATE-MODEL-TOKEN', expiresAt: now + 172800000 }] }
    await f.storage.put('gate', original)
    const freeze = await call(f, 'freeze', {}, 0, now), body = await freeze.json()
    assert.equal(freeze.status, 409)
    const expected = { activeOperations: 0, serverTime: '2026-11-14T17:30:00.000Z', activeFetchPermitCount: 1,
      activeModelPermitCount: 1, latestPermitExpiresAt: '2026-11-16T17:30:00.000Z' }
    for (const [key, value] of Object.entries(expected)) assert.equal(body[key], value)
    const snapshot = canonical([...f.storage.values])
    const status = await (await call(f, 'status', {}, 0, now)).json()
    for (const [key, value] of Object.entries(expected)) assert.equal(status[key], value)
    assert.equal(canonical([...f.storage.values]), snapshot, 'status neither cleans permits nor changes the frozen lock')
    assert.deepEqual(await f.storage.get('gate'), original)
    for (const privateValue of ['PRIVATE-FETCH-TOKEN', 'PRIVATE-MODEL-TOKEN', 'PRIVATE-HOST.edu.cn', 'retainedField', 'nextHost']) assert.equal(JSON.stringify([body, status]).includes(privateValue), false)
    assert.equal((await call(f, 'export', { pageIndex: 0 }, 0, now)).status, 409)
    for (const expiresAt of [Number.MAX_VALUE, -1]) {
      await f.storage.put('gate', { ...gate(), fetches: [{ token: 'invalid', expiresAt }] })
      assert.equal((await (await call(f, 'status', {}, 1, now)).json()).error, 'model_state_migration_gate_invalid')
      assert.equal((await (await call(f, 'freeze', {}, 1, now)).json()).error, 'model_state_migration_gate_invalid')
    }
  } finally { f.db.sqlite.close() }
})

test('target requires disabled empty storage and never overwrites an existing request', async () => {
  const s = fixture('source'), t = fixture('target')
  try {
    const entry = reservation(1); await s.storage.put(entry.key, entry.value); const data = await exported(s)
    const admission = new ModelAdmission({ storage: t.storage }, t.env)
    const release = await admission.fetch(new Request('https://admission/fetch/release', { method: 'POST', headers: { authorization: `Bearer ${t.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: '{"token":"old-delivery"}' }))
    assert.equal(release.status, 409); assert.equal(t.storage.values.size, 0, 'a late release must not initialize target storage before import')
    t.env.MAINTENANCE_ENABLED = 'true'
    assert.equal((await (await call(t, 'import', { ...data.pages[0], ...data })).json()).error, 'model_state_migration_target_must_be_disabled')
    t.env.MAINTENANCE_ENABLED = 'false'; await t.storage.put(entry.key, { ...entry.value, state: 'completed' })
    assert.equal((await (await call(t, 'import', { ...data.pages[0], ...data })).json()).error, 'model_state_migration_target_not_empty')
    assert.equal((await t.storage.get<{ state: string }>(entry.key))?.state, 'completed')
  } finally { s.db.sqlite.close(); t.db.sqlite.close() }
})

test('target import is ordered, canonical, hash-bound, idempotent and incomplete state remains locked without env', async () => {
  const s = fixture('source'), t = fixture('target')
  try {
    for (let i = 0; i < 40; i++) { const entry = reservation(i); await s.storage.put(entry.key, entry.value) }
    const data = await exported(s), payload = (i: number) => ({ ...data.pages[i], manifest: data.manifest, manifestSha256: data.manifestSha256 })
    assert.equal((await (await call(t, 'import', payload(1))).json()).error, 'model_state_migration_page_out_of_order')
    assert.equal(t.storage.values.size, 0)
    assert.equal((await (await call(t, 'import', { ...payload(0), pageBytes: `${data.pages[0].pageBytes} ` })).json()).error, 'model_state_migration_page_invalid')
    assert.equal((await call(t, 'import', payload(0))).status, 200)
    assert.equal((await (await call(t, 'import', payload(0))).json()).reused, true)
    unconfigure(t.env); await assert.rejects(assertModelStateBusinessOpen(t.storage, t.env), /model_state_migration_locked/)
    configure(t.env, 'target')
    assert.equal((await (await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).json()).error, 'model_state_migration_incomplete')
    const changed = structuredClone(data.manifest) as { frozenAt: string }; changed.frozenAt = '2026-01-01T00:00:00.000Z'
    assert.equal((await (await call(t, 'import', { ...payload(0), manifest: changed, manifestSha256: await digest(canonical(changed)) })).json()).error, 'model_state_migration_manifest_conflict')
    await importAll(t, data)
    await t.storage.put(reservation(0).key, { ...reservation(0).value, state: 'completed' })
    assert.equal((await (await call(t, 'import', payload(0))).json()).error, 'model_state_migration_entry_conflict')
    assert.equal((await (await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).json()).error, 'model_state_migration_target_changed')
  } finally { s.db.sqlite.close(); t.db.sqlite.close() }
})

test('finalize rescans the complete target, detects extra keys, preserves cooldown and accepts exact late retries', async () => {
  const s = fixture('source'), t = fixture('target')
  try {
    const originalGate = gate(); await s.storage.put('gate', originalGate)
    await s.storage.put(reservation(1, 'known_failed').key, reservation(1, 'known_failed').value)
    const data = await exported(s); await importAll(t, data)
    await t.storage.put('unaccounted-key', {})
    assert.equal((await (await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).json()).error, 'model_state_migration_unknown_key')
    await t.storage.delete('unaccounted-key')
    assert.equal((await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).status, 200)
    assert.equal((await (await call(t, 'import', { ...data.pages[0], ...data })).json()).reused, true)
    assert.equal((await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).status, 200)
    assert.deepEqual(await t.storage.get('gate'), originalGate)
    const admission = new ModelAdmission({ storage: t.storage }, t.env)
    assert.equal((await admission.fetch(new Request('https://admission/fetch/release', { method: 'POST', headers: { authorization: `Bearer ${t.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: '{"token":"late-delivery"}' }))).status, 409)
    assert.deepEqual(await t.storage.get('gate'), originalGate)
    await assert.rejects(assertModelStateBusinessOpen(t.storage, t.env), /model_state_migration_locked/)
    unconfigure(t.env); await assert.doesNotReject(assertModelStateBusinessOpen(t.storage, t.env))
    assert.equal(t.bucket.objects.size, 0); assert.equal(t.messages.length, 0)
  } finally { s.db.sqlite.close(); t.db.sqlite.close() }
})

test('empty source migrates explicitly and inconsistent content/manifest counts cannot finalize', async () => {
  const s = fixture('source'), t = fixture('target')
  try {
    const data = await exported(s)
    assert.equal((data.manifest as { entryCount: number }).entryCount, 0)
    await importAll(t, data); assert.equal((await call(t, 'finalize', { manifestSha256: data.manifestSha256 })).status, 200)
    const changed = structuredClone(data.manifest) as { requestCount: number }; changed.requestCount = 1
    assert.equal((await (await call(t, 'import', { ...data.pages[0], manifest: changed, manifestSha256: await digest(canonical(changed)) })).json()).error, 'model_state_migration_manifest_invalid')
  } finally { s.db.sqlite.close(); t.db.sqlite.close() }
})

for (const count of [31, 32, 33, 63, 64, 65]) test(`complete multi-page migration at ${count} reservations preserves the exact set and manifest`, async () => {
  const s = fixture('source'), t = fixture('target')
  try {
    for (let i = 0; i < count; i++) { const entry = reservation(i); await s.storage.put(entry.key, entry.value) }
    const data = await exported(s); await importAll(t, data)
    const finalized = await call(t, 'finalize', { manifestSha256: data.manifestSha256 })
    assert.equal(finalized.status, 200, await finalized.clone().text())
    const original = [...s.storage.values].filter(([key]) => key !== MODEL_STATE_MIGRATION_KEY)
    const restored = [...t.storage.values].filter(([key]) => key !== MODEL_STATE_MIGRATION_KEY)
    assert.deepEqual(restored, original)
    assert.equal((await finalized.json()).requestCount, count)
  } finally { s.db.sqlite.close(); t.db.sqlite.close() }
})

test('freeze drains an already paid model even after permit TTL, then exports its completed result', async () => {
  let release!: () => void, started!: () => void, modelCalls = 0
  const waiting = new Promise<void>(resolve => { release = resolve }), sent = new Promise<void>(resolve => { started = resolve })
  const f = fixture(), admission = new ModelAdmission({ storage: f.storage }, f.env, async input => {
    if (String(input).includes('token_plan')) return quotaResponse()
    modelCalls++; started(); await waiting
    return Response.json({ content: [{ type: 'text', text: '{"paidResult":"preserved"}' }], stop_reason: 'end_turn' })
  })
  f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => admission.fetch(request) }) }
  try {
    await seed(f.env, seedInput()); await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
    const input: ModelRequest = { reservationKey: '1'.repeat(64), sourceId: await digest('https://test.edu.cn/catalog'), snapshotSha256: 'd'.repeat(64), universityIds: ['uni-000'], pass: 'primary', payload: 'paid result fixture', lane: 'expansion' }
    const pending = gateRequest(f.env, '/model/run', input); await sent
    configure(f.env, 'source')
    const migration = (path: string, body: unknown) => gateRequest(f.env, `/model-state-migration/${path}`, body)
    const firstFreeze = await migration('freeze', { migrationId }), firstObserved = await firstFreeze.json()
    assert.equal(firstFreeze.status, 409); assert.equal(firstObserved.activeOperations, 1); assert.equal(firstObserved.activeModelPermitCount, 1)
    const state = await f.storage.get<{ models: Array<{ expiresAt: number }> }>('gate'); state!.models[0].expiresAt = 0; await f.storage.put('gate', state)
    const expiredFreeze = await migration('freeze', { migrationId }), expiredObserved = await expiredFreeze.json()
    assert.equal(expiredFreeze.status, 409); assert.equal(expiredObserved.activeOperations, 1)
    assert.equal(expiredObserved.activeModelPermitCount, 0); assert.equal(expiredObserved.activeFetchPermitCount, 0)
    assert.equal(expiredObserved.latestPermitExpiresAt, '1970-01-01T00:00:00.000Z')
    assert.equal((await migration('export', { migrationId, pageIndex: 0 })).status, 409)
    release(); assert.equal((await pending).status, 200)
    const drained = await (await migration('freeze', { migrationId })).json()
    assert.equal(drained.activeOperations, 0); assert.equal(drained.activeModelPermitCount, 0); assert.equal(drained.latestPermitExpiresAt, null)
    const response = await migration('export', { migrationId, pageIndex: 0 }), result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.manifest.states.completed, 1)
    assert.equal(JSON.parse(result.pageBytes).entries.find((e: { key: string }) => e.key.startsWith('request:')).value.result.output.paidResult, 'preserved')
    assert.equal(modelCalls, 1)
  } finally { release(); f.db.sqlite.close() }
})
