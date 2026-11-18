import { notFound } from 'next/navigation'
import { PageHero } from '@/components/ui'
import { StudentMatch } from '@/components/features/StudentMatch'
import { getCatalogData } from '@/lib/data/load'
import { getTodayDate } from '@/lib/data/freshness'
import { requireLocale } from '@/lib/site'
import { studentMatchCopy } from '@/i18n/student-match'
import { studentMatchCatalog } from '@/lib/student-matching-data'

export const dynamic = 'force-dynamic'
export default async function MatchPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const today = getTodayDate(), copy = studentMatchCopy(locale)
  const rows = studentMatchCatalog(await getCatalogData(), locale, today)
  return <><PageHero variant="compact" title={copy.title} description={copy.note} />
    <section className="atlas-container atlas-section"><StudentMatch locale={locale} rows={rows} evaluatedOn={today} /></section></>
}
