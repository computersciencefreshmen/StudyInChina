import assert from 'node:assert/strict'
import test from 'node:test'
import { configureBudget } from '../src/budget'
import { handleFetch, handleQueue } from '../src/index'
import { buildSoakObservation, quotaWait, rememberQuotaWait, runCloudTick, type RuntimeTick } from '../src/runtime'
import { canonical, gateRequest } from '../src/util'
import { BUDGET_OBSERVATION_KEY, BUDGET_POLICY_KEY, type BudgetObservation } from '../../shared/background-budget'
import { makeEnv } from './fixture'

async function fixture(state: BudgetObservation['state'] | 'missing') {
  let models = 0
  const f = makeEnv(async () => { models++; throw new Error('budget-blocked work must not call a model') }), now = Date.now()
  await f.storage.put('request:prior-protected-request', { state: 'unknown', requestSha256: 'f'.repeat(64) })
  const reservations = structuredClone(f.storage.values)
  await configureBudget(f.env, { accountId: 'a'.repeat(32), baseUsd: 5, targetUsd: 10, pauseAtUsd: 9 }, now)
  const policy = JSON.parse(await (await f.bucket.get(BUDGET_POLICY_KEY))!.text())
  if (state !== 'missing') await f.bucket.put(BUDGET_OBSERVATION_KEY, canonical({
    format: 'studyinchina.cloudflare-budget-observation', version: 1, policySha256: policy.sha256, state,
    observedAt: new Date(now).toISOString(), periodStart: state === 'unknown' ? null : new Date(now - 86400000).toISOString(), periodEnd: null,
    usageMicroDollars: state === 'unknown' ? null : state === 'paused' ? 4000000 : 1000000,
    totalMicroDollars: state === 'unknown' ? null : state === 'paused' ? 9000000 : 6000000,
    code: state === 'unknown' ? 'billing_transport_failed' : state === 'paused' ? 'budget_threshold_reached' : 'budget_within_target',
  }))
  return { ...f, noOtherWork() {
    assert.equal(models, 0)
    assert.equal(f.messages.length, 0)
    assert.deepEqual(f.storage.values, reservations)
  } }
}
function request(f: ReturnType<typeof makeEnv>, path: string, body?: string) {
  return new Request(`https://maintenance.test${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body })
}
function insertPausedControl(f: ReturnType<typeof makeEnv>) {
  f.db.sqlite.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
    enabled,models_enabled,seed_complete,targets_complete,revision,updated_at) VALUES(1,?,?,?,?,0,0,1,1,7,?)`)
    .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), new Date().toISOString())
}

for (const state of ['missing', 'unknown', 'paused'] as const) test(`budget ${state} blocks every maintenance admission before D1, models or queue sends`, async () => {
  const f = await fixture(state)
  let d1 = 0
  f.env.PIPELINE_DB = { prepare() { d1++; throw new Error('D1 must not be accessed during budget wait') },
    async batch() { d1++; throw new Error('D1 must not be accessed during budget wait') } }
  try {
    const tickResponse = await handleFetch(request(f, '/tick', '{}'), f.env)
    assert.equal(tickResponse.status, 200)
    const tick = await tickResponse.json()
    assert.equal(tick.state, 'budget_wait')
    assert.equal(tick.queued, null)
    assert.equal(tick.retryAt, null)
    const statusResponse = await handleFetch(request(f, '/status'), f.env)
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json()
    assert.equal(status.backend.state, 'budget_wait')
    assert.equal(status.budget.allowed, false)
    assert.equal(status.budget.state, state === 'paused' ? 'paused' : 'unknown')
    for (const key of ['control', 'jobs', 'coverage', 'sources', 'modelAttempts', 'scopeCount']) assert.equal(status[key], null)
    const retries: Array<number | undefined> = []
    let acks = 0
    await handleQueue({ messages: ['one', 'two'].map(jobId => ({ id: jobId, body: { version: 1 as const, jobId }, attempts: 1,
      ack() { acks++ }, retry(options?: { delaySeconds?: number }) { retries.push(options?.delaySeconds) } })) }, f.env)
    assert.deepEqual(retries, [3600, 3600])
    assert.equal(acks, 0)
    const model = await gateRequest(f.env, '/model/run', { reservationKey: '1'.repeat(64), sourceId: '2'.repeat(64), snapshotSha256: '3'.repeat(64),
      universityIds: ['test-school'], pass: 'primary', lane: 'expansion', payload: 'Never send this request.' })
    assert.equal(model.status, 429)
    assert.match((await model.json()).error, /^budget_wait$/u)
    for (const path of ['/targets', '/exports']) {
      const response = await handleFetch(request(f, path, 'deliberately-invalid-json'), f.env)
      assert.equal(response.status, 503)
      assert.equal((await response.json()).error, 'budget_wait')
    }
    const health = await handleFetch(new Request('https://maintenance.test/health'), f.env)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).ok, true)
    assert.equal(d1, 0)
    f.noOtherWork()
  } finally { f.db.sqlite.close() }
})

