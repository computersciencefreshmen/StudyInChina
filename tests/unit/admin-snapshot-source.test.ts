import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUsageLedger } from '../../src/lib/admin/types'
import { createAdminTelemetry, type AdminTelemetry } from '../../src/lib/admin/telemetry-contract'

const state = vi.hoisted(() => ({ remote: null as AdminTelemetry | null, connected: false, controls: false }))
vi.mock('../../src/lib/catalog/repository', () => ({ createCatalogRepository: () => ({ getBundle: async () => ({ universities: [], programs: [], admissionCycles: [], scholarships: [], cities: [], sources: [] }) }) }))
vi.mock('../../src/lib/admin/verification', () => ({ getVerificationCapabilities: () => ({ localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: '执行器未连接' }) }))
vi.mock('../../src/lib/admin/remote-executor', () => ({ readRemoteTelemetry: async () => state.remote, remoteExecutorConnected: () => state.connected,
  remoteExecutorControllable: () => state.connected && state.remote?.automation?.remotelyControllable === true,
  remoteExecutorConfiguration: () => ({ controlEnabled: state.controls }) }))
import { getAdminSnapshot } from '../../src/lib/admin/snapshot'

afterEach(() => { state.remote = null; state.connected = false; state.controls = false; vi.useRealTimers() })
function ledger(): AdminUsageLedger {
  const totals = { attempts: 1, instrumentedAttempts: 1, historicalResponses: 0, unknownUsageAttempts: 0,
    reportedTokens: 100, instrumentedReportedTokens: 100, historicalReportedTokensLowerBound: 0,
    inputTokens: 80, uncachedInputTokens: 60, outputTokens: 20, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 0 }
  return { generatedAt: '2026-10-02T10:00:00Z', timezone: 'Asia/Shanghai', todayDay: '2026-10-02', dailyTarget: null,
    totals, daily: [{ ...totals, day: '2026-10-02' }], rejectedReceipts: 0, conflictingAttempts: 0 }
}

describe('administrator source and monitoring capabilities', () => {
  it('identifies missing telemetry as unavailable and does not imply that control is enabled', async () => {
    const snapshot = await getAdminSnapshot()
    expect(snapshot).toMatchObject({ telemetry: { source: 'unavailable', stale: true }, usageBasis: 'unavailable', ledger: null,
      capabilities: { automationControl: false, startVerification: false } })
  })
  it('keeps a connected monitoring-only executor read-only and uses independently recorded counters', async () => {
    state.remote = createAdminTelemetry([], 'MiniMax-M3', '2026-10-02T10:00:00Z', { ledger: ledger() })
    state.connected = true
    const snapshot = await getAdminSnapshot()
    expect(snapshot).toMatchObject({ telemetry: { source: 'remote' }, usageBasis: 'immutable-ledger', usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20, cacheReadTokens: 20 },
      capabilities: { automationControl: false, startVerification: false } })
    state.controls = true
    expect((await getAdminSnapshot()).capabilities).toMatchObject({ automationControl: false, startVerification: false })
  })
  it('requires a bridge that consumes commands before enabling the website controls', async () => {
    state.remote = createAdminTelemetry([], 'MiniMax-M3', '2026-10-02T10:00:00Z', { automation: {
      executorId: 'studyinchina-local-minimax', observedAt: '2026-10-02T10:00:00Z', connected: true, remotelyControllable: true,
      desiredState: 'running', phase: 'idle', reason: 'executor_ready', baselineRunId: null, runnerAlive: false,
      supervisorAlive: false, activeVerifierCount: 0, controlAcknowledgedAt: null, pauseMayHaveInFlightRequest: false,
      creditFallbackAuthorized: false, policyReloadPending: false, keepAwake: false, quota: null, latestCommand: null,
    } })
    state.connected = true
    expect((await getAdminSnapshot()).capabilities).toMatchObject({ automationControl: false, startVerification: false })
    state.controls = true
    expect((await getAdminSnapshot()).capabilities).toMatchObject({ automationControl: true, startVerification: true })
  })
  it('advances the current Shanghai date even when the computer last uploaded yesterday', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T16:05:00Z'))
    state.remote = createAdminTelemetry([], 'MiniMax-M3', '2026-10-02T10:00:00Z', { ledger: ledger() })
    const snapshot = await getAdminSnapshot()
    expect(snapshot.ledger?.todayDay).toBe('2026-10-03')
    expect(snapshot.ledger?.daily.find(row => row.day === snapshot.ledger?.todayDay)).toBeUndefined()
    expect(snapshot.telemetry?.stale).toBe(true)
    expect(snapshot.usage.totalTokens).toBe(100)
  })
})
