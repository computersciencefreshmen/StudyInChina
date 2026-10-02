import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanBillingSafety } from '../../scripts/ingestion/minimax-billing-safety'
import { normalizeQuota } from '../../scripts/ingestion/minimax-quota'
import { createMiniMaxQuotaCoordinator, withMiniMaxQuota } from '../../scripts/ingestion/verify-catalog-minimax'

const now = Date.parse('2026-09-30T11:30:00Z')
const credits: PlanBillingSafety = { creditFallbackDisabled: false, allowExistingCredits: true, minimumRemainingPercent: 0, confirmedAt: null, authorizedAt: '2026-09-30T11:00:00Z', source: 'user-authorization' }
const planOnly: PlanBillingSafety = { ...credits, creditFallbackDisabled: true, allowExistingCredits: false, source: 'user-confirmation', authorizedAt: null, confirmedAt: '2026-09-30T11:00:00Z' }
afterEach(() => { vi.restoreAllMocks() })
function quota(fiveHour: number, weekly: number) {
  return normalizeQuota({
    base_resp: { status_code: 0 },
    model_remains: [{
      model_name: 'general', start_time: Date.parse('2026-09-30T07:00:00Z'), end_time: Date.parse('2026-09-30T12:00:00Z'),
      weekly_start_time: Date.parse('2026-09-27T16:00:00Z'), weekly_end_time: Date.parse('2026-10-04T16:00:00Z'),
      current_interval_remaining_percent: fiveHour, current_weekly_remaining_percent: weekly,
    }],
  }, 'MiniMax-M3', now)
}

