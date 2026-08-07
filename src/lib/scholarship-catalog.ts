import type {
  DataBundle,
  DegreeLevel,
  LocalizedText,
  Program,
  Scholarship,
  University,
} from '@/lib/data/types'
import type { CatalogRepository, CatalogScholarshipListQuery } from '@/lib/catalog/types'

export const SCHOLARSHIP_CATALOG_PAGE_SIZE = 24

const DEGREE_LEVELS = new Set<DegreeLevel>([
  'bachelor',
  'master',
  'doctorate',
  'language',
  'foundation',
  'other',
])
const FUNDING_FILTERS = new Set([
  'full-tuition',
  'partial-tuition',
  'stipend',
  'accommodation',
  'insurance',
])
const DEADLINE_FILTERS = new Set([
  'future',
  'next-30-days',
  'next-90-days',
  'announced',
  'not-announced',
  'closed',
])
const SORT_ORDERS = new Set([
  'default',
  'name',
  'deadline',
  'stipend-desc',
])

export type ScholarshipCatalogSearchParams = Record<string, string | string[] | undefined>
export type ScholarshipCatalogFilters = {
  query: string
  institution: string
  degree: string
  funding: string
  deadline: string
  sort: string
  page: number
  cursor: string
  cursorHistory: string[]
  nextCursor?: string
}

export type ScholarshipCatalogOption = {
  value: string
  name: LocalizedText
}

export type ScholarshipCatalogCycle = {
  id: string
  scholarshipId: string
  academicYear: string | null
  opensOn: string | null
  closesOn: string | null
  deadline: string | null
  deadlineState: 'future' | 'closed' | 'not-announced'
  daysRemaining: number | null
  legacy: boolean
}

export type ScholarshipCatalogItem = {
  scholarship: Scholarship
  universities: University[]
  programs: Program[]
  currentCycle: ScholarshipCatalogCycle
}

export type ScholarshipCatalogResult = {
  items: ScholarshipCatalogItem[]
  filters: ScholarshipCatalogFilters
  total: number
  totalExact: boolean
  page: number
  pageCount: number
  pageSize: number
  universityOptions: ScholarshipCatalogOption[]
}

