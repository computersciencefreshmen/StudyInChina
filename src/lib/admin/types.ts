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
  catalog: {
    counts: { universities: number; programs: number; admissionCycles: number; scholarships: number; cities: number; sources: number }
    statuses: { verified: number; needsReview: number; stale: number; draft: number; archived: number }
    overdueRecords: number; totalRecords: number; officialSources: number
  }
  runs: AdminRun[]
  capabilities: { localMonitoring: boolean; startVerification: boolean; credentialSource: 'environment' | 'ccswitch' | 'unconfigured'; reason: string | null }
  model: { configured: string | null }
  usage: TokenUsage & { budgetTokens: number | null }
}
