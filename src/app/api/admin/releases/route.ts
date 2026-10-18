import { ADMIN_RESPONSE_HEADERS, isAdminMutationOrigin, readAdminJson, requestAdminSession } from '@/lib/admin/auth'
import { deploymentRollbackSchema } from '@/lib/admin/deployment-release-contract'
import { rollbackReleaseSchema } from '@/lib/admin/release-contract'
import { AdminReleaseError, getAdminReleaseHistory, requestAdminRollback } from '@/lib/admin/releases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: ADMIN_RESPONSE_HEADERS })
export async function GET(request: Request) {
  if (!requestAdminSession(request).authenticated) return json({ error: 'unauthorized' }, 401)
  try { return json(await getAdminReleaseHistory()) }
  catch { return json({ error: 'release_backend_unavailable' }, 503) }
}
export async function POST(request: Request) {
  if (!requestAdminSession(request).authenticated) return json({ error: 'unauthorized' }, 401)
  if (!isAdminMutationOrigin(request)) return json({ error: 'forbidden' }, 403)
  let input
  try {
    const raw = await readAdminJson(request)
    const catalog = rollbackReleaseSchema.safeParse(raw)
    input = catalog.success ? catalog.data : deploymentRollbackSchema.parse(raw)
  } catch { return json({ error: 'invalid_request' }, 400) }
  try { return json(await requestAdminRollback(input), input.kind === 'deployment' ? 202 : 200) }
  catch (cause) { return cause instanceof AdminReleaseError ? json({ error: cause.code }, cause.status) : json({ error: 'release_backend_unavailable' }, 503) }
}
