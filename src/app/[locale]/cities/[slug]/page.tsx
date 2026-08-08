import { notFound } from 'next/navigation'

import { Badge, Card, LinkButton, PageHero, SectionHeading } from '@/components/ui'
import { UniversityCard } from '@/components/features/RecordCards'
import { indexedLocales, type PublicLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { selectCityPrebuildSlugs } from '@/lib/data/detail-prebuild'
import { formatDate, localize } from '@/lib/data/format'
import { regionLabels } from '@/lib/data/labels'
import { getCatalogData, getData } from '@/lib/data/load'
import type { Program, University } from '@/lib/data/types'
import { isIndexableCity } from '@/lib/seo/indexability'
import { pageMetadata, requireLocale } from '@/lib/site'

export const dynamicParams = true

export const CITY_DETAIL_UNIVERSITY_LIMIT = 36

function indexUniversityDisciplines(programs: Program[]): Map<string, Set<string>> {
  const disciplinesByUniversityId = new Map<string, Set<string>>()

  for (const program of programs) {
    const disciplines = disciplinesByUniversityId.get(program.universityId) ?? new Set<string>()
    disciplines.add(program.discipline)
    disciplinesByUniversityId.set(program.universityId, disciplines)
  }

  return disciplinesByUniversityId
}

function sortCityUniversities(universities: University[], locale: PublicLocale): University[] {
  return [...universities].sort((left, right) => {
    const featuredOrder = Number(right.featured) - Number(left.featured)
    if (featuredOrder !== 0) return featuredOrder

    const nameOrder = localize(left.name, locale).localeCompare(
      localize(right.name, locale),
      locale,
    )
    return nameOrder || left.slug.localeCompare(right.slug)
  })
}

export function generateStaticParams() {
  const slugs = selectCityPrebuildSlugs(getData())
  return indexedLocales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const data = await getCatalogData()
  const city = data.cities.find((item) => item.slug === slug)
  if (!city) return {}
  return pageMetadata(
    locale,
    localize(city.name, locale),
    localize(city.overview, locale),
    `cities/${slug}`,
    { indexable: isIndexableCity(city, data.universities) },
  )
}

export default async function CityDetail({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const data = await getCatalogData()
  const city = data.cities.find((item) => item.slug === slug)
  if (!city) notFound()

  const messages = getMessages(locale)
  const universities = sortCityUniversities(
    data.universities.filter((item) => item.cityId === city.id),
    locale,
  )
  const disciplinesByUniversityId = indexUniversityDisciplines(data.programs)
  const visibleUniversities = universities.slice(0, CITY_DETAIL_UNIVERSITY_LIMIT)
  const hasMoreUniversities = universities.length > visibleUniversities.length
  const universityDirectoryHref = `/${locale}/universities?city=${encodeURIComponent(city.slug)}`

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${city.region ? regionLabels(locale)[city.region] : messages.common.unknown} · ${localize(city.province, locale)}`}
      title={localize(city.name, locale)}
      description={localize(city.overview, locale)}
      meta={<>
        <span>{universities.length} {messages.nav.universities}</span>
        <span>{messages.common.lastVerified}: {formatDate(city.verifiedAt, locale, '—')}</span>
      </>}
    />
    <section className="atlas-container atlas-section detail-layout">
      <div className="detail-main">
        <div className="content-grid content-grid--two">
          <Card accent="jade">
            <Badge tone="jade">{messages.cities.climate}</Badge>
            <h2 className="atlas-card__title">{messages.cities.climate}</h2>
            <p>{localize(city.climate, locale)}</p>
          </Card>
          <Card>
            <Badge tone="gold">{messages.cities.food}</Badge>
            <h2 className="atlas-card__title">{messages.cities.food}</h2>
            <ul>{city.foodHighlights.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </Card>
        </div>
        <div className="prose-panel">
          <h2>{messages.cities.sights}</h2>
          <ul>{city.sights.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
        </div>
        <div>
          <SectionHeading
            title={messages.cities.universities}
            level={2}
            action={hasMoreUniversities
              ? <LinkButton href={universityDirectoryHref} variant="quiet">
                  {messages.common.explore} {messages.nav.universities} ({universities.length}) →
                </LinkButton>
              : undefined}
          />
          <div className="content-grid content-grid--two">
            {visibleUniversities.map((university) => <UniversityCard
              key={university.id}
              university={university}
              city={city}
              fields={[...(disciplinesByUniversityId.get(university.id) ?? [])]}
              locale={locale}
              messages={messages}
            />)}
          </div>
        </div>
      </div>
      <aside className="detail-aside">
        <Card>
          <h2 className="atlas-card__title">{messages.cities.contentTitle}</h2>
          <p className="atlas-card__description">{messages.cities.contentNotice}</p>
          <div className="notice">{messages.common.authoritativeNotice}</div>
        </Card>
      </aside>
    </section>
  </>
}
