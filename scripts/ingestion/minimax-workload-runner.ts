import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildRecoveryLedger } from './build-minimax-recovery-ledger'
import { fetchQuota, getCcSwitchQuotaConfig, type QuotaApiConfig, type QuotaState } from './minimax-quota'
import { authorizedCreditWindow, readPlanBillingSafety, type PlanBillingSafety } from './minimax-billing-safety'
import { assertMiniMaxRunning, readManualControl } from './minimax-manual-control'
import {
  acquireSupervisorLock, atomicSupervisorJson, currentInputMatches, inspectSupervisorReadiness,
  inspectVerifierActivity, loadAnchor, probeNativeProcess, receiptMatchesAnchor,
  type ProcessProbe, type RunReceipt, type SupervisorAnchor,
} from './minimax-quota-supervisor'
import {
  applyModelOptions, buildTaskSelection, modelConfiguration, parseVerificationRunId, verificationRunId,
  type ModelOptions, type TaskSelection,
} from './verify-catalog-minimax'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const pidIsValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(/* turbopackIgnore: true */ path, 'utf8'))
const optionalJson = async (path: string): Promise<unknown> => { try { return await json(path) } catch { return null } }
const MAX_SILENCE_MS = 30 * 60_000
const BACKLOG_RECHECK_MS = 15 * 60_000
export const DAILY_USEFUL_TOKEN_TARGET = 144_000_000

export type RecoveryJob = {
  runId: string; inputSha256: string; model: string; modelConfigSha256: string;
  options: ModelOptions; selection: TaskSelection; selectorFile: string; evidenceFingerprint: string;
}
export type WorkloadChild = {
  kind: 'supervisor' | 'recovery'; pid: number; fingerprint: string | null;
  startedAt: string; runId: string; owned: boolean;
}
export type WorkloadPlan = {
  schemaVersion: 1; baselineRunId: string; inputSha256: string; baselineCompleted: boolean;
  pendingRecovery: RecoveryJob | null; finishedJobs: string[]; completedRecoverySelections: number;
}
export type WorkloadState = {
  schemaVersion: 1; runnerPid: number; runnerFingerprint: string; baselineRunId: string; inputSha256: string;
  phase: string; reason: string; updatedAt: string; child: WorkloadChild | null;
  nextCheckAt: string | null; launchCount: number; consecutiveFailures: number;
  dailyUsefulTokenTarget: number; targetIsSpendingCap: false; apiPaddingAllowed: false;
  balanceFallbackAllowed: boolean; fundingMode: 'plan' | 'existing-credits-authorized' | 'blocked'; quota: QuotaState | null; billingSafety: PlanBillingSafety | null;
  creditFallbackAuthorized: boolean; supervisorPolicyReloadPending: boolean;
  completedRecoverySelections: number; remainingRecoveryRecords: number | null;
  evidenceBacklogRecords: number | null; lastModelResponseAt: string | null;
  keepAwake: { enabled: boolean; helperPid: number | null; systemRequired: boolean; executionRequired: boolean; acPower: boolean | null };
}
export type WorkloadAction = { kind: 'monitor' | 'wait' | 'launch' | 'backlog' | 'stop'; reason: string; nextCheckAt: number | null }
export type WorkloadObservation = {
  now: number; active: 'verified' | 'unsafe' | 'none'; hasPendingWork: boolean;
  inputMatches: boolean; providerMatches: boolean; fatal: string | null;
  failures: number; cooldownUntil: number; quota: QuotaState | null; minimumRemainingPercent: number;
  creditWindowAuthorized?: boolean;
}

/** A target describes useful work; it never authorizes synthetic API padding or a quota fallback. */
export function decideWorkloadAction(value: WorkloadObservation): WorkloadAction {
  const stop = (reason: string): WorkloadAction => ({ kind: 'stop', reason, nextCheckAt: null })
  const wait = (reason: string, until: number): WorkloadAction => ({ kind: 'wait', reason, nextCheckAt: Math.max(value.now + 5_000, until) })
  if (!value.inputMatches) return stop('catalog_snapshot_changed')
  if (!value.providerMatches) return stop('minimax_provider_changed')
  if (value.active === 'unsafe') return stop('process_identity_unconfirmed')
  if (value.active === 'verified') return { kind: 'monitor', reason: 'existing_guarded_work_running', nextCheckAt: value.now + 30_000 }
  if (/MiniMax HTTP (400|401|402|403|404)|authentication|configuration|unsafe_/i.test(value.fatal || '')) return stop('authentication_billing_or_configuration_error')
  if (value.failures >= 3) return stop('repeated_child_failure_requires_review')
  if (!value.hasPendingWork) return { kind: 'backlog', reason: 'no_actionable_evidence_work_no_api_padding', nextCheckAt: value.now + BACKLOG_RECHECK_MS }
  if (value.cooldownUntil > value.now) return wait('bounded_child_restart_backoff', value.cooldownUntil)
  const quota = value.quota
  if (!quota) return wait('fresh_quota_query_required', value.now + 5_000)
  if (/^quota_http_(400|401|403|404)$|^unsafe_quota_configuration$|^invalid_quota_timeout$/.test(quota.reason)) return stop('quota_authentication_or_configuration_error')
  if (quota.state === 'exhausted') {
    if (value.creditWindowAuthorized === true) return { kind: 'launch', reason: 'existing_credits_authorized_plan_exhausted', nextCheckAt: null }
    const reset = Date.parse(quota.reason === 'weekly_quota_exhausted' ? quota.weekly.resetAt || '' : quota.fiveHour.resetAt || '')
    return wait(quota.reason, Number.isFinite(reset) && reset > value.now ? reset + 5_000 : value.now + 300_000)
  }
  if (quota.state !== 'available' || !quota.canRun || !(Number(quota.fiveHour.remainingPercent) > 0) || !(Number(quota.weekly.remainingPercent) > 0)) {
    return wait(quota.reason === 'quota_http_429' ? 'quota_rate_limited' : 'quota_unknown_no_model_calls', value.now + (quota.reason === 'quota_http_429' ? 600_000 : 300_000))
  }
  if (Number(quota.fiveHour.remainingPercent) <= value.minimumRemainingPercent || Number(quota.weekly.remainingPercent) <= value.minimumRemainingPercent) return wait('waiting_credit_fallback_confirmation', value.now + 300_000)
  return { kind: 'launch', reason: 'positive_safe_plan_quota_and_useful_pending_work', nextCheckAt: null }
}

