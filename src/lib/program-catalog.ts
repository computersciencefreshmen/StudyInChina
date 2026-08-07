import { getApplicationState, selectAdmissionCycle } from '@/lib/data/admission'
import { classifyProgramField, normalizeProgramField, programSearchKeywords } from '@/lib/data/fields'
import type {
  AdmissionCycle,
  DataBundle,
  DegreeLevel,
  LocalizedText,
  Program,
  University,
} from '@/lib/data/types'
import type { CatalogProgramListQuery, CatalogRepository } from '@/lib/catalog/types'

export const PROGRAM_CATALOG_PAGE_SIZE = 24

const DEGREE_LEVELS = new Set<DegreeLevel>([
  'bachelor',
  'master',
  'doctorate',
  'language',
  'foundation',
  'other',
])
const TEACHING_LANGUAGES = new Set(['Chinese', 'English', 'Bilingual'])
const APPLICATION_STATES = new Set(['open', 'upcoming', 'closed', 'not-announced'])
const INTAKES = new Set(['spring', 'autumn', 'other'])
const TUITION_FILTERS = new Set([
  'known',
  'unknown',
  'under-20000',
  '20000-40000',
  'over-40000',
])
const SORT_ORDERS = new Set([
  'default',
  'name',
  'deadline',
  'tuition-asc',
  'tuition-desc',
])

export type ProgramCatalogSearchParams = Record<string, string | string[] | undefined>
export type ProgramCatalogFilters = {
  query: string
  degree: string
  discipline: string
  language: string
  institution: string
  city: string
  intake: string
  tuition: string
  applicationState: string
  sort: string
  page: number
  cursor: string
  cursorHistory: string[]
  nextCursor?: string
}

export type ProgramCatalogOption = {
  value: string
  name: LocalizedText
}

export type ProgramCatalogItem = {
  program: Program
  university: University
  cycle: AdmissionCycle | undefined
}

