'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { studentMatchCopy } from '@/i18n/student-match'
import { consultationLabels, programConsultationHref } from '@/i18n/program-consultation'
import { degreeLabels, languageLabel } from '@/lib/data/labels'
import { cvSuggestions, shortlist, type MatchOpportunity, type StudentProfile } from '@/lib/student-matching'
import { getTodayDate } from '@/lib/data/freshness'
import type { CVReadErrorCode } from '@/lib/cv-document'
import { Button, Card } from '@/components/ui'
import { FavoriteButton } from './FavoriteButton'

const initial: StudentProfile = { education: '', budget: '', language: '', intake: '' }
export function StudentMatch({ locale, rows, evaluatedOn }: { locale: LaunchLocale; rows: MatchOpportunity[]; evaluatedOn: string }) {
  const m = getMessages(locale), t = studentMatchCopy(locale), degree = degreeLabels(locale)
  const [suggestions, setSuggestions] = useState<Partial<StudentProfile>>({})
  const [edits, setEdits] = useState<Partial<StudentProfile>>({})
  const profile = { ...initial, ...suggestions, ...edits }
  const [confirmed, setConfirmed] = useState<StudentProfile | null>(null)
  const [notice, setNotice] = useState(''), [date, setDate] = useState(evaluatedOn)
  const [reading, setReading] = useState(false)
  const readVersion = useRef(0)
  useEffect(() => {
    const refresh = () => setDate(getTodayDate())
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const select = (field: keyof StudentProfile, value: string) => { setConfirmed(null); setEdits(p => ({ ...p, [field]: value })) }
  async function readCV(file?: File) {
    if (!file) return
    const version = ++readVersion.current
    setConfirmed(null)
    setSuggestions({})
    setNotice('')
    setReading(true)
    try {
      const { readCVDocument } = await import('@/lib/cv-document')
      const suggested = cvSuggestions(await readCVDocument(file))
      if (version !== readVersion.current) return
      setSuggestions(suggested)
      setNotice(Object.keys(suggested).length ? t.prefilled : t.noFields)
    } catch (error) {
      if (version !== readVersion.current) return
      const code = (error as { code?: CVReadErrorCode })?.code
      setNotice(code && Object.hasOwn(t.fileErrors, code) ? t.fileErrors[code] : t.fileErrors.unreadable)
    } finally {
      if (version === readVersion.current) setReading(false)
    }
  }
  const options = {
    education: [['secondary', t.secondary], ['bachelor', degree.bachelor], ['master', degree.master], ['doctorate', degree.doctorate]],
    language: ['English', 'Chinese'].map(l => [l, languageLabel(l, locale)]),
    intake: [...new Set(rows.flatMap(r => r.intake ? [r.intake.value] : []))].sort().map(key => [key,
      key.slice(0, 4) + ' · ' + (key.endsWith('spring') ? m.programs.springIntake : m.programs.autumnIntake)]),
  }
  const labels = { education: t.education, budget: t.budget, language: m.programs.languageFilter, intake: m.programs.intake }
  const matches = confirmed && date === evaluatedOn ? shortlist(confirmed, rows) : null
  const conflicts = confirmed && date === evaluatedOn ? shortlist(confirmed, rows, true) : []
  return <div className="atlas-stack">
    <form className="form-stack" onSubmit={event => { event.preventDefault(); setConfirmed({ ...profile }); setDate(getTodayDate()) }}>
      <label>{t.cv}<input type="file" accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; void readCV(file)
      }} /></label>
      {(reading || notice) && <p role="status">{reading ? t.reading : notice}</p>}
      {(Object.keys(options) as Array<keyof typeof options>).map(key => <label className="field" key={key}>{labels[key]}
        <select value={profile[key]} onChange={e => select(key, e.target.value)}><option value="">{m.common.all}</option>
          {options[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
      <label className="field">{t.budget}<input inputMode="numeric" pattern="[0-9]{1,9}" maxLength={9}
        value={profile.budget} onChange={e => select('budget', e.target.value)} /></label>
      <Button type="submit" disabled={reading || !Object.values(profile).some(Boolean)}>{t.submit}</Button>
    </form>
    {confirmed && date !== evaluatedOn && <a className="text-link" href={`/${locale}/match`}>{m.common.stale} ↻</a>}
    {matches && !matches.length && <p role="status">{t.empty}</p>}
    {matches?.map(({ row, reasons }) => <Card key={row.cycleId}>
      <h2><Link href={`/${locale}/programs/${row.slug}`}>{row.name}</Link></h2>
      <p>{[row.university, row.year, row.track, row.round].filter(Boolean).join(' · ')}</p>
      <dl className="compare-facts">{reasons.map(r => <div key={r.key}><dt>{labels[r.key]}</dt><dd>{t[r.state === 'met' ? 'met' : 'unknown']}
        {row[r.key] && <> · {Array.isArray(row[r.key]?.value) ? (row[r.key]?.value as string[]).join(', ') : String(row[r.key]?.value)}</>}
        {r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">{m.common.officialSource} ↗</a></>}</dd></div>)}</dl>
      {row.education?.value.map((clause, index) => <p key={index}>{clause}</p>)}
      {row.languageConditions && <div><a href={row.languageConditions.url} target="_blank" rel="noreferrer">{m.common.requirements} ↗</a>
        <ul>{row.languageConditions.value.map((condition, index) => <li key={index}>{condition}</li>)}</ul></div>}
      <div className="record-card__actions"><FavoriteButton programId={row.id} saveLabel={m.common.save} savedLabel={m.common.saved} />
        <Link href={programConsultationHref(locale, row.slug)}>{consultationLabels[locale]}</Link></div>
    </Card>)}
    {conflicts.length > 0 && <details><summary>{t.conflict}</summary><ul>{conflicts.map(({ row, reasons }) => <li key={row.cycleId}>
      <Link href={`/${locale}/programs/${row.slug}`}>{row.name}</Link> · {row.year} · {row.track || row.round}
      {reasons.filter(r => r.state === 'conflict').map(r => <p key={r.key}>{labels[r.key]} · {String(row[r.key]?.value ?? '')}
        {r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">{m.common.officialSource} ↗</a></>}</p>)}</li>)}</ul></details>}
  </div>
}
