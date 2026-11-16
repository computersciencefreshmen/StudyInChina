import { z } from 'zod'
import { cloudMiniMaxSchema, quotaObservationIsCurrent, CLOUD_MONITOR_STALE_MS } from '../admin/cloud-minimax-contract'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const stamp = z.string().datetime()
const model = z.enum(['MiniMax-M3', 'MiniMax-M3.1-Flash', 'MiniMax-M3.1-Flash-Preview', 'other'])
const metrics = { attempts: count, completed: count, unknown: count, knownFailed: count, sendStarted: count,
  inputTokens: count.nullable(), outputTokens: count.nullable(), cacheReadTokens: count.nullable(), cacheWriteTokens: count.nullable(), unknownUsageAttempts: count }
const quota = z.object({ state: z.enum(['fresh', 'stale', 'unknown']), observedAt: stamp.nullable(), checkedAt: stamp.nullable(),
  fiveHour: z.object({ remainingPercent: z.number().min(0).max(100), resetAt: stamp }).strict().nullable(),
  weekly: z.object({ unlimited: z.boolean(), remainingPercent: z.number().min(0).max(100).nullable(), resetAt: stamp.nullable() }).strict().nullable() }).strict()

/** Public capability: numeric aggregates and fixed labels only. No ledger IDs,
 * free-form errors, source URLs, request data, or administrative controls. */
export const publicMiniMaxStatusSchema = z.object({
  version: z.literal(1), generatedAt: stamp, state: z.enum(['fresh', 'stale', 'unavailable']), observedAt: stamp.nullable(), quota,
  periods: z.array(z.object({ id: z.enum(['today', 'five-hour']), startAt: stamp, endAt: stamp, ...metrics,
    models: z.array(z.object({ model, ...metrics }).strict()).max(4) }).strict()).max(2),
  latestCallAt: stamp.nullable(), latestCompletedAt: stamp.nullable(),
  recentCalls: z.array(z.object({ model, pass: z.enum(['primary', 'independent-review']),
    status: z.enum(['completed', 'unknown', 'known_failed', 'send_started', 'reserved']), startedAt: stamp, completedAt: stamp.nullable() }).strict()).max(6),
  processing: z.object({ observedAt: stamp, fresh: z.boolean(), state: z.enum(['disabled', 'waiting', 'running', 'idle']),
    modelPending: count, modelExecuting: count, taskConcurrencyLimit: count.max(16).nullable(), capturePending: count, captureExecuting: count }).strict().nullable(),
  coverage: z.object({ evaluatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), stale: z.boolean(), schools: count,
    zero: count, one: count, twoToFour: count, fivePlus: count, currentPrograms: count, currentScholarships: count }).strict().nullable(),
}).strict()
export type PublicMiniMaxStatus = z.infer<typeof publicMiniMaxStatusSchema>
export const PUBLIC_MONITOR_CACHE_MS = 20_000
export const PUBLIC_MONITOR_REFRESH_MS = 45_000

