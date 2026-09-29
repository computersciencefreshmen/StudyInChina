import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CatalogFreshnessNote, DataFreshnessPanel } from '@/components/features/DataFreshnessPanel'
import { launchLocales } from '@/i18n/config'
import { getDataTrustCopy } from '@/i18n/data-trust'

const record = { verifiedAt: '2026-08-10', reviewAfter: '2026-09-16', status: 'verified' as const }

describe('evidence freshness guidance', () => {
  it.each(launchLocales)('explains review dates separately from deadlines in %s', (locale) => {
    const copy = getDataTrustCopy(locale)
    for (const value of Object.values(copy)) expect(value.trim()).not.toBe('')
    const { container } = render(<DataFreshnessPanel record={record} locale={locale} today="2026-09-16" />)
    expect(screen.getByRole('region', { name: copy.title })).toBeVisible()
    expect(screen.getByText(copy.explanation)).toBeVisible()
    expect(screen.getByText(copy.reviewed)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.sources })).toHaveAttribute('href', '#official-evidence')
    expect(container.querySelector('time[datetime="2026-08-10"]')).toBeInTheDocument()
    expect(container.querySelectorAll('time[datetime="2026-09-16"]')).toHaveLength(2)
  })

  it('switches to a review warning on the first day after the review date', () => {
    render(<DataFreshnessPanel record={record} locale="en" today="2026-09-17" />)
    expect(screen.getByText('Review needed')).toBeVisible()
    expect(screen.getByText(getDataTrustCopy('en').overdueExplanation)).toBeVisible()
    expect(screen.queryByText('Within review period')).not.toBeInTheDocument()
  })

  it('does not let a fresh profile conceal overdue evidence for the selected cycle', () => {
    const { container } = render(<DataFreshnessPanel
      record={record}
      cycle={{ ...record, verifiedAt: '2026-07-01', reviewAfter: '2026-08-01' }}
      locale="en"
      today="2026-09-16"
    />)
    expect(screen.getByText('Review needed')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Profile evidence' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Selected admission cycle' })).toBeVisible()
    expect(container.querySelector('time[datetime="2026-07-01"]')).toBeInTheDocument()
  })

  it('keeps an explicitly stale record marked for review even before its scheduled date', () => {
    render(<DataFreshnessPanel record={{ ...record, status: 'stale' }} locale="en" today="2026-08-10" />)
    expect(screen.getByText('Review needed')).toBeVisible()
  })

  it('provides the evaluation date and uncertainty guidance in the catalogue', () => {
    render(<CatalogFreshnessNote locale="zh" today="2026-09-16" />)
    expect(screen.getByRole('note')).toHaveTextContent('中国时间')
    expect(screen.getByRole('note')).toHaveTextContent('并不表示申请已经截止')
    expect(screen.getByRole('link', { name: '了解信息核验方式' })).toHaveAttribute('href', '/zh/data-policy')
  })
})
