import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { open, readFile, readdir, mkdir, rename, unlink, stat } from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fetchQuota, getCcSwitchQuotaConfig, type QuotaApiConfig, type QuotaState } from './minimax-quota'
import { authorizedCreditWindow, readPlanBillingSafety, type PlanBillingSafety } from './minimax-billing-safety'
import { assertMiniMaxRunning, readManualControl } from './minimax-manual-control'

const FILES = ['universities', 'programs', 'admission-cycles', 'scholarships', 'cities', 'sources'] as const
const RUN_ID = /^[a-f0-9]{16}(?:-[a-f0-9]{12})?$/
const HASH = /^[a-f0-9]{64}$/
const MAX_CHECKPOINT_AGE_MS = 168 * 3_600_000
const MAX_ACTIVE_SILENCE_MS = 30 * 60_000
const RESUME_GRACE_MS = 3 * 60_000
const executeFile = promisify(execFile)
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const asObject = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const validPid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(/* turbopackIgnore: true */ path, 'utf8'))
const optionalJson = async (path: string): Promise<unknown> => { try { return await readJson(path) } catch { return null } }

export type SupervisorAnchor = {
  root: string; runId: string; directory: string; inputSha256: string; modelConfigSha256: string;
  model: string; providerId: string; endpoint: string; promptVersion: string; sourceChars: number;
  totalRecords: number; taskIds: Set<string>
}
export type ProcessProbe = {
  alive: boolean; inspected: boolean; fingerprint: string | null; createdAt: string | null;
  verifier: boolean; supervisor: boolean
  recoveryVerifier?: boolean; workloadRunner?: boolean; adminVerifier?: boolean
}
export type RunReceipt = {
  pid: number; startedAt: string; inputSha256: string; modelConfigSha256: string; model: string;
  providerId: string; endpoint: string; quotaGuard: boolean; selectedRecords: number
}
export type CheckpointInventory = {
  completedRecords: number; modelErrorRecords: number; unconfirmedFields: number; expiredCompletedRecords: number
  recoveryEligibleRecords?: number
}
export type SupervisorAction = {
  kind: 'monitor' | 'wait' | 'launch' | 'needs-recovery' | 'stop'; reason: string; nextCheckAt: number | null
}
export type SupervisorObservation = {
  now: number; totalRecords: number; inventory: CheckpointInventory; active: 'verified' | 'unsafe' | 'none';
  currentInputMatches: boolean; providerMatches: boolean; verifierSupportsResume: boolean;
  fatal: string | null; cooldownUntil: number; noProgressFailures: number; quota: QuotaState | null
  lastActivityAt?: number | null
  resumeGraceUntil?: number
  minimumRemainingPercent?: 0 | 5
  allowExistingCredits?: boolean
  creditsWindowConfirmed?: boolean
}

/** Decisions contain no credential, raw error, purchase, or alternate-provider operation. */
export function decideSupervisorAction(observation: SupervisorObservation): SupervisorAction {
  const stop = (reason: string): SupervisorAction => ({ kind: 'stop', reason, nextCheckAt: null })
  const wait = (reason: string, until: number): SupervisorAction => ({ kind: 'wait', reason, nextCheckAt: Math.max(observation.now + 5_000, until) })
  if (!observation.currentInputMatches) return stop('catalog_snapshot_changed')
  if (!observation.providerMatches) return stop('minimax_provider_changed')
  if (observation.active === 'unsafe') return stop('process_identity_unconfirmed')
  const quota = observation.quota
  if (quota && /^quota_http_(401|403|400|404)$|^unsafe_quota_configuration$|^invalid_quota_timeout$/.test(quota.reason)) return stop('quota_authentication_or_configuration_error')
  if (observation.active === 'verified') {
    const stale = observation.lastActivityAt !== undefined && (observation.lastActivityAt === null || observation.now - observation.lastActivityAt >= MAX_ACTIVE_SILENCE_MS)
    if (stale && (observation.resumeGraceUntil || 0) > observation.now) return { kind: 'monitor', reason: 'guarded_verifier_resume_grace', nextCheckAt: Math.min(observation.resumeGraceUntil || 0, observation.now + 30_000) }
    if (stale && observation.cooldownUntil > observation.now) return { kind: 'monitor', reason: 'stalled_verifier_recovery_backoff', nextCheckAt: Math.min(observation.cooldownUntil, observation.now + 30_000) }
    // Keep inspecting the exact live child without killing or duplicating it.
    // Its request timeouts can exit it; a fresh quota check then governs resume.
    if (stale) return { kind: 'monitor', reason: 'stalled_guarded_verifier_attention_required', nextCheckAt: observation.now + 60_000 }
    return { kind: 'monitor', reason: 'guarded_verifier_running', nextCheckAt: observation.now + 30_000 }
  }
  if (/MiniMax HTTP (400|401|402|403|404)/.test(observation.fatal || '')) return stop('verifier_authentication_billing_or_configuration_error')
  if (observation.inventory.completedRecords + (observation.inventory.recoveryEligibleRecords || 0) === observation.totalRecords) return { kind: 'needs-recovery', reason: 'base_all_completed_no_repeat', nextCheckAt: null }
  if (observation.noProgressFailures >= 3) return stop('repeated_verifier_failure_without_progress')
  if (observation.inventory.expiredCompletedRecords) return { kind: 'needs-recovery', reason: 'expired_checkpoints_require_targeted_resume', nextCheckAt: null }
  if (!observation.verifierSupportsResume) return wait('waiting_for_safe_resume_flag', observation.now + 60_000)
  if (observation.cooldownUntil > observation.now) return wait('verifier_restart_cooldown', observation.cooldownUntil)
  if (!quota) return wait('quota_query_required', observation.now + 5_000)
  if (quota.state === 'exhausted' && !observation.allowExistingCredits) {
    const reset = Date.parse(quota.reason === 'weekly_quota_exhausted' ? quota.weekly.resetAt || '' : quota.fiveHour.resetAt || '')
    return wait(quota.reason, Number.isFinite(reset) && reset > observation.now ? reset + 5_000 : observation.now + 300_000)
  }
  const authorizedCredits = quota.state === 'exhausted' && observation.allowExistingCredits === true && observation.creditsWindowConfirmed === true
  if (!authorizedCredits && (quota.state !== 'available' || !quota.canRun || !(Number(quota.fiveHour.remainingPercent) > 0) || !(Number(quota.weekly.remainingPercent) > 0))) {
    return wait(quota.reason === 'quota_http_429' ? 'quota_rate_limited' : 'quota_unknown_no_model_calls', observation.now + (quota.reason === 'quota_http_429' ? 600_000 : 300_000))
  }
  if (!observation.allowExistingCredits && Number(quota.fiveHour.remainingPercent) <= (observation.minimumRemainingPercent ?? 5)) return wait('credit_fallback_confirmation_required', observation.now + 300_000)
  return { kind: 'launch', reason: authorizedCredits ? 'authorized_existing_credits_and_pending_base_tasks' : 'positive_plan_quota_and_pending_base_tasks', nextCheckAt: null }
}

