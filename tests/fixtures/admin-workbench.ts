import type { AdminSession, AdminSnapshot } from '../../src/lib/admin/types'

export const adminSession: AdminSession = { configured: true, authenticated: true, expiresAt: '2026-09-30T18:00:00Z' }
export function adminSnapshot(): AdminSnapshot {
  const tokens = { inputTokens: 12000, outputTokens: 3000, totalTokens: 15000, requests: 5, cacheReadTokens: 100, cacheWriteTokens: 0, lastInputTokens: 2400, lastOutputTokens: 600, lastResponseAt: '2026-09-30T09:00:00Z' }
  return {
    generatedAt: '2026-09-30T09:00:00Z',
    catalog: { counts: { universities: 266, programs: 1480, admissionCycles: 864, scholarships: 188, cities: 76, sources: 924 }, statuses: { verified: 3008, needsReview: 380, stale: 146, draft: 264, archived: 0 }, overdueRecords: 146, totalRecords: 3798, officialSources: 876 },
    runs: [{ id: 'fixture-run', title: '目录核验测试任务', status: 'running', alive: true, model: 'MiniMax-M3', thinking: 'adaptive', effort: null, selectedRecords: 20, completedRecords: 7, startedAt: '2026-09-30T08:00:00Z', updatedAt: '2026-09-30T09:00:00Z', summary: { supportedCandidateFields: 18, contradictedCandidateFields: 2, unconfirmedFields: 1, modelErrorRecords: 0 }, summaryAt: '2026-09-30T09:00:00Z', fatal: null, tokenUsage: { ...tokens } }],
    capabilities: { localMonitoring: true, startVerification: true, credentialSource: 'environment', reason: null },
    model: { configured: 'MiniMax-M3' }, usage: { ...tokens, budgetTokens: null },
  }
}
