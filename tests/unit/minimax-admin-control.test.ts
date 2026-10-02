import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { executeExecutorCommand, readExecutorStatus, selectExecutorBaseline, type ControllerRuntime } from '../../scripts/ingestion/minimax-admin-control'
import { assertMiniMaxRunning, readManualControl } from '../../scripts/ingestion/minimax-manual-control'
import { compareBatch } from '../../scripts/ingestion/verify-catalog-minimax'
import type { ProcessProbe } from '../../scripts/ingestion/minimax-quota-supervisor'

let root: string
const startedAt = '2026-10-02T09:00:01.000Z'
const createdAt = '2026-10-02T09:00:00.000Z'
const baseline = '9dd414cb9cb419af'
const dead: ProcessProbe = { alive: false, inspected: false, fingerprint: null, createdAt: null, verifier: false, supervisor: false }
async function save(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'minimax-admin-control-')) })
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

async function saveBaseline(label: string, current: boolean, guarded = true) {
  const files = ['universities', 'programs', 'admission-cycles', 'scholarships', 'cities', 'sources']
  const data = Object.fromEntries(files.map(file => [file, file === 'universities' ? [{ id: label }] : []]))
  const promptVersion = 'test-v1', sourceChars = 1000
  const inputSha256 = createHash('sha256').update(JSON.stringify({ data, promptVersion, sourceChars })).digest('hex')
  const runId = inputSha256.slice(0, 16), directory = join(root, '.official-harvest/minimax-verification', runId)
  await save(join(directory, 'manifest.json'), { schemaVersion: 3, inputSha256, promptVersion, maxSourceChars: sourceChars,
    modelConfigSha256: 'a'.repeat(64), model: 'MiniMax-M3', providerId: 'test-provider', endpoint: 'https://api.minimax.io/anthropic/v1/messages',
    totalRecords: 1, selectedRecords: 1, quotaGuard: guarded, requestedModelOptions: {}, createdAt: startedAt })
  await save(join(directory, 'input-snapshot.json'), data)
  await save(join(directory, 'queue.json'), [{ taskId: `university:${label}` }])
  if (current) for (const file of files) await save(join(root, 'content/data', `${file}.json`), data[file])
  return { runId, inputSha256 }
}

async function fixture() {
  const directory = join(root, '.tmp', 'minimax-verification')
  const probes = new Map<number, ProcessProbe>([
    [101, { ...dead, alive: true, inspected: true, fingerprint: `101:${createdAt}`, createdAt, workloadRunner: true }],
    [102, { ...dead, alive: true, inspected: true, fingerprint: `102:${createdAt}`, createdAt, supervisor: true }],
    [103, { ...dead, alive: true, inspected: true, fingerprint: `103:${createdAt}`, createdAt, adminVerifier: true }],
  ])
  await save(join(directory, 'workload-runner.lock.json'), { schemaVersion: 1, ownerPid: 101, fingerprint: probes.get(101)!.fingerprint, runId: baseline, startedAt })
  await save(join(directory, 'workload-state.json'), { runnerPid: 101, runnerFingerprint: probes.get(101)!.fingerprint, baselineRunId: baseline, phase: 'baseline', reason: 'running', keepAwake: { systemRequired: true } })
  await save(join(directory, 'supervisor.lock.json'), { schemaVersion: 1, ownerPid: 102, fingerprint: probes.get(102)!.fingerprint, runId: baseline, startedAt })
  await save(join(directory, 'supervisor-state.json'), { supervisorPid: 102, runId: baseline, phase: 'monitor', reason: 'running' })
  const run = join(root, '.official-harvest', 'minimax-verification', `${baseline}-r${'d'.repeat(12)}`)
  const manifest = { inputSha256: 'a'.repeat(64), modelConfigSha256: 'b'.repeat(64), model: 'MiniMax-M3', selectedRecords: 2 }
  await save(join(run, 'manifest.json'), manifest)
  await save(join(run, 'run-receipt.json'), { ...manifest, pid: 103, startedAt, quotaGuard: true })
  const terminated: number[] = []
  const runtime: ControllerRuntime = {
    platform: 'win32', now: () => Date.parse('2026-10-02T09:01:00Z'),
    probeProcess: vi.fn(async pid => probes.get(pid) ?? dead),
    terminate: vi.fn(pid => {
      expect(JSON.parse(readFileSync(join(directory, 'manual-control.json'), 'utf8')).desiredState).toBe('paused')
      terminated.push(pid); probes.set(pid, dead)
    }),
    launch: vi.fn(async () => 104), inspectReadiness: vi.fn(), wait: vi.fn(async () => {}),
  }
  return { runtime, probes, terminated, directory }
}

