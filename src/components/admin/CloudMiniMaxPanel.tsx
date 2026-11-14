'use client'

import { useEffect, useState } from 'react'
import type { CloudMiniMaxSnapshot } from '@/lib/admin/cloud-minimax-contract'
import { quotaObservationIsCurrent, CLOUD_MONITOR_STALE_MS } from '@/lib/admin/cloud-minimax-contract'
import styles from './Workbench.module.css'
import cloud from './CloudMiniMaxPanel.module.css'

const number = (v: number | null | undefined) => v === null || v === undefined ? '未知' : v.toLocaleString('zh-CN')
const date = (v: string | null | undefined) => v ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v)) : '未知'
const labels = { today: '今日 · 北京时间', 'five-hour': '本轮 5 小时', weekly: '本周额度窗口', 'recent-seven-days': '最近 7 天 · 含历史调用' }
const stateLabel: Record<string, string> = { completed: '完成', unknown: '结果未知', known_failed: '确认失败', send_started: '已开始发送', reserved: '已预留' }
export function CloudMiniMaxPanel({ value, now }: { value: CloudMiniMaxSnapshot | null | undefined; now: number }) {
  // The panel must age even when every subsequent cloud refresh fails. Reading
  // only snapshot.generatedAt would leave the last observation fresh forever.
  const [clock, setClock] = useState(now)
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(timer) }, [])
  const current = Math.max(now, clock)
  const q = value?.quota, ledger = value?.ledger, freshQuota = Boolean(q && quotaObservationIsCurrent(q, current))
  const ledgerFresh = Boolean(ledger && value?.ledgerState === 'fresh' && current - Date.parse(ledger.observedAt) <= CLOUD_MONITOR_STALE_MS && current >= Date.parse(ledger.observedAt) - 5_000)
  const today = ledger?.periods.find(p => p.id === 'today')
  return <section className={`${styles.panel} ${cloud.panel}`} aria-labelledby="cloud-minimax-title">
    <div className={styles.panelHeading}><div><h2 id="cloud-minimax-title">云端 MiniMax</h2><p>电脑关机后仍可查看 · 约每 45 秒刷新</p></div><span className={styles.softBadge}>{ledgerFresh ? '云端账本已连接' : ledger ? '账本缓存 · 待更新' : '云端账本暂不可用'}</span></div>
    <div className={cloud.quotas}>
      <article><span>5 小时剩余额度</span><strong>{q?.fiveHour ? `${q.fiveHour.remainingPercent}%` : '未知'}</strong><p>{freshQuota ? '当前观测' : q?.fiveHour ? '历史观测 · 已过期或读取失败' : '等待额度观测'} · 重置 {date(q?.fiveHour?.resetAt)}</p></article>
      <article><span>每周剩余额度</span><strong>{q?.weekly ? q.weekly.unlimited ? '∞' : `${q.weekly.remainingPercent}%` : '未知'}</strong><p>{q?.weekly?.unlimited ? `${freshQuota ? '当前' : '历史'}套餐观测为不限周额度` : `重置 ${date(q?.weekly?.resetAt)}`}</p></article>
    </div>
    <p className={cloud.meta}>额度观测 {date(q?.observedAt)} · 最近检查 {date(q?.checkedAt)}{!freshQuota ? ' · 额度未知或待更新' : ''}</p>
    <p className={cloud.note}>百分比来自 Token Plan，不代表余额或账单。积分余额未由此接口提供；∞ 也不代表 5 小时额度无限。</p>
    {ledger ? <>
      <div className={cloud.stats}><div><span>今日实际尝试</span><strong>{number(today?.totals.attempts)}</strong></div><div><span>今日完成</span><strong>{number(today?.totals.completed)}</strong></div><div><span>今日结果未知</span><strong>{number(today?.totals.unknown)}</strong></div><div><span>今日用量未完整报告</span><strong>{number(today?.totals.tokens.unknownUsageAttempts)}</strong></div></div>
      <p className={cloud.meta}>云端账本观测 {date(ledger.observedAt)} · {ledger.control.scopeCount} 所维护学校 · 任务{ledger.control.enabled ? '启用' : '暂停'} / 模型{ledger.control.modelsEnabled ? '启用' : '暂停'}</p>
      <div className={cloud.tableScroll}><table><caption>按实际调用开始时间统计 · 各时间窗口互有重叠，请勿相加</caption><thead><tr><th>时间范围 / 模型</th><th>尝试</th><th>完成 / 未知</th><th>输入 Token</th><th>输出 Token</th><th>缓存读取</th><th>缓存写入</th></tr></thead><tbody>{ledger.periods.flatMap(p => [<tr key={p.id} className={cloud.period}><th scope="row">{labels[p.id]}</th><td>{number(p.totals.attempts)}</td><td>{number(p.totals.completed)} / {number(p.totals.unknown)}</td><td>{number(p.totals.tokens.input)}</td><td>{number(p.totals.tokens.output)}</td><td>{number(p.totals.tokens.cacheRead)}</td><td>{number(p.totals.tokens.cacheWrite)}</td></tr>, ...p.models.map(m => <tr key={`${p.id}:${m.model}`}><th scope="row">{m.model}</th><td>{number(m.attempts)}</td><td>{m.completed} / {m.unknown}</td><td>{number(m.tokens.input)}</td><td>{number(m.tokens.output)}</td><td>{number(m.tokens.cacheRead)}</td><td>{number(m.tokens.cacheWrite)}</td></tr>)])}</tbody></table></div>
      <p className={cloud.note}>Token 和缓存分别展示服务商实际报告值；含未知用量的汇总仅为已记录下限。没有报告的字段显示“未知”。迁移的历史记录按原调用时间归属，不会算作今日新增，也不会与本机历史相加。</p>
      {ledger.coverage ? <p className={cloud.coverage}>有效具体专业覆盖 · {ledger.coverage.evaluatedOn}{ledger.coverage.stale ? '（过期快照）' : ''}：0 个 {ledger.coverage.zero} 校，1 个 {ledger.coverage.one} 校，2–4 个 {ledger.coverage.twoToFour} 校，至少 5 个 {ledger.coverage.fivePlus} 校；有效项目 {ledger.coverage.currentPrograms}，奖学金机会 {ledger.coverage.currentScholarships}。</p> : <p className={cloud.note}>当前目录的完整覆盖快照暂不可用，不能据维护学校数认定已覆盖。</p>}
      <details className={cloud.recent}><summary>最近云端调用与任务</summary><ul>{ledger.recentAttempts.map(a => <li key={a.attemptId}><span>{date(a.startedAt)} · {a.model} · {a.pass === 'primary' ? '提取' : '独立复核'}</span><strong>{stateLabel[a.status]}{a.errorCode ? ` · ${a.errorCode}` : ''}</strong></li>)}</ul><ul>{ledger.recentJobs.map(j => <li key={j.id}><span>{date(j.updatedAt)} · {j.stage}</span><strong>{j.status}{j.errorCode ? ` · ${j.errorCode}` : ''}</strong></li>)}</ul>{!ledger.recentAttempts.length && !ledger.recentJobs.length ? <p>最近 7 天暂无可报告的云端任务。</p> : null}</details>
    </> : <p className={cloud.note}>当前无法读取云端调用账本，消耗和调用数暂不可确认。管理员登录与目录浏览仍可正常使用。</p>}
  </section>
}
