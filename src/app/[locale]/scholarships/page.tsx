import { notFound } from 'next/navigation'
import { ScholarshipExplorerV2 } from '@/components/features/ScholarshipExplorerV2'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getTodayDate } from '@/lib/data/freshness'
import { getCatalogRepository } from '@/lib/catalog'
import {
  parseScholarshipCatalogFilters,
  queryScholarshipCatalogRepository,
  type ScholarshipCatalogSearchParams,
} from '@/lib/scholarship-catalog'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.scholarships.title, m.scholarships.intro, 'scholarships') }
export default async function ScholarshipsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<ScholarshipCatalogSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale)
  const today = getTodayDate()
  const filters = parseScholarshipCatalogFilters(await searchParams)
  const result = await queryScholarshipCatalogRepository(getCatalogRepository(), filters, today)

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${result.total} ${messages.nav.scholarships}`}
      title={messages.scholarships.title}
      description={messages.scholarships.intro}
      meta={<><span>{messages.common.authoritativeNotice}</span></>}
    />
    <section className="atlas-container atlas-section">
      <div className="notice scholarship-notice">{messages.scholarships.catalogueNotice}</div>
      <ScholarshipExplorerV2 result={result} locale={locale} messages={messages} today={today} />
    </section>
  </>
}