/** Repeated state refreshes must not postpone an already scheduled quota retry. */
export function scheduleWorkloadQuotaCheck(now: number, previousCheckAt: number, plannedCheckAt: number) {
  const planned = Math.max(now + 5_000, plannedCheckAt)
  return previousCheckAt > now ? Math.min(previousCheckAt, planned) : planned
}

export function recoveryExecution(anchor: Pick<SupervisorAnchor, 'model' | 'endpoint'>) {
  const options: ModelOptions = anchor.model === 'MiniMax-M3' ? { thinking: 'adaptive' } : {}
  // This object is used only to compute public model identity. It cannot make a request.
  const api = applyModelOptions({ endpoint: anchor.endpoint, key: '', model: anchor.model, anthropic: true }, options)
  return { api, options, configuration: modelConfiguration(api) }
}

export function buildRecoveryJob(anchor: SupervisorAnchor, taskIds: string[], evidenceFingerprint: string): RecoveryJob {
  if (!/^[a-f0-9]{64}$/.test(evidenceFingerprint)) throw new Error('invalid_recovery_evidence_fingerprint')
  const selection = buildTaskSelection(taskIds, [...anchor.taskIds], anchor.runId)
  const execution = recoveryExecution(anchor)
  const runId = verificationRunId(anchor.inputSha256, execution.api, execution.options, selection)
  return { runId, inputSha256: anchor.inputSha256, model: anchor.model, modelConfigSha256: execution.configuration.modelConfigSha256!, options: execution.options, selection,
    selectorFile: join(anchor.root, '.tmp', 'minimax-verification', `workload-tasks-${selection.selectorSha256.slice(0, 12)}-${evidenceFingerprint.slice(0, 12)}.json`), evidenceFingerprint }
}

export function buildWorkloadChildLaunch(root: string, baselineRunId: string, job: RecoveryJob | null) {
  parseVerificationRunId(baselineRunId)
  const args = job
    ? ['--import', 'tsx', join(root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts'), '--use-ccswitch', '--all', '--task-ids-file', job.selectorFile, '--recovery-from', baselineRunId,
      '--retry-unconfirmed', '--batch-size', '1', '--concurrency', '4', '--quota-guard', '--checkpoint-max-age-hours', '168', ...(job.options.thinking ? ['--thinking', job.options.thinking] : [])]
    : ['--import', 'tsx', join(root, 'scripts', 'ingestion', 'minimax-quota-supervisor.ts'), '--run', baselineRunId]
  return { executable: process.execPath, args, options: { cwd: root, windowsHide: true } }
}

/** Creation-time fingerprints, guarded receipt identity and exact selected task IDs are all required. */
export function recoveryProcessMatches(probe: ProcessProbe, child: WorkloadChild, receipt: unknown, job: RecoveryJob, anchor: SupervisorAnchor) {
  const value = object(receipt)
  const selection = object(value?.selection)
  const created = Date.parse(probe.createdAt || '')
  const started = Date.parse(String(value?.startedAt || ''))
  return Boolean(probe.alive && probe.inspected && probe.recoveryVerifier && probe.fingerprint &&
    (!child.fingerprint || child.fingerprint === probe.fingerprint) && value?.pid === child.pid &&
    Number.isFinite(created) && created <= started && started - created <= 120_000 && value.inputSha256 === anchor.inputSha256 &&
    value.model === job.model && value.modelConfigSha256 === job.modelConfigSha256 && value.providerId === anchor.providerId && value.endpoint === anchor.endpoint &&
    value.quotaGuard === true && value.selectedRecords === job.selection.taskIds.length && selection?.recoveryFrom === anchor.runId &&
    selection.selectorSha256 === job.selection.selectorSha256 && JSON.stringify(selection.taskIds) === JSON.stringify(job.selection.taskIds))
}

export function parseWorkloadArguments(args: string[]) {
  const values = new Map<string, string>()
  let inspect = false
  let keepAwake = true
  let awakeFlag = false
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    if (name === '--inspect') { if (inspect) throw new Error('invalid_workload_arguments'); inspect = true; continue }
    if (name === '--keep-awake' || name === '--no-keep-awake') { if (awakeFlag) throw new Error('invalid_workload_arguments'); awakeFlag = true; keepAwake = name === '--keep-awake'; continue }
    const value = args[++index]
    if (!['--run', '--poll-ms'].includes(name) || values.has(name) || !value || value.startsWith('--')) throw new Error('invalid_workload_arguments')
    values.set(name, value)
  }
  const runId = values.get('--run') || ''
  const parsed = parseVerificationRunId(runId)
  if (parsed.selectorPrefix) throw new Error('workload_requires_baseline_run')
  const pollMs = Number(values.get('--poll-ms') || '30000')
  if (!Number.isSafeInteger(pollMs) || pollMs < 5_000 || pollMs > 60_000) throw new Error('invalid_workload_arguments')
  return { runId, pollMs, keepAwake, inspect }
}

