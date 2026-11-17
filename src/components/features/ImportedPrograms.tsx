import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import styles from './ImportedPrograms.module.css'

export function importedProgramText(locale: LaunchLocale) {
  return locale === 'zh' ? {
    title: '第三方项目目录',
    intro: '浏览第三方平台收录的来华留学项目，以及已采集的课程、费用和申请信息。',
    sourceNotice: '信息来自第三方平台，未经院校官网核验。日期和费用按来源表述，可能属于历史招生批次。',
    extracted: '已采集详情', allLinks: '全部来源链接', programs: '项目链接', schools: '条院校目录记录',
    search: '搜索项目或院校', searchPlaceholder: '例如：Chinese、Medicine、Peking',
    school: '院校', allSchools: '全部院校', provider: '来源平台', allProviders: '全部平台',
    apply: '筛选项目', reset: '重置筛选', results: '条结果',
    details: '查看已采集详情', source: '查看来源页面', sourceLabel: '第三方来源',
    linkOnly: '仅有链接', unknown: '来源未提供', intakeUnknown: '招生年份未知',
    linkNotice: '名称根据来源网址整理，尚未采集项目详情；招生年份、费用和申请要求未知。',
    empty: '当前筛选下没有已采集的项目', emptyIntro: '可调整筛选，或浏览来源链接以查找更多项目。',
    previous: '上一页', next: '下一页', pagination: '第三方目录分页', page: '页',
    back: '返回第三方项目目录', about: '项目简介', facts: '来源所列项目信息',
    degree: '学习层次', language: '授课语言', duration: '学习时长', startDate: '开课时间',
    deadline: '申请截止时间', tuition: '学费（按来源表述）', applicationFee: '申请费',
    providerServiceFee: '平台服务费', requirements: '申请要求', materials: '申请材料', fees: '其他费用说明',
    provenance: '信息来源', capturedAt: '采集时间', sourceUpdatedAt: '目录更新时间',
    noDetails: '当前筛选下没有项目链接', banner: '探索第三方项目目录',
    bannerIntro: '查看其他平台的项目详情与院校链接。',
  } : {
    title: 'Third-party program directory',
    intro: 'Explore programs listed by third-party platforms, with captured course, fee and application information where available.',
    sourceNotice: 'Third-party information has not been checked against university websites. Dates and fees follow the source and may belong to a historical intake.',
    extracted: 'Captured details', allLinks: 'All source links', programs: 'program links', schools: 'school entries',
    search: 'Search programs or schools', searchPlaceholder: 'Try Chinese, Medicine or Peking',
    school: 'School', allSchools: 'All schools', provider: 'Source platform', allProviders: 'All platforms',
    apply: 'Filter programs', reset: 'Reset filters', results: 'results',
    details: 'View captured details', source: 'View source page', sourceLabel: 'Third-party source',
    linkOnly: 'Link only', unknown: 'Not provided by source', intakeUnknown: 'Intake year unknown',
    linkNotice: 'Names are derived from source URLs. Program details, intake year, fees and entry requirements have not been captured.',
    empty: 'No captured programs match these filters', emptyIntro: 'Adjust the filters or browse source links to explore more programs.',
    previous: 'Previous', next: 'Next', pagination: 'Third-party directory pages', page: 'Page',
    back: 'Back to third-party programs', about: 'About this program', facts: 'Program information from the source',
    degree: 'Study level', language: 'Teaching language', duration: 'Duration', startDate: 'Start date',
    deadline: 'Application deadline', tuition: 'Tuition as stated by source', applicationFee: 'Application fee',
    providerServiceFee: 'Platform service fee', requirements: 'Entry requirements', materials: 'Application materials', fees: 'Additional fee information',
    provenance: 'Source information', capturedAt: 'Captured on', sourceUpdatedAt: 'Directory updated',
    noDetails: 'No program links match these filters', banner: 'Explore third-party programs',
    bannerIntro: 'Browse program details and school links from other platforms.',
  }
}

export type ImportedProgramFilters = {
  query?: string
  school?: string
  provider?: string
  view?: 'extracted' | 'links'
  page?: number
}

export function importedProgramsHref(locale: LaunchLocale, filters: ImportedProgramFilters = {}) {
  const params = new URLSearchParams()
  if (filters.query) params.set('query', filters.query)
  if (filters.school) params.set('school', filters.school)
  if (filters.provider) params.set('provider', filters.provider)
  if (filters.view === 'links') params.set('view', 'links')
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  const query = params.toString()
  return `/${locale}/programs/imported${query ? `?${query}` : ''}`
}

/** Preserve source wording, including any explicit unit or annual fee scope. */
export function sourceValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(sourceValue).filter(Boolean).join('\n')
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      const text = sourceValue(item)
      return text ? `${key}: ${text}` : ''
    }).filter(Boolean).join('\n')
  }
  return ''
}

export function publicSourceHref(value: string) {
  try {
    const parsed = new URL(value)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function ImportedProgramCard({ program, locale }: { program: ThirdPartyProgram; locale: LaunchLocale }) {
  const t = importedProgramText(locale)
  const extracted = program.status === 'extracted'
  const fields = program.fields
  const sourceHref = publicSourceHref(program.sourceUrl)
  const facts = [
    [t.degree, sourceValue(fields.degree)],
    [t.language, sourceValue(fields.language)],
    [t.duration, sourceValue(fields.duration)],
    [t.tuition, sourceValue(fields.tuition)],
  ].filter(([, value]) => value)

  return <article className={styles.card} data-testid="imported-program-card" data-status={program.status}>
    <div className={styles.cardMeta}>
      <span className={styles.provider}>{program.provider.toUpperCase()}</span>
      <span className={extracted ? styles.capturedBadge : styles.linkBadge}>{extracted ? t.extracted : t.linkOnly}</span>
    </div>
    <p className={styles.schoolName}>{program.schoolName}</p>
    <h2 className={styles.programName}>
      {extracted ? <Link prefetch={false} href={`/${locale}/programs/imported/${encodeURIComponent(program.id)}`}>{program.name}</Link> : program.name}
    </h2>
    {extracted && facts.length ? <dl className={styles.cardFacts}>
      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl> : null}
    {!extracted ? <p className={styles.linkDescription}>{t.intakeUnknown}</p> : null}
    <div className={styles.cardActions}>
      {extracted ? <Link prefetch={false} href={`/${locale}/programs/imported/${encodeURIComponent(program.id)}`} className={styles.textLink}>{t.details} <span aria-hidden="true">→</span></Link> : null}
      {sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>{t.source} <span aria-hidden="true">↗</span></a> : null}
    </div>
  </article>
}
