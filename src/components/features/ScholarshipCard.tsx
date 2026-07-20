import { Badge, Card, LinkButton, VerificationBadge } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import type { Messages } from '@/i18n/messages'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { coverageLabel, providerLabel } from '@/lib/data/scholarship'
import type { Scholarship } from '@/lib/data/types'

export function ScholarshipCard({ scholarship, locale, messages }: { scholarship: Scholarship; locale: LaunchLocale; messages: Messages }) {
  return <Card className="record-card">
    <div className="record-card__top"><Badge tone="gold">{providerLabel(scholarship.providerType, locale)}</Badge><VerificationBadge status={scholarship.status} verifiedAt={scholarship.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} /></div>
    <div><h3 className="record-card__title">{localize(scholarship.name, locale)}</h3></div>
    <p className="record-card__summary">{localize(scholarship.summary, locale)}</p>
    <dl className="record-facts"><div><dt>{messages.scholarships.tuition}</dt><dd>{coverageLabel(scholarship.coverage.tuition, locale)}</dd></div><div><dt>{messages.scholarships.stipend}</dt><dd>{formatCny(scholarship.coverage.stipendCnyPerMonth, locale, messages.common.unknown)}</dd></div><div><dt>{messages.common.deadline}</dt><dd>{formatDate(scholarship.deadline, locale, messages.common.unknown)}</dd></div><div><dt>{messages.common.university}</dt><dd>{scholarship.universityIds.length || messages.common.all}</dd></div></dl>
    <div className="record-card__actions"><LinkButton href={`/${locale}/scholarships/${scholarship.slug}`} variant="secondary" size="small">{messages.common.viewDetails}</LinkButton><a className="text-link" href={scholarship.applicationUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a></div>
  </Card>
}
