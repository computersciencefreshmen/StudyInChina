import { Badge, Card, LinkButton, VerificationBadge } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import { formatUniversityCoverage, getDecisionExperienceCopy } from '@/i18n/decision-experience'
import type { Messages } from '@/i18n/messages'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { coverageLabel, providerLabel } from '@/lib/data/scholarship'
import type { Scholarship } from '@/lib/data/types'
import { selectScholarshipCurrentCycle } from '@/lib/scholarship-catalog'
import styles from './DecisionRecordCards.module.css'

export function ScholarshipCard({ scholarship, locale, messages, today }: { scholarship: Scholarship; locale: LaunchLocale; messages: Messages; today: string }) {
  const decisionCopy = getDecisionExperienceCopy(locale)
  const isStaleIdentity = scholarship.status === 'stale'
  const currentCycle = selectScholarshipCurrentCycle(scholarship, today)
  const deadlineLabels = {
    future: decisionCopy.deadlineAhead,
    closed: decisionCopy.deadlineClosed,
    'not-announced': messages.programs.notAnnounced,
  }
  const deadlineTones = {
    future: 'jade',
    closed: 'neutral',
    'not-announced': 'warning',
  } as const
  const deadlineLabel = isStaleIdentity ? messages.common.stale : deadlineLabels[currentCycle.deadlineState]
  const deadlineTone = isStaleIdentity ? 'warning' as const : deadlineTones[currentCycle.deadlineState]
  const funding = [
    scholarship.coverage.tuition !== 'unknown' ? coverageLabel(scholarship.coverage.tuition, locale) : null,
    scholarship.coverage.stipendCnyPerMonth !== null ? formatCny(scholarship.coverage.stipendCnyPerMonth, locale, '') : null,
  ].filter(value => value !== null).join(' · ')
  const universities = formatUniversityCoverage(
    scholarship.universityIds.length,
    locale,
    messages.common.all,
  )

  return <Card className={`record-card ${styles.card}`}>
    <div className={styles.identityRow}><Badge tone="gold">{providerLabel(scholarship.providerType, locale)}</Badge></div>
    <div><h3 className="record-card__title">{localize(scholarship.name, locale)}</h3></div>
    {scholarship.summary ? <p className="record-card__summary">{localize(scholarship.summary, locale)}</p> : null}
    {currentCycle.deadline || funding ? <dl className={`${styles.signal} ${styles.fundingSignal}`}>
      {currentCycle.deadline ? <div><dt>{messages.common.deadline}</dt><dd className={styles.deadlineValue}>
        <Badge tone={deadlineTone}>{deadlineLabel}</Badge>
        {currentCycle.deadline
          ? <time dateTime={currentCycle.deadline}>{formatDate(currentCycle.deadline, locale, messages.common.unknown)}</time>
          : null}
      </dd></div> : null}
      {funding ? <div><dt>{decisionCopy.fundingHighlights}</dt><dd>{funding}</dd></div> : null}
    </dl> : null}
    <dl className={`record-facts ${styles.supportingFacts}`}>
      {scholarship.coverage.accommodation !== 'unknown' ? <div><dt>{messages.scholarships.accommodation}</dt><dd>{coverageLabel(scholarship.coverage.accommodation, locale)}</dd></div> : null}
      {scholarship.coverage.insurance !== 'unknown' ? <div><dt>{messages.scholarships.insurance}</dt><dd>{scholarship.coverage.insurance ? messages.scholarships.included : messages.scholarships.notIncluded}</dd></div> : null}
      <div><dt>{messages.common.university}</dt><dd>{universities}</dd></div>
    </dl>
    <div className="record-card__actions">
      <LinkButton href={`/${locale}/scholarships/${scholarship.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton>
      {scholarship.status === 'verified' && scholarship.applicationUrl ? <a className="atlas-button atlas-button--secondary atlas-button--small" href={scholarship.applicationUrl} target="_blank" rel="noreferrer">
        {decisionCopy.officialApplicationRoute} ↗
      </a> : null}
    </div>
    <div className={styles.footer}>
      <VerificationBadge collection="scholarships" recordId={scholarship.id} status={scholarship.status} verifiedAt={scholarship.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} />
    </div>
  </Card>
}
