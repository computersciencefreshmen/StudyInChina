import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { currentQuotaObservation, executorCommandSchema, executorStatusSchema, projectUsageLedger, EXECUTOR_RUN_ID } from '../../src/lib/admin/executor-contract'
import { createAdminTelemetry, type AdminTelemetry } from '../../src/lib/admin/telemetry-contract'
import type { ExecutorCommand, ExecutorStatus } from '../../src/lib/admin/types'
import { ADMIN_EXECUTOR_ID, executorQueueSchema, type ExecutorQueueEntry } from '../../workers/catalog-api/src/admin-executor'
import { acquireSupervisorLock, atomicSupervisorJson, probeNativeProcess } from './minimax-quota-supervisor'
import { buildUsageReport, seedHistoricalUsage, shanghaiUsageDay } from './minimax-usage-ledger'
import { DAILY_USEFUL_TOKEN_TARGET } from './minimax-workload-runner'
import { fetchQuota, getCcSwitchQuotaConfig, type QuotaState } from './minimax-quota'

const executeFile = promisify(execFile)
const DEFAULT_TELEMETRY_URL = 'https://studyinchina-catalog-api.13022037121.workers.dev/internal/v1/admin-telemetry'
const MAX_REMOTE_BYTES = 128 * 1_024
type Environment = Record<string, string | undefined>
export function windowsBridgeModulePath(environment: Environment = process.env) {
  return [join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), environment.PSModulePath].filter(Boolean).join(';')
}
export type BridgeConfiguration = { executorId: string; telemetryUrl: string; commandUrl: string; token: string }
export type BridgeDependencies = {
  request: (method: 'GET' | 'PUT' | 'PATCH', url: string, value?: unknown) => Promise<unknown>
  execute: (command: ExecutorCommand) => Promise<unknown>
  publish: () => Promise<void>
  attemptId?: () => string
  renewEveryMs?: number
}
export type BridgeIteration = { commandId: string | null; result: 'idle' | 'completed' | 'failed'; published: boolean }

/** Pin credentials to the configured HTTPS host; redirects never receive the bearer. */
export function validateBridgeTarget(value: string, allowedHost = new URL(DEFAULT_TELEMETRY_URL).hostname) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('invalid_bridge_target') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.hostname !== allowedHost || url.pathname !== '/internal/v1/admin-telemetry') throw new Error('invalid_bridge_target')
  return { telemetryUrl: url.href, commandUrl: new URL('/internal/v1/admin-executor', url).href }
}
export async function loadBridgeConfiguration(root = process.cwd(), environment: Environment = process.env): Promise<BridgeConfiguration> {
  const targets = validateBridgeTarget(environment.ADMIN_TELEMETRY_URL || DEFAULT_TELEMETRY_URL, environment.ADMIN_TELEMETRY_TOKEN_HOST || new URL(DEFAULT_TELEMETRY_URL).hostname)
  const executorId = environment.ADMIN_EXECUTOR_ID || ADMIN_EXECUTOR_ID
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(executorId)) throw new Error('invalid_executor_identity')
  let token = environment.ADMIN_TELEMETRY_TOKEN || ''
  if (!token) {
    if (process.platform !== 'win32') throw new Error('bridge_credential_unavailable')
    const file = join(resolve(root), '.tmp', 'admin-telemetry-secret.dpapi')
    try {
      if ((await stat(file)).size > 16 * 1_024) throw new Error('invalid_credential')
      const path = file.replaceAll("'", "''")
      const script = `$ErrorActionPreference='Stop'; $encrypted=Get-Content -Raw -LiteralPath '${path}'; [Net.NetworkCredential]::new('',(ConvertTo-SecureString $encrypted)).Password`
      const powershell = join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      // A Node process launched from PowerShell 7 may inherit only its module paths.
      // Windows PowerShell needs its own bundled Security module to decrypt DPAPI.
      const result = await executeFile(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1_024,
        env: { ...process.env, ...environment, PSModulePath: windowsBridgeModulePath(environment) } })
      token = result.stdout.trim()
    } catch { throw new Error('bridge_credential_unavailable') }
  }
  if (token.length < 32 || token.length > 4_096 || /[\r\n]/.test(token)) throw new Error('bridge_credential_unavailable')
  return { executorId, ...targets, token }
}
export function createBridgeRequest(configuration: BridgeConfiguration, transport: typeof fetch = fetch): BridgeDependencies['request'] {
  return async (method, url, value) => {
    if (url !== configuration.commandUrl && url !== configuration.telemetryUrl) throw new Error('invalid_bridge_target')
    const response = await transport(url, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${configuration.token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    })
    if (!response.ok) throw new Error('bridge_transport_unavailable')
    if (Number(response.headers.get('content-length')) > MAX_REMOTE_BYTES) throw new Error('bridge_response_invalid')
    if (!response.body) throw new Error('bridge_response_invalid')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > MAX_REMOTE_BYTES) { await reader.cancel(); throw new Error('bridge_response_invalid') }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('bridge_response_invalid') }
  }
}
function claimedEntry(value: unknown, commandId: string, executorId: string, attemptId: string): ExecutorQueueEntry {
  if (!value || typeof value !== 'object') throw new Error('bridge_claim_invalid')
  const response = value as { ok?: unknown; command?: unknown }
  const queue = executorQueueSchema.safeParse({ version: 1, observedAt: new Date().toISOString(), commands: [response.command] })
  if (response.ok !== true || !queue.success) throw new Error('bridge_claim_invalid')
  const command = queue.data.commands[0]
  if (command.commandId !== commandId || command.status !== 'claimed' || command.executorId !== executorId || command.attemptId !== attemptId) throw new Error('bridge_claim_invalid')
  return command
}

