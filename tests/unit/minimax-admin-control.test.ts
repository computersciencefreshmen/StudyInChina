import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { executeExecutorCommand, readExecutorStatus, type ControllerRuntime } from '../../scripts/ingestion/minimax-admin-control'
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
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) })

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
