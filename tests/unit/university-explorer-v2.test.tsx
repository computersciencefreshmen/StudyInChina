import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UniversityExplorerV2 } from '@/components/features/UniversityExplorerV2'
import { getMessages } from '@/i18n/messages'
import type { LaunchLocale } from '@/i18n/config'
import type { CatalogInstitutionListItem } from '@/lib/catalog/types'
import {
  parseUniversityCatalogFilters,
  type UniversityCatalogResult,
} from '@/lib/university-catalog'

const locales: LaunchLocale[] = ['en', 'zh', 'ru', 'de', 'fr', 'es']

function result(overrides: Partial<UniversityCatalogResult> = {}): UniversityCatalogResult {
  return {
    items: [],
    filters: parseUniversityCatalogFilters({}),
    total: 0,
    totalExact: true,
    page: 1,
    pageCount: 1,
    pageSize: 24,
    cityOptions: [{ value: 'beijing', name: { en: 'Beijing', zh: '北京' } }],
    ...overrides,
  }
}

function university(programCount: number): CatalogInstitutionListItem {
  return { institution: { id: 'university-example', slug: 'example-university', name: { en: 'Example University', zh: '示例大学' },
    summary: { en: 'Source-backed university record', zh: '来源院校记录' }, status: 'stale', verifiedAt: '2026-01-01',
    reviewAfter: '2027-01-01', officialUrl: 'https://example.edu', sourceIds: [] },
  city: null, disciplines: [], programCount, scholarshipCount: 0 } as unknown as CatalogInstitutionListItem
}

describe('UniversityExplorerV2', () => {
  it('links actual programme counts to the same canonical university filter as its detail page', () => {
    render(<UniversityExplorerV2 result={result({ items: [university(12)], total: 1 })} locale="zh" messages={getMessages('zh')} />)
    expect(screen.getByRole('link', { name: /^12$/ })).toHaveAttribute('href', '/zh/programs?institution=example-university')
    expect(screen.queryByTestId('university-program-information-pending')).not.toBeInTheDocument()
  })

  it.each(locales)('describes genuine zero coverage honestly in %s', locale => {
    const { container } = render(<UniversityExplorerV2 result={result({ items: [university(0)], total: 1 })} locale={locale} messages={getMessages(locale)} />)
    const pending = screen.getByTestId('university-program-information-pending')
    expect(pending).toBeVisible()
    expect(pending.textContent).not.toBe('0')
    if (locale === 'zh') expect(pending).toHaveTextContent('项目资料待补充')
    expect(container.querySelector('[data-program-count="0"]')).toContainElement(pending)
    expect(container.querySelector(`a[href="/${locale}/programs?institution=example-university"]`)).toBeNull()
  })
  it.each(locales)('renders the server-driven filter form in %s', (locale) => {
    const messages = getMessages(locale)
    render(<UniversityExplorerV2 result={result()} locale={locale} messages={messages} />)

    expect(screen.getByRole('search', { name: messages.universities.title })).toBeVisible()
    expect(screen.getByLabelText(messages.universities.cityFilter)).toHaveAttribute('name', 'city')
    expect(screen.getByLabelText(messages.universities.regionFilter)).toHaveAttribute('name', 'region')
    expect(screen.getByLabelText(messages.universities.fieldFilter)).toHaveAttribute('name', 'discipline')
  })

  it('shows the localized empty state without receiving a full catalogue', () => {
    const messages = getMessages('en')
    render(<UniversityExplorerV2 result={result()} locale="en" messages={messages} />)

    expect(screen.getByText(messages.universities.noResults)).toBeVisible()
    expect(screen.getByText(`0 ${messages.universities.results}`)).toBeVisible()
  })

  it('renders cursor-backed previous and next links', () => {
    const messages = getMessages('en')
    const filters = {
      ...parseUniversityCatalogFilters({ q: 'science', city: 'beijing', sort: 'name' }),
      page: 2,
      cursor: 'cursor-page-2',
      cursorHistory: ['~'],
      nextCursor: 'cursor-page-3',
    }
    render(<UniversityExplorerV2
      result={result({ filters, total: 72, page: 2, pageCount: 3 })}
      locale="en"
      messages={messages}
    />)

    const previousLinks = screen.getAllByRole('link', { name: 'Previous' })
    const nextLinks = screen.getAllByRole('link', { name: 'Next' })
    expect(previousLinks).toHaveLength(2)
    expect(nextLinks).toHaveLength(2)
    for (const previous of previousLinks) {
      expect(previous).toHaveAttribute('rel', 'prev')
      expect(previous.getAttribute('href')).not.toContain('page=')
      expect(previous.getAttribute('href')).not.toContain('cursor=')
    }
    for (const next of nextLinks) {
      expect(next).toHaveAttribute('rel', 'next')
      expect(next.getAttribute('href')).toContain('cursor=cursor-page-3')
      expect(next.getAttribute('href')).toContain('cursorHistory=%7E%2Ccursor-page-2')
      expect(next.getAttribute('href')).toContain('page=3')
    }
  })
})
