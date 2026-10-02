import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildKeepAwakeLaunch, buildRecoveryJob, buildWorkloadChildLaunch, DAILY_USEFUL_TOKEN_TARGET,
  decideWorkloadAction, ensureRecoverySelector, inspectRecoveryJobProgress, legacySupervisorPolicyReloadPending, parseWorkloadArguments, readWorkloadPlan, tryLegacySupervisorHandoff,
  recoveryExecution, recoveryProcessMatches, scheduleWorkloadQuotaCheck, type WorkloadChild, type WorkloadObservation, type WorkloadPlan,
} from '../../scripts/ingestion/minimax-workload-runner'
import { acquireSupervisorLock, type ProcessProbe, type SupervisorAnchor } from '../../scripts/ingestion/minimax-quota-supervisor'
import { normalizeQuota } from '../../scripts/ingestion/minimax-quota'
import { authorizedCreditWindow, normalizePlanBillingSafety } from '../../scripts/ingestion/minimax-billing-safety'

const now = Date.parse('2026-10-02T00:00:00Z')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const anchor: SupervisorAnchor = { root: resolve('.'), directory: resolve('.official-harvest/minimax-verification/9dd414cb9cb419af'), runId: '9dd414cb9cb419af', inputSha256: '9dd414cb9cb419af' + 'a'.repeat(48),
  model: 'MiniMax-M3', modelConfigSha256: 'b'.repeat(64), providerId: 'provider', endpoint: 'https://api.minimax.cn/anthropic/v1/messages', promptVersion: 'catalog-comparison-v1.2', sourceChars: 25000, totalRecords: 2,
  taskIds: new Set(['programs:a', 'programs:b']) }
const dead: ProcessProbe = { alive: false, inspected: false, fingerprint: null, createdAt: null, verifier: false, supervisor: false }
const alive: ProcessProbe = { ...dead, alive: true, inspected: true, fingerprint: '42:2026-10-01T23:59:58.000Z', createdAt: '2026-10-01T23:59:58.000Z', recoveryVerifier: true }
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe workload test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

function quota(fiveHour = 100, weekly = 100) {
  return normalizeQuota({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', start_time: now - 60_000, end_time: now - 60_000 + 5 * 3_600_000,
    weekly_start_time: now - 60_000, weekly_end_time: now - 60_000 + 7 * 24 * 3_600_000, current_interval_remaining_percent: fiveHour, current_weekly_remaining_percent: weekly }] }, 'MiniMax-M3', now)
}
function observation(change: Partial<WorkloadObservation> = {}): WorkloadObservation {
  return { now, active: 'none', hasPendingWork: true, inputMatches: true, providerMatches: true, fatal: null, failures: 0, cooldownUntil: 0, quota: quota(), minimumRemainingPercent: 5, ...change }
}
async function fixture() {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'minimax-workload-test-'))
  temporaryDirectories.push(root)
  return { root, anchor: { ...anchor, root, directory: join(root, '.official-harvest/minimax-verification', anchor.runId) } }
}

