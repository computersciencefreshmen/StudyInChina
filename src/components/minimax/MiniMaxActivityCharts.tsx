import type { PublicMiniMaxStatus } from '@/lib/minimax/public-monitor'
import styles from './PublicMiniMaxDashboard.module.css'

export type SessionObservation = { observedAt: string; attempts: number; completed: number; windowKey: string }
/** This is a bounded browser-session observation series, never invented history. */
export function appendSessionObservation(previous: SessionObservation[], value: PublicMiniMaxStatus, now: number): SessionObservation[] {
  const today = value.periods.find(p => p.id === 'today'), at = Date.parse(value.observedAt ?? '')
  if (!today || value.state !== 'fresh' || !Number.isFinite(at) || at > now + 5000 || now - at > 120000) return previous
  const windowKey = `${today.startAt}|${value.periods.find(p => p.id === 'five-hour')?.startAt ?? ''}`
  const next = { observedAt: value.observedAt!, attempts: today.attempts, completed: today.completed, windowKey }, last = previous.at(-1)
  if (last && Date.parse(last.observedAt) >= at) return previous
  if (!last || last.windowKey !== windowKey || next.attempts < last.attempts || next.completed < last.completed) return [next]
  return [...previous, next].slice(-20)
}
const number = (value: number) => value.toLocaleString('zh-CN')
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
export function MiniMaxActivityCharts({ value, observations, dataFresh = value?.state === 'fresh', tasksFresh = value?.processing?.fresh ?? false }: { value: PublicMiniMaxStatus | null; observations: SessionObservation[]; dataFresh?: boolean; tasksFresh?: boolean }) {
  const today = value?.periods.find(p => p.id === 'today'), processing = value?.processing
  const ratio = today?.attempts ? Math.min(100, today.completed / today.attempts * 100) : 0
  const max = Math.max(1, ...observations.map(p => p.completed)), min = Math.min(max, ...observations.map(p => p.completed))
  const first = Date.parse(observations[0]?.observedAt ?? ''), last = Date.parse(observations.at(-1)?.observedAt ?? '')
  const coords = observations.map(p => ({ x: last > first ? 14 + (Date.parse(p.observedAt) - first) / (last - first) * 252 : 140,
    y: max > min ? 120 - (p.completed - min) / (max - min) * 78 : 78 }))
  const curve = coords.map((p, i) => !i ? `M ${p.x} ${p.y}` : `C ${(coords[i - 1].x + p.x) / 2} ${coords[i - 1].y} ${(coords[i - 1].x + p.x) / 2} ${p.y} ${p.x} ${p.y}`).join(' ')
  const queueMax = Math.max(1, processing?.modelPending ?? 0, processing?.modelExecuting ?? 0, processing?.capturePending ?? 0, processing?.captureExecuting ?? 0)
  return <section aria-label="真实调用图表" className={styles.chartsGrid}>
    <article className={styles.chartCard}><p className={styles.chartKicker}>SESSION OBSERVATIONS</p><h2>近期调用变化</h2><p className={styles.chartCaption}>本次打开期间 · 已完成响应累计{!dataFresh ? ' · 历史观测，待更新' : ''}</p>
      {coords.length ? <><svg viewBox="0 0 280 150" role="img" aria-label={`本次打开期间${coords.length}个真实观测点，最近完成${number(observations.at(-1)!.completed)}次`} className={styles.lineChart}>
        <path d="M 14 130 H 266" stroke="#dce6d9" strokeWidth="1" />
        {coords.length > 1 ? <path d={curve} fill="none" stroke="#547f65" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {coords.map((p, i) => <circle key={observations[i].observedAt} cx={p.x} cy={p.y} r="4" fill="#547f65" stroke="#fffefa" strokeWidth="2" />)}
        <text x="14" y="19" className={styles.chartValue}>{number(observations.at(-1)!.completed)}</text>
        <text x="276" y="38" textAnchor="end" className={styles.svgLabel}>上界 {number(max)}</text><text x="276" y="145" textAnchor="end" className={styles.svgLabel}>下界 {number(min)}</text>
      </svg><div className={styles.chartAxis}><span>{time(observations[0].observedAt)}</span><span>{time(observations.at(-1)!.observedAt)}</span></div></> : <p className={styles.chartEmpty}>等待第一份新鲜观测</p>}
      <p className={styles.chartFoot}>{!coords.length ? '尚无本次打开期间的有效观测。' : coords.length === 1 ? '首个观测点已记录，下一轮刷新后连线。' : '曲线只连接观测点，不表示区间逐次调用。'} 不含打开前的历史趋势。</p>
    </article>
    <article className={styles.chartCard}><p className={styles.chartKicker}>TODAY’S OUTCOMES</p><h2>今日完成情况</h2><p className={styles.chartCaption}>按真实调用状态计数{!dataFresh ? ' · 历史观测，待更新' : ''}</p>
      {today ? <><svg viewBox="0 0 200 160" role="img" aria-label={`今日${today.attempts}次尝试，完成${today.completed}，确认失败${today.knownFailed}，结果未知${today.unknown}`} className={styles.donutChart}>
        <circle cx="100" cy="79" r="54" fill="none" stroke="#e8eee2" strokeWidth="13" />
        {today.attempts > 0 && today.completed > 0 ? <circle cx="100" cy="79" r="54" fill="none" stroke="#71966e" strokeWidth="13" strokeLinecap="round" pathLength="100" strokeDasharray={`${ratio} ${100 - ratio}`} transform="rotate(-90 100 79)" /> : null}
        <text x="100" y="79" textAnchor="middle" className={styles.donutNumber}>{today.attempts ? `${ratio.toFixed(1)}%` : '0'}</text><text x="100" y="99" textAnchor="middle" className={styles.svgLabel}>{today.attempts ? '已完成' : '尚无尝试'}</text>
      </svg><dl className={styles.chartLegend}>{[['已完成', today.completed], ['确认失败', today.knownFailed], ['结果未知', today.unknown], ['其他状态', Math.max(0, today.attempts - today.completed - today.knownFailed - today.unknown)]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{number(Number(n))}</dd></div>)}</dl></> : <p className={styles.chartEmpty}>状态未观测，不显示为零</p>}
      <p className={styles.chartFoot}>完成是收到模型响应，不等于项目已发布。</p>
    </article>
    <article className={styles.chartCard}><p className={styles.chartKicker}>TASK FLOW</p><h2>排队与执行</h2><p className={styles.chartCaption}>{processing ? tasksFresh ? '任务数量 · 不是模型 HTTP 并行数' : '历史观测，待更新 · 不是模型 HTTP 并行数' : '等待任务观测'}</p>
      {processing ? <svg viewBox="0 0 280 200" role="img" aria-label={`模型任务排队${processing.modelPending}，执行${processing.modelExecuting}；抓取排队${processing.capturePending}，执行${processing.captureExecuting}`} className={styles.queueChart}>
        {[['模型排队', processing.modelPending], ['模型执行', processing.modelExecuting], ['抓取排队', processing.capturePending], ['抓取执行', processing.captureExecuting]].map(([label, n], i) => <g key={label}>
          <text x="3" y={16 + i * 48} className={styles.svgLabel}>{label}</text><text x="276" y={16 + i * 48} textAnchor="end" className={styles.svgLabel}>{number(Number(n))}</text>
          <rect x="3" y={26 + i * 48} width="274" height="10" rx="5" fill="#e8eee2" />{Number(n) > 0 ? <rect x="3" y={26 + i * 48} width={274 * Number(n) / queueMax} height="10" rx="5" fill={i % 2 ? '#547f65' : '#b4c5a0'} /> : null}
        </g>)}
      </svg> : <p className={styles.chartEmpty}>任务数量未知</p>}
      <p className={styles.chartFoot}>只有新鲜的调用与完成增量能证明工作在推进。</p>
    </article>
  </section>
}
