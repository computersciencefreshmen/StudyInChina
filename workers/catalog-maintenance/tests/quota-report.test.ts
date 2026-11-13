import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { handleFetch } from '../src/index'
import { readPlanQuotaReport } from '../src/quota-report'
import { makeEnv, quotaResponse } from './fixture'
import { readQuotaProvider } from '../src/admission'

test('quota observation is authenticated and survives an exhausted execution ledger without admitting a model', async () => {
  const f = makeEnv()
  let providerReads = 0
  f.db.prepare = () => { throw new Error('D1 quota exhausted: must not be touched') }
  f.env.MODEL_ADMISSION = { idFromName: () => { throw new Error('no model admission') }, get: () => { throw new Error('no model admission') } }
  mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.minimax.cn/v1/token_plan/remains')
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

test('provider diagnostics distinguish fixed configuration errors without attempting a network request', async () => {
  const f = makeEnv()
  try {
    for (const [override, reason] of [
      [{ MINIMAX_SUBSCRIPTION_KEY: '' }, 'missing_subscription_key'],
      [{ MINIMAX_MODEL: 'unknown' }, 'unsupported_model'],
      [{ MINIMAX_ANTHROPIC_BASE: 'https://unexpected.example' }, 'unsupported_base'],
    ] as const) {
      let calls = 0
      const result = await readQuotaProvider({ ...f.env, ...override }, async () => { calls++; throw Error('unexpected fetch') })
      assert.equal(calls, 0)
      assert.equal(result.payload, null)
      assert.deepEqual(result.transport, { state: 'configuration_invalid', httpStatus: null, reason })
    }
  } finally { f.db.sqlite.close() }
})

test('provider diagnostics retain numeric HTTP status without reading an upstream error body', async () => {
  const f = makeEnv()
  try {
    for (const status of [401, 403, 429, 500]) {
      const response = new Response(`private error ${f.env.MINIMAX_SUBSCRIPTION_KEY}`, { status })
      const report = await readPlanQuotaReport(f.env, async () => response)
      assert.equal(report.state, 'quota_unknown')
      assert.deepEqual(report.providerTransport, { state: 'http_error', httpStatus: status, reason: 'provider_http_error' })
      assert.equal(response.bodyUsed, false)
      assert.ok(!JSON.stringify(report).includes('private error'))
      assert.ok(!JSON.stringify(report).includes(f.env.MINIMAX_SUBSCRIPTION_KEY!))
    }
  } finally { f.db.sqlite.close() }
})

test('provider diagnostics distinguish network, rejected responses and bounded invalid JSON while failing closed', async () => {
  const f = makeEnv()
  try {
    const redirected = quotaResponse(); Object.defineProperty(redirected, 'redirected', { value: true })
    const unexpected = quotaResponse(); Object.defineProperty(unexpected, 'url', { value: 'https://unexpected.example/private-secret' })
    for (const [provider, state, reason] of [
      [async () => { throw new Error(`private ${f.env.MINIMAX_SUBSCRIPTION_KEY}`) }, 'network_unavailable', 'provider_transport_failed'],
      [async () => redirected, 'response_rejected', 'redirect_or_url_mismatch'],
      [async () => new Response('private redirect body', { status: 302, headers: { location: 'https://unexpected.example/private-secret' } }), 'response_rejected', 'redirect_or_url_mismatch'],
      [async () => unexpected, 'response_rejected', 'redirect_or_url_mismatch'],
      [async () => new Response(`invalid private ${f.env.MINIMAX_SUBSCRIPTION_KEY}`), 'unreadable_response', 'invalid_or_oversized_json'],
      [async () => new Response('{}', { headers: { 'content-length': String(129 * 1024) } }), 'unreadable_response', 'invalid_or_oversized_json'],
    ] as const) {
      const report = await readPlanQuotaReport(f.env, provider as typeof fetch)
      assert.equal(report.state, 'quota_unknown')
      assert.equal(report.quota, null)
      assert.equal(report.providerTransport.state, state)
      assert.equal(report.providerTransport.reason, reason)
      assert.ok(!JSON.stringify(report).includes('private'))
      assert.ok(!JSON.stringify(report).includes(f.env.MINIMAX_SUBSCRIPTION_KEY!))
    }
  } finally { f.db.sqlite.close() }
})

test('quota reads use the official CLI API origins with JSON headers and never follow redirects', async () => {
  const f = makeEnv()
  try {
    for (const [base, endpoint] of [
      ['https://api.minimaxi.com/anthropic', 'https://api.minimax.cn/v1/token_plan/remains'],
      ['https://api.minimax.cn/anthropic', 'https://api.minimax.cn/v1/token_plan/remains'],
      ['https://api.minimax.io/anthropic', 'https://api.minimax.io/v1/token_plan/remains'],
    ]) {
      let calls = 0
      const report = await readPlanQuotaReport({ ...f.env, MINIMAX_ANTHROPIC_BASE: base }, async (input, options) => {
        calls++; assert.equal(input, endpoint)
        assert.equal(options?.method, 'GET'); assert.equal(options.redirect, 'manual')
        assert.equal(new Headers(options.headers).get('content-type'), 'application/json')
        return quotaResponse()
      })
      assert.equal(calls, 1)
      assert.equal(report.state, 'observed')
      assert.deepEqual(report.providerTransport, { state: 'received', httpStatus: 200, reason: null })
    }
  } finally { f.db.sqlite.close() }
})
