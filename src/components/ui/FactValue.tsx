import type { ReactNode } from 'react'

import type { PublicLocale } from '@/i18n/config'
import { getFactStatusMessage } from '@/i18n/fact-status'
import type { FactStatus } from '@/lib/catalog-api/types'

import { cx } from './cx'
import styles from './FactValue.module.css'

const statusClasses: Record<Exclude<FactStatus, 'known'>, string | undefined> = {
  officially_not_announced: styles.officiallyNotAnnounced,
  not_applicable: styles.notApplicable,
  source_unavailable: styles.sourceUnavailable,
  conflict: styles.conflict,
  stale: styles.stale,
}

function hasValue(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== ''
}

export function FactValue({
  status,
  value,
  locale,
  className,
}: {
  status: FactStatus
  value?: ReactNode
  locale: PublicLocale
  className?: string
}) {
  const effectiveStatus = status === 'known' && !hasValue(value)
    ? 'officially_not_announced'
    : status

  if (effectiveStatus === 'known') {
    return <span className={cx(styles.value, className)} data-fact-status="known">{value}</span>
  }

  const message = getFactStatusMessage(locale, effectiveStatus)
  return <span
    className={cx(styles.state, statusClasses[effectiveStatus], className)}
    data-fact-status={effectiveStatus}
    title={message.description}
  >
    <span className={styles.marker} aria-hidden="true" />
    <span>{message.label}</span>
  </span>
}
