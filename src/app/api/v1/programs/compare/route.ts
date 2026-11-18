import { collectedDisplayName } from '@/lib/program-display-name'
import { isProgramTranslationLocale } from '@/lib/program-translations'
import { compareCatalogPrograms, getCatalogDirectoryService } from '@/lib/catalog-api/runtime'
import { resolveUnifiedProgram } from '@/lib/unified-programs'
import { publicThirdPartyProgram } from '@/lib/third-party-public'
import { getTodayDate } from '@/lib/data/freshness'
import {
  handleCatalogRequest,
  InvalidQueryError,
  ok,
  stringParam,
} from '@/lib/catalog-api/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROGRAM_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,199}$/u
const MAX_COMPARE_PROGRAMS = 4

function programIds(params: URLSearchParams): string[] {
  const raw = stringParam(params, 'ids', { maxLength: 804 })
  if (!raw) throw new InvalidQueryError('ids is required.')
  const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0 || ids.length > MAX_COMPARE_PROGRAMS) {
    throw new InvalidQueryError(
      `ids must contain between 1 and ${MAX_COMPARE_PROGRAMS} unique program ids.`,
    )
  }
  if (ids.some((id) => !PROGRAM_ID_PATTERN.test(id))) {
    throw new InvalidQueryError('ids contains an invalid program id.')
  }
  return ids
}

export function GET(request: Request) {
  return handleCatalogRequest(async () => {
    const params = new URL(request.url).searchParams
    const ids = programIds(params)
    const view = stringParam(params, 'view')
    if (view === 'all') {
      const service = await getCatalogDirectoryService()
      const envelope = service.comparePrograms(ids)
      const today = getTodayDate()
      const locale = params.get('locale')
      const collectedItems = [], aliases: Record<string, string> = {}, missingIds = []
      for (const id of envelope.data.missingIds) {
        const resolved = await resolveUnifiedProgram(id, today)
        if (!resolved) { missingIds.push(id); continue }
        if ('collected' in resolved.item) {
          collectedItems.push({ savedId: id, record: publicThirdPartyProgram(resolved.item.collected),
            ...(isProgramTranslationLocale(locale) ? { displayName: await collectedDisplayName(resolved.item.collected, locale) } : {}) })
          continue
        }
        const item = service.comparePrograms([resolved.item.program.id]).data.items[0]
        if (!item) { missingIds.push(id); continue }
        if (!envelope.data.items.some(existing => existing.program.id === item.program.id)) envelope.data.items.push(item)
        aliases[id] = item.program.id
      }
      return ok({ ...envelope, data: { items: envelope.data.items, aliases, collectedItems, missingIds } })
    }
    if (view && view !== 'directory') throw new InvalidQueryError('view is invalid.')
    if (view === 'directory') return ok((await getCatalogDirectoryService()).comparePrograms(ids))
    return ok(await compareCatalogPrograms(ids))
  })
}
