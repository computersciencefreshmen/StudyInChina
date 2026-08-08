import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UniversityExplorerV2 } from '@/components/features/UniversityExplorerV2'
import { getMessages } from '@/i18n/messages'
import type { LaunchLocale } from '@/i18n/config'
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

describe('UniversityExplorerV2', () => {
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
