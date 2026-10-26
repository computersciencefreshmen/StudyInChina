import assert from 'node:assert/strict'
import test from 'node:test'
import { seed, setControls } from '../src/repository'
import type { ModelRequest } from '../src/types'
import { digest, gateRequest } from '../src/util'
import { makeEnv, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

async function enabled(f: ReturnType<typeof makeEnv>) {
  await seed(f.env, seedInput())
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
}
async function request(): Promise<ModelRequest> {
  return { reservationKey: await digest('cache-only-request'), sourceId: await digest('https://test.edu.cn/catalog'), universityIds: ['uni-000'],
    snapshotSha256: 'd'.repeat(64), pass: 'primary', payload: 'unchanged original prompt', lane: 'expansion', recordIds: [] }
}

test('cache-only mode reuses an exact completed result without quota, provider, new receipts or reservations', async () => {
  let fetches = 0, paid = 0
  const f = makeEnv(async url => {
    fetches++
    if (String(url).includes('token_plan')) return quotaResponse()
    paid++
    return Response.json({ content: [{ type: 'text', text: '{"programs":[]}' }], stop_reason: 'end_turn' })
  })
  try {
    await enabled(f)
    const input = await request()
    assert.equal((await gateRequest(f.env, '/model/run', input)).status, 200)
    const original = structuredClone(f.storage.values.get(`request:${input.reservationKey}`)), objects = [...f.bucket.objects.keys()]
    f.env.MINIMAX_COMPLETED_CACHE_ONLY = 'true'
    const hit = await gateRequest(f.env, '/model/run', input)
    assert.equal(hit.status, 200)
    assert.equal((await hit.json()).reused, true)
    assert.equal(fetches, 2)
    assert.equal(paid, 1)
    assert.deepEqual(f.storage.values.get(`request:${input.reservationKey}`), original)
    assert.deepEqual([...f.bucket.objects.keys()], objects)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()!.n, 1)
  } finally { f.db.sqlite.close() }
})

test('a cache-only miss stops before every external fetch and leaves no model reservation or fake unknown', async () => {
  let fetches = 0
  const f = makeEnv(async () => { fetches++; throw new Error('no fetch permitted') })
  try {
    await enabled(f)
    f.env.MINIMAX_COMPLETED_CACHE_ONLY = 'true'
    const input = await request(), response = await gateRequest(f.env, '/model/run', input)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'model_completed_cache_required')
    assert.equal(fetches, 0)
    assert.equal(f.storage.values.has(`request:${input.reservationKey}`), false)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()!.n, 0)
    assert.equal([...f.bucket.objects.keys()].filter(key => key.startsWith('maintenance/models/')).length, 0)
  } finally { f.db.sqlite.close() }
})

test('cache-only mode preserves unknown and content-conflict guards without replay or rewritten history', async () => {
  let fetches = 0
  const f = makeEnv(async url => { fetches++; if (String(url).includes('token_plan')) return quotaResponse(); throw new Error('lost response') })
  try {
    await enabled(f)
    const input = await request()
    assert.equal((await (await gateRequest(f.env, '/model/run', input)).json()).error, 'model_outcome_unknown')
    const reservation = structuredClone(f.storage.values.get(`request:${input.reservationKey}`))
    const attempt = f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').get()
    f.env.MINIMAX_COMPLETED_CACHE_ONLY = 'true'
    assert.equal((await (await gateRequest(f.env, '/model/run', input)).json()).error, 'prior_model_outcome_requires_review')
    assert.equal((await (await gateRequest(f.env, '/model/run', { ...input, payload: 'changed prompt' })).json()).error, 'reservation_content_conflict')
    assert.equal(fetches, 2)
    assert.deepEqual(f.storage.values.get(`request:${input.reservationKey}`), reservation)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').get(), attempt)
  } finally { f.db.sqlite.close() }
})

test('cache-only mode also prohibits otherwise safe provider-429 retries', async () => {
  let fetches = 0
  const f = makeEnv(async url => { fetches++; return String(url).includes('token_plan') ? quotaResponse() : new Response('busy', { status: 429 }) })
  try {
    await enabled(f)
    const input = await request()
    assert.equal((await gateRequest(f.env, '/model/run', input)).status, 429)
    f.env.MINIMAX_COMPLETED_CACHE_ONLY = 'true'
    const response = await gateRequest(f.env, '/model/run', input)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'model_completed_cache_required')
    assert.equal(fetches, 2)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()!.n, 1)
  } finally { f.db.sqlite.close() }
})
