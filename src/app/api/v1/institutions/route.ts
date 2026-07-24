import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, integerParam, ok, stringParam } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleCatalogRequest(async () => {
    const params = new URL(request.url).searchParams
    const service = await getCatalogApiService()
    return ok(service.listInstitutions({
      q: stringParam(params, 'q'),
      city: stringParam(params, 'city'),
      region: stringParam(params, 'region'),
      discipline: stringParam(params, 'discipline'),
      cursor: stringParam(params, 'cursor', { maxLength: 1024 }),
      limit: integerParam(params, 'limit', { min: 1, max: 100 }),
    }))
  })
}
