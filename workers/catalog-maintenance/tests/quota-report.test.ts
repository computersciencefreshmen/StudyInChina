import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { handleFetch } from '../src/index'
import { readPlanQuotaReport } from '../src/quota-report'
import { makeEnv, quotaResponse } from './fixture'

test('quota observation is authenticated and survives an exhausted execution ledger without admitting a model', async () => {
  const f = makeEnv()
  let providerReads = 0
  f.db.prepare = () => { throw new Error('D1 quota exhausted: must not be touched') }
  f.env.MODEL_ADMISSION = { idFromName: () => { throw new Error('no model admission') }, get: () => { throw new Error('no model admission') } }
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://www.minimax.cn/v1/token_plan/remains')
    assert.equal(options.method, 'GET')
    providerReads++
    return quotaResponse(82.5, 61)
  })
  try {
    assert.equal((await handleFetch(new Request('https://worker/quota'), f.env)).status, 401)
    assert.equal(providerReads, 0)
    const response = await handleFetch(new Request('https://worker/quota', {
      headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` },
    }), f.env)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json() as Awaited<ReturnType<typeof readPlanQuotaReport>>
    assert.equal(body.state, 'observed')
    assert.equal(body.quota?.fiveHourRemaining, 82.5)
    assert.equal(body.quota?.weeklyRemaining, 61)
    assert.equal(body.backendIndependent, true)
    assert.equal(body.modelCallsPerformed, false)
    assert.equal(body.admissionPolicy.minimumRemainingPercent, 5)
    assert.equal(body.admissionPolicy.providerBillingSettingsVerified, false)
    assert.equal(providerReads, 1)
    assert.equal(f.messages.length, 0)
    assert.equal(f.bucket.objects.size, 0)
    assert.equal(f.storage.values.size, 0)
    assert.ok(!JSON.stringify(body).includes(f.env.MINIMAX_SUBSCRIPTION_KEY!))
    assert.ok(!JSON.stringify(body).includes(f.env.MAINTENANCE_ADMIN_TOKEN!))
  } finally { mock.restoreAll(); f.db.sqlite.close() }
})

test('unreadable or stale provider quotas remain unknown, rather than becoming zero or available', async () => {
  const f = makeEnv()
  try {
    for (const provider of [
      async () => { throw new Error('secret-containing upstream error') },
      async () => Response.json({ base_resp: { status_code: 0 }, model_remains: [] }),
      async () => Response.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general',
        current_interval_remaining_percent: 100, current_weekly_remaining_percent: 100,
        start_time: 1, end_time: 2, weekly_start_time: 1, weekly_end_time: 2 }] }),
    ]) {
      const report = await readPlanQuotaReport(f.env, provider as typeof fetch)
      assert.equal(report.state, 'quota_unknown')
      assert.equal(report.quota, null)
      assert.ok(!JSON.stringify(report).includes('secret-containing'))
    }
  } finally { f.db.sqlite.close() }
})

test('quota observation distinguishes the configured floor from verified provider billing settings', async () => {
  const f = makeEnv()
  try {
    const report = await readPlanQuotaReport({ ...f.env, MINIMAX_CREDIT_FALLBACK_DISABLED: 'true' },
      async () => quotaResponse(0, 60))
    assert.equal(report.quota?.fiveHourRemaining, 0)
    assert.equal(report.state, 'observed')
    assert.equal(report.admissionPolicy.minimumRemainingPercent, 0)
    assert.equal(report.admissionPolicy.providerBillingSettingsVerified, false)
    assert.equal(report.modelCallsPerformed, false)
  } finally { f.db.sqlite.close() }
})

test('unexpected legacy quota fields are observable without exposing a raw response or guessing their meaning', async () => {
  const f = makeEnv()
  try {
    const report = await readPlanQuotaReport(f.env, async () => Response.json({
      base_resp: { status_code: 0, status_msg: f.env.MINIMAX_SUBSCRIPTION_KEY },
      account_id: 'private-account', api_key: f.env.MINIMAX_SUBSCRIPTION_KEY,
      model_remains: [{ model_name: 'general', current_weekly_status: 3,
        current_weekly_remaining_percent: null, current_interval_remaining_percent: 'secret-string' }],
    }))
    assert.equal(report.state, 'quota_unknown')
    assert.deepEqual(report.providerObservation.fields?.current_weekly_status, { present: true, type: 'number', value: 3 })
    assert.deepEqual(report.providerObservation.fields?.current_weekly_remaining_percent, { present: true, type: 'null', value: null })
    assert.deepEqual(report.providerObservation.fields?.weekly_start_time, { present: false, type: 'undefined', value: null })
    assert.deepEqual(report.providerObservation.fields?.current_interval_remaining_percent, { present: true, type: 'string', value: null })
    for (const value of ['private-account', 'secret-string', f.env.MINIMAX_SUBSCRIPTION_KEY!]) assert.ok(!JSON.stringify(report).includes(value))
  } finally { f.db.sqlite.close() }
})
