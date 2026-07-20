'use client'

import { useMemo, useState } from 'react'
import { Button, Card, EmptyState, LinkButton } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import type { AdmissionCycle, Program, University } from '@/lib/data/types'
import { MAX_COMPARE } from '@/lib/favorites'
import { useFavorites } from './useFavorites'
import { FavoriteButton } from './FavoriteButton'

function tuitionLabel(cycle: AdmissionCycle | undefined, locale: LaunchLocale, messages: Messages) {
  if (cycle?.tuitionCny == null) return messages.common.unknown
  const periods = {
    program: messages.programs.tuitionProgram,
    semester: messages.programs.tuitionSemester,
    'academic-year': messages.programs.tuitionAcademicYear,
    month: messages.programs.tuitionMonth,
    other: messages.programs.tuitionOther,
  }
  return `${formatCny(cycle.tuitionCny, locale, messages.common.unknown)} / ${periods[cycle.tuitionPeriod || 'other']}${cycle.tuitionStatus === 'reference' ? ` · ${messages.programs.tuitionReference}` : ''}`
}

function durationLabel(program: Program, messages: Messages) {
  if (!program.durationMonths) return messages.common.unknown
  return program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
    ? `${program.durationMonths}–${program.durationMonthsMax} ${messages.common.months}`
    : `${program.durationMonths} ${messages.common.months}`
}

export function FavoritesView({ programs, universities, cycles, locale, messages }: { programs: Program[]; universities: University[]; cycles: AdmissionCycle[]; locale: LaunchLocale; messages: Messages }) {
  const { favorites, ready } = useFavorites(); const [selected, setSelected] = useState<string[]>([])
  const saved = useMemo(() => programs.filter((program) => favorites.includes(program.id)), [programs, favorites])
  const compared = saved.filter((program) => selected.includes(program.id))
  const copy = messages.favorites
  const toggleCompare = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX_COMPARE ? [...current, id] : current)
  if (!ready) return <p aria-live="polite">{copy.loading}</p>
  if (!saved.length) return <EmptyState title={messages.favorites.empty} description={messages.favorites.localOnly} action={<LinkButton href={`/${locale}/programs`}>{messages.home.explorePrograms}</LinkButton>} />
  return <div className="atlas-stack" style={{ '--atlas-stack-gap': '3rem' } as React.CSSProperties}>
    <div><p className="result-count">{copy.limit} {messages.favorites.localOnly}</p><div className="content-grid">{saved.map((program) => { const university = universities.find((item) => item.id === program.universityId); return <Card key={program.id} className="record-card"><label className="checkbox-field"><input type="checkbox" checked={selected.includes(program.id)} disabled={!selected.includes(program.id) && selected.length >= MAX_COMPARE} onChange={() => toggleCompare(program.id)} /><span>{copy.choose}</span></label><h2 className="record-card__title">{localize(program.name, locale)}</h2><p className="record-card__place">{university ? localize(university.name, locale) : '—'}</p><div className="tag-list"><span>{degreeLabels(locale)[program.degreeLevel]}</span><span>{disciplineLabels(locale)[program.discipline]}</span></div><div className="record-card__actions"><LinkButton href={`/${locale}/programs/${program.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton><FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={copy.remove} /></div></Card> })}</div></div>
    {compared.length ? <section><div className="record-card__top"><h2>{copy.comparison}</h2><Button className="no-print" variant="ghost" onClick={() => window.print()}>{messages.common.print}</Button></div><div className="compare-grid">{compared.map((program) => { const university = universities.find((item) => item.id === program.universityId); const cycle = cycles.find((item) => item.programId === program.id); return <Card key={program.id} accent="jade"><h3 className="atlas-card__title">{localize(program.name, locale)}</h3><dl className="compare-facts"><div><dt>{copy.university}</dt><dd>{university ? localize(university.name, locale) : '—'}</dd></div><div><dt>{messages.programs.degree}</dt><dd>{degreeLabels(locale)[program.degreeLevel]}</dd></div><div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div><div><dt>{messages.common.duration}</dt><dd>{durationLabel(program, messages)}</dd></div><div><dt>{messages.common.tuition}</dt><dd>{tuitionLabel(cycle, locale, messages)}</dd></div><div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle?.closesOn ?? null, locale, messages.common.unknown)}</dd></div></dl></Card> })}</div></section> : null}
  </div>
}