/** A scoped native handle prevents idle system sleep; no machine power settings are changed. */
export function buildKeepAwakeLaunch(ownerPid: number, createdAt: string, statePath: string, nonce: string) {
  if (!pidIsValid(ownerPid) || !Number.isFinite(Date.parse(createdAt)) || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('invalid_keep_awake_owner')
  const escapedPath = statePath.replaceAll("'", "''")
  const script = `
$ErrorActionPreference = 'Stop'
$runnerProcess = Get-Process -Id ${ownerPid}
$expectedCreation = [DateTime]::Parse('${new Date(createdAt).toISOString()}').ToUniversalTime()
if ([Math]::Abs(($runnerProcess.StartTime.ToUniversalTime() - $expectedCreation).TotalMilliseconds) -gt 1000) { throw 'owner_creation_mismatch' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudyInChinaPower {
  [StructLayout(LayoutKind.Sequential)] public struct DetailedReason { public IntPtr Module; public uint Id; public uint Count; public IntPtr Strings; }
  [StructLayout(LayoutKind.Explicit)] public struct ReasonUnion { [FieldOffset(0)] public IntPtr Simple; [FieldOffset(0)] public DetailedReason Detailed; }
  [StructLayout(LayoutKind.Sequential)] public struct ReasonContext { public uint Version; public uint Flags; public ReasonUnion Reason; }
  [StructLayout(LayoutKind.Sequential)] public struct PowerStatus { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public uint BatteryLifeTime; public uint BatteryFullLifeTime; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr PowerCreateRequest(ref ReasonContext context);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool PowerSetRequest(IntPtr handle, int type);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool PowerClearRequest(IntPtr handle, int type);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out PowerStatus status);
}
'@
$reasonString = [Runtime.InteropServices.Marshal]::StringToHGlobalUni('StudyInChina useful MiniMax verification')
$context = New-Object StudyInChinaPower+ReasonContext
$context.Version = 0
$context.Flags = 1
$reasonUnion = New-Object StudyInChinaPower+ReasonUnion
$reasonUnion.Simple = $reasonString
$context.Reason = $reasonUnion
$requestHandle = [IntPtr]::Zero
$systemRequired = $false
$executionRequired = $false
try {
  $requestHandle = [StudyInChinaPower]::PowerCreateRequest([ref]$context)
  if ($requestHandle -eq [IntPtr]::Zero -or $requestHandle -eq [IntPtr](-1)) { throw 'power_request_create_failed' }
  $systemRequired = [StudyInChinaPower]::PowerSetRequest($requestHandle, 1)
  if (-not $systemRequired) { throw 'power_request_system_failed' }
  $executionRequired = [StudyInChinaPower]::PowerSetRequest($requestHandle, 3)
  $powerStatus = New-Object StudyInChinaPower+PowerStatus
  $hasPowerStatus = [StudyInChinaPower]::GetSystemPowerStatus([ref]$powerStatus)
  $acPower = if ($hasPowerStatus -and $powerStatus.ACLineStatus -ne 255) { $powerStatus.ACLineStatus -eq 1 } else { $null }
  $powerState = [pscustomobject]@{ ownerPid=${ownerPid}; helperPid=$PID; nonce='${nonce}'; systemRequired=$systemRequired; executionRequired=$executionRequired; acPower=$acPower }
  [IO.File]::WriteAllText('${escapedPath}', ($powerState | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  while (-not $runnerProcess.WaitForExit(1000)) { }
} finally {
  if ($requestHandle -ne [IntPtr]::Zero -and $requestHandle -ne [IntPtr](-1)) {
    if ($executionRequired) { [void][StudyInChinaPower]::PowerClearRequest($requestHandle, 3) }
    if ($systemRequired) { [void][StudyInChinaPower]::PowerClearRequest($requestHandle, 1) }
    [void][StudyInChinaPower]::CloseHandle($requestHandle)
  }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($reasonString)
}
`
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return { executable, args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], options: { windowsHide: true } }
}

async function launchLogged(root: string, directory: string, kind: string, command: ReturnType<typeof buildWorkloadChildLaunch> | ReturnType<typeof buildKeepAwakeLaunch>) {
  await mkdir(directory, { recursive: true })
  const tag = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const stdout = join(directory, `workload-${kind}-${tag}.stdout.log`)
  const stderr = join(directory, `workload-${kind}-${tag}.stderr.log`)
  const out = openSync(/* turbopackIgnore: true */ stdout, 'a')
  const err = openSync(/* turbopackIgnore: true */ stderr, 'a')
  try {
    const processChild = spawn(command.executable, command.args, { ...command.options, cwd: root, stdio: ['ignore', out, err] })
    // Error text can contain platform details. Persist only controlled reason codes.
    processChild.on('error', () => undefined)
    await new Promise<void>((done, fail) => { processChild.once('spawn', done); processChild.once('error', () => fail(new Error('workload_child_spawn_failed'))) })
    if (!processChild.pid) throw new Error('workload_child_spawn_failed')
    return { child: processChild, stdout, stderr }
  } finally { closeSync(out); closeSync(err) }
}

async function startKeepAwake(root: string, directory: string, own: ProcessProbe) {
  if (!own.createdAt) throw new Error('keep_awake_owner_identity_unavailable')
  const nonce = randomUUID()
  const path = join(directory, 'keep-awake-state.json')
  const launch = buildKeepAwakeLaunch(process.pid, own.createdAt, path, nonce)
  const result = await launchLogged(root, directory, 'keep-awake', launch)
  const until = Date.now() + 15_000
  while (Date.now() < until && result.child.exitCode === null && result.child.signalCode === null) {
    const state = object(await optionalJson(path))
    if (state?.ownerPid === process.pid && state.helperPid === result.child.pid && state.nonce === nonce && state.systemRequired === true) {
      return { child: result.child, systemRequired: true, executionRequired: state.executionRequired === true, acPower: typeof state.acPower === 'boolean' ? state.acPower : null }
    }
    await new Promise(done => setTimeout(done, 250))
  }
  result.child.kill()
  throw new Error('keep_awake_request_unavailable')
}

export async function readWorkloadPlan(path: string, anchor: SupervisorAnchor): Promise<WorkloadPlan> {
  let text: string
  try { text = await readFile(/* turbopackIgnore: true */ path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('workload_plan_unreadable')
    return { schemaVersion: 1, baselineRunId: anchor.runId, inputSha256: anchor.inputSha256, baselineCompleted: false, pendingRecovery: null, finishedJobs: [], completedRecoverySelections: 0 }
  }
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error('workload_plan_oversized')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('workload_plan_invalid') }
  return validateWorkloadPlan(raw, anchor)
}

export function validateWorkloadPlan(value: unknown, anchor: SupervisorAnchor): WorkloadPlan {
  const raw = object(value)
  if (!raw) throw new Error('workload_plan_invalid')
  if (raw.schemaVersion !== 1 || raw.baselineRunId !== anchor.runId || raw.inputSha256 !== anchor.inputSha256 || typeof raw.baselineCompleted !== 'boolean' || !Array.isArray(raw.finishedJobs) || raw.finishedJobs.some(value => typeof value !== 'string') || !Number.isSafeInteger(raw.completedRecoverySelections) || Number(raw.completedRecoverySelections) < 0) throw new Error('workload_plan_identity_invalid')
  if (raw.pendingRecovery !== null) {
    const pending = object(raw.pendingRecovery)
    const selection = object(pending?.selection)
    if (!pending || !selection || !Array.isArray(selection.taskIds) || typeof pending.evidenceFingerprint !== 'string') throw new Error('workload_pending_plan_invalid')
    const expected = buildRecoveryJob(anchor, selection.taskIds as string[], pending.evidenceFingerprint)
    if (JSON.stringify(expected) !== JSON.stringify(pending)) throw new Error('workload_pending_plan_identity_invalid')
  }
  return raw as unknown as WorkloadPlan
}

