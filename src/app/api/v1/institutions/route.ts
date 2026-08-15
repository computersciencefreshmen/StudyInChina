import {
  CatalogRepositoryError,
  getCatalogRepository,
  type CatalogInstitutionListItem,
  type CatalogInstitutionListPage,
  type CatalogInstitutionListQuery,
  type CatalogInstitutionListSort,
} from '@/lib/catalog'
import { InvalidQueryError, handleCatalogRequest, integerParam, ok, stringParam } from '@/lib/catalog-api/http'
import {
  AUTOMATED_COLLECTION_NOTICE,
  type ApiEnvelope,
  type FactStatus,
  type FieldMeta,
  type InstitutionRecord,
} from '@/lib/catalog-api/types'
import { deploymentShaFromEnvironment } from '@/lib/catalog-api/runtime'
import { getTodayDate } from '@/lib/data/freshness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INSTITUTION_SORTS: ReadonlySet<CatalogInstitutionListSort> = new Set([
  'default',
  'name',
  'programs-desc',
  'scholarships-desc',
])

function institutionSortParam(
  params: URLSearchParams,
): CatalogInstitutionListSort | undefined {
  const value = stringParam(params, 'sort')
  if (value === undefined) return undefined
  if (!INSTITUTION_SORTS.has(value as CatalogInstitutionListSort)) {
    throw new InvalidQueryError('sort is invalid.')
  }
  return value as CatalogInstitutionListSort
}

function institutionSearchParam(params: URLSearchParams): string | undefined {
  const value = stringParam(params, 'q')
  if (value === undefined) return undefined
  const terms = value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []
  if (terms.length === 0 || terms.length > 20) {
    throw new InvalidQueryError('Invalid search query.')
  }
  return terms.join(' ')
}

function factStatus(
  item: CatalogInstitutionListItem,
  value: unknown,
  today: string,
  staleSensitive = false,
): FactStatus {
  const institution = item.institution
  if (
    staleSensitive
    && (institution.status === 'stale' || institution.reviewAfter < today)
  ) return 'stale'
  return value === null || value === undefined || value === ''
    ? 'officially_not_announced'
    : 'known'
}

function fieldMeta(
  item: CatalogInstitutionListItem,
  value: unknown,
  today: string,
  staleSensitive = false,
): FieldMeta {
  const institution = item.institution
  return {
    status: factStatus(item, value, today, staleSensitive),
    officialUrl: institution.admissionsUrl ?? institution.officialUrl,
    sourceTitle: 'Official university website',
    checkedAt: institution.verifiedAt,
  }
}

function institutionRecord(
  item: CatalogInstitutionListItem,
  today: string,
): InstitutionRecord {
  const institution = item.institution
  const officialUrl = institution.admissionsUrl ?? institution.officialUrl
  const city = item.city
    ? {
        id: item.city.id,
        slug: item.city.slug,
        name: item.city.name,
        province: null,
        region: item.city.region,
      }
    : null

  return {
    ...institution,
    city,
    disciplines: item.disciplines,
    programCount: item.programCount,
    scholarshipCount: item.scholarshipCount,
    officialSources: [{
      url: officialUrl,
      title: 'Official university website',
      checkedAt: institution.verifiedAt,
    }],
    fieldMeta: {
      id: fieldMeta(item, institution.id, today),
      slug: fieldMeta(item, institution.slug, today),
      name: fieldMeta(item, institution.name, today),
      cityId: fieldMeta(item, institution.cityId, today),
      city: fieldMeta(item, city, today),
      region: fieldMeta(item, institution.region, today),
      officialUrl: fieldMeta(item, institution.officialUrl, today),
      admissionsUrl: fieldMeta(item, institution.admissionsUrl, today),
      summary: fieldMeta(item, institution.summary, today, true),
      featured: fieldMeta(item, institution.featured, today),
      disciplines: fieldMeta(item, item.disciplines, today),
      programCount: fieldMeta(item, item.programCount, today),
      scholarshipCount: fieldMeta(item, item.scholarshipCount, today),
    },
  }
}

function envelope(
  page: CatalogInstitutionListPage,
  today: string,
): ApiEnvelope<InstitutionRecord[]> {
  if (!page.release) {
    throw new CatalogRepositoryError(
      'CATALOG_RELEASE_UNAVAILABLE',
      'The current catalog release is unavailable.',
    )
  }
  return {
    data: page.items.map((item) => institutionRecord(item, today)),
    meta: {
      release: {
        ...page.release,
        catalogBackend: getCatalogRepository().mode,
        deploymentSha: deploymentShaFromEnvironment(),
      },
      notice: AUTOMATED_COLLECTION_NOTICE,
      pageSize: page.items.length,
      nextCursor: page.nextCursor,
      ...(page.total === null ? {} : { total: page.total }),
      facets: page.facets,
    },
  }
}

async function repositoryPage(query: CatalogInstitutionListQuery) {
  try {
    return await getCatalogRepository().listInstitutions(query)
  } catch (error) {
    if (error instanceof CatalogRepositoryError) {
      if (error.code === 'INVALID_SEARCH_QUERY') {
        throw new InvalidQueryError('Invalid search query.')
      }
      if (error.code === 'INVALID_LIST_CURSOR') {
        throw new InvalidQueryError('Invalid cursor.')
      }
    }
    throw error
  }
}

export function GET(request: Request) {
  return handleCatalogRequest(async () => {
    const params = new URL(request.url).searchParams
    const today = getTodayDate()
    const page = await repositoryPage({
      q: institutionSearchParam(params),
      city: stringParam(params, 'city'),
      region: stringParam(params, 'region'),
      discipline: stringParam(params, 'discipline'),
      sort: institutionSortParam(params),
      cursor: stringParam(params, 'cursor', { maxLength: 1024 }),
      limit: integerParam(params, 'limit', { min: 1, max: 100 }),
      today,
    })
    return ok(envelope(page, today))
  })
}
