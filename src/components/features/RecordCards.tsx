import { Badge, Card, LinkButton, VerificationBadge } from '@/components/ui'
import { FactValue } from '@/components/ui/FactValue'
import type { PublicLocale } from '@/i18n/config'
import { getDecisionExperienceCopy } from '@/i18n/decision-experience'
import type { Messages } from '@/i18n/messages'
import { getApplicationState } from '@/lib/data/admission'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { degreeLabels, disciplineLabels, languageLabel, regionLabels } from '@/lib/data/labels'
import type { FactStatus, FieldMeta } from '@/lib/catalog-api/types'
import type { AdmissionCycle, City, Program, University } from '@/lib/data/types'
import styles from './DecisionRecordCards.module.css'
import { FavoriteButton } from './FavoriteButton'

type ProgramWithFieldMeta = Program & {
  fieldMeta?: Record<string, FieldMeta>
}

type AdmissionCycleWithFieldMeta = AdmissionCycle & {
  fieldMeta?: Record<string, FieldMeta>
}

function isStaleRecord(
  record: Pick<Program, 'status' | 'reviewAfter'> | Pick<AdmissionCycle, 'status' | 'reviewAfter'>,
  today: string,
) {
  return record.status === 'stale' || record.reviewAfter < today
}

function hasFactValue(value: unknown) {
  return value !== null && value !== undefined && value !== ''
}

function resolveFactStatus({
  fieldMeta,
  stale,
  value,
  reference = false,
}: {
  fieldMeta?: FieldMeta
  stale: boolean
  value: unknown
  reference?: boolean
}): FactStatus {
  if (stale) return 'stale'
  if (reference) return 'officially_not_announced'
  if (fieldMeta) return fieldMeta.status
  return hasFactValue(value) ? 'known' : 'officially_not_announced'
}

