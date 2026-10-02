import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminWorkbench } from '@/components/admin/AdminWorkbench'
import { adminSession, adminSnapshot } from '../fixtures/admin-workbench'

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
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value })
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  document.documentElement.dataset.theme = 'cloud'
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('administrator workbench transport and session', () => {
  it('checks the session before showing the login and logs in without storing the password', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => path === '/api/admin/status'
      ? response(adminSnapshot()) : response(init?.method === 'POST' ? adminSession : { ...adminSession, authenticated: false }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    expect(screen.getByText('正在检查管理员会话…')).toBeVisible()
    const password = await screen.findByLabelText('管理员访问口令')
    fireEvent.change(password, { target: { value: 'test-only-password' } })
    fireEvent.click(screen.getByRole('button', { name: /进入管理员工作台/ }))
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/session', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ password: 'test-only-password' }) }))
    expect(localStorage.length).toBe(0)
    expect(FakeEventSource.instances[0].url).toBe('/api/admin/events')
  })

  it('applies SSE snapshots without remounting the selected dashboard view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByRole('heading', { name: 'Token 用量' })).toBeVisible()
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')
    const updated = adminSnapshot(); updated.usage.totalTokens = 21000
    act(() => FakeEventSource.instances[0].snapshot(updated))
    expect(screen.getByRole('heading', { name: '用量总览' }).closest('article')).toBe(panel)
    expect(panel?.querySelector('strong')).toHaveTextContent('21,000')
    expect(screen.getByText('实时连接')).toBeVisible()
  })

  it('falls back to polling after a stream error and stops the stream on a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    vi.useFakeTimers()
    const source = FakeEventSource.instances[0]
    act(() => source.onerror?.())
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(screen.getByText('后台同步')).toBeVisible()
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'expired' }, 401)))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByLabelText('管理员访问口令')).toBeVisible()
    expect(source.close).toHaveBeenCalled()
  })

  it('logout closes the stream and clears the authenticated dashboard', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(init?.method === 'DELETE' ? { ok: true } : path === '/api/admin/session' ? adminSession : adminSnapshot()))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    const source = FakeEventSource.instances[0]
    fireEvent.click(screen.getByRole('button', { name: '退出管理员' }))
    await screen.findByLabelText('管理员访问口令')
    expect(source.close).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '让每一条数据，更可信。' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/session', expect.objectContaining({ method: 'DELETE' }))
  })

  it('ignores an in-flight fallback response after the event stream delivers a valid snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    vi.useFakeTimers()
    let resolvePoll: (value: ReturnType<typeof response>) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<ReturnType<typeof response>>(resolve => { resolvePoll = resolve })))
    const source = FakeEventSource.instances[0]
    act(() => source.onerror?.())
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    act(() => source.onopen?.())
    act(() => source.snapshot(adminSnapshot()))
    const stale = adminSnapshot(); stale.usage.totalTokens = 99999
    await act(async () => { resolvePoll(response(stale)); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('实时连接')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByRole('heading', { name: '用量总览' }).closest('article')?.querySelector('strong')).toHaveTextContent('15,000')
    expect(screen.queryByText('99,999')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('continues fetching real usage when the stream opens without delivering any snapshot', async () => {
    const snapshot = adminSnapshot()
    Object.assign(snapshot.usage, { totalTokens: 0, inputTokens: 0, outputTokens: 0, requests: 0, lastResponseAt: null })
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : snapshot)))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    expect(panel.querySelector('strong')).toHaveTextContent('—')
    vi.useFakeTimers()
    const updated = adminSnapshot(); updated.usage.totalTokens = 42000; updated.generatedAt = '2026-09-30T09:01:00Z'
    const fetchMock = vi.fn(async () => response(updated))
    vi.stubGlobal('fetch', fetchMock)
    act(() => FakeEventSource.instances[0].onopen?.())
    expect(screen.queryByText('实时连接')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/status', expect.objectContaining({ cache: 'no-store' }))
    expect(panel.querySelector('strong')).toHaveTextContent('42,000')
    expect(screen.getByText('后台同步')).toBeVisible()
  })

  it.each(['status-error', 'malformed snapshot'])('recovers current usage through polling after a %s event', async failure => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    vi.useFakeTimers()
    const source = FakeEventSource.instances[0]
    act(() => source.snapshot(adminSnapshot()))
    expect(screen.getByText('实时连接')).toBeVisible()
    const updated = adminSnapshot(); updated.usage.totalTokens = 52000; updated.generatedAt = '2026-09-30T09:01:00Z'
    vi.stubGlobal('fetch', vi.fn(async () => response(updated)))
    act(() => source.listeners.get(failure === 'status-error' ? 'status-error' : 'snapshot')?.({ data: '{' } as MessageEvent))
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(panel.querySelector('strong')).toHaveTextContent('52,000')
    expect(screen.getByText('后台同步')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('recovers real usage when an established stream silently stops sending snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    vi.useFakeTimers()
    act(() => FakeEventSource.instances[0].snapshot(adminSnapshot()))
    const updated = adminSnapshot(); updated.usage.totalTokens = 62000; updated.generatedAt = '2026-09-30T09:01:00Z'
    const fetchMock = vi.fn(async () => response(updated))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('连接中')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(panel.querySelector('strong')).toHaveTextContent('62,000')
    expect(screen.getByText('后台同步')).toBeVisible()
  })

  it('expires the session immediately when manual refresh receives 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    const source = FakeEventSource.instances[0]
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'expired' }, 401)))
    fireEvent.click(screen.getByRole('button', { name: '同步最新数据' }))
    await screen.findByLabelText('管理员访问口令')
    expect(screen.getByRole('alert')).toHaveTextContent('管理员会话已过期')
    expect(source.close).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '让每一条数据，更可信。' })).not.toBeInTheDocument()
  })

  it('only enables effort for M3.1 and resets it when switching to M3', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(path === '/api/admin/session' ? adminSession : path === '/api/admin/verification' && init?.method === 'POST' ? { ok: true } : adminSnapshot()))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: '开始核验' }))
    const effort = screen.getByRole('combobox', { name: '思考深度' })
    expect(effort).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }))
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax-M3.1-Flash-Preview' }))
    expect(effort).toBeEnabled()
    fireEvent.click(effort)
    fireEvent.click(screen.getByRole('option', { name: 'Max · 最高思考深度' }))
    expect(effort).toHaveValue('max')
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }))
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax-M3 · 自适应思考' }))
    expect(effort).toBeDisabled()
    expect(effort).toHaveValue('default')
    fireEvent.click(screen.getByRole('button', { name: '创建并开始核验' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/verification', expect.objectContaining({ method: 'POST', body: JSON.stringify({ collection: 'all', mode: 'sample', model: 'MiniMax-M3', effort: 'default', limit: 20 }) }))
    await flush()
  })

  it('uses the classified needs-review bucket once in dashboard metrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    expect(screen.getByText('需复核记录').closest('article')?.querySelector('strong')).toHaveTextContent('380')
  })

  it('explains unavailable cloud verification and never presents unobserved usage as zero', async () => {
    const snapshot = adminSnapshot()
    snapshot.runs = []
    snapshot.capabilities = { localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: '线上执行器未连接。' }
    snapshot.telemetry = { source: 'unavailable', observedAt: null, stale: false }
    const fetchMock = vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : snapshot))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    expect(screen.queryByRole('button', { name: '开始核验' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '核验执行器尚未连接' })).toBeVisible()
    screen.getByRole('button', { name: '核验连接说明' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '核验连接说明' }))
    const dialog = screen.getByRole('dialog', { name: '核验连接说明' })
    expect(dialog).toHaveTextContent('网站暂时无法创建任务或读取 Token 用量')
    expect(within(dialog).getByRole('button', { name: '关闭连接说明' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '核验连接说明' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    expect(panel.querySelector('strong')).toHaveTextContent('—')
    expect([...panel.querySelectorAll('dd')].map(element => element.textContent)).toEqual(Array(6).fill('—'))
    expect(panel).toHaveTextContent('采集时间：未连接')
    expect(screen.queryByText('15,000')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([path]) => path !== '/api/admin/verification')).toBe(true)
  })

  it('shows exact remote saved-response usage with observation freshness even without a local executor', async () => {
    const snapshot = adminSnapshot()
    snapshot.capabilities = { localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: null }
    snapshot.telemetry = { source: 'remote', observedAt: '2026-09-30T09:00:00Z', stale: true }
    Object.assign(snapshot.usage, { inputTokens: 1234567, outputTokens: 8910, totalTokens: 1243477, cacheReadTokens: 456, cacheWriteTokens: 78, requests: 150 })
    snapshot.runs[0].tokenUsage = { ...snapshot.usage }
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : snapshot)))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    const panel = screen.getByRole('heading', { name: '用量总览' }).closest('article')!
    expect(panel.querySelector('strong')).toHaveTextContent('1,243,477')
    expect([...panel.querySelectorAll('dd')].map(element => element.textContent)).toEqual(['1,234,567', '8,910', '456', '78', '1,243,477', '150'])
    expect(panel).toHaveTextContent('执行器同步记录 · 记录待更新')
    expect(panel).toHaveTextContent('采集时间：9/30 17:00')
    expect(panel).toHaveTextContent('输入 Token 已包含缓存读取与写入，不重复相加')
    const batches = screen.getByRole('heading', { name: '按核验批次' }).closest('article')!
    expect(batches).toHaveTextContent('1,243,477')
    expect(batches).toHaveTextContent('150 次已保存响应')
  })

  it('shows manual refresh progress and completion without changing the selected section', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => response(path === '/api/admin/session' ? adminSession : adminSnapshot())))
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    fireEvent.click(screen.getByRole('button', { name: '数据目录' }))
    let finish: (value: ReturnType<typeof response>) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<ReturnType<typeof response>>(resolve => { finish = resolve })))
    fireEvent.click(screen.getByRole('button', { name: '同步最新数据' }))
    expect(screen.getByRole('button', { name: '正在同步数据' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在同步最新数据…')
    await act(async () => { finish(response(adminSnapshot())); await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveTextContent('已同步最新数据')
    expect(screen.getByRole('button', { name: '同步最新数据' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '数据目录' })).toBeVisible()
    expect(screen.getByRole('link', { name: '查看高校' })).toHaveAttribute('href', '/zh/universities')
    expect(screen.getByRole('link', { name: '查看专业' })).toHaveAttribute('href', '/zh/programs')
    expect(screen.getByRole('link', { name: '查看奖学金' })).toHaveAttribute('href', '/zh/scholarships')
    expect(screen.getByRole('link', { name: '查看城市' })).toHaveAttribute('href', '/zh/cities')
    expect(screen.queryByRole('link', { name: '查看来源' })).not.toBeInTheDocument()
  })

  it('provides theme changes and logout from the accessible header account panel', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => response(init?.method === 'DELETE' ? { ok: true } : path === '/api/admin/session' ? adminSession : adminSnapshot()))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminWorkbench />)
    await screen.findByRole('heading', { name: '让每一条数据，更可信。' })
    const account = screen.getByRole('button', { name: '管理员账户' })
    fireEvent.click(account)
    expect(account).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region', { name: '账户设置' })
    fireEvent.click(within(panel).getByRole('combobox', { name: '界面主题' }))
    fireEvent.click(screen.getByRole('option', { name: '深夜墨绿' }))
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(localStorage.getItem('studycn-theme')).toBe('night')
    expect(panel).toBeVisible()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(account).toHaveAttribute('aria-expanded', 'false')
    expect(account).toHaveFocus()
    fireEvent.click(account)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await screen.findByLabelText('管理员访问口令')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/session', expect.objectContaining({ method: 'DELETE' }))
  })
})
