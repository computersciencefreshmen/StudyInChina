import type { MiniMaxContinuousStatus } from '@/lib/admin/minimax-continuous-contract'
import styles from './Workbench.module.css'
import mini from './MiniMaxPanels.module.css'

const phases: Record<MiniMaxContinuousStatus['phase'], string> = { idle: '等待推进', capturing: '抓取官方网页和附件', 'reviewing-candidates': '独立复核候选字段', 'preparing-records': '准备完整记录证据', 'reviewing-record': 'MiniMax 完整记录复核', publishing: '应用审定结果', waiting: '等待下次推进', paused: '管理员已暂停', blocked: '需要处理证据或执行问题', complete: '本轮有限任务完成' }
const reasons: Partial<Record<MiniMaxContinuousStatus['reason'], string>> = { failure_budget_exhausted: '连续失败预算已耗尽，保留付费历史并停止新请求。', bounded_failure_backoff: '服务异常后的有限等待，不重发失败请求。', quota_or_billing_admission_stopped: '当前额度或计费规则阻止新的模型调用。', paid_admission_stopped: '本地与远端运行授权尚未确认一致，暂停新的模型调用。', stage_revalidation_required: '来源证据需要重新核对。', ambiguous_paid_outcome: '付费结果不明确，等待离线核查。', manual_pause: '暂停阻止新调用，已发出的请求可能完成。', authorization_missing: '缺少当前持续执行授权。', existing_worker_preserved: '保留已有健康执行器，避免重复执行。', engineering_failure: '本轮遇到工程错误，详情留在私有回执中。' }
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '等待观察'

export function MiniMaxContinuousPanel({ status, now }: { status: MiniMaxContinuousStatus; now: number }) {
  const age = now - Date.parse(status.updatedAt), stale = age < -5000 || age > 120_000
  return <section className={`${styles.panel} ${mini.automation}`} aria-labelledby="continuous-pipeline-title">
    <div className={mini.automationHeading}><div><p className={mini.eyebrow}>OFFICIAL SOURCE PIPELINE</p><h2 id="continuous-pipeline-title">持续官网采集与独立复核</h2><p className={styles.smallMuted}>字段复核、完整记录比较和公开批准分别计数；新增事实须通过完整发布门槛。</p></div><span className={styles.status} data-active={!stale && status.active}><i />{stale ? '上次观察 · 待更新' : phases[status.phase]}</span></div>
    <div className={mini.automationBody}><div><strong className={mini.phase}>MiniMax-M3</strong><p>候选字段：{status.reviewer.completed} 次完成 · {status.reviewer.failed} 次失败</p><p>完整记录比较：{status.fullRecord.completed} 次完成 · {status.fullRecord.failed} 次失败</p><p>正式数据应用：{status.fullRecord.approvedPublications} 条 · 待确认：{status.fullRecord.pending} 条</p></div><div className={mini.funding}><span>官方来源</span><strong>{status.sources.programsCaptured} 个项目 · {status.sources.captures} 份抓取</strong><p>状态观察：{date(status.updatedAt)}<br />最近抓取：{date(status.sources.lastCapturedAt)}<br />下次检查：{date(status.nextCheckAt)}</p></div></div>
    {reasons[status.reason] ? <p className={mini.commandReceipt}>{reasons[status.reason]}</p> : null}
    <p className={styles.smallMuted}>记录批准不等于网站已上线；上线由版本发布和公开读回确认。连续候选失败 {status.reviewer.consecutiveFailures} 次，完整记录失败 {status.fullRecord.consecutiveFailures} 次。</p>
  </section>
}
