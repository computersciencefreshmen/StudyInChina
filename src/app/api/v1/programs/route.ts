import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { queryUnifiedPrograms } from '@/lib/unified-programs'
import { publicUnifiedProgram } from '@/lib/unified-program-public'
import { parseProgramCatalogFilters } from '@/lib/program-catalog'
import { getTodayDate } from '@/lib/data/freshness'
import { handleCatalogRequest, integerParam, numberParam, ok, rankingParams, stringParam } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleCatalogRequest(async () => {
    const params = new URL(request.url).searchParams
    if (params.get('view') === 'all') {
      const result = await queryUnifiedPrograms(parseProgramCatalogFilters(Object.fromEntries(params)), getTodayDate())
      return ok({ data: result.items.map(item => publicUnifiedProgram(item)), meta: { total: result.total, page: result.page, pageCount: result.pageCount, pageSize: result.pageSize, revision: result.revision, sourceConditionsUnknown: result.sourceConditionsUnknown } })
    }
    const service = await getCatalogApiService()
    return ok(service.listPrograms({
      ...rankingParams(params),
      q: stringParam(params, 'q'),
      institution: stringParam(params, 'institution'),
      city: stringParam(params, 'city'),
      type: stringParam(params, 'type'),
      degree: stringParam(params, 'degree'),
      discipline: stringParam(params, 'discipline'),
      language: stringParam(params, 'language'),
      academicYear: stringParam(params, 'academicYear'),
      intake: stringParam(params, 'intake'),
      tuitionMin: numberParam(params, 'tuitionMin', { min: 0 }),
      tuitionMax: numberParam(params, 'tuitionMax', { min: 0 }),
      applicationState: stringParam(params, 'applicationState'),
      scholarship: stringParam(params, 'scholarship'),
      cursor: stringParam(params, 'cursor', { maxLength: 1024 }),
      limit: integerParam(params, 'limit', { min: 1, max: 100 }),
    }))
  })
}