function jobKey(job: RecoveryJob) { return `${job.runId}:${job.evidenceFingerprint}` }

export async function inspectRecoveryJobProgress(anchor: SupervisorAnchor, job: RecoveryJob, now: number) {
  const directory = join(anchor.root, '.official-harvest', 'minimax-verification', job.runId)
  let completed = 0
  for (const taskId of job.selection.taskIds) {
    const record = object(await optionalJson(join(directory, 'records', `${sha(taskId)}.json`)))
    const checked = Date.parse(String(record?.checkedAt || ''))
    if (record?.taskId !== taskId || record.inputSha256 !== anchor.inputSha256 || record.modelConfigSha256 !== job.modelConfigSha256 || record.model !== job.model || !Array.isArray(record.issues) || !Array.isArray(record.verdicts) || !Number.isFinite(checked) || checked > now) continue
    // A closed quota gate is not a model attempt and must survive the next window.
    if (record.issues.some(issue => typeof issue !== 'string' || /^MiniMax quota|^MiniMax HTTP 429$|^MiniMax billing safety/i.test(issue))) continue
    completed++
  }
  return { completed, pending: job.selection.taskIds.length - completed, directory, status: object(await optionalJson(join(directory, 'status.json'))), receipt: await optionalJson(join(directory, 'run-receipt.json')) }
}