describe('MiniMax model request quota gate', () => {
  it('admits the terminal Shanghai window consistently for plan and authorized-credit calls', async () => {
    const terminalNow = Date.parse('2026-10-02T14:05:00Z')
    const terminal = { ...quota(100, 100), checkedAt: new Date(terminalNow).toISOString(),
      fiveHour: { remainingPercent: 100, startAt: '2026-10-02T12:00:00Z', resetAt: '2026-10-02T16:00:00Z', resetInMs: 6_900_000 } }
    const send = vi.fn(async () => 'response')
    await expect(withMiniMaxQuota(terminal, send, planOnly, terminalNow)).resolves.toBe('response')
    const exhausted = { ...terminal, state: 'exhausted' as const, canRun: false, fiveHour: { ...terminal.fiveHour, remainingPercent: 0 } }
    await expect(withMiniMaxQuota(exhausted, send, credits, terminalNow)).resolves.toBe('response')
    await expect(withMiniMaxQuota(exhausted, send, planOnly, terminalNow)).rejects.toThrow('MiniMax quota exhausted')
    await expect(withMiniMaxQuota(exhausted, send, credits, Date.parse('2026-10-02T16:00:00Z'))).rejects.toThrow('MiniMax quota unknown')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it.each([[0, 100], [50, 0], [0, 0]])('does not send a model request when a plan window is exhausted (%s/%s)', async (fiveHour, weekly) => {
    const send = vi.fn(async () => new Response('model response'))
    await expect(withMiniMaxQuota(quota(fiveHour, weekly), send)).rejects.toThrow('MiniMax quota exhausted')
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send a model request when quota is unknown', async () => {
    const send = vi.fn(async () => new Response('model response'))
    await expect(withMiniMaxQuota(normalizeQuota({}, 'MiniMax-M3', now), send)).rejects.toThrow('MiniMax quota unknown')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends one model request when both plan windows have quota', async () => {
    const send = vi.fn(async () => 'model response')
    await expect(withMiniMaxQuota(quota(2, 100), send)).resolves.toBe('model response')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rechecks permission for a retry after a previous allowed attempt', async () => {
    const send = vi.fn(async () => 'model response')
    await withMiniMaxQuota(quota(1, 100), send)
    await expect(withMiniMaxQuota(quota(0, 100), send)).rejects.toThrow('MiniMax quota exhausted')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('serializes low quota calls and refreshes after waiting, blocking a spent window', async () => {
    let finishFirst!: () => void
    const firstResponse = new Promise<void>(done => { finishFirst = done })
    const query = vi.fn().mockResolvedValueOnce(quota(2, 100)).mockResolvedValueOnce(quota(2, 100)).mockResolvedValue(quota(0, 100))
    const guard = createMiniMaxQuotaCoordinator(query, 4)
    const send = vi.fn(async () => { await firstResponse; return 'model response' })
    const first = guard(send)
    const second = guard(send).catch(error => error)
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2) })
    finishFirst()
    await expect(first).resolves.toBe('model response')
    expect(await second).toMatchObject({ message: 'MiniMax quota exhausted' })
    expect(query).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('allows the configured parallelism with enough quota', async () => {
    let finish!: () => void
    const response = new Promise<void>(done => { finish = done })
    const query = vi.fn(async () => quota(50, 100))
    const guard = createMiniMaxQuotaCoordinator(query, 2)
    const send = vi.fn(async () => { await response; return 'model response' })
    const pending = [guard(send), guard(send), guard(send)]
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(2) })
    finish()
    await expect(Promise.all(pending)).resolves.toEqual(['model response', 'model response', 'model response'])
    expect(send).toHaveBeenCalledTimes(3)
    expect(query).toHaveBeenCalledTimes(4)
  })

  it('keeps the model pool stopped after an exhausted observation until a new run', async () => {
    const query = vi.fn().mockResolvedValueOnce(quota(0, 100)).mockResolvedValue(quota(100, 100))
    const guard = createMiniMaxQuotaCoordinator(query, 4)
    const send = vi.fn(async () => 'model response')
    await expect(guard(send)).rejects.toThrow('MiniMax quota exhausted')
    await expect(guard(send)).rejects.toThrow('MiniMax quota exhausted')
    expect(query).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not start queued calls after a quota query fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private transport context'))
    const guard = createMiniMaxQuotaCoordinator(query, 4)
    const send = vi.fn(async () => 'model response')
    const pending = [guard(send), guard(send), guard(send)]
    const results = await Promise.allSettled(pending)
    expect(results.every(result => result.status === 'rejected' && result.reason.message === 'MiniMax quota unknown')).toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it.each([0, 5, 1.5])('rejects invalid concurrency without waiting forever (%s)', concurrency => {
    expect(() => createMiniMaxQuotaCoordinator(async () => quota(50, 100), concurrency)).toThrow('Quota concurrency')
  })

  it.each([[0, 100], [50, 0], [0, 0]])('admits a freshly established exhausted window only with explicit existing-credit authorization (%s/%s)', async (fiveHour, weekly) => {
    const send = vi.fn(async () => 'credit response')
    await expect(withMiniMaxQuota(quota(fiveHour, weekly), send, credits, now)).resolves.toBe('credit response')
    expect(send).toHaveBeenCalledWith(quota(fiveHour, weekly))
    await expect(withMiniMaxQuota(quota(fiveHour, weekly), send, planOnly, now)).rejects.toThrow('MiniMax quota exhausted')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('blocks unknown, stale, expired and malformed exhausted windows even with credit authorization', async () => {
    const send = vi.fn(async () => 'credit response')
    const exhausted = quota(0, 100)
    await expect(withMiniMaxQuota(normalizeQuota({}, 'MiniMax-M3', now), send, credits, now)).rejects.toThrow('MiniMax quota unknown')
    for (const invalid of [
      { ...exhausted, checkedAt: new Date(now - 30_001).toISOString() },
      { ...exhausted, checkedAt: new Date(now + 1).toISOString() },
      { ...exhausted, fiveHour: { ...exhausted.fiveHour, resetAt: '2026-09-30T11:29:00Z' } },
      { ...exhausted, weekly: { ...exhausted.weekly, startAt: null } },
      { ...exhausted, weekly: { ...exhausted.weekly, remainingPercent: Number.NaN } },
      { ...exhausted, weekly: { ...exhausted.weekly, remainingPercent: 101 } },
    ]) await expect(withMiniMaxQuota(invalid, send, credits, now)).rejects.toThrow('MiniMax quota unknown')
    expect(send).not.toHaveBeenCalled()
  })

  it('retains the confirmation margin when the policy is unconfirmed', async () => {
    const send = vi.fn(async () => 'response')
    await expect(withMiniMaxQuota(quota(5, 100), send, { ...planOnly, creditFallbackDisabled: false, minimumRemainingPercent: 5, source: 'unconfirmed' }, now)).rejects.toThrow('credit_fallback_confirmation_required')
    expect(send).not.toHaveBeenCalled()
  })

  it('serializes authorized credits even when only the weekly pool is exhausted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    let finishFirst!: () => void
    const firstResponse = new Promise<void>(done => { finishFirst = done })
    const query = vi.fn(async () => quota(50, 0))
    const readPolicy = vi.fn(async () => credits)
    const guard = createMiniMaxQuotaCoordinator(query, 4, readPolicy)
    const send = vi.fn(async () => { await firstResponse; return 'credit response' })
    const pending = [guard(send), guard(send)]
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2) })
    finishFirst()
    await expect(Promise.all(pending)).resolves.toEqual(['credit response', 'credit response'])
    expect(query).toHaveBeenCalledTimes(3)
    expect(readPolicy).toHaveBeenCalledTimes(5)
  })

  it('reads policy again immediately before admission so a revoked authorization stops the request', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const readPolicy = vi.fn().mockResolvedValueOnce(credits).mockResolvedValue(planOnly)
    const guard = createMiniMaxQuotaCoordinator(async () => quota(0, 100), 4, readPolicy)
    const send = vi.fn(async () => 'response')
    await expect(guard(send)).rejects.toThrow('MiniMax quota exhausted')
    await expect(guard(send)).rejects.toThrow('MiniMax quota exhausted')
    expect(readPolicy).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
  })

  it('stops queued credit requests after a billing 402 response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    let failFirst!: () => void
    const firstResponse = new Promise<void>(done => { failFirst = done })
    const query = vi.fn(async () => quota(0, 100))
    const guard = createMiniMaxQuotaCoordinator(query, 4, async () => credits)
    const send = vi.fn(async () => { await firstResponse; throw new Error('MiniMax HTTP 402') })
    const pending = [guard(send), guard(send)]
    const observed = Promise.allSettled(pending)
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2) })
    failFirst()
    const results = await observed
    expect(results.every(result => result.status === 'rejected' && result.reason.message === 'MiniMax HTTP 402')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