/** One claim invokes the local controller once. A lost acknowledgement never causes re-execution. */
export async function bridgeIteration(configuration: BridgeConfiguration, dependencies: BridgeDependencies): Promise<BridgeIteration> {
  const queue = executorQueueSchema.parse(await dependencies.request('GET', configuration.commandUrl))
  const pending = queue.commands.filter(command => command.status === 'pending' && Date.parse(command.expiresAt) > Date.now()).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0]
  if (!pending) { await dependencies.publish(); return { commandId: null, result: 'idle', published: true } }
  const attemptId = dependencies.attemptId?.() || randomUUID()
  const identity = { commandId: pending.commandId, executorId: configuration.executorId, attemptId }
  const claim = await dependencies.request('PATCH', configuration.commandUrl, { operation: 'claim', ...identity })
  const entry = claimedEntry(claim, pending.commandId, configuration.executorId, attemptId)
  const command = executorCommandSchema.parse({ commandId: entry.commandId, action: entry.action, ...(entry.options ? { options: entry.options } : {}) })
  let renewPending: Promise<unknown> | null = null
  let renewalFailed = false
  const timer = setInterval(() => {
    if (renewPending) return
    renewPending = dependencies.request('PATCH', configuration.commandUrl, { operation: 'renew', ...identity })
      .then(value => claimedEntry(value, command.commandId, configuration.executorId, attemptId))
      .catch(() => { renewalFailed = true }).finally(() => { renewPending = null })
  }, dependencies.renewEveryMs || 20_000)
  let result: 'completed' | 'failed' = 'completed'
  try {
    const outcome = await dependencies.execute(command)
    if (outcome && typeof outcome === 'object' && (outcome as { status?: unknown }).status === 'failed') result = 'failed'
  } catch { result = 'failed' } finally { clearInterval(timer); await renewPending }
  // A renewal failure may mean another observer has already classified the outcome unknown.
  const completion = { operation: 'complete', ...identity, result, ...(result === 'failed' ? { error: 'execution_failed' } : {}) }
  let acknowledged = false
  for (let attempt = 0; attempt < 3 && !acknowledged; attempt++) {
    try {
      const response = await dependencies.request('PATCH', configuration.commandUrl, completion) as { ok?: unknown; command?: unknown }
      const acknowledgement = executorQueueSchema.safeParse({ version: 1, observedAt: new Date().toISOString(), commands: [response?.command] })
      const entry = acknowledgement.success ? acknowledgement.data.commands[0] : null
      if (response?.ok !== true || !entry || entry.commandId !== command.commandId || entry.attemptId !== attemptId || entry.executorId !== configuration.executorId || entry.status !== result) throw new Error('bridge_acknowledgement_invalid')
      acknowledged = true
    } catch { /* Retry the acknowledgement only. */ }
  }
  await dependencies.publish()
  if (!acknowledged || renewalFailed) throw new Error('bridge_acknowledgement_unavailable')
  return { commandId: command.commandId, result, published: true }
}

