'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { CityMapCanvas } from './CityMapCanvas'
import type { CityExplorerItem } from './CityExplorer'
import type { LaunchLocale } from '@/i18n/config'
import { getCityMapCopy } from '@/i18n/city-map'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import type { University } from '@/lib/data/types'
import { googleMapsCityUrl, hasMapCoordinates } from '@/lib/city-map'

export type CityMapUniversity = Pick<University, 'id' | 'slug' | 'name' | 'cityId'>

export function CityMapWorkspace({ cities, locale, universityCounts, universities = [] }: {
  cities: CityExplorerItem[]
  locale: LaunchLocale
  universityCounts: Readonly<Record<string, number>>
  universities?: CityMapUniversity[]
}) {
  const copy = getCityMapCopy(locale)
  const messages = getMessages(locale)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = cities.find(city => city.id === selectedId) ?? null
  const located = cities.filter(hasMapCoordinates)
  const schools = selected ? universities.filter(university => university.cityId === selected.id) : []

  const selectFromMap = (id: string) => {
    setSelectedId(id)
    // Scroll only the results pane; selecting a marker must not move the page.
    const list = listRef.current
    const item = Array.from(list?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find(button => button.dataset.cityId === id)
    if (item && list) list.scrollTo({
      top: list.scrollTop + item.getBoundingClientRect().top - list.getBoundingClientRect().top,
      behavior: 'auto',
    })
  }

  const closeDetails = () => {
    // The close button is about to disappear. Keep keyboard navigation in the
    // same city context without scrolling the surrounding page.
    const item = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find(button => button.dataset.cityId === selected?.id)
    item?.focus({ preventScroll: true })
    setSelectedId(null)
  }

  return <div className="city-map-workspace">
    <aside className="city-map-sidebar" aria-label={copy.results}>
      <div className="city-map-sidebar__header">
        <strong>{copy.results}</strong>
        <span>{located.length} / {cities.length} {copy.located}</span>
      </div>
      <ul className="city-map-results" ref={listRef}>
        {cities.map(city => <li key={city.id}>
          <button type="button" data-city-id={city.id} aria-pressed={selected?.id === city.id}
            onClick={() => setSelectedId(city.id)}>
            <span className="city-map-results__pin" aria-hidden="true">⌖</span>
            <span className="city-map-results__place">
              <strong>{localize(city.name, locale)}</strong>
              <small>{localize(city.province, locale)}</small>
              {!hasMapCoordinates(city) && <small className="city-map-results__pending">{copy.missing}</small>}
            </span>
            <span className="city-map-results__count"><b>{universityCounts[city.id] ?? 0}</b><small>{messages.nav.universities}</small></span>
          </button>
        </li>)}
      </ul>
      <p className="city-map-sidebar__note">{copy.coverage}</p>
    </aside>
    <div className="city-map-stage">
      <CityMapCanvas cities={cities} locale={locale} selectedId={selected?.id ?? null} onSelect={selectFromMap} />
      {selected ? <section className="city-map-detail" aria-label={localize(selected.name, locale)}>
        <button className="city-map-detail__close" type="button" aria-label={copy.clearSelection} onClick={closeDetails}>×</button>
        <span className="city-map-detail__eyebrow">{localize(selected.province, locale)}</span>
        <h3>{localize(selected.name, locale)}</h3>
        <p className="city-map-detail__position">{hasMapCoordinates(selected) ? copy.cityCentre : copy.noCoordinates}</p>
        <div className="city-map-detail__schools">
          <strong>{universityCounts[selected.id] ?? 0} {copy.universities}</strong>
          {schools.length > 0 && <ul>{schools.slice(0, 3).map(school => <li key={school.id}>
            <Link href={`/${locale}/universities/${school.slug}`}>{localize(school.name, locale)} <span aria-hidden="true">↗</span></Link>
          </li>)}</ul>}
        </div>
        <div className="city-map-detail__actions">
          <Link href={`/${locale}/cities/${selected.slug}`}>{copy.cityGuide} <span aria-hidden="true">→</span></Link>
          <a href={googleMapsCityUrl(selected)} target="_blank" rel="noreferrer">{copy.googleMaps} <span aria-hidden="true">↗</span></a>
        </div>
      </section> : <div className="city-map-invitation">
        <strong>{copy.selectCity}</strong><span>{copy.selectHint}</span>
      </div>}
    </div>
  </div>
}
