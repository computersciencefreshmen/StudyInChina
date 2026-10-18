'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { releaseHistorySchema, type AdminReleaseHistory } from '@/lib/admin/release-contract'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './ReleaseHistoryPanel.module.css'

const reasons: Record<string, string> = {
  deployment_registry_unavailable: '尚未同步真实部署历史。执行器连接后会显示可恢复的版本。',
  release_backend_unavailable: '版本服务暂时不可用，请稍后刷新。',
  catalog_bundled_with_deployment: '数据随界面一起打包发布。恢复下方部署版本会同时恢复界面与对应数据。',
  release_control_disabled: '版本历史可查看，回滚控制尚未在服务端启用。',
  deployment_outcome_uncertain: '上一次切换结果尚未确认。执行器完成核对前，后续切换保持锁定。',
  release_writer_busy: '另一条发布或回滚指令正在执行，请等待读回结果。',
  release_registry_stale: '部署状态已超过有效时间，请等待执行器同步当前版本。',
  deployment_guarded_writer: '通过受保护的发布执行器切换。每次执行都会核对当前版本并保存读回结果。',
  release_conflict: '当前版本已变化，请刷新历史后重新选择。',
  release_not_available: '目标版本已不可恢复，请选择仍保留的版本。',
  release_artifact_invalid: '旧版本文件校验失败，当前版本保持不变。',
  release_command_closed: '这条指令已经处理，不会重复执行。',
  release_receipt_conflict: '版本或执行回执不一致，切换已停止。',
}
const commandLabels = { pending: '等待执行器', claimed: '执行器已接收', completed: '已完成读回核对', failed: '已停止 · 原版本仍在线', uncertain: '结果待核对 · 后续切换锁定' }
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
type Selection = { kind: 'catalog' | 'deployment'; id: string }
export function ReleaseHistoryPanel({ onSessionExpired }: { onSessionExpired?: () => void }) {
  const [history, setHistory] = useState<AdminReleaseHistory | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const mounted = useRef(true)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/admin/releases', { cache: 'no-store', credentials: 'same-origin', signal })
      if (response.status === 401) { if (mounted.current) { setHistory(null); setError('管理员会话已过期，请重新登录。') } onSessionExpired?.(); return }
      if (!response.ok) throw new Error(reasons.release_backend_unavailable)
      const next = releaseHistorySchema.parse(await response.json())
      if (mounted.current && !signal?.aborted) { setHistory(next); setError('') }
    } catch { if (mounted.current && !signal?.aborted) setError(reasons.release_backend_unavailable) }
    finally { if (mounted.current && !signal?.aborted) setLoading(false) }
  }, [onSessionExpired])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const initial = setTimeout(() => { void refresh(controller.signal) }, 0)
    const polling = setInterval(() => { void refresh(controller.signal) }, 10_000)
    return () => { mounted.current = false; controller.abort(); clearTimeout(initial); clearInterval(polling) }
  }, [refresh])
  const selectedCatalog = selection?.kind === 'catalog' ? history?.catalog.versions.find(item => item.id === selection.id) : null
  const selectedDeployment = selection?.kind === 'deployment' ? history?.interface.versions.find(item => item.id === selection.id) : null
  const canRollback = Boolean(history && selection && (selection.kind === 'catalog' ? history.catalog.available && selectedCatalog?.rollbackAvailable : history.interface.rollbackAvailable && selectedDeployment && !selectedDeployment.current))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canRollback || !selection || !history || reason.trim().length < 3 || busy) return
    setBusy(true); setError(''); setReceipt('')
    const commandId = crypto.randomUUID()
    const body = selection.kind === 'catalog' ? { commandId, kind: 'catalog', targetId: selection.id,
      expectedCurrentId: history.catalog.currentId, expectedRevision: history.catalog.revision,
      expectedTargetSha256: selectedCatalog?.contentSha256, expectedCompatibilitySha256: selectedCatalog?.compatibilitySha256, reason: reason.trim() }
      : { commandId, kind: 'deployment', targetId: selection.id, expectedCurrentId: history.interface.currentId,
        expectedRevision: history.interface.revision, expectedRegistrySha256: history.interface.registrySha256, reason: reason.trim() }
    try {
      const response = await fetch('/api/admin/releases', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
      if (response.status === 401) { onSessionExpired?.(); return }
      const result = await response.json()
      if (!response.ok) throw new Error(reasons[result.error] ?? '指令未完成，请刷新后查看实际状态。')
      if (result.accepted !== true || (selection.kind === 'deployment' ? result.command?.commandId : result.receipt?.commandId) !== commandId) throw new Error('指令回执无效，请刷新查看实际状态。')
      setReceipt(selection.kind === 'deployment' ? `回滚指令已保存：${commandId}。等待执行器核对并切换，结果将在下方更新。` : `数据版本已恢复：${selection.id}。审计记录已保存。`)
      setSelection(null); setReason(''); await refresh()
    } catch (cause) {
      // A fresh GET may reconcile an accepted request, but it must not erase the
      // original submission error or trigger another POST.
      const message = cause instanceof Error ? cause.message : '提交结果未确认，请刷新查看指令状态。系统不会自动重发。'
      await refresh(); if (mounted.current) setError(message)
    } finally { if (mounted.current) setBusy(false) }
  }
  if (loading) return <div className={styles.empty} role="status">正在读取真实版本历史…</div>
  return <section className={styles.root} aria-label="版本历史与回滚">
    <div className={styles.heading}><div><span className={styles.eyebrow}>RELEASE CONTROL</span><h2>每次发布，都有来路。</h2><p>选择已保留的版本，查看影响范围，然后恢复。原版本与执行回执会继续保留。</p></div><button type="button" onClick={() => { void refresh() }} disabled={busy}><WorkbenchIcon name="refresh" size={16} />刷新版本</button></div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {receipt ? <p role="status" className={styles.notice}>{receipt}</p> : null}
    {history ? <>
      <div className={styles.currentGrid}><article><span>当前界面部署</span><strong>{history.interface.currentId ?? '等待执行器同步'}</strong><small>{history.interface.alias ?? '生产别名尚未同步'}</small></article><article><span>当前数据版本</span><strong>{history.catalog.currentId ?? '等待版本服务'}</strong><small>{history.catalog.backend === 'd1' ? 'D1 · 独立数据发布' : '随部署保存的完整数据'}</small></article></div>
      <article className={styles.panel}><h3>界面与完整部署</h3><p>{reasons[history.interface.reason] ?? history.interface.reason}</p><div className={styles.tableWrap}><table><thead><tr><th>部署版本</th><th>创建时间</th><th>状态</th><th><span className={styles.srOnly}>选择操作</span></th></tr></thead><tbody>{history.interface.versions.map(version => <tr key={version.id} data-selected={selection?.id === version.id}><td><a href={version.deploymentUrl} target="_blank" rel="noreferrer">{version.id}</a>{version.commitSha ? <small>提交 {version.commitSha.slice(0, 12)}</small> : null}</td><td>{time(version.createdAt)}</td><td>{version.current ? <span className={styles.current}>正在使用</span> : '已保留 · 可恢复'}</td><td><button type="button" disabled={version.current || busy || !history.interface.rollbackAvailable} onClick={() => { setSelection({ kind: 'deployment', id: version.id }); setReason(''); setReceipt('') }}>选择版本</button></td></tr>)}</tbody></table></div>{!history.interface.versions.length ? <p className={styles.empty}>尚无已登记的部署版本。</p> : null}
      {history.interface.command ? <div className={styles.command} role="status"><strong>{commandLabels[history.interface.command.status]}</strong><span>{history.interface.command.expectedCurrentId} → {history.interface.command.targetId}</span><small>指令 {history.interface.command.commandId} · {time(history.interface.command.updatedAt)}</small></div> : null}</article>
      <article className={styles.panel}><h3>独立数据版本</h3><p>{history.catalog.reason ? reasons[history.catalog.reason] ?? history.catalog.reason : '数据库在同一事务中校验版本并切换，当前版本变化时会拒绝旧指令。'}</p><div className={styles.tableWrap}><table><thead><tr><th>数据版本</th><th>生成时间</th><th>保留状态</th><th><span className={styles.srOnly}>选择操作</span></th></tr></thead><tbody>{history.catalog.versions.map(version => <tr key={version.id} data-selected={selection?.id === version.id}><td><strong>{version.id}</strong><small>版本 {version.dataVersion} · {version.contentSha256.slice(0, 12)}</small></td><td>{time(version.generatedAt)}</td><td>{version.status === 'active' ? '正在使用' : version.status === 'purged' ? '已移出恢复窗口' : '已保留'}</td><td><button type="button" disabled={busy || !history.catalog.available || !version.rollbackAvailable} onClick={() => { setSelection({ kind: 'catalog', id: version.id }); setReason(''); setReceipt('') }}>选择版本</button></td></tr>)}</tbody></table></div>{!history.catalog.versions.length ? <p className={styles.empty}>尚无独立数据发布记录。</p> : null}</article>
      {selection ? <form className={styles.confirmation} onSubmit={submit}><span className={styles.eyebrow}>RESTORE SELECTED VERSION</span><h3>确认恢复 {selection.id}</h3><p>当前 {selection.kind === 'deployment' ? history.interface.currentId : history.catalog.currentId} → {selection.id}</p><p>{selection.kind === 'deployment' ? '界面代码和该部署中保存的数据会一起恢复。执行器将先核对当前线上版本。' : '只切换数据发布版本，界面部署保持当前版本。'}</p><label htmlFor="release-rollback-reason">回滚原因</label><textarea id="release-rollback-reason" value={reason} maxLength={300} minLength={3} required disabled={busy} onChange={event => setReason(event.target.value)} placeholder="记录本次回滚原因，供之后追踪" /><div><button type="button" disabled={busy} onClick={() => setSelection(null)}>取消选择</button><button type="submit" disabled={busy || !canRollback || reason.trim().length < 3}>{busy ? '正在保存指令…' : '确认回滚'}</button></div></form> : null}
      <article className={styles.panel}><h3>操作审计</h3>{history.audit.length || history.interface.history.length ? <ol className={styles.audit}>{history.interface.history.map(command => <li key={command.commandId}><strong>{commandLabels[command.status]}</strong><span>{command.expectedCurrentId} → {command.targetId}</span><p>{command.reason}</p><small>{time(command.updatedAt)} · {command.commandId}</small></li>)}{history.audit.map(item => <li key={item.commandId}><strong>数据版本已恢复</strong><span>{item.previousId} → {item.targetId}</span><p>{item.reason}</p><small>{time(item.completedAt)} · {item.commandId}</small></li>)}</ol> : <p className={styles.empty}>尚无管理员回滚记录。</p>}</article>
    </> : null}
  </section>
}
