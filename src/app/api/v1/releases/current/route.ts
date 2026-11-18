import { getCurrentCatalogRelease, getDeployedSchoolCoverage } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleCatalogRequest(async () => ok(new URL(request.url).searchParams.get('view') === 'school-coverage'
    ? await getDeployedSchoolCoverage() : await getCurrentCatalogRelease()))
}