const isCurrent = (value: string, now: number) => now >= Date.parse(value) - 5_000 && now - Date.parse(value) <= CLOUD_MONITOR_STALE_MS
const latest = (values: Array<string | null>) => values.filter((v): v is string => v !== null).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null
export function projectPublicMiniMax(input: unknown, now = Date.now()): PublicMiniMaxStatus {
  const empty: PublicMiniMaxStatus = { version: 1, generatedAt: new Date(now).toISOString(), state: 'unavailable', observedAt: null,
    quota: { state: 'unknown', observedAt: null, checkedAt: null, fiveHour: null, weekly: null }, periods: [],
    latestCallAt: null, latestCompletedAt: null, recentCalls: [], processing: null, coverage: null }
  const parsed = cloudMiniMaxSchema.safeParse(input)
  if (!parsed.success || Date.parse(parsed.data.generatedAt) > now + 5_000) return empty
  const value = parsed.data, ledger = value.ledger, refill = value.refill
  const counters = (v: NonNullable<typeof ledger>['periods'][number]['totals']) => ({ attempts: v.attempts, completed: v.completed,
    unknown: v.unknown, knownFailed: v.knownFailed, sendStarted: v.sendStarted,
    inputTokens: v.tokens.input, outputTokens: v.tokens.output, cacheReadTokens: v.tokens.cacheRead, cacheWriteTokens: v.tokens.cacheWrite,
    unknownUsageAttempts: v.tokens.unknownUsageAttempts })
  const recent = ledger?.recentAttempts ?? []
  return publicMiniMaxStatusSchema.parse({ version: 1, generatedAt: empty.generatedAt,
    state: !ledger ? 'unavailable' : value.ledgerState === 'fresh' && isCurrent(ledger.observedAt, now) ? 'fresh' : 'stale',
    observedAt: ledger?.observedAt ?? null,
    quota: { state: quotaObservationIsCurrent(value.quota, now) ? 'fresh' : value.quota.observedAt ? 'stale' : 'unknown',
      observedAt: value.quota.observedAt, checkedAt: value.quota.checkedAt,
      fiveHour: value.quota.fiveHour ? { remainingPercent: value.quota.fiveHour.remainingPercent, resetAt: value.quota.fiveHour.resetAt } : null,
      weekly: value.quota.weekly ? { unlimited: value.quota.weekly.unlimited, remainingPercent: value.quota.weekly.remainingPercent, resetAt: value.quota.weekly.resetAt } : null },
    periods: (ledger?.periods ?? []).filter(p => p.id === 'today' || p.id === 'five-hour').map(p => ({ id: p.id, startAt: p.startAt, endAt: p.endAt,
      ...counters(p.totals), models: p.models.map(m => ({ model: m.model, ...counters(m) })) })),
    latestCallAt: latest(recent.map(a => a.startedAt)), latestCompletedAt: latest(recent.filter(a => a.status === 'completed').map(a => a.completedAt)),
    recentCalls: [...recent].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 6).map(a => ({ model: a.model, pass: a.pass,
      status: a.status, startedAt: a.startedAt, completedAt: a.completedAt })),
    processing: refill ? { observedAt: refill.observedAt, fresh: isCurrent(refill.observedAt, now), state: refill.state,
      modelPending: refill.model.pending, modelExecuting: refill.model.inflight, taskConcurrencyLimit: refill.model.limit,
      capturePending: refill.capture.pending, captureExecuting: refill.capture.inflight } : null,
    coverage: ledger?.coverage ? { evaluatedOn: ledger.coverage.evaluatedOn, stale: ledger.coverage.stale,
      schools: ledger.coverage.schools, zero: ledger.coverage.zero, one: ledger.coverage.one, twoToFour: ledger.coverage.twoToFour,
      fivePlus: ledger.coverage.fivePlus, currentPrograms: ledger.coverage.currentPrograms, currentScholarships: ledger.coverage.currentScholarships } : null,
  })
}

/** A failed refresh preserves observation times and never renews availability. */
export function stalePublicMiniMax(value: PublicMiniMaxStatus, now = Date.now()): PublicMiniMaxStatus {
  return { ...value, generatedAt: new Date(now).toISOString(), state: value.observedAt ? 'stale' : 'unavailable',
    quota: { ...value.quota, state: value.quota.observedAt ? 'stale' : 'unknown' },
    processing: value.processing ? { ...value.processing, fresh: false } : null,
    coverage: value.coverage ? { ...value.coverage, stale: true } : null }
}

/** A cache hit can age or expire, but never becomes a new provider observation. */
export function agePublicMiniMax(value: PublicMiniMaxStatus, now = Date.now()): PublicMiniMaxStatus {
  const quotaFresh = value.quota.state === 'fresh' && value.quota.observedAt !== null && isCurrent(value.quota.observedAt, now)
    && value.quota.fiveHour !== null && Date.parse(value.quota.fiveHour.resetAt) > now
    && value.quota.weekly !== null && (value.quota.weekly.unlimited || value.quota.weekly.resetAt !== null && Date.parse(value.quota.weekly.resetAt) > now)
  const state = value.state === 'fresh' && value.observedAt && isCurrent(value.observedAt, now) ? 'fresh' : value.observedAt ? 'stale' : 'unavailable'
  return { ...value, generatedAt: new Date(now).toISOString(), state,
    quota: { ...value.quota, state: quotaFresh ? 'fresh' : value.quota.observedAt ? 'stale' : 'unknown' },
    processing: value.processing ? { ...value.processing, fresh: value.processing.fresh && isCurrent(value.processing.observedAt, now) } : null,
    coverage: value.coverage ? { ...value.coverage, stale: value.coverage.stale || state !== 'fresh' } : null }
}

/** CDN lifetime must stop before any observation or quota boundary. */
export function publicMonitorCacheSeconds(value: PublicMiniMaxStatus, now = Date.now()): number {
  const boundaries = [now + PUBLIC_MONITOR_CACHE_MS]
  if (value.state === 'fresh' && value.observedAt) boundaries.push(Date.parse(value.observedAt) + CLOUD_MONITOR_STALE_MS)
  if (value.quota.state === 'fresh' && value.quota.observedAt) {
    boundaries.push(Date.parse(value.quota.observedAt) + CLOUD_MONITOR_STALE_MS)
    if (value.quota.fiveHour) boundaries.push(Date.parse(value.quota.fiveHour.resetAt))
    if (!value.quota.weekly?.unlimited && value.quota.weekly?.resetAt) boundaries.push(Date.parse(value.quota.weekly.resetAt))
  }
  if (value.processing?.fresh) boundaries.push(Date.parse(value.processing.observedAt) + CLOUD_MONITOR_STALE_MS)
  return Math.max(0, Math.floor((Math.min(...boundaries) - now) / 1000))
}
