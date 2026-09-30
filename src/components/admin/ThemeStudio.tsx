'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { RoundedSelect } from '@/components/ui/RoundedSelect'
import { siteThemes, themeVariables, type SiteTheme } from '@/lib/site-themes'
import type { AdminSnapshot, TokenUsage } from '@/lib/admin/types'
import { AdminDashboard } from './AdminDashboard'
import { WorkbenchIcon } from './WorkbenchIcon'
import styles from './ThemeStudio.module.css'

export type ThemeUniversity = { name: string; city: string; cityId: string; slug: string; programs: number }
type CatalogSummary = { universities: number; programs: number; scholarships: number; cities: number }
const sampleUsage: TokenUsage = { inputTokens: 846320, outputTokens: 148650, totalTokens: 994970, requests: 248, cacheReadTokens: 105000, cacheWriteTokens: 23000, lastInputTokens: 4250, lastOutputTokens: 630, lastResponseAt: '2026-09-30T09:00:00Z' }
const demoSnapshot: AdminSnapshot = {
  generatedAt: '2026-09-30T09:00:00Z',
  catalog: { counts: { universities: 266, programs: 1480, admissionCycles: 864, scholarships: 188, cities: 76, sources: 924 }, statuses: { verified: 2486, needsReview: 534, stale: 146, draft: 242, archived: 0 }, overdueRecords: 146, totalRecords: 3798, officialSources: 876 },
  runs: [
    { id: 'demo-full', title: '全量目录核验', status: 'running', alive: true, model: 'MiniMax-M3', thinking: 'adaptive', effort: null, selectedRecords: 1840, completedRecords: 1298, startedAt: '2026-09-30T07:20:00Z', updatedAt: '2026-09-30T09:00:00Z', summary: { supportedCandidateFields: 3826, contradictedCandidateFields: 18, unconfirmedFields: 246, modelErrorRecords: 0 }, summaryAt: '2026-09-30T09:00:00Z', fatal: null, tokenUsage: { ...sampleUsage, inputTokens: 635000, outputTokens: 107380, totalTokens: 742380, requests: 186, cacheReadTokens: 80000, cacheWriteTokens: 18000 } },
    { id: 'demo-new', title: '最新高校补充核验', status: 'completed', alive: false, model: 'MiniMax-M3.1-Flash-Preview', thinking: 'adaptive', effort: 'max', selectedRecords: 286, completedRecords: 286, startedAt: '2026-09-30T07:30:00Z', updatedAt: '2026-09-30T08:50:00Z', summary: { supportedCandidateFields: 846, contradictedCandidateFields: 4, unconfirmedFields: 37, modelErrorRecords: 0 }, summaryAt: '2026-09-30T08:50:00Z', fatal: null, tokenUsage: { ...sampleUsage, inputTokens: 211320, outputTokens: 41270, totalTokens: 252590, requests: 62, cacheReadTokens: 25000, cacheWriteTokens: 5000 } },
  ],
  capabilities: { localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: null }, model: { configured: 'MiniMax-M3' }, usage: { ...sampleUsage, budgetTokens: null },
}
function CampusIllustration({ index }: { index: number }) {
  return <svg viewBox="0 0 320 135" fill="none" aria-hidden="true"><circle cx={index === 1 ? 252 : 63} cy="32" r="20" fill="var(--wb-secondary)" opacity=".7" /><path d="M12 118h296" stroke="currentColor" opacity=".2" /><path d="M50 116V64h58v52M114 116V49h93v67M213 116V64h58v52" fill="var(--wb-surface)" stroke="currentColor" strokeWidth="1.5" opacity=".75" /><path d={index === 1 ? 'm104 49 57-26 57 26H104 M39 64l40-20 40 20H39 M203 64l40-20 40 20H203' : 'M105 43h112v7H105 M43 58h72v7H43 M206 58h72v7H206'} fill="var(--wb-accent)" opacity=".6" /><path d="M145 116V83a16 16 0 0 1 32 0v33 M65 79h11v12H65 M86 79h11v12H86 M229 79h11v12h-11 M250 79h11v12h-11 M129 63h9v10h-9 M185 63h9v10h-9" stroke="currentColor" opacity=".45" /><path d="M28 116V91 M28 101c-19-3-17-29 0-31 16 1 18 27 0 31 M295 116V91 M295 101c-19-3-17-29 0-31 16 1 18 27 0 31" stroke="var(--wb-accent)" opacity=".4" /></svg>
}
function StudentPreview({ theme, universities, counts }: { theme: SiteTheme; universities: ThemeUniversity[]; counts: CatalogSummary }) {
  const [city, setCity] = useState('')
  const [rank, setRank] = useState('')
  const cities = [...new Map(universities.map(item => [item.cityId, item.city])).entries()]
  const visible = city ? universities.filter(item => item.cityId === city) : universities
  return <div className={styles.studentPreview} data-display={theme.display}>
    <header className={styles.siteHeader}><Link href="/zh" className={styles.siteBrand}><span>中</span>Study in China <small>ATLAS</small></Link><nav aria-label="学生网站示意导航"><Link href="/zh/universities">发现大学</Link><Link href="/zh/programs">探索专业</Link><Link href="/zh/scholarships">奖学金</Link><Link href="/zh/cities">城市指南</Link></nav><Link href="/zh/favorites" className={styles.savedLink}>☆ 我的清单</Link></header>
    <section className={styles.siteHero}><div><div className={styles.heroBadge}><span />YOUR NEXT CHAPTER STARTS HERE</div><h2>你的下一站，<br />从中国开始<span>。</span></h2><p>发现适合你的大学、专业与城市。<br />以可靠的信息，开启属于你的留学旅程。</p><Link href="/zh/universities" className={styles.siteAction}>探索中国大学<WorkbenchIcon name="arrow" size={18} /></Link><div className={styles.heroProof}><span className={styles.proofAvatars}><i>学</i><i>研</i><i>中</i></span><p><b>{counts.universities} 所大学</b>，每一份信息都可以追溯来源。</p></div></div><div className={styles.heroArt} aria-hidden="true"><div className={styles.artCircle} /><div className={styles.artMap}><svg viewBox="0 0 320 275" fill="none"><path d="m38 112 28-38 47 10 26-21 28 15 26-25 9-35 29 4 8 29 38 8 11 19-39 30-3 39-21 13-16 36-43 17-29-23-42 7-26-17-25-10-6-28z" fill="var(--wb-accent)" opacity=".14" /><path d="m75 103 106 30 47-54 M181 133l27 60 M181 133l-65 42" stroke="var(--wb-accent)" strokeDasharray="3 5" opacity=".6" /><circle cx="181" cy="133" r="7" fill="var(--wb-accent)" /><circle cx="228" cy="79" r="5" fill="var(--wb-accent)" /><circle cx="208" cy="193" r="5" fill="var(--wb-accent)" /><circle cx="116" cy="175" r="5" fill="var(--wb-accent)" /><circle cx="75" cy="103" r="5" fill="var(--wb-accent)" /></svg></div><div className={styles.artCaption}>A WORLD OF POSSIBILITIES</div><div className={`${styles.floatingCard} ${styles.floatTop}`}><span><WorkbenchIcon name="shield" size={18} /></span><div><b>有据可查，放心探索</b><small>官方来源 · 数据可追溯</small></div></div><div className={`${styles.floatingCard} ${styles.floatBottom}`}><span><WorkbenchIcon name="globe" size={18} /></span><div><b>{counts.cities} 个城市，更多可能</b><small>找到你的下一段生活</small></div></div></div></section>
    <div className={styles.siteStats}>{[['所大学', counts.universities], ['个专业', counts.programs], ['项奖学金', counts.scholarships], ['个留学城市', counts.cities]].map(([label, count]) => <div key={label}><strong>{count.toLocaleString('zh-CN')}</strong><span>{label}</span></div>)}</div>
    <section className={styles.discovery}><div className={styles.discoveryHeading}><div><span>FIND YOUR PLACE</span><h3>一所大学，一种可能。</h3></div><Link href="/zh/universities">全部大学 <WorkbenchIcon name="arrow" size={16} /></Link></div><div className={styles.previewFilters}><div><label htmlFor="theme-city">探索城市</label><RoundedSelect id="theme-city" value={city} onChange={event => setCity(event.target.value)}><option value="">全部城市</option>{cities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</RoundedSelect></div><div><label htmlFor="theme-ranking">软科世界大学排名</label><RoundedSelect id="theme-ranking" value={rank} onChange={event => setRank(event.target.value)}><option value="">全部排名</option><option value="100">Top 100</option><option value="200">Top 200</option><option value="500">Top 500</option><option value="ranked">已核实排名</option></RoundedSelect></div><Link href={`/zh/universities?${new URLSearchParams({ ...(city ? { city } : {}), ...(rank ? { arwuRankMax: rank } : {}) })}`} className={styles.filterAction}>去目录筛选<WorkbenchIcon name="arrow" size={16} /></Link></div><div className={styles.universityGrid}>{visible.map((item, index) => <Link href={`/zh/universities/${item.slug}`} key={item.slug} className={styles.universityCard}><div className={styles.campusArt}><CampusIllustration index={index} /><span>{item.city}</span></div><div className={styles.universityContent}><small>UNIVERSITY EXPLORER</small><h4>{item.name}</h4><p>{item.programs} 个已发布专业<WorkbenchIcon name="arrow" size={16} /></p></div></Link>)}</div><p className={styles.previewFootnote}>校园插画用于视觉示意。院校与数量取自当前公开目录，完整筛选请进入大学目录。</p></section>
  </div>
}
export function ThemeStudio({ universities, counts }: { universities: ThemeUniversity[]; counts: CatalogSummary }) {
  const [theme, setTheme] = useState<SiteTheme>(siteThemes[0])
  const [view, setView] = useState<'student' | 'admin'>('student')
  const [saved, setSaved] = useState('')
  const variables = { ...themeVariables(theme), '--atlas-paper-bright': theme.surface, '--atlas-ink': theme.ink, '--atlas-line': theme.border, '--atlas-jade': theme.accent, '--atlas-jade-pale': theme.soft } as CSSProperties
  function remember() {
    document.documentElement.dataset.theme = theme.id
    try { localStorage.setItem('studycn-theme', theme.id); setSaved(`已使用「${theme.name}」，你的浏览器会记住这个选择。`) }
    catch { setSaved(`已使用「${theme.name}」，本次访问有效。`) }
    window.dispatchEvent(new Event('studycn-theme-changed'))
  }
  return <main className={styles.studio}>
    <header className={styles.studioHeader}><Link href="/zh" className={styles.studioBrand}><span>中</span>ATLAS <small>DESIGN STUDIO</small></Link><Link href="/admin">管理员工作台 <WorkbenchIcon name="arrow" size={16} /></Link></header>
    <section className={styles.studioIntro}><div><p>LET&apos;S FIND YOUR LOOK</p><h1>五种气质，同样用心。</h1><span>每位访客都能切换主题，网站会记住你的选择。</span></div><div className={styles.viewToggle} role="group" aria-label="预览界面"><button type="button" aria-pressed={view === 'student'} onClick={() => setView('student')}><WorkbenchIcon name="globe" size={16} />学生网站</button><button type="button" aria-pressed={view === 'admin'} onClick={() => setView('admin')}><WorkbenchIcon name="grid" size={16} />管理员工作台</button></div></section>
    <div className={styles.themeOptions} role="group" aria-label="网站主题">{siteThemes.map((item, index) => <button type="button" key={item.id} aria-pressed={theme.id === item.id} onClick={() => { setTheme(item); setSaved('') }} style={{ '--choice-accent': item.accent } as CSSProperties}><div className={styles.choiceTop}><span>0{index + 1}</span>{index === 0 ? <small>推荐</small> : null}<WorkbenchIcon name={theme.id === item.id ? 'check' : 'palette'} size={15} /></div><div className={styles.swatches}>{[item.background, item.surface, item.accent, item.secondary, item.ink].map((color, i) => <i key={i} style={{ background: color }} />)}</div><strong>{item.name}</strong><span className={styles.themeEnglish}>{item.english}</span></button>)}</div>
    <div className={styles.selectedTheme}><div><strong>{theme.name}</strong><p>{theme.description}</p></div><button type="button" onClick={remember}>使用这个主题<WorkbenchIcon name="check" size={16} /></button></div>{saved ? <p role="status" className={styles.savedNotice}>{saved}</p> : null}
    <div className={styles.previewFrame} style={variables} data-theme={theme.id}><div className={styles.frameToolbar}><span className={styles.frameDots}><i /><i /><i /></span><span>studyinchina.atlas / {view === 'student' ? 'discover' : 'workspace'} · {theme.english}</span><span>{view === 'student' ? '公开目录 · 视觉预览' : '示例任务 · 视觉预览'}</span></div>{view === 'student' ? <StudentPreview theme={theme} universities={universities} counts={counts} /> : <AdminDashboard snapshot={demoSnapshot} connection="demo" demo theme={theme} />}</div>
    <footer className={styles.studioFooter}><span>圆润的菜单 · 连贯的反馈 · 清晰的信息层级</span><span>设计方案预览 / 2026</span></footer>
  </main>
}
