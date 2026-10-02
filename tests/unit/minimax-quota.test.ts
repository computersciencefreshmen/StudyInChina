import { describe, expect, it, vi } from 'vitest'
import { fetchQuota, getCcSwitchQuotaConfig, normalizeQuota, quotaConfigFromEnvironment, type QuotaApiConfig } from '../../scripts/ingestion/minimax-quota'

const sqlite = vi.hoisted(() => ({ open: vi.fn(), prepare: vi.fn(), get: vi.fn(), close: vi.fn() }))
vi.mock('node:sqlite', () => {
  const DatabaseSync = class {
    constructor(path: string, options: unknown) { sqlite.open(path, options) }
    prepare(query: string) { sqlite.prepare(query); return { get: sqlite.get } }
    close() { sqlite.close() }
  }
  return { DatabaseSync, default: { DatabaseSync } }
})

const now = Date.parse('2026-09-30T11:24:00Z')
const fiveHourStart = Date.parse('2026-09-30T07:00:00Z')
const weeklyStart = Date.parse('2026-09-27T16:00:00Z')
const row = {
  model_name: 'general', start_time: fiveHourStart, end_time: fiveHourStart + 18_000_000,
  remains_time: 2_160_000, current_interval_total_count: 0, current_interval_usage_count: 0,
  current_interval_status: 1, current_interval_remaining_percent: 2,
  current_weekly_total_count: 0, current_weekly_usage_count: 0, current_weekly_status: 3,
  current_weekly_remaining_percent: 100, weekly_start_time: weeklyStart,
  weekly_end_time: weeklyStart + 604_800_000, weekly_remains_time: 363_360_000,
}
const response = (overrides: Record<string, unknown> = {}) => ({
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [{ ...row, ...overrides }, { ...row, model_name: 'video', current_interval_remaining_percent: 100 }],
})
const config: QuotaApiConfig = { endpoint: 'https://www.minimax.cn/v1/token_plan/remains', key: 'test-only-key', model: 'MiniMax-M3' }

describe('MiniMax current-provider quota configuration', () => {
  it('reads only the current Claude provider through a read-only SQLite connection', () => {
    sqlite.open.mockClear()
    sqlite.prepare.mockClear()
    sqlite.close.mockClear()
    sqlite.get.mockReturnValue({
      id: 'provider-test',
      settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'test-only-secret', ANTHROPIC_MODEL: 'MiniMax-M3' } }),
    })
    const selected = getCcSwitchQuotaConfig()
    expect(selected.model).toBe('MiniMax-M3')
    expect(selected.key).toBe('test-only-secret')
    expect(sqlite.open).toHaveBeenCalledWith(expect.stringMatching(/cc-switch\.db$/), { readOnly: true })
    expect(sqlite.prepare).toHaveBeenCalledExactlyOnceWith("SELECT id, settings_config FROM providers WHERE app_type='claude' AND is_current=1")
    expect(sqlite.close).toHaveBeenCalledOnce()
    expect(JSON.stringify(selected)).not.toContain('test-only-secret')
  })
  it('sanitizes broken provider settings and closes the database', () => {
    sqlite.close.mockClear()
    sqlite.get.mockReturnValue({ id: 'provider-test', settings_config: 'private-test-only-secret-invalid-json' })
    expect(() => getCcSwitchQuotaConfig()).toThrow('not a usable official MiniMax provider')
    try { getCcSwitchQuotaConfig() } catch (error) { expect(String(error)).not.toContain('test-only-secret') }
    expect(sqlite.close).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['https://api.minimaxi.com/anthropic', 'https://www.minimax.cn/v1/token_plan/remains'],
    ['https://api.minimax.cn/anthropic/', 'https://www.minimax.cn/v1/token_plan/remains'],
    ['https://api.minimax.io/anthropic', 'https://www.minimax.io/v1/token_plan/remains'],
  ])('maps only an official provider endpoint %s to its documented quota host', (base, endpoint) => {
    const selected = quotaConfigFromEnvironment({ ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'test-only-secret', ANTHROPIC_MODEL: 'MiniMax-M3' }, 'provider-test')
    expect(selected.endpoint).toBe(endpoint)
    expect(selected.key).toBe('test-only-secret')
    expect(JSON.stringify(selected)).not.toContain('test-only-secret')
    expect(JSON.stringify(selected)).not.toContain('key')
  })
  it.each([
    'http://127.0.0.1:1234/anthropic', 'https://other.test/anthropic',
    'https://api.minimax.cn.evil.test/anthropic', 'https://user:secret@api.minimax.cn/anthropic',
    'https://api.minimax.cn:444/anthropic', 'https://api.minimax.cn/anthropic?token=secret',
    'https://api.minimax.cn/anthropic#secret', 'https://api.minimax.cn/unsupported',
  ])('rejects proxies and malformed official endpoints without exposing their text', base => {
    expect(() => quotaConfigFromEnvironment({ ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'test-only-secret' })).toThrow(/official MiniMax/)
    try { quotaConfigFromEnvironment({ ANTHROPIC_BASE_URL: base }) } catch (error) {
      expect(String(error)).not.toContain('secret')
    }
  })
  it('rejects absent credentials, header injection, and non-MiniMax models', () => {
    const base = { ANTHROPIC_BASE_URL: 'https://api.minimax.cn/anthropic' }
    expect(() => quotaConfigFromEnvironment(base)).toThrow('credential')
    expect(() => quotaConfigFromEnvironment({ ...base, ANTHROPIC_AUTH_TOKEN: 'secret\r\nX-Injected: yes' })).toThrow('credential')
    expect(() => quotaConfigFromEnvironment({ ...base, ANTHROPIC_AUTH_TOKEN: 'test-only', ANTHROPIC_MODEL: 'other-provider' })).toThrow('MiniMax text model')
  })
})

