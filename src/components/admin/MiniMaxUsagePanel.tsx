import type { AdminUsageLedger, TokenLedgerTotals } from '@/lib/admin/types'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './Workbench.module.css'
import mini from './MiniMaxPanels.module.css'

const number = (value: number) => value.toLocaleString('zh-CN')
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const emptyTotals: TokenLedgerTotals = { attempts: 0, instrumentedAttempts: 0, historicalResponses: 0, unknownUsageAttempts: 0, reportedTokens: 0, instrumentedReportedTokens: 0, historicalReportedTokensLowerBound: 0, inputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const usageKnown = (totals: TokenLedgerTotals) => totals.reportedTokens > 0 || totals.attempts > 0 && totals.unknownUsageAttempts === 0

export function MiniMaxUsagePanel({ ledger, stale }: { ledger: AdminUsageLedger; stale: boolean }) {
  const todayRow = ledger.daily.find(row => row.day === ledger.todayDay)
  const today = todayRow ?? emptyTotals
  const todayKnown = Boolean(todayRow && usageKnown(today))
  const todayValue = (value: number) => todayKnown ? number(value) : '—'
  const totalKnown = usageKnown(ledger.totals)
  const lowerBound = today.unknownUsageAttempts > 0 || today.historicalResponses > 0
  const progress = ledger.dailyTarget && todayKnown ? today.reportedTokens / ledger.dailyTarget * 100 : null
  const days = [...ledger.daily].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7)
  return <section className={`${styles.panel} ${mini.ledger}`} aria-labelledby="minimax-ledger-title">
    <div className={styles.panelHeading}><div><h2 id="minimax-ledger-title">MiniMax 调用回执</h2><p>{ledger.todayDay} · 北京时间 · 每次调用独立记录</p></div><span className={styles.softBadge}><WorkbenchIcon name="shield" size={14} />{stale ? '记录待更新' : '回执可追溯'}</span></div>
    <div className={mini.ledgerMetrics}>
      <div><span>今日已记录 Token</span><strong>{todayValue(today.reportedTokens)}</strong><small>{todayRow ? `${number(today.attempts)} 次调用尝试${lowerBound ? ' · 已记录下限' : ''}` : '今日暂无用量回执'}</small></div>
      <div><span>累计已记录 Token</span><strong>{totalKnown ? number(ledger.totals.reportedTokens) : '—'}</strong><small>新回执与可恢复历史记录</small></div>
      <div><span>今日用量未知的尝试</span><strong>{todayRow ? number(today.unknownUsageAttempts) : '—'}</strong><small>累计 {number(ledger.totals.unknownUsageAttempts)} 次，未计入 Token</small></div>
    </div>
    {progress !== null ? <div className={mini.target}><div><span>每日工作目标 · {number(ledger.dailyTarget!)} Token</span><strong>{progress.toFixed(2)}%</strong></div><div className={styles.progress} role="progressbar" aria-label="今日 Token 工作目标进度" aria-valuenow={Math.min(100, progress)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${progress.toFixed(2)}%，已记录 ${number(today.reportedTokens)} Token`}><span style={{ width: `${Math.min(100, progress)}%` }} /></div><p>还差 {number(Math.max(0, ledger.dailyTarget! - today.reportedTokens))} Token；达到目标后可继续处理任务。</p></div> : null}
    <div className={mini.ledgerBody}>
      <div><h3>今日用量组成</h3><dl className={styles.tokenDetails}>{[['输入 Token', today.inputTokens], ['输出 Token', today.outputTokens], ['缓存读取', today.cacheReadTokens], ['缓存写入', today.cacheWriteTokens], ['新增独立回执 Token', today.instrumentedReportedTokens], ['历史响应 Token 下限', today.historicalReportedTokensLowerBound]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{todayValue(Number(value))}</dd></div>)}</dl><p className={styles.smallMuted}>缓存包含在输入中，思考包含在输出中，不重复相加。</p></div>
      <div><h3>最近七个有记录的日期</h3>{days.length ? <div className={mini.tableScroll}><table className={mini.dailyTable}><thead><tr><th scope="col">北京时间日期</th><th scope="col">已记录 Token</th><th scope="col">用量未知</th></tr></thead><tbody>{days.map(row => <tr key={row.day}><th scope="row">{row.day}</th><td>{usageKnown(row) ? number(row.reportedTokens) : '—'}</td><td>{number(row.unknownUsageAttempts)} 次</td></tr>)}</tbody></table></div> : <p className={styles.smallMuted}>尚无已记录调用。</p>}</div>
    </div>
    <div className={styles.panelFootnote}><p>独立回执保留每次调用的 API 用量。旧响应恢复的历史记录仅为下限，未返回用量的尝试单独计数。API Token 与 MiniMax 官方账单、Token Plan 扣减及剩余积分可能不同，请在 MiniMax 用量页核对账户扣费。</p><p className={mini.recordTime}>采集于 {date(ledger.generatedAt)}{ledger.rejectedReceipts || ledger.conflictingAttempts ? ` · ${number(ledger.rejectedReceipts)} 份无效回执 · ${number(ledger.conflictingAttempts)} 次回执冲突，已排除` : ''}</p></div>
  </section>
}
