import { afterEach, describe, expect, it, vi } from 'vitest'
import { readQuotaSnapshot } from '../../workers/catalog-maintenance/src/quota-monitor-reader'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'
import { CLOUD_NOW } from '../fixtures/cloud-minimax'
const env = () => ({ MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_SUBSCRIPTION_KEY: 'test-only-subscription-not-a-real-key', MINIMAX_ANTHROPIC_BASE: 'https://api.minimaxi.com/anthropic' }) as MaintenanceEnv
const quota = () => Response.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_status: 1, current_interval_remaining_percent: 76, start_time: CLOUD_NOW - 3600000, end_time: CLOUD_NOW + 4 * 3600000, current_weekly_status: 3 }] })
afterEach(() => vi.useRealTimers())
describe('provider monitoring cache independent of paid admission', () => {
  it('deduplicates quota reads and returns stale original observations after failure without inventing a balance', async () => {
    vi.useFakeTimers(); vi.setSystemTime(CLOUD_NOW)
    const e = env(), fetcher = vi.fn(async (url: RequestInfo | URL) => { expect(String(url)).toBe('https://api.minimax.cn/v1/token_plan/remains'); return quota() })
    const values = await Promise.all(Array.from({ length: 6 }, () => readQuotaSnapshot(e, fetcher, CLOUD_NOW)))
    expect(fetcher).toHaveBeenCalledTimes(1); expect(values[0].state).toBe('fresh'); expect(values[0].weekly?.unlimited).toBe(true)
    vi.setSystemTime(CLOUD_NOW + 46_000); fetcher.mockRejectedValue(new Error('secret must not escape'))
    const failed = await readQuotaSnapshot(e, fetcher, CLOUD_NOW + 46_000)
    expect(failed.state).toBe('stale'); expect(failed.observedAt).toBe(values[0].observedAt); expect(failed.checkedAt).toBe(new Date(CLOUD_NOW + 46_000).toISOString())
    expect(JSON.stringify(failed)).not.toContain('secret'); expect(JSON.stringify(failed)).not.toContain(e.MINIMAX_SUBSCRIPTION_KEY!)
    await readQuotaSnapshot(e, fetcher, CLOUD_NOW + 50_000); expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => String(url) === 'https://api.minimax.cn/v1/token_plan/remains')).toBe(true)
  })
  it('holds frozen source RPC without any provider request or persistence', async () => {
    const e = env(); e.MODEL_STATE_MIGRATION_ROLE = 'source'
    const fetcher = vi.fn(async () => quota()), value = await readQuotaSnapshot(e, fetcher, CLOUD_NOW)
    expect(value.state).toBe('unknown'); expect(value.modelCallsPerformed).toBe(false); expect(fetcher).not.toHaveBeenCalled()
  })
})
