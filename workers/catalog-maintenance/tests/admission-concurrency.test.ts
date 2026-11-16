import assert from 'node:assert/strict'
import test from 'node:test'
import { modelConcurrencyLimit } from '../src/admission'
import { seed, setControls } from '../src/repository'
import type { ModelRequest } from '../src/types'
import { digest, gateRequest } from '../src/util'
import { makeEnv, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

type Gate = { fetches: unknown[]; models: unknown[]; nextHost: Record<string, number>; successes: number; cooldownUntil: number; modelLimit: number }
const gate = (modelLimit: number): Gate => ({ fetches: [], models: [], nextHost: {}, successes: 0, cooldownUntil: 0, modelLimit })
const output = () => Response.json({ content: [{ type: 'text', text: '{"programs":[]}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' })

async function fixture(configuration?: string, healthyLimit?: number) {
  let quotaCalls = 0, sends = 0, active = 0, peak = 0, quota = 80
  let provider: () => Promise<Response> = async () => output()
  const f = makeEnv(async url => {
    if (String(url).includes('token_plan')) { quotaCalls++; return quotaResponse(quota, 90) }
    assert.equal(String(url), 'https://api.minimaxi.com/anthropic/v1/messages')
    sends++; active++; peak = Math.max(peak, active)
    try { return await provider() } finally { active-- }
  })
  if (configuration === undefined) delete f.env.MODEL_CONCURRENCY
  else f.env.MODEL_CONCURRENCY = configuration
  f.env.MINIMAX_CREDIT_FALLBACK_DISABLED = 'false'
  await seed(f.env, seedInput())
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  const sourceId = await digest('https://test.edu.cn/catalog'), snapshotSha256 = 'd'.repeat(64)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=? WHERE source_id=?').run(snapshotSha256, 'e'.repeat(64), sourceId)
  if (healthyLimit !== undefined) await f.storage.put('gate', gate(healthyLimit))
  const input = async (id: string): Promise<ModelRequest> => ({ reservationKey: await digest(id), sourceId, snapshotSha256,
    universityIds: ['uni-000'], pass: 'primary', lane: 'expansion', recordIds: [], payload: `Official test evidence ${id}` })
  return { ...f, input, run: (request: ModelRequest) => gateRequest(f.env, '/model/run', request),
    provider: (handler: () => Promise<Response>) => { provider = handler }, quota: (value: number) => { quota = value },
    counts: () => ({ quotaCalls, sends, active, peak }) }
}

test('only exact configured integers from one to sixteen opt in; missing and malformed input preserve four', () => {
  for (const value of [undefined, '', '0', '-1', '17', '999', '4.0', '8.0', '1e1', ' 8', '8 ', '08', 'NaN', 'Infinity']) {
    assert.equal(modelConcurrencyLimit({ MODEL_CONCURRENCY: value }), 4, String(value))
  }
  for (let n = 1; n <= 16; n++) assert.equal(modelConcurrencyLimit({ MODEL_CONCURRENCY: String(n) }), n)
})

async function proveConcurrentCeiling(configuration: string | undefined, healthyLimit: number | undefined, expected: number, lowQuota = false) {
  const f = await fixture(configuration, healthyLimit)
  let release!: () => void, reached!: () => void
  const latch = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { reached = resolve })
  let entered = 0, timer: ReturnType<typeof setTimeout> | undefined
  f.provider(async () => { if (++entered === expected) reached(); await latch; return output() })
  if (lowQuota) f.quota(9)
  let runs: Array<Promise<Response>> = []
  try {
    const inputs = await Promise.all(Array.from({ length: expected + 1 }, (_, i) => f.input(`concurrent-${configuration}-${i}`)))
    runs = inputs.map(value => f.run(value))
    await Promise.race([started, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('parallel_permits_not_reached')), 5000) })])
    const rejected = await Promise.race(runs)
    assert.equal(rejected.status, 429)
    assert.equal((await rejected.clone().json()).error, 'model_capacity_or_reserved')
    assert.equal(f.counts().active, expected); assert.equal(f.counts().sends, expected)
    assert.equal((await f.storage.get<Gate>('gate'))!.models.length, expected)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='send_started'").get()?.n, expected)
  } finally {
    if (timer) clearTimeout(timer)
    release()
    const results = await Promise.all(runs)
    assert.equal(results.filter(value => value.ok).length, expected)
    assert.equal(results.filter(value => value.status === 429).length, 1)
    assert.equal(f.counts().peak, expected); assert.equal(f.counts().active, 0)
    assert.equal((await f.storage.get<Gate>('gate'))!.models.length, 0)
    f.db.sqlite.close()
  }
}

