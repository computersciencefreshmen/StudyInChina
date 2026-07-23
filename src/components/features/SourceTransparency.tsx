import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import { formatDate } from '@/lib/data/format'

type OfficialLink = {
  href: string
  label: string
}

export type SourceTransparencyProps = {
  locale: LaunchLocale
  lastCheckedAt: string
  lastCheckedLabel: string
  notice: string
  reportErrorLabel: string
  officialLink?: OfficialLink
}

export function SourceTransparency({
  locale,
  lastCheckedAt,
  lastCheckedLabel,
  notice,
  reportErrorLabel,
  officialLink,
}: SourceTransparencyProps) {
  return (
    <div className="atlas-stack">
      <p className="notice" role="note">{notice}</p>
      <dl className="record-facts">
        <div>
          <dt>{lastCheckedLabel}</dt>
          <dd><time dateTime={lastCheckedAt}>{formatDate(lastCheckedAt, locale, '—')}</time></dd>
        </div>
      </dl>
      <div className="atlas-card__footer">
        {officialLink ? (
          <a className="text-link" href={officialLink.href} target="_blank" rel="noreferrer">
            {officialLink.label} <span aria-hidden="true">↗</span>
          </a>
        ) : null}
        <Link className="text-link" href={`/${locale}/contact`}>
          {reportErrorLabel} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}
