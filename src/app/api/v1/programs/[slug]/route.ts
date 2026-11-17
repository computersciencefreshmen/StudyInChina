import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { resolveUnifiedProgram } from '@/lib/unified-programs'
import { publicUnifiedProgram } from '@/lib/unified-program-public'
import { getTodayDate } from '@/lib/data/freshness'
import { handleCatalogRequest, notFound, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleCatalogRequest(async () => {
    const { slug } = await context.params
    if (new URL(request.url).searchParams.get('view') === 'all') {
      const result = await resolveUnifiedProgram(slug, getTodayDate())
      return result ? ok({ data: publicUnifiedProgram(result.item, true), meta: { canonicalSlug: result.canonical } }) : notFound('Program')
    }
    const result = (await getCatalogApiService()).getProgram(slug)
    return result ? ok(result) : notFound('Program')
  })
}
