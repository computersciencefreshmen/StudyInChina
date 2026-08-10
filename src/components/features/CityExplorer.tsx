'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CityConstellation } from '@/components/features/CityConstellation'
import type { PublicLocale } from '@/i18n/config'
import { getCityGuideExperience } from '@/i18n/city-guide-experience'
import { getMessages } from '@/i18n/messages'
import {
  cityExplorerSearchParams,
  defaultCityExplorerState,
  parseCityExplorerSearchParams,
  type CityExplorerSort,
  type CityExplorerState,
} from '@/lib/city-explorer'
import { localize } from '@/lib/data/format'
import { regionLabels } from '@/lib/data/labels'
import type { City, Region } from '@/lib/data/types'

export type CityExplorerItem = Pick<City, 'id' | 'slug' | 'name' | 'province' | 'region' | 'coordinates'>

const regions: Region[] = ['north', 'northeast', 'east', 'south', 'central', 'southwest', 'northwest']

export function CityExplorer({
  cities,
  initialState = defaultCityExplorerState,
  locale,
  universityCounts,
}: {
  cities: CityExplorerItem[]
  initialState?: CityExplorerState
  locale: PublicLocale
  universityCounts: Readonly<Record<string, number>>
}) {
  const messages = getMessages(locale)
  const experience = getCityGuideExperience(locale).cities
  const labels = regionLabels(locale)
  const [state, setState] = useState<CityExplorerState>(initialState)
  const stateRef = useRef(state)
  const { query, region, sort, view } = state

  const updateState = (
    patch: Partial<CityExplorerState>,
    historyMode: 'push' | 'replace' = 'push',
  ) => {
    const current = stateRef.current
    const next = { ...current, ...patch }
    if (Object.entries(patch).every(([key, value]) => current[key as keyof CityExplorerState] === value)) return

    stateRef.current = next
    setState(next)
    if (typeof window !== 'undefined') {
      const params = cityExplorerSearchParams(new URLSearchParams(window.location.search), next)
      const queryString = params.toString()
      const href = window.location.pathname
        + (queryString ? '?' + queryString : '')
        + window.location.hash
      window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](
        window.history.state,
        '',
        href,
      )
    }
  }

  useEffect(() => {
    const mobileDirectory = () => typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 680px)').matches

    if (!initialState.viewExplicit && mobileDirectory()) {
      updateState({ view: 'directory', viewExplicit: true }, 'replace')
    }

    const restoreFromUrl = () => {
      const restored = parseCityExplorerSearchParams(new URLSearchParams(window.location.search))
      const next: CityExplorerState = !restored.viewExplicit && mobileDirectory()
        ? { ...restored, view: 'directory' }
        : restored
      stateRef.current = next
      setState(next)
    }
    window.addEventListener('popstate', restoreFromUrl)
    return () => window.removeEventListener('popstate', restoreFromUrl)
    // The initial server state is immutable for this mounted route. Later URL
    // changes are restored through popstate without causing a second history write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visibleCities = useMemo(() => {
    const filtered = cities.filter((city) => {
      if (region !== 'all' && city.region !== region) return false
      if (!normalizedQuery) return true
      return `${localize(city.name, locale)} ${localize(city.province, locale)}`
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery)
    })

    return filtered.sort((left, right) => {
      if (sort === 'universities') {
        const countOrder = (universityCounts[right.id] ?? 0) - (universityCounts[left.id] ?? 0)
        if (countOrder !== 0) return countOrder
      }
      return localize(left.name, locale).localeCompare(localize(right.name, locale), locale)
        || left.slug.localeCompare(right.slug)
    })
  }, [cities, locale, normalizedQuery, region, sort, universityCounts])

  const regionCounts = useMemo(() => Object.fromEntries(regions.map((key) => [
    key,
    cities.filter((city) => city.region === key).length,
  ])) as Record<Region, number>, [cities])

  return <section className="city-explorer" aria-label={experience.explorerLabel}>
    <div className="city-explorer__toolbar">
      <div className="field city-explorer__search">
        <label htmlFor="city-search">{experience.searchLabel}</label>
        <input
          id="city-search"
          name="q"
          type="search"
          value={query}
          placeholder={experience.searchPlaceholder}
          onChange={(event) => updateState({ query: event.target.value }, 'replace')}
        />
      </div>
      <div className="field">
        <label htmlFor="city-sort">{experience.sortLabel}</label>
        <select
          id="city-sort"
          name="sort"
          value={sort}
          onChange={(event) => updateState({ sort: event.target.value as CityExplorerSort })}
        >
          <option value="universities">{experience.sortByUniversities}</option>
          <option value="name">{experience.sortByName}</option>
        </select>
      </div>
      <div className="city-view-switch" role="group" aria-label={experience.viewLabel}>
        <button
          type="button"
          aria-controls="city-explorer-results"
          aria-pressed={view === 'constellation'}
          onClick={() => updateState({ view: 'constellation', viewExplicit: true })}
        >
          <span aria-hidden="true">✦</span>{experience.constellationView}
        </button>
        <button
          type="button"
          aria-controls="city-explorer-results"
          aria-pressed={view === 'directory'}
          onClick={() => updateState({ view: 'directory', viewExplicit: true })}
        >
          <span aria-hidden="true">☷</span>{experience.directoryView}
        </button>
      </div>
    </div>

    <div className="city-region-list" role="group" aria-label={experience.regionLabel}>
      <button type="button" aria-controls="city-explorer-results" aria-pressed={region === 'all'} onClick={() => updateState({ region: 'all' })}>
        <span>{experience.allRegions}</span><b>{cities.length}</b>
      </button>
      {regions.map((key) => <button type="button" aria-controls="city-explorer-results" aria-pressed={region === key} onClick={() => updateState({ region: key })} key={key}>
        <span>{labels[key]}</span><b>{regionCounts[key]}</b>
      </button>)}
    </div>

    <div className="city-explorer__result-bar">
      <output aria-live="polite">{visibleCities.length} {experience.resultSummary}</output>
      <span>{visibleCities.reduce((sum, city) => sum + (universityCounts[city.id] ?? 0), 0)} {messages.nav.universities}</span>
    </div>

    <div id="city-explorer-results">
      {visibleCities.length === 0
        ? <div className="empty-box"><p>{experience.empty}</p></div>
        : view === 'constellation'
          ? <CityConstellation cities={visibleCities} locale={locale} universityCounts={universityCounts} />
          : <ul className="city-directory">
              {visibleCities.map((city) => <li key={city.id}>
                <Link href={`/${locale}/cities/${city.slug}`}>
                  <span className="city-directory__place">
                    <strong>{localize(city.name, locale)}</strong>
                    <small>{localize(city.province, locale)} · {city.region ? labels[city.region] : messages.common.unknown}</small>
                  </span>
                  <span className="city-directory__count" aria-label={`${universityCounts[city.id] ?? 0} ${messages.nav.universities}`}>
                    <b>{universityCounts[city.id] ?? 0}</b><small>{messages.nav.universities}</small>
                  </span>
                  <span className="city-directory__arrow" aria-hidden="true">→</span>
                </Link>
              </li>)}
            </ul>}
    </div>
  </section>
}
