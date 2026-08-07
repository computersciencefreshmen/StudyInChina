import { normalizeProgramField } from '@/lib/data/fields'
import type { Region } from '@/lib/data/types'
import type {
  CatalogInstitutionListItem,
  CatalogInstitutionListQuery,
  CatalogInstitutionListSort,
  CatalogListOption,
  CatalogRepository,
} from '@/lib/catalog/types'

export const UNIVERSITY_CATALOG_PAGE_SIZE = 24

const REGIONS = new Set<Region>([
  'north',
  'northeast',
  'east',
  'south',
  'central',
  'southwest',
  'northwest',
])
const SORT_ORDERS = new Set([
  'default',
  'name',
  'programs-desc',
  'scholarships-desc',
])

export type UniversityCatalogSearchParams = Record<string, string | string[] | undefined>

export type UniversityCatalogFilters = {
  query: string
  city: string
  region: string
  discipline: string
  sort: CatalogInstitutionListSort
  page: number
  cursor: string
  cursorHistory: string[]
  nextCursor?: string
}

export type UniversityCatalogResult = {
  items: CatalogInstitutionListItem[]
  filters: UniversityCatalogFilters
  total: number
  totalExact: boolean
  page: number
  pageCount: number
  pageSize: number
  cityOptions: CatalogListOption[]
}

function first(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function bounded(value: string | string[] | undefined, maxLength = 160): string {
  return first(value).trim().slice(0, maxLength)
}

function searchQuery(value: string | string[] | undefined): string {
  const normalized = bounded(value).normalize('NFKC')
  if (!normalized) return ''
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  if (terms.length === 0 || terms.length > 20) return ''
  return terms.join(' ')
}

function cursorValue(value: string | string[] | undefined): string {
  const cursor = first(value).trim()
  return cursor.length <= 1_024 ? cursor : ''
}

function cursorHistory(value: string | string[] | undefined): string[] {
  const history = first(value).trim()
  if (!history || history.length > 8_192) return []
  const entries = history.split(',').slice(-50)
  return entries.every((entry) => entry === '~' || (entry.length > 0 && entry.length <= 1_024))
    ? entries
    : []
}

function allowed(value: string, values: ReadonlySet<string>): string {
  return values.has(value) ? value : ''
}

export function parseUniversityCatalogFilters(
  params: UniversityCatalogSearchParams,
): UniversityCatalogFilters {
  const requestedDiscipline = bounded(params.discipline)
  const requestedPage = Number.parseInt(first(params.page), 10)

  return {
    query: searchQuery(params.q),
    city: bounded(params.city),
    region: allowed(bounded(params.region), REGIONS),
    discipline: requestedDiscipline
      ? normalizeProgramField(requestedDiscipline) ?? ''
      : '',
    sort: (allowed(bounded(params.sort), SORT_ORDERS) || 'default') as CatalogInstitutionListSort,
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10_000
      ? requestedPage
      : 1,
    cursor: cursorValue(params.cursor),
    cursorHistory: cursorHistory(params.cursorHistory),
  }
}

function repositoryInstitutionQuery(
  filters: UniversityCatalogFilters,
  cursor: string | undefined,
): CatalogInstitutionListQuery {
  return {
    q: filters.query || undefined,
    city: filters.city || undefined,
    region: filters.region || undefined,
    discipline: filters.discipline || undefined,
    sort: filters.sort === 'default' ? undefined : filters.sort,
    cursor,
    limit: UNIVERSITY_CATALOG_PAGE_SIZE,
  }
}

/**
 * Executes exactly one bounded Repository request. Cursor-based pagination is
 * intentionally not replayed from page one: a page number without its cursor
 * is normalized to page one, while normal next/previous links carry both the
 * current cursor and the cursor stack in the URL.
 */
export async function queryUniversityCatalogRepository(
  repository: CatalogRepository,
  filters: UniversityCatalogFilters,
): Promise<UniversityCatalogResult> {
  const cursor = filters.cursor || undefined
  const page = cursor ? filters.page : 1
  const history = cursor ? [...filters.cursorHistory] : []
  const pageResult = await repository.listInstitutions(
    repositoryInstitutionQuery(filters, cursor),
  )
  const lowerBound = (page - 1) * UNIVERSITY_CATALOG_PAGE_SIZE
    + pageResult.items.length
    + (pageResult.nextCursor ? 1 : 0)
  const total = pageResult.total ?? lowerBound
  const pageCount = pageResult.total === null
    ? page + (pageResult.nextCursor ? 1 : 0)
    : Math.max(1, Math.ceil(pageResult.total / UNIVERSITY_CATALOG_PAGE_SIZE))

  return {
    items: pageResult.items,
    filters: {
      ...filters,
      page,
      cursor: cursor ?? '',
      cursorHistory: history,
      nextCursor: pageResult.nextCursor ?? undefined,
    },
    total,
    totalExact: pageResult.total !== null,
    page,
    pageCount,
    pageSize: UNIVERSITY_CATALOG_PAGE_SIZE,
    cityOptions: pageResult.facets.cities,
  }
}

export function universityCatalogHref(
  locale: string,
  filters: UniversityCatalogFilters,
  page = filters.page,
): string {
  const params = new URLSearchParams()
  let targetCursor = filters.cursor
  let targetHistory = [...filters.cursorHistory]

  if (page === filters.page + 1 && filters.nextCursor) {
    targetHistory.push(filters.cursor || '~')
    targetCursor = filters.nextCursor
  } else if (page === filters.page - 1) {
    const previous = targetHistory.pop()
    targetCursor = previous && previous !== '~' ? previous : ''
  } else if (page !== filters.page) {
    targetCursor = ''
    targetHistory = []
  }

  const values: Array<[string, string]> = [
    ['q', filters.query],
    ['city', filters.city],
    ['region', filters.region],
    ['discipline', filters.discipline],
    ['sort', filters.sort === 'default' ? '' : filters.sort],
  ]
  for (const [key, value] of values) if (value) params.set(key, value)
  if (targetCursor) params.set('cursor', targetCursor)
  if (targetHistory.length > 0) params.set('cursorHistory', targetHistory.join(','))
  if (page > 1) params.set('page', String(page))

  const query = params.toString()
  return `/${locale}/universities${query ? `?${query}` : ''}`
}
