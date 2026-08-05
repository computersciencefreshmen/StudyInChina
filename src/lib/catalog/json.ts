import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'
import { getTodayDate } from '@/lib/data/freshness'
import { selectPublishedData } from '@/lib/data/publication'
import {
  parseProgramCatalogFilters,
  queryProgramCatalog,
} from '@/lib/program-catalog'
import {
  parseScholarshipCatalogFilters,
  queryScholarshipCatalog,
} from '@/lib/scholarship-catalog'
import {
  decodeJsonListCursor,
  encodeJsonListCursor,
} from './list-cursor'
import { deriveCatalogRelease } from './release'
import {
  CATALOG_LIST_DEFAULT_LIMIT,
  CATALOG_LIST_MAX_LIMIT,
  CatalogRepositoryError,
  type CatalogBundleLoader,
  type CatalogProgramListPage,
  type CatalogProgramListQuery,
  type CatalogRelease,
  type CatalogRepository,
  type CatalogScholarshipListPage,
  type CatalogScholarshipListQuery,
} from './types'

const JSON_FILES = {
  sources: 'sources',
  cities: 'cities',
  universities: 'universities',
  programs: 'programs',
  admissionCycles: 'admission-cycles',
  scholarships: 'scholarships',
} as const

export function readJsonCatalogBundle(dataDirectory = join(process.cwd(), 'content', 'data')): unknown {
  return Object.fromEntries(
    Object.entries(JSON_FILES).map(([collection, fileName]) => [
      collection,
      JSON.parse(readFileSync(join(dataDirectory, `${fileName}.json`), 'utf8')),
    ]),
  )
}

function listLimit(value: number | undefined): number {
  if (value === undefined) return CATALOG_LIST_DEFAULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CatalogRepositoryError(
      'INVALID_LIST_LIMIT',
      'Catalog list limit must be a positive integer.',
    )
  }
  return Math.min(value, CATALOG_LIST_MAX_LIMIT)
}

function queryFingerprint(
  resource: 'programs' | 'scholarships',
  query: CatalogProgramListQuery | CatalogScholarshipListQuery,
): string {
  const entries = Object.entries(query)
    .filter(([key, value]) => (
      key !== 'cursor'
      && key !== 'limit'
      && key !== 'today'
      && value !== undefined
    ))
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([resource, entries])
}

function requestedPage(
  resource: 'programs' | 'scholarships',
  query: CatalogProgramListQuery | CatalogScholarshipListQuery,
): number {
  return query.cursor
    ? decodeJsonListCursor(query.cursor, resource, queryFingerprint(resource, query))
    : 1
}
export class JsonCatalogRepository implements CatalogRepository {
  readonly mode = 'json' as const
  private bundlePromise: Promise<DataBundle> | undefined

  constructor(private readonly loader: CatalogBundleLoader = readJsonCatalogBundle) {}

  getBundle(): Promise<DataBundle> {
    if (!this.bundlePromise) {
      this.bundlePromise = Promise.resolve()
        .then(() => this.loader())
        .then((value) => bundleSchema.parse(value))
        .catch((error: unknown) => {
          this.bundlePromise = undefined
          throw error
        })
    }

    return this.bundlePromise
  }

  async getRelease(): Promise<CatalogRelease> {
    return deriveCatalogRelease(await this.getBundle())
  }
  async listPrograms(query: CatalogProgramListQuery = {}): Promise<CatalogProgramListPage> {
    const today = query.today ?? getTodayDate()
    const data = selectPublishedData(await this.getBundle(), today)
    const limit = listLimit(query.limit)
    const page = requestedPage('programs', query)
    const degree = query.degree
      ?? (query.type === 'language' || query.type === 'foundation' ? query.type : undefined)
    const filters = {
      ...parseProgramCatalogFilters({
        q: query.q,
        institution: query.institution,
        city: query.city,
        degree,
        discipline: query.discipline,
        language: query.language,
        intake: query.intake,
        tuition: query.tuition,
        applicationState: query.applicationState,
        sort: query.sort,
      }),
      page,
    }
    const result = queryProgramCatalog(data, filters, today, limit)
    if (page > 1 && result.page !== page) {
      throw new CatalogRepositoryError('INVALID_LIST_CURSOR', 'Catalog list cursor is outside the result set.')
    }
    const nextCursor = page < result.pageCount
      ? encodeJsonListCursor('programs', queryFingerprint('programs', query), page + 1)
      : null

    return {
      items: result.items.map(({ program, university, cycle }) => ({
        program,
        university,
        currentCycle: cycle ?? null,
      })),
      nextCursor,
      total: result.total,
      facets: {
        universities: result.universityOptions,
        cities: result.cityOptions,
      },
      release: deriveCatalogRelease(data),
    }
  }

  async listScholarships(
    query: CatalogScholarshipListQuery = {},
  ): Promise<CatalogScholarshipListPage> {
    const today = query.today ?? getTodayDate()
    const published = selectPublishedData(await this.getBundle(), today)
    const data = query.provider || query.program
      ? {
        ...published,
        scholarships: published.scholarships.filter((scholarship) => (
          (!query.provider || scholarship.providerType === query.provider)
          && (!query.program || scholarship.programIds.includes(query.program))
        )),
      }
      : published
    const limit = listLimit(query.limit)
    const page = requestedPage('scholarships', query)
    const filters = {
      ...parseScholarshipCatalogFilters({
        q: query.q,
        institution: query.institution,
        degree: query.degree,
        funding: query.funding,
        deadline: query.deadline,
        sort: query.sort,
      }),
      page,
    }
    const result = queryScholarshipCatalog(data, filters, today, limit)
    if (page > 1 && result.page !== page) {
      throw new CatalogRepositoryError('INVALID_LIST_CURSOR', 'Catalog list cursor is outside the result set.')
    }
    const nextCursor = page < result.pageCount
      ? encodeJsonListCursor('scholarships', queryFingerprint('scholarships', query), page + 1)
      : null

    return {
      items: result.items,
      nextCursor,
      total: result.total,
      facets: { universities: result.universityOptions },
      release: deriveCatalogRelease(published),
    }
  }

}
export function createJsonCatalogRepository(loader?: CatalogBundleLoader): CatalogRepository {
  return new JsonCatalogRepository(loader)
}
