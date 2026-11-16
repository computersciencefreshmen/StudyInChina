import Link from 'next/link'
import { PageHero } from '@/components/ui'
import {
  filterVisualMediaPrograms,
  visualMediaText,
  type VisualMediaCategory,
  type VisualMediaCollection as Collection,
  type VisualMediaFilters,
} from '@/lib/visual-media'
import styles from './VisualMediaCollection.module.css'

const categories: Array<[VisualMediaCategory, string, string]> = [
  ['visual-communication', 'Visual communication', '视觉传达'],
  ['digital-media', 'Digital media', '数字媒体'],
  ['film-animation', 'Film & animation', '电影与动画'],
  ['new-media', 'New & interactive media', '新媒体与交互'],
  ['adjacent', 'Related design & communication', '相关设计与传播'],
]

const regions = [
  ['mainland', 'Mainland China', '中国内地'],
  ['hong-kong', 'Hong Kong', '中国香港'],
  ['macao', 'Macao', '中国澳门'],
] as const

export function VisualMediaCollection({ collection, filters, locale }: {
  collection: Collection
  filters: VisualMediaFilters
  locale: string
}) {
  const zh = locale === 'zh'
  const text = (en: string, cn: string) => zh ? cn : en
  const localize = (value: { en: string; zh?: string }) => visualMediaText(value, locale)
  const programs = filterVisualMediaPrograms(collection, filters)
  const confirmed = filterVisualMediaPrograms(collection, { query: '', region: '', language: '', category: '' })
  const categoryLabel = (value: string) => {
    const option = categories.find(([key]) => key === value)
    return option ? option[zh ? 2 : 1] : value
  }
  const regionLabel = (value: string) => {
    const option = regions.find(([key]) => key === value)
    return option ? option[zh ? 2 : 1] : value
  }

  return <>
    <PageHero
      variant="compact"
      eyebrow={text('FIELD NOTES / MASTER’S IN CHINA', '选校专题 / 中国硕士')}
      title={text('Visual Media', 'Visual Media 视觉媒体')}
      description={localize(collection.scope)}
      meta={<><span>{text('Official sources reviewed', '官方来源查阅于')} {collection.checkedOn}</span><span>{text(`${confirmed.length} international master’s routes`, `${confirmed.length} 个国际学生硕士路径`)}</span></>}
    />
    <section className={`atlas-container atlas-section ${styles.collection}`}>
      {locale !== 'zh' && locale !== 'en' ? <p className={styles.translation} lang={locale === 'ru' ? 'ru' : 'en'}>
        {locale === 'ru' ? 'Материалы этой подборки доступны на английском языке; перевод на русский пока не подготовлен.' : 'This collection is available in English; a translation into your selected language is pending.'}
      </p> : null}
      <div className={styles.notice}>
        <strong>{text('A confirmed study route. Check the application window.', '确认的是国际硕士路径，申请窗口须另行核实。')}</strong>
        <p>{text('An international master’s route is supported by the linked official sources. This does not mean applications are currently open. Unknown fees, deadlines and requirements remain explicitly unconfirmed; a past intake is never presented as a new one.', '下列项目的国际硕士路径有官方来源支持，不代表目前正在开放申请。未核实的学费、截止日期和要求会明确标注；往年招生信息不作为新一轮招生承诺。')}</p>
      </div>
      <form method="get" action={`/${locale}/visual-media`} className={styles.filters} aria-label={text('Filter visual media master’s programs', '筛选视觉媒体硕士项目')}>
        <label className={styles.search}>{text('Search programs or universities', '搜索项目或学校')}
          <input name="q" defaultValue={filters.query} type="search" maxLength={160} placeholder={text('e.g. animation, visual communication, university', '例如：动画、视觉传达、学校名称')} />
        </label>
        <label>{text('Region', '地区')}
          <select name="region" defaultValue={filters.region}>
            <option value="">{text('All regions', '全部地区')}</option>
            {regions.map(([value, en, cn]) => <option key={value} value={value}>{text(en, cn)}</option>)}
          </select>
        </label>
        <label>{text('Teaching language', '授课语言')}
          <select name="language" defaultValue={filters.language}>
            <option value="">{text('All / including unconfirmed', '全部 / 包含未确认')}</option>
            <option value="English">{text('English', '英语')}</option>
            <option value="Chinese">{text('Chinese', '中文')}</option>
            <option value="Bilingual">{text('Bilingual / mixed language', '双语 / 中英混合')}</option>
          </select>
        </label>
        <label>{text('Subject', '方向')}
          <select name="category" defaultValue={filters.category}>
            <option value="">{text('All subjects', '全部方向')}</option>
            {categories.map(([value, en, cn]) => <option key={value} value={value}>{text(en, cn)}</option>)}
          </select>
        </label>
        <div className={styles.actions}><button type="submit">{text('Find programs', '查找项目')}</button><Link href={`/${locale}/visual-media`}>{text('Reset', '重置')}</Link></div>
      </form>
      <div className={styles.resultsHeading}>
        <h2>{text('Your study routes', '硕士项目清单')}</h2>
        <p aria-live="polite">{text(`${programs.length} of ${confirmed.length} programs`, `${programs.length} / ${confirmed.length} 个项目`)}</p>
      </div>
      {programs.length === 0 ? <p className={styles.empty}>{text('No confirmed routes match these filters. Try another subject or include all teaching languages.', '目前没有符合筛选条件的已确认路径，请尝试其他方向或选择全部授课语言。')}</p> : null}
      <div className={styles.programs}>
        {programs.map((program, index) => <article key={program.id} className={styles.program} id={program.id}>
          <div className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
          <div className={styles.body}>
            <div className={styles.tags}><span>{categoryLabel(program.category)}</span><span>{regionLabel(program.region || 'mainland')} · {localize(program.city)}</span>{program.fit === 'adjacent' ? <span>{text('Related option', '相关方向')}</span> : null}</div>
            <p className={styles.university}>{localize(program.university)}</p>
            <h3>{localize(program.name)}</h3>
            <dl className={styles.facts}>
              <div><dt>{text('Teaching language', '授课语言')}</dt><dd>{localize(program.language)}</dd></div>
              <div><dt>{text('Duration', '学制')}</dt><dd>{localize(program.duration)}</dd></div>
              <div><dt>{text('Tuition', '学费')}</dt><dd>{localize(program.tuition)}</dd></div>
              <div><dt>{text('Intake / source year', '入学与来源年度')}</dt><dd>{localize(program.cycle)}</dd></div>
              <div><dt>{text('Applications', '申请时间与入口')}</dt><dd>{localize(program.application)}</dd></div>
              <div><dt>{text('Portfolio', '作品集')}</dt><dd>{localize(program.portfolio)}</dd></div>
              <div className={styles.wide}><dt>{text('International applicants', '国际申请资格')}</dt><dd>{localize(program.internationalEligibility)}</dd></div>
            </dl>
            {program.notes.en ? <p className={styles.notes}>{localize(program.notes)}</p> : null}
            <div className={styles.sources}><strong>{text('Official evidence', '官方证据')}</strong>{program.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} <span aria-hidden="true">↗</span></a>)}</div>
          </div>
        </article>)}
      </div>
      <div className={styles.nextStep}>
        <p><a href="/briefs/visual-media-english-first-2027.html">{text('English-first applicant brief · HTML', '英语优先申请简报 · HTML')}</a>{' · '}<a href="/briefs/visual-media-english-first-2027.pdf">PDF</a></p>
        <strong>{text('Next: check the fit, then prepare a portfolio.', '下一步：确认方向匹配，再准备作品集。')}</strong>
        <p>{text('Visual communication, digital media and film are different training paths. Compare course content and portfolio format before choosing a degree. Confirm the next intake, language evidence and international eligibility with the university.', '视觉传达、数字媒体和电影是不同的培养路径。选项目前先比较课程内容与作品集形式，再向学校核实下一轮入学时间、语言证明及国际学生资格。')}</p>
        <Link href={`/${locale}/programs?degree=master`}>{text('Browse the main master’s catalogue', '浏览主目录硕士项目')} →</Link>
      </div>
    </section>
  </>
}
