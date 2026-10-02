import { describe, expect, it } from 'vitest'
import { assertSafePlanQuota, authorizedCreditWindow, normalizePlanBillingSafety } from '../../scripts/ingestion/minimax-billing-safety'
import type { QuotaState } from '../../scripts/ingestion/minimax-quota'

const quota = (remainingPercent: number): QuotaState => ({
  state: 'available', canRun: true, reason: 'plan_quota_available', model: 'MiniMax-M3', pool: 'general',
  checkedAt: new Date().toISOString(), balanceFallbackAllowed: false,
  fiveHour: { remainingPercent, startAt: null, resetAt: null, resetInMs: null },
  weekly: { remainingPercent: 100, startAt: null, resetAt: null, resetInMs: null },
})

describe('MiniMax account credit-fallback safety', () => {
  it('keeps a margin for missing, malformed, unconfirmed or future-dated settings', () => {
    for (const value of [null, {}, { schemaVersion: 1, creditFallbackDisabled: true }, {
      schemaVersion: 1, creditFallbackDisabled: true, source: 'user-confirmation', confirmedAt: '2999-01-01T00:00:00Z',
    }]) {
      const policy = normalizePlanBillingSafety(value)
      expect(policy.minimumRemainingPercent).toBe(5)
      expect(() => assertSafePlanQuota(quota(5), policy)).toThrow('credit_fallback_confirmation_required')
      expect(() => assertSafePlanQuota(quota(99), policy)).not.toThrow()
    }
  })

  it('permits the full plan window only after an explicit account-setting confirmation', () => {
    const policy = normalizePlanBillingSafety({ schemaVersion: 1, creditFallbackDisabled: true, source: 'user-confirmation', confirmedAt: '2026-10-02T00:00:00Z' })
    expect(policy.minimumRemainingPercent).toBe(0)
    expect(() => assertSafePlanQuota(quota(1), policy)).not.toThrow()
  })

  it('uses the human credit authorization only for a fresh known exhausted plan window', () => {
    const now = Date.parse('2026-10-02T09:00:00Z')
    const policy = normalizePlanBillingSafety({ schemaVersion: 1, allowExistingCredits: true, source: 'user-authorization', authorizedAt: '2026-10-02T08:59:00Z' })
    const exhausted = { ...quota(0), state: 'exhausted' as const, canRun: false, checkedAt: new Date(now).toISOString(),
      fiveHour: { remainingPercent: 0, startAt: '2026-10-02T07:00:00Z', resetAt: '2026-10-02T12:00:00Z', resetInMs: 3 * 3_600_000 },
      weekly: { remainingPercent: 100, startAt: '2026-09-27T16:00:00Z', resetAt: '2026-10-04T16:00:00Z', resetInMs: null },
    }
    expect(authorizedCreditWindow(exhausted, policy, now)).toBe(true)
    expect(authorizedCreditWindow(exhausted, normalizePlanBillingSafety(null), now)).toBe(false)
    expect(authorizedCreditWindow({ ...exhausted, state: 'unknown' }, policy, now)).toBe(false)
    expect(authorizedCreditWindow(exhausted, policy, now + 31_000)).toBe(false)
    expect(authorizedCreditWindow({ ...exhausted, fiveHour: { ...exhausted.fiveHour, resetAt: '2026-10-02T08:00:00Z' } }, policy, now)).toBe(false)
  })
})
