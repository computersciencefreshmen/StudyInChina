import { catalogMaintenanceObservationIsStale, type CatalogMaintenanceObservation } from '@/lib/admin/catalog-maintenance-contract'
import styles from './Workbench.module.css'
import mini from './MiniMaxPanels.module.css'

const count = (value: number) => value.toLocaleString('zh-CN')
const time = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)) : '尚无观察'
const collections = { cities: '城市', universities: '学校', programs: '专业项目', 'admission-cycles': '招生批次', scholarships: '奖学金' } as const

/** Native observations are operational progress, never a factual certification. */
export function CatalogMaintenancePanel({ status, now }: { status: CatalogMaintenanceObservation; now: number }) {
  const stale = catalogMaintenanceObservationIsStale(status, now)
  const source = status.sourceFrontier, extraction = status.privateExtraction, records = status.recordPipeline
  return <section className={`${styles.panel} ${mini.automation}`} aria-labelledby="catalog-maintenance-title">
    <div className={mini.automationHeading}><div><p className={mini.eyebrow}>CATALOG MAINTENANCE</p><h2 id="catalog-maintenance-title">全目录维护进度</h2><p className={styles.smallMuted}>采集、候选、整条复核和正式应用分别展示；全站核实仍未完成。</p></div><span className={styles.status}>{stale ? '上次观察 · 待更新' : '执行器实际记录'}</span></div>
    <div className={mini.ledgerMetrics}>
      <div><span>历史访问记录身份</span><strong>{source ? count(source.visitedRecordIdentities) : '—'}</strong><small>抓取记录，不是已核实数量</small></div>
      <div><span>完整私有候选任务</span><strong>{extraction ? count(extraction.candidateReadyTasks) : '—'}</strong><small>等待独立事实审核</small></div>
      <div><span>正式数据应用</span><strong>{records ? count(records.canonicalAppliedRecords) : '—'}</strong><small>不等于已公开上线</small></div>
    </div>
    {source ? <div className={mini.tableScroll}><table className={mini.dailyTable}><caption className={styles.smallMuted}>官方原件采集 · 按记录类型</caption><thead><tr><th scope="col">类型</th><th scope="col">已访问身份</th><th scope="col">原件已抓取</th><th scope="col">部分抓取</th><th scope="col">未确认</th><th scope="col">保留待处理</th></tr></thead><tbody>{Object.entries(collections).map(([key, label]) => { const row = source.collections[key as keyof typeof collections]; return <tr key={key}><th scope="row">{label}</th>{[row.visitedRecordIdentities, row.captured, row.partial, row.unconfirmed, row.held].map((value, index) => <td key={index}>{count(value)}</td>)}</tr> })}</tbody></table></div> : <p className={styles.smallMuted}>全类型来源观察尚未接入。</p>}
    <div className={mini.automationBody}><div><strong className={mini.phase}>独立审核与发布</strong><p>整条记录比较：{records ? count(records.completedComparisons) : '—'} 次完成 · {records ? count(records.retainedFailedComparisons) : '—'} 次保留失败</p><p>完整事实批准：未接入独立回执<br />公开上线读回：未接入独立回执</p></div><div className={mini.funding}><span>各阶段原始更新时间</span><p>来源访问：{time(source?.lastVisitedAt ?? null)}<br />私有候选：{time(extraction?.updatedAt ?? null)}<br />整条协调：{time(records?.lastCoordinatorHeartbeatAt ?? null)}<br />面板观察：{time(status.observedAt)}</p></div></div>
    <p className={styles.smallMuted}>历史访问可能包含已经退出目录的身份；不据此计算全库核实百分比。网页和附件已抓取，也不等于 MiniMax 已阅读并批准。</p>
  </section>
}
