import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCloudflareBillingUsage, readCloudflareBillingUsage, type BillingUsageEnv, type BillingUsageUnknownCode } from '../src/billing-usage'

const account = '0123456789abcdef0123456789abcdef', token = 'test-only-billing-token-not-a-secret'
const now = Date.parse('2026-11-13T12:00:00Z'), start = '2026-11-01T00:00:00Z'
const env: BillingUsageEnv = { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_BILLING_READ_TOKEN: token }
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/billable-usage`
function row(overrides: Record<string, unknown> = {}) {
  return { BillingAccountId: account, BillingCurrency: 'USD', BillingPeriodStart: start, ChargeCategory: 'Usage',
    ChargeDescription: 'Workers Standard requests', ChargePeriodStart: start, ChargePeriodEnd: '2026-11-02T00:00:00Z',
    ContractedCost: 0.1, CumulatedContractedCost: 100, ServiceName: 'Workers Standard', PricingUnit: 'Requests', ConsumedUnit: 'Requests',
    SubscriptionId: 'test-subscription', ...overrides }
}
const payload = (rows: unknown[] = [row()]) => ({ success: true, errors: [], messages: [], result: rows })
const parse = (value: unknown) => parseCloudflareBillingUsage(value, account, now)
function expectedUnknown(value: unknown, code: BillingUsageUnknownCode) { assert.deepEqual(parse(value), { state: 'unknown', code }) }
const fetchResponse = (response: Response): typeof fetch => async () => response
const observed = (usageMicroDollars: number) => ({ state: 'observed', observedAt: new Date(now).toISOString(),
  periodStart: '2026-11-01T00:00:00.000Z', periodEnd: null, periodEndObserved: false, currency: 'USD', usageMicroDollars })

test('sums daily ContractedCost exactly and never sums daily cumulative totals', () => {
  assert.deepEqual(parse(payload([row(), row({ ChargePeriodStart: '2026-11-02T00:00:00Z', ChargePeriodEnd: '2026-11-03T00:00:00Z',
    ContractedCost: 0.2, CumulatedContractedCost: 200 })])), observed(300000))
})
test('sub-micro and exponent amounts accumulate before one conservative upward rounding', () => {
  assert.deepEqual(parse(payload([row({ ContractedCost: 4e-7 }), row({ ServiceName: 'D1', ContractedCost: 4e-7 })])), observed(1))
  assert.deepEqual(parse(payload([row({ ContractedCost: 1e-7 }), row({ ServiceName: 'D1', ContractedCost: 9e-7 })])), observed(1))
  assert.deepEqual(parse(payload([row({ ContractedCost: 1e-8 })])), observed(1))
})
test('a complete real zero-cost row is observed zero; missing observations never imply zero', () => {
  assert.deepEqual(parse(payload([row({ ContractedCost: 0 })])), observed(0))
  expectedUnknown(payload([]), 'billing_rows_unobserved')
})
test('the official absent billing-period end remains unobserved, regardless of daily charge end', () => {
  const result = parse(payload())
  assert.deepEqual(result, observed(100000))
  assert.equal(JSON.stringify(result).includes('2026-11-02'), false)
})
test('matching timestamps with different UTC offsets belong to the same proven period', () => {
  assert.deepEqual(parse(payload([row(), row({ ServiceName: 'D1', BillingPeriodStart: '2026-11-01T08:00:00+08:00' })])), observed(200000))
})
test('distinct service, subscription, and zone dimensions do not lose real charges', () => {
  assert.deepEqual(parse(payload([row(), row({ ServiceName: 'D1' }), row({ SubscriptionId: 'another-subscription' }), row({ ZoneId: 'test-zone' })])), observed(400000))
})
test('out-of-order adjacent charge windows are counted once each', () => {
  assert.deepEqual(parse(payload([row({ ChargePeriodStart: '2026-11-02T00:00:00Z', ChargePeriodEnd: '2026-11-03T00:00:00Z' }), row()])), observed(200000))
})
for (const change of ['exact', 'different-cost', 'overlap'] as const) test(`ambiguous ${change} repeated charges are unknown`, () => {
  const duplicate = change === 'exact' ? row() : change === 'different-cost' ? row({ ContractedCost: 4 })
    : row({ ChargePeriodStart: '2026-11-01T12:00:00Z', ChargePeriodEnd: '2026-11-02T12:00:00Z' })
  expectedUnknown(payload([row(), duplicate]), 'billing_row_duplicate_or_overlapping')
})
for (const currency of ['EUR', '', null, undefined, 1]) test(`unsupported/missing currency ${String(currency)} is unknown`, () => {
  expectedUnknown(payload([row({ BillingCurrency: currency })]), 'billing_currency_unsupported')
})
for (const amount of [undefined, null, '0.1', -0.1, NaN, Infinity, 100000000000]) test(`invalid cost ${String(amount)} cannot become zero`, () => {
  expectedUnknown(payload([row({ ContractedCost: amount })]), 'billing_cost_invalid')
})
test('a sum too large for safe integer micro-dollars is unknown', () => {
  expectedUnknown(payload([row({ ContractedCost: 9000000000 }), row({ ServiceName: 'D1', ContractedCost: 9000000000 })]), 'billing_cost_invalid')
})
test('a different account cannot supply the budget observation', () => {
  expectedUnknown(payload([row({ BillingAccountId: 'f'.repeat(32) })]), 'billing_account_mismatch')
})
for (const period of [undefined, 'not-a-date', '2026-02-30T00:00:00Z', '2026-11-14T00:00:00Z']) test(`unproven period ${String(period)} is unknown`, () => {
  expectedUnknown(payload([row({ BillingPeriodStart: period })]), 'billing_period_unproven')
})
test('multiple billing-period starts cannot be silently combined', () => {
  expectedUnknown(payload([row(), row({ ServiceName: 'D1', BillingPeriodStart: '2026-10-31T00:00:00Z' })]), 'billing_period_mixed')
})
for (const change of [
  { ChargePeriodStart: '2026-10-31T00:00:00Z' }, { ChargePeriodEnd: '2026-11-14T00:00:00Z' },
  { ChargePeriodEnd: start }, { ChargePeriodStart: 'not-a-date' }, { ChargeCategory: 'Purchase' },
  { ServiceName: '' }, { ChargeDescription: null }, { PricingUnit: undefined }, { ConsumedUnit: null }, { SubscriptionId: 123 },
]) test(`incomplete/invalid charge evidence ${JSON.stringify(change)} is unknown`, () => {
  expectedUnknown(payload([row(change)]), 'billing_row_invalid')
})
for (const value of [null, [], {}, { ...payload(), success: false }, { ...payload(), errors: [{ message: token }] },
  { ...payload(), errors: null }, { ...payload(), result: null }]) test('an invalid API envelope remains unknown', () => {
  expectedUnknown(value, 'billing_response_invalid')
})
test('only the fixed current-period GET is called, with manual redirects and a 20-second signal', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (input, init) => {
    calls++
    assert.equal(String(input), endpoint)
    assert.equal(new URL(String(input)).search, '')
    assert.equal(init?.method, 'GET')
    assert.equal(init?.redirect, 'manual')
    assert.equal(init?.cache, 'no-store')
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`)
    assert.equal(new Headers(init?.headers).get('accept'), 'application/json')
    assert.equal(init?.body, undefined)
    assert.equal(init?.signal?.aborted, false)
    return Response.json(payload())
  }
  assert.deepEqual(await readCloudflareBillingUsage(env, fetcher, now), observed(100000))
  assert.equal(calls, 1)
})
for (const invalid of [{}, { ...env, CLOUDFLARE_ACCOUNT_ID: '../not-an-account' }, { ...env, CLOUDFLARE_ACCOUNT_ID: `${account}?extra=1` },
  { ...env, CLOUDFLARE_BILLING_READ_TOKEN: '' }, { ...env, CLOUDFLARE_BILLING_READ_TOKEN: `${token}\nInjected: value` }]) {
  test('invalid configuration never causes an outbound request', async () => {
    let calls = 0
    const result = await readCloudflareBillingUsage(invalid, async () => { calls++; throw new Error('must not fetch') }, now)
    assert.deepEqual(result, { state: 'unknown', code: 'billing_configuration_invalid' })
    assert.equal(calls, 0)
  })
}
for (const status of [301, 302, 303, 307, 308]) test(`HTTP ${status} is refused without reading or following its credentialed redirect`, async () => {
  let calls = 0
  const response = new Response(null, { status, headers: { location: 'https://attacker.invalid/' } })
  Object.defineProperty(response, 'body', { get() { throw new Error('redirect body must not be read') } })
  const fetcher: typeof fetch = async () => { calls++; return response }
  assert.deepEqual(await readCloudflareBillingUsage(env, fetcher, now), { state: 'unknown', code: 'billing_redirect_rejected' })
  assert.equal(calls, 1)
})
test('response URL drift and an already-followed response are refused', async () => {
  for (const property of ['url', 'redirected'] as const) {
    const response = Response.json(payload())
    Object.defineProperty(response, property, { value: property === 'url' ? 'https://attacker.invalid/' : true })
    assert.deepEqual(await readCloudflareBillingUsage(env, fetchResponse(response), now), { state: 'unknown', code: 'billing_redirect_rejected' })
  }
})
for (const status of [401, 403, 429, 500]) test(`HTTP ${status} exposes only a fixed code`, async () => {
  const response = new Response(`${token} ${account} raw provider error`, { status })
  const result = await readCloudflareBillingUsage(env, fetchResponse(response), now)
  assert.deepEqual(result, { state: 'unknown', code: 'billing_http_error' })
  assert.equal(JSON.stringify(result).includes(token), false)
  assert.equal(JSON.stringify(result).includes(account), false)
})
test('transport errors containing credentials never escape', async () => {
  const result = await readCloudflareBillingUsage(env, async () => { throw new Error(`${token}/${account}`) }, now)
  assert.deepEqual(result, { state: 'unknown', code: 'billing_transport_failed' })
})
for (const response of [new Response('not json', { headers: { 'content-type': 'application/json' } }),
  new Response('{}', { headers: { 'content-type': 'text/html' } }), new Response(null, { headers: { 'content-type': 'application/json' } }),
  new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) } }),
  new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
  test('non-JSON, empty, invalid UTF-8 and oversized bodies remain unreadable', async () => {
    assert.deepEqual(await readCloudflareBillingUsage(env, fetchResponse(response), now), { state: 'unknown', code: 'billing_response_unreadable' })
  })
}
test('an observed report contains no account ID, subscription ID, raw provider fields or token', async () => {
  const result = await readCloudflareBillingUsage(env, fetchResponse(Response.json(payload())), now)
  assert.deepEqual(result, observed(100000))
  const serialized = JSON.stringify(result)
  for (const secret of [account, token, 'test-subscription', 'BillingAccountId', 'ContractedCost']) assert.equal(serialized.includes(secret), false)
})
