import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminDashboard } from '@/components/admin/AdminDashboard'
import { AdminWorkbench } from '@/components/admin/AdminWorkbench'
import { MiniMaxAutomationPanel } from '@/components/admin/MiniMaxAutomationPanel'
import { MiniMaxUsagePanel } from '@/components/admin/MiniMaxUsagePanel'
import type { AdminUsageLedger, ExecutorStatus, TokenLedgerTotals } from '@/lib/admin/types'
import { adminSession, adminSnapshot } from '../fixtures/admin-workbench'

const usage = (tokens = 0): TokenLedgerTotals => ({ attempts: 12, instrumentedAttempts: 10, historicalResponses: 2, unknownUsageAttempts: 1, reportedTokens: tokens, instrumentedReportedTokens: tokens - 1000, historicalReportedTokensLowerBound: 1000, inputTokens: tokens - 2000, uncachedInputTokens: tokens - 2500, outputTokens: 2000, cacheReadTokens: 400, cacheWriteTokens: 100, reasoningTokens: 300 })
const ledger = (): AdminUsageLedger => ({ generatedAt: '2026-10-02T09:00:00Z', timezone: 'Asia/Shanghai', todayDay: '2026-10-02', dailyTarget: 144000000, totals: usage(15000000), daily: [{ ...usage(9000000), day: '2026-10-02' }, { ...usage(6000000), day: '2026-10-01' }], rejectedReceipts: 0, conflictingAttempts: 0 })
const executor = (overrides: Partial<ExecutorStatus> = {}): ExecutorStatus => ({ executorId: 'main', observedAt: new Date().toISOString(), connected: true, desiredState: 'running', phase: 'baseline', reason: 'active_verifier', baselineRunId: '9dd414cb9cb419af', runnerAlive: true, supervisorAlive: true, activeVerifierCount: 1, controlAcknowledgedAt: null, pauseMayHaveInFlightRequest: false, creditFallbackAuthorized: true, policyReloadPending: true, keepAwake: true, quota: { state: 'available', checkedAt: '2026-10-02T09:00:00Z', fiveHourRemainingPercent: 44, weeklyRemainingPercent: 100, resetAt: '2026-10-02T12:00:00Z' }, latestCommand: null, ...overrides })
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value })
class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, (event: MessageEvent) => void>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeEventSource.instances.push(this) }
  addEventListener(type: string, callback: (event: MessageEvent) => void) { this.listeners.set(type, callback) }
  snapshot(value: unknown) { this.listeners.get('snapshot')?.({ data: JSON.stringify(value) } as MessageEvent) }
}
beforeEach(() => { FakeEventSource.instances = []; vi.stubGlobal('EventSource', FakeEventSource); document.documentElement.dataset.theme = 'cloud' })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('MiniMax immutable usage dashboard', () => {
  it('shows today and cumulative receipts separately, counts unknown attempts, and avoids treating the target as a cap', () => {
    render(<MiniMaxUsagePanel ledger={ledger()} stale={false} />)
    expect(screen.getByText('今日已记录 Token').closest('div')).toHaveTextContent('9,000,000')
    expect(screen.getByText('累计已记录 Token').closest('div')).toHaveTextContent('15,000,000')
    expect(screen.getByText('今日用量未知的尝试').closest('div')).toHaveTextContent('累计 1 次，未计入 Token')
    const progress = screen.getByRole('progressbar', { name: '今日 Token 工作目标进度' })
    expect(progress).toHaveAttribute('aria-valuenow', '6.25')
    expect(screen.getByText(/达到目标后可继续处理任务/)).toBeVisible()
    expect(screen.getByText(/旧响应恢复的历史记录仅为下限/)).toHaveTextContent('Token Plan 扣减及剩余积分可能不同')
    expect(screen.getByText('缓存读取').closest('div')).toHaveTextContent('400')
    expect(screen.getByRole('table')).toHaveTextContent('2026-10-02')
  })

  it('keeps recorded consumption beyond the daily goal visible while clamping only the progress bar', () => {
    const value = ledger(); value.daily[0] = { ...usage(288000000), day: value.todayDay }
    render(<MiniMaxUsagePanel ledger={value} stale />)
    expect(screen.getByText('今日已记录 Token').closest('div')).toHaveTextContent('288,000,000')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringContaining('200.00%'))
    expect(screen.getByText('记录待更新')).toBeVisible()
  })

  it('uses ledger today in overview and keeps saved response figures as a separately labelled batch reference', () => {
    const snapshot = adminSnapshot(); snapshot.ledger = ledger()
    render(<AdminDashboard snapshot={snapshot} connection="live" />)
    const overview = screen.getByRole('heading', { name: 'Token 用量' }).closest('article')!
    expect(overview.querySelector('strong')).toHaveTextContent('9,000,000')
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByRole('region', { name: 'MiniMax 调用回执' })).toBeVisible()
    const saved = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    expect(saved).toHaveTextContent('仅供批次参考')
    expect(saved.querySelector('strong')).toHaveTextContent('15,000')
  })

  it('never shows ledger counts when telemetry is unavailable', () => {
    const snapshot = adminSnapshot(); snapshot.ledger = ledger(); snapshot.telemetry = { source: 'unavailable', observedAt: null, stale: true }
    render(<AdminDashboard snapshot={snapshot} connection="offline" />)
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.queryByRole('region', { name: 'MiniMax 调用回执' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '用量总览' }).closest('article')?.querySelector('strong')).toHaveTextContent('—')
  })

  it('does not turn a missing daily receipt or an all-unknown day into zero consumption', () => {
    const value = ledger(); value.daily = []
    const { rerender } = render(<MiniMaxUsagePanel ledger={value} stale={false} />)
    expect(screen.getByText('今日已记录 Token').closest('div')).toHaveTextContent('—')
    expect(screen.getByText('今日用量未知的尝试').closest('div')?.querySelector('strong')).toHaveTextContent('—')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    value.daily = [{ ...usage(0), day: value.todayDay, inputTokens: 0, outputTokens: 0, instrumentedReportedTokens: 0, historicalReportedTokensLowerBound: 0, unknownUsageAttempts: 12 }]
    rerender(<MiniMaxUsagePanel ledger={value} stale={false} />)
    expect(screen.getByText('今日已记录 Token').closest('div')).toHaveTextContent('—')
    expect(screen.getByText('今日用量未知的尝试').closest('div')).toHaveTextContent('12')
    const row = screen.getByRole('rowheader', { name: value.todayDay }).closest('tr')!
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('—')
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('12 次')
  })

  it('preserves an explicitly reported zero in valid receipts while masking missing usage', () => {
    const value = ledger()
    const zero = { ...usage(0), attempts: 1, instrumentedAttempts: 1, historicalResponses: 0, unknownUsageAttempts: 0, inputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, instrumentedReportedTokens: 0, historicalReportedTokensLowerBound: 0 }
    value.totals = zero
    value.daily = [{ ...zero, day: value.todayDay }]
    render(<MiniMaxUsagePanel ledger={value} stale={false} />)
    expect(screen.getByText('今日已记录 Token').closest('div')?.querySelector('strong')).toHaveTextContent(/^0$/)
    expect(screen.getByText('累计已记录 Token').closest('div')?.querySelector('strong')).toHaveTextContent(/^0$/)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    const row = screen.getByRole('rowheader', { name: value.todayDay }).closest('tr')!
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent(/^0$/)
  })

  it('labels immutable cumulative usage independently from saved batch response lower bounds', () => {
    const snapshot = adminSnapshot(); snapshot.ledger = ledger(); snapshot.usageBasis = 'immutable-ledger'
    Object.assign(snapshot.usage, { totalTokens: 15000000, inputTokens: 14998000, outputTokens: 2000, requests: 12 })
    render(<AdminDashboard snapshot={snapshot} connection="live" />)
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const total = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    expect(total).toHaveTextContent('累计调用回执 · 每次调用独立记账')
    expect(total.querySelector('strong')).toHaveTextContent('15,000,000')
    expect(screen.getByRole('heading', { name: '按核验批次' }).closest('article')).toHaveTextContent('15,000')
    expect(total).not.toHaveTextContent('这里只统计当前仍保存的响应')
  })

  it('shows unknown usage when an executor is connected but has no valid usage receipt', () => {
    const snapshot = adminSnapshot(); Object.assign(snapshot.usage, { totalTokens: 0, inputTokens: 0, outputTokens: 0, requests: 0, lastResponseAt: null })
    render(<AdminDashboard snapshot={snapshot} connection="live" />)
    const overview = screen.getByRole('heading', { name: 'Token 用量' }).closest('article')!
    expect(overview.querySelector('strong')).toHaveTextContent('—')
    expect(overview).toHaveTextContent('执行器已连接，用量尚未报告')
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByRole('heading', { name: '用量总览' }).closest('article')?.querySelector('strong')).toHaveTextContent('—')
  })

  it('switches all five themes while keeping the real telemetry and selected section', () => {
    const snapshot = adminSnapshot(); snapshot.ledger = ledger()
    render(<AdminDashboard snapshot={snapshot} connection="live" />)
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const choices = screen.getByRole('group', { name: '管理员五主题切换' })
    expect(within(choices).getAllByRole('button')).toHaveLength(5)
    for (const [id, name] of [['cloud', '云白淡紫'], ['jade', '雾绿玉色'], ['ocean', '冰川蓝'], ['sand', '暖白陶色'], ['night', '深夜墨绿']]) {
      const button = within(choices).getByRole('button', { name: new RegExp(name) })
      fireEvent.click(button)
      expect(document.documentElement.dataset.theme).toBe(id)
      expect(localStorage.getItem('studycn-theme')).toBe(id)
      expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('heading', { name: 'Token 用量' })).toBeVisible()
      expect(screen.getByText('今日已记录 Token').closest('div')).toHaveTextContent('9,000,000')
    }
    localStorage.clear()
  })
})

