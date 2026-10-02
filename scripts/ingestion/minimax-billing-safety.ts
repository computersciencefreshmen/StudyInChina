import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { QuotaState } from './minimax-quota'

export type PlanBillingSafety = {
  creditFallbackDisabled: boolean
  allowExistingCredits: boolean
  minimumRemainingPercent: 0 | 5
  confirmedAt: string | null
  authorizedAt: string | null
  source: 'user-authorization' | 'user-confirmation' | 'unconfirmed'
}

/** The quota API cannot disable the account's automatic credit fallback. */
export function normalizePlanBillingSafety(value: unknown): PlanBillingSafety {
  const unconfirmed: PlanBillingSafety = { creditFallbackDisabled: false, allowExistingCredits: false, minimumRemainingPercent: 5, confirmedAt: null, authorizedAt: null, source: 'unconfirmed' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unconfirmed
  const record = value as Record<string, unknown>
  if (record.schemaVersion === 1 && record.allowExistingCredits === true && record.source === 'user-authorization' &&
    typeof record.authorizedAt === 'string' && Number.isFinite(Date.parse(record.authorizedAt)) && Date.parse(record.authorizedAt) <= Date.now()) {
    return { creditFallbackDisabled: false, allowExistingCredits: true, minimumRemainingPercent: 0, confirmedAt: null, authorizedAt: record.authorizedAt, source: 'user-authorization' }
  }
  if (record.schemaVersion !== 1 || record.creditFallbackDisabled !== true || record.source !== 'user-confirmation' ||
    typeof record.confirmedAt !== 'string' || !Number.isFinite(Date.parse(record.confirmedAt)) || Date.parse(record.confirmedAt) > Date.now()) return unconfirmed
  return { creditFallbackDisabled: true, allowExistingCredits: false, minimumRemainingPercent: 0, confirmedAt: record.confirmedAt, authorizedAt: null, source: 'user-confirmation' }
}

export async function readPlanBillingSafety(root: string): Promise<PlanBillingSafety> {
  try {
    const text = await readFile(join(root, '.tmp/minimax-verification/billing-safety.json'), 'utf8')
    if (Buffer.byteLength(text) > 4096) return normalizePlanBillingSafety(null)
    return normalizePlanBillingSafety(JSON.parse(text))
  } catch { return normalizePlanBillingSafety(null) }
}

export async function choosePlanQuotaFloor(root: string): Promise<0 | 5> {
  return (await readPlanBillingSafety(root)).minimumRemainingPercent
}

/** Preserve a margin unless credit fallback is disabled or existing credits are explicitly authorized. */
export function assertSafePlanQuota(quota: QuotaState, policy: PlanBillingSafety): void {
  if (quota.state === 'available' && quota.canRun && quota.fiveHour.remainingPercent !== null &&
    quota.fiveHour.remainingPercent <= policy.minimumRemainingPercent) {
    throw new Error('MiniMax quota credit_fallback_confirmation_required')
  }
}

/** Credit authorization never overrides an unknown query, unsafe configuration or stale window. */
export function authorizedCreditWindow(quota: QuotaState, policy: PlanBillingSafety, now = Date.now()): boolean {
  if (!policy.allowExistingCredits || quota.state !== 'exhausted') return false
  const fiveStart = Date.parse(quota.fiveHour.startAt || '')
  const fiveEnd = Date.parse(quota.fiveHour.resetAt || '')
  const weekStart = Date.parse(quota.weekly.startAt || '')
  const weekEnd = Date.parse(quota.weekly.resetAt || '')
  const checked = Date.parse(quota.checkedAt)
  return Number.isFinite(checked) && checked <= now && now - checked <= 30_000 &&
    Number.isFinite(fiveStart) && Number.isFinite(fiveEnd) && fiveStart <= now && now < fiveEnd && fiveEnd - fiveStart === 5 * 3_600_000 &&
    Number.isFinite(weekStart) && Number.isFinite(weekEnd) && weekStart <= now && now < weekEnd && weekEnd - weekStart === 7 * 24 * 3_600_000 &&
    quota.fiveHour.remainingPercent !== null && quota.weekly.remainingPercent !== null &&
    (quota.fiveHour.remainingPercent === 0 || quota.weekly.remainingPercent === 0)
}
