import { notFound } from 'next/navigation'
import { CityExplorer } from '@/components/features/CityExplorer'
import { PageHero, SectionHeading } from '@/components/ui'
import { formatStudentCityTitle } from '@/i18n/home-experience'
import { getMessages } from '@/i18n/messages'
import {
  parseCityExplorerSearchParams,
  type CityExplorerSearchParams,
} from '@/lib/city-explorer'
import { getCatalogData, getData } from '@/lib/data/load'
import { hasSearchParameters, pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams?: Promise<CityExplorerSearchParams>
}) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  const parameterized = searchParams ? hasSearchParameters(await searchParams) : false
  return pageMetadata(locale, messages.cities.title, messages.cities.intro, 'cities', {
    indexable: !parameterized,
  })
}
export default async function CitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<CityExplorerSearchParams>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()

  const messages = getMessages(locale)
  const explorerState = parseCityExplorerSearchParams(await searchParams)
  const catalogData = await getCatalogData()
  const stableDirectory = getData()

  // City orientation content changes slowly and remains useful even when a
  // program release only includes the cities required by its current cohort.
  const citiesById = new Map(stableDirectory.cities.map((city) => [city.id, city]))
  for (const city of catalogData.cities) citiesById.set(city.id, city)
  const cities = [...citiesById.values()]

  // Only serialize fields used by the interactive explorer. City editorial
  // content remains on detail routes instead of inflating every list request.
  const explorerCities = cities.map(({ id, slug, name, province, region, coordinates }) => ({
    id, slug, name, province, region, coordinates,
  }))

  const universitiesById = new Map(stableDirectory.universities.map((university) => [university.id, university]))
  for (const university of catalogData.universities) universitiesById.set(university.id, university)
  const universities = [...universitiesById.values()]
  const universityCounts: Record<string, number> = Object.fromEntries(cities.map((city) => [city.id, 0]))
  for (const university of universities) {
    universityCounts[university.cityId] = (universityCounts[university.cityId] ?? 0) + 1
  }

  return <>
    <PageHero
      variant="compact"
      eyebrow={`${cities.length} ${messages.nav.cities}`}
      title={messages.cities.title}
      description={messages.cities.intro}
    />
    <section className="atlas-container atlas-section">
      <SectionHeading title={formatStudentCityTitle(cities.length, locale)} description={messages.cities.mapNote} />
      <CityExplorer
        cities={explorerCities}
        initialState={explorerState}
        locale={locale}
        universityCounts={universityCounts}
      />
      <p className="map-source-link">
        <a className="text-link" href="https://bzdt.tianditu.gov.cn/" target="_blank" rel="noreferrer">
          {messages.cities.officialMapService} ↗
        </a>
      </p>
    </section>
  </>
}
