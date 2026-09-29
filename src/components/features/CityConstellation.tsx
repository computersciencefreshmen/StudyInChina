import Link from 'next/link'
import Image from 'next/image'
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

// This camera and crop match the captured Google Maps image. Use Web Mercator
// rather than a linear latitude scale so markers follow the actual geography.
const BASEMAP = { centerLat: 36, centerLng: 104, zoom: 5, viewportWidth: 1920, viewportHeight: 1080, cropLeft: 72, cropTop: 160, width: 1848, height: 920 } as const
const BASEMAP_URL = 'https://www.google.com/maps/@36,104,5z?hl=en'
function mercatorY(latitude: number) {
  const sine = Math.sin(latitude * Math.PI / 180)
  return .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
}

function mapPosition({ lat, lng }: { lat: number; lng: number }) {
  const worldSize = 256 * 2 ** BASEMAP.zoom
  const x = BASEMAP.viewportWidth / 2 + (lng - BASEMAP.centerLng) / 360 * worldSize - BASEMAP.cropLeft
  const y = BASEMAP.viewportHeight / 2 + (mercatorY(lat) - mercatorY(BASEMAP.centerLat)) * worldSize - BASEMAP.cropTop
  return { left: `${x / BASEMAP.width * 100}%`, top: `${y / BASEMAP.height * 100}%` }
}

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
  const note = messages.cities.plotNote

  return <div>
    <div className="city-map city-map--geographic" aria-label={note}>
      <Image src="/maps/china-google-maps-2026-09-29.jpg" alt="" width={BASEMAP.width} height={BASEMAP.height}
        className="city-map__background" unoptimized />
      <span className="city-map__compass" aria-hidden="true">N ↑</span>
      <span className="city-map__location-count">{locatedCities.length} {messages.nav.cities}</span>
      {locatedCities.length === 0 && <p className="city-map__empty">{note}</p>}
      {locatedCities.map((city) => {
        const universityCount = universityCounts[city.id]
        const cityName = localize(city.name, locale)
        const universityLabel = universityCount === undefined
          ? undefined
          : `${universityCount} ${messages.nav.universities}`

        return <Link
          aria-label={universityLabel ? `${cityName}: ${universityLabel}` : cityName}
          className="city-marker"
          href={`/${locale}/cities/${city.slug}`}
          style={mapPosition(city.coordinates)}
          key={city.id}
        >
          <span className="city-marker__bubble" aria-hidden="true">{universityCount ?? '·'}</span>
          <span className="city-marker__label">{cityName}</span>
          {universityLabel && <small>{universityLabel}</small>}
        </Link>
      })}
    </div>
    <p className="map-disclaimer">{note}</p>
    <p className="city-map__source"><a href={BASEMAP_URL} target="_blank" rel="noopener noreferrer">Google Maps</a> · Map data ©2026 Google, TMap Mobility</p>
  </div>
}
