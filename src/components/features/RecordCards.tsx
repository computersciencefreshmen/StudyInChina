import { Badge, Card, LinkButton, VerificationBadge } from '@/components/ui'
import type { Locale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { getApplicationState } from '@/lib/data/admission'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { degreeLabels, disciplineLabels, languageLabel, regionLabels } from '@/lib/data/labels'
import type { AdmissionCycle, City, Program, University } from '@/lib/data/types'
import { FavoriteButton } from './FavoriteButton'

export function UniversityCard({ university, city, fields, locale, messages }: { university: University; city?: City; fields: string[]; locale: Locale; messages: Messages }) {
  return <Card className="record-card" accent={university.featured ? 'vermilion' : 'none'}>
    <div className="record-card__top"><Badge tone="blue">{university.region ? regionLabels(locale)[university.region] : messages.common.unknown}</Badge><VerificationBadge status={university.status} verifiedAt={university.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} /></div>
    <div><h3 className="record-card__title">{localize(university.name, locale)}</h3>{city ? <p className="record-card__place">⌖ {localize(city.name, locale)}</p> : null}</div>
    <p className="record-card__summary">{localize(university.summary, locale)}</p>
    <div className="tag-list">{fields.slice(0, 3).map((field) => <Badge key={field} tone="neutral">{disciplineLabels(locale)[field as keyof ReturnType<typeof disciplineLabels>] || field}</Badge>)}</div>
    <div className="record-card__actions"><LinkButton href={`/${locale}/universities/${university.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>{university.admissionsUrl ? <a className="text-link" href={university.admissionsUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a> : <a className="text-link" href={university.officialUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>}</div>
  </Card>
}

export function ProgramCard({ program, university, cycle, locale, messages, today = new Date().toISOString().slice(0, 10) }: { program: Program; university?: University; cycle?: AdmissionCycle; locale: Locale; messages: Messages; today?: string }) {
  const periodLabels = {
    program: messages.programs.tuitionProgram,
    semester: messages.programs.tuitionSemester,
    'academic-year': messages.programs.tuitionAcademicYear,
    month: messages.programs.tuitionMonth,
    other: messages.programs.tuitionOther,
  }
  const tuition = cycle?.tuitionCny == null
    ? messages.common.unknown
    : `${formatCny(cycle.tuitionCny, locale, messages.common.unknown)} / ${periodLabels[cycle.tuitionPeriod || 'other']}${cycle.tuitionStatus === 'reference' ? ` · ${messages.programs.tuitionReference}` : ''}`
  const duration = program.durationMonths
    ? program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
      ? `${program.durationMonths}–${program.durationMonthsMax} ${messages.common.months}`
      : `${program.durationMonths} ${messages.common.months}`
    : messages.common.unknown
  const applicationState = getApplicationState(cycle, today)
  const stateLabels = {
    open: messages.common.openNow,
    upcoming: messages.programs.upcoming,
    closed: messages.programs.applicationsClosed,
    rolling: messages.programs.rolling,
    'dates-published': messages.programs.datePublished,
    'not-announced': messages.programs.notAnnounced,
    'previous-cycle': messages.programs.previousCycle,
  }
  const stateTone = applicationState === 'open' || applicationState === 'rolling'
    ? 'jade' as const
    : applicationState === 'upcoming'
      ? 'gold' as const
      : applicationState === 'closed'
        ? 'neutral' as const
        : 'blue' as const

  return <Card className="record-card">
    <div className="record-card__top"><div className="tag-list"><Badge tone="vermilion">{degreeLabels(locale)[program.degreeLevel]}</Badge><Badge tone={stateTone}>{stateLabels[applicationState]}</Badge></div><VerificationBadge status={program.status} verifiedAt={program.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} /></div>
    <div><h3 className="record-card__title">{localize(program.name, locale)}</h3>{university ? <p className="record-card__place">{localize(university.name, locale)}</p> : null}</div>
    <dl className="record-facts">
      <div><dt>{messages.common.duration}</dt><dd>{duration}</dd></div>
      <div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.length
        ? program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')
        : messages.common.unknown}</dd></div>
      <div><dt>{messages.common.tuition}</dt><dd>{tuition}</dd></div>
      <div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle?.closesOn ?? null, locale, messages.common.unknown)}</dd></div>
    </dl>
    <div className="record-card__actions"><LinkButton href={`/${locale}/programs/${program.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton><FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} /></div>
  </Card>
}