test('the real admission transaction permits eight and sixteen simultaneous mocked provider requests, but never one extra', async () => {
  await proveConcurrentCeiling('8', 8, 8)
  await proveConcurrentCeiling('16', 16, 16)
})

test('default and malformed configuration cannot burst above four, even with old healthy sixteen in storage', async () => {
  await proveConcurrentCeiling(undefined, 16, 4)
  await proveConcurrentCeiling('999', 16, 4)
})

test('cold state still starts at two and low remaining quota still admits only one', async () => {
  await proveConcurrentCeiling('16', undefined, 2)
  await proveConcurrentCeiling('16', 16, 1, true)
})

test('an old healthy four ramps through eight to sixteen only after each group of eight completed responses', async () => {
  for (const configured of [8, 16]) {
    const f = await fixture(String(configured), 4)
    try {
      for (let n = 1; n <= (configured - 4) * 8; n++) {
        assert.equal((await f.run(await f.input(`ramp-${n}`))).status, 200)
        const stored = (await f.storage.get<Gate>('gate'))!
        assert.equal(stored.modelLimit, 4 + Math.floor(n / 8)); assert.equal(stored.successes, n % 8)
      }
      assert.equal((await f.storage.get<Gate>('gate'))!.modelLimit, configured)
    } finally { f.db.sqlite.close() }
  }
})

test('a 429 halves the configured healthy limit, retains cooldown, and does not retry or reset when configuration rises', async () => {
  const f = await fixture('8', 8)
  try {
    f.provider(async () => new Response('provider rate limit', { status: 429, headers: { 'retry-after': '120' } }))
    const input = await f.input('rate-limited'), before = Date.now()
    const response = await f.run(input)
    assert.equal(response.status, 429); assert.equal((await response.json()).error, 'model_http_429')
    const stored = (await f.storage.get<Gate>('gate'))!, prior = await f.storage.get(`request:${input.reservationKey}`)
    assert.equal(stored.modelLimit, 4); assert.equal(stored.successes, 0); assert.ok(stored.cooldownUntil >= before + 120_000)
    f.env.MODEL_CONCURRENCY = '16'
    assert.equal((await f.run(input)).status, 429)
    assert.equal((await f.run(await f.input('new-during-cooldown'))).status, 429)
    assert.equal(f.counts().sends, 1); assert.deepEqual(await f.storage.get(`request:${input.reservationKey}`), prior)
    assert.equal((await f.storage.get<Gate>('gate'))!.cooldownUntil, stored.cooldownUntil)
  } finally { f.db.sqlite.close() }
})

test('raising or rolling back concurrency never replays a real ambiguous sent request', async () => {
  const f = await fixture('8', 8)
  const clock = Date.now
  try {
    f.provider(async () => { throw Error('connection lost after send') })
    const input = await f.input('ambiguous'), response = await f.run(input)
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'model_outcome_unknown')
    const prior = await f.storage.get<{ state: string }>(`request:${input.reservationKey}`), counts = f.counts()
    assert.equal(prior!.state, 'unknown')
    Date.now = () => clock() + 3600_000
    for (const configured of ['16', '4']) {
      f.env.MODEL_CONCURRENCY = configured
      assert.equal((await (await f.run(input)).json()).error, 'prior_model_outcome_requires_review')
      assert.deepEqual(await f.storage.get(`request:${input.reservationKey}`), prior)
    }
    assert.deepEqual(f.counts(), counts)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts WHERE reservation_key=?').get(input.reservationKey)?.status, 'unknown')
  } finally { Date.now = clock; f.db.sqlite.close() }
})

test('rolling back an already warm sixteen gate immediately limits new sends without rewriting its reservations', async () => {
  await proveConcurrentCeiling('4', 16, 4)
})
