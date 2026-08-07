import { describe, expect, it, vi } from 'vitest'
import type { CatalogRepository } from '@/lib/catalog/types'
import {
  parseUniversityCatalogFilters,
  queryUniversityCatalogRepository,
  UNIVERSITY_CATALOG_PAGE_SIZE,
  universityCatalogHref,
} from '@/lib/university-catalog'

function repositoryWithPage(overrides: Record<string, unknown> = {}) {
  const listInstitutions = vi.fn().mockResolvedValue({
    items: [],
    nextCursor: 'cursor-next',
    total: 72,
    facets: { cities: [] },
    release: null,
    ...overrides,
  })
  return {
    listInstitutions,
    repository: { listInstitutions } as unknown as CatalogRepository,
  }
}

describe('repository-backed university catalogue', () => {
  it('normalizes safe URL filters into the shared taxonomy', () => {
    const filters = parseUniversityCatalogFilters({
      q: 'technology',
      city: 'beijing',
      region: 'north',
      discipline: 'engineering',
      sort: 'programs-desc',
      page: '2',
      cursor: 'cursor-current',
      cursorHistory: '~',
    })

    expect(filters).toMatchObject({
      query: 'technology',
      city: 'beijing',
      region: 'north',
      discipline: 'engineering-technology',
      sort: 'programs-desc',
      page: 2,
      cursor: 'cursor-current',
      cursorHistory: ['~'],
    })
  })

  it('rejects unsupported region, discipline and sort values', () => {
    const filters = parseUniversityCatalogFilters({
      region: 'somewhere',
      discipline: 'drop-table',
      sort: 'random',
    })

    expect(filters.region).toBe('')
    expect(filters.discipline).toBe('')
    expect(filters.sort).toBe('default')
  })

  it('normalizes FTS terms and clears queries the Worker would reject', () => {
    expect(parseUniversityCatalogFilters({ q: '  C++ / data-science  ' }).query)
      .toBe('C data science')
    expect(parseUniversityCatalogFilters({ q: '!!!' }).query).toBe('')
    expect(parseUniversityCatalogFilters({
      q: Array.from({ length: 21 }, (_, index) => `term${index}`).join(' '),
    }).query).toBe('')
  })

  it('uses one bounded repository request for a cursor URL', async () => {
    const { repository, listInstitutions } = repositoryWithPage()
    const filters = parseUniversityCatalogFilters({
      q: 'medicine',
      city: 'guangzhou',
      region: 'south',
      discipline: 'medicine-health',
      sort: 'scholarships-desc',
      page: '3',
      cursor: 'cursor-page-3',
      cursorHistory: '~,cursor-page-2',
    })

    const result = await queryUniversityCatalogRepository(repository, filters)

    expect(listInstitutions).toHaveBeenCalledTimes(1)
    expect(listInstitutions).toHaveBeenCalledWith({
      q: 'medicine',
      city: 'guangzhou',
      region: 'south',
      discipline: 'medicine-health',
      sort: 'scholarships-desc',
      cursor: 'cursor-page-3',
      limit: UNIVERSITY_CATALOG_PAGE_SIZE,
    })
    expect(result.page).toBe(3)
    expect(result.filters.cursorHistory).toEqual(['~', 'cursor-page-2'])
  })

  it('does not replay earlier pages when a bare page number lacks its cursor', async () => {
    const { repository, listInstitutions } = repositoryWithPage()
    const result = await queryUniversityCatalogRepository(
      repository,
      parseUniversityCatalogFilters({ page: '9' }),
    )

    expect(listInstitutions).toHaveBeenCalledTimes(1)
    expect(listInstitutions).toHaveBeenCalledWith({ limit: UNIVERSITY_CATALOG_PAGE_SIZE })
    expect(result.page).toBe(1)
    expect(result.filters.cursorHistory).toEqual([])
  })

  it('preserves all filters and the cursor stack in next and previous links', () => {
    const filters = {
      ...parseUniversityCatalogFilters({
        q: 'normal',
        city: 'beijing',
        region: 'north',
        discipline: 'education',
        sort: 'name',
      }),
      page: 3,
      cursor: 'cursor-page-3',
      cursorHistory: ['~', 'cursor-page-2'],
      nextCursor: 'cursor-page-4',
    }
    const next = new URL(universityCatalogHref('en', filters, 4), 'https://example.test')
    const previous = new URL(universityCatalogHref('en', filters, 2), 'https://example.test')

    expect(Object.fromEntries(next.searchParams)).toEqual({
      q: 'normal',
      city: 'beijing',
      region: 'north',
      discipline: 'education',
      sort: 'name',
      cursor: 'cursor-page-4',
      cursorHistory: '~,cursor-page-2,cursor-page-3',
      page: '4',
    })
    expect(Object.fromEntries(previous.searchParams)).toEqual({
      q: 'normal',
      city: 'beijing',
      region: 'north',
      discipline: 'education',
      sort: 'name',
      cursor: 'cursor-page-2',
      cursorHistory: '~',
      page: '2',
    })
  })
})