/** A wall-clock gap is evidence of paused scheduling, not proof of a hung child. */
export function observeSupervisorClock(now: number, previousLoopAt: number, graceUntil: number, pollMs = 30_000) {
  const gapDetected = now < previousLoopAt || now - previousLoopAt > Math.max(90_000, pollMs * 4)
  return { gapDetected, lastLoopAt: now, resumeGraceUntil: gapDetected ? now + RESUME_GRACE_MS : graceUntil }
}

export function verifierRestartDelay(noProgressFailures: number, rateLimited = false) {
  if (noProgressFailures >= 3) return 3_600_000
  return rateLimited ? Math.min(3_600_000, 600_000 * 2 ** Math.max(0, noProgressFailures - 1)) : 60_000 * Math.max(1, noProgressFailures)
}

export function receiptMatchesAnchor(receipt: unknown, anchor: SupervisorAnchor): receipt is RunReceipt {
  const value = asObject(receipt)
  return Boolean(value && validPid(value.pid) && typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) &&
    value.inputSha256 === anchor.inputSha256 && value.modelConfigSha256 === anchor.modelConfigSha256 && value.model === anchor.model &&
    value.providerId === anchor.providerId && value.endpoint === anchor.endpoint && value.quotaGuard === true && value.selectedRecords === anchor.totalRecords)
}

/** Only a genuinely absent receipt can describe a prepared, never-started baseline. */
export async function readBaselineReceipt(anchor: SupervisorAnchor): Promise<{ kind: 'missing' | 'valid' | 'invalid'; receipt: RunReceipt | null }> {
  try {
    const raw = await readJson(join(anchor.directory, 'run-receipt.json'))
    return receiptMatchesAnchor(raw, anchor) ? { kind: 'valid', receipt: raw } : { kind: 'invalid', receipt: null }
  } catch (error) {
    return { kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid', receipt: null }
  }
}

type VerifierInventory = { inspected: boolean; activeVerifiers: number }

/** Read OS process details in memory; only the sanitized verifier count leaves this function. */
export async function inspectNativeVerifiers(root: string): Promise<VerifierInventory> {
  if (process.platform !== 'win32') return { inspected: false, activeVerifiers: 0 }
  try {
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = "$rows = @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | ForEach-Object { [pscustomobject]@{ processId=$_.ProcessId; commandLine=$_.CommandLine; executablePath=$_.ExecutablePath; createdAt=$_.CreationDate.ToUniversalTime().ToString('o') } }); ConvertTo-Json -InputObject $rows -Compress"
    const result = await executeFile(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 10_000, maxBuffer: 512 * 1024 })
    const rows: unknown = JSON.parse(result.stdout.trim())
    if (!Array.isArray(rows)) return { inspected: false, activeVerifiers: 0 }
    let activeVerifiers = 0
    for (const raw of rows) {
      const row = asObject(raw)
      if (!row || !validPid(row.processId) || typeof row.commandLine !== 'string') return { inspected: false, activeVerifiers }
      const probe = windowsProcessProbe(row.processId, row, root)
      if (probe.verifier || probe.recoveryVerifier || probe.adminVerifier) {
        if (!probe.inspected) return { inspected: false, activeVerifiers }
        // A relative verifier in another checkout is ambiguous, so block bootstrap.
        activeVerifiers++
      }
    }
    return { inspected: true, activeVerifiers }
  } catch { return { inspected: false, activeVerifiers: 0 } }
}

export async function preparedBaselineSafety(anchor: SupervisorAnchor, inventory = inspectNativeVerifiers): Promise<boolean> {
  if ((await readBaselineReceipt(anchor)).kind !== 'missing') return false
  for (const filename of ['status.json', 'progress.json']) {
    try { await stat(join(anchor.directory, filename)); return false } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false }
  }
  for (const subdirectory of ['records', 'responses', 'usage-receipts']) {
    try { if ((await readdir(join(anchor.directory, subdirectory))).length) return false } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false }
  }
  const processes = await inventory(anchor.root)
  return processes.inspected && processes.activeVerifiers === 0
}

