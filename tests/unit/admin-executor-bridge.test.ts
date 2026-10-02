import { afterEach, describe, expect, it, vi } from 'vitest'
import { bridgeIteration, buildBridgeTelemetry, createBridgeRequest, loadBridgeConfiguration, projectBridgeQuota, telemetryOnlyIteration, validateBridgeTarget, windowsBridgeModulePath, type BridgeConfiguration } from '../../scripts/ingestion/admin-executor-bridge'
import { ADMIN_COMMAND_TTL_MS, ADMIN_EXECUTOR_ID, type ExecutorQueueEntry } from '../../workers/catalog-api/src/admin-executor'

vi.mock('../../src/lib/admin/snapshot', () => ({ readLocalVerificationRuns: async () => [] }))
vi.mock('../../scripts/ingestion/minimax-admin-control', () => ({ readExecutorStatus: async () => ({
  executorId: 'studyinchina-local-minimax', observedAt: new Date().toISOString(), connected: true, desiredState: 'running',
  phase: 'idle', reason: 'executor_ready', baselineRunId: null, runnerAlive: false, supervisorAlive: false, activeVerifierCount: 0,
  controlAcknowledgedAt: null, pauseMayHaveInFlightRequest: false, creditFallbackAuthorized: false, policyReloadPending: false,
  keepAwake: false, quota: null, latestCommand: null,
}) }))

const now = Date.parse('2026-10-02T10:00:00.000Z')
const commandId = 'bca14973-d37e-4b4d-8742-4ad95a64a90c'
const attemptId = '7ed8c4ed-32ac-4b11-b548-e59f10cb6b6c'
const configuration: BridgeConfiguration = { executorId: ADMIN_EXECUTOR_ID, telemetryUrl: 'https://catalog.test/internal/v1/admin-telemetry', commandUrl: 'https://catalog.test/internal/v1/admin-executor', token: 'private-test-token-'.repeat(3) }
const pending: ExecutorQueueEntry = { commandId, action: 'pause', status: 'pending', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ADMIN_COMMAND_TTL_MS).toISOString(), updatedAt: new Date(now).toISOString(), executorId: null, attemptId: null, leaseExpiresAt: null, error: null }
const claimed: ExecutorQueueEntry = { ...pending, status: 'claimed', executorId: configuration.executorId, attemptId, leaseExpiresAt: new Date(now + 60_000).toISOString() }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function dependencies() {
  const request = vi.fn(async (method: string, _url: string, body?: unknown): Promise<unknown> => {
    if (method === 'GET') return { version: 1, observedAt: new Date(now).toISOString(), commands: [pending] }
    const value = body as { operation?: string; result?: string }
    return { ok: true, command: value?.operation === 'claim' || value?.operation === 'renew' ? claimed : { ...claimed, status: value.result || 'completed' } }
  })
  return { request, execute: vi.fn(async () => ({ status: 'completed' })), publish: vi.fn(async () => {}), attemptId: () => attemptId }
}

