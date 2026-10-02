import { z } from 'zod'
import type { AdminRun, AdminUsageLedger, TokenUsage } from './types'
import { adminUsageLedgerSchema, executorStatusSchema, EXECUTOR_RUN_ID } from './executor-contract'

export const ADMIN_TELEMETRY_MAX_BYTES = 128 * 1_024
export const ADMIN_TELEMETRY_STALE_MS = 120_000
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: false })
const model = z.string().regex(/^MiniMax-M[\w.-]{1,80}$/).nullable()
const usageSchema = z.object({
  inputTokens: count, outputTokens: count, totalTokens: count, requests: count,
  cacheReadTokens: count, cacheWriteTokens: count,
  lastInputTokens: count.nullable(), lastOutputTokens: count.nullable(), lastResponseAt: timestamp.nullable(),
}).strict()
const runSchema = z.object({
  id: z.string().regex(EXECUTOR_RUN_ID),
  title: z.enum(['全量目录核验', '最新高校补充核验', '目录核验任务']),
  status: z.enum(['running', 'failed', 'completed', 'incomplete', 'unknown']),
  alive: z.boolean(), model, selectedRecords: count.nullable(), completedRecords: count.nullable(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional(),
  thinking: z.enum(['adaptive', 'disabled']).nullable().optional(),
  startedAt: timestamp.nullable(), updatedAt: timestamp.nullable(),
  summary: z.object({ supportedCandidateFields: count.nullable(), contradictedCandidateFields: count.nullable(), unconfirmedFields: count.nullable(), modelErrorRecords: count.nullable() }).strict().nullable(),
  summaryAt: timestamp.nullable(),
  fatal: z.string().regex(/^(?:MiniMax HTTP \d{3}|核验进程报告错误)$/).nullable(),
  tokenUsage: usageSchema,
}).strict()

export function sumTokenUsage(values: TokenUsage[]): TokenUsage {
  const result: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastInputTokens: null, lastOutputTokens: null, lastResponseAt: null }
  for (const value of values) for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'requests', 'cacheReadTokens', 'cacheWriteTokens'] as const) result[key] += value[key]
  const latest = values.filter(value => value.lastResponseAt).sort((a, b) => Date.parse(b.lastResponseAt!) - Date.parse(a.lastResponseAt!))[0]
  if (latest) { result.lastInputTokens = latest.lastInputTokens; result.lastOutputTokens = latest.lastOutputTokens; result.lastResponseAt = latest.lastResponseAt }
  return result
}

/** Immutable attempts retain retries that may have overwritten a saved response. */
export function ledgerTokenUsage(ledger: AdminUsageLedger, savedResponses: TokenUsage): TokenUsage {
  const { totals } = ledger
  return { ...savedResponses, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
    totalTokens: totals.reportedTokens, requests: totals.attempts - totals.unknownUsageAttempts,
    cacheReadTokens: totals.cacheReadTokens, cacheWriteTokens: totals.cacheWriteTokens }
}

export const adminTelemetrySchema = z.object({
  version: z.literal(1), observedAt: timestamp,
  runs: z.array(runSchema).max(100), usage: usageSchema,
  usageBasis: z.enum(['immutable-ledger', 'saved-responses']).optional(),
  model: z.object({ configured: model }).strict(),
  ledger: adminUsageLedgerSchema.nullable().optional(), automation: executorStatusSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.runs.map(run => run.id)).size !== value.runs.length) context.addIssue({ code: 'custom', message: 'Duplicate run identity', path: ['runs'] })
  const saved = sumTokenUsage(value.runs.map(run => run.tokenUsage))
  if (value.usageBasis === 'immutable-ledger' && !value.ledger) context.addIssue({ code: 'custom', message: 'Ledger usage requires a ledger', path: ['ledger'] })
  const summed = value.usageBasis === 'immutable-ledger' && value.ledger ? ledgerTokenUsage(value.ledger, saved) : saved
  for (const key of Object.keys(summed) as Array<keyof TokenUsage>) if (summed[key] !== value.usage[key]) context.addIssue({ code: 'custom', message: 'Usage must match saved run responses', path: ['usage', key] })
})
export type AdminTelemetry = z.infer<typeof adminTelemetrySchema>

/** Only the already sanitized file projection crosses this boundary. */
export function createAdminTelemetry(runs: AdminRun[], configuredModel: string | null, observedAt = new Date().toISOString(), extra: Pick<AdminTelemetry, 'ledger' | 'automation'> = {}): AdminTelemetry {
  const saved = sumTokenUsage(runs.map(run => run.tokenUsage))
  return adminTelemetrySchema.parse({ version: 1, observedAt, runs, usage: extra.ledger ? ledgerTokenUsage(extra.ledger, saved) : saved,
    usageBasis: extra.ledger ? 'immutable-ledger' : 'saved-responses', model: { configured: configuredModel }, ...extra })
}

export function telemetryIsStale(observedAt: string, now = Date.now()): boolean {
  const elapsed = now - Date.parse(observedAt)
  return !Number.isFinite(elapsed) || elapsed > ADMIN_TELEMETRY_STALE_MS || elapsed < -30_000
}
