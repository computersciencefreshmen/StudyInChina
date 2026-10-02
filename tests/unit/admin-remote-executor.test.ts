import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminTelemetry } from '../../src/lib/admin/telemetry-contract'
import { executorStatusSchema } from '../../src/lib/admin/executor-contract'
import { remoteExecutorConnected, remoteExecutorControllable } from '../../src/lib/admin/remote-executor'

const now = Date.parse('2026-10-02T10:00:00Z')
const token = 'synthetic-transport-token-'.repeat(2)
const telemetryUrl = 'https://catalog.account.workers.dev/internal/v1/admin-telemetry'
const commandId = 'bca14973-d37e-4b4d-8742-4ad95a64a90c'
function telemetry(remotelyControllable?: boolean) {
  return createAdminTelemetry([], 'MiniMax-M3', new Date(now).toISOString(), { automation: {
    executorId: 'studyinchina-local-minimax', observedAt: new Date(now).toISOString(), connected: true, remotelyControllable,
    desiredState: 'running', phase: 'idle', reason: 'executor_ready', baselineRunId: null, runnerAlive: false,
    supervisorAlive: false, activeVerifierCount: 0, controlAcknowledgedAt: null, pauseMayHaveInFlightRequest: false,
    creditFallbackAuthorized: false, policyReloadPending: false, keepAwake: false, quota: null, latestCommand: null,
  } })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('remote executor command admission', () => {
  it('keeps legacy and monitoring-only observations visible without granting command execution', () => {
    expect(executorStatusSchema.parse(telemetry().automation).remotelyControllable).toBe(false)
    expect(remoteExecutorConnected(telemetry(), now)).toBe(true)
    expect(remoteExecutorControllable(telemetry(), now)).toBe(false)
    expect(remoteExecutorControllable(telemetry(false), now)).toBe(false)
    expect(remoteExecutorControllable(telemetry(true), now)).toBe(true)
  })

  it('requires both transport and executor observations to be recent and rejects future timestamps', () => {
    const value = telemetry(true)
    expect(remoteExecutorControllable(value, now + 30_000)).toBe(true)
    expect(remoteExecutorControllable(value, now + 30_001)).toBe(false)
    expect(remoteExecutorConnected({ ...value, observedAt: new Date(now + 5_001).toISOString() }, now)).toBe(false)
    expect(remoteExecutorConnected({ ...value, observedAt: 'invalid' }, now)).toBe(false)
    expect(remoteExecutorConnected({ ...value, automation: { ...value.automation!, observedAt: new Date(now - 30_001).toISOString() } }, now)).toBe(false)
    expect(remoteExecutorConnected(null, now)).toBe(false)
  })

  it('refuses a POST when a website flag is enabled but the bridge is still monitoring-only', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.resetModules()
    vi.stubEnv('ADMIN_TELEMETRY_URL', telemetryUrl)
    vi.stubEnv('ADMIN_TELEMETRY_TOKEN', token)
    vi.stubEnv('ADMIN_REMOTE_CONTROL_ENABLED', 'true')
    const fetchMock = vi.fn(async () => Response.json(telemetry(false)))
    vi.stubGlobal('fetch', fetchMock)
    const { submitRemoteExecutorCommand } = await import('../../src/lib/admin/remote-executor')
    await expect(submitRemoteExecutorCommand({ commandId, action: 'resume' })).rejects.toThrow('executor_unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(telemetryUrl, expect.anything())
  })

  it('submits exactly the typed command only after an executor advertises command consumption', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.resetModules()
    vi.stubEnv('ADMIN_TELEMETRY_URL', telemetryUrl)
    vi.stubEnv('ADMIN_TELEMETRY_TOKEN', token)
    vi.stubEnv('ADMIN_REMOTE_CONTROL_ENABLED', 'true')
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({ ok: true, command: { commandId } }) : Response.json(telemetry(true)))
    vi.stubGlobal('fetch', fetchMock)
    const { submitRemoteExecutorCommand } = await import('../../src/lib/admin/remote-executor')
    expect(await submitRemoteExecutorCommand({ commandId, action: 'resume' })).toEqual({ accepted: true, commandId })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('https://catalog.account.workers.dev/internal/v1/admin-executor', expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({ commandId, action: 'resume' }),
    }))
  })
})
