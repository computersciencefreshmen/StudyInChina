import { ADMIN_RESPONSE_HEADERS, isAdminMutationOrigin, readAdminJson, requestAdminSession } from '@/lib/admin/auth'
import { readLocalVerificationRuns } from '@/lib/admin/snapshot'
import { launchVerification, parseVerificationRequest, getVerificationCapabilities } from '@/lib/admin/verification'
import { remoteExecutorConfiguration, submitRemoteExecutorCommand } from '@/lib/admin/remote-executor'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!requestAdminSession(request).authenticated) return Response.json({ error: 'unauthorized' }, { status: 401, headers: ADMIN_RESPONSE_HEADERS })
  if (!isAdminMutationOrigin(request)) return Response.json({ error: 'forbidden' }, { status: 403, headers: ADMIN_RESPONSE_HEADERS })
  let options
  try { options = parseVerificationRequest(await readAdminJson(request)) }
  catch { return Response.json({ error: 'invalid_request' }, { status: 400, headers: ADMIN_RESPONSE_HEADERS }) }
  try {
    if (!getVerificationCapabilities().localMonitoring && remoteExecutorConfiguration()?.controlEnabled) {
      return Response.json(await submitRemoteExecutorCommand({ commandId: randomUUID(), action: 'start', options }), { status: 202, headers: ADMIN_RESPONSE_HEADERS })
    }
    const pid = await launchVerification(options, async () => (await readLocalVerificationRuns()).some(run => run.alive))
    return Response.json({ accepted: true, pid }, { status: 202, headers: ADMIN_RESPONSE_HEADERS })
  } catch (error) {
    const duplicate = error instanceof Error && error.message === 'verification_already_running'
    return Response.json({ error: duplicate ? 'verification_already_running' : 'executor_unavailable' }, { status: duplicate ? 409 : 503, headers: ADMIN_RESPONSE_HEADERS })
  }
}