/** Creation time makes an old receipt insufficient evidence when an OS reuses its PID. */
export function processMatchesReceipt(probe: ProcessProbe, receipt: RunReceipt, rememberedFingerprint?: string | null): boolean {
  if (!probe.alive || !probe.inspected || !probe.verifier || !probe.fingerprint || !probe.createdAt) return false
  if (rememberedFingerprint && rememberedFingerprint !== probe.fingerprint) return false
  const created = Date.parse(probe.createdAt)
  const started = Date.parse(receipt.startedAt)
  return Number.isFinite(created) && created <= started && started - created <= 120_000
}

export function buildVerifierLaunch(root: string) {
  return {
    executable: process.execPath,
    args: ['--import', 'tsx', join(root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts'), '--use-ccswitch', '--all', '--concurrency', '4', '--batch-size', '2', '--quota-guard', '--checkpoint-max-age-hours', '168'],
    options: { cwd: root, windowsHide: true },
  }
}

/** Parse the verifier's declarations rather than trusting a flag's presence alone. */
export function verifierSourceConfiguration(source: string) {
  const promptVersion = /const PROMPT_VERSION = ['"]([^'"]+)['"]/.exec(source)?.[1] || null
  const sourceChars = Number(/const SOURCE_CHARS = ([\d_]+)/.exec(source)?.[1]?.replaceAll('_', ''))
  return { promptVersion, sourceChars: Number.isSafeInteger(sourceChars) && sourceChars > 0 ? sourceChars : null, supportsResume: source.includes('--checkpoint-max-age-hours') && source.includes('--quota-guard') }
}

export async function atomicSupervisorJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await (await open(/* turbopackIgnore: true */ temporary, 'wx')).close()
  try {
    const file = await open(/* turbopackIgnore: true */ temporary, 'w')
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8') } finally { await file.close() }
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => undefined) }
}

type LockOwner = { schemaVersion: 1; ownerPid: number; fingerprint: string; nonce: string; runId: string; startedAt: string }
export type SupervisorLock = { owner: LockOwner; release: () => Promise<void> }
type ProbeProcess = (pid: number) => Promise<ProcessProbe>

/** Exclusive creation plus a separate reclaim mutex prevents two stale-lock recoveries racing. */
export async function acquireSupervisorLock(path: string, owner: LockOwner, probeProcess: ProbeProcess): Promise<SupervisorLock> {
  await mkdir(dirname(path), { recursive: true })
  const create = async () => {
    const file = await open(/* turbopackIgnore: true */ path, 'wx')
    try { await file.writeFile(`${JSON.stringify(owner)}\n`, 'utf8') } catch (error) { await file.close(); throw error }
    return { owner, release: async () => {
      await file.close()
      if (asObject(await optionalJson(path))?.nonce === owner.nonce) await unlink(path).catch(() => undefined)
    } }
  }
  try { return await create() } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('supervisor_lock_unavailable')
  }
  const recoveryPath = `${path}.reclaim`
  let recovery
  try { recovery = await open(/* turbopackIgnore: true */ recoveryPath, 'wx') } catch { throw new Error('supervisor_lock_recovery_in_progress') }
  try {
    const previous = asObject(await optionalJson(path))
    if (!previous || previous.schemaVersion !== 1 || !validPid(previous.ownerPid) || typeof previous.fingerprint !== 'string' || typeof previous.nonce !== 'string') throw new Error('supervisor_lock_invalid_requires_review')
    const processState = await probeProcess(previous.ownerPid)
    if (processState.alive && (!processState.inspected || processState.fingerprint === previous.fingerprint)) throw new Error('supervisor_already_running')
    // The mutex is held while inspecting and replacing; re-read to reject changed ownership.
    if (asObject(await optionalJson(path))?.nonce !== previous.nonce) throw new Error('supervisor_lock_owner_changed')
    await unlink(path)
    try { return await create() } catch { throw new Error('supervisor_lock_owner_changed') }
  } finally { await recovery.close(); await unlink(recoveryPath).catch(() => undefined) }
}

export async function loadAnchor(root: string, runId: string): Promise<SupervisorAnchor> {
  if (!RUN_ID.test(runId)) throw new Error('invalid_run_id')
  const directory = join(root, '.official-harvest', 'minimax-verification', runId)
  const manifest = asObject(await readJson(join(directory, 'manifest.json')))
  const data = asObject(await readJson(join(directory, 'input-snapshot.json')))
  const queue = await readJson(join(directory, 'queue.json'))
  if (!manifest || !data || typeof manifest.inputSha256 !== 'string' || !HASH.test(manifest.inputSha256) || typeof manifest.modelConfigSha256 !== 'string' || !HASH.test(manifest.modelConfigSha256) || typeof manifest.promptVersion !== 'string' || typeof manifest.maxSourceChars !== 'number' || typeof manifest.model !== 'string' || typeof manifest.providerId !== 'string' || typeof manifest.endpoint !== 'string' || !Array.isArray(queue) || !Number.isSafeInteger(manifest.totalRecords) || Number(manifest.totalRecords) < 1 || manifest.totalRecords !== manifest.selectedRecords || manifest.quotaGuard !== true || Object.keys(asObject(manifest.requestedModelOptions) || {}).length) throw new Error('base_run_manifest_invalid')
  const inputSha256 = sha(JSON.stringify({ data, promptVersion: manifest.promptVersion, sourceChars: manifest.maxSourceChars }))
  if (inputSha256 !== manifest.inputSha256 || !runId.startsWith(inputSha256.slice(0, 16))) throw new Error('base_snapshot_hash_mismatch')
  const taskIds = new Set(queue.map(task => asObject(task)?.taskId).filter((id): id is string => typeof id === 'string'))
  if (taskIds.size !== manifest.totalRecords || queue.length !== taskIds.size || FILES.some(file => !Array.isArray(data[file]))) throw new Error('base_queue_invalid')
  return { root, runId, directory, inputSha256, modelConfigSha256: manifest.modelConfigSha256, model: manifest.model, providerId: manifest.providerId, endpoint: manifest.endpoint, promptVersion: manifest.promptVersion, sourceChars: manifest.maxSourceChars, totalRecords: Number(manifest.totalRecords), taskIds }
}

