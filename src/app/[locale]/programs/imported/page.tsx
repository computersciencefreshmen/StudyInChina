import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHero } from '@/components/ui'
import {
  ImportedProgramCard,
  importedProgramsHref,
  importedProgramText,
} from '@/components/features/ImportedPrograms'
import styles from '@/components/features/ImportedPrograms.module.css'
import { getThirdPartySummary, queryThirdPartyPrograms } from '@/lib/third-party-programs'
import { hasSearchParameters, pageMetadata, requireLocale, type PageSearchParams } from '@/lib/site'

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || '' : value || ''

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const locale = requireLocale((await params).locale) || 'en'
  const t = importedProgramText(locale)
  return pageMetadata(locale, t.title, t.intro, 'programs/imported', {
    indexable: !hasSearchParameters(await searchParams),
  })
}

export default async function ImportedProgramsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<PageSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const raw = await searchParams
  const query = first(raw.query).trim().slice(0, 200)
  const school = first(raw.school).slice(0, 150)
  const provider = first(raw.provider).slice(0, 40).toLowerCase()
  const view = first(raw.view) === 'links' ? 'links' as const : 'extracted' as const
  const parsedPage = Number(first(raw.page))
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const filters = { query, school, provider, view, page }
  const [summary, result] = await Promise.all([
    getThirdPartySummary(),
    queryThirdPartyPrograms(filters),
  ])
  const t = importedProgramText(locale)
  const nf = new Intl.NumberFormat(locale)
  // The data layer paginates on the server; this is a final rendering bound.
  const items = result.items.slice(0, 40)

  return <>
    <PageHero variant="compact" eyebrow={t.sourceLabel} title={t.title} description={t.intro}
      meta={<div className={styles.summary}>
        <span><strong>{nf.format(summary.extractedCount)}</strong> {t.extracted}</span>
        <span><strong>{nf.format(summary.programCount)}</strong> {t.programs}</span>
        <span><strong>{nf.format(summary.schoolCount)}</strong> {t.schools}</span>
      </div>}
    />
    <section className={`atlas-container atlas-section ${styles.workspace}`}>
      <p className={styles.notice}>{t.sourceNotice}</p>
      <nav className={styles.tabs} aria-label={locale === 'zh' ? '项目内容类型' : 'Program content type'}>
        <Link prefetch={false} className={`${styles.tab} ${view === 'extracted' ? styles.tabActive : ''}`}
          aria-current={view === 'extracted' ? 'page' : undefined}
          href={importedProgramsHref(locale, { ...filters, view: 'extracted', page: 1 })}>
          {t.extracted}<span className={styles.tabCount}>{nf.format(summary.extractedCount)}</span>
        </Link>
        <Link prefetch={false} className={`${styles.tab} ${view === 'links' ? styles.tabActive : ''}`}
          aria-current={view === 'links' ? 'page' : undefined}
          href={importedProgramsHref(locale, { ...filters, view: 'links', page: 1 })}>
          {t.allLinks}<span className={styles.tabCount}>{nf.format(summary.programCount)}</span>
        </Link>
      </nav>
      <form action={`/${locale}/programs/imported`} method="get" className={styles.filters} role="search">
        {view === 'links' ? <input type="hidden" name="view" value="links" /> : null}
        <label className={styles.field}>
          <span>{t.search}</span>
          <input type="search" name="query" defaultValue={query} placeholder={t.searchPlaceholder} maxLength={200} />
        </label>
        <label className={styles.field}>
          <span>{t.school}</span>
          <select name="school" defaultValue={school}>
            <option value="">{t.allSchools}</option>
            {result.schools.map(option => <option key={option.id} value={option.id}>
              {option.name} ({nf.format(view === 'extracted' ? option.extractedCount : option.programCount)})
            </option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t.provider}</span>
          <select name="provider" defaultValue={provider}>
            <option value="">{t.allProviders}</option>
            <option value="sicas">SICAS</option>
            <option value="cucas">CUCAS</option>
          </select>
        </label>
        <div className={styles.filterActions}>
          <button type="submit" className={styles.submit}>{t.apply}</button>
          <Link href={importedProgramsHref(locale, { view })} className={styles.reset}>{t.reset}</Link>
        </div>
      </form>
      {view === 'links' ? <p className={styles.notice}>{t.linkNotice}</p> : null}
      <div className={styles.resultsBar}>
        <p className={styles.resultCount} role="status">{nf.format(result.total)} {t.results}</p>
        {result.totalPages > 0 ? <p className={styles.resultCount}>{t.page} {nf.format(result.page)} / {nf.format(result.totalPages)}</p> : null}
      </div>
      {items.length ? <div className={styles.cards}>
        {items.map(program => <ImportedProgramCard key={program.id} program={program} locale={locale} />)}
      </div> : <div className={styles.empty}>
        <h2>{view === 'extracted' ? t.empty : t.noDetails}</h2>
        <p>{t.emptyIntro}</p>
        <Link prefetch={false} className={styles.textLink} href={importedProgramsHref(locale, { view: 'links' })}>{t.allLinks} →</Link>
      </div>}
      {result.totalPages > 1 ? <nav className={styles.pagination} aria-label={t.pagination}>
        {result.page > 1 ? <Link prefetch={false} rel="prev" href={importedProgramsHref(locale, { ...filters, page: result.page - 1 })}>← {t.previous}</Link> : null}
        <span aria-current="page">{t.page} {nf.format(result.page)} / {nf.format(result.totalPages)}</span>
        {result.page < result.totalPages ? <Link prefetch={false} rel="next" href={importedProgramsHref(locale, { ...filters, page: result.page + 1 })}>{t.next} →</Link> : null}
      </nav> : null}
    </section>
  </>
}