describe('MiniMax useful workload admission', () => {
  it('keeps an existing guarded child without duplicating it even if quota is zero', () => {
    expect(decideWorkloadAction(observation({ active: 'verified', quota: quota(0) }))).toMatchObject({ kind: 'monitor' })
  })
  it('launches useful work only with positively confirmed plan quota', () => {
    expect(decideWorkloadAction(observation())).toMatchObject({ kind: 'launch', reason: 'positive_safe_plan_quota_and_useful_pending_work' })
    expect(decideWorkloadAction(observation({ quota: null })).kind).toBe('wait')
    expect(decideWorkloadAction(observation({ quota: normalizeQuota({}, 'MiniMax-M3', now) })).kind).toBe('wait')
  })
  it('waits for the official exhausted window rather than restarting tightly', () => {
    expect(decideWorkloadAction(observation({ quota: quota(0) })).nextCheckAt).toBe(now - 60_000 + 5 * 3_600_000 + 5_000)
    expect(decideWorkloadAction(observation({ quota: quota(50, 0) })).nextCheckAt).toBe(now - 60_000 + 7 * 24 * 3_600_000 + 5_000)
  })
  it('uses authorized existing credits only with a separately established fresh exhausted window', () => {
    expect(decideWorkloadAction(observation({ quota: quota(0), creditWindowAuthorized: true }))).toMatchObject({ kind: 'launch', reason: 'existing_credits_authorized_plan_exhausted' })
    expect(decideWorkloadAction(observation({ quota: normalizeQuota({}, 'MiniMax-M3', now), creditWindowAuthorized: true })).kind).toBe('wait')
    expect(decideWorkloadAction(observation({ quota: quota(0), creditWindowAuthorized: false })).kind).toBe('wait')
  })
  it('admits the fresh exhausted window using the clock after its quota query completes', () => {
    const checkedAt = now + 2_000
    const exhausted = { ...quota(0), checkedAt: new Date(checkedAt).toISOString() }
    const policy = normalizePlanBillingSafety({ schemaVersion: 1, allowExistingCredits: true, source: 'user-authorization', authorizedAt: new Date(now - 1_000).toISOString() })
    expect(authorizedCreditWindow(exhausted, policy, now)).toBe(false)
    const decisionNow = checkedAt + 100
    expect(decideWorkloadAction(observation({ now: decisionNow, quota: exhausted, creditWindowAuthorized: authorizedCreditWindow(exhausted, policy, decisionNow) }))).toMatchObject({ kind: 'launch', reason: 'existing_credits_authorized_plan_exhausted' })
    expect(authorizedCreditWindow(exhausted, policy, checkedAt + 30_001)).toBe(false)
  })
  it('retries unavailable and rate-limited quota at their original deadlines despite repeated state refreshes', () => {
    for (const reason of ['quota_http_500', 'quota_http_429']) {
      const unavailable = { ...quota(), state: 'unknown' as const, canRun: false, reason }
      const first = decideWorkloadAction(observation({ quota: unavailable }))
      let deadline = scheduleWorkloadQuotaCheck(now, 0, first.nextCheckAt!)
      const originalDeadline = deadline
      for (let tick = now + 60_000; tick < originalDeadline; tick += 60_000) {
        const action = decideWorkloadAction(observation({ now: tick, quota: unavailable }))
        deadline = scheduleWorkloadQuotaCheck(tick, deadline, action.nextCheckAt!)
        expect(deadline).toBe(originalDeadline)
      }
      expect(originalDeadline).toBe(now + (reason === 'quota_http_429' ? 600_000 : 300_000))
      const freshFailure = decideWorkloadAction(observation({ now: originalDeadline, quota: unavailable }))
      expect(scheduleWorkloadQuotaCheck(originalDeadline, 0, freshFailure.nextCheckAt!)).toBeGreaterThan(originalDeadline)
    }
  })
  it('preserves a margin without billing authorization and supports an explicitly safe zero floor', () => {
    expect(decideWorkloadAction(observation({ quota: quota(5) }))).toMatchObject({ kind: 'wait', reason: 'waiting_credit_fallback_confirmation' })
    expect(decideWorkloadAction(observation({ quota: quota(3), minimumRemainingPercent: 0 })).kind).toBe('launch')
  })
  it('backs off rate limits and terminates unsafe/authentication configurations', () => {
    expect(decideWorkloadAction(observation({ quota: { ...quota(), state: 'unknown', canRun: false, reason: 'quota_http_429' } }))).toMatchObject({ kind: 'wait', nextCheckAt: now + 600_000 })
    for (const fatal of ['MiniMax HTTP 401', 'MiniMax HTTP 402', 'MiniMax HTTP 403', 'configuration failure']) expect(decideWorkloadAction(observation({ fatal })).kind).toBe('stop')
    expect(decideWorkloadAction(observation({ quota: { ...quota(), reason: 'quota_http_403' } })).kind).toBe('stop')
    for (const change of [{ active: 'unsafe' as const }, { inputMatches: false }, { providerMatches: false }, { failures: 3 }]) expect(decideWorkloadAction(observation(change)).kind).toBe('stop')
  })
  it('does not pad API usage when the useful task queue is empty', () => {
    expect(DAILY_USEFUL_TOKEN_TARGET).toBe(144_000_000)
    expect(decideWorkloadAction(observation({ hasPendingWork: false, quota: quota(100) }))).toMatchObject({ kind: 'backlog', reason: 'no_actionable_evidence_work_no_api_padding' })
    expect(decideWorkloadAction(observation({ cooldownUntil: now + 120_000 }))).toMatchObject({ kind: 'wait', nextCheckAt: now + 120_000 })
  })
})