function first(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function bounded(value: string | string[] | undefined, maxLength = 160): string {
  return first(value).trim().slice(0, maxLength)
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

export function parseScholarshipCatalogFilters(
  params: ScholarshipCatalogSearchParams,
): ScholarshipCatalogFilters {
  const requestedPage = Number.parseInt(first(params.page), 10)

  return {
    query: bounded(params.q),
    institution: bounded(params.institution),
    degree: allowed(bounded(params.degree), DEGREE_LEVELS),
    funding: allowed(bounded(params.funding), FUNDING_FILTERS),
    deadline: allowed(bounded(params.deadline), DEADLINE_FILTERS),
    sort: allowed(bounded(params.sort), SORT_ORDERS) || 'default',
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1,
    cursor: cursorValue(params.cursor),
    cursorHistory: cursorHistory(params.cursorHistory),
  }
}

function searchable(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(searchable).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(searchable).join(' ')
  return ''
}

function includesQuery(values: unknown[], query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || searchable(values).toLocaleLowerCase().includes(normalized)
}

function utcDateValue(date: string): number | null {
  const value = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isNaN(value) ? null : value
}

function addDays(date: string, days: number): string {
  const value = utcDateValue(date)
  if (value === null) return date
  return new Date(value + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Compatibility cycle for the legacy scholarship shape. It deliberately does
 * not infer an opening date or academic year that the source data never stated.
 */
export function selectScholarshipCurrentCycle(
  scholarship: Scholarship,
  today: string,
): ScholarshipCatalogCycle {
  const deadline = scholarship.deadline
  const todayValue = utcDateValue(today)
  const deadlineValue = deadline ? utcDateValue(deadline) : null
  const daysRemaining = todayValue === null || deadlineValue === null
    ? null
    : Math.ceil((deadlineValue - todayValue) / 86_400_000)

  return {
    id: `legacy:${scholarship.id}`,
    scholarshipId: scholarship.id,
    academicYear: null,
    opensOn: null,
    closesOn: deadline,
    deadline,
    deadlineState: deadline === null
      ? 'not-announced'
      : deadline < today
        ? 'closed'
        : 'future',
    daysRemaining,
    legacy: true,
  }
}

function matchesFunding(scholarship: Scholarship, expected: string): boolean {
  if (!expected) return true
  if (expected === 'full-tuition') return scholarship.coverage.tuition === 'full'
  if (expected === 'partial-tuition') return scholarship.coverage.tuition === 'partial'
  if (expected === 'stipend') return (scholarship.coverage.stipendCnyPerMonth || 0) > 0
  if (expected === 'accommodation') {
    return scholarship.coverage.accommodation === 'full'
      || scholarship.coverage.accommodation === 'partial'
  }
  return scholarship.coverage.insurance === true
}

function matchesDeadline(
  cycle: ScholarshipCatalogCycle,
  expected: string,
  today: string,
): boolean {
  if (!expected) return true
  if (expected === 'not-announced') return cycle.deadline === null
  if (expected === 'announced') return cycle.deadline !== null
  if (expected === 'closed') return cycle.deadlineState === 'closed'
  if (cycle.deadline === null || cycle.deadline < today) return false
  if (expected === 'future') return true
  const cutoff = addDays(today, expected === 'next-30-days' ? 30 : 90)
  return cycle.deadline <= cutoff
}

function localizedSortValue(value: LocalizedText): string {
  return value.en || value.zh || Object.values(value).find(Boolean) || ''
}

function deadlineSortKey(item: ScholarshipCatalogItem, today: string): string {
  const deadline = item.currentCycle.deadline
  if (deadline && deadline >= today) return `0:${deadline}`
  if (deadline) return `1:${deadline}`
  return '2:9999-12-31'
}

function sortEntries(
  entries: ScholarshipCatalogItem[],
  sort: string,
  today: string,
): ScholarshipCatalogItem[] {
  if (sort === 'default') return entries
  return entries.sort((left, right) => {
    let order = 0
    if (sort === 'name') {
      order = localizedSortValue(left.scholarship.name)
        .localeCompare(localizedSortValue(right.scholarship.name), 'en')
    } else if (sort === 'deadline') {
      order = deadlineSortKey(left, today).localeCompare(deadlineSortKey(right, today))
    } else {
      order = (right.scholarship.coverage.stipendCnyPerMonth || -1)
        - (left.scholarship.coverage.stipendCnyPerMonth || -1)
    }
    return order || left.scholarship.slug.localeCompare(right.scholarship.slug, 'en')
  })
}

function catalogOptions(data: DataBundle): ScholarshipCatalogOption[] {
  const universityIds = new Set(data.scholarships.flatMap((item) => item.universityIds))
  return data.universities
    .filter((university) => universityIds.has(university.id))
    .map(({ slug, name }) => ({ value: slug, name }))
}

/**
 * Server-side scholarship query shaped to map directly to the future D1 list
 * endpoint. Only this bounded page is handed to the render component.
 */
export function queryScholarshipCatalog(
  data: DataBundle,
  filters: ScholarshipCatalogFilters,
  today: string,
  pageSize = SCHOLARSHIP_CATALOG_PAGE_SIZE,
): ScholarshipCatalogResult {
  const universitiesById = new Map(data.universities.map((item) => [item.id, item]))
  const programsById = new Map(data.programs.map((item) => [item.id, item]))

  const matching = data.scholarships.flatMap((scholarship): ScholarshipCatalogItem[] => {
    const universities = scholarship.universityIds.flatMap((id) => {
      const university = universitiesById.get(id)
      return university ? [university] : []
    })
    const programs = scholarship.programIds.flatMap((id) => {
      const program = programsById.get(id)
      return program ? [program] : []
    })
    const currentCycle = selectScholarshipCurrentCycle(scholarship, today)

    const matches = includesQuery([
      scholarship.name,
      scholarship.summary,
      scholarship.providerType,
      universities.map((item) => item.name),
      programs.map((item) => item.name),
    ], filters.query)
      && (!filters.institution || universities.some((item) => (
        item.slug === filters.institution || item.id === filters.institution
      )))
      && (!filters.degree || programs.some((item) => item.degreeLevel === filters.degree))
      && matchesFunding(scholarship, filters.funding)
      && matchesDeadline(currentCycle, filters.deadline, today)

    return matches ? [{ scholarship, universities, programs, currentCycle }] : []
  })

  sortEntries(matching, filters.sort, today)
  const normalizedPageSize = Math.min(100, Math.max(1, pageSize))
  const pageCount = Math.ceil(matching.length / normalizedPageSize)
  const page = pageCount === 0 ? 1 : Math.min(filters.page, pageCount)
  const offset = (page - 1) * normalizedPageSize

  return {
    items: matching.slice(offset, offset + normalizedPageSize),
    filters: { ...filters, page },
    total: matching.length,
    totalExact: true,
    page,
    pageCount,
    pageSize: normalizedPageSize,
    universityOptions: catalogOptions(data),
  }
}

function repositoryScholarshipQuery(
  filters: ScholarshipCatalogFilters,
  today: string,
  cursor: string | undefined,
): CatalogScholarshipListQuery {
  return {
    q: filters.query || undefined,
    institution: filters.institution || undefined,
    degree: filters.degree || undefined,
    funding: filters.funding || undefined,
    deadline: filters.deadline || undefined,
    sort: filters.sort === 'default' ? undefined : filters.sort,
    cursor,
    limit: SCHOLARSHIP_CATALOG_PAGE_SIZE,
    today,
  }
}

function repositoryScholarshipResult(
  pageResult: Awaited<ReturnType<CatalogRepository['listScholarships']>>,
  filters: ScholarshipCatalogFilters,
  page: number,
  cursor: string | undefined,
  history: string[],
): ScholarshipCatalogResult {
  const lowerBound = (page - 1) * SCHOLARSHIP_CATALOG_PAGE_SIZE
    + pageResult.items.length
    + (pageResult.nextCursor ? 1 : 0)
  const total = pageResult.total ?? lowerBound
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
    pageCount: pageResult.total === null
      ? page + (pageResult.nextCursor ? 1 : 0)
      : Math.ceil(pageResult.total / SCHOLARSHIP_CATALOG_PAGE_SIZE),
    pageSize: SCHOLARSHIP_CATALOG_PAGE_SIZE,
    universityOptions: pageResult.facets.universities,
  }
}

export async function queryScholarshipCatalogRepository(
  repository: CatalogRepository,
  filters: ScholarshipCatalogFilters,
  today: string,
): Promise<ScholarshipCatalogResult> {
  let cursor = filters.cursor || undefined
  const history = [...filters.cursorHistory]
  let page = cursor ? filters.page : 1
  while (!filters.cursor && page < filters.page) {
    const preceding = await repository.listScholarships(
      repositoryScholarshipQuery(filters, today, cursor),
    )
    if (!preceding.nextCursor) {
      return repositoryScholarshipResult(preceding, filters, page, cursor, history)
    }
    history.push(cursor ?? '~')
    cursor = preceding.nextCursor
    page += 1
  }
  const result = await repository.listScholarships(
    repositoryScholarshipQuery(filters, today, cursor),
  )
  return repositoryScholarshipResult(result, filters, page, cursor, history)
}

export function scholarshipCatalogHref(
  locale: string,
  filters: ScholarshipCatalogFilters,
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
    ['institution', filters.institution],
    ['degree', filters.degree],
    ['funding', filters.funding],
    ['deadline', filters.deadline],
    ['sort', filters.sort === 'default' ? '' : filters.sort],
  ]
  for (const [key, value] of values) if (value) params.set(key, value)
  if (targetCursor) params.set('cursor', targetCursor)
  if (targetHistory.length > 0) params.set('cursorHistory', targetHistory.join(','))
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return `/${locale}/scholarships${query ? `?${query}` : ''}`
}
