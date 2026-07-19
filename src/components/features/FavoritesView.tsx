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

export function FavoritesView({ programs, universities, cycles, locale, messages }: { programs: Program[]; universities: University[]; cycles: AdmissionCycle[]; locale: LaunchLocale; messages: Messages }) {
  const { favorites, ready } = useFavorites(); const [selected, setSelected] = useState<string[]>([])
  const saved = useMemo(() => programs.filter((program) => favorites.includes(program.id)), [programs, favorites])
  const compared = saved.filter((program) => selected.includes(program.id))
  const copy = locale === 'zh' ? { loading: '正在读取本机收藏…', choose: '选择用于对比', limit: '最多选择四个项目。', compare: '项目对比', remove: '移出收藏', university: '学校' } : locale === 'ru' ? { loading: 'Загрузка списка…', choose: 'Выбрать для сравнения', limit: 'Можно сравнить до четырёх программ.', compare: 'Сравнение', remove: 'Удалить', university: 'Университет' } : { loading: 'Loading this device’s shortlist…', choose: 'Select for comparison', limit: 'Choose up to four programs.', compare: 'Program comparison', remove: 'Remove', university: 'University' }
  const toggleCompare = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX_COMPARE ? [...current, id] : current)
  if (!ready) return <p aria-live="polite">{copy.loading}</p>
  if (!saved.length) return <EmptyState title={messages.favorites.empty} description={messages.favorites.localOnly} action={<LinkButton href={`/${locale}/programs`}>{messages.home.explorePrograms}</LinkButton>} />
  return <div className="atlas-stack" style={{ '--atlas-stack-gap': '3rem' } as React.CSSProperties}>
    <div><p className="result-count">{copy.limit} {messages.favorites.localOnly}</p><div className="content-grid">{saved.map((program) => { const university = universities.find((item) => item.id === program.universityId); return <Card key={program.id} className="record-card"><label className="checkbox-field"><input type="checkbox" checked={selected.includes(program.id)} disabled={!selected.includes(program.id) && selected.length >= MAX_COMPARE} onChange={() => toggleCompare(program.id)} /><span>{copy.choose}</span></label><h2 className="record-card__title">{localize(program.name, locale)}</h2><p className="record-card__place">{university ? localize(university.name, locale) : '—'}</p><div className="tag-list"><span>{degreeLabels(locale)[program.degreeLevel]}</span><span>{disciplineLabels(locale)[program.discipline]}</span></div><div className="record-card__actions"><LinkButton href={`/${locale}/programs/${program.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton><FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={copy.remove} /></div></Card> })}</div></div>
    {compared.length ? <section><div className="record-card__top"><h2>{copy.compare}</h2><Button className="no-print" variant="ghost" onClick={() => window.print()}>{messages.common.print}</Button></div><div className="compare-grid">{compared.map((program) => { const university = universities.find((item) => item.id === program.universityId); const cycle = cycles.find((item) => item.programId === program.id); return <Card key={program.id} accent="jade"><h3 className="atlas-card__title">{localize(program.name, locale)}</h3><dl className="compare-facts"><div><dt>{copy.university}</dt><dd>{university ? localize(university.name, locale) : '—'}</dd></div><div><dt>{messages.programs.degree}</dt><dd>{degreeLabels(locale)[program.degreeLevel]}</dd></div><div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div><div><dt>{messages.common.duration}</dt><dd>{program.durationMonths ? `${program.durationMonths} ${messages.common.months}` : messages.common.unknown}</dd></div><div><dt>{messages.common.tuition}</dt><dd>{formatCny(cycle?.tuitionCny ?? null, locale, messages.common.unknown)}</dd></div><div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle?.closesOn ?? null, locale, messages.common.unknown)}</dd></div></dl></Card> })}</div></section> : null}
  </div>
}
