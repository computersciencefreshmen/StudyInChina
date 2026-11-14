import { z } from 'zod'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime()
const percent = z.number().min(0).max(100)
export const cloudQuotaSchema = z.object({
  state: z.enum(['fresh', 'stale', 'unknown']), observedAt: timestamp.nullable(), checkedAt: timestamp,
  fiveHour: z.object({ remainingPercent: percent, startAt: timestamp, resetAt: timestamp }).strict().nullable(),
  weekly: z.object({ unlimited: z.boolean(), remainingPercent: percent.nullable(), startAt: timestamp.nullable(), resetAt: timestamp.nullable() }).strict().nullable(),
  code: z.enum(['observed', 'quota_unavailable']), modelCallsPerformed: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.state === 'fresh' && (!value.observedAt || !value.fiveHour || !value.weekly)) context.addIssue({ code: 'custom', message: 'Fresh quota requires an observation and both buckets' })
  const w = value.weekly
  if (w && (w.unlimited ? w.remainingPercent !== null || w.startAt !== null || w.resetAt !== null : w.remainingPercent === null || w.startAt === null || w.resetAt === null)) context.addIssue({ code: 'custom', message: 'Unlimited and finite weekly evidence must remain distinct' })
  if (value.fiveHour && Date.parse(value.fiveHour.startAt) >= Date.parse(value.fiveHour.resetAt)) context.addIssue({ code: 'custom', message: 'Invalid quota window' })
})
export type CloudQuotaSnapshot = z.infer<typeof cloudQuotaSchema>
const tokens = z.object({ input: count.nullable(), output: count.nullable(), cacheRead: count.nullable(), cacheWrite: count.nullable(), unknownUsageAttempts: count }).strict()
const counters = z.object({ attempts: count, completed: count, unknown: count, knownFailed: count, sendStarted: count, reserved: count, tokens }).strict()
const model = z.enum(['MiniMax-M3', 'MiniMax-M3.1-Flash', 'MiniMax-M3.1-Flash-Preview', 'other'])
export const cloudLedgerSchema = z.object({
  observedAt: timestamp, timezone: z.literal('Asia/Shanghai'), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periods: z.array(z.object({ id: z.enum(['today', 'five-hour', 'weekly', 'recent-seven-days']), startAt: timestamp, endAt: timestamp,
    totals: counters, models: z.array(z.object({ model, ...counters.shape }).strict()).max(4) }).strict()).max(4),
  control: z.object({ enabled: z.boolean(), modelsEnabled: z.boolean(), targetsReady: z.boolean(), scopeCount: count, revision: count }).strict(),
  recentAttempts: z.array(z.object({ attemptId: z.string().max(160), model, status: z.enum(['completed', 'unknown', 'known_failed', 'send_started', 'reserved']),
    startedAt: timestamp, completedAt: timestamp.nullable(), pass: z.enum(['primary', 'independent-review']), errorCode: z.string().regex(/^[a-zA-Z0-9_:.-]{1,120}$/).nullable() }).strict()).max(12),
  recentJobs: z.array(z.object({ id: z.string().max(160), stage: z.string().max(40), status: z.string().max(40), updatedAt: timestamp,
    errorCode: z.string().regex(/^[a-zA-Z0-9_:.-]{1,120}$/).nullable() }).strict()).max(10),
  coverage: z.object({ evaluatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stale: z.boolean(), schools: count,
    zero: count, one: count, twoToFour: count, fivePlus: count, currentPrograms: count, currentScholarships: count }).strict().nullable(),
}).strict()
export const cloudMiniMaxSchema = z.object({ version: z.literal(1), generatedAt: timestamp, quota: cloudQuotaSchema,
  ledgerState: z.enum(['fresh', 'stale', 'unavailable']), ledger: cloudLedgerSchema.nullable(),
  code: z.enum(['observed', 'backend_unavailable', 'binding_missing']), modelCallsPerformed: z.literal(false),
}).strict()
export type CloudMiniMaxSnapshot = z.infer<typeof cloudMiniMaxSchema>
export type CloudLedger = z.infer<typeof cloudLedgerSchema>
export const CLOUD_MONITOR_REFRESH_MS = 45_000
export const CLOUD_MONITOR_STALE_MS = 120_000
export function unknownCloudQuota(now = Date.now()): CloudQuotaSnapshot {
  return { state: 'unknown', observedAt: null, checkedAt: new Date(now).toISOString(), fiveHour: null, weekly: null, code: 'quota_unavailable', modelCallsPerformed: false }
}
export function quotaObservationIsCurrent(value: CloudQuotaSnapshot, now = Date.now()) {
  const age = now - Date.parse(value.observedAt ?? '')
  return value.state === 'fresh' && age >= -5_000 && age <= CLOUD_MONITOR_STALE_MS && Boolean(value.fiveHour && Date.parse(value.fiveHour.startAt) <= now && Date.parse(value.fiveHour.resetAt) > now)
    && Boolean(value.weekly && (value.weekly.unlimited || value.weekly.startAt && value.weekly.resetAt && Date.parse(value.weekly.startAt) <= now && Date.parse(value.weekly.resetAt) > now))
}
