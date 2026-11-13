import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetStatus, checkBudget, configureBudget, resumeBudget } from '../src/budget'
import { BUDGET_OBSERVATION_KEY, BUDGET_POLICY_KEY, budgetCanonicalJson, parseBudgetObservation, validateBudgetPolicy } from '../../shared/background-budget'
import { makeEnv } from './fixture'

const account = '0123456789abcdef0123456789abcdef', token = 'test-only-budget-monitor-billing-token'
const now = Date.parse('2026-11-13T12:00:00Z'), hour = 3600000
const input = { accountId: account, baseUsd: 5, targetUsd: 10, pauseAtUsd: 9 }
const resumeInput = { reason: 'operator-confirmed-budget-resume' }
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/billable-usage`

function billingResponse(usage = 1, periodStart = '2026-11-01T00:00:00Z') {
  return Response.json({ success: true, errors: [], messages: [], result: [{ BillingAccountId: account,
    BillingCurrency: 'USD', BillingPeriodStart: periodStart, ChargeCategory: 'Usage',
    ChargeDescription: 'Workers Standard requests', ChargePeriodStart: periodStart,
    ChargePeriodEnd: new Date(Date.parse(periodStart) + 86400000).toISOString(), ContractedCost: usage,
    CumulatedContractedCost: 9999, ServiceName: 'Workers Standard', PricingUnit: 'Requests', ConsumedUnit: 'Requests' }] })
}
function billingFetch(usage = 1, periodStart?: string) {
  let calls = 0
  const fetcher: typeof fetch = async (url, options) => {
    calls++
    assert.equal(String(url), endpoint)
    assert.equal(options?.method, 'GET')
    assert.equal(options?.redirect, 'manual')
    return billingResponse(usage, periodStart)
  }
  return { fetcher, calls: () => calls }
}
async function fixture() {
  let models = 0, databaseCalls = 0
  const f = makeEnv(async () => { models++; throw new Error('model must not be called by the budget controller') })
  f.env.CLOUDFLARE_BILLING_READ_TOKEN = token
  f.db.sqlite.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
    enabled,models_enabled,seed_complete,targets_complete,revision,updated_at) VALUES(1,?,?,?,?,1,0,1,1,17,?)`)
    .run('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), new Date(now).toISOString())
  await f.storage.put('request:protected-model-reservation', { state: 'unknown', requestSha256: 'f'.repeat(64) })
  const beforeControl = f.db.sqlite.prepare('SELECT * FROM maintenance_control').all()
  const beforeReservations = structuredClone(f.storage.values)
  f.db.prepare = () => { databaseCalls++; throw new Error('budget controller must not query or mutate D1') }
  f.db.batch = async () => { databaseCalls++; throw new Error('budget controller must not query or mutate D1') }
  await configureBudget(f.env, input, now)
  return { ...f, unchanged() {
    assert.equal(databaseCalls, 0)
    assert.equal(models, 0)
    assert.equal(f.messages.length, 0)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_control').all(), beforeControl)
    assert.deepEqual(f.storage.values, beforeReservations)
  } }
}
async function observation(f: Awaited<ReturnType<typeof fixture>>) {
  return parseBudgetObservation(JSON.parse(await (await f.bucket.get(BUDGET_OBSERVATION_KEY))!.text()))
}

