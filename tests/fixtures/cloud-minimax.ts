import type { CloudMiniMaxSnapshot } from '../../src/lib/admin/cloud-minimax-contract'
export const CLOUD_NOW = Date.parse('2026-11-14T08:00:00.000Z')
export function cloudSnapshot(): CloudMiniMaxSnapshot {
  return { version: 1, generatedAt: new Date(CLOUD_NOW).toISOString(), quota: { state: 'fresh', observedAt: new Date(CLOUD_NOW).toISOString(), checkedAt: new Date(CLOUD_NOW).toISOString(),
    fiveHour: { remainingPercent: 72, startAt: '2026-11-14T06:00:00.000Z', resetAt: '2026-11-14T11:00:00.000Z' },
    weekly: { unlimited: true, remainingPercent: null, startAt: null, resetAt: null }, code: 'observed', modelCallsPerformed: false },
    ledgerState: 'fresh', code: 'observed', modelCallsPerformed: false, ledger: { observedAt: new Date(CLOUD_NOW).toISOString(), timezone: 'Asia/Shanghai', today: '2026-11-14',
      periods: [{ id: 'today', startAt: '2026-11-13T16:00:00.000Z', endAt: new Date(CLOUD_NOW).toISOString(),
        totals: { attempts: 3, completed: 1, unknown: 1, knownFailed: 1, sendStarted: 0, reserved: 0, tokens: { input: 100, output: 30, cacheRead: 40, cacheWrite: null, unknownUsageAttempts: 1 } },
        models: [{ model: 'MiniMax-M3.1-Flash', attempts: 3, completed: 1, unknown: 1, knownFailed: 1, sendStarted: 0, reserved: 0, tokens: { input: 100, output: 30, cacheRead: 40, cacheWrite: null, unknownUsageAttempts: 1 } }] }],
      control: { enabled: true, modelsEnabled: true, targetsReady: true, scopeCount: 295, revision: 15 },
      recentAttempts: [{ attemptId: 'new-attempt', model: 'MiniMax-M3.1-Flash', status: 'unknown', startedAt: '2026-11-14T07:45:00.000Z', completedAt: null, pass: 'primary', errorCode: 'model_outcome_unknown' }],
      recentJobs: [{ id: 'new-job', stage: 'maintain', status: 'unknown', updatedAt: '2026-11-14T07:45:00.000Z', errorCode: 'model_outcome_unknown' }], coverage: null } }
}
