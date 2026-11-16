import { describe, expect, it, vi } from 'vitest'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'
import { projectPublicMiniMax, publicMiniMaxStatusSchema, publicMonitorCacheSeconds } from '../../src/lib/minimax/public-monitor'
import { createPublicMonitorReader } from '../../src/lib/minimax/public-monitor-server'

// The route contract test must never read production configuration or perform IO.
vi.mock('../../src/lib/admin/cloud-minimax', () => ({ readCloudMiniMax: vi.fn(async () => null) }))

const PRIVATE = 'PrivateCredentialId987'
const refill = () => ({ format: 'studyinchina.continuous-refill', version: 1, observedAt: new Date(CLOUD_NOW).toISOString(),
  enabled: true, state: 'running', reason: PRIVATE,
  model: { pending: 3, inflight: 2, eligible: null, limit: 4, epochUsed: 17, epochCap: 256 },
  capture: { pending: 1, inflight: 1, eligible: null, limit: 2, epochUsed: 5, epochCap: 64 },
  lastRefillAt: null, nextWakeAt: null, uncertainDeliveries: 1, modelCallsPerformed: false })

describe('public MiniMax metrics privacy boundary', () => {
  it('projects useful aggregates while removing valid private IDs, free-form codes, reasons and controls', () => {
    const source = cloudSnapshot()
    source.ledger!.recentAttempts[0].attemptId = PRIVATE
    source.ledger!.recentAttempts[0].errorCode = PRIVATE
    source.ledger!.recentJobs[0] = { ...source.ledger!.recentJobs[0], id: PRIVATE, stage: PRIVATE, status: PRIVATE, errorCode: PRIVATE }
    const value = projectPublicMiniMax({ ...source, refill: refill() }, CLOUD_NOW)
    expect(publicMiniMaxStatusSchema.safeParse(value).success).toBe(true)
    expect(value.state).toBe('fresh')
    expect(value.quota.fiveHour?.remainingPercent).toBe(72)
    expect(value.periods[0]).toMatchObject({ attempts: 3, completed: 1, unknown: 1, cacheReadTokens: 40, unknownUsageAttempts: 1 })
    expect(value.processing).toMatchObject({ modelPending: 3, modelExecuting: 2, capturePending: 1, captureExecuting: 1 })
    expect(value.recentCalls[0]).toMatchObject({ status: 'unknown', pass: 'primary', model: 'MiniMax-M3.1-Flash' })
    const json = JSON.stringify(value)
    for (const prohibited of [PRIVATE, 'attemptId', 'recentJobs', 'errorCode', 'reservationKey', 'revision', 'modelsEnabled', 'targetsReady', 'reason'])
      expect(json).not.toContain(prohibited)
  })

  it('never serializes arbitrary nested credentials, URLs, request headers or evidence from extended inputs', () => {
    const original = cloudSnapshot()
    const secret = { authorization: `Bearer ${PRIVATE}`, cookie: `${PRIVATE}=session`, sourceUrl: `https://${PRIVATE}.invalid/private`,
      requestSha256: PRIVATE, sourceId: PRIVATE, payload: { nested: PRIVATE }, stack: PRIVATE }
    const variants = [
      { ...original, ...secret },
      { ...original, quota: { ...original.quota, ...secret } },
      { ...original, ledger: { ...original.ledger, ...secret } },
      { ...original, refill: { ...refill(), ...secret, model: { ...refill().model, ...secret } } },
    ]
    for (const input of variants) {
      const value = projectPublicMiniMax(input, CLOUD_NOW)
      expect(publicMiniMaxStatusSchema.safeParse(value).success).toBe(true)
      expect(JSON.stringify(value)).not.toContain(PRIVATE)
      expect(JSON.stringify(value)).not.toMatch(/Bearer |https:\/\/|authorization|cookie|requestSha256|sourceId|payload|stack/u)
    }
  })

  it('keeps unknown token usage null and does not convert unknown outcomes into successful work', () => {
    const source = cloudSnapshot()
    source.ledger!.periods[0].totals.tokens = { input: null, output: null, cacheRead: null, cacheWrite: null, unknownUsageAttempts: 3 }
    const value = projectPublicMiniMax(source, CLOUD_NOW)
    expect(value.periods[0]).toMatchObject({ completed: 1, unknown: 1, inputTokens: null, outputTokens: null,
      cacheReadTokens: null, cacheWriteTokens: null, unknownUsageAttempts: 3 })
    expect(value.latestCompletedAt).toBeNull()
  })

  it('fails closed on malformed or future observations without exposing raw error strings', () => {
    const future = cloudSnapshot()
    future.generatedAt = new Date(CLOUD_NOW + 6_000).toISOString()
    for (const input of [null, undefined, PRIVATE, new Error(`Bearer ${PRIVATE}`), { error: PRIVATE }, future]) {
      const value = projectPublicMiniMax(input, CLOUD_NOW)
      expect(value).toMatchObject({ state: 'unavailable', observedAt: null, periods: [], recentCalls: [], quota: { state: 'unknown', fiveHour: null } })
      expect(JSON.stringify(value)).not.toContain(PRIVATE)
    }
  })

  it('derives stale status from the evidence clock while retaining the original quota and ledger timestamps', () => {
    const source = { ...cloudSnapshot(), refill: refill() }
    const value = projectPublicMiniMax(source, CLOUD_NOW + 121_000)
    expect(value.state).toBe('stale')
    expect(value.observedAt).toBe(new Date(CLOUD_NOW).toISOString())
    expect(value.quota).toMatchObject({ state: 'stale', observedAt: new Date(CLOUD_NOW).toISOString(), checkedAt: new Date(CLOUD_NOW).toISOString() })
    expect(value.processing?.fresh).toBe(false)
    expect(value.generatedAt).toBe(new Date(CLOUD_NOW + 121_000).toISOString())
  })

  it('does not keep a quota window fresh when its reset crosses the public cache lifetime', async () => {
    let now = CLOUD_NOW
    const source = cloudSnapshot()
    source.quota.fiveHour!.resetAt = new Date(now + 1_000).toISOString()
    const getter = createPublicMonitorReader(vi.fn(async () => source), () => now)
    expect((await getter()).quota.state).toBe('fresh')
    now += 1_001
    const value = await getter()
    expect(value.quota.state).toBe('stale')
    expect(value.quota.observedAt).toBe(source.quota.observedAt)
    expect(value.quota.fiveHour?.resetAt).toBe(source.quota.fiveHour!.resetAt)
  })

  it('does not renew an ageing ledger merely because its public DTO was cached for twenty seconds', async () => {
    let now = CLOUD_NOW
    const source = cloudSnapshot()
    source.ledger!.observedAt = new Date(now - 119_500).toISOString()
    const getter = createPublicMonitorReader(vi.fn(async () => source), () => now)
    expect((await getter()).state).toBe('fresh')
    now += 501
    const value = await getter()
    expect(value.state).toBe('stale')
    expect(value.observedAt).toBe(source.ledger!.observedAt)
  })

  it('bounds shared CDN caching by the earliest quota or observation expiry instead of a fixed twenty seconds', () => {
    const source = cloudSnapshot()
    source.quota.fiveHour!.resetAt = new Date(CLOUD_NOW + 1_000).toISOString()
    const value = projectPublicMiniMax(source, CLOUD_NOW)
    expect(publicMonitorCacheSeconds(value, CLOUD_NOW)).toBe(1)
    expect(publicMonitorCacheSeconds(value, CLOUD_NOW + 501)).toBe(0)
    expect(publicMonitorCacheSeconds(value, CLOUD_NOW + 1_001)).toBe(0)
    source.ledger!.observedAt = new Date(CLOUD_NOW - 119_500).toISOString()
    expect(publicMonitorCacheSeconds(projectPublicMiniMax(source, CLOUD_NOW), CLOUD_NOW)).toBe(0)
  })

  it('coalesces public refreshes and keeps only redacted stale data after transport failures or invalid replacements', async () => {
    let now = CLOUD_NOW
    const source = cloudSnapshot()
    source.ledger!.recentAttempts[0].attemptId = PRIVATE
    let finish!: (value: unknown) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockRejectedValueOnce(new Error(`SQL, cookie and Bearer ${PRIVATE}`))
      .mockResolvedValueOnce({ error: PRIVATE })
    const getter = createPublicMonitorReader(read, () => now)
    const pending = Array.from({ length: 8 }, () => getter())
    expect(read).toHaveBeenCalledTimes(1)
    finish(source)
    const values = await Promise.all(pending)
    expect(values.every(v => v.state === 'fresh')).toBe(true)
    expect(JSON.stringify(values)).not.toContain(PRIVATE)
    now += 19_999
    await getter()
    expect(read).toHaveBeenCalledTimes(1)
    now += 2
    const stale = await getter()
    expect(read).toHaveBeenCalledTimes(2)
    expect(stale.state).toBe('stale')
    expect(stale.observedAt).toBe(source.ledger!.observedAt)
    expect(stale.quota.observedAt).toBe(source.quota.observedAt)
    expect(stale.quota.state).toBe('stale')
    expect(JSON.stringify(stale)).not.toContain(PRIVATE)
    now += 20_001
    const invalid = await getter()
    expect(invalid.state).toBe('stale')
    expect(invalid.observedAt).toBe(stale.observedAt)
    expect(JSON.stringify(invalid)).not.toContain(PRIVATE)
  })

  it('exposes only a GET handler and returns a public response without authentication or cookies', async () => {
    const route = await import('../../src/app/api/minimax/status/route')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(method in route).toBe(false)
    const response = await route.GET()
    expect(response.status).toBe(200)
    expect(publicMiniMaxStatusSchema.safeParse(await response.json()).success).toBe(true)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=20')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('www-authenticate')).toBeNull()
    expect(response.headers.get('authorization')).toBeNull()
  })
})
