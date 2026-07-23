import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, integerParam, numberParam, ok, stringParam } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleCatalogRequest(async () => {
    const params = new URL(request.url).searchParams
    const service = await getCatalogApiService()
    return ok(service.listPrograms({
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