export async function ensureRecoverySelector(job: RecoveryJob) {
  let text: string
  try { text = await readFile(/* turbopackIgnore: true */ job.selectorFile, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('recovery_selector_unreadable')
    await atomicSupervisorJson(job.selectorFile, job.selection.taskIds)
    return
  }
  if (Buffer.byteLength(text) > 256 * 1024) throw new Error('recovery_selector_oversized')
  let ids: unknown
  try { ids = JSON.parse(text) } catch { throw new Error('recovery_selector_invalid') }
  if (JSON.stringify(ids) !== JSON.stringify(job.selection.taskIds)) throw new Error('recovery_selector_identity_changed')
}

/** Detect a guarded worker outside the durable pending job before spawning another verifier. */
async function otherLiveVerifier(anchor: SupervisorAnchor, allowBaselineAdoption: boolean, probeProcess = probeNativeProcess) {
  const verificationRoot = resolve(anchor.directory, '..')
  for (const entry of await readdir(/* turbopackIgnore: true */ verificationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(anchor.inputSha256.slice(0, 16))) continue
    try { parseVerificationRunId(entry.name) } catch { continue }
    const receipt = object(await optionalJson(join(verificationRoot, entry.name, 'run-receipt.json')))
    if (!receipt || !pidIsValid(receipt.pid) || receipt.inputSha256 !== anchor.inputSha256 || receipt.providerId !== anchor.providerId || receipt.endpoint !== anchor.endpoint || receipt.quotaGuard !== true || typeof receipt.startedAt !== 'string') continue
    const probe = await probeProcess(receipt.pid, anchor.root)
    if (!probe.alive) continue
    const created = Date.parse(probe.createdAt || '')
    const started = Date.parse(receipt.startedAt)
    if (!probe.inspected) return true
    if ((probe.verifier || probe.recoveryVerifier) && Number.isFinite(created) && created <= started && started - created <= 120_000) {
      // Launching the baseline supervisor adopts this exact existing baseline; it does not duplicate it.
      if (allowBaselineAdoption && entry.name === anchor.runId && probe.verifier && receipt.modelConfigSha256 === anchor.modelConfigSha256 && receipt.model === anchor.model && receipt.selectedRecords === anchor.totalRecords) continue
      return true
    }
  }
  return false
}

async function nextRecoveryJob(anchor: SupervisorAnchor, plan: WorkloadPlan, now: number) {
  const execution = recoveryExecution(anchor)
  const ledger = await buildRecoveryLedger(anchor.runId, anchor.root, now, { effectiveModelConfiguration: execution.configuration })
  const chosen = ledger.qualifiedRecovery.slice(0, 1_000)
  if (!chosen.length) return { job: null, remaining: 0, backlog: ledger.records.filter(record => record.fields.some(field => field.status !== 'supported')).length }
  const ids = chosen.map(record => record.taskId)
  const sources = [...new Set(ledger.records.filter(record => ids.includes(record.taskId)).flatMap(record => record.sources.map(source => source.sourceId)))].sort()
  const evidence = await Promise.all(sources.map(async sourceId => {
    const receipt = object(await optionalJson(join(anchor.directory, 'sources', `${sha(sourceId)}.json`)))
    return { sourceId, textSha256: typeof receipt?.textSha256 === 'string' ? receipt.textSha256 : null }
  }))
  const job = buildRecoveryJob(anchor, ids, sha(JSON.stringify(evidence)))
  // The verifier independently checks sibling attempts. This is an additional durable scheduler guard.
  if (plan.finishedJobs.includes(jobKey(job))) return { job: null, remaining: ledger.qualifiedRecovery.length, backlog: ledger.records.filter(record => record.fields.some(field => field.status !== 'supported')).length }
  return { job, remaining: ledger.qualifiedRecovery.length, backlog: ledger.records.filter(record => record.fields.some(field => field.status !== 'supported')).length }
}

async function existingSupervisor(anchor: SupervisorAnchor) {
  const directory = join(anchor.root, '.tmp', 'minimax-verification')
  const state = object(await optionalJson(join(directory, 'supervisor-state.json')))
  const lock = object(await optionalJson(join(directory, 'supervisor.lock.json')))
  const candidatePid = pidIsValid(lock?.ownerPid) ? lock.ownerPid : pidIsValid(state?.supervisorPid) ? state.supervisorPid : null
  if (!candidatePid) return { child: null, state, unsafe: false }
  const probe = await probeNativeProcess(candidatePid, anchor.root)
  if (!probe.alive) return { child: null, state, unsafe: false }
  const matches = state?.supervisorPid === candidatePid && state.runId === anchor.runId && state.inputSha256 === anchor.inputSha256 && state.modelConfigSha256 === anchor.modelConfigSha256 && lock?.ownerPid === state.supervisorPid && lock.runId === anchor.runId && lock.fingerprint === probe.fingerprint && probe.inspected && probe.supervisor && typeof lock.startedAt === 'string'
  if (!matches) return { child: null, state, unsafe: true }
  const child: WorkloadChild = { kind: 'supervisor', pid: candidatePid, fingerprint: probe.fingerprint, startedAt: String(lock!.startedAt), runId: anchor.runId, owned: false }
  return { child, state, unsafe: false }
}

export function legacySupervisorPolicyReloadPending(state: unknown, policy: PlanBillingSafety) {
  const value = object(state)
  return Boolean(policy.allowExistingCredits && value?.balanceFallbackAllowed === false &&
    !Object.hasOwn(value, 'billingSafety') && !Object.hasOwn(value, 'fundingMode'))
}

type HandoffRuntime = {
  platform: NodeJS.Platform; now: () => number;
  probeProcess: typeof probeNativeProcess; terminate: (pid: number) => void;
}

/** Retire only an idle legacy Windows supervisor in a freshly confirmed exhausted
 * window. Its healthy verifier is always preserved, and normal lock recovery
 * subsequently starts the updated supervisor. No lock or verifier is deleted. */
export async function tryLegacySupervisorHandoff(anchor: SupervisorAnchor, child: WorkloadChild, quota: QuotaState, policy: PlanBillingSafety,
  runtime: HandoffRuntime = { platform: process.platform, now: Date.now, probeProcess: probeNativeProcess, terminate: pid => { process.kill(pid, 'SIGKILL') } }) {
  if (runtime.platform !== 'win32' || child.kind !== 'supervisor' || !child.fingerprint) return false
  const directory = join(anchor.root, '.tmp', 'minimax-verification')
  const inspect = async () => {
    const now = runtime.now()
    if (!authorizedCreditWindow(quota, policy, now) || Math.min(Date.parse(quota.fiveHour.resetAt!), Date.parse(quota.weekly.resetAt!)) <= now + 60_000) return null
    const state = object(await optionalJson(join(directory, 'supervisor-state.json')))
    const lock = object(await optionalJson(join(directory, 'supervisor.lock.json')))
    const receipt = await optionalJson(join(anchor.directory, 'run-receipt.json'))
    const oldQuota = object(state?.quota)
    const oldFiveHour = object(oldQuota?.fiveHour)
    const oldWeekly = object(oldQuota?.weekly)
    const stateAt = Date.parse(String(state?.updatedAt || ''))
    if (!legacySupervisorPolicyReloadPending(state, policy) || state?.phase !== 'wait' || state.childPid !== null ||
      state.supervisorPid !== child.pid || state.runId !== anchor.runId || state.inputSha256 !== anchor.inputSha256 || state.modelConfigSha256 !== anchor.modelConfigSha256 ||
      !['five_hour_quota_exhausted', 'weekly_quota_exhausted'].includes(String(state.reason)) ||
      !Number.isFinite(stateAt) || stateAt > now || now - stateAt > 120_000 || !(Date.parse(String(state.nextCheckAt || '')) > now + 60_000) ||
      lock?.ownerPid !== child.pid || lock.runId !== anchor.runId || lock.fingerprint !== child.fingerprint || typeof lock.nonce !== 'string' ||
      oldQuota?.state !== 'exhausted' || oldQuota.reason !== quota.reason || state.reason !== quota.reason ||
      oldFiveHour?.startAt !== quota.fiveHour.startAt || oldFiveHour.resetAt !== quota.fiveHour.resetAt || oldWeekly?.startAt !== quota.weekly.startAt || oldWeekly.resetAt !== quota.weekly.resetAt ||
      !receiptMatchesAnchor(receipt, anchor)) return null
    const owner = await runtime.probeProcess(child.pid, anchor.root)
    if (!owner.alive || !owner.inspected || !owner.supervisor || owner.fingerprint !== child.fingerprint || (await runtime.probeProcess(receipt.pid, anchor.root)).alive) return null
    return { nonce: lock.nonce, receiptPid: receipt.pid, receiptStartedAt: receipt.startedAt, stateIdentity: JSON.stringify(state) }
  }
  const first = await inspect()
  if (!first || await otherLiveVerifier(anchor, false, runtime.probeProcess)) return false
  const last = await inspect()
  if (!last || last.nonce !== first.nonce || last.receiptPid !== first.receiptPid || last.receiptStartedAt !== first.receiptStartedAt) return false
  const finalLock = object(await optionalJson(join(directory, 'supervisor.lock.json')))
  const finalReceipt = await optionalJson(join(anchor.directory, 'run-receipt.json'))
  if (finalLock?.nonce !== last.nonce || finalLock.fingerprint !== child.fingerprint || finalLock.ownerPid !== child.pid ||
    !receiptMatchesAnchor(finalReceipt, anchor) || finalReceipt.pid !== last.receiptPid || finalReceipt.startedAt !== last.receiptStartedAt ||
    (await runtime.probeProcess(last.receiptPid, anchor.root)).alive) return false
  const finalOwner = await runtime.probeProcess(child.pid, anchor.root)
  if (!finalOwner.alive || !finalOwner.inspected || !finalOwner.supervisor || finalOwner.fingerprint !== child.fingerprint || !authorizedCreditWindow(quota, policy, runtime.now())) return false
  const closingLock = object(await optionalJson(join(directory, 'supervisor.lock.json')))
  const closingReceipt = await optionalJson(join(anchor.directory, 'run-receipt.json'))
  if (closingLock?.nonce !== last.nonce || closingLock.ownerPid !== child.pid || closingLock.fingerprint !== child.fingerprint ||
    !receiptMatchesAnchor(closingReceipt, anchor) || closingReceipt.pid !== last.receiptPid || closingReceipt.startedAt !== last.receiptStartedAt ||
    JSON.stringify(await optionalJson(join(directory, 'supervisor-state.json'))) !== last.stateIdentity) return false
  try { runtime.terminate(child.pid) } catch { throw new Error('legacy_supervisor_retirement_failed') }
  return true
}

export async function inspectWorkloadReadiness(root: string, runId: string, prospectivePlan?: WorkloadPlan) {
  const anchor = await loadAnchor(root, runId)
  const baseline = await inspectSupervisorReadiness(root, runId)
  const directory = join(root, '.tmp', 'minimax-verification')
  const plan = prospectivePlan ? validateWorkloadPlan(prospectivePlan, anchor) : await readWorkloadPlan(join(directory, 'workload-plan.json'), anchor)
  const previousLock = object(await optionalJson(join(directory, 'workload-runner.lock.json')))
  const probe = previousLock && pidIsValid(previousLock.ownerPid) ? await probeNativeProcess(previousLock.ownerPid, root) : null
  const runnerAlreadyAlive = Boolean(probe?.alive)
  const billingSafety = await readPlanBillingSafety(root)
  const supervisor = await existingSupervisor(anchor)
  return { ready: baseline.ready && !runnerAlreadyAlive && !supervisor.unsafe, baseline, runnerAlreadyAlive, runnerIdentityVerified: Boolean(probe?.inspected && probe.workloadRunner && previousLock?.fingerprint === probe.fingerprint), baselineCompleted: plan.baselineCompleted,
    pendingRecoveryRunId: plan.pendingRecovery?.runId || null, completedRecoverySelections: plan.completedRecoverySelections,
    billingSafety, supervisorPolicyReloadPending: Boolean(supervisor.child && legacySupervisorPolicyReloadPending(supervisor.state, billingSafety)),
    supervisorIdentityVerified: Boolean(supervisor.child), dailyUsefulTokenTarget: DAILY_USEFUL_TOKEN_TARGET, targetIsSpendingCap: false, apiPaddingAllowed: false }
}

/** Durable outer orchestration; only the bounded, quota-guarded verifier makes model calls. */
export async function runWorkloadRunner(options: { root: string; runId: string; pollMs?: number; keepAwake?: boolean }): Promise<void> {
  const root = resolve(options.root)
  const anchor = await loadAnchor(root, options.runId)
  const directory = join(root, '.tmp', 'minimax-verification')
  const statePath = join(directory, 'workload-state.json')
  const planPath = join(directory, 'workload-plan.json')
  const own = await probeNativeProcess(process.pid, root)
  if (!own.inspected || !own.workloadRunner || !own.fingerprint) throw new Error('workload_os_identity_unavailable')
  const lock = await acquireSupervisorLock(join(directory, 'workload-runner.lock.json'), { schemaVersion: 1, ownerPid: process.pid, fingerprint: own.fingerprint, nonce: randomUUID(), runId: anchor.runId, startedAt: new Date().toISOString() }, pid => probeNativeProcess(pid, root))
  let plan: WorkloadPlan
  let stopRequested = false
  const requestStop = () => { stopRequested = true }
  process.on('SIGINT', requestStop)
  process.on('SIGTERM', requestStop)
  let power: Awaited<ReturnType<typeof startKeepAwake>> | null = null
  let child: WorkloadChild | null = null
  let failures = 0
  let launchCount = 0
  let cooldownUntil = 0
  let nextQuotaAt = 0
  let nextLedgerAt = 0
  let quota: QuotaState | null = null
  let frozenProvider: QuotaApiConfig | null = null
  let billingSafety: PlanBillingSafety | null = null
  let supervisorPolicyReloadPending = false
  let activeSupervisorFunding: WorkloadState['fundingMode'] | null = null
  let remaining: number | null = null
  let backlog: number | null = null
  let lastModelResponseAt: string | null = null
  let launchedUntil = 0
  let lastHandledExit = ''
  let lastStatus: { phase: string; reason: string; nextCheckAt: number | null } | null = null
  const sleep = async (until: number) => { while (!stopRequested && Date.now() < until) await new Promise(done => setTimeout(done, Math.min(1_000, until - Date.now()))) }
  const persist = async (phase: string, reason: string, nextCheckAt: number | null) => {
    lastStatus = { phase, reason, nextCheckAt }
    const state: WorkloadState = { schemaVersion: 1, runnerPid: process.pid, runnerFingerprint: own.fingerprint!, baselineRunId: anchor.runId, inputSha256: anchor.inputSha256,
      phase, reason, updatedAt: new Date().toISOString(), child, nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : null, launchCount, consecutiveFailures: failures,
      dailyUsefulTokenTarget: DAILY_USEFUL_TOKEN_TARGET, targetIsSpendingCap: false, apiPaddingAllowed: false, balanceFallbackAllowed: billingSafety?.allowExistingCredits === true && !supervisorPolicyReloadPending,
      creditFallbackAuthorized: billingSafety?.allowExistingCredits === true, supervisorPolicyReloadPending,
      fundingMode: activeSupervisorFunding || (quota?.state === 'available' ? 'plan' : quota && billingSafety && authorizedCreditWindow(quota, billingSafety) ? 'existing-credits-authorized' : 'blocked'), quota, billingSafety,
      completedRecoverySelections: plan?.completedRecoverySelections || 0, remainingRecoveryRecords: remaining, evidenceBacklogRecords: backlog, lastModelResponseAt,
      keepAwake: { enabled: options.keepAwake !== false, helperPid: power?.child.pid || null, systemRequired: power?.systemRequired || false, executionRequired: power?.executionRequired || false, acPower: power?.acPower ?? null } }
    await atomicSupervisorJson(statePath, state)
  }
  try {
    plan = await readWorkloadPlan(planPath, anchor)
    const oldState = object(await optionalJson(statePath))
    const oldChild = object(oldState?.child)
    if (oldState?.baselineRunId === anchor.runId && oldState.inputSha256 === anchor.inputSha256) {
      failures = Number.isSafeInteger(oldState.consecutiveFailures) ? Math.max(0, Number(oldState.consecutiveFailures)) : 0
      launchCount = Number.isSafeInteger(oldState.launchCount) ? Math.max(0, Number(oldState.launchCount)) : 0
    }
    if (oldState?.baselineRunId === anchor.runId && oldState.inputSha256 === anchor.inputSha256 && oldChild?.kind === 'recovery' && pidIsValid(oldChild.pid) && plan.pendingRecovery && oldChild.runId === plan.pendingRecovery.runId && typeof oldChild.startedAt === 'string') child = oldChild as unknown as WorkloadChild
    if (options.keepAwake !== false) power = await startKeepAwake(root, directory, own)
    await atomicSupervisorJson(planPath, plan)
    for (;;) {
      if (stopRequested) break
      const now = Date.now()
      if ((await readManualControl(root)).desiredState === 'paused') {
        await persist('paused', 'human_pause_requested', now + 1_000)
        await sleep(now + 1_000)
        continue
      }
      if (power && (power.child.exitCode !== null || power.child.signalCode !== null)) { await persist('attention', 'keep_awake_helper_exited', null); return }
      const inputMatches = await currentInputMatches(anchor)
      let provider: QuotaApiConfig
      try { provider = getCcSwitchQuotaConfig() } catch { await persist('stopped', 'quota_configuration_unavailable', null); return }
      const expectedQuotaEndpoint = new URL(anchor.endpoint).hostname === 'api.minimax.io' ? 'https://www.minimax.io/v1/token_plan/remains' : 'https://www.minimax.cn/v1/token_plan/remains'
      const providerMatches = provider.providerId === anchor.providerId && provider.model === anchor.model && provider.endpoint === expectedQuotaEndpoint && (!frozenProvider || provider.endpoint === frozenProvider.endpoint && provider.key === frozenProvider.key)
      frozenProvider ||= provider
      if (!inputMatches || !providerMatches) { await persist('stopped', !inputMatches ? 'catalog_snapshot_changed' : 'minimax_provider_changed', null); return }
      billingSafety = await readPlanBillingSafety(root)
      const supervisor = await existingSupervisor(anchor)
      if (supervisor.unsafe) {
        if (child?.kind === 'supervisor' && child.owned && now < launchedUntil) {
          const probe = await probeNativeProcess(child.pid, root)
          if (probe.alive && probe.inspected && probe.supervisor) { await persist('starting', 'waiting_for_supervisor_state', now + 1_000); await sleep(now + 1_000); continue }
        }
        await persist('attention', 'supervisor_identity_unconfirmed', null)
        return
      }
      if (supervisor.child) {
        if (child?.kind === 'recovery' && (await probeNativeProcess(child.pid, root)).alive) { await persist('attention', 'multiple_guarded_children_require_review', null); return }
        child = supervisor.child
        supervisorPolicyReloadPending = legacySupervisorPolicyReloadPending(supervisor.state, billingSafety)
        activeSupervisorFunding = supervisor.state?.fundingMode === 'plan' ? 'plan' : supervisor.state?.fundingMode === 'credits-authorized' ? 'existing-credits-authorized' : 'blocked'
        lastModelResponseAt = typeof supervisor.state?.lastModelResponseAt === 'string' ? supervisor.state.lastModelResponseAt : lastModelResponseAt
        if (supervisorPolicyReloadPending && supervisor.state?.phase === 'wait') {
          if (process.platform !== 'win32') { await persist('attention', 'legacy_supervisor_policy_reload_requires_windows', null); return }
          if (Date.now() >= nextQuotaAt) { quota = await fetchQuota(provider); nextQuotaAt = Date.now() + 30_000 }
          if (quota && await tryLegacySupervisorHandoff(anchor, child, quota, billingSafety)) {
            child = null
            supervisorPolicyReloadPending = false
            activeSupervisorFunding = null
            await persist('starting', 'idle_legacy_supervisor_retired_for_policy_reload', Date.now() + 1_000)
            await sleep(Date.now() + 1_000)
            continue
          }
        }
        const reason = supervisorPolicyReloadPending ? 'legacy_supervisor_policy_reload_pending_verifier_preserved' : typeof supervisor.state?.reason === 'string' ? supervisor.state.reason : 'baseline_supervisor_running'
        await persist('baseline', reason, now + (options.pollMs || 30_000))
        await sleep(now + (options.pollMs || 30_000))
        continue
      }
      supervisorPolicyReloadPending = false
      activeSupervisorFunding = null
      if (child?.kind === 'supervisor') {
        const probe = await probeNativeProcess(child.pid, root)
        if (probe.alive) {
          if (now < launchedUntil && probe.inspected && probe.supervisor) { await persist('starting', 'waiting_for_supervisor_state', now + 1_000); await sleep(now + 1_000); continue }
          await persist('attention', 'supervisor_state_or_identity_unconfirmed', null)
          return
        }
        if (supervisor.state?.supervisorPid !== child.pid || !['needs-recovery', 'stop', 'stopped'].includes(String(supervisor.state.phase))) {
          failures++
          cooldownUntil = now + Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, failures - 1))
        }
        child = null
      }
      if (!plan.baselineCompleted && supervisor.state?.runId === anchor.runId && supervisor.state.inputSha256 === anchor.inputSha256) {
        if (supervisor.state.phase === 'needs-recovery' && supervisor.state.reason === 'base_all_completed_no_repeat') {
          plan.baselineCompleted = true
          child = null
          failures = 0
          await atomicSupervisorJson(planPath, plan)
        } else if (supervisor.state.phase === 'stop' || supervisor.state.phase === 'stopped' || supervisor.state.phase === 'needs-recovery') {
          await persist('attention', String(supervisor.state.reason || 'baseline_supervisor_requires_review'), null)
          return
        }
      }
      if (child?.kind === 'recovery' && plan.pendingRecovery) {
        const progress = await inspectRecoveryJobProgress(anchor, plan.pendingRecovery, now)
        const probe = await probeNativeProcess(child.pid, root)
        if (probe.alive) {
          if (!recoveryProcessMatches(probe, child, progress.receipt, plan.pendingRecovery, anchor)) {
            if (now < launchedUntil && probe.inspected && probe.recoveryVerifier) { await persist('starting', 'waiting_for_guarded_recovery_receipt', now + 1_000); await sleep(now + 1_000); continue }
            await persist('attention', 'recovery_process_identity_unconfirmed', null)
            return
          }
          child.fingerprint = probe.fingerprint
          const jobAnchor = { ...anchor, directory: progress.directory, model: plan.pendingRecovery.model, modelConfigSha256: plan.pendingRecovery.modelConfigSha256 }
          const activity = await inspectVerifierActivity(jobAnchor, progress.receipt as RunReceipt, progress.status, now)
          lastModelResponseAt = activity.lastModelResponseAt ? new Date(activity.lastModelResponseAt).toISOString() : lastModelResponseAt
          const reason = activity.lastActivityAt !== null && now - activity.lastActivityAt < MAX_SILENCE_MS ? 'guarded_recovery_running' : 'guarded_recovery_progress_requires_review'
          await persist('recovery', reason, now + (options.pollMs || 30_000))
          await sleep(now + (options.pollMs || 30_000))
          continue
        }
        const exitKey = `${child.pid}:${child.fingerprint || child.startedAt}`
        if (exitKey !== lastHandledExit) {
          lastHandledExit = exitKey
          const fatal = typeof progress.status?.fatal === 'string' ? progress.status.fatal : null
          if (/MiniMax HTTP (400|401|402|403|404)/.test(fatal || '')) { await persist('attention', 'recovery_authentication_billing_or_configuration_error', null); return }
          if (progress.pending === 0) {
            plan.finishedJobs.push(jobKey(plan.pendingRecovery))
            plan.completedRecoverySelections++
            plan.pendingRecovery = null
            failures = 0
            nextLedgerAt = 0
          } else if (/MiniMax quota|MiniMax billing safety/.test(fatal || '')) { nextQuotaAt = 0 }
          else { failures++; cooldownUntil = now + Math.min(30 * 60_000, (/MiniMax HTTP 429/.test(fatal || '') ? 600_000 : 60_000) * 2 ** Math.max(0, failures - 1)); nextQuotaAt = 0 }
          await atomicSupervisorJson(planPath, plan)
        }
        child = null
      }
      if (plan.baselineCompleted && !plan.pendingRecovery && now >= nextLedgerAt) {
        const recovery = await nextRecoveryJob(anchor, plan, now)
        plan.pendingRecovery = recovery.job
        remaining = recovery.remaining
        backlog = recovery.backlog
        nextLedgerAt = now + BACKLOG_RECHECK_MS
        if (recovery.job) await atomicSupervisorJson(recovery.job.selectorFile, recovery.job.selection.taskIds)
        await atomicSupervisorJson(planPath, plan)
      }
      const hasPendingWork = !plan.baselineCompleted || Boolean(plan.pendingRecovery)
      if (hasPendingWork && now >= nextQuotaAt) { quota = await fetchQuota(provider); nextQuotaAt = 0 }
      // Quota checkedAt is captured during the awaited query. Admission must use
      // a later clock value so a fresh exhausted window is not treated as future-dated.
      const decisionNow = Date.now()
      const action = decideWorkloadAction({ now: decisionNow, active: 'none', hasPendingWork, inputMatches, providerMatches, fatal: null, failures, cooldownUntil, quota, minimumRemainingPercent: billingSafety.minimumRemainingPercent,
        creditWindowAuthorized: Boolean(quota && authorizedCreditWindow(quota, billingSafety, decisionNow)) })
      if (action.kind === 'launch') {
        // Recheck the supervisor and pending job immediately before creating a process.
        const concurrentSupervisor = await existingSupervisor(anchor)
        if (concurrentSupervisor.unsafe || concurrentSupervisor.child) { await sleep(now + 1_000); continue }
        if (plan.pendingRecovery) {
          const progress = await inspectRecoveryJobProgress(anchor, plan.pendingRecovery, Date.now())
          if (/MiniMax HTTP (400|401|402|403|404)/.test(String(progress.status?.fatal || ''))) { await persist('attention', 'cached_recovery_authentication_billing_or_configuration_error', null); return }
          if (progress.pending === 0) { plan.finishedJobs.push(jobKey(plan.pendingRecovery)); plan.completedRecoverySelections++; plan.pendingRecovery = null; await atomicSupervisorJson(planPath, plan); nextLedgerAt = 0; continue }
          const receipt = object(progress.receipt)
          if (receipt && pidIsValid(receipt.pid)) {
            const candidate: WorkloadChild = { kind: 'recovery', pid: receipt.pid, fingerprint: null, startedAt: String(receipt.startedAt || ''), runId: plan.pendingRecovery.runId, owned: false }
            const probe = await probeNativeProcess(candidate.pid, root)
            if (probe.alive) {
              if (!recoveryProcessMatches(probe, candidate, receipt, plan.pendingRecovery, anchor)) { await persist('attention', 'existing_recovery_identity_unconfirmed', null); return }
              child = { ...candidate, fingerprint: probe.fingerprint }
              continue
            }
          }
          await ensureRecoverySelector(plan.pendingRecovery)
        }
        if (await otherLiveVerifier(anchor, !plan.baselineCompleted)) { await persist('attention', 'another_guarded_verifier_running_without_pending_owner', null); return }
        await assertMiniMaxRunning(root)
        const result = await launchLogged(root, directory, plan.pendingRecovery ? 'recovery' : 'supervisor', buildWorkloadChildLaunch(root, anchor.runId, plan.pendingRecovery))
        child = { kind: plan.pendingRecovery ? 'recovery' : 'supervisor', pid: result.child.pid!, fingerprint: null, startedAt: new Date().toISOString(), runId: plan.pendingRecovery?.runId || anchor.runId, owned: true }
        launchCount++
        launchedUntil = Date.now() + 30_000
        await persist('starting', 'guarded_child_started', Date.now() + 1_000)
        await sleep(Date.now() + 1_000)
        continue
      }
      const until = action.kind === 'wait'
        ? scheduleWorkloadQuotaCheck(decisionNow, nextQuotaAt, action.nextCheckAt || decisionNow + BACKLOG_RECHECK_MS)
        : action.nextCheckAt || decisionNow + BACKLOG_RECHECK_MS
      if (action.kind === 'wait') nextQuotaAt = until
      await persist(action.kind === 'backlog' ? 'evidence-backlog' : action.reason === 'waiting_credit_fallback_confirmation' ? 'waiting-credit-confirmation' : action.kind === 'stop' ? 'attention' : 'wait-quota', action.reason, until)
      if (action.kind === 'stop') return
      // Small internal sleeps keep human-stop handling responsive through a long quota window.
      await sleep(Math.min(until, decisionNow + 60_000))
    }
    await persist('stopped', 'human_stop_requested_children_preserved', null)
  } catch (error) {
    const reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'workload_operation_failed'
    await persist('attention', reason, null)
  } finally {
    // Preserve catalog verifiers/supervisors. Only our scoped power helper is released.
    if (power?.child.exitCode === null && power.child.signalCode === null) power.child.kill()
    power = null
    const finalStatus = lastStatus as { phase: string; reason: string; nextCheckAt: number | null } | null
    if (finalStatus) await persist(finalStatus.phase, finalStatus.reason, finalStatus.nextCheckAt).catch(() => undefined)
    process.off('SIGINT', requestStop)
    process.off('SIGTERM', requestStop)
    await lock.release()
  }
}

async function main() {
  if (process.argv.includes('--help')) { console.log('node --import tsx scripts/ingestion/minimax-workload-runner.ts --run <baseline-run-id> [--poll-ms 30000] [--keep-awake | --no-keep-awake] [--inspect]'); return }
  const options = parseWorkloadArguments(process.argv.slice(2))
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  if (options.inspect) { const readiness = await inspectWorkloadReadiness(root, options.runId); console.log(JSON.stringify(readiness, null, 2)); if (!readiness.ready) process.exitCode = 1; return }
  await runWorkloadRunner({ root, ...options })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ phase: 'attention', reason: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'workload_configuration_failed', balanceFallbackAllowed: false })); process.exitCode = 1 })
}
