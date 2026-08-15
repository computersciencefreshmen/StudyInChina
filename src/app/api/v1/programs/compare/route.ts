import { compareCatalogPrograms } from '@/lib/catalog-api/runtime'
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
    const ids = programIds(new URL(request.url).searchParams)
    return ok(await compareCatalogPrograms(ids))
  })
}
