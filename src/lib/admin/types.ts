export const ADMIN_COLLECTIONS = ['all', 'universities', 'programs', 'admission-cycles', 'scholarships', 'cities', 'sources'] as const
export type AdminCollection = typeof ADMIN_COLLECTIONS[number]
export type VerificationRequest = {
  collection: AdminCollection; mode: 'sample' | 'full'; limit?: number
  model?: 'configured' | 'MiniMax-M3' | 'MiniMax-M3.1-Flash-Preview'
  effort?: 'default' | 'high' | 'xhigh' | 'max'
}
export type AdminSession = { configured: boolean; authenticated: boolean; expiresAt: string | null }
export type TokenUsage = {
  inputTokens: number; outputTokens: number; totalTokens: number; requests: number
  cacheReadTokens: number; cacheWriteTokens: number
  lastInputTokens: number | null; lastOutputTokens: number | null; lastResponseAt: string | null
}
export type TokenLedgerTotals = {
  attempts: number; instrumentedAttempts: number; historicalResponses: number; unknownUsageAttempts: number
  reportedTokens: number; instrumentedReportedTokens: number; historicalReportedTokensLowerBound: number
  inputTokens: number; uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number
}
export type AdminUsageLedger = {
  generatedAt: string; timezone: 'Asia/Shanghai'; todayDay: string; dailyTarget: number | null
  totals: TokenLedgerTotals; daily: Array<TokenLedgerTotals & { day: string }>
  rejectedReceipts: number; conflictingAttempts: number
}
export type ExecutorCommand = {
  commandId: string; action: 'pause' | 'resume' | 'start'; options?: VerificationRequest
}
export type ExecutorStatus = {
  executorId: string; observedAt: string; connected: boolean; desiredState: 'running' | 'paused'
  phase: string; reason: string; baselineRunId: string | null
  runnerAlive: boolean; supervisorAlive: boolean; activeVerifierCount: number
  controlAcknowledgedAt: string | null; pauseMayHaveInFlightRequest: boolean
  creditFallbackAuthorized: boolean; policyReloadPending: boolean; keepAwake: boolean
  quota: { state: 'available' | 'exhausted' | 'unknown'; checkedAt: string; fiveHourRemainingPercent: number | null; weeklyRemainingPercent: number | null; resetAt: string | null; stale?: boolean } | null
  latestCommand: { commandId: string; action: ExecutorCommand['action']; status: 'pending' | 'claimed' | 'completed' | 'failed' | 'expired'; updatedAt: string; error: string | null } | null
}
export type AdminRun = {
  id: string; title: string; status: 'running' | 'failed' | 'completed' | 'incomplete' | 'unknown'
  alive: boolean; model: string | null; selectedRecords: number | null; completedRecords: number | null
  effort?: string | null; thinking?: 'adaptive' | 'disabled' | null
  startedAt: string | null; updatedAt: string | null
  summary: { supportedCandidateFields: number | null; contradictedCandidateFields: number | null; unconfirmedFields: number | null; modelErrorRecords: number | null } | null
  summaryAt: string | null; fatal: string | null; tokenUsage: TokenUsage
}
export type AdminSnapshot = {
  generatedAt: string
  telemetry?: { source: 'local' | 'remote' | 'unavailable'; observedAt: string | null; stale: boolean }
  catalog: {
    counts: { universities: number; programs: number; admissionCycles: number; scholarships: number; cities: number; sources: number }
    statuses: { verified: number; needsReview: number; stale: number; draft: number; archived: number }
    overdueRecords: number; totalRecords: number; officialSources: number
  }
  runs: AdminRun[]
  capabilities: { localMonitoring: boolean; startVerification: boolean; automationControl?: boolean; credentialSource: 'environment' | 'ccswitch' | 'unconfigured'; reason: string | null }
  model: { configured: string | null }
  usage: TokenUsage & { budgetTokens: number | null }
  usageBasis?: 'immutable-ledger' | 'saved-responses' | 'unavailable'
  ledger?: AdminUsageLedger | null
  automation?: ExecutorStatus | null
}
