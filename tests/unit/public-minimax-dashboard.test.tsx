import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicMiniMaxDashboard } from '../../src/components/minimax/PublicMiniMaxDashboard'
import { projectPublicMiniMax, publicMonitorCacheSeconds, publicMiniMaxStatusSchema } from '../../src/lib/minimax/public-monitor'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'
// This installed build retains the legacy export name for the same matcher.
import { unstable_doesMiddlewareMatch as doesRouteMatch } from 'next/experimental/testing/server'
import { config } from '../../src/proxy'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const response = (value = projectPublicMiniMax(cloudSnapshot(), CLOUD_NOW)) => ({ ok: true, json: async () => value })

describe('password-free public MiniMax dashboard', () => {
  it('shows actual model/call times separately from queue activity, quota and incomplete coverage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(CLOUD_NOW)
    const source = cloudSnapshot()
    source.ledger!.recentAttempts.push({ attemptId: 'PRIVATE_ID', model: 'MiniMax-M3', status: 'completed',
      startedAt: new Date(CLOUD_NOW - 60000).toISOString(), completedAt: new Date(CLOUD_NOW - 30000).toISOString(), pass: 'independent-review', errorCode: null })
    source.ledger!.coverage = { evaluatedOn: '2026-11-14', stale: false, schools: 295, zero: 295, one: 0, twoToFour: 0, fivePlus: 0, currentPrograms: 0, currentScholarships: 0 }
    source.refill = { format: 'studyinchina.continuous-refill', version: 1, observedAt: new Date(CLOUD_NOW).toISOString(), enabled: true, state: 'running', reason: 'dispatched',
      model: { pending: 8, inflight: 4, eligible: null, limit: 4, epochUsed: 17, epochCap: 256 }, capture: { pending: 1, inflight: 1, eligible: null, limit: 2, epochUsed: 4, epochCap: 64 },
      lastRefillAt: null, nextWakeAt: null, uncertainDeliveries: 0, modelCallsPerformed: false }
    const payload = projectPublicMiniMax(source, CLOUD_NOW)
    // Target-side shared monitor schema is upgraded separately to admit16.
    // This public contract and view already preserve that explicit safe bound.
    payload.processing!.taskConcurrencyLimit = 16
    expect(publicMiniMaxStatusSchema.safeParse(payload).success).toBe(true)
    expect(publicMiniMaxStatusSchema.safeParse({ ...payload, processing: { ...payload.processing, taskConcurrencyLimit: 17 } }).success).toBe(false)
    const fetcher = vi.fn(async () => response(payload))
    vi.stubGlobal('fetch', fetcher)
    render(<PublicMiniMaxDashboard />)
    expect(await screen.findByText('云端账本观测新鲜')).toBeVisible()
    expect(screen.getByText('今日调用尝试').closest('div')).toHaveTextContent('3')
    expect(screen.getByText('今日调用完成').closest('div')).toHaveTextContent('1')
    expect(screen.getByText('72%')).toBeVisible(); expect(screen.getByText('∞')).toBeVisible()
    expect(screen.getByRole('heading', { name: '身份发现 ≠ 条件齐备' })).toBeVisible()
    expect(screen.getByText('至少 5 个完整项目的学校').closest('div')).toHaveTextContent('0 / 295')
    expect(screen.getByText('调用完成 · 已收到响应')).toBeVisible()
    expect(screen.getByText('模型任务并发上限').closest('div')).toHaveTextContent('16')
    expect(screen.getByText(/不是实际 HTTP 并行数/)).toBeVisible()
    expect(screen.getByText('结果未知 · 不重发')).toBeVisible()
    expect(document.body).not.toHaveTextContent('PRIVATE_ID')
    expect(fetcher.mock.calls[0]).toEqual(['/api/minimax/status', { method: 'GET', credentials: 'omit', signal: expect.any(AbortSignal) }])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('polls after45s without overlaps, and visibly ages old evidence when a later request fails', async () => {
    vi.useFakeTimers(); vi.setSystemTime(CLOUD_NOW)
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockRejectedValue(new Error('PRIVATE_PROVIDER_TOKEN'))
    vi.stubGlobal('fetch', fetcher)
    render(<PublicMiniMaxDashboard />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('云端账本观测新鲜')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.getByText('历史观测 · 待更新')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('本次读取未成功')
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(screen.getByText(/额度未知或历史观测/)).toBeVisible()
    expect(document.body).not.toHaveTextContent('PRIVATE_PROVIDER_TOKEN')
  })

  it('keeps missing data unknown and distinguishes an unavailable connection from a zero count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(projectPublicMiniMax(null, CLOUD_NOW))))
    render(<PublicMiniMaxDashboard />)
    await waitFor(() => expect(screen.getByText('云端账本暂不可用')).toBeVisible())
    expect(screen.getAllByText('未知').length).toBeGreaterThan(2)
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.getByText(/完整覆盖快照暂不可用/)).toBeVisible()
  })

  it('excludes the exact public route from locale redirects, while retaining normal page routing', () => {
    for (const url of ['/minimax', '/minimax/', '/api/minimax/status', '/admin']) expect(doesRouteMatch({ config, url })).toBe(false)
    expect(doesRouteMatch({ config, url: '/programs' })).toBe(true)
    expect(doesRouteMatch({ config, url: '/minimax-other' })).toBe(true)
  })

  it('expires CDN caching before a quota reset or stale-evidence boundary', () => {
    const source = cloudSnapshot(); source.quota.fiveHour!.resetAt = new Date(CLOUD_NOW + 900).toISOString()
    expect(publicMonitorCacheSeconds(projectPublicMiniMax(source, CLOUD_NOW), CLOUD_NOW)).toBe(0)
    const ledger = cloudSnapshot(); ledger.ledger!.observedAt = new Date(CLOUD_NOW - 119_100).toISOString()
    expect(publicMonitorCacheSeconds(projectPublicMiniMax(ledger, CLOUD_NOW), CLOUD_NOW)).toBe(0)
  })
})