describe('MiniMax immutable selections and public model identity', () => {
  it('separates adaptive M3 recovery identity from the frozen disabled baseline', () => {
    const result = recoveryExecution(anchor)
    expect(result.options).toEqual({ thinking: 'adaptive' })
    expect(result.configuration.thinking).toBe('adaptive')
    expect(JSON.stringify(result.configuration)).not.toMatch(/key|Bearer/)
    expect(recoveryExecution({ ...anchor, model: 'MiniMax-M2.7' }).options).toEqual({})
    const first = buildRecoveryJob(anchor, ['programs:b', 'programs:a'], 'c'.repeat(64))
    const second = buildRecoveryJob(anchor, ['programs:a', 'programs:b'], 'c'.repeat(64))
    expect(first).toEqual(second)
    expect(first.runId).toMatch(/^9dd414cb9cb419af-[a-f0-9]{12}-r[a-f0-9]{12}$/)
    expect(first.selection.taskIds).toEqual(['programs:a', 'programs:b'])
    expect(() => buildRecoveryJob(anchor, ['programs:unknown'], 'c'.repeat(64))).toThrow()
    expect(() => buildRecoveryJob(anchor, ['programs:a'], 'invalid')).toThrow()
  })
  it('launches absolute hidden supervisor and exact guarded single-record recovery commands', () => {
    const supervisor = buildWorkloadChildLaunch(anchor.root, anchor.runId, null)
    expect(supervisor.executable).toBe(process.execPath)
    expect(supervisor.options.windowsHide).toBe(true)
    expect(supervisor.args).toContain(join(anchor.root, 'scripts/ingestion/minimax-quota-supervisor.ts'))
    const job = buildRecoveryJob(anchor, ['programs:a'], 'c'.repeat(64))
    const recovery = buildWorkloadChildLaunch(anchor.root, anchor.runId, job)
    expect(recovery.args).toContain(join(anchor.root, 'scripts/ingestion/verify-catalog-minimax.ts'))
    for (const flag of ['--quota-guard', '--use-ccswitch', '--task-ids-file', '--retry-unconfirmed', '--recovery-from']) expect(recovery.args).toContain(flag)
    expect(recovery.args[recovery.args.indexOf('--batch-size') + 1]).toBe('1')
    expect(recovery.args[recovery.args.indexOf('--thinking') + 1]).toBe('adaptive')
    expect(recovery.args.join(' ')).not.toMatch(/API_KEY|AUTH_TOKEN|Bearer/)
  })
  it('requires exact PID creation-time, model, provider and selection receipts before adoption', () => {
    const job = buildRecoveryJob(anchor, ['programs:a'], 'c'.repeat(64))
    const child: WorkloadChild = { kind: 'recovery', pid: 42, fingerprint: alive.fingerprint, startedAt: new Date(now).toISOString(), runId: job.runId, owned: true }
    const receipt = { pid: 42, startedAt: new Date(now).toISOString(), inputSha256: anchor.inputSha256, model: job.model, modelConfigSha256: job.modelConfigSha256,
      providerId: anchor.providerId, endpoint: anchor.endpoint, quotaGuard: true, selectedRecords: 1, selection: job.selection }
    expect(recoveryProcessMatches(alive, child, receipt, job, anchor)).toBe(true)
    for (const changed of [{ pid: 99 }, { quotaGuard: false }, { providerId: 'other' }, { selectedRecords: 2 }, { modelConfigSha256: 'd'.repeat(64) }, { selection: { ...job.selection, taskIds: ['programs:b'] } }]) expect(recoveryProcessMatches(alive, child, { ...receipt, ...changed }, job, anchor)).toBe(false)
    for (const changed of [{ fingerprint: 'reused-pid' }, { recoveryVerifier: false }, { inspected: false }, { createdAt: new Date(now + 10_000).toISOString() }]) expect(recoveryProcessMatches({ ...alive, ...changed }, child, receipt, job, anchor)).toBe(false)
  })
  it('keeps a durable pending selection unchanged on restart and rejects corrupt or changed plans', async () => {
    const { root, anchor: local } = await fixture()
    const file = join(root, 'workload-plan.json')
    const job = buildRecoveryJob(local, ['programs:a'], 'c'.repeat(64))
    const plan: WorkloadPlan = { schemaVersion: 1, baselineRunId: local.runId, inputSha256: local.inputSha256, baselineCompleted: true, pendingRecovery: job, finishedJobs: [], completedRecoverySelections: 0 }
    await writeFile(file, JSON.stringify(plan))
    expect(await readWorkloadPlan(file, local)).toEqual(plan)
    await writeFile(file, JSON.stringify({ ...plan, pendingRecovery: { ...job, selectorFile: join(root, 'another.json') } }))
    await expect(readWorkloadPlan(file, local)).rejects.toThrow('identity')
    await writeFile(file, '{truncated')
    await expect(readWorkloadPlan(file, local)).rejects.toThrow('invalid')
    expect((await readWorkloadPlan(join(root, 'absent.json'), local)).baselineCompleted).toBe(false)
  })
  it('retains quota-interrupted records as pending while bounding actual failed attempts', async () => {
    const { root, anchor: local } = await fixture()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Progress inspection must not fetch') }))
    const job = buildRecoveryJob(local, ['programs:a', 'programs:b'], 'c'.repeat(64))
    const directory = join(root, '.official-harvest/minimax-verification', job.runId, 'records')
    await mkdir(directory, { recursive: true })
    const record = { inputSha256: local.inputSha256, model: job.model, modelConfigSha256: job.modelConfigSha256, checkedAt: new Date(now - 1_000).toISOString(), verdicts: [] }
    await writeFile(join(directory, `${hash('programs:a')}.json`), JSON.stringify({ ...record, taskId: 'programs:a', issues: ['MiniMax quota exhausted'] }))
    await writeFile(join(directory, `${hash('programs:b')}.json`), JSON.stringify({ ...record, taskId: 'programs:b', issues: ['MiniMax HTTP 500'] }))
    expect(await inspectRecoveryJobProgress(local, job, now)).toMatchObject({ completed: 1, pending: 1 })
    await writeFile(join(directory, `${hash('programs:a')}.json`), JSON.stringify({ ...record, taskId: 'programs:a', issues: [] }))
    expect(await inspectRecoveryJobProgress(local, job, now)).toMatchObject({ completed: 2, pending: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('restores only the exact persisted selector when absent and rejects altered membership', async () => {
    const { anchor: local } = await fixture()
    const job = buildRecoveryJob(local, ['programs:a'], 'c'.repeat(64))
    await ensureRecoverySelector(job)
    expect(JSON.parse(await readFile(job.selectorFile, 'utf8'))).toEqual(['programs:a'])
    await ensureRecoverySelector(job)
    await writeFile(job.selectorFile, JSON.stringify(['programs:b']))
    await expect(ensureRecoverySelector(job)).rejects.toThrow('identity_changed')
  })
})

describe('Scoped keep-awake and exclusive runner ownership', () => {
  it('uses a hidden native power request scoped to the exact parent process, with explicit release', () => {
    const launch = buildKeepAwakeLaunch(42, new Date(now).toISOString(), 'C:/project/.tmp/power.json', '11111111-1111-4111-8111-111111111111')
    expect(launch.options.windowsHide).toBe(true)
    expect(launch.args).toContain('-WindowStyle')
    expect(launch.args[launch.args.indexOf('-WindowStyle') + 1]).toBe('Hidden')
    const code = launch.args.at(-1)!
    expect(code).toContain('Get-Process -Id 42')
    expect(code).toContain('owner_creation_mismatch')
    expect(code).toContain('PowerCreateRequest')
    expect(code).toContain('PowerSetRequest($requestHandle, 1)')
    expect(code).toContain('PowerSetRequest($requestHandle, 3)')
    expect(code).toContain('WaitForExit(1000)')
    expect(code).toContain('PowerClearRequest($requestHandle, 1)')
    expect(code).toContain('PowerClearRequest($requestHandle, 3)')
    expect(code).toContain('CloseHandle($requestHandle)')
    expect(code).not.toMatch(/powercfg|Set-ItemProperty|ES_DISPLAY_REQUIRED/)
    expect(() => buildKeepAwakeLaunch(-1, new Date(now).toISOString(), 'path', 'nonce')).toThrow()
  })
  it('defaults keep-awake on and accepts only explicit supported arguments', () => {
    expect(parseWorkloadArguments(['--run', anchor.runId])).toEqual({ runId: anchor.runId, pollMs: 30000, keepAwake: true, inspect: false })
    expect(parseWorkloadArguments(['--run', anchor.runId, '--no-keep-awake', '--inspect']).keepAwake).toBe(false)
    for (const args of [[], ['--run', '../escape'], ['--run', anchor.runId, '--poll-ms', '1'], ['--run', anchor.runId, '--run', anchor.runId], ['--run', anchor.runId, '--keep-awake', '--no-keep-awake'], ['--run', anchor.runId, '--inspect', '--inspect']]) expect(() => parseWorkloadArguments(args)).toThrow()
  })
  it('refuses a second runner while the exact owner lives and releases only its own lock', async () => {
    const { root } = await fixture()
    const path = join(root, 'runner.lock.json')
    const owner = { schemaVersion: 1 as const, ownerPid: 42, fingerprint: alive.fingerprint!, nonce: 'first', runId: anchor.runId, startedAt: new Date(now).toISOString() }
    const first = await acquireSupervisorLock(path, owner, async () => alive)
    await expect(acquireSupervisorLock(path, { ...owner, ownerPid: 43, nonce: 'second' }, async () => alive)).rejects.toThrow('already_running')
    expect(JSON.parse(await readFile(path, 'utf8')).nonce).toBe('first')
    await first.release()
    const recovered = await acquireSupervisorLock(path, { ...owner, ownerPid: 43, nonce: 'second' }, async () => dead)
    await recovered.release()
  })
})

describe('Legacy supervisor billing-policy handoff', () => {
  async function handoffFixture() {
    const { root, anchor: local } = await fixture()
    const directory = join(root, '.tmp/minimax-verification')
    await mkdir(directory, { recursive: true })
    await mkdir(local.directory, { recursive: true })
    const exhausted = quota(0)
    const policy = normalizePlanBillingSafety({ schemaVersion: 1, allowExistingCredits: true, source: 'user-authorization', authorizedAt: new Date(now - 1_000).toISOString() })
    const child: WorkloadChild = { kind: 'supervisor', pid: 43, fingerprint: '43:2026-10-01T23:59:58.000Z', startedAt: new Date(now - 1_000).toISOString(), runId: local.runId, owned: false }
    const owner: ProcessProbe = { ...alive, fingerprint: child.fingerprint, recoveryVerifier: false, supervisor: true }
    const state = { supervisorPid: child.pid, runId: local.runId, inputSha256: local.inputSha256, modelConfigSha256: local.modelConfigSha256, phase: 'wait', childPid: null,
      balanceFallbackAllowed: false, reason: exhausted.reason, quota: exhausted, updatedAt: new Date(now).toISOString(), nextCheckAt: new Date(Date.parse(exhausted.fiveHour.resetAt!) + 5_000).toISOString() }
    const lock = { ownerPid: child.pid, runId: local.runId, fingerprint: child.fingerprint, nonce: 'original' }
    const receipt = { pid: 42, startedAt: new Date(now - 1_000).toISOString(), inputSha256: local.inputSha256, modelConfigSha256: local.modelConfigSha256, model: local.model,
      providerId: local.providerId, endpoint: local.endpoint, quotaGuard: true, selectedRecords: local.totalRecords }
    const statePath = join(directory, 'supervisor-state.json')
    const lockPath = join(directory, 'supervisor.lock.json')
    const receiptPath = join(local.directory, 'run-receipt.json')
    await writeFile(statePath, JSON.stringify(state))
    await writeFile(lockPath, JSON.stringify(lock))
    await writeFile(receiptPath, JSON.stringify(receipt))
    const terminate = vi.fn()
    const probeProcess = vi.fn(async (pid: number) => pid === child.pid ? owner : dead)
    const runtime = { platform: 'win32' as const, now: () => now, probeProcess, terminate }
    return { anchor: local, child, exhausted, policy, state, lock, receipt, statePath, lockPath, receiptPath, owner, runtime, terminate }
  }
  it('exposes a pending policy reload only for positively identified legacy plan-only state', async () => {
    const value = await handoffFixture()
    expect(legacySupervisorPolicyReloadPending(value.state, value.policy)).toBe(true)
    expect(legacySupervisorPolicyReloadPending({ ...value.state, billingSafety: value.policy }, value.policy)).toBe(false)
    expect(legacySupervisorPolicyReloadPending({ ...value.state, fundingMode: 'plan' }, value.policy)).toBe(false)
    expect(legacySupervisorPolicyReloadPending(value.state, normalizePlanBillingSafety(null))).toBe(false)
  })
  it('retires only the exact idle legacy supervisor and preserves its verifier receipt and lock', async () => {
    const value = await handoffFixture()
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(true)
    expect(value.terminate).toHaveBeenCalledExactlyOnceWith(43)
    expect(JSON.parse(await readFile(value.lockPath, 'utf8'))).toEqual(value.lock)
    expect(JSON.parse(await readFile(value.receiptPath, 'utf8'))).toEqual(value.receipt)
  })
  it('preserves a healthy verifier, a monitoring supervisor and all non-Windows processes', async () => {
    const value = await handoffFixture()
    value.runtime.probeProcess.mockImplementation(async pid => pid === 43 ? value.owner : alive)
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(false)
    value.runtime.probeProcess.mockImplementation(async pid => pid === 43 ? value.owner : dead)
    await writeFile(value.statePath, JSON.stringify({ ...value.state, phase: 'monitor', childPid: 42 }))
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(false)
    await writeFile(value.statePath, JSON.stringify(value.state))
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, { ...value.runtime, platform: 'linux' })).toBe(false)
    expect(value.terminate).not.toHaveBeenCalled()
  })
  it('requires fresh exhausted quota, current authorization, unchanged owner and exact frozen receipt identity', async () => {
    const value = await handoffFixture()
    for (const exhausted of [quota(), { ...value.exhausted, state: 'unknown' as const }, { ...value.exhausted, checkedAt: new Date(now - 30_001).toISOString() }]) {
      expect(await tryLegacySupervisorHandoff(value.anchor, value.child, exhausted, value.policy, value.runtime)).toBe(false)
    }
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, normalizePlanBillingSafety(null), value.runtime)).toBe(false)
    await writeFile(value.lockPath, JSON.stringify({ ...value.lock, fingerprint: 'reused-pid' }))
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(false)
    await writeFile(value.lockPath, JSON.stringify(value.lock))
    await writeFile(value.receiptPath, JSON.stringify({ ...value.receipt, modelConfigSha256: 'different-model' }))
    expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(false)
    expect(value.terminate).not.toHaveBeenCalled()
  })
  it('refuses changed ownership, a new live child or a new receipt during the final handoff checks', async () => {
    for (const change of ['lock', 'child', 'receipt']) {
      const value = await handoffFixture()
      let ownerProbes = 0
      value.runtime.probeProcess.mockImplementation(async pid => {
        if (pid === 43) {
          ownerProbes++
          if (ownerProbes === 3 && change === 'lock') await writeFile(value.lockPath, JSON.stringify({ ...value.lock, nonce: 'replacement' }))
          if (ownerProbes === 3 && change === 'receipt') await writeFile(value.receiptPath, JSON.stringify({ ...value.receipt, pid: 44 }))
          return value.owner
        }
        return change === 'child' && ownerProbes >= 2 ? alive : dead
      })
      expect(await tryLegacySupervisorHandoff(value.anchor, value.child, value.exhausted, value.policy, value.runtime)).toBe(false)
      expect(value.terminate).not.toHaveBeenCalled()
    }
  })
})