export async function inspectCheckpoints(anchor: SupervisorAnchor, now: number): Promise<CheckpointInventory> {
  const inventory: CheckpointInventory = { completedRecords: 0, modelErrorRecords: 0, unconfirmedFields: 0, expiredCompletedRecords: 0, recoveryEligibleRecords: 0 }
  const names = await readdir(/* turbopackIgnore: true */ join(anchor.directory, 'records')).catch(() => [] as string[])
  const seen = new Set<string>()
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
    const record = asObject(await optionalJson(join(anchor.directory, 'records', name)))
    if (!record || typeof record.taskId !== 'string' || !anchor.taskIds.has(record.taskId) || seen.has(record.taskId) || name !== `${sha(record.taskId)}.json` || record.inputSha256 !== anchor.inputSha256 || record.modelConfigSha256 !== anchor.modelConfigSha256 || record.model !== anchor.model || !Array.isArray(record.issues) || !Array.isArray(record.verdicts)) continue
    seen.add(record.taskId)
    inventory.unconfirmedFields += record.verdicts.filter(value => asObject(value)?.status === 'unconfirmed').length
    if (record.issues.some(issue => typeof issue === 'string' && /^MiniMax |^Unexpected (?:token|end)|^Unterminated /i.test(issue))) {
      inventory.modelErrorRecords++
      // Stop replaying a full baseline once only model-output defects remain.
      // The recovery ledger still validates readable evidence and one-attempt
      // history before any single-record retry; this counter grants no call.
      const transient = record.issues.some(issue => typeof issue === 'string' && /^MiniMax HTTP 5\d\d$|^MiniMax response |^Unexpected (?:token|end)|^Unterminated /i.test(issue))
      const onlyKnownIssues = record.issues.every(issue => typeof issue === 'string' && (
        /^MiniMax HTTP 5\d\d$|^MiniMax response |^Unexpected (?:token|end)|^Unterminated /i.test(issue) ||
        (Array.isArray(record.sourceIds) && record.sourceIds.some(sourceId => typeof sourceId === 'string' && issue.startsWith(`${sourceId}: `)))
      ))
      const checked = typeof record.checkedAt === 'string' ? Date.parse(record.checkedAt) : NaN
      if (transient && onlyKnownIssues && Number.isFinite(checked) && checked <= now && now - checked < MAX_CHECKPOINT_AGE_MS) inventory.recoveryEligibleRecords = (inventory.recoveryEligibleRecords || 0) + 1
    }
    else {
      inventory.completedRecords++
      const checked = typeof record.checkedAt === 'string' ? Date.parse(record.checkedAt) : NaN
      if (!Number.isFinite(checked) || checked > now || now - checked >= MAX_CHECKPOINT_AGE_MS) inventory.expiredCompletedRecords++
    }
  }
  return inventory
}

export async function currentInputMatches(anchor: SupervisorAnchor) {
  try {
    const data = Object.fromEntries(await Promise.all(FILES.map(async file => [file, await readJson(join(anchor.root, 'content', 'data', `${file}.json`))])))
    return sha(JSON.stringify({ data, promptVersion: anchor.promptVersion, sourceChars: anchor.sourceChars })) === anchor.inputSha256
  } catch { return false }
}

function quotaConfigMatches(config: QuotaApiConfig, anchor: SupervisorAnchor) {
  let endpoint: URL
  try { endpoint = new URL(anchor.endpoint) } catch { return false }
  const quotaEndpoint = endpoint.hostname === 'api.minimax.io' ? 'https://www.minimax.io/v1/token_plan/remains' : 'https://www.minimax.cn/v1/token_plan/remains'
  const identity = { model: config.model, effort: config.model === 'MiniMax-M3.1-Flash-Preview' ? 'max' : null, thinking: config.model === 'MiniMax-M3' ? 'disabled' : 'adaptive', protocol: 'anthropic' }
  return config.providerId === anchor.providerId && config.model === anchor.model && config.endpoint === quotaEndpoint && sha(JSON.stringify(identity)) === anchor.modelConfigSha256 && ['api.minimax.io', 'api.minimax.cn', 'api.minimaxi.com'].includes(endpoint.hostname) && endpoint.pathname === '/anthropic/v1/messages'
}

