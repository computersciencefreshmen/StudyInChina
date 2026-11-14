import assert from 'node:assert/strict'
import test from 'node:test'
import { runCloudTick, registerBootstrapRequest } from '../src/runtime'
import { seed, setControls, control } from '../src/repository'
import { processMessage } from '../src/index'
import { digest } from '../src/util'
import { makeEnv, seedInput, TEST_SCOPE, TEST_GUARDS } from './fixture'

const start = Date.parse('2026-11-14T04:00:00.000Z'), canary = ['uni-000','uni-001','uni-002','uni-003','uni-004']
const pointer = 'maintenance/bootstrap-pending/initial.v1.json'
function originals(f: ReturnType<typeof makeEnv>) { return [...f.bucket.objects].filter(([key]) => key.startsWith('maintenance/bootstrap-pending/')).map(([key, value]) => [key, Array.from(value)]) }
async function upload(f: ReturnType<typeof makeEnv>, input: ReturnType<typeof seedInput>) {
  const body = JSON.stringify({ seed: input, activation: { canaryUniversityIds: canary, modelsEnabled: true } }), hash = await digest(body)
  await registerBootstrapRequest(f.env, new Request('https://worker/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length),
    'x-maintenance-bootstrap-sha256': hash, 'x-maintenance-scope-sha256': TEST_SCOPE, 'x-maintenance-canary-ids': canary.join(','), 'x-maintenance-models-enabled': 'true' }, body }))
  return hash
}

test('a real complete seed plus raw upload without a validated pointer dispatches only its normal bound and preserves original intent', async t => {
  const originalNow = Date.now; let now = start; Date.now = () => now
  try {
    for (const value of [undefined, '16', '32']) await t.test(String(value), async () => {
      const f = makeEnv(), input = seedInput(), limit = Number(value ?? 8)
      f.env.TICK_JOB_LIMIT = value
      for (let i = 0; i < 40; i++) input.schools[i].sourceSeeds = [{ id: `source-${i}`, url: `https://school-${i}.edu.cn/catalog`, allowedHosts: [`school-${i}.edu.cn`], sourceCategory: 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' }]
      try {
        now = start
        await seed(f.env, input, start)
        await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: canary }, start)
        await setControls(f.env, { expectedRevision: 1, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: [] }, start)
        await upload(f, input)
        assert.equal(await f.bucket.get(pointer), null)
        const originalObjects = originals(f), originalControl = JSON.stringify(await control(f.env))
        for (let turn = 0; turn < 2; turn++) {
          now = start + turn * 900001; f.messages.length = 0
          const tick = await runCloudTick(f.env)
          assert.equal(tick.state, 'running'); assert.equal(tick.queued, limit); assert.equal(f.messages.length, limit)
          assert.ok(f.messages.every(m => !m.bootstrapUploadSha256))
          assert.equal(JSON.stringify(await control(f.env)), originalControl)
          assert.deepEqual(originals(f), originalObjects); assert.equal(await f.bucket.get(pointer), null)
        }
        assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
      } finally { f.db.sqlite.close() }
    })
  } finally { Date.now = originalNow }
})

test('raw validation remains a real one-message stage and its existing queue handler restores the pointer before seeding', async () => {
  const f = makeEnv(), input = seedInput(), hash = await upload(f, input)
  try {
    // Measure the tick's recovery delivery separately from POST /bootstrap's
    // initial delivery, which may have been lost before queue validation.
    f.messages.length = 0
    const before = originals(f), tick = await runCloudTick(f.env)
    assert.equal(tick.state, 'waiting_for_seed'); assert.equal(tick.code, 'pending_bootstrap_validation_queued'); assert.equal(tick.queued, 1)
    assert.equal(f.messages.length, 1); assert.equal(f.messages[0].bootstrapUploadSha256, hash)
    assert.equal(await control(f.env), null); assert.equal(await f.bucket.get(pointer), null); assert.deepEqual(originals(f), before)
    // No pointer or receipt is fabricated by the scheduler. The original parser
    // validates the exact upload and creates the normal immutable bootstrap.
    await processMessage(f.env, f.messages.shift()!)
    assert.ok(await f.bucket.get(pointer)); assert.equal(await control(f.env), null)
    const next = await runCloudTick(f.env)
    assert.equal(next.code, 'pending_bootstrap_seed_queued'); assert.equal(next.queued, 1)
    for (let i = 0; f.messages.length && i < 16; i++) await processMessage(f.env, f.messages.shift()!)
    assert.equal(f.messages.length, 0); assert.equal((await control(f.env))?.seed_complete, 1)
    await runCloudTick(f.env)
    assert.equal((await control(f.env))?.enabled, 1); assert.deepEqual(JSON.parse((await control(f.env))!.canary_json), canary)
    for (const [key, bytes] of before as Array<[string, number[]]>) assert.deepEqual(Array.from(f.bucket.objects.get(key)!), bytes)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('a paused complete seed is not reactivated or sent bootstrap validation by a leftover raw intent', async () => {
  const f = makeEnv(), input = seedInput()
  try {
    await seed(f.env, input); await upload(f, input)
    f.messages.length = 0
    const before = originals(f), cfg = JSON.stringify(await control(f.env)), tick = await runCloudTick(f.env)
    assert.equal(tick.queued, 0); assert.equal(f.messages.length, 0)
    assert.equal(JSON.stringify(await control(f.env)), cfg); assert.deepEqual(originals(f), before)
    assert.equal(await f.bucket.get(pointer), null)
  } finally { f.db.sqlite.close() }
})

test('raw validation still precedes continuation of an existing partial seed without replacing its identity', async () => {
  const f = makeEnv(), input = seedInput()
  try {
    await seed(f.env, input, start, true)
    const original = await control(f.env); assert.equal(original?.seed_complete, 0)
    await upload(f, input); f.messages.length = 0
    assert.equal((await runCloudTick(f.env)).code, 'pending_bootstrap_validation_queued')
    assert.equal(f.messages.length, 1)
    await processMessage(f.env, f.messages.shift()!)
    assert.ok(await f.bucket.get(pointer)); assert.equal((await control(f.env))?.seed_sha256, original?.seed_sha256)
    await runCloudTick(f.env)
    for (let i = 0; f.messages.length && i < 16; i++) await processMessage(f.env, f.messages.shift()!)
    assert.equal((await control(f.env))?.seed_complete, 1); assert.equal((await control(f.env))?.seed_sha256, original?.seed_sha256)
    assert.equal((await control(f.env))?.enabled, 0, 'only the later ordinary activation tick may activate the validated seed')
  } finally { f.db.sqlite.close() }
})
