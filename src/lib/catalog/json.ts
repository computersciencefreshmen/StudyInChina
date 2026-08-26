import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'
import { getTodayDate, isCurrentVerifiedRecord } from '@/lib/data/freshness'
import { classifyProgramField } from '@/lib/data/fields'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { CatalogApiService } from '@/lib/catalog-api/service'
import { selectPublishedData } from '@/lib/data/publication'
import { selectLatestTuitionReference } from '@/lib/data/admission'
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
import { deriveCatalogRelease, getCatalogRecordCounts } from './release'
import {
  CATALOG_LIST_DEFAULT_LIMIT,
  CATALOG_LIST_MAX_LIMIT,
  CatalogRepositoryError,
  type CatalogBundleLoader,
  type CatalogInstitutionListPage,
  type CatalogInstitutionListQuery,
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

function searchTokens(values: Array<string | undefined>): string[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []
}

function queryFingerprint(
  resource: 'institutions' | 'programs' | 'scholarships',
  query: CatalogInstitutionListQuery | CatalogProgramListQuery | CatalogScholarshipListQuery,
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
  resource: 'institutions' | 'programs' | 'scholarships',
  query: CatalogInstitutionListQuery | CatalogProgramListQuery | CatalogScholarshipListQuery,
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

  async comparePrograms(ids: string[]): Promise<unknown> {
    const uniqueIds = [...new Set(ids)]
    if (
      uniqueIds.length < 1
      || uniqueIds.length > 4
      || uniqueIds.some((id) => !/^[a-z0-9][a-z0-9:_-]{0,199}$/u.test(id))
    ) {
      throw new CatalogRepositoryError(
        'INVALID_COMPARE_IDS',
        'Program comparison requires between one and four valid program ids.',
      )
    }
    const today = getTodayDate()
    const rawBundle = await this.getBundle()
    const publicBundle = selectCatalogApiData(rawBundle, today)
    const release = deriveCatalogRelease(rawBundle)
    const publicCounts = getCatalogRecordCounts(publicBundle)
    return new CatalogApiService(publicBundle, {
      ...release,
      recordCounts: publicCounts,
      rawCounts: getCatalogRecordCounts(rawBundle),
      publicCounts,
    }, today).comparePrograms(uniqueIds)
  }

  async listInstitutions(
    query: CatalogInstitutionListQuery = {},
  ): Promise<CatalogInstitutionListPage> {
    const today = query.today ?? getTodayDate()
    const data = selectCatalogApiData(await this.getBundle(), today)
    const limit = listLimit(query.limit)
    const page = requestedPage('institutions', query)
    const requestedQuery = query.q?.trim() ?? ''
    const queryTerms = searchTokens([query.q])
    if (requestedQuery && (queryTerms.length === 0 || queryTerms.length > 20)) {
      throw new CatalogRepositoryError(
        'INVALID_SEARCH_QUERY',
        'Institution search must contain between 1 and 20 letter or number terms.',
      )
    }
    const cityById = new Map(data.cities.map((city) => [city.id, city]))
    const programsByUniversity = new Map<string, typeof data.programs>()
    const scholarshipsByUniversity = new Map<string, number>()

    for (const program of data.programs) {
      const related = programsByUniversity.get(program.universityId) ?? []
      related.push(program)
      programsByUniversity.set(program.universityId, related)
    }
    for (const scholarship of data.scholarships) {
      if (!isCurrentVerifiedRecord(scholarship, today)) continue
      for (const universityId of new Set(scholarship.universityIds)) {
        scholarshipsByUniversity.set(
          universityId,
          (scholarshipsByUniversity.get(universityId) ?? 0) + 1,
        )
      }
    }

    const items = data.universities.flatMap((institution) => {
      const safeInstitution = {
        ...institution,
        sourceIds: [...institution.sourceIds].sort(),
        summary: isCurrentVerifiedRecord(institution, today) ? institution.summary : null,
      }
      const city = cityById.get(institution.cityId) ?? null
      const relatedPrograms = programsByUniversity.get(institution.id) ?? []
      const disciplines = [...new Set(
        relatedPrograms
          .filter((program) => isCurrentVerifiedRecord(program, today))
          .map(classifyProgramField),
      )].sort()
      const nameTokens = searchTokens(Object.values(safeInstitution.name))
      if (
        queryTerms.some((term) => !nameTokens.some((token) => token.startsWith(term)))
        || (query.city && city?.id !== query.city && city?.slug !== query.city)
        || (query.region && (institution.region ?? city?.region) !== query.region)
        || (query.discipline && !disciplines.some((discipline) => discipline === query.discipline))
      ) return []

      return [{
        institution: safeInstitution,
        city: city ? {
          id: city.id,
          slug: city.slug,
          name: city.name,
          region: city.region,
        } : null,
        programCount: relatedPrograms.length,
        scholarshipCount: scholarshipsByUniversity.get(institution.id) ?? 0,
        disciplines,
      }]
    })
    items.sort((left, right) => {
      const sortComparison = query.sort === 'programs-desc'
          ? right.programCount - left.programCount
          : query.sort === 'scholarships-desc'
            ? right.scholarshipCount - left.scholarshipCount
            : 0
      return sortComparison
        || left.institution.slug.localeCompare(right.institution.slug)
        || left.institution.id.localeCompare(right.institution.id)
    })

    const pageCount = Math.max(1, Math.ceil(items.length / limit))
    if (page > pageCount) {
      throw new CatalogRepositoryError('INVALID_LIST_CURSOR', 'Catalog list cursor is outside the result set.')
    }
    const nextCursor = page < pageCount
      ? encodeJsonListCursor('institutions', queryFingerprint('institutions', query), page + 1)
      : null
    const cities = [...new Map(items.flatMap((item) => (
      item.city ? [[item.city.slug, { value: item.city.slug, name: item.city.name }] as const] : []
    ))).values()].sort((left, right) => left.value.localeCompare(right.value))

    return {
      items: items.slice((page - 1) * limit, page * limit),
      nextCursor,
      total: items.length,
      facets: { cities },
      release: deriveCatalogRelease(data),
    }
  }


  async listPrograms(query: CatalogProgramListQuery = {}): Promise<CatalogProgramListPage> {
    const today = query.today ?? getTodayDate()
    const rawData = await this.getBundle()
    const data = selectPublishedData(rawData, today)
    const officialSourceIds = new Set(
      rawData.sources.filter((source) => source.official).map((source) => source.id),
    )
    const officialTuitionReferenceCycles = rawData.admissionCycles.filter(
      (cycle) => cycle.sourceIds.some((sourceId) => officialSourceIds.has(sourceId)),
    )
    const currentScholarships = data.scholarships.filter((item) => item.status === 'verified')
    const requestedScholarships = query.scholarship === 'linked'
      ? currentScholarships
      : query.scholarship
        ? currentScholarships.filter((item) => (
            item.id === query.scholarship || item.slug === query.scholarship
          ))
        : []
    const filteredData = query.scholarship
      ? {
          ...data,
          programs: data.programs.filter((program) => requestedScholarships.some(
            (scholarship) => scholarshipAppliesToProgram(scholarship, program),
          )),
        }
      : data
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
        scholarship: query.scholarship,
        sort: query.sort,
      }),
      page,
    }
    const result = queryProgramCatalog(filteredData, filters, today, limit)
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
        latestTuitionReference: selectLatestTuitionReference(
          officialTuitionReferenceCycles,
          program.id,
        ) ?? null,
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
