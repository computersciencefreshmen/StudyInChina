import type { City } from '@/lib/data/types'

export function hasMapCoordinates(city: Pick<City, 'coordinates'>): city is typeof city & { coordinates: { lat: number; lng: number } } {
  const point = city.coordinates
  return point !== null && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= 18 && point.lat <= 54 && point.lng >= 73 && point.lng <= 135
}

/** Maps URLs open a provider's own search without an API key or guessed campus coordinates. */
export function googleMapsCityUrl(city: Pick<City, 'name' | 'province' | 'coordinates'>): string {
  const query = hasMapCoordinates(city)
    ? `${city.coordinates.lat},${city.coordinates.lng}`
    : [city.name.en || city.name.zh || Object.values(city.name).find(Boolean), city.province?.en || city.province?.zh, 'China'].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`
}