describe('MiniMax operator control', () => {
  it('fails closed on malformed control and preserves authorized work when no marker exists', async () => {
    expect((await readManualControl(root)).desiredState).toBe('running')
    await save(join(root, '.tmp/minimax-verification/manual-control.json'), { desiredState: 'running' })
    await expect(assertMiniMaxRunning(root)).rejects.toThrow('MiniMax manually paused')
  })
  it('writes pause before stopping coordinators then recovery verifiers, with idempotent delivery', async () => {
    const { runtime, terminated } = await fixture()
    const command = { commandId: randomUUID(), action: 'pause' as const }
    expect(await executeExecutorCommand(command, root, runtime)).toEqual({ status: 'completed' })
    expect(terminated).toEqual([101, 102, 103])
    expect(await executeExecutorCommand(command, root, runtime)).toEqual({ status: 'completed' })
    expect(terminated).toHaveLength(3)
    expect(await readExecutorStatus(root, runtime)).toMatchObject({ desiredState: 'paused', phase: 'paused', activeVerifierCount: 0, pauseMayHaveInFlightRequest: true })
  })
  it('does not signal a reused PID or claim that an unconfirmed process stopped', async () => {
    const { runtime, probes, terminated } = await fixture()
    probes.set(103, { ...probes.get(103)!, fingerprint: '103:2026-10-02T10:00:00Z', createdAt: '2026-10-02T10:00:00Z' })
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'pause' }, root, runtime)).toEqual({ status: 'failed', error: 'pause_process_confirmation_failed' })
    expect(terminated).toEqual([101, 102])
    expect((await readManualControl(root)).desiredState).toBe('paused')
    expect(await readExecutorStatus(root, runtime)).toMatchObject({ phase: 'attention', pauseMayHaveInFlightRequest: true })
  })
  it('ignores stale PIDs positively inspected as another application', async () => {
    const { runtime, probes, terminated } = await fixture()
    probes.set(103, { ...dead, alive: true, inspected: true, fingerprint: '103:2026-10-02T10:00:00Z', createdAt: '2026-10-02T10:00:00Z' })
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'pause' }, root, runtime)).toEqual({ status: 'completed' })
    expect(terminated).toEqual([101, 102])
    expect(probes.get(103)?.alive).toBe(true)
  })
  it('adopts a verified existing runner on resume and rejects changing an acknowledged command ID', async () => {
    const { runtime } = await fixture()
    const commandId = randomUUID()
    expect(await executeExecutorCommand({ commandId, action: 'resume' }, root, runtime)).toEqual({ status: 'completed' })
    expect(runtime.launch).not.toHaveBeenCalled()
    expect(await executeExecutorCommand({ commandId, action: 'pause' }, root, runtime)).toEqual({ status: 'failed', error: 'command_id_conflict' })
    expect(runtime.terminate).not.toHaveBeenCalled()
  })
  it('discovers a guarded current baseline instead of resuming an obsolete catalog snapshot', async () => {
    const old = await saveBaseline('old', false)
    const current = await saveBaseline('current', true)
    expect((await selectExecutorBaseline(root, old.runId)).runId).toBe(current.runId)
    expect((await selectExecutorBaseline(root, null)).runId).toBe(current.runId)
  })
  it('refuses an unguarded baseline even if its snapshot matches the current catalog', async () => {
    await saveBaseline('current', true, false)
    await expect(selectExecutorBaseline(root, null)).rejects.toThrow('executor_baseline_unavailable')
  })
  it('archives an obsolete workload plan before resuming the current catalog baseline', async () => {
    const { runtime, probes, directory } = await fixture()
    for (const pid of probes.keys()) probes.set(pid, dead)
    const current = await saveBaseline('current', true)
    const oldPlan = { schemaVersion: 1, baselineRunId: baseline, inputSha256: 'b'.repeat(64), baselineCompleted: false, pendingRecovery: null, finishedJobs: [], completedRecoverySelections: 0 }
    await save(join(directory, 'workload-plan.json'), oldPlan)
    vi.mocked(runtime.inspectReadiness).mockImplementation(async (_root, runId, prospectivePlan) => {
      expect(runId).toBe(current.runId)
      expect(prospectivePlan).toMatchObject({ baselineRunId: current.runId, inputSha256: current.inputSha256 })
      expect(JSON.parse(await readFile(join(directory, 'workload-plan.json'), 'utf8'))).toEqual(oldPlan)
      return { ready: true } as Awaited<ReturnType<ControllerRuntime['inspectReadiness']>>
    })
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'resume' }, root, runtime)).toEqual({ status: 'completed' })
    expect(runtime.launch).toHaveBeenCalledWith(root, 'runner', expect.arrayContaining(['--run', current.runId]))
    expect(JSON.parse(await readFile(join(directory, 'workload-plan.json'), 'utf8'))).toMatchObject({ baselineRunId: current.runId, inputSha256: current.inputSha256 })
    const history = await readdir(join(directory, 'admin-workload-plan-history'))
    expect(history).toHaveLength(1)
    expect(JSON.parse(await readFile(join(directory, 'admin-workload-plan-history', history[0]), 'utf8'))).toEqual(oldPlan)
  })
  it('does not replace or archive the prior plan when prospective baseline readiness fails', async () => {
    const { runtime, probes, directory } = await fixture()
    for (const pid of probes.keys()) probes.set(pid, dead)
    await saveBaseline('current', true)
    const oldPlan = { schemaVersion: 1, baselineRunId: baseline, inputSha256: 'b'.repeat(64), baselineCompleted: false, pendingRecovery: null, finishedJobs: [], completedRecoverySelections: 0 }
    await save(join(directory, 'workload-plan.json'), oldPlan)
    vi.mocked(runtime.inspectReadiness).mockResolvedValue({ ready: false } as Awaited<ReturnType<ControllerRuntime['inspectReadiness']>>)
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'resume' }, root, runtime)).toEqual({ status: 'failed', error: 'workload_readiness_failed' })
    expect(JSON.parse(await readFile(join(directory, 'workload-plan.json'), 'utf8'))).toEqual(oldPlan)
    await expect(readdir(join(directory, 'admin-workload-plan-history'))).rejects.toThrow()
    expect(runtime.launch).not.toHaveBeenCalled()
  })
  it('starts explicitly selected verification after pause and keeps durable idempotent launch receipts', async () => {
    const { runtime, probes, directory } = await fixture()
    for (const pid of probes.keys()) probes.set(pid, dead)
    await save(join(directory, 'manual-control.json'), { schemaVersion: 1, desiredState: 'paused', commandId: randomUUID(), updatedAt: startedAt })
    runtime.auditConfiguration = vi.fn(async () => true)
    vi.stubEnv('ADMIN_VERIFICATION_USE_CCSWITCH', 'true')
    const command = { commandId: randomUUID(), action: 'start' as const, options: { collection: 'programs' as const, mode: 'sample' as const, limit: 2 } }
    expect(await executeExecutorCommand(command, root, runtime)).toEqual({ status: 'completed', pid: 104 })
    expect(await readManualControl(root)).toMatchObject({ desiredState: 'running', commandId: command.commandId })
    expect(runtime.launch).toHaveBeenCalledWith(root, 'verification', expect.arrayContaining(['--use-ccswitch', '--quota-guard', '--collection', 'programs', '--limit', '2']))
    expect(runtime.launch).toHaveBeenCalledWith(root, 'verification', expect.arrayContaining(['--invocation-id', command.commandId]))
    expect(await executeExecutorCommand(command, root, runtime)).toEqual({ status: 'completed', pid: 104 })
    expect(runtime.launch).toHaveBeenCalledOnce()
  })
  it('preserves a paused state when verification configuration validation fails', async () => {
    const { runtime, probes, directory } = await fixture()
    for (const pid of probes.keys()) probes.set(pid, dead)
    await save(join(directory, 'manual-control.json'), { schemaVersion: 1, desiredState: 'paused', commandId: randomUUID(), updatedAt: startedAt })
    runtime.auditConfiguration = vi.fn(async () => false)
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'start', options: { collection: 'all', mode: 'sample' } }, root, runtime)).toEqual({ status: 'failed', error: 'executor_unavailable' })
    expect((await readManualControl(root)).desiredState).toBe('paused')
    expect(runtime.launch).not.toHaveBeenCalled()
  })
  it('blocks real model requests and retries at the persistent pause boundary', async () => {
    await save(join(root, '.tmp/minimax-verification/manual-control.json'), { schemaVersion: 1, desiredState: 'paused', commandId: randomUUID(), updatedAt: startedAt })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(compareBatch([], [], { endpoint: 'https://api.minimax.io/v1/chat/completions', key: 'synthetic-test-key', model: 'MiniMax-M3', anthropic: false }, join(root, '.official-harvest/minimax-verification', baseline), 'a'.repeat(64))).rejects.toThrow('MiniMax manually paused')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('rejects arbitrary command fields before writing or launching anything', async () => {
    const { runtime } = await fixture()
    expect(await executeExecutorCommand({ commandId: randomUUID(), action: 'pause', script: 'bad' } as never, root, runtime)).toEqual({ status: 'failed', error: 'invalid_request' })
    expect(runtime.terminate).not.toHaveBeenCalled()
    expect((await readManualControl(root)).desiredState).toBe('running')
    await expect(readFile(join(root, '.tmp/minimax-verification/admin-command-latest.json'))).rejects.toThrow()
  })
})