export function UniversityCard({ university, city, fields, locale, messages }: { university: University; city?: City; fields: string[]; locale: PublicLocale; messages: Messages }) {
  return <Card className="record-card" accent={university.featured ? 'vermilion' : 'none'}>
    <div className="record-card__top"><Badge tone="blue">{university.region ? regionLabels(locale)[university.region] : messages.common.unknown}</Badge><VerificationBadge status={university.status} verifiedAt={university.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} /></div>
    <div><h3 className="record-card__title">{localize(university.name, locale)}</h3>{city ? <p className="record-card__place">⌖ {localize(city.name, locale)}</p> : null}</div>
    <p className="record-card__summary">{localize(university.summary, locale)}</p>
    <div className="tag-list">{fields.slice(0, 3).map((field) => <Badge key={field} tone="neutral">{disciplineLabels(locale)[field as keyof ReturnType<typeof disciplineLabels>] || field}</Badge>)}</div>
    <div className="record-card__actions"><LinkButton href={`/${locale}/universities/${university.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>{university.admissionsUrl ? <a className="text-link" href={university.admissionsUrl} target="_blank" rel="noreferrer">{messages.universities.admission} ↗</a> : <a className="text-link" href={university.officialUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>}</div>
  </Card>
}

export function ProgramCard({ program, university, cycle, locale, messages, today = new Date().toISOString().slice(0, 10) }: { program: ProgramWithFieldMeta; university?: University; cycle?: AdmissionCycleWithFieldMeta; locale: PublicLocale; messages: Messages; today?: string }) {
  const decisionCopy = getDecisionExperienceCopy(locale)
  const periodLabels = {
    program: messages.programs.tuitionProgram,
    semester: messages.programs.tuitionSemester,
    'academic-year': messages.programs.tuitionAcademicYear,
    month: messages.programs.tuitionMonth,
    other: messages.programs.tuitionOther,
  }
  const programIsStale = isStaleRecord(program, today)
  const cycleIsStale = Boolean(cycle && isStaleRecord(cycle, today))
  const previousCycle = cycle?.dateStatus === 'previous-cycle-reference'
  const dynamicFactsAreStale = programIsStale || cycleIsStale || previousCycle
  const referenceFees = cycle?.tuitionStatus === 'reference'
  const tuitionStatus = resolveFactStatus({
    fieldMeta: cycle?.fieldMeta?.tuitionCny,
    stale: dynamicFactsAreStale,
    value: cycle?.tuitionCny,
    reference: referenceFees,
  })
  const applicationFeeStatus = resolveFactStatus({
    fieldMeta: cycle?.fieldMeta?.applicationFeeCny,
    stale: dynamicFactsAreStale,
    value: cycle?.applicationFeeCny,
    reference: referenceFees,
  })
  const deadlineStatus = resolveFactStatus({
    fieldMeta: cycle?.fieldMeta?.closesOn,
    stale: dynamicFactsAreStale,
    value: cycle?.closesOn,
  })
  const durationStatus = resolveFactStatus({
    fieldMeta: program.fieldMeta?.durationMonths,
    stale: programIsStale,
    value: program.durationMonths,
  })
  const tuitionValue = cycle?.tuitionCny == null
    ? undefined
    : `${formatCny(cycle.tuitionCny, locale, messages.common.unknown)} / ${periodLabels[cycle.tuitionPeriod || 'other']}`
  const applicationFeeValue = cycle?.applicationFeeCny == null
    ? undefined
    : formatCny(cycle.applicationFeeCny, locale, messages.common.unknown)
  const durationValue = program.durationMonths
    ? program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
      ? `${program.durationMonths}–${program.durationMonthsMax} ${messages.common.months}`
      : `${program.durationMonths} ${messages.common.months}`
    : undefined
  const applicationState = getApplicationState(cycle, today)
  const canApply = !dynamicFactsAreStale && program.status === 'verified' && (applicationState === 'open' || applicationState === 'rolling') && Boolean(program.applyUrl)
  const stateLabels = {
    open: messages.common.openNow,
    upcoming: messages.programs.upcoming,
    closed: messages.programs.applicationsClosed,
    rolling: messages.programs.rolling,
    'dates-published': messages.programs.datePublished,
    'not-announced': messages.programs.notAnnounced,
    'previous-cycle': messages.programs.previousCycle,
  }
  const stateLabel = dynamicFactsAreStale ? messages.common.stale : stateLabels[applicationState]
  const stateTone = dynamicFactsAreStale
    ? 'warning' as const
    : applicationState === 'open' || applicationState === 'rolling'
    ? 'jade' as const
    : applicationState === 'upcoming'
      ? 'gold' as const
      : applicationState === 'closed'
        ? 'neutral' as const
        : 'blue' as const

  return <Card className={`record-card ${styles.card}`}>
    <div className={styles.identityRow}><Badge tone="vermilion">{degreeLabels(locale)[program.degreeLevel]}</Badge></div>
    <div><h3 className="record-card__title">{localize(program.name, locale)}</h3>{university ? <p className="record-card__place">{localize(university.name, locale)}</p> : null}</div>
    <dl className={styles.signal}>
      <div><dt>{messages.programs.applicationStatus}</dt><dd><Badge tone={stateTone}>{stateLabel}</Badge></dd></div>
      <div><dt>{messages.common.deadline}</dt><dd><FactValue status={deadlineStatus} locale={locale} value={cycle?.closesOn
        ? <time dateTime={cycle.closesOn}>{formatDate(cycle.closesOn, locale, messages.common.unknown)}</time>
        : undefined} /></dd></div>
    </dl>
    <dl className={`record-facts ${styles.supportingFacts}`}>
      <div><dt>{messages.common.tuition}</dt><dd><FactValue status={tuitionStatus} locale={locale} value={tuitionValue} /></dd></div>
      <div><dt>{decisionCopy.applicationFee}</dt><dd><FactValue status={applicationFeeStatus} locale={locale} value={applicationFeeValue} /></dd></div>
      <div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.length
        ? program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')
        : messages.common.unknown}</dd></div>
      <div><dt>{messages.common.duration}</dt><dd><FactValue status={durationStatus} locale={locale} value={durationValue} /></dd></div>
    </dl>
    {!dynamicFactsAreStale && cycle?.notes ? <p className="record-card__summary">{localize(cycle.notes, locale)}</p> : null}
    <div className="record-card__actions">
      <LinkButton href={`/${locale}/programs/${program.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
      {canApply && program.applyUrl ? <a className="atlas-button atlas-button--primary atlas-button--small" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a> : null}
      <FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} />
    </div>
    <div className={styles.footer}>
      <VerificationBadge status={program.status} verifiedAt={program.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} />
    </div>
  </Card>
}