/** Exact argument matching rejects another project's absolute path and flag lookalikes. */
export function windowsProcessProbe(pid: number, details: unknown, root: string, executable = process.execPath): ProcessProbe {
  const value = asObject(details)
  const createdAt = typeof value?.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : null
  const normalize = (path: string) => path.toLowerCase().replaceAll('\\', '/')
  const args = typeof value?.commandLine === 'string' ? Array.from(value.commandLine.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g), match => normalize(match[1] ?? match[2] ?? match[3])) : []
  const nodeMatches = typeof value?.executablePath === 'string' && normalize(value.executablePath) === normalize(executable)
  const verifierPath = 'scripts/ingestion/verify-catalog-minimax.ts'
  const supervisorPath = 'scripts/ingestion/minimax-quota-supervisor.ts'
  const runnerPath = 'scripts/ingestion/minimax-workload-runner.ts'
  // A relative entrypoint is adopted only after receipt hash/PID/creation-time checks
  // establish this frozen run. Children launched here always use an absolute path.
  const verifier = nodeMatches && (args.includes(normalize(join(root, verifierPath))) || args.includes(verifierPath) || args.includes(`./${verifierPath}`)) && ['--quota-guard', '--use-ccswitch', '--all'].every(flag => args.includes(flag))
  const supervisor = nodeMatches && args.includes(normalize(join(root, supervisorPath)))
  const recoveryVerifier = nodeMatches && args.includes(normalize(join(root, verifierPath))) && ['--quota-guard', '--use-ccswitch', '--task-ids-file', '--recovery-from'].every(flag => args.includes(flag))
  const workloadRunner = nodeMatches && args.includes(normalize(join(root, runnerPath)))
  const adminVerifier = nodeMatches && (args.includes(normalize(join(root, verifierPath))) || args.includes(verifierPath) || args.includes(`./${verifierPath}`))
  return { alive: true, inspected: Boolean(createdAt && typeof value?.executablePath === 'string' && typeof value?.commandLine === 'string'), fingerprint: createdAt ? `${pid}:${createdAt}` : null, createdAt, verifier, supervisor, recoveryVerifier, workloadRunner, adminVerifier }
}

async function latestReceiptTimestamp(directory: string, validate: (value: Record<string, unknown>) => boolean, now: number): Promise<number | null> {
  const names = (await readdir(/* turbopackIgnore: true */ directory).catch(() => [] as string[])).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
  const modified = await Promise.all(names.map(async name => ({ name, time: (await stat(/* turbopackIgnore: true */ join(directory, name)).catch(() => null))?.mtimeMs || 0 })))
  modified.sort((left, right) => right.time - left.time)
  // Only recent candidates need content inspection; timestamps alone do not prove
  // that a model response belongs to this model configuration.
  let latest: number | null = null
  for (const entry of modified.slice(0, 32)) {
    const value = asObject(await optionalJson(join(directory, entry.name)))
    const checked = typeof value?.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN
    if (value && validate(value) && Number.isFinite(checked) && checked <= now && (latest === null || checked > latest)) latest = checked
  }
  return latest
}

export async function inspectVerifierActivity(anchor: SupervisorAnchor, receipt: RunReceipt, status: unknown, now: number) {
  const value = asObject(status)
  const validStatus = value?.pid === receipt.pid && value.inputSha256 === anchor.inputSha256 && value.modelConfigSha256 === anchor.modelConfigSha256
  const statusTime = validStatus ? Date.parse(String(value.updatedAt || value.finishedAt || value.startedAt || '')) : NaN
  const [lastSourceReceiptAt, lastModelResponseAt] = await Promise.all([
    latestReceiptTimestamp(join(anchor.directory, 'sources'), source => typeof source.sourceId === 'string' && ['captured', 'unconfirmed'].includes(String(source.status)), now),
    latestReceiptTimestamp(join(anchor.directory, 'responses'), response => response.modelConfigSha256 === anchor.modelConfigSha256 && response.model === anchor.model && Array.isArray(asObject(response.output)?.results), now),
  ])
  const times = [Date.parse(receipt.startedAt), statusTime, lastSourceReceiptAt, lastModelResponseAt].filter((time): time is number => typeof time === 'number' && Number.isFinite(time) && time <= now)
  return { lastActivityAt: times.length ? Math.max(...times) : null, lastSourceReceiptAt, lastModelResponseAt }
}

