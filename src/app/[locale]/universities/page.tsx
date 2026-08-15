import { notFound } from 'next/navigation'
import { UniversityExplorerV2 } from '@/components/features/UniversityExplorerV2'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getCatalogRepository } from '@/lib/catalog'
import {
  parseUniversityCatalogFilters,
  queryUniversityCatalogRepository,
  type UniversityCatalogSearchParams,
} from '@/lib/university-catalog'
import { hasSearchParameters, pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams?: Promise<UniversityCatalogSearchParams>
}) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  const parameterized = searchParams ? hasSearchParameters(await searchParams) : false
  return pageMetadata(
    locale,
    messages.universities.title,
    messages.universities.intro,
    'universities',
    { indexable: !parameterized },
  )
}

export default async function UniversitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<UniversityCatalogSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale)
  const filters = parseUniversityCatalogFilters(await searchParams)
  const result = await queryUniversityCatalogRepository(getCatalogRepository(), filters)
  const coverageLabel = {
    zh: '查看非军校双一流高校数据表',
    en: 'View non-military Double First-Class coverage',
    ru: 'Охват невоенных вузов Double First-Class',
    de: 'Abdeckung ziviler Double-First-Class-Hochschulen',
    fr: 'Couverture des universités civiles Double First-Class',
    es: 'Cobertura de universidades civiles Double First-Class',
  }[locale]
  const totalLabel = `${result.total}${result.totalExact ? '' : '+'}`

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${totalLabel} ${messages.nav.universities}`}
      title={messages.universities.title}
      description={messages.universities.intro}
      actions={<a className="atlas-button atlas-button--primary atlas-button--medium" href={`/${locale}/double-first-class`}>{coverageLabel} →</a>}
      meta={<><span>{messages.common.authoritativeNotice}</span></>}
    />
    <section className="atlas-container atlas-section">
      <UniversityExplorerV2 result={result} locale={locale} messages={messages} />
    </section>
  </>
}
