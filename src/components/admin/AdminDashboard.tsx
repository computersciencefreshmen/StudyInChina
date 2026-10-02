'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import Link from 'next/link'
import type { AdminRun, AdminSnapshot } from '@/lib/admin/types'
import { themeVariables, type SiteTheme } from '@/lib/site-themes'
import { ThemePreference, useSiteTheme } from '@/components/ui/ThemePreference'
import { WorkbenchIcon, type IconName } from './WorkbenchIcon'
import { MiniMaxUsagePanel } from './MiniMaxUsagePanel'
import { MiniMaxAutomationPanel } from './MiniMaxAutomationPanel'
import { AdminThemeSwitcher } from './AdminThemeSwitcher'
import styles from './Workbench.module.css'

export type DashboardSection = 'overview' | 'tasks' | 'usage' | 'catalog'
const sections: { id: DashboardSection; label: string; icon: IconName }[] = [
  { id: 'overview', label: '工作台', icon: 'grid' }, { id: 'tasks', label: '核验任务', icon: 'check' },
  { id: 'catalog', label: '数据目录', icon: 'database' }, { id: 'usage', label: 'Token 用量', icon: 'activity' },
]
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN')
function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '等待记录'
}
function runLabel(run: AdminRun) {
  if (run.status === 'running' && !run.alive) return '进程已停止'
  return { running: '核验中', completed: '已完成', failed: '需处理', incomplete: '未完成', unknown: '状态待确认' }[run.status]
}
function RunCard({ run }: { run: AdminRun }) {
  const progress = run.selectedRecords ? Math.min(100, Math.max(0, (run.completedRecords ?? 0) / run.selectedRecords * 100)) : 0
  return <article className={styles.runCard}>
    <div className={styles.cardHeading}><span className={styles.taskIcon}><WorkbenchIcon name="shield" /></span><span className={styles.status} data-active={run.alive && run.status === 'running'}><i />{runLabel(run)}</span></div>
    <h3>{run.title}</h3><p className={styles.runModel}>{run.model ?? '模型待确认'} · {run.thinking === 'adaptive' ? '自适应思考' : run.thinking === 'disabled' ? '思考关闭' : '思考设置未记录'}{run.effort ? ` · ${run.effort}` : ''}</p>
    <div className={styles.progressLabel}><span>{number(run.completedRecords)} <small>/ {number(run.selectedRecords)} 条记录</small></span><strong>{progress.toFixed(1)}%</strong></div>
    <div className={styles.progress} role="progressbar" aria-label={`${run.title}进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
    {run.summary ? <div className={styles.runVerdicts}><span><i />支持 {number(run.summary.supportedCandidateFields)}</span><span>冲突 {number(run.summary.contradictedCandidateFields)}</span><span>待确认 {number(run.summary.unconfirmedFields)}</span></div> : <p className={styles.smallMuted}>结果汇总将在执行器写入报告后更新。</p>}
    {run.summary ? <p className={styles.smallMuted}>结论汇总于 {date(run.summaryAt)}</p> : null}
    <div className={styles.runFooter}><span><WorkbenchIcon name="clock" size={14} />{date(run.updatedAt)}</span><span>{run.tokenUsage.totalTokens > 0 ? `${number(run.tokenUsage.totalTokens)} Token · 已保存响应` : 'Token 等待回执'}</span></div>
    {run.fatal ? <p className={styles.error}>{run.fatal}</p> : null}
  </article>
}
function AccountMenu({ onLogout }: { onLogout?: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const target = event.target as HTMLElement
      // Theme options use a body portal and still belong to this account panel.
      if (!root.current?.contains(target) && !target.closest('[role="listbox"]')) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open])
  return <div className={styles.accountMenu} ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && !document.querySelector('[role="listbox"]')) { setOpen(false); trigger.current?.focus() }
  }}><button ref={trigger} type="button" className={styles.accountTrigger} aria-label="管理员账户" aria-expanded={open} aria-controls="admin-account-panel" onClick={() => setOpen(value => !value)}><span className={styles.profileAvatar}>HY</span></button>{open ? <div id="admin-account-panel" className={styles.accountPanel} role="region" aria-label="账户设置"><strong>管理员账户</strong><label>界面主题<ThemePreference locale="zh" /></label><Link href="/themes"><WorkbenchIcon name="palette" size={16} />主题实验室</Link><Link href="/zh"><WorkbenchIcon name="globe" size={16} />浏览网站</Link>{onLogout ? <button type="button" onClick={() => { setOpen(false); onLogout() }}><WorkbenchIcon name="logout" size={16} />退出登录</button> : null}</div> : null}</div>
}
function VerificationConnectionInfo({ reason, remote, onClose }: { reason: string | null; remote: boolean; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const items = [...root.current?.querySelectorAll<HTMLElement>('button,a[href]') ?? []]
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
  }
  return <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div ref={root} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="connection-title" aria-describedby="connection-description" onKeyDown={keydown}><div className={styles.modalHeading}><h2 id="connection-title">核验连接说明</h2><button ref={close} type="button" aria-label="关闭连接说明" onClick={onClose}><WorkbenchIcon name="close" /></button></div><p id="connection-description">{remote ? '已连接执行器记录，可查看任务进度和 Token 用量。当前执行器暂时无法接受新任务。' : '目录可以正常查看；核验执行器尚未连接，网站暂时无法创建任务或读取 Token 用量。'}</p>{reason ? <p className={styles.connectionDetail}>{reason}</p> : null}<p>核验由执行器运行，工作台展示同步的任务记录。执行器在线且状态更新后，工作台才会开放任务操作。</p><div className={styles.modalActions}><button type="button" className={styles.primaryButton} onClick={onClose}>知道了</button></div></div></div>
}
export function AdminDashboard({ snapshot, connection, onStart, onRefresh, onLogout, onAutomationAction, automationCommandId = null, verificationReceipt = '', refreshing = false, refreshedAt = null, demo = false, theme }: {
  snapshot: AdminSnapshot; connection: 'connecting' | 'live' | 'polling' | 'offline' | 'demo'
  onStart?: () => void; onRefresh?: () => void; onLogout?: () => void; onAutomationAction?: (action: 'pause' | 'resume') => Promise<void>; automationCommandId?: string | null; verificationReceipt?: string; refreshing?: boolean; refreshedAt?: string | null; demo?: boolean; theme?: SiteTheme
}) {
  const [section, setSection] = useState<DashboardSection>('overview')
  const [connectionInfo, setConnectionInfo] = useState(false)
  const preferredTheme = useSiteTheme()
  const selectedTheme = theme ?? preferredTheme
  const { catalog, runs, usage } = snapshot
  const commandPending = Boolean(automationCommandId && snapshot.automation?.latestCommand?.commandId !== automationCommandId || snapshot.automation?.latestCommand?.status === 'pending' || snapshot.automation?.latestCommand?.status === 'claimed')
  const telemetry = snapshot.telemetry ?? { source: snapshot.capabilities.localMonitoring || demo ? 'local' : 'unavailable', observedAt: snapshot.capabilities.localMonitoring || demo ? snapshot.generatedAt : null, stale: false }
  const usageAvailable = telemetry.source !== 'unavailable'
  const telemetryLabel = telemetry.source === 'remote' ? '执行器同步记录' : telemetry.source === 'local' ? '本机执行器记录' : '执行器未连接'
  // A connected executor with no usage receipt cannot establish zero consumption.
  const cumulativeUsage = snapshot.usageBasis === 'immutable-ledger'
  const savedUsageAvailable = usageAvailable && (usage.totalTokens > 0 || cumulativeUsage && Boolean(snapshot.ledger?.totals.attempts && snapshot.ledger.totals.unknownUsageAttempts === 0))
  const tokenValue = (value: number) => savedUsageAvailable ? number(value) : '—'
  const inputPercent = usageAvailable && usage.totalTokens ? Math.min(100, usage.inputTokens / usage.totalTokens * 100) : 0
  const ledger = usageAvailable ? snapshot.ledger : null
  const cumulativeLedgerValue = ledger && (ledger.totals.reportedTokens > 0 || ledger.totals.attempts > 0 && ledger.totals.unknownUsageAttempts === 0) ? number(ledger.totals.reportedTokens) : '—'
  const todayUsage = ledger?.daily.find(row => row.day === ledger.todayDay)
  const overviewUsage = ledger ? { totalTokens: todayUsage?.reportedTokens ?? 0, inputTokens: todayUsage?.inputTokens ?? 0, outputTokens: todayUsage?.outputTokens ?? 0 } : usage
  const todayUsageAvailable = Boolean(todayUsage && (todayUsage.reportedTokens > 0 || todayUsage.attempts > 0 && todayUsage.unknownUsageAttempts === 0))
  const overviewValue = (value: number) => ledger ? todayUsageAvailable ? number(value) : '—' : tokenValue(value)
  const overviewIsLowerBound = Boolean(todayUsage && (todayUsage.unknownUsageAttempts > 0 || todayUsage.historicalResponses > 0))
  const ledgerAge = ledger ? Date.parse(snapshot.generatedAt) - Date.parse(ledger.generatedAt) : 0
  const ledgerStale = telemetry.stale || Boolean(ledger && (!Number.isFinite(ledgerAge) || ledgerAge > 120_000 || ledgerAge < -30_000))
  const overviewInputPercent = overviewUsage.totalTokens ? Math.min(100, overviewUsage.inputTokens / overviewUsage.totalTokens * 100) : 0
  const automationAge = snapshot.automation ? Date.parse(snapshot.generatedAt) - Date.parse(snapshot.automation.observedAt) : Infinity
  const automationStale = telemetry.stale || !Number.isFinite(automationAge) || automationAge > 120_000 || automationAge < -30_000
  const activeRuns = runs.filter(run => run.status === 'running' && run.alive)
  const totals = [
    { label: '目录记录', value: catalog.totalRecords, detail: `${number(catalog.counts.universities)} 所大学 · ${number(catalog.counts.programs)} 个专业`, icon: 'database' as const },
    { label: '已核实记录', value: catalog.statuses.verified, detail: '目录发布状态 · 可追溯证据', icon: 'shield' as const },
    { label: '需复核记录', value: catalog.statuses.needsReview, detail: `${number(catalog.overdueRecords)} 条已核实记录超过复核日期`, icon: 'clock' as const },
    { label: '运行中任务', value: usageAvailable ? activeRuns.length : null, detail: usageAvailable ? `${number(runs.length)} 个已同步核验批次` : '核验执行器未连接', icon: 'activity' as const },
  ]
  const catalogEntries = [
    ['高校', catalog.counts.universities, '/zh/universities'], ['专业', catalog.counts.programs, '/zh/programs'], ['招生批次', catalog.counts.admissionCycles, null],
    ['奖学金', catalog.counts.scholarships, '/zh/scholarships'], ['城市', catalog.counts.cities, '/zh/cities'], ['来源', catalog.counts.sources, null],
  ] as const
  const statusEntries = [
    ['已核实', catalog.statuses.verified, 'var(--wb-accent)'],
    ['已过期', catalog.statuses.stale, '#f0c98e'], ['草稿', catalog.statuses.draft, 'var(--wb-border)'], ['归档', catalog.statuses.archived, 'var(--wb-muted)'],
  ] as const
  const classifiedRecords = statusEntries.reduce((total, [, count]) => total + count, 0)
  return <div className={styles.workbench} style={themeVariables(selectedTheme) as CSSProperties} data-admin-theme={selectedTheme.id} data-display={selectedTheme.display}>
    <aside className={styles.sidebar}>
      <Link href="/zh" className={styles.brand}><span className={styles.brandMark}>中</span><span>Study in China<small>ADMIN WORKSPACE</small></span></Link>
      <div className={styles.workspaceBadge}><span className={styles.workspaceAvatar}>H</span><span>Atlas 数据工作室<small>管理员空间</small></span></div>
      <p className={styles.navLabel}>WORKSPACE</p>
      <nav aria-label="管理员导航" className={styles.navigation}>{sections.map(item => <button key={item.id} type="button" onClick={() => setSection(item.id)} className={section === item.id ? styles.navActive : ''} aria-current={section === item.id ? 'page' : undefined}><WorkbenchIcon name={item.icon} /><span>{item.label}</span>{item.id === 'tasks' && activeRuns.length > 0 ? <b>{activeRuns.length}</b> : null}</button>)}</nav>
      <div className={styles.sidebarBottom}><p className={styles.navLabel}>TOOLS</p>{!demo ? <ThemePreference locale="zh" /> : null}<Link href="/themes"><WorkbenchIcon name="palette" />主题实验室<WorkbenchIcon name="arrow" size={16} /></Link><Link href="/zh"><WorkbenchIcon name="globe" />浏览网站<WorkbenchIcon name="arrow" size={16} /></Link><div className={styles.adminProfile}><span className={styles.profileAvatar}>HY</span><span>Henry Yang<small>Administrator</small></span>{onLogout ? <button aria-label="退出管理员" onClick={onLogout} type="button"><WorkbenchIcon name="logout" size={18} /></button> : <WorkbenchIcon name="shield" size={18} />}</div></div>
    </aside>
    <div className={styles.main}>
      <header className={styles.topbar}><div className={styles.breadcrumb}>工作空间 <span>/</span> <strong>{sections.find(item => item.id === section)?.label}</strong></div><div className={styles.topbarRight}><span className={styles.connection} data-connected={['live', 'demo', 'polling'].includes(connection)}><i />{({ live: '实时连接', connecting: '连接中', polling: '后台同步', offline: '连接中断', demo: '主题预览' })[connection]}</span>{onRefresh ? <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} aria-label={refreshing ? '正在同步数据' : '同步最新数据'} className={styles.iconButton}><WorkbenchIcon name="refresh" size={18} /></button> : null}<AccountMenu onLogout={onLogout} /></div></header>
      <div className={styles.content}>
        <div className={styles.pageHeading}><div><p className={styles.eyebrow}>YOUR DATA, WITH CONFIDENCE</p><h1>{section === 'overview' ? '让每一条数据，更可信。' : sections.find(item => item.id === section)?.label}</h1><p>{section === 'overview' ? '核验、追踪与处理，在一个清晰的工作空间里完成。' : section === 'tasks' ? '跟踪执行器的实际进度与核验结果。' : section === 'usage' ? '查看独立调用回执、每日进展与已保存响应。' : '从整个目录出发，了解数据覆盖与发布状态。'}</p></div>{!demo && !snapshot.capabilities.startVerification ? <button className={styles.primaryButton} onClick={() => setConnectionInfo(true)} type="button"><WorkbenchIcon name="shield" size={16} />核验连接说明</button> : <button className={styles.primaryButton} onClick={onStart} disabled={demo || !onStart || commandPending} type="button" title={commandPending ? '正在等待执行器完成当前指令' : undefined}><WorkbenchIcon name="play" size={16} />开始核验</button>}</div>
        {!demo ? <AdminThemeSwitcher selected={selectedTheme} /> : null}
        {refreshing || refreshedAt ? <p className={styles.refreshFeedback} role="status">{refreshing ? '正在同步最新数据…' : `已同步最新数据 · ${date(refreshedAt)}`}</p> : null}
        {verificationReceipt ? <p className={styles.refreshFeedback} role="status">{verificationReceipt}</p> : null}
        {demo ? <p className={styles.demoNotice}>主题展示使用示例任务数据；真实工作台在登录后读取实际数据。</p> : snapshot.capabilities.reason ? <p className={styles.infoNotice}>{snapshot.capabilities.reason}</p> : null}
        {section === 'overview' ? <>
          <div className={styles.metrics}>{totals.map(item => <article key={item.label} className={styles.metricCard}><div><span>{item.label}</span><WorkbenchIcon name={item.icon} size={18} /></div><strong>{number(item.value)}</strong><p>{item.detail}</p></article>)}</div>
          <div className={styles.overviewGrid}>
            <article className={`${styles.panel} ${styles.qualityPanel}`}><div className={styles.panelHeading}><div><h2>数据质量概览</h2><p>从证据到发布，持续关注每一步</p></div><span className={styles.softBadge}><WorkbenchIcon name="shield" size={14} />来源可追溯</span></div><div className={styles.qualityBody}><div><span className={styles.smallMuted}>已核实占比</span><strong className={styles.qualityPercent}>{classifiedRecords ? (catalog.statuses.verified / classifiedRecords * 100).toFixed(1) : '0'}<small>%</small></strong><p>{number(catalog.officialSources)} 个官方来源</p></div><div className={styles.qualityChart}><div className={styles.segmentedBar} aria-label="记录发布状态分布">{statusEntries.map(([label, count, color]) => count > 0 ? <span key={label} title={`${label} ${number(count)}`} style={{ flexGrow: count, background: color }} /> : null)}</div><div className={styles.chartLegend}>{statusEntries.map(([label, count, color]) => <div key={label}><span><i style={{ background: color }} />{label}</span><strong>{number(count)}</strong></div>)}</div></div></div><div className={styles.panelFootnote}>占比统计有发布状态的业务记录；来源单独统计。AI 候选结论需人工审阅后发布。</div></article>
            <article className={`${styles.panel} ${styles.tokenPanel}`}><div className={styles.panelHeading}><div><h2>Token 用量</h2><p>{ledger ? `今日调用回执 · ${ledger.todayDay}` : savedUsageAvailable ? '当前保存响应 · 已记录用量下限' : usageAvailable ? '等待有效用量回执' : '未连接执行器记录'}</p></div><WorkbenchIcon name="spark" /></div><strong className={styles.tokenTotal}>{overviewValue(overviewUsage.totalTokens)}<span>{overviewIsLowerBound ? 'Tokens · 至少' : 'Tokens'}</span></strong>{ledger ? <p className={styles.tokenCoverage}>{todayUsage ? `${number(todayUsage.attempts)} 次尝试 · ${number(todayUsage.unknownUsageAttempts)} 次用量未知` : '今日暂无调用回执，无法确认消耗'}<br />累计已记录 {cumulativeLedgerValue} Token</p> : !savedUsageAvailable ? <p className={styles.tokenCoverage}>{usageAvailable ? '执行器已连接，用量尚未报告' : '遥测未接通，消耗暂不可读取'}</p> : null}{todayUsageAvailable || !ledger && savedUsageAvailable ? <div className={styles.tokenBar} aria-label="输入与输出 Token 比例"><span style={{ width: `${overviewInputPercent}%` }} /></div> : null}<dl className={styles.tokenDetails}><div><dt><i />输入</dt><dd>{overviewValue(overviewUsage.inputTokens)}</dd></div><div><dt><i />输出</dt><dd>{overviewValue(overviewUsage.outputTokens)}</dd></div></dl><p className={styles.telemetryMeta}>{telemetryLabel}{ledgerStale ? ' · 记录待更新' : ''}{ledger ? ` · 采集于 ${date(ledger.generatedAt)}` : telemetry.observedAt ? ` · 采集于 ${date(telemetry.observedAt)}` : ''}</p><button className={styles.textButton} type="button" onClick={() => setSection('usage')}>查看用量明细<WorkbenchIcon name="arrow" size={16} /></button></article>
          </div>
        </> : null}
        {!demo && snapshot.automation && (section === 'overview' || section === 'tasks' || section === 'usage') ? <MiniMaxAutomationPanel status={snapshot.automation} stale={automationStale} online={connection === 'live' || connection === 'polling'} commandId={automationCommandId} lastResponseAt={usageAvailable ? usage.lastResponseAt : null} readOnly={snapshot.capabilities.automationControl === false} onAction={snapshot.capabilities.automationControl === false ? undefined : onAutomationAction} /> : null}
        {section === 'usage' && ledger ? <MiniMaxUsagePanel ledger={ledger} stale={ledgerStale} /> : null}
        {section === 'overview' || section === 'tasks' ? <section className={styles.tasksSection}><div className={styles.sectionHeading}><div><h2>核验任务 <span>{runs.length}</span></h2><p>{usageAvailable ? '进度来自执行器记录，保持你当前的浏览位置。' : '连接执行器后显示核验任务；目录浏览不受影响。'}</p></div>{section === 'overview' ? <button className={styles.textButton} type="button" onClick={() => setSection('tasks')}>全部任务<WorkbenchIcon name="arrow" size={16} /></button> : null}</div>{runs.length ? <div className={styles.tasksGrid}>{runs.map(run => <RunCard key={run.id} run={run} />)}</div> : <div className={styles.empty}><WorkbenchIcon name="check" size={32} /><h3>{snapshot.capabilities.startVerification ? '准备好开始第一次核验' : usageAvailable ? '尚无已同步核验任务' : '核验执行器尚未连接'}</h3><p>{snapshot.capabilities.startVerification ? '点击右上角“开始核验”，选择数据范围与执行模式。' : '点击右上角“核验连接说明”查看当前可用功能。'}</p></div>}</section> : null}
        {section === 'usage' ? <div className={styles.usageGrid}><article className={styles.panel}><div className={styles.panelHeading}><div><h2>用量总览</h2><p>{cumulativeUsage ? '累计调用回执 · 每次调用独立记账' : ledger ? '当前保存响应 · 仅供批次参考，累计用量见上方回执' : usageAvailable ? '当前保存响应 · 已记录用量下限' : '未连接执行器，暂时没有可读取的用量记录'}</p></div><WorkbenchIcon name="spark" /></div><strong className={styles.tokenTotal}>{tokenValue(usage.totalTokens)}<span>Tokens</span></strong>{savedUsageAvailable ? <div className={styles.tokenBar}><span style={{ width: `${inputPercent}%` }} /></div> : null}<dl className={styles.tokenDetails}>{[['输入 Token', usage.inputTokens], ['输出 Token', usage.outputTokens], ['缓存读取', usage.cacheReadTokens], ['缓存写入', usage.cacheWriteTokens], ['总 Token', usage.totalTokens], [cumulativeUsage ? '调用尝试' : '已保存响应', usage.requests]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === '调用尝试' && usageAvailable ? number(Number(value)) : tokenValue(Number(value))}</dd></div>)}</dl><p className={styles.telemetryMeta}>{telemetryLabel}{telemetry.stale ? ' · 记录待更新' : ''}<br />采集时间：{telemetry.observedAt ? date(telemetry.observedAt) : '未连接'}</p><p className={styles.smallMuted}>输入 Token 已包含缓存读取与写入，不重复相加。{cumulativeUsage ? '累计用量来自独立调用回执；历史恢复值与用量未知的尝试使统计成为已记录下限。' : '这里只统计当前仍保存的响应，属于用量下限；重跑可能覆盖记录。'}{snapshot.automation?.quota ? '套餐剩余比例见自动化执行；服务商账户累计账单和积分余额未接入。' : '服务商账户累计账单、套餐额度与剩余额度未接入。'}</p></article><article className={styles.panel}><h2>按核验批次</h2><p className={styles.smallMuted}>批次仅汇总当前保存的响应，是可核对的用量下限。</p>{usageAvailable && runs.length ? <div className={styles.usageRows}>{runs.map(run => <div key={run.id}><span><strong>{run.title}</strong><small>{run.model ?? '模型待确认'}</small></span><b>{run.tokenUsage.totalTokens > 0 ? number(run.tokenUsage.totalTokens) : '—'}<small>{number(run.tokenUsage.requests)} 次已保存响应</small></b></div>)}</div> : <p className={styles.usageEmpty}>{usageAvailable ? '尚无已保存的核验响应。' : '执行器未连接，用量未读取。'}</p>}<p className={styles.smallMuted}>实际模型：{usageAvailable ? snapshot.model.configured ?? '尚未记录' : '未连接'}<br />最近响应：{usageAvailable ? date(usage.lastResponseAt) : '未连接'}</p></article></div> : null}
        {section === 'catalog' ? <><div className={styles.catalogGrid}>{catalogEntries.map(([label, count, href]) => <article className={styles.metricCard} key={label}><div><span>{label}</span><WorkbenchIcon name="database" size={18} /></div><strong>{number(count)}</strong>{href ? <Link className={styles.catalogLink} href={href}>查看{label}<WorkbenchIcon name="arrow" size={16} /></Link> : <p>在相关详情页中查看</p>}</article>)}</div><article className={styles.panel}><h2>发布状态分布</h2><div className={styles.chartLegend}>{statusEntries.map(([label, count, color]) => <div key={label}><span><i style={{ background: color }} />{label}</span><strong>{number(count)}</strong></div>)}</div><p className={styles.smallMuted}>总记录数包含六类目录；发布状态来自目录本身。AI 支持的候选字段仍需审阅证据。</p></article></> : null}
        <footer className={styles.footer}><span><WorkbenchIcon name="shield" size={14} />{demo ? 'DESIGN PREVIEW · 示例数据' : '管理员专用 · 受保护的数据与操作'}</span><span>更新于 {date(snapshot.generatedAt)}</span></footer>
      </div>
    </div>
    {connectionInfo ? <VerificationConnectionInfo reason={snapshot.capabilities.reason} remote={telemetry.source === 'remote'} onClose={() => setConnectionInfo(false)} /> : null}
  </div>
}