for (const [usage, state, allowed] of [[0, 'ready', true], [3.999999, 'ready', true], [4, 'paused', false], [4.000001, 'paused', false], [5, 'paused', false]] as const) {
  test(`base $5 plus usage $${usage} yields ${state} at the $9 pause boundary`, async () => {
    const f = await fixture(), billing = billingFetch(usage)
    try {
      const result = await checkBudget(f.env, billing.fetcher, now)
      assert.equal(result.state, state)
      assert.equal(result.allowed, allowed)
      assert.equal(result.cached, false)
      assert.equal(billing.calls(), 1)
      const saved = await observation(f)
      assert.equal(saved.usageMicroDollars, Math.ceil(usage * 1000000))
      assert.equal(saved.totalMicroDollars, 5000000 + Math.ceil(usage * 1000000))
      assert.equal(saved.periodEnd, null)
      assert.ok('receiptKey' in result && typeof result.receiptKey === 'string')
      assert.equal(await (await f.bucket.get(result.receiptKey))!.text(), budgetCanonicalJson(saved))
      f.unchanged()
    } finally { f.db.sqlite.close() }
  })
}
test('normal observations are cached for less than one hour, then refreshed once', async () => {
  const f = await fixture(), billing = billingFetch()
  try {
    await checkBudget(f.env, billing.fetcher, now)
    const cached = await checkBudget(f.env, billing.fetcher, now + hour - 1)
    assert.equal(cached.cached, true)
    assert.equal(cached.allowed, true)
    assert.equal(billing.calls(), 1)
    const refreshed = await checkBudget(f.env, billing.fetcher, now + hour)
    assert.equal(refreshed.cached, false)
    assert.equal(billing.calls(), 2)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
for (const failure of ['missing-token', 'empty-rows', 'http-unavailable', 'transport'] as const) {
  test(`${failure} is unknown and cannot authorize work or expose a made-up zero`, async () => {
    const f = await fixture()
    let calls = 0
    const fetcher: typeof fetch = async () => {
      calls++
      if (failure === 'transport') throw new Error(`${account} ${token}`)
      return failure === 'empty-rows' ? Response.json({ success: true, errors: [], result: [] }) : new Response(`${account} ${token}`, { status: 503 })
    }
    try {
      if (failure === 'missing-token') delete f.env.CLOUDFLARE_BILLING_READ_TOKEN
      const result = await checkBudget(f.env, fetcher, now)
      assert.equal(result.state, 'unknown')
      assert.equal(result.allowed, false)
      const saved = await observation(f)
      assert.equal(saved.usageMicroDollars, null)
      assert.equal(saved.totalMicroDollars, null)
      assert.equal(saved.periodStart, null)
      assert.equal(calls, failure === 'missing-token' ? 0 : 1)
      assert.equal(JSON.stringify(result).includes(account), false)
      assert.equal(JSON.stringify(result).includes(token), false)
      f.unchanged()
    } finally { f.db.sqlite.close() }
  })
}
test('an unknown observation retries the official read instead of caching unknown as a healthy hour', async () => {
  const f = await fixture(), healthy = billingFetch()
  try {
    await checkBudget(f.env, async () => new Response(null, { status: 503 }), now)
    const result = await checkBudget(f.env, healthy.fetcher, now + 1)
    assert.equal(result.allowed, true)
    assert.equal(result.state, 'ready')
    assert.equal(healthy.calls(), 1)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('a paused observation remains sticky after low spending and across a new billing period', async () => {
  const f = await fixture(), high = billingFetch(4), low = billingFetch(0)
  try {
    await checkBudget(f.env, high.fetcher, now)
    assert.equal((await checkBudget(f.env, low.fetcher, now + hour)).state, 'paused')
    const nextCycle = Date.parse('2026-12-13T12:00:00Z'), newPeriod = billingFetch(0, '2026-12-01T00:00:00Z')
    const result = await checkBudget(f.env, newPeriod.fetcher, nextCycle)
    assert.equal(result.state, 'paused')
    assert.equal(result.allowed, false)
    assert.equal((await observation(f)).periodStart, '2026-12-01T00:00:00.000Z')
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('only explicit resume with fresh under-threshold spending can clear a recent pause', async () => {
  const f = await fixture(), high = billingFetch(4), low = billingFetch(1)
  try {
    await checkBudget(f.env, high.fetcher, now)
    const ordinary = await checkBudget(f.env, low.fetcher, now + 1)
    assert.equal(ordinary.state, 'paused')
    assert.equal(low.calls(), 0, 'the ordinary one-hour cache must not be bypassed accidentally')
    const resumed = await resumeBudget(f.env, resumeInput, low.fetcher, now + 2)
    assert.equal(low.calls(), 1, 'explicit resume must bypass the cache and obtain real fresh costs')
    assert.equal(resumed.state, 'ready')
    assert.equal(resumed.allowed, true)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('explicit resume cannot force work at the threshold or when billing is unavailable', async () => {
  const f = await fixture(), high = billingFetch(4)
  try {
    await checkBudget(f.env, high.fetcher, now)
    const same = await resumeBudget(f.env, resumeInput, high.fetcher, now + 1)
    assert.equal(same.state, 'paused')
    assert.equal(same.allowed, false)
    const unavailable = await resumeBudget(f.env, resumeInput, async () => new Response(null, { status: 503 }), now + 2)
    assert.equal(unavailable.state, 'paused')
    assert.equal(unavailable.allowed, false)
    assert.equal((await observation(f)).state, 'paused')
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
for (const invalid of [null, {}, { reason: 'resume' }, { ...resumeInput, force: true }]) test('resume requires the exact operator reason without extra bypass flags', async () => {
  const f = await fixture(), billing = billingFetch()
  try {
    await assert.rejects(resumeBudget(f.env, invalid, billing.fetcher, now), /budget_resume_reason_invalid/u)
    assert.equal(billing.calls(), 0)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
for (const failure of ['all-reads', 'receipt-write', 'observation-write', 'cas-exhaustion'] as const) {
  test(`R2 ${failure} cannot return allowed even after an official low-cost response`, async () => {
    const f = await fixture(), billing = billingFetch(), original = f.bucket.put.bind(f.bucket)
    try {
      if (failure === 'all-reads') f.env.SNAPSHOTS_BUCKET.get = async () => { throw new Error('R2 unavailable') }
      else f.env.SNAPSHOTS_BUCKET = { get: key => f.bucket.get(key), put: async (key, body, options) => {
        if (failure === 'receipt-write' && key.includes('/budget-observations/')) throw new Error('R2 receipt unavailable')
        if (key === BUDGET_OBSERVATION_KEY) {
          if (failure === 'observation-write') throw new Error('R2 observation unavailable')
          if (failure === 'cas-exhaustion') return null
        }
        return original(key, body, options)
      } }
      const result = await checkBudget(f.env, billing.fetcher, now)
      assert.equal(result.allowed, false)
      assert.equal(result.state, 'unknown')
      f.unchanged()
    } finally { f.db.sqlite.close() }
  })
}
test('a slow older low-cost read cannot overwrite a concurrently persisted newer pause', async () => {
  const f = await fixture()
  let deliver!: (value: Response) => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const waiting = new Promise<Response>(resolve => { deliver = resolve })
  try {
    const older = checkBudget(f.env, async () => { entered(); return waiting }, now)
    await started
    await checkBudget(f.env, billingFetch(4).fetcher, now + 1)
    const pausedText = await (await f.bucket.get(BUDGET_OBSERVATION_KEY))!.text()
    deliver(billingResponse(0))
    const result = await older
    assert.equal(result.allowed, false)
    assert.equal(await (await f.bucket.get(BUDGET_OBSERVATION_KEY))!.text(), pausedText)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('ETag CAS rejects an old low-cost write when a new pause lands between read and write', async () => {
  const f = await fixture(), original = f.bucket.put.bind(f.bucket)
  try {
    await checkBudget(f.env, billingFetch(1).fetcher, now)
    const before = await observation(f), concurrent = { ...before, state: 'paused' as const,
      observedAt: new Date(now + hour + 1).toISOString(), usageMicroDollars: 4000000, totalMicroDollars: 9000000, code: 'budget_threshold_reached' }
    let inserted = false, rejected = false
    f.env.SNAPSHOTS_BUCKET = { get: key => f.bucket.get(key), put: async (key, body, options) => {
      if (key === BUDGET_OBSERVATION_KEY && !inserted) {
        assert.ok(options?.onlyIf?.etagMatches)
        inserted = true
        await original(key, budgetCanonicalJson(concurrent))
        const result = await original(key, body, options)
        rejected = result === null
        return result
      }
      return original(key, body, options)
    } }
    const result = await checkBudget(f.env, billingFetch(0).fetcher, now + hour)
    assert.equal(inserted, true)
    assert.equal(rejected, true)
    assert.equal(result.allowed, false)
    assert.deepEqual(await observation(f), concurrent)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('policy hash tampering cannot authorize work or cause a billing fetch', async () => {
  const f = await fixture(), billing = billingFetch()
  try {
    const saved = JSON.parse(await (await f.bucket.get(BUDGET_POLICY_KEY))!.text())
    saved.accountId = 'f'.repeat(32)
    await f.bucket.put(BUDGET_POLICY_KEY, budgetCanonicalJson(saved))
    const result = await checkBudget(f.env, billing.fetcher, now)
    assert.equal(result.state, 'unknown')
    assert.equal(result.allowed, false)
    assert.equal(billing.calls(), 0)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('a foreign observation hash is not accepted as a cached ready observation', async () => {
  const f = await fixture(), healthy = billingFetch(1)
  try {
    await checkBudget(f.env, healthy.fetcher, now)
    const saved = { ...await observation(f), policySha256: 'f'.repeat(64) }
    await f.bucket.put(BUDGET_OBSERVATION_KEY, budgetCanonicalJson(saved))
    assert.equal((await budgetStatus(f.env, now)).allowed, false)
    const refreshed = await checkBudget(f.env, healthy.fetcher, now + 1)
    assert.equal(refreshed.cached, false)
    assert.equal(healthy.calls(), 2)
    assert.equal((await observation(f)).policySha256, (await validateBudgetPolicy(JSON.parse(await (await f.bucket.get(BUDGET_POLICY_KEY))!.text()))).sha256)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
for (const change of [{ baseUsd: 0 }, { targetUsd: 100 }, { pauseAtUsd: 10 }, { force: true }, { accountId: '../not-an-account' }]) {
  test('configuration requires exactly the owner-approved account and 5/10/9 policy shape', async () => {
    const f = makeEnv()
    try {
      await assert.rejects(configureBudget(f.env, { ...input, ...change }, now), /budget_configuration_invalid/u)
      assert.equal(f.bucket.objects.size, 0)
    } finally { f.db.sqlite.close() }
  })
}
test('an existing content-addressed policy cannot be replaced with a different account', async () => {
  const f = await fixture()
  try {
    const previous = await (await f.bucket.get(BUDGET_POLICY_KEY))!.text()
    await assert.rejects(configureBudget(f.env, { ...input, accountId: 'f'.repeat(32) }, now), /budget_receipt_conflict/u)
    assert.equal(await (await f.bucket.get(BUDGET_POLICY_KEY))!.text(), previous)
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
test('public configuration, checks, cached status and resume results never reveal private financial amounts or credentials', async () => {
  const f = await fixture(), billing = billingFetch(1.234567)
  try {
    const outputs = [await configureBudget(f.env, input, now), await checkBudget(f.env, billing.fetcher, now),
      await budgetStatus(f.env, now), await checkBudget(f.env, billing.fetcher, now + 1),
      await resumeBudget(f.env, resumeInput, billing.fetcher, now + 2)]
    for (const result of outputs) {
      const serialized = JSON.stringify(result)
      for (const privateValue of [account, token, '1.234567', '1234567', '6234567', 'usageMicroDollars', 'totalMicroDollars', 'ContractedCost', 'accountId']) {
        assert.equal(serialized.includes(privateValue), false, `public result exposed ${privateValue}`)
      }
      assert.equal(result.baseUsd, 5)
      assert.equal(result.targetUsd, 10)
      assert.equal(result.pauseAtUsd, 9)
    }
    f.unchanged()
  } finally { f.db.sqlite.close() }
})