export type ProgramCatalogResult = {
  items: ProgramCatalogItem[]
  filters: ProgramCatalogFilters
  total: number
  totalExact: boolean
  page: number
  pageCount: number
  pageSize: number
  universityOptions: ProgramCatalogOption[]
  cityOptions: ProgramCatalogOption[]
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

export function parseProgramCatalogFilters(
  params: ProgramCatalogSearchParams,
): ProgramCatalogFilters {
  const requestedDiscipline = bounded(params.discipline)
  const requestedPage = Number.parseInt(first(params.page), 10)
  const applicationState = bounded(params.applicationState)
    || bounded(params.dateStatus)

  return {
    query: bounded(params.q),
    degree: allowed(bounded(params.degree), DEGREE_LEVELS),
    discipline: requestedDiscipline
      ? normalizeProgramField(requestedDiscipline) ?? ''
      : '',
    language: allowed(bounded(params.language), TEACHING_LANGUAGES),
    institution: bounded(params.institution),
    city: bounded(params.city),
    intake: allowed(bounded(params.intake), INTAKES),
    tuition: allowed(bounded(params.tuition), TUITION_FILTERS),
    applicationState: allowed(applicationState, APPLICATION_STATES),
    sort: allowed(bounded(params.sort), SORT_ORDERS) || 'default',
    cursor: cursorValue(params.cursor),
    cursorHistory: cursorHistory(params.cursorHistory),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1,
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

function matchesApplicationState(
  cycle: AdmissionCycle | undefined,
  expected: string,
  today: string,
): boolean {
  if (!expected) return true
  const state = getApplicationState(cycle, today)
  return expected === 'open'
    ? state === 'open' || state === 'rolling'
    : state === expected
}

function matchesTuition(cycle: AdmissionCycle | undefined, expected: string): boolean {
  if (!expected) return true
  const tuition = cycle?.tuitionCny
  if (expected === 'known') return tuition !== null && tuition !== undefined
  if (expected === 'unknown') return tuition === null || tuition === undefined
  if (tuition === null || tuition === undefined) return false
  if (expected === 'under-20000') return tuition <= 20_000
  if (expected === '20000-40000') return tuition > 20_000 && tuition <= 40_000
  return tuition > 40_000
}

function localizedSortValue(value: LocalizedText): string {
  return value.en || value.zh || Object.values(value).find(Boolean) || ''
}

function compareNullableNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: 'asc' | 'desc',
): number {
  const leftKnown = left !== null && left !== undefined
  const rightKnown = right !== null && right !== undefined
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
  if (!leftKnown || !rightKnown || left === right) return 0
  return direction === 'asc' ? left - right : right - left
}

function sortEntries(
  entries: ProgramCatalogItem[],
  sort: string,
): ProgramCatalogItem[] {
  if (sort === 'default') return entries
  return entries.sort((left, right) => {
    if (sort === 'name') {
      return localizedSortValue(left.program.name)
        .localeCompare(localizedSortValue(right.program.name), 'en')
    }
    if (sort === 'deadline') {
      return (left.cycle?.closesOn || '9999-12-31')
        .localeCompare(right.cycle?.closesOn || '9999-12-31')
    }
    return compareNullableNumbers(
      left.cycle?.tuitionCny,
      right.cycle?.tuitionCny,
      sort === 'tuition-desc' ? 'desc' : 'asc',
    )
  })
}

function catalogOptions(data: DataBundle) {
  const universityIds = new Set(data.programs.map((program) => program.universityId))
  const universities = data.universities.filter((university) => universityIds.has(university.id))
  const cityIds = new Set(universities.map((university) => university.cityId))
  return {
    universityOptions: universities.map(({ slug, name }) => ({ value: slug, name })),
    cityOptions: data.cities
      .filter((city) => cityIds.has(city.id))
      .map(({ slug, name }) => ({ value: slug, name })),
  }
}

/**
 * Server-side catalogue query used by the web page today and designed to map
 * directly to the D1 list endpoint later. Only the returned page is handed to
 * the explorer component; the full catalogue never crosses a client boundary.
 */
export function queryProgramCatalog(
  data: DataBundle,
  filters: ProgramCatalogFilters,
  today: string,
  pageSize = PROGRAM_CATALOG_PAGE_SIZE,
): ProgramCatalogResult {
  const universitiesById = new Map(data.universities.map((item) => [item.id, item]))
  const citiesById = new Map(data.cities.map((item) => [item.id, item]))
  const cyclesByProgram = new Map<string, AdmissionCycle[]>()
  for (const cycle of data.admissionCycles) {
    const cycles = cyclesByProgram.get(cycle.programId) || []
    cycles.push(cycle)
    cyclesByProgram.set(cycle.programId, cycles)
  }

  const matching = data.programs.flatMap((program): ProgramCatalogItem[] => {
    const university = universitiesById.get(program.universityId)
    if (!university) return []
    const city = citiesById.get(university.cityId)
    const programCycles = cyclesByProgram.get(program.id) || []
    const cycle = selectAdmissionCycle(programCycles, program.id, today)

    const matches = includesQuery([
      program.name,
      program.discipline,
      programSearchKeywords(program),
      program.teachingLanguages,
      university.name,
      city?.name,
    ], filters.query)
      && (!filters.degree || program.degreeLevel === filters.degree)
      && (!filters.discipline || classifyProgramField(program) === filters.discipline)
      && (!filters.language || program.teachingLanguages.includes(filters.language))
      && (!filters.institution
        || university.slug === filters.institution
        || university.id === filters.institution)
      && (!filters.city || city?.slug === filters.city || city?.id === filters.city)
      && (!filters.intake || cycle?.intake === filters.intake)
      && matchesApplicationState(cycle, filters.applicationState, today)
      && matchesTuition(cycle, filters.tuition)

    return matches ? [{ program, university, cycle }] : []
  })

  sortEntries(matching, filters.sort)
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
    ...catalogOptions(data),
  }
}

function repositoryProgramQuery(
  filters: ProgramCatalogFilters,
  today: string,
  cursor: string | undefined,
): CatalogProgramListQuery {
  return {
    q: filters.query || undefined,
    degree: filters.degree || undefined,
    discipline: filters.discipline || undefined,
    language: filters.language || undefined,
    institution: filters.institution || undefined,
    city: filters.city || undefined,
    intake: filters.intake || undefined,
    tuition: filters.tuition || undefined,
    applicationState: filters.applicationState || undefined,
    sort: filters.sort === 'default' ? undefined : filters.sort,
    cursor,
    limit: PROGRAM_CATALOG_PAGE_SIZE,
    today,
  }
}

function repositoryProgramResult(
  pageResult: Awaited<ReturnType<CatalogRepository['listPrograms']>>,
  filters: ProgramCatalogFilters,
  page: number,
  cursor: string | undefined,
  history: string[],
): ProgramCatalogResult {
  const lowerBound = (page - 1) * PROGRAM_CATALOG_PAGE_SIZE
    + pageResult.items.length
    + (pageResult.nextCursor ? 1 : 0)
  const total = pageResult.total ?? lowerBound
  const pageCount = pageResult.total === null
    ? page + (pageResult.nextCursor ? 1 : 0)
    : Math.ceil(pageResult.total / PROGRAM_CATALOG_PAGE_SIZE)

  return {
    items: pageResult.items.map(({ program, university, currentCycle }) => ({
      program,
      university,
      cycle: currentCycle ?? undefined,
    })),
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
    pageSize: PROGRAM_CATALOG_PAGE_SIZE,
    universityOptions: pageResult.facets.universities,
    cityOptions: pageResult.facets.cities,
  }
}

/**
 * Repository-backed request path. Cursor links make normal navigation one
 * bounded backend request; old page-number URLs are replayed only for
 * compatibility and immediately emit cursor-based links.
 */
export async function queryProgramCatalogRepository(
  repository: CatalogRepository,
  filters: ProgramCatalogFilters,
  today: string,
): Promise<ProgramCatalogResult> {
  let cursor = filters.cursor || undefined
  const history = [...filters.cursorHistory]
  let page = cursor ? filters.page : 1

  while (!filters.cursor && page < filters.page) {
    const preceding = await repository.listPrograms(
      repositoryProgramQuery(filters, today, cursor),
    )
    if (!preceding.nextCursor) {
      return repositoryProgramResult(preceding, filters, page, cursor, history)
    }
    history.push(cursor ?? '~')
    cursor = preceding.nextCursor
    page += 1
  }

  const result = await repository.listPrograms(
    repositoryProgramQuery(filters, today, cursor),
  )
  return repositoryProgramResult(result, filters, page, cursor, history)
}

export function programCatalogHref(
  locale: string,
  filters: ProgramCatalogFilters,
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
    ['degree', filters.degree],
    ['discipline', filters.discipline],
    ['language', filters.language],
    ['institution', filters.institution],
    ['city', filters.city],
    ['intake', filters.intake],
    ['tuition', filters.tuition],
    ['applicationState', filters.applicationState],
    ['sort', filters.sort === 'default' ? '' : filters.sort],
  ]
  for (const [key, value] of values) if (value) params.set(key, value)
  if (targetCursor) params.set('cursor', targetCursor)
  if (targetHistory.length > 0) params.set('cursorHistory', targetHistory.join(','))
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return `/${locale}/programs${query ? `?${query}` : ''}`
}
