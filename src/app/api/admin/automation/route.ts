import { ADMIN_RESPONSE_HEADERS, isAdminMutationOrigin, readAdminJson, requestAdminSession } from '@/lib/admin/auth'
import { executorCommandSchema } from '@/lib/admin/executor-contract'
import { getVerificationCapabilities } from '@/lib/admin/verification'
import { submitRemoteExecutorCommand } from '@/lib/admin/remote-executor'
import { getAdminSnapshot } from '@/lib/admin/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  if (!requestAdminSession(request).authenticated) return Response.json({ error: 'unauthorized' }, { status: 401, headers: ADMIN_RESPONSE_HEADERS })
  const snapshot = await getAdminSnapshot()
  return Response.json({ automation: snapshot.automation || null }, { headers: ADMIN_RESPONSE_HEADERS })
}
export async function POST(request: Request) {
  if (!requestAdminSession(request).authenticated) return Response.json({ error: 'unauthorized' }, { status: 401, headers: ADMIN_RESPONSE_HEADERS })
  if (!isAdminMutationOrigin(request)) return Response.json({ error: 'forbidden' }, { status: 403, headers: ADMIN_RESPONSE_HEADERS })
  let command
  try { command = executorCommandSchema.parse(await readAdminJson(request)) }
  catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers: ADMIN_RESPONSE_HEADERS }) }
  try {
    if (!getVerificationCapabilities().localMonitoring) return Response.json(await submitRemoteExecutorCommand(command), { status: 202, headers: ADMIN_RESPONSE_HEADERS })
    const { executeExecutorCommand } = await import('../../../../../scripts/ingestion/minimax-admin-control')
    const result = await executeExecutorCommand(command)
    if (result.status !== 'completed') return Response.json({ error: result.error === 'verification_already_running' ? result.error : 'executor_unavailable' }, { status: result.error === 'verification_already_running' ? 409 : 503, headers: ADMIN_RESPONSE_HEADERS })
    return Response.json({ accepted: true, commandId: command.commandId, completed: true }, { status: 202, headers: ADMIN_RESPONSE_HEADERS })
  } catch { return Response.json({ error: 'executor_unavailable' }, { status: 503, headers: ADMIN_RESPONSE_HEADERS }) }
}
