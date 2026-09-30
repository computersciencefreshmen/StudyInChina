import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByText('21,000')).toBeVisible()
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

  it('ignores an in-flight fallback response after the event stream reconnects', async () => {
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
    const stale = adminSnapshot(); stale.usage.totalTokens = 99999
    await act(async () => { resolvePoll(response(stale)); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('实时连接')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Token 用量' }))
    expect(screen.getByText('15,000')).toBeVisible()
    expect(screen.queryByText('99,999')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
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
})
