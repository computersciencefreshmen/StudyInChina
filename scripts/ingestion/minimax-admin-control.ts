import { spawn, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync } from 'node:fs'
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { executorCommandSchema, executorStatusSchema, EXECUTOR_RUN_ID } from '../../src/lib/admin/executor-contract'
import type { ExecutorCommand, ExecutorStatus } from '../../src/lib/admin/types'
import { buildVerificationArguments } from '../../src/lib/admin/verification-options'
import { atomicSupervisorJson, currentInputMatches, loadAnchor, probeNativeProcess, type ProcessProbe, type SupervisorAnchor } from './minimax-quota-supervisor'
import { inspectWorkloadReadiness, type WorkloadPlan } from './minimax-workload-runner'
import { assertMiniMaxRunning, readManualControl } from './minimax-manual-control'
import { readPlanBillingSafety } from './minimax-billing-safety'

type Json = Record<string, unknown>
type CommandResult = { status: 'completed' | 'failed'; error?: string; pid?: number }
const object = (value: unknown): Json | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
const validPid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const timestamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
const reason = (value: unknown, fallback: string) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : fallback
const executeFile = promisify(execFile)
const stateDirectory = (root: string) => join(root, '.tmp', 'minimax-verification')
async function json(path: string): Promise<Json | null> {
  try { if ((await stat(/* turbopackIgnore: true */ path)).size > 64 * 1024) return null; return object(JSON.parse(await readFile(/* turbopackIgnore: true */ path, 'utf8'))) } catch { return null }
}

export type ControllerRuntime = {
  platform: string; now: () => number; probeProcess: (pid: number, root: string) => Promise<ProcessProbe>;
  terminate: (pid: number) => void; launch: (root: string, kind: 'runner' | 'verification', args: string[]) => Promise<number>;
  inspectReadiness: typeof inspectWorkloadReadiness;
  auditConfiguration?: (root: string, args: string[]) => Promise<boolean>;
  wait: (milliseconds: number) => Promise<void>;
}
async function launchLogged(root: string, kind: 'runner' | 'verification', args: string[]): Promise<number> {
  const directory = stateDirectory(root)
  await mkdir(directory, { recursive: true })
  const tag = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const stdout = openSync(/* turbopackIgnore: true */ join(directory, `admin-${kind}-${tag}.stdout.log`), 'a')
  const stderr = openSync(/* turbopackIgnore: true */ join(directory, `admin-${kind}-${tag}.stderr.log`), 'a')
  try {
    const child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, shell: false, stdio: ['ignore', stdout, stderr] })
    await new Promise<void>((done, fail) => { child.once('spawn', done); child.once('error', () => fail(new Error('executor_unavailable'))) })
    if (!child.pid) throw new Error('executor_unavailable')
    child.unref()
    return child.pid
  } finally { closeSync(stdout); closeSync(stderr) }
}
const defaultRuntime: ControllerRuntime = {
  platform: process.platform, now: Date.now, probeProcess: probeNativeProcess,
  terminate: pid => process.kill(pid, 'SIGTERM'), launch: launchLogged, inspectReadiness: inspectWorkloadReadiness,
  wait: milliseconds => new Promise(done => setTimeout(done, milliseconds)),
}

