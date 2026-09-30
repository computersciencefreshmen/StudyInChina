import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  CatalogFilterSummary,
  catalogExplorerText,
} from '@/components/features/CatalogFilterSummary'
import { ProgramExplorerV2 } from '@/components/features/ProgramExplorerV2'
import { ScholarshipExplorerV2 } from '@/components/features/ScholarshipExplorerV2'
import { UniversityExplorerV2 } from '@/components/features/UniversityExplorerV2'
import { rankingFilterKeys, rankingFilterLabel } from '@/lib/data/rankings'
import { parseUniversityCatalogFilters } from '@/lib/university-catalog'
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
    filters: parseProgramCatalogFilters({ institution: 'tsinghua', scholarship: 'linked', sort: 'deadline' }),
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
  it.each(locales)('shows all four ranking controls across all three catalogues in %s', (locale) => {
    const messages = getMessages(locale)
    const params = { qsRankMax: '100', theRankMax: '200', usNewsRankMax: 'ranked', arwuRankMax: 'unverified' }
    render(<>
      <UniversityExplorerV2 result={{ items: [], filters: parseUniversityCatalogFilters(params), total: 0, totalExact: true, page: 1, pageCount: 1, pageSize: 24, cityOptions: [] }} locale={locale} messages={messages} />
      <ProgramExplorerV2 result={{ ...programResult(), filters: parseProgramCatalogFilters(params) }} locale={locale} messages={messages} today="2026-09-29" />
      <ScholarshipExplorerV2 result={{ ...scholarshipResult(), filters: parseScholarshipCatalogFilters(params) }} locale={locale} messages={messages} today="2026-09-29" />
    </>)
    for (const key of rankingFilterKeys) {
      const fields = screen.getAllByRole('combobox', { name: rankingFilterLabel(key, locale) })
      expect(fields).toHaveLength(3)
      for (const field of fields) {
        expect(field).toHaveAttribute('name', key)
        expect(field).toHaveValue(params[key])
      }
    }
  })

  it('clears only the status shortcut and resets pagination while preserving other filters', () => {
    const result = programResult()
    result.filters = parseProgramCatalogFilters({ q: 'medicine', institution: 'tsinghua', applicationState: 'closed', page: '2' })
    render(<ProgramExplorerV2 result={result} locale="en" messages={getMessages('en')} today="2026-09-16" />)
    const all = screen.getByRole('link', { name: 'All' })
    const url = new URL(all.getAttribute('href')!, 'https://example.test')
    expect(url.searchParams.get('q')).toBe('medicine')
    expect(url.searchParams.get('institution')).toBe('tsinghua')
    expect(url.searchParams.has('applicationState')).toBe(false)
    expect(url.searchParams.has('page')).toBe(false)
    expect(url.searchParams.has('cursor')).toBe(false)
  })

  it('removes one ranking without losing the others and carries them into pagination', () => {
    const messages = getMessages('en')
    const params = { q: 'medicine', qsRankMax: '100', theRankMax: '200', usNewsRankMax: '500', arwuRankMax: '1000', page: '2', cursor: 'old-cursor', cursorHistory: '~' }
    render(<>
      <UniversityExplorerV2 result={{ items: [], filters: { ...parseUniversityCatalogFilters(params), nextCursor: 'next-cursor' }, total: 72, totalExact: true, page: 2, pageCount: 3, pageSize: 24, cityOptions: [] }} locale="en" messages={messages} />
      <ProgramExplorerV2 result={{ ...programResult(), filters: { ...parseProgramCatalogFilters(params), nextCursor: 'next-cursor' }, page: 2, pageCount: 3 }} locale="en" messages={messages} today="2026-09-29" />
      <ScholarshipExplorerV2 result={{ ...scholarshipResult(), filters: { ...parseScholarshipCatalogFilters(params), nextCursor: 'next-cursor' }, page: 2, pageCount: 3 }} locale="en" messages={messages} today="2026-09-29" />
    </>)
    const chips = screen.getAllByRole('link', { name: 'Remove filter: QS world ranking, Top 100' })
    expect(chips).toHaveLength(3)
    for (const chip of chips) {
      const url = new URL(chip.getAttribute('href')!, 'https://example.test')
      expect(url.searchParams.get('q')).toBe('medicine')
      expect(url.searchParams.has('qsRankMax')).toBe(false)
      for (const key of rankingFilterKeys.filter((key) => key !== 'qsRankMax')) expect(url.searchParams.get(key)).toBe(params[key])
      for (const key of ['page', 'cursor', 'cursorHistory']) expect(url.searchParams.has(key)).toBe(false)
    }
    const nextLinks = screen.getAllByRole('link', { name: 'Next' })
    expect(nextLinks).toHaveLength(6)
    for (const link of nextLinks) {
      const url = new URL(link.getAttribute('href')!, 'https://example.test')
      for (const key of rankingFilterKeys) expect(url.searchParams.get(key)).toBe(params[key])
      expect(url.searchParams.get('cursor')).toBe('next-cursor')
      expect(url.searchParams.get('page')).toBe('3')
    }
  })

  it.each(locales)('localizes progressive disclosure controls in %s', (locale) => {
    const messages = getMessages(locale)
    const text = catalogExplorerText(locale)
    render(<ProgramExplorerV2
      result={programResult()}
      locale={locale}
      messages={messages}
      today="2026-08-08"
    />)

    const summary = screen.getByText(`${text.advancedFilters} (3)`)
    expect(summary.closest('details')).toHaveAttribute('open')
    expect(screen.getAllByLabelText(new RegExp(`^${text.removeFilter}:`))).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: messages.nav.scholarships })).toHaveValue('linked')
    expect(screen.getAllByRole('navigation')).toHaveLength(3)
    const openNow = screen.getByRole('link', { name: messages.common.openNow })
    expect(openNow).toHaveAttribute('href', expect.stringContaining('applicationState=open'))
    expect(openNow).not.toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('link', { name: messages.programs.upcoming })).toHaveAttribute('href', expect.stringContaining('applicationState=upcoming'))
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
