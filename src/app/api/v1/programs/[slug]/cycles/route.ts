import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { handleCatalogRequest, notFound, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleCatalogRequest(async () => {
    const { slug } = await context.params
    const result = (await getCatalogApiService()).getProgramCycles(slug)
    return result ? ok(result) : notFound('Program')
  })
}
