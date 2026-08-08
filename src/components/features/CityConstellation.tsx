import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import type { City } from '@/lib/data/types'

export type CityPlotItem = Pick<City, 'id' | 'slug' | 'name' | 'coordinates'>

const CHINA_COORDINATE_EXTENT = {
  minLat: 18,
  maxLat: 54,
  minLng: 73,
  maxLng: 135,
} as const

function hasUsableCoordinates(
  city: CityPlotItem,
): city is CityPlotItem & { coordinates: { lat: number; lng: number } } {
  const { coordinates } = city
  return coordinates !== null
    && Number.isFinite(coordinates.lat)
    && Number.isFinite(coordinates.lng)
    && coordinates.lat >= CHINA_COORDINATE_EXTENT.minLat
    && coordinates.lat <= CHINA_COORDINATE_EXTENT.maxLat
    && coordinates.lng >= CHINA_COORDINATE_EXTENT.minLng
    && coordinates.lng <= CHINA_COORDINATE_EXTENT.maxLng
}

export function CityConstellation({
  cities,
  locale,
  universityCounts = {},
}: {
  cities: CityPlotItem[]
  locale: LaunchLocale
  universityCounts?: Readonly<Record<string, number>>
}) {
  const messages = getMessages(locale)
  const locatedCities = cities.filter(hasUsableCoordinates)
  const note = messages.cities.mapNote

  return <div>
    <div className="city-map" aria-label={note}>
      <span className="city-map__compass" aria-hidden="true">N ↑</span>
      <span className="city-map__location-count">{locatedCities.length} {messages.nav.cities}</span>
      {locatedCities.length === 0 && <p className="city-map__empty">{note}</p>}
      {locatedCities.map((city) => {
        const left = 6 + ((city.coordinates.lng - CHINA_COORDINATE_EXTENT.minLng)
          / (CHINA_COORDINATE_EXTENT.maxLng - CHINA_COORDINATE_EXTENT.minLng)) * 88
        const top = 7 + ((CHINA_COORDINATE_EXTENT.maxLat - city.coordinates.lat)
          / (CHINA_COORDINATE_EXTENT.maxLat - CHINA_COORDINATE_EXTENT.minLat)) * 86
        const universityCount = universityCounts[city.id]
        const cityName = localize(city.name, locale)
        const universityLabel = universityCount === undefined
          ? undefined
          : `${universityCount} ${messages.nav.universities}`

        return <Link
          aria-label={universityLabel ? `${cityName}: ${universityLabel}` : cityName}
          className="city-marker"
          href={`/${locale}/cities/${city.slug}`}
          style={{ left: `${left}%`, top: `${top}%` }}
          key={city.id}
        >
          <span className="city-marker__bubble" aria-hidden="true">{universityCount ?? '·'}</span>
          <span className="city-marker__label">{cityName}</span>
          {universityLabel && <small>{universityLabel}</small>}
        </Link>
      })}
    </div>
    <p className="map-disclaimer">{note}</p>
  </div>
}