describe('MiniMax executor controls', () => {
  it('disables pause and resume before submission when the connection is read-only', () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor(); snapshot.capabilities.automationControl = false
    const action = vi.fn(async () => {})
    render(<AdminDashboard snapshot={snapshot} connection="live" onAutomationAction={action} />)
    const panel = screen.getByRole('region', { name: '自动化执行' })
    expect(panel).toHaveTextContent('只读监控模式')
    expect(within(panel).getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: '恢复自动推进' })).toBeDisabled()
    fireEvent.click(within(panel).getByRole('button', { name: '暂停后续任务' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('separates authorization from policy handoff and disables stale control', () => {
    const action = vi.fn(async () => {})
    render(<MiniMaxAutomationPanel status={executor()} stale online onAction={action} />)
    expect(screen.getByText('Token Plan 优先，耗尽后可用现有积分')).toBeVisible()
    expect(screen.getByText('积分授权已保存，运行中任务正在等待策略交接。')).toBeVisible()
    expect(screen.getByText(/5 小时套餐剩余 44%/)).toHaveTextContent('周套餐剩余 100%')
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('shows a pending pause without claiming an in-flight API request is already stopped', () => {
    const status = executor({ desiredState: 'paused', pauseMayHaveInFlightRequest: true, latestCommand: { commandId: 'pending-pause', action: 'pause', status: 'claimed', updatedAt: new Date().toISOString(), error: null } })
    render(<MiniMaxAutomationPanel status={status} stale={false} online commandId="pending-pause" onAction={vi.fn(async () => {})} />)
    expect(screen.getByText('正在暂停新调用')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('执行器处理中')
    expect(screen.getByRole('button', { name: '恢复自动推进' })).toBeDisabled()
    expect(screen.getByText(/已发出的请求可能完成并继续记录用量/)).toBeVisible()
  })

  it('submits an authenticated command and waits for its matching executor receipt before reenabling controls', async () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor()
    const commandId = '3bb5ffbf-854a-4da5-9dcf-e46242c43221'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(commandId)
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession : path === '/api/admin/automation' && init?.method === 'POST' ? { accepted: true } : snapshot, path === '/api/admin/automation' ? 202 : 200))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].onopen?.())
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/automation', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ commandId, action: 'pause' }) })))
    await screen.findByText('指令已提交，等待执行器回执。')
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    const confirmed = { ...snapshot, generatedAt: new Date(Date.now() + 100).toISOString(), automation: executor({ desiredState: 'paused', runnerAlive: false, activeVerifierCount: 0, pauseMayHaveInFlightRequest: false, latestCommand: { commandId, action: 'pause', status: 'completed', updatedAt: new Date().toISOString(), error: null } }) }
    act(() => FakeEventSource.instances[0].snapshot(confirmed))
    expect(screen.getByText('已暂停新调用')).toBeVisible()
    expect(screen.getByRole('button', { name: '恢复自动推进' })).toBeEnabled()
    expect(screen.getByText('暂停后续任务：执行器已确认')).toBeVisible()
  })

  it('does not enable commands from an aged executor observation even when the website stream is live', () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor({ observedAt: new Date(Date.now() - 130000).toISOString() })
    render(<AdminDashboard snapshot={snapshot} connection="live" onAutomationAction={vi.fn(async () => {})} />)
    const panel = screen.getByRole('region', { name: '自动化执行' })
    expect(within(panel).getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    expect(panel).toHaveTextContent('执行器连接待更新')
  })

  it('tracks remote start through the matching receipt and prevents duplicate starts until it finishes', async () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor({ desiredState: 'paused', runnerAlive: false, supervisorAlive: false, activeVerifierCount: 0 })
    const commandId = '189bd3e2-5218-4406-af56-2a4d46cc0466'
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession : path === '/api/admin/verification' && init?.method === 'POST' ? { accepted: true, commandId } : snapshot, path === '/api/admin/verification' ? 202 : 200))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    fireEvent.click(screen.getByRole('button', { name: '开始核验' }))
    fireEvent.click(screen.getByRole('button', { name: '创建并开始核验' }))
    await screen.findByText('指令已提交，等待执行器回执。')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始核验' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复自动推进' })).toBeDisabled()
    const claimed = { ...snapshot, generatedAt: new Date(Date.now() + 100).toISOString(), automation: executor({ latestCommand: { commandId, action: 'start', status: 'claimed', updatedAt: new Date().toISOString(), error: null } }) }
    act(() => FakeEventSource.instances[0].snapshot(claimed))
    expect(screen.getByText('开始核验：执行器处理中')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始核验' })).toBeDisabled()
    const failed = { ...claimed, generatedAt: new Date(Date.now() + 200).toISOString(), automation: executor({ runnerAlive: false, supervisorAlive: false, activeVerifierCount: 0, latestCommand: { commandId, action: 'start', status: 'failed', updatedAt: new Date().toISOString(), error: 'verification_already_running' } }) }
    act(() => FakeEventSource.instances[0].snapshot(failed))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始核验' })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent('已有核验任务在运行')
    expect(screen.getByText('开始核验：执行未完成')).toBeVisible()
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/admin/verification')).toHaveLength(1)
  })

  it('does not wait again for a completed command when another administrator submits a later command', async () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor()
    const commandId = '814dce65-1297-4638-8d83-ae4a93204d87'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(commandId)
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession : path === '/api/admin/automation' && init?.method === 'POST' ? { accepted: true, commandId } : snapshot)))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' }))
    await screen.findByText('指令已提交，等待执行器回执。')
    const completed = { ...snapshot, generatedAt: new Date(Date.now() + 100).toISOString(), automation: executor({ desiredState: 'paused', runnerAlive: false, activeVerifierCount: 0, latestCommand: { commandId, action: 'pause', status: 'completed', updatedAt: new Date().toISOString(), error: null } }) }
    act(() => FakeEventSource.instances[0].snapshot(completed))
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复自动推进' })).toBeEnabled())
    const later = { ...completed, generatedAt: new Date(Date.now() + 200).toISOString(), automation: executor({ latestCommand: { commandId: 'da33e71f-a871-40f1-9f2d-c4d1b2e41f9f', action: 'resume', status: 'completed', updatedAt: new Date().toISOString(), error: null } }) }
    act(() => FakeEventSource.instances[0].snapshot(later))
    expect(screen.queryByText('指令已提交，等待执行器回执。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeEnabled()
  })

  it.each(['expired', 'failed', 'completed'] as const)('recovers a matching %s queue outcome absent from the local latest receipt without redispatch', async status => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.capabilities.localMonitoring = false; snapshot.automation = executor()
    const commandId = '814dce65-1297-4638-8d83-ae4a93204d87'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(commandId)
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession
      : path.startsWith('/api/admin/automation?commandId=') ? { command: { commandId, action: 'pause', status, updatedAt: new Date().toISOString(), error: status === 'failed' ? 'execution_outcome_unknown' : status === 'expired' ? 'command_expired' : null } }
        : path === '/api/admin/automation' && init?.method === 'POST' ? { accepted: true, commandId } : snapshot))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' })); await Promise.resolve() })
    expect(screen.getByRole('button', { name: '开始核验' })).toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(screen.getByRole('button', { name: '开始核验' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeEnabled()
    expect(screen.queryByText('指令已提交，等待执行器回执。')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([path, init]) => path === '/api/admin/automation' && init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/automation?commandId=${commandId}`, expect.objectContaining({ credentials: 'same-origin' }))
    expect(screen.getByText(status === 'expired' ? /指令已过期/ : status === 'failed' ? /系统不会自动重派/ : /执行器已确认指令/)).toHaveAttribute('role', 'status')
  })

  it.each(['pending', 'claimed', 'missing', 'mismatched', 'unavailable'] as const)('keeps the command locked for a %s queue outcome beyond command TTL without retrying it', async outcome => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.capabilities.localMonitoring = false; snapshot.automation = executor()
    const commandId = '814dce65-1297-4638-8d83-ae4a93204d87'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(commandId)
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession
      : path.startsWith('/api/admin/automation?commandId=') ? { command: outcome === 'missing' ? null : { commandId: outcome === 'mismatched' ? 'different-command' : commandId, action: 'pause', status: outcome === 'pending' || outcome === 'claimed' ? outcome : 'completed', updatedAt: new Date().toISOString(), error: null } }
        : path === '/api/admin/automation' && init?.method === 'POST' ? { accepted: true, commandId } : snapshot, path.includes('?commandId=') && outcome === 'unavailable' ? 503 : 200))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' })); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(306_000) })
    expect(screen.getByRole('button', { name: '开始核验' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    expect(screen.getByText('指令已提交，等待执行器回执。')).toBeVisible()
    expect(fetchMock.mock.calls.filter(([path, init]) => path === '/api/admin/automation' && init?.method === 'POST')).toHaveLength(1)
  })

  it('shows a readable rejected command and leaves controls available for retry', async () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor()
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : path === '/api/admin/automation' ? { error: 'executor_unavailable' } : snapshot, path === '/api/admin/automation' ? 503 : 200)))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    fireEvent.click(screen.getByRole('button', { name: '暂停后续任务' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('执行器暂时无法接受指令')
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeEnabled()
    expect(screen.queryByText('指令已提交，等待执行器回执。')).not.toBeInTheDocument()
  })

  it('reenables fresh controls as soon as a successful manual sync recovers the connection', async () => {
    const snapshot = adminSnapshot(); snapshot.generatedAt = new Date().toISOString(); snapshot.automation = executor()
    const fetchMock = vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : snapshot))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '自动化执行' })
    act(() => FakeEventSource.instances[0].snapshot(snapshot))
    fetchMock.mockImplementation(async () => response({ error: 'unavailable' }, 503))
    fireEvent.click(screen.getByRole('button', { name: '同步最新数据' }))
    await screen.findByText('连接中断')
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeDisabled()
    fetchMock.mockImplementation(async () => response(snapshot))
    fireEvent.click(screen.getByRole('button', { name: '同步最新数据' }))
    await screen.findByText('后台同步')
    expect(screen.getByRole('button', { name: '暂停后续任务' })).toBeEnabled()
  })
})
