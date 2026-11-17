import { getThirdPartySummary, queryThirdPartyPrograms } from '@/lib/third-party-programs'
import { publicThirdPartyProgram } from '@/lib/third-party-public'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = (params.get('query') ?? params.get('q') ?? '').trim()
  const school = (params.get('school') || '').trim()
  const provider = (params.get('provider') || '').trim().toLowerCase()
  const rawView = params.get('view') || 'extracted'
  const rawPage = params.get('page') || '1'
  if (query.length > 200 || school.length > 150 || provider.length > 40
    || !['extracted', 'links'].includes(rawView) || !/^\d+$/.test(rawPage)
    || !Number.isSafeInteger(Number(rawPage)) || Number(rawPage) < 1) {
    return Response.json({ error: { code: 'invalid_request', message: 'Invalid directory filters or page.' } }, { status: 400, headers })
  }
  const result = queryThirdPartyPrograms({ query, school, provider, view: rawView as 'extracted' | 'links', page: Number(rawPage) })
  return Response.json({ ...result, items: result.items.slice(0, 40).map(program => publicThirdPartyProgram(program)), summary: getThirdPartySummary() }, { headers })
}
