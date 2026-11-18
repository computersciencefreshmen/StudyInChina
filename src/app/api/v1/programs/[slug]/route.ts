import { getCatalogApiService } from '@/lib/catalog-api/runtime'
import { resolveUnifiedProgram } from '@/lib/unified-programs'
import { publicUnifiedProgram } from '@/lib/unified-program-public'
import { getTodayDate } from '@/lib/data/freshness'
import { getOfficialTitleTranslation, getProgramTranslations, isProgramTranslationLocale } from '@/lib/program-translations'
import { handleCatalogRequest, notFound, ok } from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleCatalogRequest(async () => {
    const { slug } = await context.params
    const params = new URL(request.url).searchParams
    if (params.get('view') === 'all') {
      const result = await resolveUnifiedProgram(slug, getTodayDate())
      if (!result) return notFound('Program')
      const locale = params.get('locale')
      let translated: Awaited<ReturnType<typeof getProgramTranslations>> = {}
      if (isProgramTranslationLocale(locale)) {
        if ('collected' in result.item) translated = await getProgramTranslations(result.item.collected, locale)
        else if (result.item.university) {
          const title = await getOfficialTitleTranslation(result.item.program, result.item.university, locale)
          if (title) translated.title = title
        }
      }
      return ok({ data: publicUnifiedProgram(result.item, true), meta: { canonicalSlug: result.canonical, revision: result.revision },
        ...(isProgramTranslationLocale(locale) ? { translations: { locale, fields: Object.fromEntries(Object.entries(translated || {}).map(([field, record]) => [field,
          { text: record.text, method: record.method, translatedAt: record.translatedAt }])) } } : {}) })
    }
    const result = (await getCatalogApiService()).getProgram(slug)
    return result ? ok(result) : notFound('Program')
  })
}
