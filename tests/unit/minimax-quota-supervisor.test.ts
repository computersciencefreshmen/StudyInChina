import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { normalizeQuota } from '../../scripts/ingestion/minimax-quota'
import { acquireSupervisorLock, buildVerifierLaunch, currentInputMatches, decideSupervisorAction, inspectCheckpoints, inspectVerifierActivity, observeSupervisorClock, preparedBaselineSafety, processMatchesReceipt, readBaselineReceipt, receiptMatchesAnchor, verifierRestartDelay, verifierSourceConfiguration, windowsProcessProbe, type ProcessProbe, type RunReceipt, type SupervisorAnchor, type SupervisorObservation } from '../../scripts/ingestion/minimax-quota-supervisor'

const now = Date.parse('2026-10-01T18:00:00Z')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const anchor: SupervisorAnchor = { root: 'C:/project', directory: 'C:/project/.official-harvest/minimax-verification/9dd414cb9cb419af', runId: '9dd414cb9cb419af', inputSha256: 'a'.repeat(64), modelConfigSha256: 'b'.repeat(64), model: 'MiniMax-M3', providerId: 'provider-test', endpoint: 'https://api.minimaxi.com/anthropic/v1/messages', promptVersion: 'catalog-comparison-v1.2', sourceChars: 25000, totalRecords: 5031, taskIds: new Set(['programs:one', 'programs:two']) }
const receipt: RunReceipt = { pid: 29772, startedAt: '2026-10-01T16:53:27.655Z', inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, providerId: anchor.providerId, endpoint: anchor.endpoint, quotaGuard: true, selectedRecords: 5031 }
const alive: ProcessProbe = { alive: true, inspected: true, fingerprint: '29772:2026-10-01T16:53:26.000Z', createdAt: '2026-10-01T16:53:26.000Z', verifier: true, supervisor: false }
const dead: ProcessProbe = { alive: false, inspected: false, fingerprint: null, createdAt: null, verifier: false, supervisor: false }
function quota(fiveHour = 100, weekly = 100) {
  return normalizeQuota({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', start_time: Date.parse('2026-10-01T16:00:00Z'), end_time: Date.parse('2026-10-01T21:00:00Z'), weekly_start_time: Date.parse('2026-09-27T16:00:00Z'), weekly_end_time: Date.parse('2026-10-04T16:00:00Z'), current_interval_remaining_percent: fiveHour, current_weekly_remaining_percent: weekly }] }, 'MiniMax-M3', now)
}
function observation(overrides: Partial<SupervisorObservation> = {}): SupervisorObservation {
  return { now, totalRecords: 5031, inventory: { completedRecords: 612, modelErrorRecords: 0, unconfirmedFields: 20, expiredCompletedRecords: 0 }, active: 'none', currentInputMatches: true, providerMatches: true, verifierSupportsResume: true, fatal: null, cooldownUntil: 0, noProgressFailures: 0, quota: quota(), ...overrides }
}

describe('MiniMax finite baseline supervision decisions', () => {
  it('monitors an adopted healthy guarded process without launching another even at zero quota', () => {
    expect(decideSupervisorAction(observation({ active: 'verified', quota: quota(0) }))).toMatchObject({ kind: 'monitor', reason: 'guarded_verifier_running' })
  })
  it('starts pending baseline work only when both plan windows are positively confirmed', () => {
    expect(decideSupervisorAction(observation())).toMatchObject({ kind: 'launch' })
  })
  it('waits until the official five-hour reset and still requires a new quota query', () => {
    expect(decideSupervisorAction(observation({ quota: quota(0) }))).toEqual({ kind: 'wait', reason: 'five_hour_quota_exhausted', nextCheckAt: Date.parse('2026-10-01T21:00:05Z') })
    expect(decideSupervisorAction(observation({ now: Date.parse('2026-10-01T21:00:06Z'), quota: null })).kind).toBe('wait')
  })
  it('waits for the weekly reset when the weekly pool is empty', () => {
    expect(decideSupervisorAction(observation({ quota: quota(90, 0) })).nextCheckAt).toBe(Date.parse('2026-10-04T16:00:05Z'))
  })
  it('permits known exhausted windows only with explicit existing-credit authorization', () => {
    expect(decideSupervisorAction(observation({ quota: quota(0), allowExistingCredits: true, creditsWindowConfirmed: true }))).toMatchObject({ kind: 'launch', reason: 'authorized_existing_credits_and_pending_base_tasks' })
    expect(decideSupervisorAction(observation({ quota: quota(90, 0), allowExistingCredits: true, creditsWindowConfirmed: true }))).toMatchObject({ kind: 'launch', reason: 'authorized_existing_credits_and_pending_base_tasks' })
    expect(decideSupervisorAction(observation({ quota: quota(0), allowExistingCredits: true, creditsWindowConfirmed: false })).kind).toBe('wait')
    expect(decideSupervisorAction(observation({ quota: quota(0), allowExistingCredits: false })).kind).toBe('wait')
    expect(decideSupervisorAction(observation({ quota: normalizeQuota({}, 'MiniMax-M3', now), allowExistingCredits: true }))).toMatchObject({ kind: 'wait', reason: 'quota_unknown_no_model_calls' })
  })
  it('does not call a model when a quota schema is unknown', () => {
    expect(decideSupervisorAction(observation({ quota: normalizeQuota({}, 'MiniMax-M3', now) }))).toMatchObject({ kind: 'wait', reason: 'quota_unknown_no_model_calls', nextCheckAt: now + 300000 })
  })
  it('waits for credit-fallback confirmation at the margin and resumes after reset or confirmation', () => {
    const margin = observation({ quota: quota(5), fatal: 'MiniMax quota credit_fallback_confirmation_required' })
    expect(decideSupervisorAction(margin)).toMatchObject({ kind: 'wait', reason: 'credit_fallback_confirmation_required', nextCheckAt: now + 300_000 })
    expect(decideSupervisorAction({ ...margin, quota: quota(100) }).kind).toBe('launch')
    expect(decideSupervisorAction({ ...margin, minimumRemainingPercent: 0 }).kind).toBe('launch')
    expect(decideSupervisorAction(observation({ quota: quota(0), minimumRemainingPercent: 0 }))).toMatchObject({ kind: 'wait', reason: 'five_hour_quota_exhausted' })
  })
  it.each(['quota_http_401', 'quota_http_403', 'unsafe_quota_configuration'])('stops with an actionable signal on %s', reason => {
    expect(decideSupervisorAction(observation({ quota: { ...normalizeQuota({}, 'MiniMax-M3', now), reason } }))).toMatchObject({ kind: 'stop', reason: 'quota_authentication_or_configuration_error' })
  })
  it('backs off for at least ten minutes after a quota 429', () => {
    expect(decideSupervisorAction(observation({ quota: { ...normalizeQuota({}, 'MiniMax-M3', now), reason: 'quota_http_429' } }))).toMatchObject({ kind: 'wait', nextCheckAt: now + 600000 })
  })
  it.each([{ currentInputMatches: false }, { providerMatches: false }, { active: 'unsafe' as const }])('never launches into a different snapshot, provider or process identity', overrides => {
    expect(decideSupervisorAction(observation(overrides)).kind).toBe('stop')
  })
  it('hands off completed base work to recovery instead of spending quota on another all pass', () => {
    expect(decideSupervisorAction(observation({ inventory: { completedRecords: 5031, modelErrorRecords: 0, unconfirmedFields: 999, expiredCompletedRecords: 5031 } }))).toMatchObject({ kind: 'needs-recovery', reason: 'base_all_completed_no_repeat' })
  })
  it('hands only known transient model errors to the qualified single-record recovery queue', () => {
    expect(decideSupervisorAction(observation({ inventory: { completedRecords: 5013, modelErrorRecords: 18, recoveryEligibleRecords: 18, unconfirmedFields: 999, expiredCompletedRecords: 0 }, noProgressFailures: 3 })))
      .toMatchObject({ kind: 'needs-recovery', reason: 'base_all_completed_no_repeat' })
    expect(decideSupervisorAction(observation({ inventory: { completedRecords: 5013, modelErrorRecords: 18, recoveryEligibleRecords: 17, unconfirmedFields: 999, expiredCompletedRecords: 0 } })).kind).toBe('launch')
    expect(decideSupervisorAction(observation({ inventory: { completedRecords: 5031, modelErrorRecords: 0, unconfirmedFields: 0, expiredCompletedRecords: 0 }, fatal: 'MiniMax HTTP 402' })).kind).toBe('stop')
  })
  it('does not silently repeat successful records beyond the maximum allowed checkpoint age', () => {
    expect(decideSupervisorAction(observation({ inventory: { completedRecords: 612, modelErrorRecords: 0, unconfirmedFields: 20, expiredCompletedRecords: 1 } })).kind).toBe('needs-recovery')
  })
  it('waits for the resume feature and honors model restart cooldown', () => {
    expect(decideSupervisorAction(observation({ verifierSupportsResume: false })).reason).toBe('waiting_for_safe_resume_flag')
    expect(decideSupervisorAction(observation({ cooldownUntil: now + 600000 })).nextCheckAt).toBe(now + 600000)
  })
  it('stops authentication errors and repeated failures without progress', () => {
    expect(decideSupervisorAction(observation({ fatal: 'MiniMax HTTP 401' })).kind).toBe('stop')
    expect(decideSupervisorAction(observation({ fatal: 'MiniMax HTTP 402', allowExistingCredits: true }))).toMatchObject({ kind: 'stop', reason: 'verifier_authentication_billing_or_configuration_error' })
    expect(decideSupervisorAction(observation({ noProgressFailures: 3 }))).toMatchObject({ kind: 'stop', reason: 'repeated_verifier_failure_without_progress', nextCheckAt: null })
  })
  it('keeps supervision alive without killing or duplicating a silent verifier', () => {
    expect(decideSupervisorAction(observation({ active: 'verified', lastActivityAt: now - 10 * 60_000 })).kind).toBe('monitor')
    expect(decideSupervisorAction(observation({ active: 'verified', lastActivityAt: now - 30 * 60_000 }))).toMatchObject({ kind: 'monitor', reason: 'stalled_guarded_verifier_attention_required' })
    expect(decideSupervisorAction(observation({ active: 'verified', lastActivityAt: null })).kind).toBe('monitor')
  })
  it('keeps a silent live child monitored, then resumes only after confirmed exit and positive quota', () => {
    const silent = observation({ active: 'verified', lastActivityAt: now - 3 * 3_600_000 });
    expect(decideSupervisorAction(silent).kind).toBe('monitor');
    expect(decideSupervisorAction({ ...silent, active: 'none', quota: null }).kind).toBe('wait');
    expect(decideSupervisorAction({ ...silent, active: 'none', quota: quota(0) }).kind).toBe('wait');
    expect(decideSupervisorAction({ ...silent, active: 'none', quota: quota() }).kind).toBe('launch');
    expect(decideSupervisorAction({ ...silent, active: 'unsafe', quota: quota() }).kind).toBe('stop');
  });
  it('never replaces a silent live child even when quota is exhausted or unknown', () => {
    for (const currentQuota of [null, quota(0), normalizeQuota({}, 'MiniMax-M3', now)]) {
      expect(decideSupervisorAction(observation({ active: 'verified', lastActivityAt: null, quota: currentQuota })).kind).toBe('monitor');
    }
  });
  it('gives paused scheduling a fresh three-minute grace period and resumes monitoring', () => {
    const clock = observeSupervisorClock(now, now - 3 * 3_600_000, now - 3_600_000)
    expect(clock).toEqual({ gapDetected: true, lastLoopAt: now, resumeGraceUntil: now + 180_000 })
    expect(decideSupervisorAction(observation({ active: 'verified', lastActivityAt: now - 3 * 3_600_000, resumeGraceUntil: clock.resumeGraceUntil }))).toMatchObject({ kind: 'monitor', reason: 'guarded_verifier_resume_grace' })
    expect(decideSupervisorAction(observation({ active: 'verified', now: now + 180_001, lastActivityAt: now + 179_000, resumeGraceUntil: clock.resumeGraceUntil }))).toMatchObject({ kind: 'monitor', reason: 'guarded_verifier_running' })
  })
  it('does not continually extend grace during ordinary polling and handles backward clock jumps', () => {
    expect(observeSupervisorClock(now, now - 30_000, now + 60_000)).toEqual({ gapDetected: false, lastLoopAt: now, resumeGraceUntil: now + 60_000 })
    expect(observeSupervisorClock(now, now + 1000, 0).gapDetected).toBe(true)
  })
  it('uses one-minute retries, bounded rate-limit backoff, and an hour pause after three failures', () => {
    expect(verifierRestartDelay(1)).toBe(60_000)
    expect(verifierRestartDelay(2)).toBe(120_000)
    expect(verifierRestartDelay(1, true)).toBe(600_000)
    expect(verifierRestartDelay(2, true)).toBe(1_200_000)
    expect(verifierRestartDelay(3)).toBe(3_600_000)
    expect(verifierRestartDelay(30, true)).toBe(3_600_000)
  })
})

describe('Guarded run and Windows process identities', () => {
  it('adopts only the exact snapshot, provider, model configuration, full scope and guarded receipt', () => {
    expect(receiptMatchesAnchor(receipt, anchor)).toBe(true)
    for (const change of [{ quotaGuard: false }, { inputSha256: 'c'.repeat(64) }, { modelConfigSha256: 'c'.repeat(64) }, { selectedRecords: 1 }, { providerId: 'another' }, { pid: -1 }]) expect(receiptMatchesAnchor({ ...receipt, ...change }, anchor)).toBe(false)
  })
  it('rejects reused PIDs, unknown process inspections and foreign executables', () => {
    expect(processMatchesReceipt(alive, receipt)).toBe(true)
    expect(processMatchesReceipt({ ...alive, createdAt: '2026-10-01T18:00:00Z' }, receipt)).toBe(false)
    expect(processMatchesReceipt({ ...alive, createdAt: '2026-10-01T16:00:00Z' }, receipt)).toBe(false)
    expect(processMatchesReceipt(alive, receipt, 'different-process-fingerprint')).toBe(false)
    expect(processMatchesReceipt({ ...alive, verifier: false }, receipt)).toBe(false)
    expect(processMatchesReceipt({ ...alive, inspected: false }, receipt)).toBe(false)
  })
  it('uses the current Node binary, hidden windows, quota guard, and bounded seven-day checkpoint reuse', () => {
    const launch = buildVerifierLaunch('C:/project')
    expect(launch.executable).toBe(process.execPath)
    expect(launch.options).toEqual({ cwd: 'C:/project', windowsHide: true })
    expect(launch.args.slice(0, 2)).toEqual(['--import', 'tsx'])
    expect(launch.args).toContain('--quota-guard')
    expect(launch.args.slice(-2)).toEqual(['--checkpoint-max-age-hours', '168'])
    expect(launch.args).not.toContain('--retry-unconfirmed')
    expect(launch.args.join(' ')).not.toMatch(/API_KEY|AUTH_TOKEN|Bearer/)
  })
  it('parses actual verifier declarations and rejects missing or invalid constants', async () => {
    const source = await readFile(resolve('scripts/ingestion/verify-catalog-minimax.ts'), 'utf8')
    expect(verifierSourceConfiguration(source)).toEqual({ promptVersion: anchor.promptVersion, sourceChars: anchor.sourceChars, supportsResume: true })
    expect(verifierSourceConfiguration("const PROMPT_VERSION = 'test'; const SOURCE_CHARS = 25_000; --checkpoint-max-age-hours --quota-guard")).toEqual({ promptVersion: 'test', sourceChars: 25000, supportsResume: true })
    expect(verifierSourceConfiguration('const SOURCE_CHARS = d_').sourceChars).toBeNull()
    expect(verifierSourceConfiguration('const SOURCE_CHARS = 0').sourceChars).toBeNull()
  })
  it('requires the actual Node executable, exact script argument and exact guard flags', () => {
    const details = { createdAt: alive.createdAt, executablePath: 'C:/Program Files/nodejs/node.exe', commandLine: '"C:/Program Files/nodejs/node.exe" --import tsx "C:/project/scripts/ingestion/verify-catalog-minimax.ts" --use-ccswitch --all --quota-guard' }
    const probe = (changes: Record<string, unknown> = {}) => windowsProcessProbe(receipt.pid, { ...details, ...changes }, 'C:/project', 'C:/Program Files/nodejs/node.exe')
    expect(probe()).toMatchObject({ inspected: true, verifier: true, supervisor: false })
    expect(probe({ executablePath: 'C:/other/tool.exe' }).verifier).toBe(false)
    expect(probe({ commandLine: details.commandLine.replace('C:/project/', 'C:/other-project/') }).verifier).toBe(false)
    expect(probe({ commandLine: details.commandLine.replace('--all', '--all-other') }).verifier).toBe(false)
    expect(probe({ commandLine: details.commandLine.replace('--quota-guard', '--quota-guard-disabled') }).verifier).toBe(false)
    expect(probe({ commandLine: details.commandLine.replace('"C:/project/scripts/ingestion/verify-catalog-minimax.ts"', 'scripts/ingestion/verify-catalog-minimax.ts') }).verifier).toBe(true)
    expect(probe({ commandLine: details.commandLine.replace('--all', '--task-ids-file ids.json --recovery-from 9dd414cb9cb419af') })).toMatchObject({ verifier: false, recoveryVerifier: true })
    expect(probe({ commandLine: '"C:/Program Files/nodejs/node.exe" --import tsx "C:/project/scripts/ingestion/minimax-workload-runner.ts" --run 9dd414cb9cb419af' }).workloadRunner).toBe(true)
  })
})

describe('Supervisor local lock and immutable checkpoint inventory', () => {
  let temporaryRoot: string
  beforeAll(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), 'minimax-supervisor-')) })
  afterAll(async () => {
    const target = resolve(temporaryRoot)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('minimax-supervisor-')) throw new Error('Unsafe test cleanup path')
    await rm(target, { recursive: true, force: true })
  })
  const owner = (nonce: string, ownerPid = 1) => ({ schemaVersion: 1 as const, ownerPid, fingerprint: 'original-process', nonce, runId: '9dd414cb9cb419af', startedAt: '2026-10-01T16:53:27Z' })
  it('prevents a second live supervisor and releases only its own lock', async () => {
    const path = join(temporaryRoot, 'live-lock.json')
    const first = await acquireSupervisorLock(path, owner('one'), vi.fn(async () => ({ ...alive, fingerprint: 'original-process' })))
    await expect(acquireSupervisorLock(path, owner('two', 2), vi.fn(async () => ({ ...alive, fingerprint: 'original-process' })))).rejects.toThrow('supervisor_already_running')
    await first.release()
    const second = await acquireSupervisorLock(path, owner('two', 2), vi.fn(async () => dead))
    await second.release()
  })
  it('reclaims a dead owner without mistaking a reused PID for the previous supervisor', async () => {
    const path = join(temporaryRoot, 'dead-lock.json')
    await writeFile(path, JSON.stringify(owner('old')))
    const next = await acquireSupervisorLock(path, owner('next', 2), vi.fn(async () => ({ ...alive, fingerprint: 'new-foreign-process' })))
    expect(JSON.parse(await readFile(path, 'utf8')).nonce).toBe('next')
    await next.release()
  })
  it('fails closed for an uninspectable live owner', async () => {
    const path = join(temporaryRoot, 'unknown-lock.json')
    await writeFile(path, JSON.stringify(owner('old')))
    await expect(acquireSupervisorLock(path, owner('next', 2), vi.fn(async () => ({ ...alive, inspected: false })))).rejects.toThrow('supervisor_already_running')
  })
  it('counts only matching hash-named checkpoints, keeping API errors pending', async () => {
    const directory = join(temporaryRoot, 'run')
    await mkdir(join(directory, 'records'), { recursive: true })
    const base = { checkedAt: new Date(now - 1000).toISOString(), inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, verdicts: [{ status: 'unconfirmed' }], issues: [] }
    await writeFile(join(directory, 'records', `${sha('programs:one')}.json`), JSON.stringify({ ...base, taskId: 'programs:one' }))
    await writeFile(join(directory, 'records', `${sha('programs:two')}.json`), JSON.stringify({ ...base, taskId: 'programs:two', issues: ['MiniMax quota exhausted'] }))
    await writeFile(join(directory, 'records', `${sha('foreign')}.json`), JSON.stringify({ ...base, taskId: 'foreign' }))
    expect(await inspectCheckpoints({ ...anchor, directory }, now)).toEqual({ completedRecords: 1, modelErrorRecords: 1, unconfirmedFields: 2, expiredCompletedRecords: 0, recoveryEligibleRecords: 0 })
  })
  it('bootstraps only an absent receipt with no execution artifacts and no live verifier', async () => {
    const directory = join(temporaryRoot, 'prepared-run')
    await mkdir(directory, { recursive: true })
    const selected = { ...anchor, directory }
    const clear = vi.fn(async () => ({ inspected: true, activeVerifiers: 0 }))
    expect(await readBaselineReceipt(selected)).toEqual({ kind: 'missing', receipt: null })
    expect(await preparedBaselineSafety(selected, clear)).toBe(true)
    expect(await preparedBaselineSafety(selected, async () => ({ inspected: false, activeVerifiers: 0 }))).toBe(false)
    expect(await preparedBaselineSafety(selected, async () => ({ inspected: true, activeVerifiers: 1 }))).toBe(false)
    await writeFile(join(directory, 'status.json'), '{}')
    expect(await preparedBaselineSafety(selected, clear)).toBe(false)
  })
  it('rejects malformed, null and foreign receipts instead of treating them as never started', async () => {
    const directory = join(temporaryRoot, 'invalid-receipt-run')
    await mkdir(directory, { recursive: true })
    const selected = { ...anchor, directory }
    const clear = vi.fn(async () => ({ inspected: true, activeVerifiers: 0 }))
    for (const text of ['{', 'null', '{}', JSON.stringify({ ...receipt, selectedRecords: 20 }), JSON.stringify({ ...receipt, inputSha256: 'c'.repeat(64) })]) {
      await writeFile(join(directory, 'run-receipt.json'), text)
      expect(await readBaselineReceipt(selected)).toEqual({ kind: 'invalid', receipt: null })
      expect(await preparedBaselineSafety(selected, clear)).toBe(false)
    }
    expect(clear).not.toHaveBeenCalled()
    await writeFile(join(directory, 'run-receipt.json'), JSON.stringify(receipt))
    expect(await readBaselineReceipt(selected)).toEqual({ kind: 'valid', receipt })
    expect(await preparedBaselineSafety(selected, clear)).toBe(false)
  })
  it('separates fresh model defects from admission, authentication and unknown failures', async () => {
    const directory = join(temporaryRoot, 'transient-run')
    await mkdir(join(directory, 'records'), { recursive: true })
    const base = { checkedAt: new Date(now - 1000).toISOString(), inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, sourceIds: ['official'], verdicts: [{ status: 'unconfirmed' }] }
    const save = async (issues: string[], checkedAt = base.checkedAt) => writeFile(join(directory, 'records', `${sha('programs:one')}.json`), JSON.stringify({ ...base, taskId: 'programs:one', issues, checkedAt }))
    for (const issues of [['MiniMax HTTP 500'], ['MiniMax response invalid JSON', 'official: timeout'], ['Unexpected end of JSON input']]) {
      await save(issues)
      expect(await inspectCheckpoints({ ...anchor, directory }, now)).toMatchObject({ completedRecords: 0, modelErrorRecords: 1, recoveryEligibleRecords: 1 })
    }
    for (const issues of [['MiniMax HTTP 429'], ['MiniMax quota unknown'], ['MiniMax HTTP 401'], ['MiniMax HTTP 500', 'unknown transport']]) {
      await save(issues)
      expect(await inspectCheckpoints({ ...anchor, directory }, now)).toMatchObject({ completedRecords: 0, modelErrorRecords: 1, recoveryEligibleRecords: 0 })
    }
    await save(['MiniMax HTTP 500'], new Date(now + 1).toISOString())
    expect(await inspectCheckpoints({ ...anchor, directory }, now)).toMatchObject({ recoveryEligibleRecords: 0 })
  })
  it('requires targeted handling for future-dated checkpoints that the verifier cannot reuse', async () => {
    const directory = join(temporaryRoot, 'future-run')
    await mkdir(join(directory, 'records'), { recursive: true })
    await writeFile(join(directory, 'records', `${sha('programs:one')}.json`), JSON.stringify({ checkedAt: new Date(now + 1000).toISOString(), inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, taskId: 'programs:one', verdicts: [], issues: [] }))
    expect(await inspectCheckpoints({ ...anchor, directory }, now)).toMatchObject({ completedRecords: 1, expiredCompletedRecords: 1 })
  })
  it('records genuine matching model responses separately from recent source-only activity', async () => {
    const directory = join(temporaryRoot, 'activity-run')
    await mkdir(join(directory, 'sources'), { recursive: true })
    await mkdir(join(directory, 'responses'), { recursive: true })
    const sourceTime = now - 1000
    await writeFile(join(directory, 'sources', `${sha('source')}.json`), JSON.stringify({ sourceId: 'official-source', checkedAt: new Date(sourceTime).toISOString(), status: 'unconfirmed' }))
    await writeFile(join(directory, 'responses', `${sha('wrong-model')}.json`), JSON.stringify({ modelConfigSha256: 'c'.repeat(64), model: anchor.model, checkedAt: new Date(now - 100).toISOString(), output: { results: [] } }))
    await writeFile(join(directory, 'responses', `${sha('invalid-response')}.json`), JSON.stringify({ modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, checkedAt: new Date(now - 100).toISOString() }))
    const selected = { ...anchor, directory }
    const status = { pid: receipt.pid, inputSha256: anchor.inputSha256, modelConfigSha256: anchor.modelConfigSha256, updatedAt: new Date(now + 1000).toISOString() }
    expect(await inspectVerifierActivity(selected, receipt, status, now)).toEqual({ lastActivityAt: sourceTime, lastSourceReceiptAt: sourceTime, lastModelResponseAt: null })
    const modelTime = now - 100
    await writeFile(join(directory, 'responses', `${sha('response')}.json`), JSON.stringify({ modelConfigSha256: anchor.modelConfigSha256, model: anchor.model, checkedAt: new Date(modelTime).toISOString(), output: { results: [] } }))
    expect(await inspectVerifierActivity(selected, receipt, status, now)).toEqual({ lastActivityAt: modelTime, lastSourceReceiptAt: sourceTime, lastModelResponseAt: modelTime })
  })
  it('requires the current six public data files to match the saved snapshot before spawning', async () => {
    const root = join(temporaryRoot, 'project')
    await mkdir(join(root, 'content', 'data'), { recursive: true })
    const files = ['universities', 'programs', 'admission-cycles', 'scholarships', 'cities', 'sources']
    const data = Object.fromEntries(files.map(file => [file, []]))
    for (const file of files) await writeFile(join(root, 'content', 'data', `${file}.json`), '[]')
    const selected = { ...anchor, root, inputSha256: sha(JSON.stringify({ data, promptVersion: anchor.promptVersion, sourceChars: anchor.sourceChars })) }
    expect(await currentInputMatches(selected)).toBe(true)
    await writeFile(join(root, 'content', 'data', 'programs.json'), '[{"id":"new-program"}]')
    expect(await currentInputMatches(selected)).toBe(false)
  })
})