type ManagedProcess = { pid: number; fingerprint: string; kind: 'runner' | 'supervisor' | 'verification' }
type Inventory = { processes: ManagedProcess[]; unsafe: boolean; rawRunner: Json | null; rawSupervisor: Json | null; baselineRunId: string | null }
function birthMatches(probe: ProcessProbe, startedAt: unknown) {
  const started = Date.parse(String(startedAt || ''))
  const created = Date.parse(probe.createdAt || '')
  return probe.alive && probe.inspected && Boolean(probe.fingerprint) && Number.isFinite(started) && Number.isFinite(created) && created <= started && started - created <= 120_000
}
/** A PID alone is never sufficient: script/root, receipt/lock identity and OS birth must agree. */
async function inventory(root: string, runtime: ControllerRuntime): Promise<Inventory> {
  const directory = stateDirectory(root)
  const [rawRunner, rawSupervisor, runnerLock, supervisorLock] = await Promise.all([
    json(join(directory, 'workload-state.json')), json(join(directory, 'supervisor-state.json')),
    json(join(directory, 'workload-runner.lock.json')), json(join(directory, 'supervisor.lock.json')),
  ])
  const processes: ManagedProcess[] = []
  let unsafe = false
  const baselineRunId = typeof rawRunner?.baselineRunId === 'string' && EXECUTOR_RUN_ID.test(rawRunner.baselineRunId) ? rawRunner.baselineRunId
    : typeof rawSupervisor?.runId === 'string' && EXECUTOR_RUN_ID.test(rawSupervisor.runId) ? rawSupervisor.runId : null
  for (const [kind, saved, lock, pidKey] of [['runner', rawRunner, runnerLock, 'runnerPid'], ['supervisor', rawSupervisor, supervisorLock, 'supervisorPid']] as const) {
    const pid = lock?.ownerPid ?? saved?.[pidKey]
    if (!validPid(pid)) continue
    const probe = await runtime.probeProcess(pid, root)
    if (!probe.alive) continue
    if (probe.inspected && !probe.workloadRunner && !probe.supervisor) continue // An old PID reused by another application.
    const runId = kind === 'runner' ? saved?.baselineRunId : saved?.runId
    const verified = Boolean(saved && lock && lock.schemaVersion === 1 && lock.ownerPid === pid && saved[pidKey] === pid &&
      lock.runId === runId && typeof runId === 'string' && EXECUTOR_RUN_ID.test(runId) && lock.fingerprint === probe.fingerprint &&
      (kind === 'runner' ? probe.workloadRunner && saved.runnerFingerprint === probe.fingerprint : probe.supervisor) && birthMatches(probe, lock.startedAt))
    if (verified) processes.push({ pid, fingerprint: probe.fingerprint!, kind })
    else unsafe = true
  }
  const verificationRoot = join(root, '.official-harvest', 'minimax-verification')
  const entries = await readdir(/* turbopackIgnore: true */ verificationRoot, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !EXECUTOR_RUN_ID.test(entry.name)) continue
    const runDirectory = join(verificationRoot, entry.name)
    const [receipt, manifest] = await Promise.all([json(join(runDirectory, 'run-receipt.json')), json(join(runDirectory, 'manifest.json'))])
    if (!validPid(receipt?.pid)) continue
    const probe = await runtime.probeProcess(receipt.pid, root)
    if (!probe.alive) continue
    if (probe.inspected && !probe.adminVerifier && !probe.verifier && !probe.recoveryVerifier) continue
    const verified = Boolean(manifest && receipt && /^[a-f0-9]{64}$/.test(String(receipt.inputSha256)) && /^[a-f0-9]{64}$/.test(String(receipt.modelConfigSha256)) && receipt.inputSha256 === manifest.inputSha256 &&
      receipt.model === manifest.model && receipt.modelConfigSha256 === manifest.modelConfigSha256 && receipt.selectedRecords === manifest.selectedRecords &&
      (probe.adminVerifier || probe.verifier || probe.recoveryVerifier) && birthMatches(probe, receipt.startedAt))
    if (verified) processes.push({ pid: receipt.pid, fingerprint: probe.fingerprint!, kind: 'verification' })
    else unsafe = true
  }
  // A child may not have written its own lock/receipt yet. Keep that startup gap
  // exclusive, but never use the parent launch PID as authority to signal it.
  const pendingLaunch = await json(join(directory, 'admin-launch.json'))
  if (validPid(pendingLaunch?.pid) && !processes.some(item => item.pid === pendingLaunch.pid)) {
    const probe = await runtime.probeProcess(pendingLaunch.pid, root)
    if (probe.alive && (!probe.inspected || probe.adminVerifier || probe.verifier || probe.recoveryVerifier || probe.workloadRunner)) unsafe = true
  }
  return { processes: [...new Map(processes.map(item => [item.pid, item])).values()], unsafe, rawRunner, rawSupervisor, baselineRunId }
}