/** Monitoring mode never fetches, claims, acknowledges, or executes control commands. */
export async function telemetryOnlyIteration(dependencies: Pick<BridgeDependencies, 'publish'>): Promise<BridgeIteration> {
  await dependencies.publish()
  return { commandId: null, result: 'idle', published: true }
}

export function projectBridgeQuota(value: unknown, now = Date.now()): ExecutorStatus['quota'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const quota = value as Partial<QuotaState>
  const parsed = executorStatusSchema.shape.quota.safeParse({ state: quota.state, checkedAt: quota.checkedAt,
    fiveHourRemainingPercent: quota.fiveHour?.remainingPercent ?? null, weeklyRemainingPercent: quota.weekly?.remainingPercent ?? null,
    resetAt: quota.fiveHour?.resetAt ?? null })
  return parsed.success ? currentQuotaObservation(parsed.data, now) : null
}
/** This query only reads official plan percentages; it cannot start a model call. */
export async function refreshBridgeQuota(root: string, query = async () => fetchQuota(getCcSwitchQuotaConfig())) {
  const quota = await query()
  if (!projectBridgeQuota(quota)) throw new Error('quota_refresh_invalid')
  await atomicSupervisorJson(join(root, '.tmp', 'minimax-verification', 'admin-quota.json'), quota)
  return quota
}