/** OS command text stays in memory and is never persisted, printed, or used as shell input. */
export async function probeNativeProcess(pid: number, root: string): Promise<ProcessProbe> {
  const empty: ProcessProbe = { alive: false, inspected: false, fingerprint: null, createdAt: null, verifier: false, supervisor: false }
  try { process.kill(pid, 0) } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? empty : { ...empty, alive: true }
  }
  if (process.platform !== 'win32') return { ...empty, alive: true }
  try {
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { 'null' } else { [pscustomobject]@{ commandLine=$p.CommandLine; executablePath=$p.ExecutablePath; createdAt=$p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`
    const result = await executeFile(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 })
    const value = asObject(JSON.parse(result.stdout.trim()))
    if (!value) return empty
    return windowsProcessProbe(pid, value, root)
  } catch { return { ...empty, alive: true } }
}

export type SupervisorState = {
  schemaVersion: 1; supervisorPid: number; runId: string; inputSha256: string; modelConfigSha256: string;
  phase: SupervisorAction['kind'] | 'starting' | 'stopped'; reason: string; updatedAt: string; childPid: number | null;
  completedRecords: number; totalRecords: number; modelErrorRecords: number; unconfirmedFields: number;
  recoveryEligibleRecords?: number;
  nextCheckAt: string | null; launchCount: number; quota: QuotaState | null; balanceFallbackAllowed: boolean;
  stdout?: string; stderr?: string
  lastActivityAt?: string | null; lastSourceReceiptAt?: string | null; lastModelResponseAt?: string | null
  lastLoopAt?: string; resumeGraceUntil?: string; lastClockGapAt?: string | null; noProgressFailures?: number
  attentionRequired?: boolean
  billingSafety?: PlanBillingSafety
  fundingMode?: 'plan' | 'credits-authorized' | 'unknown'
}
export type SupervisorOptions = { root: string; runId: string; adoptPid?: number; pollMs?: number }

/** Read-only activation evidence: no lock/state writes, quota query, or child process. */
export async function inspectSupervisorReadiness(root: string, runId: string) {
  const anchor = await loadAnchor(resolve(root), runId)
  const receiptState = await readBaselineReceipt(anchor)
  const receipt = receiptState.receipt
  const prepared = receiptState.kind === 'missing' && await preparedBaselineSafety(anchor)
  const source = verifierSourceConfiguration(await readFile(/* turbopackIgnore: true */ join(anchor.root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts'), 'utf8'))
  const inputMatches = await currentInputMatches(anchor) && source.promptVersion === anchor.promptVersion && source.sourceChars === anchor.sourceChars
  let providerMatches = false
  try { providerMatches = quotaConfigMatches(getCcSwitchQuotaConfig(), anchor) } catch { /* Public readiness only; never expose credential errors. */ }
  const processState = receipt ? await probeNativeProcess(receipt.pid, anchor.root) : null
  const processVerified = Boolean(receipt && processState && processMatchesReceipt(processState, receipt))
  const activity = receipt ? await inspectVerifierActivity(anchor, receipt, await optionalJson(join(anchor.directory, 'status.json')), Date.now()) : null
  const inventory = await inspectCheckpoints(anchor, Date.now())
  const billingSafety = await readPlanBillingSafety(anchor.root)
  const ready = Boolean((receipt || prepared) && inputMatches && providerMatches && source.supportsResume && (!processState?.alive || processVerified))
  return { runId, ready, inputMatches, providerMatches, supportsResume: source.supportsResume, receiptMatches: Boolean(receipt), prepared, receiptState: receiptState.kind, processAlive: processState?.alive || false, processVerified, processId: receipt?.pid || null, totalRecords: anchor.totalRecords, ...inventory, lastActivityAt: activity?.lastActivityAt ? new Date(activity.lastActivityAt).toISOString() : null, lastSourceReceiptAt: activity?.lastSourceReceiptAt ? new Date(activity.lastSourceReceiptAt).toISOString() : null, lastModelResponseAt: activity?.lastModelResponseAt ? new Date(activity.lastModelResponseAt).toISOString() : null, balanceFallbackAllowed: billingSafety.allowExistingCredits, billingSafety }
}

/** Windows local supervisor: finite baseline tasks, no time-based expiry and no success re-audit loop. */
export async function runQuotaSupervisor(options: SupervisorOptions): Promise<void> {
  const root = resolve(options.root)
  const anchor = await loadAnchor(root, options.runId)
  const stateDirectory = join(root, '.tmp', 'minimax-verification')
  const statePath = join(stateDirectory, 'supervisor-state.json')
  const probe = (pid: number) => probeNativeProcess(pid, root)
  const ownProcess = await probe(process.pid)
  if (!ownProcess.inspected || !ownProcess.fingerprint) throw new Error('supervisor_os_identity_unavailable')
  const lock = await acquireSupervisorLock(join(stateDirectory, 'supervisor.lock.json'), { schemaVersion: 1, ownerPid: process.pid, fingerprint: ownProcess.fingerprint, nonce: randomUUID(), runId: anchor.runId, startedAt: new Date().toISOString() }, probe)
  let stopRequested = false
  const requestStop = () => { stopRequested = true }
  process.on('SIGINT', requestStop)
  process.on('SIGTERM', requestStop)
  const sleep = async (until: number) => { while (!stopRequested && Date.now() < until) await new Promise(done => setTimeout(done, Math.min(1_000, until - Date.now()))) }
  let activePid: number | null = options.adoptPid || null
  let fingerprint: string | null = null
  let launchingUntil = 0
  let launchCount = 0
  let inventory = await inspectCheckpoints(anchor, Date.now())
  let lastHandledExit = ''
  let lastLaunchCompleted = inventory.completedRecords
  let noProgressFailures = 0
  let cooldownUntil = 0
  let quota: QuotaState | null = null
  let nextQuotaCheck = 0
  let frozenConfig: QuotaApiConfig | null = null
  let logPaths: { stdout: string; stderr: string } | null = null
  let activity: Awaited<ReturnType<typeof inspectVerifierActivity>> | null = null
  let nextActivityCheck = 0
  let lastLoopAt = Date.now()
  let resumeGraceUntil = lastLoopAt + RESUME_GRACE_MS
  let lastClockGapAt: number | null = null
  let billingSafety = await readPlanBillingSafety(root)
  let fundingMode: SupervisorState['fundingMode'] = 'unknown'
  let state: SupervisorState | null = null
  const persist = async (action: SupervisorAction | { kind: 'starting' | 'stopped'; reason: string; nextCheckAt: number | null }) => {
    const date = (time: number | null | undefined) => typeof time === 'number' ? new Date(time).toISOString() : null
    state = { schemaVersion: 1, supervisorPid: process.pid, runId: anchor.runId, inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, phase: action.kind, reason: action.reason, updatedAt: new Date().toISOString(), childPid: activePid, completedRecords: inventory.completedRecords, totalRecords: anchor.totalRecords, modelErrorRecords: inventory.modelErrorRecords, recoveryEligibleRecords: inventory.recoveryEligibleRecords || 0, unconfirmedFields: inventory.unconfirmedFields, nextCheckAt: action.nextCheckAt ? new Date(action.nextCheckAt).toISOString() : null, launchCount, quota, balanceFallbackAllowed: billingSafety.allowExistingCredits, fundingMode, lastActivityAt: date(activity?.lastActivityAt), lastSourceReceiptAt: date(activity?.lastSourceReceiptAt), lastModelResponseAt: date(activity?.lastModelResponseAt), lastLoopAt: new Date(lastLoopAt).toISOString(), resumeGraceUntil: new Date(resumeGraceUntil).toISOString(), lastClockGapAt: date(lastClockGapAt), noProgressFailures, attentionRequired: action.reason === 'stalled_guarded_verifier_attention_required' || action.reason === 'credit_fallback_confirmation_required', billingSafety, ...(logPaths || {}) }
    await atomicSupervisorJson(statePath, state)
  }
  try {
    for (;;) {
      const now = Date.now()
      if (stopRequested) break
      if ((await readManualControl(root)).desiredState === 'paused') {
        await persist({ kind: 'wait', reason: 'human_pause_requested', nextCheckAt: now + 1_000 })
        await sleep(now + 1_000)
        continue
      }
      billingSafety = await readPlanBillingSafety(root)
      const clock = observeSupervisorClock(now, lastLoopAt, resumeGraceUntil, options.pollMs)
      lastLoopAt = clock.lastLoopAt
      resumeGraceUntil = clock.resumeGraceUntil
      if (clock.gapDetected) {
        lastClockGapAt = now
        activity = null
        nextActivityCheck = 0
        quota = null
        nextQuotaCheck = 0
      }
      let config: QuotaApiConfig
      try { config = getCcSwitchQuotaConfig() } catch { await persist({ kind: 'stop', reason: 'quota_configuration_unavailable', nextCheckAt: null }); return }
      const providerMatches = quotaConfigMatches(config, anchor) && (!frozenConfig || (config.providerId === frozenConfig.providerId && config.key === frozenConfig.key && config.endpoint === frozenConfig.endpoint && config.model === frozenConfig.model))
      frozenConfig ||= config
      const receiptState = await readBaselineReceipt(anchor)
      const receipt = receiptState.receipt
      if (receiptState.kind === 'invalid') { await persist({ kind: 'stop', reason: 'base_run_receipt_changed', nextCheckAt: null }); return }
      if (receiptState.kind === 'missing' && !activePid && !await preparedBaselineSafety(anchor)) { await persist({ kind: 'stop', reason: 'prepared_baseline_execution_unconfirmed', nextCheckAt: null }); return }
      const status = asObject(await optionalJson(join(anchor.directory, 'status.json')))
      if (!activePid && receipt) activePid = receipt.pid
      let active: SupervisorObservation['active'] = 'none'
      if (activePid) {
        const processState = await probe(activePid)
        if (processState.alive) {
          if (receipt?.pid === activePid && processMatchesReceipt(processState, receipt, fingerprint)) {
            active = 'verified'
            fingerprint = processState.fingerprint
            const count = Number(status?.completedRecords)
            if (status?.inputSha256 === anchor.inputSha256 && status?.pid === activePid && Number.isSafeInteger(count) && count >= 0 && count <= anchor.totalRecords) inventory.completedRecords = count
            if (nextActivityCheck <= now) {
              activity = await inspectVerifierActivity(anchor, receipt, status, now)
              nextActivityCheck = now + 60_000
            }
          } else if (launchingUntil > now) {
            await persist({ kind: 'starting', reason: 'waiting_for_guarded_verifier_receipt', nextCheckAt: now + 1_000 })
            await sleep(now + 1_000)
            continue
          } else active = 'unsafe'
        } else {
          activePid = null
          fingerprint = null
          activity = null
          nextActivityCheck = 0
          inventory = await inspectCheckpoints(anchor, now)
          const exitIdentity = receipt ? `${receipt.pid}:${receipt.startedAt}` : 'missing-receipt'
          if (exitIdentity !== lastHandledExit) {
            lastHandledExit = exitIdentity
            const fatal = typeof status?.fatal === 'string' ? status.fatal : ''
            if (!/MiniMax quota/.test(fatal) && (status?.status !== 'completed' || inventory.modelErrorRecords > 0)) {
              noProgressFailures = inventory.completedRecords > lastLaunchCompleted ? 0 : noProgressFailures + 1
              cooldownUntil = now + verifierRestartDelay(noProgressFailures, /MiniMax HTTP 429/.test(fatal))
            }
          }
        }
      }
      const dataMatches = await currentInputMatches(anchor)
      const source = await readFile(/* turbopackIgnore: true */ join(root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts'), 'utf8')
      const sourceConfiguration = verifierSourceConfiguration(source)
      const inputMatches = dataMatches && sourceConfiguration.promptVersion === anchor.promptVersion && sourceConfiguration.sourceChars === anchor.sourceChars
      const supportsResume = sourceConfiguration.supportsResume
      if ((active === 'none' || clock.gapDetected) && providerMatches && inputMatches && supportsResume && cooldownUntil <= now && nextQuotaCheck <= now && inventory.completedRecords < anchor.totalRecords) {
        quota = await fetchQuota(config)
        fundingMode = quota.state === 'available' ? 'plan' : authorizedCreditWindow(quota, billingSafety, Date.now()) ? 'credits-authorized' : 'unknown'
      }
      const action = decideSupervisorAction({ now: Date.now(), totalRecords: anchor.totalRecords, inventory, active, currentInputMatches: inputMatches, providerMatches, verifierSupportsResume: supportsResume, fatal: typeof status?.fatal === 'string' ? status.fatal : null, cooldownUntil, noProgressFailures, quota, resumeGraceUntil, minimumRemainingPercent: billingSafety.minimumRemainingPercent, allowExistingCredits: billingSafety.allowExistingCredits, creditsWindowConfirmed: quota ? authorizedCreditWindow(quota, billingSafety, Date.now()) : false, ...(active === 'verified' ? { lastActivityAt: activity?.lastActivityAt ?? null } : {}) })
      if (action.kind === 'launch') {
        // Re-read both snapshot and current receipt immediately before spawning to avoid duplicates.
        const latestReceiptState = await readBaselineReceipt(anchor)
        const latestReceipt = latestReceiptState.receipt
        if (!await currentInputMatches(anchor)) { await persist({ kind: 'stop', reason: 'catalog_snapshot_changed', nextCheckAt: null }); return }
        if (latestReceipt) {
          const existing = await probe(latestReceipt.pid)
          if (existing.alive) { activePid = latestReceipt.pid; fingerprint = null; continue }
        } else if (latestReceiptState.kind !== 'missing' || !await preparedBaselineSafety(anchor)) { await persist({ kind: 'stop', reason: 'base_run_receipt_changed', nextCheckAt: null }); return }
        const refreshedConfig = getCcSwitchQuotaConfig()
        if (!quotaConfigMatches(refreshedConfig, anchor) || refreshedConfig.key !== frozenConfig.key) { await persist({ kind: 'stop', reason: 'minimax_provider_changed', nextCheckAt: null }); return }
        const launch = buildVerifierLaunch(root)
        await assertMiniMaxRunning(root)
        const tag = `${Date.now()}-${randomUUID().slice(0, 8)}`
        logPaths = { stdout: join(stateDirectory, `catalog-supervised-${tag}.stdout.log`), stderr: join(stateDirectory, `catalog-supervised-${tag}.stderr.log`) }
        const out = openSync(/* turbopackIgnore: true */ logPaths.stdout, 'a')
        const err = openSync(/* turbopackIgnore: true */ logPaths.stderr, 'a')
        try {
          const child = spawn(launch.executable, launch.args, { ...launch.options, stdio: ['ignore', out, err] })
          await new Promise<void>((done, fail) => { child.once('spawn', done); child.once('error', () => fail(new Error('verifier_spawn_failed'))) })
          if (!child.pid) throw new Error('verifier_spawn_failed')
          activePid = child.pid
          activity = null
          nextActivityCheck = 0
          // Keep a listener after spawn, but never serialize arbitrary process error messages.
          child.on('error', () => { stopRequested = true })
        } finally { closeSync(out); closeSync(err) }
        launchingUntil = Date.now() + 30_000
        launchCount++
        lastLaunchCompleted = inventory.completedRecords
        quota = null
        nextQuotaCheck = 0
        await persist({ kind: 'starting', reason: 'guarded_verifier_started', nextCheckAt: Date.now() + 1_000 })
        await sleep(Date.now() + 1_000)
        continue
      }
      await persist(action)
      if (action.kind === 'stop' || action.kind === 'needs-recovery') return
      if (action.kind === 'wait') {
        const plannedCheck = action.nextCheckAt || Date.now() + 300_000
        // Refreshing a state file must not push a previously scheduled quota query away forever.
        nextQuotaCheck = nextQuotaCheck > now ? Math.min(nextQuotaCheck, plannedCheck) : plannedCheck
      }
      await sleep(action.kind === 'monitor' ? Date.now() + (options.pollMs || 30_000) : Math.min(nextQuotaCheck, Date.now() + 60_000))
    }
    // A human signal stops only a process still proved to belong to this exact guarded run.
    if (activePid) {
      const receipt = await optionalJson(join(anchor.directory, 'run-receipt.json'))
      if (receiptMatchesAnchor(receipt, anchor) && receipt.pid === activePid && processMatchesReceipt(await probe(activePid), receipt, fingerprint)) {
        try { process.kill(activePid, 'SIGTERM') } catch { /* Already exited. */ }
      }
    }
    await persist({ kind: 'stopped', reason: 'human_stop_requested', nextCheckAt: null })
  } catch {
    await persist({ kind: 'stop', reason: 'supervisor_operation_failed', nextCheckAt: null })
  } finally {
    process.off('SIGINT', requestStop)
    process.off('SIGTERM', requestStop)
    await lock.release()
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.includes('--help')) { console.log('node --import tsx scripts/ingestion/minimax-quota-supervisor.ts --run <run-id> [--adopt-pid <pid>] [--poll-ms 30000] [--inspect]'); return }
  if (rawArgs.filter(arg => arg === '--inspect').length > 1) throw new Error('invalid_supervisor_arguments')
  const inspect = rawArgs.includes('--inspect')
  const args = rawArgs.filter(arg => arg !== '--inspect')
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--run', '--adopt-pid', '--poll-ms'].includes(name) || values.has(name) || !value || value.startsWith('--')) throw new Error('invalid_supervisor_arguments')
    values.set(name, value)
  }
  const runId = values.get('--run') || ''
  const adoptPid = values.has('--adopt-pid') ? Number(values.get('--adopt-pid')) : undefined
  const pollMs = Number(values.get('--poll-ms') || '30000')
  if (!RUN_ID.test(runId) || (adoptPid !== undefined && !validPid(adoptPid)) || !Number.isSafeInteger(pollMs) || pollMs < 5_000 || pollMs > 60_000) throw new Error('invalid_supervisor_arguments')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  if (inspect) { const readiness = await inspectSupervisorReadiness(root, runId); console.log(JSON.stringify(readiness, null, 2)); if (!readiness.ready) process.exitCode = 1; return }
  await runQuotaSupervisor({ root, runId, adoptPid, pollMs })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'supervisor_configuration_failed'
    console.error(JSON.stringify({ phase: 'stop', reason, balanceFallbackAllowed: false }))
    process.exitCode = 1
  })
}
