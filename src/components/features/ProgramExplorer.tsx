'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import type { AdmissionCycle, Program, University } from '@/lib/data/types'
import { filterPrograms } from '@/lib/search'
import { ProgramCard } from './RecordCards'

export function ProgramExplorer({ programs, universities, cycles, locale, messages, initialDiscipline = '', today }: { programs: Program[]; universities: University[]; cycles: AdmissionCycle[]; locale: LaunchLocale; messages: Messages; initialDiscipline?: string; today?: string }) {
  const [filters, setFilters] = useState({ query: '', degree: '', discipline: initialDiscipline, language: '', dateStatus: '', tuition: '' })
  const filtered = useMemo(() => filterPrograms(programs, universities, cycles, filters, today), [programs, universities, cycles, filters, today])
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))

  return <>
    <div className="filter-panel filter-panel--programs" role="search" aria-label={messages.programs.title}>
      <div className="field"><label htmlFor="program-search">{messages.common.search}</label><input id="program-search" value={filters.query} onChange={(event) => set('query', event.target.value)} placeholder={messages.programs.searchPlaceholder} /></div>
      <div className="field"><label htmlFor="program-degree">{messages.programs.degree}</label><select id="program-degree" value={filters.degree} onChange={(event) => set('degree', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(degreeLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="program-discipline">{messages.programs.discipline}</label><select id="program-discipline" value={filters.discipline} onChange={(event) => set('discipline', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(disciplineLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="program-language">{messages.programs.languageFilter}</label><select id="program-language" value={filters.language} onChange={(event) => set('language', event.target.value)}><option value="">{messages.common.all}</option>{['Chinese', 'English', 'Bilingual'].map((value) => <option value={value} key={value}>{languageLabel(value, locale)}</option>)}</select></div>
      <div className="field"><label htmlFor="program-status">{messages.programs.statusFilter}</label><select id="program-status" value={filters.dateStatus} onChange={(event) => set('dateStatus', event.target.value)}><option value="">{messages.common.all}</option><option value="open">{messages.common.openNow}</option><option value="upcoming">{messages.programs.upcoming}</option><option value="closed">{messages.programs.applicationsClosed}</option><option value="not-announced">{messages.programs.notAnnounced}</option></select></div>
      <div className="field"><label htmlFor="program-tuition">{messages.programs.tuitionFilter}</label><select id="program-tuition" value={filters.tuition} onChange={(event) => set('tuition', event.target.value)}><option value="">{messages.common.all}</option><option value="known">{messages.programs.known}</option><option value="unknown">{messages.programs.unannounced}</option></select></div>
      <Button variant="ghost" onClick={() => setFilters({ query: '', degree: '', discipline: '', language: '', dateStatus: '', tuition: '' })}>{messages.common.clear}</Button>
    </div>
    <p className="result-count" aria-live="polite">{filtered.length} {messages.programs.results}</p>
    {filtered.length ? <div className="content-grid">{filtered.map((program) => <ProgramCard key={program.id} program={program} university={universities.find((university) => university.id === program.universityId)} cycle={cycles.find((cycle) => cycle.programId === program.id)} locale={locale} messages={messages} today={today} />)}</div> : <div className="empty-box">{messages.programs.noResults}</div>}
  </>
}
