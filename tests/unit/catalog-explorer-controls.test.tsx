import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  CatalogFilterSummary,
  catalogExplorerText,
} from '@/components/features/CatalogFilterSummary'
import { ProgramExplorerV2 } from '@/components/features/ProgramExplorerV2'
import { ScholarshipExplorerV2 } from '@/components/features/ScholarshipExplorerV2'
import type { LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import {
  parseProgramCatalogFilters,
  type ProgramCatalogResult,
} from '@/lib/program-catalog'
import {
  parseScholarshipCatalogFilters,
  type ScholarshipCatalogResult,
} from '@/lib/scholarship-catalog'

const locales: LaunchLocale[] = ['en', 'zh', 'ru', 'de', 'fr', 'es']

function programResult(): ProgramCatalogResult {
  return {
    items: [],
    filters: parseProgramCatalogFilters({ institution: 'tsinghua', sort: 'deadline' }),
    total: 48,
    totalExact: true,
    page: 1,
    pageCount: 2,
    pageSize: 24,
    universityOptions: [{ value: 'tsinghua', name: { en: 'Tsinghua University', zh: '清华大学' } }],
    cityOptions: [],
  }
}

function scholarshipResult(): ScholarshipCatalogResult {
  return {
    items: [],
    filters: parseScholarshipCatalogFilters({ institution: 'tsinghua', sort: 'deadline' }),
    total: 30,
    totalExact: true,
    page: 1,
    pageCount: 2,
    pageSize: 24,
    universityOptions: [{ value: 'tsinghua', name: { en: 'Tsinghua University', zh: '清华大学' } }],
  }
}

describe('catalogue explorer controls', () => {
  it.each(locales)('localizes progressive disclosure controls in %s', (locale) => {
    const messages = getMessages(locale)
    const text = catalogExplorerText(locale)
    render(<ProgramExplorerV2
      result={programResult()}
      locale={locale}
      messages={messages}
      today="2026-08-08"
    />)

    const summary = screen.getByText(`${text.advancedFilters} (2)`)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getAllByLabelText(new RegExp(`^${text.removeFilter}:`))).toHaveLength(2)
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(screen.getByRole('navigation', { name: new RegExp(text.topPagination) })).toBeVisible()
    expect(screen.getByRole('navigation', { name: new RegExp(text.bottomPagination) })).toBeVisible()
  })

  it('keeps scholarship school and sorting controls in an expanded advanced group', () => {
    const messages = getMessages('en')
    render(<ScholarshipExplorerV2
      result={scholarshipResult()}
      locale="en"
      messages={messages}
      today="2026-08-08"
    />)

    const details = screen.getByText('More filters (2)').closest('details')
    expect(details).toHaveAttribute('open')
    expect(screen.getByLabelText('University')).toHaveAttribute('name', 'institution')
    expect(screen.getAllByRole('link', { name: 'Next' })).toHaveLength(2)
  })

  it('shows an exact visible result range and a removable filter link', () => {
    const text = catalogExplorerText('en')
    render(<CatalogFilterSummary
      activeFilters={[{
        key: 'degree',
        label: 'Degree',
        value: 'Master',
        href: '/en/programs?degree=',
      }]}
      clearAllHref="/en/programs"
      clearAllLabel="Clear filters"
      itemCount={24}
      page={1}
      pageSize={24}
      resultLabel="programs"
      text={text}
      total={1_152}
      totalExact
    />)

    expect(screen.getByText('1–24')).toBeVisible()
    expect(screen.getByText('1152 programs')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Remove filter: Degree, Master' }))
      .toHaveAttribute('href', '/en/programs?degree=')
  })
})
