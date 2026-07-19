import { Badge } from './Badge'

export type VerificationStatus = 'verified' | 'stale' | 'draft' | 'archived'

const defaultLabels: Record<VerificationStatus, string> = {
  verified: 'Verified',
  stale: 'Review due',
  draft: 'Draft',
  archived: 'Archived',
}

const tones = {
  verified: 'jade',
  stale: 'warning',
  draft: 'neutral',
  archived: 'danger',
} as const

export interface VerificationBadgeProps {
  status: VerificationStatus
  verifiedAt?: string | null
  locale?: string
  labels?: Partial<Record<VerificationStatus, string>>
  verifiedDateLabel?: string
  showDate?: boolean
  className?: string
}

export function VerificationBadge({
  status,
  verifiedAt,
  locale = 'en',
  labels,
  verifiedDateLabel = 'Checked',
  showDate = true,
  className,
}: VerificationBadgeProps) {
  let formattedDate: string | null = null

  if (showDate && verifiedAt) {
    const date = new Date(verifiedAt)
    if (!Number.isNaN(date.getTime())) {
      try {
        formattedDate = new Intl.DateTimeFormat(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(date)
      } catch {
        formattedDate = new Intl.DateTimeFormat('en', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(date)
      }
    }
  }

  const statusLabel = labels?.[status] ?? defaultLabels[status]
  const label = formattedDate ? `${statusLabel} · ${verifiedDateLabel} ${formattedDate}` : statusLabel

  return (
    <Badge tone={tones[status]} dot className={className} title={label}>
      {label}
    </Badge>
  )
}