describe('MiniMax Token Plan quota normalization', () => {
  it('selects the general text pool and trusts percentages even with zero count fields', () => {
    const quota = normalizeQuota(response(), 'MiniMax-M3', now)
    expect(quota).toMatchObject({ state: 'available', canRun: true, pool: 'general', balanceFallbackAllowed: false, fiveHour: { remainingPercent: 2, resetInMs: 2_160_000 }, weekly: { remainingPercent: 100 } })
    expect(quota.fiveHour.resetAt).toBe('2026-09-30T12:00:00.000Z')
    expect(JSON.stringify(quota)).not.toContain('current_interval_status')
    expect(JSON.stringify(quota)).not.toContain('total_count')
  })
  it.each([
    [{ current_interval_remaining_percent: 0 }, 'five_hour_quota_exhausted'],
    [{ current_weekly_remaining_percent: 0 }, 'weekly_quota_exhausted'],
    [{ current_interval_remaining_percent: 0, current_weekly_remaining_percent: 0 }, 'weekly_quota_exhausted'],
  ])('stops when a plan window is exhausted', (overrides, reason) => {
    expect(normalizeQuota(response(overrides), 'MiniMax-M3', now)).toMatchObject({ state: 'exhausted', canRun: false, reason, balanceFallbackAllowed: false })
  })
  it.each([
    {}, null, { base_resp: { status_code: 1004 }, model_remains: [row] },
    { base_resp: { status_code: 0 }, model_remains: [{ ...row, model_name: 'video' }] },
    { base_resp: { status_code: 0 }, model_remains: [row, row] },
    response({ current_interval_remaining_percent: undefined }),
    response({ current_weekly_remaining_percent: undefined }),
    response({ current_interval_remaining_percent: '2' }),
    response({ current_weekly_remaining_percent: -1 }),
    response({ current_weekly_remaining_percent: 101 }),
    response({ current_interval_remaining_percent: NaN }),
  ])('fails closed for missing, ambiguous, or unknown quota data', payload => {
    expect(normalizeQuota(payload, 'MiniMax-M3', now)).toMatchObject({ state: 'unknown', canRun: false })
  })
  it('does not use positive total/usage counts or status enums as a fallback', () => {
    expect(normalizeQuota(response({ current_interval_remaining_percent: undefined, current_interval_total_count: 1000, current_interval_usage_count: 1, current_interval_status: 1 }), 'MiniMax-M3', now).canRun).toBe(false)
  })
  it.each([
    { end_time: now }, { start_time: now + 1 }, { end_time: fiveHourStart + 3_600_000 },
    { weekly_end_time: now }, { start_time: 'invalid' }, { weekly_start_time: undefined },
  ])('fails closed for an expired or unrecognized window', overrides => {
    expect(normalizeQuota(response(overrides), 'MiniMax-M3', now)).toMatchObject({ state: 'unknown', canRun: false, reason: 'quota_window_unknown_or_expired' })
  })
})

