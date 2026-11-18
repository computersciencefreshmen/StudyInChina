'use client'

import { useEffect, useState } from 'react'
import styles from './PublicMiniMaxDashboard.module.css'

type Summary = { observedAt: string; publicPrograms: number; captured: number; decisionReadyMajors: number;
  fundedSchools: number; currentScholarshipOpportunities: number; openCycles: number; bands: number[]; archived: number | null; missingDegree: number | null;
  revision: string; stall: { eligibleWindowsWithoutGrowth: number; reason: string | null } | null;
  lastReadback: { verifiedAt: string; revision: string } | null;
  lastTranslationReview: { updatedAt: string; review: { approved: number; revise: number; blocked: number } } | null }
const number = (n: number | null) => n === null ? '待统计' : n.toLocaleString('zh-CN')
const when = (s: string) => new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

export function ProgrammeCoveragePanel() {
  const [data, setData] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    async function update() {
      try {
        const response = await fetch('/api/minimax/catalogue', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), credentials: 'omit' })
        if (!response.ok) throw new Error('unavailable')
        const result: Summary = await response.json()
        if (!controller.signal.aborted) { setData(result); setFailed(false) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
    }
    void update()
    const interval = setInterval(() => { if (!document.hidden) void update() }, 60_000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [])
  return <section className={styles.section} aria-labelledby="programme-outcomes">
    <h2 id="programme-outcomes">公开目录与申请条件</h2>
    {failed && <p role="status">本次目录回读失败。{data ? '以下保留上次观测。' : ''}</p>}
    {data ? <>
      <p className={styles.note}>网站观测于北京时间 {when(data.observedAt)}</p>
      <div className={styles.metrics}>{[
        ['已采集详情', data.captured], ['公开项目条目', data.publicPrograms], ['当期条件齐备的专业', data.decisionReadyMajors],
        ['接受申请的批次', data.openCycles], ['有有效奖学金的目录学校', data.fundedSchools], ['已归档原件的详情', data.archived], ['采集详情缺学位', data.missingDegree],
      ].map(([label, value]) => <div className={styles.metric} key={String(label)}><span>{label}</span><strong>{number(value as number | null)}</strong></div>)}</div>
      <p>按条件齐备专业数统计学校：0 个 {data.bands[0]} 所，1 个 {data.bands[1]} 所，2–4 个 {data.bands[2]} 所，至少 5 个 {data.bands[3]} 所。</p>
      <p>{data.lastTranslationReview ? `最近一次译后审核（${when(data.lastTranslationReview.updatedAt)}）通过 ${data.lastTranslationReview.review.approved} 段，退修 ${data.lastTranslationReview.review.revise} 段，隔离 ${data.lastTranslationReview.review.blocked} 段。` : '尚无独立译后审核批次回执。'}</p>
      <p>{data.lastReadback ? `最近生产验收：${when(data.lastReadback.verifiedAt)}，${data.lastReadback.revision === data.revision ? '覆盖当前目录版本' : '当前版本仍待验收'}。` : '尚无生产验收回执。'}</p>
      {data.stall && data.stall.eligibleWindowsWithoutGrowth >= 4 && <p role="status">连续 {data.stall.eligibleWindowsWithoutGrowth} 个有待办的窗口没有新增。阶段：{data.stall.reason ?? '待定位'}。</p>}
    </> : !failed && <p>正在读取公开目录。</p>}
  </section>
}