export async function readExecutorStatus(root = process.cwd(), runtime = defaultRuntime): Promise<ExecutorStatus> {
  root = resolve(root)
  const [control, observed, policy] = await Promise.all([readManualControl(root), inventory(root, runtime), readPlanBillingSafety(root)])
  const latest = await json(join(stateDirectory(root), 'admin-command-latest.json'))
  const quota = object(observed.rawRunner?.quota ?? observed.rawSupervisor?.quota)
  const fiveHour = object(quota?.fiveHour), weekly = object(quota?.weekly)
  const percentage = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 100 ? value : null
  const checkedAt = timestamp(quota?.checkedAt)
  const activeVerifierCount = observed.processes.filter(item => item.kind === 'verification').length
  const runnerAlive = observed.processes.some(item => item.kind === 'runner')
  return executorStatusSchema.parse({
    executorId: /^[a-zA-Z0-9_-]{1,64}$/.test(process.env.ADMIN_EXECUTOR_ID || '') ? process.env.ADMIN_EXECUTOR_ID : 'studyinchina-local-minimax',
    observedAt: new Date(runtime.now()).toISOString(), connected: true, desiredState: control.desiredState,
    phase: observed.unsafe ? 'attention' : control.desiredState === 'paused' ? activeVerifierCount ? 'pausing' : 'paused' : observed.processes.length ? reason(observed.rawRunner?.phase ?? observed.rawSupervisor?.phase, 'running') : 'idle',
    reason: observed.unsafe ? 'process_identity_unconfirmed' : control.desiredState === 'paused' ? 'human_pause_requested' : observed.processes.length ? reason(observed.rawRunner?.reason ?? observed.rawSupervisor?.reason, 'executor_ready') : 'executor_ready',
    baselineRunId: observed.baselineRunId, runnerAlive, supervisorAlive: observed.processes.some(item => item.kind === 'supervisor'),
    activeVerifierCount, controlAcknowledgedAt: latest?.status === 'completed' ? timestamp(latest.updatedAt) : null,
    pauseMayHaveInFlightRequest: control.desiredState === 'paused' && (activeVerifierCount > 0 || observed.unsafe || latest?.pauseMayHaveInFlightRequest === true),
    creditFallbackAuthorized: policy.allowExistingCredits, policyReloadPending: observed.rawRunner?.supervisorPolicyReloadPending === true,
    keepAwake: runnerAlive && object(observed.rawRunner?.keepAwake)?.systemRequired === true,
    quota: quota && checkedAt ? { state: ['available', 'exhausted', 'unknown'].includes(String(quota.state)) ? quota.state : 'unknown', checkedAt,
      fiveHourRemainingPercent: percentage(fiveHour?.remainingPercent), weeklyRemainingPercent: percentage(weekly?.remainingPercent), resetAt: timestamp(fiveHour?.resetAt) } : null,
    latestCommand: latest && typeof latest.commandId === 'string' ? { commandId: latest.commandId, action: latest.action, status: latest.status,
      updatedAt: latest.updatedAt, error: typeof latest.error === 'string' ? reason(latest.error, 'control_operation_failed') : null } : null,
  })
}

async function stopManagedProcesses(root: string, runtime: ControllerRuntime): Promise<boolean> {
  const observed = await inventory(root, runtime)
  if (runtime.platform !== 'win32' && observed.processes.length) throw new Error('legacy_pause_requires_windows')
  // First close launch coordinators; then re-scan to include any child created during handoff.
  for (const kind of ['runner', 'supervisor', 'verification'] as const) {
    const current = await inventory(root, runtime)
    for (const candidate of current.processes.filter(item => item.kind === kind)) {
      const probe = await runtime.probeProcess(candidate.pid, root)
      if (!probe.alive) continue
      if (!probe.inspected || probe.fingerprint !== candidate.fingerprint) throw new Error('process_identity_unconfirmed')
      runtime.terminate(candidate.pid)
      for (let attempt = 0; attempt < 20 && (await runtime.probeProcess(candidate.pid, root)).alive; attempt++) await runtime.wait(100)
      if ((await runtime.probeProcess(candidate.pid, root)).alive) throw new Error('pause_process_confirmation_failed')
    }
  }
  const remaining = await inventory(root, runtime)
  if (remaining.unsafe || remaining.processes.length) throw new Error('pause_process_confirmation_failed')
  return observed.processes.some(item => item.kind === 'verification')
}

/** Catalog edits create a new input identity; an old run is never silently resumed against it. */
export async function selectExecutorBaseline(root: string, previousRunId: string | null): Promise<SupervisorAnchor> {
  const directory = join(root, '.official-harvest', 'minimax-verification')
  const entries = await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name)).map(async entry => ({
    runId: entry.name, manifest: await json(join(directory, entry.name, 'manifest.json')),
  })))
  const runIds = [previousRunId, ...candidates.sort((left, right) => Date.parse(String(right.manifest?.createdAt || '')) - Date.parse(String(left.manifest?.createdAt || ''))).map(item => item.runId)]
  for (const runId of new Set(runIds)) {
    if (!runId) continue
    try {
      const anchor = await loadAnchor(root, runId)
      if (await currentInputMatches(anchor)) return anchor
    } catch { /* Only complete, full, quota-guarded baseline manifests are eligible. */ }
  }
  throw new Error(previousRunId ? 'catalog_snapshot_changed' : 'executor_baseline_unavailable')
}