export async function refreshBridgeUsage(root: string) {
  const directory = join(root, '.official-harvest', 'minimax-verification')
  const runs = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && EXECUTOR_RUN_ID.test(entry.name))
  for (const run of runs) await seedHistoricalUsage(join(directory, run.name))
  const report = await buildUsageReport(root, DAILY_USEFUL_TOKEN_TARGET)
  await atomicSupervisorJson(join(root, '.tmp', 'minimax-verification', 'usage-ledger.json'), report)
  return report
}
export async function buildBridgeTelemetry(root: string, remotelyControllable = false): Promise<AdminTelemetry> {
  // The server-only projection requires the CLI's --conditions=react-server flag.
  const { readLocalVerificationRuns } = await import('../../src/lib/admin/snapshot')
  const { readExecutorStatus } = await import('./minimax-admin-control')
  const runs = await readLocalVerificationRuns(root)
  let ledger = null
  try { ledger = projectUsageLedger(JSON.parse(await readFile(join(root, '.tmp', 'minimax-verification', 'usage-ledger.json'), 'utf8')), shanghaiUsageDay(new Date().toISOString())) } catch { /* Missing ledger is explicit, never a made-up zero. */ }
  const automation: ExecutorStatus = await readExecutorStatus(root)
  automation.remotelyControllable = remotelyControllable
  try {
    const path = join(root, '.tmp', 'minimax-verification', 'admin-quota.json')
    if ((await stat(path)).size <= 64 * 1_024) automation.quota = projectBridgeQuota(JSON.parse(await readFile(path, 'utf8')))
  } catch { automation.quota = currentQuotaObservation(automation.quota) }
  return createAdminTelemetry(runs.slice(0, 100), runs.find(run => run.model)?.model || null, new Date().toISOString(), { ledger, automation })
}
/** Read-only uploads retain the legacy wire shape; upgraded readers default this missing capability to false. */
export function bridgeTelemetryPayload(telemetry: AdminTelemetry, telemetryOnly: boolean) {
  if (!telemetryOnly || !telemetry.automation) return telemetry
  const automation: ExecutorStatus = { ...telemetry.automation }
  delete automation.remotelyControllable
  return { ...telemetry, automation }
}
export async function runAdminExecutorBridge(root = process.cwd(), once = false, telemetryOnly = false) {
  root = resolve(root)
  const configuration = await loadBridgeConfiguration(root)
  process.env.ADMIN_LOCAL_VERIFICATION_ENABLED = 'true'
  // The inherited environment also affects the existing OS-identity/controller probes.
  if (process.platform === 'win32') process.env.PSModulePath = windowsBridgeModulePath()
  const processState = await probeNativeProcess(process.pid, root)
  if (!processState.inspected || !processState.fingerprint) throw new Error('bridge_process_identity_unavailable')
  const directory = join(root, '.tmp', 'minimax-verification')
  await mkdir(directory, { recursive: true })
  const owner = { schemaVersion: 1 as const, ownerPid: process.pid, fingerprint: processState.fingerprint, nonce: randomUUID(), runId: 'admin-executor', startedAt: new Date().toISOString() }
  const lock = await acquireSupervisorLock(join(directory, 'admin-executor.lock.json'), owner, pid => probeNativeProcess(pid, root))
  const request = createBridgeRequest(configuration)
  let stopped = false
  let lastUsageAt = 0
  let usageRefresh: Promise<unknown> | null = null
  let usageRefreshError: string | null = null
  let lastQuotaAt = 0
  let quotaRefresh: Promise<unknown> | null = null
  let quotaRefreshError: string | null = null
  let lastPublishedAt: string | null = null
  const stop = () => { stopped = true }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const dependencies: BridgeDependencies = {
    request,
    execute: async command => { const { executeExecutorCommand } = await import('./minimax-admin-control'); return executeExecutorCommand(command, root) },
    publish: async () => {
      const telemetry = await buildBridgeTelemetry(root, !telemetryOnly)
      await request('PUT', configuration.telemetryUrl, bridgeTelemetryPayload(telemetry, telemetryOnly))
      lastPublishedAt = new Date().toISOString()
    },
  }
  try {
    while (!stopped) {
      let lastError: string | null = usageRefreshError || quotaRefreshError
      let lastCommandId: string | null = null
      try {
        if (Date.now() - lastUsageAt >= 60_000 && !usageRefresh) {
          lastUsageAt = Date.now()
          // Ledger scans must not block the user's pause/resume control path.
          usageRefresh = refreshBridgeUsage(root).then(() => { usageRefreshError = null })
            .catch(() => { usageRefreshError = 'usage_refresh_unavailable' }).finally(() => { usageRefresh = null })
        }
        if (Date.now() - lastQuotaAt >= 60_000 && !quotaRefresh) {
          lastQuotaAt = Date.now()
          quotaRefresh = refreshBridgeQuota(root).then(() => { quotaRefreshError = null })
            .catch(() => { quotaRefreshError = 'quota_refresh_unavailable' }).finally(() => { quotaRefresh = null })
        }
        // A one-off upload must include completed refreshes, not the previous saved ledger.
        if (once) await Promise.all([usageRefresh, quotaRefresh])
        const result = telemetryOnly ? await telemetryOnlyIteration(dependencies) : await bridgeIteration(configuration, dependencies)
        lastCommandId = result.commandId
      } catch { lastError = 'bridge_cycle_unavailable' }
      await atomicSupervisorJson(join(directory, 'admin-executor-bridge-state.json'), { schemaVersion: 1, ownerPid: owner.ownerPid, fingerprint: owner.fingerprint,
        executorId: configuration.executorId, telemetryOnly, observedAt: new Date().toISOString(), lastPublishedAt, lastCommandId,
        lastError: lastError || usageRefreshError || quotaRefreshError })
      if (once) break
      // Short waits allow graceful bridge shutdown without touching an existing verifier.
      for (let tick = 0; tick < 10 && !stopped; tick++) await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
    }
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await Promise.all([usageRefresh, quotaRefresh]); await lock.release() }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.some(argument => !['--once', '--audit-config', '--telemetry-only'].includes(argument)) || new Set(args).size !== args.length) throw new Error('bridge_arguments_invalid')
  if (args.includes('--audit-config')) {
    const configuration = await loadBridgeConfiguration()
    console.log(JSON.stringify({ configured: true, executorId: configuration.executorId, telemetryHost: new URL(configuration.telemetryUrl).hostname, commandHost: new URL(configuration.commandUrl).hostname }))
    return
  }
  await runAdminExecutorBridge(process.cwd(), args.includes('--once'), args.includes('--telemetry-only'))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const safe = new Set(['invalid_bridge_target', 'invalid_executor_identity', 'bridge_credential_unavailable', 'bridge_process_identity_unavailable', 'bridge_arguments_invalid'])
    console.error(error instanceof Error && safe.has(error.message) ? error.message : 'admin_executor_bridge_unavailable')
    process.exitCode = 1
  })
}
