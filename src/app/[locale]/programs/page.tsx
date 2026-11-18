import Link from 'next/link'
import { isVisualMediaQuery } from '@/lib/visual-media'
import { notFound } from 'next/navigation'
import { ProgramExplorerV2 } from '@/components/features/ProgramExplorerV2'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { studentMatchCopy } from '@/i18n/student-match'
import { getTodayDate } from '@/lib/data/freshness'
import { queryUnifiedPrograms } from '@/lib/unified-programs'
import {
  parseProgramCatalogFilters,
  type ProgramCatalogSearchParams,
} from '@/lib/program-catalog'
import { hasSearchParameters, pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams?: Promise<ProgramCatalogSearchParams>
}) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  const parameterized = searchParams ? hasSearchParameters(await searchParams) : false
  return pageMetadata(locale, messages.programs.title, messages.programs.intro, 'programs', {
    indexable: !parameterized,
  })
}
export default async function ProgramsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<ProgramCatalogSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale)
  const today = getTodayDate()
  const filters = parseProgramCatalogFilters(await searchParams)
  const result = await queryUnifiedPrograms(filters, today)

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${result.total} ${messages.nav.programs}`}
      title={messages.programs.title}
      description={messages.programs.intro}
      actions={<Link className="text-link" href={`/${locale}/match`}>{studentMatchCopy(locale).title} →</Link>}
      meta={<><span>{messages.common.authoritativeNotice}</span></>}
    />
    <section className="atlas-container atlas-section">
      {isVisualMediaQuery(filters.query) ? <aside className="notice" data-testid="visual-media-collection-shortcut">
        <Link href={`/${locale}/visual-media`}>{locale === 'zh' ? 'Visual Media 硕士专题与英语优先申请简报' : 'Visual Media master’s collection and English-first applicant brief'} →</Link>
      </aside> : null}
      {result.total === 0 ? <div className="notice" data-testid="program-publication-note">{messages.programs.verificationNote}</div> : null}
      <ProgramExplorerV2 result={result} locale={locale} messages={messages} today={today} />
    </section>
  </>
}