describe('outward-only administrator bridge', () => {
  it('advertises command consumption only when publishing from the execution mode', async () => {
    expect((await buildBridgeTelemetry('missing-test-root')).automation?.remotelyControllable).toBe(false)
    expect((await buildBridgeTelemetry('missing-test-root', false)).automation?.remotelyControllable).toBe(false)
    expect((await buildBridgeTelemetry('missing-test-root', true)).automation?.remotelyControllable).toBe(true)
  })
  it('publishes telemetry without reading or executing pending commands in monitoring-only mode', async () => {
    const fixture = dependencies()
    expect(await telemetryOnlyIteration(fixture)).toEqual({ commandId: null, result: 'idle', published: true })
    expect(fixture.publish).toHaveBeenCalledOnce()
    expect(fixture.request).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
  })
  it('projects only official quota percentages and marks expired observations as unknown rather than current availability', () => {
    const quota = { state: 'available', checkedAt: new Date(now).toISOString(), fiveHour: { remainingPercent: 3, resetAt: new Date(now + 60_000).toISOString() }, weekly: { remainingPercent: 100 }, apiKey: 'private-secret' }
    expect(projectBridgeQuota(quota, now)).toEqual({ state: 'available', checkedAt: quota.checkedAt, fiveHourRemainingPercent: 3, weeklyRemainingPercent: 100, resetAt: quota.fiveHour.resetAt, stale: false })
    expect(projectBridgeQuota(quota, now + 60_000)).toMatchObject({ state: 'unknown', fiveHourRemainingPercent: 3, stale: true })
    expect(projectBridgeQuota({ ...quota, fiveHour: { remainingPercent: 0, resetAt: new Date(now + 600_000).toISOString() } }, now + 120_001)).toMatchObject({ state: 'unknown', fiveHourRemainingPercent: 0, stale: true })
    expect(projectBridgeQuota({ ...quota, weekly: { remainingPercent: 101 } }, now)).toBeNull()
    expect(JSON.stringify(projectBridgeQuota(quota, now))).not.toContain('private-secret')
  })
  it('retains inherited modules while including Windows PowerShell security and identity modules', () => {
    const path = windowsBridgeModulePath({ SystemRoot: 'C:\\Windows', PSModulePath: 'existing-powershell7-modules' })
    expect(path).toContain('WindowsPowerShell')
    expect(path).toContain('Modules;existing-powershell7-modules')
  })
  it('pins bearer credentials to HTTPS host and rejects redirects, injected URL parts or paths', async () => {
    expect(validateBridgeTarget('https://catalog.test/internal/v1/admin-telemetry', 'catalog.test')).toEqual({ telemetryUrl: configuration.telemetryUrl, commandUrl: configuration.commandUrl })
    for (const value of ['http://catalog.test/internal/v1/admin-telemetry', 'https://other.test/internal/v1/admin-telemetry', 'https://user:password@catalog.test/internal/v1/admin-telemetry', 'https://catalog.test/internal/v1/admin-telemetry?token=x', 'https://catalog.test/other']) expect(() => validateBridgeTarget(value, 'catalog.test')).toThrow('invalid_bridge_target')
    const config = await loadBridgeConfiguration('.', { ADMIN_TELEMETRY_URL: configuration.telemetryUrl, ADMIN_TELEMETRY_TOKEN_HOST: 'catalog.test', ADMIN_TELEMETRY_TOKEN: configuration.token })
    expect(config).toEqual(configuration)
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    const request = createBridgeRequest(config, fetchMock)
    await expect(request('GET', 'https://other.test/private')).rejects.toThrow('invalid_bridge_target')
    expect(fetchMock).not.toHaveBeenCalled()
    await request('GET', config.commandUrl)
    expect(fetchMock).toHaveBeenCalledWith(config.commandUrl, expect.objectContaining({ redirect: 'error', headers: { authorization: `Bearer ${configuration.token}` } }))
  })
  it('executes only after an exact attempt claim and acknowledges typed results', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    expect(await bridgeIteration(configuration, fixture)).toEqual({ commandId, result: 'completed', published: true })
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith({ commandId, action: 'pause' })
    expect(fixture.request).toHaveBeenNthCalledWith(2, 'PATCH', configuration.commandUrl, { operation: 'claim', commandId, executorId: configuration.executorId, attemptId })
    expect(fixture.request).toHaveBeenLastCalledWith('PATCH', configuration.commandUrl, { operation: 'complete', commandId, executorId: configuration.executorId, attemptId, result: 'completed' })
  })
  it('refuses to execute a rejected or mismatched claim', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    fixture.request.mockResolvedValueOnce({ version: 1, observedAt: new Date(now).toISOString(), commands: [pending] }).mockResolvedValueOnce({ ok: true, command: { ...claimed, attemptId: '4b8a9077-4bf4-47af-a7fb-e201d6c3d0a3' } })
    await expect(bridgeIteration(configuration, fixture)).rejects.toThrow('bridge_claim_invalid')
    expect(fixture.execute).not.toHaveBeenCalled()
  })
  it('never reruns already claimed, completed or expired commands', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    fixture.request.mockResolvedValueOnce({ version: 1, observedAt: new Date(now).toISOString(), commands: [claimed, { ...pending, commandId: '4b8a9077-4bf4-47af-a7fb-e201d6c3d0a3', expiresAt: new Date(now).toISOString(), createdAt: new Date(now - ADMIN_COMMAND_TTL_MS).toISOString() }] })
    expect(await bridgeIteration(configuration, fixture)).toEqual({ commandId: null, result: 'idle', published: true })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.publish).toHaveBeenCalledOnce()
  })
  it('retries lost acknowledgements without ever retrying local execution', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    fixture.request.mockResolvedValueOnce({ version: 1, observedAt: new Date(now).toISOString(), commands: [pending] }).mockResolvedValueOnce({ ok: true, command: claimed }).mockRejectedValue(new Error('private transport information'))
    await expect(bridgeIteration(configuration, fixture)).rejects.toThrow('bridge_acknowledgement_unavailable')
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(fixture.request).toHaveBeenCalledTimes(5)
    expect(fixture.publish).toHaveBeenCalledOnce()
  })
  it('projects failed local execution into a safe failure acknowledgement', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    fixture.execute.mockResolvedValueOnce({ status: 'failed' })
    expect(await bridgeIteration(configuration, fixture)).toMatchObject({ result: 'failed' })
    expect(fixture.request).toHaveBeenLastCalledWith('PATCH', configuration.commandUrl, expect.objectContaining({ result: 'failed', error: 'execution_failed' }))
  })
  it('renews its claim during a longer control operation and still executes exactly once', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    let finish!: (value: { status: string }) => void
    fixture.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const iteration = bridgeIteration(configuration, fixture)
    await vi.advanceTimersByTimeAsync(21_000)
    expect(fixture.request).toHaveBeenCalledWith('PATCH', configuration.commandUrl, expect.objectContaining({ operation: 'renew', attemptId }))
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    finish({ status: 'completed' })
    expect(await iteration).toMatchObject({ result: 'completed' })
  })
  it('requires acknowledgement identity rather than trusting an arbitrary success body', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const fixture = dependencies()
    fixture.request.mockResolvedValueOnce({ version: 1, observedAt: new Date(now).toISOString(), commands: [pending] }).mockResolvedValueOnce({ ok: true, command: claimed }).mockResolvedValue({ ok: true, command: { ...claimed, status: 'completed', executorId: 'different-machine' } })
    await expect(bridgeIteration(configuration, fixture)).rejects.toThrow('bridge_acknowledgement_unavailable')
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(fixture.request).toHaveBeenCalledTimes(5)
  })
  it('bounds private response bodies before parsing without including secrets in errors', async () => {
    const request = createBridgeRequest(configuration, vi.fn(async () => new Response('x'.repeat(129 * 1_024))))
    await expect(request('GET', configuration.commandUrl)).rejects.toThrow('bridge_response_invalid')
  })
})
