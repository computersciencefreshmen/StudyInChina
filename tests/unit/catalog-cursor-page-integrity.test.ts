import { describe, expect, it, vi } from 'vitest'

import type { CatalogRepository } from '@/lib/catalog/types'
import { encodeJsonListCursor } from '@/lib/catalog/list-cursor'
import {
  parseProgramCatalogFilters,
  queryProgramCatalogRepository,
} from '@/lib/program-catalog'
import {
  parseScholarshipCatalogFilters,
  queryScholarshipCatalogRepository,
} from '@/lib/scholarship-catalog'
import {
  parseUniversityCatalogFilters,
  queryUniversityCatalogRepository,
} from '@/lib/university-catalog'

type Resource = 'institutions' | 'programs' | 'scholarships'
type QueryParams = Record<string, string>

function page(facets: Record<string, unknown>) {
  return {
    items: [],
    nextCursor: null,
    total: 72,
    facets,
    release: null,
  }
}

async function runProgram(params: QueryParams) {
  const list = vi.fn((query: { cursor?: string }) => {
    void query.cursor
    return page({ universities: [], cities: [] })
  })
  const result = await queryProgramCatalogRepository(
    { listPrograms: list } as unknown as CatalogRepository,
    parseProgramCatalogFilters(params),
    '2026-08-08',
  )
  return { result, calls: list.mock.calls.length, queriedCursor: list.mock.calls[0]?.[0].cursor }
}

async function runScholarship(params: QueryParams) {
  const list = vi.fn((query: { cursor?: string }) => {
    void query.cursor
    return page({ universities: [] })
  })
  const result = await queryScholarshipCatalogRepository(
    { listScholarships: list } as unknown as CatalogRepository,
    parseScholarshipCatalogFilters(params),
    '2026-08-08',
  )
  return { result, calls: list.mock.calls.length, queriedCursor: list.mock.calls[0]?.[0].cursor }
}

async function runUniversity(params: QueryParams) {
  const list = vi.fn((query: { cursor?: string }) => {
    void query.cursor
    return page({ cities: [] })
  })
  const result = await queryUniversityCatalogRepository(
    { listInstitutions: list } as unknown as CatalogRepository,
    parseUniversityCatalogFilters(params),
  )
  return { result, calls: list.mock.calls.length, queriedCursor: list.mock.calls[0]?.[0].cursor }
}

const catalogCases = [
  { name: 'program', resource: 'programs', run: runProgram },
  { name: 'scholarship', resource: 'scholarships', run: runScholarship },
  { name: 'university', resource: 'institutions', run: runUniversity },
] as const

function params(resource: Resource, cursorHistory: string): QueryParams {
  return {
    page: '999999999',
    cursor: encodeJsonListCursor(resource, 'test-fingerprint', 3),
    cursorHistory,
  }
}

describe('catalog cursor page integrity', () => {
  it.each(catalogCases)('reads the $name page index locally and queries only the current cursor', async ({ resource, run }) => {
    const input = params(resource, '~,cursor-page-2')
    const { result, calls, queriedCursor } = await run(input)

    expect(calls).toBe(1)
    expect(queriedCursor).toBe(input.cursor)
    expect(result.page).toBe(3)
    expect(result.filters.cursorHistory).toEqual(['~', 'cursor-page-2'])
  })

  it.each(catalogCases)('clears a forged 49-entry $name history without another Repository call', async ({ resource, run }) => {
    const forged = ['~', ...Array.from({ length: 48 }, (_, index) => `forged-${index + 2}`)].join(',')
    const input = params(resource, forged)
    const { result, calls, queriedCursor } = await run(input)

    expect(calls).toBe(1)
    expect(queriedCursor).toBe(input.cursor)
    expect(result.page).toBe(3)
    expect(result.filters.cursor).toBe(input.cursor)
    expect(result.filters.cursorHistory).toEqual([])
  })

  it.each(catalogCases)('fails an old or unknown $name cursor closed to page one in one call', async ({ run }) => {
    const { result, calls, queriedCursor } = await run({
      page: '3',
      cursor: 'legacy-or-unknown-cursor',
      cursorHistory: '~,cursor-page-2',
    })

    expect(calls).toBe(1)
    expect(queriedCursor).toBeUndefined()
    expect(result.page).toBe(1)
    expect(result.filters.cursor).toBe('')
    expect(result.filters.cursorHistory).toEqual([])
  })

  it.each(catalogCases)('does not replay a bare deep $name page number', async ({ run }) => {
    const { result, calls, queriedCursor } = await run({ page: '9999' })

    expect(calls).toBe(1)
    expect(queriedCursor).toBeUndefined()
    expect(result.page).toBe(1)
    expect(result.filters.cursor).toBe('')
    expect(result.filters.cursorHistory).toEqual([])
  })
})
