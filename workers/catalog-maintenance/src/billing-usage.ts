import { readBoundedBody } from '../../ingestion/src/body'

export type BillingUsageEnv = { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_BILLING_READ_TOKEN?: string }
export type BillingUsageUnknownCode = 'billing_configuration_invalid' | 'billing_transport_failed' | 'billing_http_error'
  | 'billing_redirect_rejected' | 'billing_response_unreadable' | 'billing_response_invalid' | 'billing_rows_unobserved'
  | 'billing_account_mismatch' | 'billing_currency_unsupported' | 'billing_period_unproven' | 'billing_period_mixed'
  | 'billing_row_invalid' | 'billing_row_duplicate_or_overlapping' | 'billing_cost_invalid'
export type BillingUsageObservation = {
  state: 'observed'; observedAt: string; periodStart: string; periodEnd: null; periodEndObserved: false;
  currency: 'USD'; usageMicroDollars: number
} | { state: 'unknown'; code: BillingUsageUnknownCode }

const ACCOUNT = /^[a-f0-9]{32}$/iu
const MAX_BYTES = 1024 * 1024
const MAX_ROWS = 10000
const unknown = (code: BillingUsageUnknownCode): BillingUsageObservation => ({ state: 'unknown', code })
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
const validNow = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  // Date.parse normalizes impossible calendar dates, such as February 30.
  const day = value.slice(0, 10), calendar = new Date(`${day}T00:00:00Z`)
  return calendar.toISOString().slice(0, 10) === day ? time : null
}

// JSON numbers can contain fractions below one micro-dollar. Accumulate their
// decimal representation exactly, then round the complete total upward once.
// This avoids float addition at the pause threshold and per-row rounding drift.
function decimalCost(value: unknown): { digits: bigint; places: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 1000000) return null
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const places = fraction.length - Number(exponent), digits = BigInt(whole + fraction)
  return places < 0 ? { digits: digits * 10n ** BigInt(-places), places: 0 } : { digits, places }
}

/** Official V1 returns the current billing period when no query is supplied.
 * Its schema explicitly has BillingPeriodStart but no BillingPeriodEnd. Do not
 * invent that end from daily ChargePeriodEnd or assume a calendar-month anchor.
 * The observation can stop further work; it cannot prove a future reset date.
 * https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/get_account_usage_v1/
 */
export function parseCloudflareBillingUsage(payload: unknown, expectedAccountId: string, now = Date.now()): BillingUsageObservation {
  if (!ACCOUNT.test(expectedAccountId) || !validNow(now)) return unknown('billing_configuration_invalid')
  const root = record(payload)
  if (!root || root.success !== true || !Array.isArray(root.errors) || root.errors.length > 0 || !Array.isArray(root.result)) return unknown('billing_response_invalid')
  if (root.result.length === 0) return unknown('billing_rows_unobserved')
  if (root.result.length > MAX_ROWS) return unknown('billing_response_invalid')
  let periodStart: number | null = null, digits = 0n, places = 0
  const intervals = new Map<string, Array<{ start: number; end: number }>>()
  for (const item of root.result) {
    const row = record(item)
    if (!row) return unknown('billing_row_invalid')
    if (typeof row.BillingAccountId !== 'string' || !ACCOUNT.test(row.BillingAccountId) || row.BillingAccountId.toLowerCase() !== expectedAccountId.toLowerCase()) return unknown('billing_account_mismatch')
    if (row.BillingCurrency !== 'USD') return unknown('billing_currency_unsupported')
    const start = instant(row.BillingPeriodStart), from = instant(row.ChargePeriodStart), to = instant(row.ChargePeriodEnd)
    if (start === null || start > now) return unknown('billing_period_unproven')
    if (periodStart !== null && start !== periodStart) return unknown('billing_period_mixed')
    periodStart = start
    if (from === null || to === null || from < start || from >= to || to > now) return unknown('billing_row_invalid')
    if (row.ChargeCategory !== 'Usage' || !text(row.ServiceName) || !text(row.ChargeDescription) || !text(row.PricingUnit)
      || typeof row.ConsumedUnit !== 'string' || row.ConsumedUnit.length > 2048
      || row.SubscriptionId !== undefined && row.SubscriptionId !== null && !text(row.SubscriptionId)
      || row.ZoneId !== undefined && row.ZoneId !== null && !text(row.ZoneId)) return unknown('billing_row_invalid')
    // V1 has no unique row ID. Ambiguous repeated/overlapping consumption for
    // the same documented dimensions is unknown, rather than counted twice or
    // silently deduplicated. Distinct products, units, subscriptions and zones
    // remain independent rows.
    const key = JSON.stringify([row.ServiceName, row.ChargeDescription, row.PricingUnit, row.ConsumedUnit, row.SubscriptionId ?? null, row.ZoneId ?? null])
    const existing = intervals.get(key) ?? []
    existing.push({ start: from, end: to }); intervals.set(key, existing)
    const amount = decimalCost(row.ContractedCost)
    if (!amount) return unknown('billing_cost_invalid')
    if (amount.places > places) { digits *= 10n ** BigInt(amount.places - places); places = amount.places }
    digits += amount.digits * 10n ** BigInt(places - amount.places)
  }
  for (const windows of intervals.values()) {
    windows.sort((a, b) => a.start - b.start || a.end - b.end)
    if (windows.some((window, index) => index > 0 && window.start < windows[index - 1].end)) return unknown('billing_row_duplicate_or_overlapping')
  }
  const denominator = 10n ** BigInt(places), micro = (digits * 1000000n + denominator - 1n) / denominator
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) return unknown('billing_cost_invalid')
  return { state: 'observed', observedAt: new Date(now).toISOString(), periodStart: new Date(periodStart!).toISOString(),
    periodEnd: null, periodEndObserved: false, currency: 'USD', usageMicroDollars: Number(micro) }
}

/** Safe read-only official endpoint. Responses and caught errors never escape
 * through diagnostics: no account ID, token, raw body or provider message. */
export async function readCloudflareBillingUsage(env: BillingUsageEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<BillingUsageObservation> {
  const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_BILLING_READ_TOKEN
  if (typeof account !== 'string' || !ACCOUNT.test(account) || typeof token !== 'string' || token.length === 0 || token.length > 4096 || /[^\x21-\x7e]/u.test(token)
    || !validNow(now)) return unknown('billing_configuration_invalid')
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account.toLowerCase()}/billable-usage`
  const signal = AbortSignal.timeout(20000)
  try {
    const response = await fetcher(endpoint, { method: 'GET', redirect: 'manual', cache: 'no-store', signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== endpoint) return unknown('billing_redirect_rejected')
    if (!response.ok) return unknown('billing_http_error')
    if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) return unknown('billing_response_unreadable')
    let payload: unknown
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBody(response, MAX_BYTES, signal))) }
    catch { return unknown('billing_response_unreadable') }
    return parseCloudflareBillingUsage(payload, account, now)
  } catch { return unknown('billing_transport_failed') }
}
