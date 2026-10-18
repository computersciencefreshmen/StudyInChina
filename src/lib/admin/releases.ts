import 'server-only'
import { releaseHistorySchema, rollbackReleaseSchema, rollbackReceiptSchema, type AdminReleaseHistory, type RollbackReleaseRequest } from './release-contract'
import { deploymentRollbackSchema, deploymentWriterCommandSchema, type DeploymentRollbackRequest } from './deployment-release-contract'
import { remoteExecutorConfiguration } from './remote-executor'
import { getCurrentCatalogRelease } from '@/lib/catalog-api/runtime'

export class AdminReleaseError extends Error {
  constructor(public code: string, public status = 503) { super(code) }
}
const publicErrors = new Set(['release_conflict', 'release_writer_busy', 'release_registry_stale', 'release_control_disabled', 'release_not_available', 'release_artifact_invalid', 'release_command_closed', 'release_receipt_conflict'])
function configuration() {
  const remote = remoteExecutorConfiguration()
  if (!remote) return null
  return { url: new URL('/internal/v1/admin-releases', remote.telemetryUrl).toString(), token: remote.token,
    enabled: process.env.ADMIN_RELEASE_CONTROL_ENABLED === 'true' }
}
async function remoteReleaseRequest(method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const config = configuration()
  if (!config || method === 'POST' && !config.enabled) throw new AdminReleaseError('release_control_disabled')
  const response = await fetch(config.url, { method, headers: { Authorization: `Bearer ${config.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
  const reader = response.body?.getReader()
  if (!reader || Number(response.headers.get('content-length')) > 256 * 1024) throw new AdminReleaseError('release_backend_unavailable')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 256 * 1024) { await reader.cancel(); throw new AdminReleaseError('release_backend_unavailable') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let result
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AdminReleaseError('release_backend_unavailable') }
  if (!response.ok) throw new AdminReleaseError(publicErrors.has(result?.error) ? result.error : 'release_backend_unavailable', response.status === 409 ? 409 : response.status === 400 ? 400 : 503)
  return result
}
export async function getAdminReleaseHistory(): Promise<AdminReleaseHistory> {
  const active = (await getCurrentCatalogRelease()).data
  const backend = active.catalogBackend
  let history: AdminReleaseHistory
  if (configuration()) history = releaseHistorySchema.parse(await remoteReleaseRequest('GET'))
  else history = { observedAt: new Date().toISOString(), catalog: { backend, currentId: active.id, revision: null,
    available: false, reason: 'release_backend_unavailable', versions: [] }, interface: { currentId: null,
    available: false, rollbackAvailable: false, reason: 'deployment_registry_unavailable', registrySha256: null,
    revision: null, alias: null, command: null, history: [], versions: [] }, audit: [] }
  // JSON/shadow pages contain data in the immutable Vercel deployment. A D1 pointer
  // switch cannot roll those pages back; the deployment writer restores both code and data.
  history.catalog.backend = backend
  if (backend !== 'd1') {
    history.catalog.currentId = active.id
    history.catalog.available = false
    history.catalog.reason = 'catalog_bundled_with_deployment'
  }
  if (!configuration()?.enabled) {
    history.catalog.available = false
    history.interface.rollbackAvailable = false
    history.interface.reason = 'release_control_disabled'
  }
  return history
}
export async function requestAdminRollback(input: RollbackReleaseRequest | DeploymentRollbackRequest) {
  const catalog = rollbackReleaseSchema.safeParse(input)
  const request = catalog.success ? catalog.data : deploymentRollbackSchema.parse(input)
  if (request.kind === 'catalog' && (process.env.CATALOG_BACKEND || 'json') !== 'd1') throw new AdminReleaseError('catalog_bundled_with_deployment', 409)
  const raw = await remoteReleaseRequest('POST', request) as { accepted?: unknown; receipt?: unknown; command?: unknown }
  if (raw.accepted !== true) throw new AdminReleaseError('release_backend_unavailable')
  return request.kind === 'catalog' ? { accepted: true as const, receipt: rollbackReceiptSchema.parse(raw.receipt) }
    : { accepted: true as const, command: deploymentWriterCommandSchema.parse(raw.command) }
}
