import { z } from 'zod'
import { ADMIN_COLLECTIONS, type AdminUsageLedger, type ExecutorCommand, type ExecutorStatus } from './types'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: false })
export const EXECUTOR_RUN_ID = /^[a-f0-9]{16}(?:-[a-f0-9]{12})?(?:-r[a-f0-9]{12})?$/
export const verificationOptionsSchema = z.object({
  collection: z.enum(ADMIN_COLLECTIONS), mode: z.enum(['sample', 'full']), limit: z.number().int().min(1).max(200).optional(),
  model: z.enum(['configured', 'MiniMax-M3', 'MiniMax-M3.1-Flash-Preview']).optional(), effort: z.enum(['default', 'high', 'xhigh', 'max']).optional(),
}).strict().superRefine((value, context) => {
  if (value.effort && value.effort !== 'default' && value.model !== 'MiniMax-M3.1-Flash-Preview') context.addIssue({ code: 'custom', message: 'Unsupported model effort', path: ['effort'] })
})
export const executorCommandSchema = z.object({ commandId: z.string().uuid(), action: z.enum(['pause', 'resume', 'start']), options: verificationOptionsSchema.optional() }).strict().superRefine((value, context) => {
  if ((value.action === 'start') !== Boolean(value.options)) context.addIssue({ code: 'custom', message: 'Only start requires verification options', path: ['options'] })
}) satisfies z.ZodType<ExecutorCommand>

export const tokenLedgerTotalsSchema = z.object({
  attempts: count, instrumentedAttempts: count, historicalResponses: count, unknownUsageAttempts: count,
  reportedTokens: count, instrumentedReportedTokens: count, historicalReportedTokensLowerBound: count,
  inputTokens: count, uncachedInputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count, reasoningTokens: count,
}).strict().superRefine((value, context) => {
  const invariants = [
    value.attempts === value.instrumentedAttempts + value.historicalResponses,
    value.unknownUsageAttempts <= value.attempts,
    value.reportedTokens === value.instrumentedReportedTokens + value.historicalReportedTokensLowerBound,
    value.reportedTokens === value.inputTokens + value.outputTokens,
    value.inputTokens === value.uncachedInputTokens + value.cacheReadTokens + value.cacheWriteTokens,
    value.reasoningTokens <= value.outputTokens,
  ]
  if (invariants.some(valid => !valid)) context.addIssue({ code: 'custom', message: 'Inconsistent receipt counters' })
})
export const adminUsageLedgerSchema = z.object({
  generatedAt: timestamp, timezone: z.literal('Asia/Shanghai'), todayDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dailyTarget: count.positive().nullable(),
  totals: tokenLedgerTotalsSchema, daily: z.array(tokenLedgerTotalsSchema.extend({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(400),
  rejectedReceipts: count, conflictingAttempts: count,
}).strict().superRefine((value, context) => {
  if (new Set(value.daily.map(row => row.day)).size !== value.daily.length) context.addIssue({ code: 'custom', message: 'Duplicate usage day', path: ['daily'] })
  for (const key of Object.keys(tokenLedgerTotalsSchema.shape) as Array<keyof typeof value.totals>) {
    if (value.daily.reduce((sum, row) => sum + row[key], 0) !== value.totals[key]) context.addIssue({ code: 'custom', message: 'Daily receipt totals must match cumulative totals', path: ['totals', key] })
  }
}) satisfies z.ZodType<AdminUsageLedger>
export const executorStatusSchema = z.object({
  executorId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), observedAt: timestamp, connected: z.boolean(), desiredState: z.enum(['running', 'paused']),
  phase: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), reason: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), baselineRunId: z.string().regex(EXECUTOR_RUN_ID).nullable(),
  runnerAlive: z.boolean(), supervisorAlive: z.boolean(), activeVerifierCount: count.max(100), controlAcknowledgedAt: timestamp.nullable(), pauseMayHaveInFlightRequest: z.boolean(),
  creditFallbackAuthorized: z.boolean(), policyReloadPending: z.boolean(), keepAwake: z.boolean(),
  quota: z.object({ state: z.enum(['available', 'exhausted', 'unknown']), checkedAt: timestamp, fiveHourRemainingPercent: z.number().min(0).max(100).nullable(), weeklyRemainingPercent: z.number().min(0).max(100).nullable(), resetAt: timestamp.nullable(), stale: z.boolean().optional() }).strict().nullable(),
  latestCommand: z.object({ commandId: z.string().uuid(), action: z.enum(['pause', 'resume', 'start']), status: z.enum(['pending', 'claimed', 'completed', 'failed', 'expired']), updatedAt: timestamp, error: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/).nullable() }).strict().nullable(),
}).strict() satisfies z.ZodType<ExecutorStatus>

export const ADMIN_QUOTA_STALE_MS = 120_000
export function quotaIsStale(quota: NonNullable<ExecutorStatus['quota']>, now = Date.now()): boolean {
  const age = now - Date.parse(quota.checkedAt)
  return quota.stale === true || !Number.isFinite(age) || age < -30_000 || age > ADMIN_QUOTA_STALE_MS ||
    Boolean(quota.resetAt && Date.parse(quota.resetAt) <= now)
}
/** Keep an old official observation visible, but never present it as current availability. */
export function currentQuotaObservation(quota: ExecutorStatus['quota'], now = Date.now()): ExecutorStatus['quota'] {
  if (!quota) return null
  const stale = quotaIsStale(quota, now)
  return { ...quota, stale, state: stale ? 'unknown' : quota.state }
}

/** The projection contains measured counters only, never model content or credentials. */
export function projectUsageLedger(value: unknown, todayDay: string): AdminUsageLedger | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const parsed = adminUsageLedgerSchema.safeParse({
    generatedAt: raw.generatedAt, timezone: raw.timezone, todayDay, dailyTarget: raw.dailyTarget,
    totals: pickTotals(raw.totals), daily: Array.isArray(raw.daily) ? raw.daily.map(item => ({ ...pickTotals(item), day: (item as Record<string, unknown>)?.day })) : [],
    rejectedReceipts: raw.rejectedReceipts, conflictingAttempts: Array.isArray(raw.conflictingAttemptIds) ? raw.conflictingAttemptIds.length : undefined,
  })
  return parsed.success ? parsed.data : null
}
function pickTotals(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(tokenLedgerTotalsSchema.shape).map(key => [key, raw[key]]))
}
