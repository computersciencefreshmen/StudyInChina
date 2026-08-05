import { notFound } from 'next/navigation'
import { ProgramExplorerV2 } from '@/components/features/ProgramExplorerV2'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getTodayDate } from '@/lib/data/freshness'
import { getCatalogRepository } from '@/lib/catalog'
import {
  parseProgramCatalogFilters,
  queryProgramCatalogRepository,
  type ProgramCatalogSearchParams,
} from '@/lib/program-catalog'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.programs.title, m.programs.intro, 'programs') }
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
  const result = await queryProgramCatalogRepository(getCatalogRepository(), filters, today)

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${result.total} ${messages.nav.programs}`}
      title={messages.programs.title}
      description={messages.programs.intro}
      meta={<><span>{messages.common.authoritativeNotice}</span></>}
    />
    <section className="atlas-container atlas-section">
      {result.total === 0 ? <div className="notice" data-testid="program-publication-note">{messages.programs.verificationNote}</div> : null}
      <ProgramExplorerV2 result={result} locale={locale} messages={messages} today={today} />
    </section>
  </>
}
