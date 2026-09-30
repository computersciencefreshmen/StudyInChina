import { ADMIN_RESPONSE_HEADERS, requestAdminSession } from '@/lib/admin/auth'
import { getAdminSnapshot } from '@/lib/admin/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!requestAdminSession(request).authenticated) return Response.json({ error: 'unauthorized' }, { status: 401, headers: ADMIN_RESPONSE_HEADERS })
  try { return Response.json(await getAdminSnapshot(), { headers: ADMIN_RESPONSE_HEADERS }) }
  catch { return Response.json({ error: 'status_unavailable' }, { status: 503, headers: ADMIN_RESPONSE_HEADERS }) }
}
