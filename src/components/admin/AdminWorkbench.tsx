'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { RoundedSelect } from '@/components/ui/RoundedSelect'
import type { AdminSession, AdminSnapshot, VerificationRequest } from '@/lib/admin/types'
import { AdminDashboard } from './AdminDashboard'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './Workbench.module.css'

class AdminRequestError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
const requestErrors: Record<string, string> = {
  unauthorized: '管理员会话已过期，请重新登录。', invalid_credentials: '管理员访问口令不正确，请重试。',
  forbidden: '请求来源校验未通过，请刷新管理员页面后重试。', invalid_request: '核验设置无效，请检查范围、数量和模型选项。',
  admin_not_configured: '管理员访问尚未配置，请检查服务端配置。', rate_limited: '登录尝试过于频繁，请稍后重试。',
  rate_limit_unavailable: '登录保护服务暂时不可用，请稍后重试。',
  verification_already_running: '已有核验任务正在运行，请查看核验任务进度，或先暂停后续任务。',
  executor_unavailable: '执行器暂时无法接受指令，请同步最新数据并检查执行器连接后重试。',
}
type VerificationAccepted = { accepted: true; commandId?: string; pid?: number }
async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init })
  let data
  try { data = await response.json() }
  catch { throw new AdminRequestError('管理员服务返回了无效响应，请同步最新数据后重试。', response.status) }
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : ''
    throw new AdminRequestError(requestErrors[code] ?? '请求未完成，请稍后重试。', response.status)
  }
  return data as T
}
function StartVerification({ onClose, onStart, configuredModel }: { onClose: () => void; onStart: (request: VerificationRequest) => Promise<void>; configuredModel: string | null }) {
  const [collection, setCollection] = useState<VerificationRequest['collection']>('all')
  const [mode, setMode] = useState<'sample' | 'full'>('sample')
  const [model, setModel] = useState<NonNullable<VerificationRequest['model']>>('configured')
  const [effort, setEffort] = useState<NonNullable<VerificationRequest['effort']>>('default')
  const [limit, setLimit] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => { document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy && !document.querySelector('[role="listbox"]')) { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const items = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []]
    const first = items[0], last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await onStart({ collection, mode, model, effort, ...(mode === 'sample' ? { limit } : {}) })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法开始核验。') }
    finally { setBusy(false) }
  }
  return <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><div className={styles.modal} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="verification-title" aria-describedby="verification-description" onKeyDown={keydown}><div className={styles.modalHeading}><div><h2 id="verification-title">开始一次新的核验</h2><p id="verification-description">选择范围、模型与思考深度。执行器将调用 MiniMax，并记录候选结论供审阅。</p></div><button ref={closeRef} onClick={onClose} disabled={busy} aria-label="关闭核验设置" type="button"><WorkbenchIcon name="close" /></button></div><form onSubmit={submit}>
    <label htmlFor="admin-collection">数据范围</label><RoundedSelect id="admin-collection" value={collection} onChange={event => setCollection(event.target.value as VerificationRequest['collection'])}>{[['all', '全部目录'], ['universities', '高校'], ['programs', '专业'], ['admission-cycles', '招生批次'], ['scholarships', '奖学金'], ['cities', '城市'], ['sources', '来源']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</RoundedSelect>
    <label>执行模式</label><div className={styles.modePicker}><button type="button" aria-pressed={mode === 'sample'} onClick={() => setMode('sample')}>抽样核验<small>先检查一组记录</small></button><button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>全量核验<small>处理所选范围的全部记录</small></button></div>
    {mode === 'sample' ? <><label htmlFor="admin-limit">抽样数量</label><input type="number" id="admin-limit" min={1} max={100} required value={limit} onChange={event => setLimit(Number(event.target.value))} /></> : <p>全量模式可能处理大量记录，并产生较多 Token 消耗。</p>}
    <label htmlFor="admin-model">模型</label><RoundedSelect id="admin-model" value={model} onChange={event => { setModel(event.target.value as NonNullable<VerificationRequest['model']>); setEffort('default') }}><option value="configured">当前配置 · {configuredModel ?? '自动读取'}</option><option value="MiniMax-M3">MiniMax-M3 · 自适应思考</option><option value="MiniMax-M3.1-Flash-Preview">MiniMax-M3.1-Flash-Preview</option></RoundedSelect>
    <label htmlFor="admin-effort">思考深度</label><RoundedSelect id="admin-effort" value={effort} disabled={model !== 'MiniMax-M3.1-Flash-Preview'} onChange={event => setEffort(event.target.value as NonNullable<VerificationRequest['effort']>)}><option value="default">模型默认</option><option value="high">High · 深入思考</option><option value="xhigh">XHigh · 更深入思考</option><option value="max">Max · 最高思考深度</option></RoundedSelect>
    {model === 'MiniMax-M3.1-Flash-Preview' ? <p>M3.1 为 Preview 模型，需要当前套餐与接入端点支持；默认开启思考并使用 Max 深度。</p> : model === 'MiniMax-M3' ? <p>新建 M3 任务显式开启自适应思考；M3 没有可设置的 effort 档位。</p> : <p>采用当前服务端模型配置。选择 M3.1 可以设置思考深度，选择 M3 会开启自适应思考。</p>}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}<div className={styles.modalActions}><button className={styles.primaryButton} type="submit" disabled={busy}><WorkbenchIcon name="play" size={16} />{busy ? '正在提交…' : '创建并开始核验'}</button></div>
  </form></div></div>
}
export function AdminWorkbench() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'polling' | 'offline'>('connecting')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [automationCommandId, setAutomationCommandId] = useState<string | null>(null)
  const [verificationReceipt, setVerificationReceipt] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const transportCleanup = useRef<(() => void) | null>(null)
  const closeTransport = useCallback(() => {
    transportCleanup.current?.()
    transportCleanup.current = null
    refreshController.current?.abort()
  }, [])
  const snapshotGeneratedAt = useRef('')
  const acceptSnapshot = useCallback((next: AdminSnapshot) => {
    if (snapshotGeneratedAt.current > next.generatedAt) return
    snapshotGeneratedAt.current = next.generatedAt
    setSnapshot(next)
    const latest = next.automation?.latestCommand
    // A terminal receipt releases this browser's command lock. Subsequent commands
    // from other administrators must not turn a completed command back into a wait.
    setAutomationCommandId(current => current && latest?.commandId === current && ['completed', 'failed', 'expired'].includes(latest.status) ? null : current)
  }, [])
  const expireSession = useCallback(() => {
    closeTransport()
    snapshotGeneratedAt.current = ''
    setSnapshot(null)
    setStarting(false)
    setAutomationCommandId(null)
    setVerificationReceipt('')
    setRefreshing(false)
    setRefreshedAt(null)
    setSession(current => current ? { ...current, authenticated: false } : current)
    setConnection('offline')
    setError('管理员会话已过期，请重新登录。')
  }, [closeTransport])
  useEffect(() => {
    let cancelled = false
    jsonRequest<AdminSession>('/api/admin/session').then(next => { if (!cancelled) { setSession(next); setError('') } }).catch(() => { if (!cancelled) setError('管理员服务暂时不可用，请刷新重试。') })
    return () => { cancelled = true }
  }, [])
  const refresh = useCallback(async () => {
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setRefreshing(true)
    setRefreshedAt(null)
    try {
      const next = await jsonRequest<AdminSnapshot>('/api/admin/status', { signal: controller.signal })
      if (!controller.signal.aborted) { acceptSnapshot(next); setError(''); setRefreshedAt(new Date().toISOString()); setConnection(current => current === 'live' ? current : 'polling') }
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof AdminRequestError && cause.status === 401) { expireSession(); return }
      setError(cause instanceof Error ? cause.message : '无法同步数据。'); setConnection('offline')
    } finally { if (refreshController.current === controller) { refreshController.current = null; setRefreshing(false) } }
  }, [acceptSnapshot, expireSession])
  useEffect(() => {
    if (!session?.authenticated) return
    let stopped = false
    let streamLive = false
    let pollingInFlight = false
    let polling: ReturnType<typeof setTimeout> | undefined
    let snapshotWatchdog: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const source = new EventSource('/api/admin/events')
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      stopped = true
      controller.abort()
      refreshController.current?.abort()
      source.close()
      if (polling) clearTimeout(polling)
      if (snapshotWatchdog) clearTimeout(snapshotWatchdog)
    }
    // Revoke transport admission before rendering the signed-out view. A passive
    // effect cleanup can run later than the DOM update, especially under load.
    transportCleanup.current = dispose
    function fallback() {
      if (stopped) return
      streamLive = false
      if (snapshotWatchdog) clearTimeout(snapshotWatchdog)
      snapshotWatchdog = undefined
      if (!polling && !pollingInFlight) polling = setTimeout(poll, 1200)
    }
    async function poll() {
      polling = undefined
      if (stopped || streamLive || pollingInFlight) return
      pollingInFlight = true
      try {
        const response = await fetch('/api/admin/status', { cache: 'no-store', signal: controller.signal })
        if (stopped) return
        if (response.status === 401) { expireSession(); return }
        if (!response.ok) throw new Error('Unavailable')
        const next: AdminSnapshot = await response.json()
        if (!stopped && !streamLive) { acceptSnapshot(next); setConnection('polling'); setError('') }
      } catch { if (!stopped && !streamLive) setConnection('offline') }
      finally {
        pollingInFlight = false
        if (!stopped && !streamLive) polling = setTimeout(poll, 5000)
      }
    }
    source.addEventListener('snapshot', event => {
      if (stopped) return
      try {
        const next: AdminSnapshot = JSON.parse((event as MessageEvent).data)
        streamLive = true
        if (polling) clearTimeout(polling)
        polling = undefined
        if (snapshotWatchdog) clearTimeout(snapshotWatchdog)
        // The server sends snapshots every three seconds. An open connection
        // without fresh data must not leave the usage page frozen indefinitely.
        snapshotWatchdog = setTimeout(() => { setConnection('connecting'); fallback() }, 15_000)
        acceptSnapshot(next); setConnection('live'); setError('')
      } catch { setConnection('offline'); fallback() }
    })
    source.addEventListener('status-error', () => { if (stopped) return; setConnection('offline'); setError('执行器状态暂时不可用，正在等待下一次同步。'); fallback() })
    // EventSource opening confirms transport only; the first valid snapshot
    // confirms that application data is flowing and can stop fallback polling.
    source.onopen = () => { if (stopped) return; setConnection('connecting'); fallback() }
    source.onerror = () => { if (stopped) return; setConnection('connecting'); fallback() }
    jsonRequest<AdminSnapshot>('/api/admin/status', { signal: controller.signal }).then(next => { if (!stopped) acceptSnapshot(next) }).catch(cause => {
      if (stopped) return
      if (cause instanceof AdminRequestError && cause.status === 401) expireSession()
      else { setConnection('offline'); fallback() }
    })
    return () => { dispose(); if (transportCleanup.current === dispose) transportCleanup.current = null }
  }, [session?.authenticated, acceptSnapshot, expireSession])
  async function startVerification(request: VerificationRequest) {
    setVerificationReceipt('')
    try {
      const accepted = await jsonRequest<VerificationAccepted>('/api/admin/verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      if (accepted?.accepted !== true || !accepted.commandId && (!Number.isSafeInteger(accepted.pid) || Number(accepted.pid) <= 0)) throw new AdminRequestError('核验启动回执无效，请同步最新数据确认任务状态。', 502)
      if (accepted.commandId) setAutomationCommandId(accepted.commandId)
      else setVerificationReceipt('核验进程已启动，模型调用与核验结果将随执行器回执更新。')
      void refresh()
    } catch (cause) {
      if (cause instanceof AdminRequestError && cause.status === 401) expireSession()
      throw cause
    }
  }
  async function automationAction(action: 'pause' | 'resume') {
    const commandId = crypto.randomUUID()
    setAutomationCommandId(commandId)
    try {
      await jsonRequest('/api/admin/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId, action }) })
      void refresh()
    } catch (cause) {
      setAutomationCommandId(null)
      if (cause instanceof AdminRequestError && cause.status === 401) expireSession()
      throw cause
    }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { setSession(await jsonRequest<AdminSession>('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })); setPassword('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '登录未完成。') }
    finally { setBusy(false) }
  }
  async function logout() {
    try { await jsonRequest('/api/admin/session', { method: 'DELETE' }); closeTransport(); snapshotGeneratedAt.current = ''; setSnapshot(null); setAutomationCommandId(null); setVerificationReceipt(''); setRefreshing(false); setRefreshedAt(null); setSession(current => current ? { ...current, authenticated: false } : current) }
    catch { setError('退出未完成，请重试。') }
  }
  if (session?.authenticated && snapshot) return <><AdminDashboard snapshot={snapshot} connection={connection} refreshing={refreshing} refreshedAt={refreshedAt} verificationReceipt={verificationReceipt} onAutomationAction={automationAction} automationCommandId={automationCommandId} onStart={() => { if (snapshot.capabilities.startVerification) setStarting(true) }} onRefresh={() => { void refresh() }} onLogout={() => { void logout() }} />{error ? <p role="alert" className={styles.error} style={{ position: 'fixed', bottom: 15, right: 20, background: 'white', padding: 12, borderRadius: 12 }}>{error}</p> : null}{starting && snapshot.capabilities.startVerification ? <StartVerification configuredModel={snapshot.model.configured} onClose={() => setStarting(false)} onStart={startVerification} /> : null}</>
  return <div className={styles.loginShell}><section className={styles.loginCard}><Link href="/zh" className={styles.brand}><span className={styles.brandMark} style={{ background: '#7860cf', color: 'white' }}>中</span><span>Study in China<small>ADMIN WORKSPACE</small></span></Link><h1>{session?.authenticated ? '正在连接工作空间…' : '欢迎回到数据工作室'}</h1>{session === null ? <p>正在检查管理员会话…</p> : session.authenticated ? <p>正在读取实际目录和核验进度。</p> : session.configured ? <><p>登录后查看核验任务、处理进度和 Token 用量。</p><form onSubmit={login}><label htmlFor="admin-password">管理员访问口令</label><input autoComplete="current-password" type="password" id="admin-password" value={password} required onChange={event => setPassword(event.target.value)} /><button type="submit" disabled={busy} className={styles.primaryButton}>{busy ? '正在登录…' : '进入管理员工作台'}<WorkbenchIcon name="arrow" size={16} /></button></form></> : <><p>管理员访问尚未配置。请在服务端环境中设置 ADMIN_ACCESS_TOKEN 和 ADMIN_SESSION_SECRET；本机执行核验还需要 ADMIN_LOCAL_VERIFICATION_ENABLED=true。</p><p>主题实验室已可直接查看完整工作台设计。</p></>}{error ? <p className={styles.error} role="alert">{error}</p> : null}<div className={styles.loginLinks}><Link href="/themes">查看五套主题 ↗</Link><Link href="/zh">返回网站 →</Link></div></section></div>
}
