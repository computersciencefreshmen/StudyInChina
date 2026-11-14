import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'
import { cloudMiniMaxSchema, quotaObservationIsCurrent } from '../../src/lib/admin/cloud-minimax-contract'
const cfg = vi.hoisted(() => ({ value: { telemetryUrl: 'https://catalog.example.workers.dev/internal/v1/admin-telemetry', token: 'test-existing-server-telemetry-token-not-a-real-secret' } as { telemetryUrl: string; token: string } | null }))
vi.mock('../../src/lib/admin/remote-executor', () => ({ remoteExecutorConfiguration: () => cfg.value }))
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(CLOUD_NOW); vi.resetModules(); cfg.value = { telemetryUrl: 'https://catalog.example.workers.dev/internal/v1/admin-telemetry', token: 'test-existing-server-telemetry-token-not-a-real-secret' } })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('server-only cloud monitor transport', () => {
  it('uses the existing private token on a fixed read-only route, coalesces fetches and refreshes after45s', async () => {
    const fetcher = vi.fn(async () => Response.json(cloudSnapshot())); vi.stubGlobal('fetch', fetcher)
    const { readCloudMiniMax } = await import('../../src/lib/admin/cloud-minimax')
    expect((await Promise.all([readCloudMiniMax(), readCloudMiniMax()]))[0]?.ledgerState).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://catalog.example.workers.dev/internal/v1/admin-minimax-monitor', expect.objectContaining({ headers: { Authorization: `Bearer ${cfg.value!.token}` }, cache: 'no-store', redirect: 'error' }))
    await readCloudMiniMax(); expect(fetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(CLOUD_NOW + 46_000); await readCloudMiniMax(); expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('keeps original observation timestamps after failures and never leaks transport errors or credentials', async () => {
    const fetcher = vi.fn(async () => Response.json(cloudSnapshot())); vi.stubGlobal('fetch', fetcher)
    const { readCloudMiniMax } = await import('../../src/lib/admin/cloud-minimax')
    const first = await readCloudMiniMax()
    fetcher.mockRejectedValue(new Error('private provider secret in error')); vi.setSystemTime(CLOUD_NOW + 46_000)
    const stale = await readCloudMiniMax()
    expect(stale?.ledgerState).toBe('stale'); expect(stale?.ledger?.observedAt).toBe(first?.ledger?.observedAt); expect(stale?.quota.observedAt).toBe(first?.quota.observedAt)
    expect(JSON.stringify(stale)).not.toContain('private provider'); expect(JSON.stringify(stale)).not.toContain(cfg.value!.token)
  })
  it('rejects oversized, non-contract, future snapshots and missing configuration without affecting authentication', async () => {
    const fetcher = vi.fn(async () => new Response('x', { headers: { 'content-length': '999999' } })); vi.stubGlobal('fetch', fetcher)
    const { readCloudMiniMax } = await import('../../src/lib/admin/cloud-minimax')
    expect(await readCloudMiniMax()).toBeNull()
    cfg.value = null; expect(await readCloudMiniMax()).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cloudMiniMaxSchema.safeParse({ ...cloudSnapshot(), providerApiKey: 'never' }).success).toBe(false)
    expect(quotaObservationIsCurrent(cloudSnapshot().quota, Date.parse(cloudSnapshot().quota.fiveHour!.resetAt))).toBe(false)
  })
})
