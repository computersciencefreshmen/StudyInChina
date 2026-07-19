import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import { localize } from '@/lib/data/format'
import type { City } from '@/lib/data/types'

export function CityConstellation({ cities, locale }: { cities: City[]; locale: LaunchLocale }) {
  const lngs = cities.map((city) => city.coordinates.lng)
  const lats = cities.map((city) => city.coordinates.lat)
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats)
  const note = locale === 'zh' ? '按经纬度绘制的示意点位，不是地图，也不表示边界；仅用于浏览城市入口。正式标准地图素材上线前不展示国界。' : locale === 'ru' ? 'Схема точек по координатам, не карта и не изображение границ. Используется только для перехода к городам.' : 'A coordinate-based point plot, not a map or boundary depiction. It is only a city index.'

  return <div>
    <div className="city-map" aria-label={note}>
      <span className="city-map__compass" aria-hidden="true">N ↑</span>
      {cities.map((city) => {
        const left = 8 + ((city.coordinates.lng - minLng) / Math.max(maxLng - minLng, 1)) * 84
        const top = 8 + ((maxLat - city.coordinates.lat) / Math.max(maxLat - minLat, 1)) * 84
        return <Link className="city-marker" href={`/${locale}/cities/${city.slug}`} style={{ left: `${left}%`, top: `${top}%` }} key={city.id}>{localize(city.name, locale)}</Link>
      })}
    </div>
    <p className="map-disclaimer">{note}</p>
  </div>
}