function freshWorkloadPlan(anchor: SupervisorAnchor): WorkloadPlan {
  return { schemaVersion: 1, baselineRunId: anchor.runId, inputSha256: anchor.inputSha256,
    baselineCompleted: false, pendingRecovery: null, finishedJobs: [], completedRecoverySelections: 0 }
}

async function inspectWorkloadPlanTransition(root: string, anchor: SupervisorAnchor, observed: Inventory) {
  const directory = stateDirectory(root), path = join(directory, 'workload-plan.json')
  if (!existsSync(/* turbopackIgnore: true */ path)) return null
  const previous = await json(path)
  if (previous?.baselineRunId === anchor.runId && previous.inputSha256 === anchor.inputSha256) return null
  if (!previous || previous.schemaVersion !== 1 || !EXECUTOR_RUN_ID.test(String(previous.baselineRunId)) || !/^[a-f0-9]{64}$/.test(String(previous.inputSha256)) ||
    typeof previous.baselineCompleted !== 'boolean' || !Array.isArray(previous.finishedJobs) || !Number.isSafeInteger(previous.completedRecoverySelections) || Number(previous.completedRecoverySelections) < 0) throw new Error('workload_plan_identity_invalid')
  // A coordinator owns its plan until it exits. Archive only after process identity checks.
  if (observed.unsafe || observed.processes.some(item => item.kind !== 'verification')) throw new Error('verification_already_running')
  return { path, previous, nextPlan: freshWorkloadPlan(anchor) }
}

async function commitWorkloadPlanTransition(root: string, transition: NonNullable<Awaited<ReturnType<typeof inspectWorkloadPlanTransition>>>) {
  if (JSON.stringify(await json(transition.path)) !== JSON.stringify(transition.previous)) throw new Error('workload_plan_identity_invalid')
  const history = join(stateDirectory(root), 'admin-workload-plan-history')
  await mkdir(history, { recursive: true })
  await atomicSupervisorJson(join(history, `${transition.previous.baselineRunId}-${randomUUID()}.json`), transition.previous)
  await atomicSupervisorJson(transition.path, transition.nextPlan)
}

async function resumeWorkload(root: string, runtime: ControllerRuntime): Promise<void> {
  const observed = await inventory(root, runtime)
  if (observed.unsafe) throw new Error('process_identity_unconfirmed')
  if (observed.processes.some(item => item.kind === 'runner')) return
  const anchor = await selectExecutorBaseline(root, observed.baselineRunId)
  const runId = anchor.runId
  const transition = await inspectWorkloadPlanTransition(root, anchor, observed)
  const readiness = await runtime.inspectReadiness(root, runId, transition?.nextPlan)
  if (!readiness.ready) throw new Error('workload_readiness_failed')
  const refreshed = await inventory(root, runtime)
  if (refreshed.unsafe) throw new Error('process_identity_unconfirmed')
  if (refreshed.processes.some(item => item.kind === 'runner')) return
  await assertMiniMaxRunning(root)
  if (transition) {
    if (refreshed.processes.some(item => item.kind !== 'verification')) throw new Error('verification_already_running')
    await commitWorkloadPlanTransition(root, transition)
  }
  const pid = await runtime.launch(root, 'runner', ['--import', 'tsx', join(root, 'scripts', 'ingestion', 'minimax-workload-runner.ts'), '--run', runId])
  await atomicSupervisorJson(join(stateDirectory(root), 'admin-launch.json'), { pid, kind: 'runner', runId, startedAt: new Date(runtime.now()).toISOString() })
}

