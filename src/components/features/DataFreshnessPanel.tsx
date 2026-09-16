import Link from 'next/link'
import { Badge } from '@/components/ui'
import type { LaunchLocale } from '@/i18n/config'
import { getDataTrustCopy } from '@/i18n/data-trust'
import { formatDate } from '@/lib/data/format'
import { isCurrentVerifiedRecord } from '@/lib/data/freshness'
import type { AuditMeta } from '@/lib/data/types'
import styles from './DataFreshnessPanel.module.css'

type ReviewRecord = Pick<AuditMeta, 'verifiedAt' | 'reviewAfter' | 'status'>

/** Review freshness and admission availability are separate facts. Keep both visible. */
export function DataFreshnessPanel({
  record,
  cycle,
  locale,
  today,
  sourcesHref = '#official-evidence',
}: {
  record: ReviewRecord
  cycle?: ReviewRecord
  locale: LaunchLocale
  today: string
  sourcesHref?: string
}) {
  const copy = getDataTrustCopy(locale)
  const needsReview = !isCurrentVerifiedRecord(record, today)
    || Boolean(cycle && !isCurrentVerifiedRecord(cycle, today))
  const records = [
    { label: copy.profileEvidence, record },
    ...(cycle ? [{ label: copy.cycleEvidence, record: cycle }] : []),
  ]

  return <section className={`${styles.panel} ${needsReview ? styles.overdue : ''}`} aria-label={copy.title}>
    <div className={styles.introduction}>
      <div className={styles.heading}>
        <h2>{copy.title}</h2>
        <Badge tone={needsReview ? 'warning' : 'neutral'}>{needsReview ? copy.reviewNeeded : copy.reviewed}</Badge>
      </div>
      <p>{copy.explanation}</p>
      {needsReview ? <p className={styles.reviewNotice}>{copy.overdueExplanation}</p> : null}
      <div className={styles.footer}>
        <a className="text-link" href={sourcesHref}>{copy.sources} <span aria-hidden="true">↓</span></a>
        <span>{copy.evaluated}: <time dateTime={today}>{formatDate(today, locale, '—')}</time></span>
      </div>
    </div>
    <div className={styles.records}>
      {records.map(({ label, record: item }) => <div className={styles.record} key={label}>
        <h3>{label}</h3>
        <dl>
          <div><dt>{copy.checked}</dt><dd><time dateTime={item.verifiedAt}>{formatDate(item.verifiedAt, locale, '—')}</time></dd></div>
          <div><dt>{copy.reviewDue}</dt><dd><time dateTime={item.reviewAfter}>{formatDate(item.reviewAfter, locale, '—')}</time></dd></div>
        </dl>
      </div>)}
    </div>
  </section>
}

export function CatalogFreshnessNote({ locale, today }: { locale: LaunchLocale; today: string }) {
  const copy = getDataTrustCopy(locale)
  return <div className={styles.catalogNote} role="note">
    <p><strong>{copy.evaluated}: <time dateTime={today}>{formatDate(today, locale, '—')}</time></strong> {copy.catalogExplanation}</p>
    <Link className="text-link" href={`/${locale}/data-policy`}>{copy.policy} <span aria-hidden="true">→</span></Link>
  </div>
}
