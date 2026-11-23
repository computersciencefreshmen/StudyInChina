'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { publicMiniMaxStatusSchema, PUBLIC_MONITOR_REFRESH_MS, type PublicMiniMaxStatus } from '@/lib/minimax/public-monitor'
import styles from './PublicMiniMaxDashboard.module.css'
import { MiniMaxActivityCharts, appendSessionObservation, type SessionObservation } from './MiniMaxActivityCharts'

const format = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString('zh-CN')
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)) : '尚无可确认记录'
const status = { completed: '调用完成 · 已收到响应', unknown: '结果未知 · 不重发', known_failed: '已确认失败', send_started: '已开始发送', reserved: '已预留' }
const fresh = (at: string | null | undefined, now: number) => Boolean(at && now >= Date.parse(at) - 5_000 && now - Date.parse(at) <= 120_000)
const periodNames = { today: '今日 · 北京时间', 'five-hour': '本轮 5 小时' }

/** Presentation has no token, administrative endpoint, or write action. */
export function PublicMiniMaxDashboard({ catalogue }: { catalogue?: React.ReactNode } = {}) {
  const [value, setValue] = useState<PublicMiniMaxStatus | null>(null), [now, setNow] = useState<number | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [observations, setObservations] = useState<SessionObservation[]>([])
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const tick = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 15_000)
    let reading = false
    async function update() {
      if (stopped || document.hidden || reading) return
      reading = true
      try {
        const response = await fetch('/api/minimax/status', { method: 'GET', credentials: 'omit', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) })
        if (!response.ok) throw Error('unavailable')
        const next = publicMiniMaxStatusSchema.parse(await response.json())
        if (!stopped) { setValue(next); setNow(Date.now()); setUnavailable(false); setObservations(previous => appendSessionObservation(previous, next, Date.now())) }
      } catch { if (!stopped) { setUnavailable(true); setNow(Date.now()) } }
      finally {
        reading = false
        if (!stopped && !document.hidden) timer = setTimeout(update, PUBLIC_MONITOR_REFRESH_MS)
      }
    }
    function onVisibilityChange() {
      if (timer) clearTimeout(timer)
      if (!document.hidden) void update()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    void update()
    return () => {
      stopped = true
      controller.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(tick)
      if (timer) clearTimeout(timer)
    }
  }, [])
  const ledgerFresh = Boolean(value?.state === 'fresh' && !unavailable && now !== null && fresh(value.observedAt, now))
  const quotaFresh = Boolean(value?.quota.state === 'fresh' && !unavailable && now !== null && fresh(value.quota.observedAt, now)
    && value.quota.fiveHour && Date.parse(value.quota.fiveHour.resetAt) > now
    && value.quota.weekly && (value.quota.weekly.unlimited || value.quota.weekly.resetAt && Date.parse(value.quota.weekly.resetAt) > now))
  const today = value?.periods.find(p => p.id === 'today'), processing = value?.processing
  const processingFresh = Boolean(processing?.fresh && !unavailable && now !== null && fresh(processing.observedAt, now))
  return <main className={styles.page}>
    <div className={styles.content}>
      <header className={styles.header}><Link href="/en" className={styles.brand}>STUDY IN CHINA <span>ATLAS</span></Link><span className={styles.readonly}>公开只读 · 无操作权限</span></header>
      <div className={styles.heading}><div><p className={styles.eyebrow}>CLOUD ACTIVITY / LIVE OBSERVATIONS</p><h1>MiniMax<br /><em>此刻在做什么？</em></h1><p className={styles.intro}>看真实调用与响应，不只看一个绿色在线标记。<br />电脑关机也能查看，约每 45 秒更新。</p></div><div className={styles.observation}><span className={ledgerFresh ? styles.live : styles.waiting}>{ledgerFresh ? '云端账本观测新鲜' : value?.observedAt ? '历史观测 · 待更新' : unavailable || value ? '云端账本暂不可用' : '正在连接云端账本'}</span><p>账本观测时间<br /><strong>{date(value?.observedAt)}</strong></p>{unavailable ? <p role="status">本次读取未成功，保留上次观测。</p> : null}</div></div>

      <section className={styles.evidence} aria-labelledby="actual-calls"><div className={styles.sectionTitle}><span>01 / 调用证据</span><h2 id="actual-calls">实际发生了什么</h2></div>
        <div className={styles.metrics}><Metric label="今日调用尝试" value={format(today?.attempts)} /><Metric label="今日调用完成" value={format(today?.completed)} /><Metric label="今日结果未知" value={format(today?.unknown)} /></div>
        <div className={styles.timestamps}><p>最近模型调用开始<strong>{date(value?.latestCallAt)}</strong></p><p>最近列表中的已确认响应<strong>{date(value?.latestCompletedAt)}</strong></p></div>
        <p className={styles.note}>等待一轮刷新，观察完成数和 Token 是否增长。调用尝试可能失败或结果未知；完成响应也不等于数据已上线。</p>
      </section>

      <MiniMaxActivityCharts value={value} observations={observations} dataFresh={ledgerFresh} tasksFresh={processingFresh} />

      <section className={styles.quota} aria-label="订阅额度"><Quota label="5 小时剩余额度" value={value?.quota.fiveHour ? `${value.quota.fiveHour.remainingPercent}%` : '未知'} detail={`重置 ${date(value?.quota.fiveHour?.resetAt)}`} /><Quota label="每周剩余额度" value={value?.quota.weekly ? value.quota.weekly.unlimited ? '∞' : `${value.quota.weekly.remainingPercent}%` : '未知'} detail={value?.quota.weekly?.unlimited ? '服务商观测：周额度不限' : `重置 ${date(value?.quota.weekly?.resetAt)}`} /><div className={styles.quotaFoot}><span>{quotaFresh ? '当前额度观测' : '额度未知或历史观测'} · {date(value?.quota.observedAt)}</span><p>来自订阅 Token Plan，不是账单或积分余额；∞ 不代表 5 小时无限。</p></div></section>

      <section className={styles.section} aria-labelledby="token-usage"><div className={styles.sectionTitle}><span>02 / 已报告用量</span><h2 id="token-usage">今日与本轮窗口</h2></div>
        {!value?.periods.length ? <p className={styles.empty}>用量暂不可确认，未知不会显示为 0。</p> : <div className={styles.periods}>{value.periods.map(p => <article key={p.id} className={styles.period}><h3>{periodNames[p.id]}</h3><p className={styles.periodDates}>{date(p.startAt)} — {date(p.endAt)}</p><dl><div><dt>输入 Token</dt><dd>{format(p.inputTokens)}</dd></div><div><dt>输出 Token</dt><dd>{format(p.outputTokens)}</dd></div><div><dt>缓存读取 / 写入</dt><dd>{format(p.cacheReadTokens)} / {format(p.cacheWriteTokens)}</dd></div><div><dt>尝试 / 完成 / 未知</dt><dd>{p.attempts} / {p.completed} / {p.unknown}</dd></div></dl><ul className={styles.models}>{p.models.map(m => <li key={m.model}><strong>{m.model}</strong><span>{m.attempts} 次尝试 · {m.completed} 次完成</span></li>)}</ul>{p.unknownUsageAttempts ? <p className={styles.note}>{p.unknownUsageAttempts} 次尝试未完整报告用量，以上是已记录下限。</p> : null}</article>)}</div>}
        <p className={styles.note}>两组时间窗口有重叠，不能相加。缓存按服务商原值单列，不再次计入输入 Token；历史调用按实际开始时间归属。</p>
      </section>

      <section className={styles.work} aria-labelledby="processing"><div><div className={styles.sectionTitle}><span>03 / 后台任务</span><h2 id="processing">排队与执行</h2></div><p className={styles.note}>{processingFresh ? '当前任务观测' : '任务状态未知或待更新'} · {date(processing?.observedAt)}</p></div><div className={styles.queue}><Metric label="模型任务 · 排队 / 执行" value={processing ? `${format(processing.modelPending)} / ${format(processing.modelExecuting)}` : '未知'} /><Metric label="模型任务并发上限" value={format(processing?.taskConcurrencyLimit)} /><Metric label="抓取任务 · 排队 / 执行" value={processing ? `${format(processing.capturePending)} / ${format(processing.captureExecuting)}` : '未知'} /></div><p className={styles.note}>这是任务容量，不是实际 HTTP 并行数。任务执行数不是正在发送的模型请求数；新调用仍需通过额度、证据和防重放校验。</p></section>

      <section className={styles.section} aria-labelledby="recent-calls"><div className={styles.sectionTitle}><span>04 / 最近响应</span><h2 id="recent-calls">最近云端调用</h2></div>{value?.recentCalls.length ? <ol className={styles.calls}>{value.recentCalls.map((call, index) => <li key={`${call.startedAt}:${index}`}><div><time>{date(call.startedAt)}</time><strong>{call.model}</strong><span>{call.pass === 'primary' ? '提取' : '独立复核'}</span></div><b className={call.status === 'completed' ? styles.success : styles.callState}>{status[call.status]}</b></li>)}</ol> : <p className={styles.empty}>暂无可确认的最近调用记录。</p>}</section>

      <section className={styles.coverage} aria-labelledby="coverage"><div><p className={styles.eyebrow}>QUALITY BEFORE VOLUME</p><h2 id="coverage">身份发现 ≠ 条件齐备</h2><p>专业名称进入目录后，还要补齐当前年度、资格、语言要求与官方申请入口，才能计作完整申请项目。</p><Link href="/en/programs">查看公开项目目录 →</Link></div><div>{value?.coverage ? <><p className={styles.coverageDate}>覆盖快照 {value.coverage.evaluatedOn}{value.coverage.stale || !ledgerFresh ? ' · 历史快照，待更新' : ''}</p><Metric label="条件齐备项目" value={format(value.coverage.currentPrograms)} /><Metric label="至少 5 个完整项目的学校" value={`${format(value.coverage.fivePlus)} / ${format(value.coverage.schools)}`} /><p className={styles.note}>有效奖学金机会 {format(value.coverage.currentScholarships)}。模型完成次数不计作新增项目数。</p></> : <p>完整覆盖快照暂不可用，不能据调用数推断已达标。</p>}</div></section>
      {catalogue}
      <footer className={styles.footer}><span>Study in China Atlas · 只读用量看板</span><span>时间均为北京时间 · 云端采样约 45 秒，页面每 45 秒查询</span></footer>
    </div>
  </main>
}
function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div> }
function Quota({ label, value, detail }: { label: string; value: string; detail: string }) { return <article><span>{label}</span><strong>{value}</strong><p>{detail}</p></article> }
