import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero, SectionHeading } from '@/components/ui'
import { CityConstellation } from '@/components/features/CityConstellation'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { regionLabels } from '@/lib/data/labels'
import { getCatalogData, getData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.cities.title, m.cities.intro, 'cities') }
export default async function CitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()

  const messages = getMessages(locale)
  const catalogData = await getCatalogData()
  const stableDirectory = getData()

  // City orientation content changes slowly and remains useful even when a
  // program release only includes the cities required by its current cohort.
  const citiesById = new Map(stableDirectory.cities.map((city) => [city.id, city]))
  for (const city of catalogData.cities) citiesById.set(city.id, city)
  const cities = [...citiesById.values()]

  const universitiesById = new Map(stableDirectory.universities.map((university) => [university.id, university]))
  for (const university of catalogData.universities) universitiesById.set(university.id, university)
  const universities = [...universitiesById.values()]
  const universityCounts = Object.fromEntries(cities.map((city) => [
    city.id,
    universities.filter((university) => university.cityId === city.id).length,
  ]))

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${cities.length} ${messages.nav.cities}`}
      title={messages.cities.title}
      description={messages.cities.intro}
    />
    <section className="atlas-container atlas-section">
      <SectionHeading title={messages.home.cityTitle} description={messages.cities.mapNote} />
      <CityConstellation cities={cities} locale={locale} universityCounts={universityCounts} />
      <p className="map-source-link">
        <a className="text-link" href="https://bzdt.tianditu.gov.cn/" target="_blank" rel="noreferrer">
          {messages.cities.officialMapService} ↗
        </a>
      </p>
    </section>
    <section className="atlas-container atlas-section section-block--tight">
      <div className="content-grid">
        {cities.map((city) => <Card key={city.id} className="record-card">
          <div className="record-card__top">
            <Badge tone="jade">{city.region ? regionLabels(locale)[city.region] : messages.common.unknown}</Badge>
            <span>{universityCounts[city.id]} {messages.nav.universities}</span>
          </div>
          <h2 className="record-card__title">{localize(city.name, locale)}</h2>
          <p className="record-card__summary">{localize(city.overview, locale)}</p>
          <div className="atlas-card__footer">
            <LinkButton href={`/${locale}/cities/${city.slug}`} variant="quiet">
              {messages.common.viewDetails} →
            </LinkButton>
          </div>
        </Card>)}
      </div>
    </section>
  </>
}
