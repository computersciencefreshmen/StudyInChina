import 'server-only'
import { adminTelemetrySchema, ADMIN_TELEMETRY_MAX_BYTES, type AdminTelemetry } from './telemetry-contract'
import { executorCommandSchema } from './executor-contract'
import type { ExecutorCommand } from './types'

type Environment = Record<string, string | undefined>
export const REMOTE_EXECUTOR_FRESH_MS = 30_000
export function remoteExecutorConfiguration(environment: Environment = process.env) {
  const token = environment.ADMIN_TELEMETRY_TOKEN
  try {
    const telemetry = new URL(environment.ADMIN_TELEMETRY_URL || '')
    if (!token || token.length < 32 || telemetry.protocol !== 'https:' || telemetry.username || telemetry.password || telemetry.search || telemetry.hash || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(telemetry.hostname) || telemetry.pathname !== '/internal/v1/admin-telemetry') return null
    return { telemetryUrl: telemetry.toString(), commandUrl: new URL('/internal/v1/admin-executor', telemetry).toString(), token, controlEnabled: environment.ADMIN_REMOTE_CONTROL_ENABLED === 'true' }
  } catch { return null }
}
async function boundedResponse(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > maximumBytes) throw new Error('remote_executor_unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximumBytes) { await reader.cancel(); throw new Error('remote_executor_unavailable') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
let cache: { url: string; token: string; until: number; pending: Promise<AdminTelemetry | null> } | null = null
export async function readRemoteTelemetry(environment: Environment = process.env): Promise<AdminTelemetry | null> {
  const config = remoteExecutorConfiguration(environment)
  if (!config) return null
  if (cache?.url === config.telemetryUrl && cache.token === config.token && cache.until > Date.now()) return cache.pending
  const pending = (async () => {
    try {
      const response = await fetch(config.telemetryUrl, { headers: { Authorization: `Bearer ${config.token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return null
      return adminTelemetrySchema.parse(await boundedResponse(response, ADMIN_TELEMETRY_MAX_BYTES))
    } catch { return null }
  })()
  cache = { url: config.telemetryUrl, token: config.token, until: Date.now() + 5_000, pending }
  return pending
}
export function remoteExecutorConnected(telemetry: AdminTelemetry | null, now = Date.now()): boolean {
  const automation = telemetry?.automation
  const age = now - Date.parse(automation?.observedAt || '')
  const transportAge = now - Date.parse(telemetry?.observedAt || '')
  return Boolean(automation?.connected && Number.isFinite(age) && age >= -5_000 && age <= REMOTE_EXECUTOR_FRESH_MS &&
    Number.isFinite(transportAge) && transportAge >= -5_000 && transportAge <= REMOTE_EXECUTOR_FRESH_MS)
}
/** A live monitoring upload does not imply that the bridge consumes commands. */
export function remoteExecutorControllable(telemetry: AdminTelemetry | null, now = Date.now()): boolean {
  return remoteExecutorConnected(telemetry, now) && telemetry?.automation?.remotelyControllable === true
}
/** Called only after administrator authentication and same-origin checks. */
export async function submitRemoteExecutorCommand(command: ExecutorCommand): Promise<{ accepted: true; commandId: string }> {
  const safe = executorCommandSchema.parse(command)
  const config = remoteExecutorConfiguration()
  if (!config?.controlEnabled || !remoteExecutorControllable(await readRemoteTelemetry())) throw new Error('executor_unavailable')
  try {
    const response = await fetch(config.commandUrl, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(safe), redirect: 'error', signal: AbortSignal.timeout(8_000), cache: 'no-store' })
    if (!response.ok) throw new Error('executor_unavailable')
    const reply = await boundedResponse(response, 16 * 1_024) as { ok?: unknown; command?: { commandId?: unknown } }
    if (reply.ok !== true || reply.command?.commandId !== safe.commandId) throw new Error('executor_unavailable')
    return { accepted: true, commandId: safe.commandId }
  } catch { throw new Error('executor_unavailable') }
}