describe('MiniMax read-only quota transport', () => {
  it('sends only GET to the approved official host and refuses redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response())))
    expect(await fetchQuota(config, { fetcher, now: () => now })).toMatchObject({ state: 'available', canRun: true })
    expect(fetcher).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer test-only-key', Accept: 'application/json' } }))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    'https://other.test/v1/token_plan/remains', 'http://www.minimax.cn/v1/token_plan/remains',
    'https://www.minimax.cn/v1/token_plan/remains?token=secret',
    'https://user:secret@www.minimax.cn/v1/token_plan/remains',
    'https://www.minimax.cn/v1/purchase',
  ])('never forwards a credential to an unsupported endpoint %s', async endpoint => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await fetchQuota({ ...config, endpoint }, { fetcher, now: () => now })).toMatchObject({ canRun: false, reason: 'unsafe_quota_configuration' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not expose HTTP error bodies or retry against account balance APIs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-provider-error-test-only-key', { status: 401 }))
    const quota = await fetchQuota(config, { fetcher, now: () => now })
    expect(quota).toMatchObject({ state: 'unknown', canRun: false, reason: 'quota_http_401', balanceFallbackAllowed: false })
    expect(JSON.stringify(quota)).not.toContain('test-only-key')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('fails closed for malformed and oversized response bodies', async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json-test-only-key'))
    expect(await fetchQuota(config, { fetcher: malformed, now: () => now })).toMatchObject({ canRun: false, reason: 'quota_response_json_invalid' })
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1)))
    expect(await fetchQuota(config, { fetcher: oversized, now: () => now })).toMatchObject({ canRun: false, reason: 'quota_query_failed' })
  })
  it('fails closed and sanitizes network exceptions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private test-only-key response'))
    const quota = await fetchQuota(config, { fetcher, now: () => now })
    expect(quota).toMatchObject({ state: 'unknown', canRun: false, reason: 'quota_query_failed' })
    expect(JSON.stringify(quota)).not.toContain('test-only-key')
  })
  it('rejects a redirected response even if a fetch implementation ignores redirect:error', async () => {
    const redirected = new Response(JSON.stringify(response()))
    Object.defineProperty(redirected, 'redirected', { value: true })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(redirected)
    expect(await fetchQuota(config, { fetcher, now: () => now })).toMatchObject({ canRun: false, reason: 'quota_redirect_rejected' })
  })
  it('bounds the timeout and does not invoke a fetch with unsafe options', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await fetchQuota(config, { fetcher, now: () => now, timeoutMs: 120_000 })).toMatchObject({ canRun: false, reason: 'invalid_quota_timeout' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('aborts a slow query and fails closed without retrying a billable endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private test-only-key timeout')), { once: true })
    }))
    const quota = await fetchQuota(config, { fetcher, now: () => now, timeoutMs: 10 })
    expect(quota).toMatchObject({ state: 'unknown', canRun: false, reason: 'quota_timeout' })
    expect(JSON.stringify(quota)).not.toContain('test-only-key')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
