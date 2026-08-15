import { getCurrentCatalogRelease } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return handleCatalogRequest(async () => ok(await getCurrentCatalogRelease()))
}
