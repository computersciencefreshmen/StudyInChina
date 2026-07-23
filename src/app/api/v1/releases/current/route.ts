import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return handleCatalogRequest(async () => ok((await getCatalogApiService()).getCurrentRelease()))
}
