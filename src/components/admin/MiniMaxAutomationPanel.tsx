import { useState } from 'react'
import type { ExecutorStatus } from '@/lib/admin/types'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './Workbench.module.css'
import mini from './MiniMaxPanels.module.css'

const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '等待回执'
const phases: Record<string, string> = { baseline: '全量目录核验', recovery: '补充核验', 'evidence-backlog': '等待新增官方证据', 'wait-quota': '等待套餐额度恢复', 'waiting-credit-confirmation': '等待积分策略确认', attention: '需要处理', starting: '正在启动', stopped: '已停止调度', paused: '已暂停调度', idle: '等待任务' }
const commands = { pause: '暂停后续任务', resume: '恢复自动推进', start: '开始核验' }

export function MiniMaxAutomationPanel({ status, stale, online, commandId = null, lastResponseAt = null, onAction, readOnly = false }: {
  status: ExecutorStatus; stale: boolean; online: boolean; commandId?: string | null; lastResponseAt?: string | null; onAction?: (action: 'pause' | 'resume') => Promise<void>; readOnly?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fresh = status.connected && !stale && online
  const latest = status.latestCommand
  const awaitingReceipt = Boolean(commandId && latest?.commandId !== commandId)
  const pending = awaitingReceipt || latest?.status === 'pending' || latest?.status === 'claimed'
  const disabled = readOnly || !fresh || busy || pending || !onAction
  const title = !fresh ? '执行器连接待更新' : status.desiredState === 'paused' ? status.pauseMayHaveInFlightRequest ? '正在暂停新调用' : '已暂停新调用' : status.runnerAlive || status.activeVerifierCount ? '自动推进中' : '等待执行器处理任务'
  async function submit(action: 'pause' | 'resume') {
    if (disabled) return
    setBusy(true); setError('')
    try { await onAction?.(action) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '指令提交未完成，请重试。') }
    finally { setBusy(false) }
  }
  const receipt = awaitingReceipt ? '指令已提交，等待执行器回执。' : latest ? `${commands[latest.action]}：${({ pending: '等待领取', claimed: '执行器处理中', completed: '执行器已确认', failed: '执行未完成', expired: '指令已过期' })[latest.status]}` : null
  return <section className={`${styles.panel} ${mini.automation}`} aria-labelledby="minimax-automation-title">
    <div className={mini.automationHeading}><div><p className={mini.eyebrow}>MINIMAX AUTOMATION</p><h2 id="minimax-automation-title">自动化执行</h2><p className={styles.smallMuted}>{readOnly ? '只读监控模式 · 已同步执行器状态，此连接未开放远程任务控制。' : '任务由执行器持续推进，在这里查看状态并控制新的调用。'}</p></div><span className={styles.status} data-active={fresh && status.desiredState === 'running' && status.runnerAlive}><i />{title}</span></div>
    <div className={mini.automationBody}><div><strong className={mini.phase}>{phases[status.phase] ?? '执行器正在处理任务'}</strong><p>{status.activeVerifierCount} 个核验进程 · {status.keepAwake ? '执行器保持唤醒' : '唤醒状态未启用'}</p><p>最近模型响应：{date(lastResponseAt)}</p><p>最近状态：{date(status.observedAt)}{status.controlAcknowledgedAt ? ` · 控制确认：${date(status.controlAcknowledgedAt)}` : ''}</p></div><div className={mini.funding}><span>消耗策略</span><strong>{status.creditFallbackAuthorized ? 'Token Plan 优先，耗尽后可用现有积分' : '使用 Token Plan'}</strong>{status.policyReloadPending ? <p className={mini.pendingPolicy}>积分授权已保存，运行中任务正在等待策略交接。</p> : null}{status.quota ? <p>{status.quota.stale ? '上次额度（待更新）：' : '最近额度回执：'}5 小时套餐剩余 {status.quota.fiveHourRemainingPercent == null ? '待确认' : `${status.quota.fiveHourRemainingPercent}%`} · 周套餐剩余 {status.quota.weeklyRemainingPercent == null ? '待确认' : `${status.quota.weeklyRemainingPercent}%`}<br />额度检查：{date(status.quota.checkedAt)}{status.quota.resetAt ? ` · 窗口恢复：${date(status.quota.resetAt)}` : ''}</p> : <p>套餐额度尚无回执。</p>}</div></div>
    <div className={mini.controls}><button className={styles.primaryButton} type="button" disabled={disabled || (status.desiredState === 'running' && (status.runnerAlive || status.supervisorAlive || status.activeVerifierCount > 0))} onClick={() => { void submit('resume') }}><WorkbenchIcon name="play" size={16} />{busy ? '正在提交…' : '恢复自动推进'}</button><button className={mini.pauseButton} type="button" disabled={disabled || status.desiredState === 'paused'} onClick={() => { void submit('pause') }}>暂停后续任务</button><p>暂停阻止新的 MiniMax 调用；已发出的请求可能完成并继续记录用量。</p></div>
    {receipt ? <p className={mini.commandReceipt} role="status">{receipt}</p> : null}{latest?.status === 'failed' ? <p className={styles.error}>执行器未能完成指令，请同步最新状态后重试。</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}
  </section>
}
