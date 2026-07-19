'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { disciplineLabels, regionLabels } from '@/lib/data/labels'
import type { City, Program, University } from '@/lib/data/types'
import { filterUniversities } from '@/lib/search'
import { UniversityCard } from './RecordCards'

const text = (locale: LaunchLocale) => locale === 'zh'
  ? { city: '城市', region: '地区', field: '学科', results: '所大学' }
  : locale === 'ru'
    ? { city: 'Город', region: 'Регион', field: 'Направление', results: 'вузов' }
    : { city: 'City', region: 'Region', field: 'Field', results: 'universities' }

export function UniversityExplorer({ universities, programs, cities, locale, messages }: { universities: University[]; programs: Program[]; cities: City[]; locale: LaunchLocale; messages: Messages }) {
  const [filters, setFilters] = useState({ query: '', cityId: '', region: '', discipline: '' })
  const copy = text(locale)
  const filtered = useMemo(() => filterUniversities(universities, programs, cities, filters), [universities, programs, cities, filters])
  const fieldsByUniversity = useMemo(() => Object.fromEntries(universities.map((university) => [university.id, [...new Set(programs.filter((program) => program.universityId === university.id).map((program) => program.discipline))]])), [universities, programs])

  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  return <>
    <div className="filter-panel" role="search" aria-label={messages.universities.title}>
      <div className="field"><label htmlFor="university-search">{messages.common.search}</label><input id="university-search" value={filters.query} onChange={(event) => set('query', event.target.value)} placeholder={messages.universities.searchPlaceholder} /></div>
      <div className="field"><label htmlFor="university-city">{copy.city}</label><select id="university-city" value={filters.cityId} onChange={(event) => set('cityId', event.target.value)}><option value="">{messages.common.all}</option>{cities.map((city) => <option value={city.id} key={city.id}>{localize(city.name, locale)}</option>)}</select></div>
      <div className="field"><label htmlFor="university-region">{copy.region}</label><select id="university-region" value={filters.region} onChange={(event) => set('region', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(regionLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="university-field">{copy.field}</label><select id="university-field" value={filters.discipline} onChange={(event) => set('discipline', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(disciplineLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <Button variant="ghost" onClick={() => setFilters({ query: '', cityId: '', region: '', discipline: '' })}>{messages.common.clear}</Button>
    </div>
    <p className="result-count" aria-live="polite">{filtered.length} {copy.results}</p>
    {filtered.length ? <div className="content-grid">{filtered.map((university) => <UniversityCard key={university.id} university={university} city={cities.find((city) => city.id === university.cityId)} fields={fieldsByUniversity[university.id] || []} locale={locale} messages={messages} />)}</div> : <div className="empty-box">{messages.universities.noResults}</div>}
  </>
}