test('a ready budget never restores manually paused maintenance controls', async () => {
  const f = await fixture('ready')
  try {
    insertPausedControl(f)
    const before = f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()
    const tick = await runCloudTick(f.env)
    assert.equal(tick.state, 'disabled')
    assert.equal(tick.code, 'existing_controls_preserved')
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get(), before)
    f.noOtherWork()
  } finally { f.db.sqlite.close() }
})

for (const path of ['/rollout', '/head-reconcile-targets']) test(`a budget pause rejects ${path} writes before parsing the body or accessing D1`, async () => {
  const f = await fixture('paused')
  let reads = 0
  f.env.PIPELINE_DB = { prepare() { reads++; throw new Error('rollout expansion must remain budget gated') },
    async batch() { reads++; throw new Error('rollout expansion must remain budget gated') } }
  try {
    const artifacts = [...f.bucket.objects.keys()]
    const response = await handleFetch(request(f, path, 'deliberately-invalid-json'), f.env)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, error: 'budget_wait', code: 'budget_paused' })
    assert.equal(reads, 0)
    assert.deepEqual([...f.bucket.objects.keys()], artifacts)
    f.noOtherWork()
  } finally { f.db.sqlite.close() }
})

test('an explicit D1 backend recheck can clear the daily wait while an independent budget pause still blocks the tick', async () => {
  const f = await fixture('paused')
  try {
    insertPausedControl(f)
    const before = f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()
    await rememberQuotaWait(f.env)
    assert.ok(await quotaWait(f.env))
    const priorBudget = await (await f.bucket.get(BUDGET_OBSERVATION_KEY))!.text()
    const response = await handleFetch(request(f, '/backend/recheck', JSON.stringify({ reason: 'account-plan-change' })), f.env)
    assert.equal(response.status, 200)
    assert.deepEqual(Object.fromEntries(Object.entries(await response.json()).filter(([key]) => ['state', 'readVerified', 'writeVerified', 'waitCleared'].includes(key))),
      { state: 'ready', readVerified: true, writeVerified: true, waitCleared: true })
    assert.equal(await quotaWait(f.env), null)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='backend_quota_rechecked'").get()?.n, 1)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get(), before)
    assert.equal(await (await f.bucket.get(BUDGET_OBSERVATION_KEY))!.text(), priorBudget)
    assert.equal((await runCloudTick(f.env)).state, 'budget_wait')
    f.noOtherWork()
  } finally { f.db.sqlite.close() }
})

test('budget waiting cannot count as a complete uninterrupted 168-hour soak', () => {
  const start = Date.parse('2026-11-01T00:00:00Z'), end = start + 168 * 3600000
  const make = (time: number): RuntimeTick => ({ format: 'studyinchina.cloud-maintenance-tick', version: 1, tickId: String(time),
    observedAt: new Date(time).toISOString(), state: 'running', code: 'bounded_scheduler_completed', queued: 0,
    seedComplete: true, targetsComplete: true, modelsEnabled: true, canarySchoolCount: 0, retryAt: null })
  const ticks = Array.from({ length: 168 * 4 + 1 }, (_, index) => make(start + index * 900000))
  assert.equal(buildSoakObservation(ticks, new Date(start).toISOString(), end).passed, true)
  const paused: RuntimeTick = { ...make(start + 3600000), state: 'budget_wait', code: 'budget_paused' }
  const report = buildSoakObservation([...ticks, paused], new Date(start).toISOString(), end)
  assert.equal(report.passed, false)
  assert.equal(report.waitingOrFailedTicks, 1)
  assert.equal(report.eligibleTicksLastSevenDays, ticks.length)
})