async function startVerification(command: ExecutorCommand, root: string, runtime: ControllerRuntime): Promise<number> {
  const observed = await inventory(root, runtime)
  if (observed.unsafe) throw new Error('process_identity_unconfirmed')
  if (observed.processes.length) throw new Error('verification_already_running')
  const useCcSwitch = process.env.ADMIN_VERIFICATION_USE_CCSWITCH === 'true'
  // Each administrator start owns its checkpoints. A sample must not overwrite a full baseline.
  const args = [...buildVerificationArguments(command.options!, useCcSwitch), '--invocation-id', command.commandId]
  const cli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script = join(root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts')
  if (runtime.auditConfiguration) {
    if (!await runtime.auditConfiguration(root, args)) throw new Error('executor_unavailable')
  } else {
    if (!existsSync(/* turbopackIgnore: true */ cli) || !existsSync(/* turbopackIgnore: true */ script)) throw new Error('executor_unavailable')
    try {
      const { stdout } = await executeFile(process.execPath, [cli, script, '--audit-config', ...args], { cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 16_384 })
      if (JSON.parse(stdout.trim()).configured !== true) throw new Error('executor_unavailable')
    } catch { throw new Error('executor_unavailable') }
  }
  const refreshed = await inventory(root, runtime)
  if (refreshed.unsafe || refreshed.processes.length) throw new Error('verification_already_running')
  // An explicit start authorizes this selected run even after an operator pause.
  // Keep the pause intact if configuration validation or exclusivity checks fail.
  await atomicSupervisorJson(join(stateDirectory(root), 'manual-control.json'), { schemaVersion: 1, desiredState: 'running', commandId: command.commandId, updatedAt: new Date(runtime.now()).toISOString() })
  await assertMiniMaxRunning(root)
  const pid = await runtime.launch(root, 'verification', [cli, script, ...args])
  await atomicSupervisorJson(join(stateDirectory(root), 'admin-launch.json'), { pid, kind: 'verification', startedAt: new Date(runtime.now()).toISOString() })
  return pid
}

/** Each durable receipt makes delivery retries idempotent; fixed typed commands never select a shell. */
export async function executeExecutorCommand(value: ExecutorCommand, root = process.cwd(), runtime = defaultRuntime): Promise<CommandResult> {
  const parsed = executorCommandSchema.safeParse(value)
  if (!parsed.success) return { status: 'failed', error: 'invalid_request' }
  const command = parsed.data
  root = resolve(root)
  const directory = stateDirectory(root), receiptPath = join(directory, 'admin-commands', `${command.commandId}.json`)
  await mkdir(join(directory, 'admin-commands'), { recursive: true })
  const lockPath = join(directory, 'admin-control.lock.json')
  let lock
  try { lock = await open(lockPath, 'wx') } catch {
    const previousLock = await json(lockPath)
    if (!validPid(previousLock?.ownerPid) || (await runtime.probeProcess(previousLock.ownerPid, root)).alive) return { status: 'failed', error: 'control_busy' }
    // A separate exclusive reclaim file serializes recovery after a controller crash.
    let reclaim
    try { reclaim = await open(`${lockPath}.reclaim`, 'wx') } catch { return { status: 'failed', error: 'control_busy' } }
    try {
      if (JSON.stringify(await json(lockPath)) !== JSON.stringify(previousLock)) return { status: 'failed', error: 'control_busy' }
      await unlink(lockPath)
      try { lock = await open(lockPath, 'wx') } catch { return { status: 'failed', error: 'control_busy' } }
    } finally { await reclaim.close(); await unlink(`${lockPath}.reclaim`).catch(() => undefined) }
  }
  try {
    await lock.writeFile(JSON.stringify({ ownerPid: process.pid, commandId: command.commandId }))
    const previous = await json(receiptPath)
    if (previous) {
      if (JSON.stringify(previous.command) !== JSON.stringify(command)) return { status: 'failed', error: 'command_id_conflict' }
      if (previous.status === 'completed' || previous.status === 'failed') return { status: previous.status, ...(typeof previous.error === 'string' ? { error: previous.error } : {}), ...(validPid(previous.pid) ? { pid: previous.pid } : {}) }
      return { status: 'failed', error: 'command_outcome_requires_review' }
    }
    const updatedAt = new Date(runtime.now()).toISOString()
    await atomicSupervisorJson(receiptPath, { command, status: 'claimed', updatedAt })
    let result: CommandResult = { status: 'completed' }
    let pauseMayHaveInFlightRequest = false
    try {
      if (command.action === 'pause' || command.action === 'resume') {
        await atomicSupervisorJson(join(directory, 'manual-control.json'), { schemaVersion: 1, desiredState: command.action === 'pause' ? 'paused' : 'running', commandId: command.commandId, updatedAt })
      }
      if (command.action === 'pause') pauseMayHaveInFlightRequest = await stopManagedProcesses(root, runtime)
      else if (command.action === 'resume') await resumeWorkload(root, runtime)
      else {
        const pid = await startVerification(command, root, runtime)
        result = { status: 'completed', pid }
      }
    } catch (error) {
      result = { status: 'failed', error: reason(error instanceof Error ? error.message : null, 'control_operation_failed') }
    }
    const completedAt = new Date(runtime.now()).toISOString()
    await atomicSupervisorJson(receiptPath, { command, ...result, updatedAt: completedAt })
    await atomicSupervisorJson(join(directory, 'admin-command-latest.json'), { commandId: command.commandId, action: command.action, ...result, updatedAt: completedAt, pauseMayHaveInFlightRequest })
    return result
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined) }
}
