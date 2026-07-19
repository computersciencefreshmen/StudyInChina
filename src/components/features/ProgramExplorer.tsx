'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import type { AdmissionCycle, Program, University } from '@/lib/data/types'
import { filterPrograms } from '@/lib/search'
import { ProgramCard } from './RecordCards'

const text = (locale: LaunchLocale) => locale === 'zh'
  ? { language: '授课语言', status: '申请日期', tuition: '学费信息', published: '已公布', unannounced: '尚未公布', known: '已有数据', unknown: '待公布', results: '个项目' }
  : locale === 'ru'
    ? { language: 'Язык', status: 'Сроки', tuition: 'Стоимость', published: 'Опубликованы', unannounced: 'Не объявлены', known: 'Есть данные', unknown: 'Не объявлена', results: 'программ' }
    : { language: 'Teaching language', status: 'Application dates', tuition: 'Tuition data', published: 'Published', unannounced: 'Not announced', known: 'Available', unknown: 'Not announced', results: 'programs' }

export function ProgramExplorer({ programs, universities, cycles, locale, messages, initialDiscipline = '' }: { programs: Program[]; universities: University[]; cycles: AdmissionCycle[]; locale: LaunchLocale; messages: Messages; initialDiscipline?: string }) {
  const [filters, setFilters] = useState({ query: '', degree: '', discipline: initialDiscipline, language: '', dateStatus: '', tuition: '' })
  const copy = text(locale)
  const filtered = useMemo(() => filterPrograms(programs, universities, cycles, filters), [programs, universities, cycles, filters])
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))

  return <>
    <div className="filter-panel filter-panel--programs" role="search" aria-label={messages.programs.title}>
      <div className="field"><label htmlFor="program-search">{messages.common.search}</label><input id="program-search" value={filters.query} onChange={(event) => set('query', event.target.value)} placeholder={messages.programs.searchPlaceholder} /></div>
      <div className="field"><label htmlFor="program-degree">{messages.programs.degree}</label><select id="program-degree" value={filters.degree} onChange={(event) => set('degree', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(degreeLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="program-discipline">{messages.programs.discipline}</label><select id="program-discipline" value={filters.discipline} onChange={(event) => set('discipline', event.target.value)}><option value="">{messages.common.all}</option>{Object.entries(disciplineLabels(locale)).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>
      <div className="field"><label htmlFor="program-language">{copy.language}</label><select id="program-language" value={filters.language} onChange={(event) => set('language', event.target.value)}><option value="">{messages.common.all}</option>{['Chinese', 'English', 'Bilingual'].map((value) => <option value={value} key={value}>{languageLabel(value, locale)}</option>)}</select></div>
      <div className="field"><label htmlFor="program-status">{copy.status}</label><select id="program-status" value={filters.dateStatus} onChange={(event) => set('dateStatus', event.target.value)}><option value="">{messages.common.all}</option><option value="published">{copy.published}</option><option value="not-announced">{copy.unannounced}</option></select></div>
      <div className="field"><label htmlFor="program-tuition">{copy.tuition}</label><select id="program-tuition" value={filters.tuition} onChange={(event) => set('tuition', event.target.value)}><option value="">{messages.common.all}</option><option value="known">{copy.known}</option><option value="unknown">{copy.unknown}</option></select></div>
      <Button variant="ghost" onClick={() => setFilters({ query: '', degree: '', discipline: '', language: '', dateStatus: '', tuition: '' })}>{messages.common.clear}</Button>
    </div>
    <p className="result-count" aria-live="polite">{filtered.length} {copy.results}</p>
    {filtered.length ? <div className="content-grid">{filtered.map((program) => <ProgramCard key={program.id} program={program} university={universities.find((university) => university.id === program.universityId)} cycle={cycles.find((cycle) => cycle.programId === program.id)} locale={locale} messages={messages} />)}</div> : <div className="empty-box">{messages.programs.noResults}</div>}
  </>
}
