import { describe, expect, it, vi } from 'vitest'
import { createAdminTelemetry, adminTelemetrySchema, ADMIN_TELEMETRY_MAX_BYTES, telemetryIsStale } from '../../src/lib/admin/telemetry-contract'
import { ADMIN_TELEMETRY_OBJECT, handleAdminTelemetry } from '../../workers/catalog-api/src/admin-telemetry'
import worker from '../../workers/catalog-api/src/index'
import type { CatalogApiEnv, R2ObjectBody } from '../../workers/catalog-api/src/types'
import { adminSnapshot } from '../fixtures/admin-workbench'
import type { AdminUsageLedger } from '../../src/lib/admin/types'

const token = 'private-telemetry-test-token-'.repeat(2)
const url = 'https://catalog.test/internal/v1/admin-telemetry'
const time = Date.parse('2026-09-30T11:00:00.000Z')
function snapshot(observedAt = new Date(time).toISOString()) {
  const fixture = adminSnapshot()
  const runs = fixture.runs.map(run => ({ ...run, id: 'a'.repeat(16), title: '目录核验任务' }))
  return createAdminTelemetry(runs, fixture.model.configured, observedAt)
}
function environment(initial?: unknown) {
  let body: string | null = initial === undefined ? null : JSON.stringify(initial)
  let etag = 'initial'
  const get = vi.fn(async (): Promise<R2ObjectBody | null> => body === null ? null : { body: null, size: new TextEncoder().encode(body).length, etag, text: async () => body! })
  const put = vi.fn(async (_key: string, value: string, options: { onlyIf: Headers | { etagMatches: string } }) => {
    if (body === null ? !(options.onlyIf instanceof Headers) || options.onlyIf.get('if-none-match') !== '*' : options.onlyIf instanceof Headers || options.onlyIf.etagMatches !== etag) return null
    body = value; etag += '-next'
    return { etag }
  })
  const prepare = vi.fn(() => { throw new Error('Daily D1 quota exhausted; telemetry must not query D1') })
  const env: CatalogApiEnv = { CATALOG_DB: { prepare }, RELEASES_BUCKET: { get, put }, ADMIN_TELEMETRY_TOKEN: token }
  return { env, get, put, prepare }
}
function request(method: string, value?: unknown, authorized = true) {
  return new Request(url, { method, headers: authorized ? { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {}, ...(value === undefined ? {} : { body: JSON.stringify(value) }) })
}
function ledger(): AdminUsageLedger {
  const totals = { attempts: 4, instrumentedAttempts: 3, historicalResponses: 1, unknownUsageAttempts: 1,
    reportedTokens: 50000, instrumentedReportedTokens: 30000, historicalReportedTokensLowerBound: 20000,
    inputTokens: 40000, uncachedInputTokens: 39000, outputTokens: 10000, cacheReadTokens: 1000, cacheWriteTokens: 0, reasoningTokens: 2000 }
  return { generatedAt: new Date(time).toISOString(), timezone: 'Asia/Shanghai', todayDay: '2026-09-30', dailyTarget: null,
    totals, daily: [{ ...totals, day: '2026-09-30' }], rejectedReceipts: 0, conflictingAttempts: 0 }
}

describe('strict administrator telemetry contract', () => {
  it('rejects raw provider content, bad counters, duplicate identity and inaccurate aggregate totals', () => {
    const good = snapshot()
    expect(adminTelemetrySchema.safeParse(good).success).toBe(true)
    expect(adminTelemetrySchema.safeParse({ ...good, apiKey: 'must-not-cross-boundary' }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...good, runs: [{ ...good.runs[0], output: 'private model text' }] }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...good, usage: { ...good.usage, totalTokens: good.usage.totalTokens + 1 } }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...good, runs: [good.runs[0], good.runs[0]] }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...good, usage: { ...good.usage, inputTokens: -1 } }).success).toBe(false)
  })
  it('marks an observation stale after two minutes and rejects future freshness', () => {
    expect(telemetryIsStale(new Date(time).toISOString(), time + 120_000)).toBe(false)
    expect(telemetryIsStale(new Date(time).toISOString(), time + 120_001)).toBe(true)
    expect(telemetryIsStale(new Date(time + 30_001).toISOString(), time)).toBe(true)
  })
  it('uses immutable attempt totals when retries overwrite saved response files, preserving unknown attempts separately', () => {
    const saved = snapshot()
    const value = createAdminTelemetry(saved.runs, saved.model.configured, saved.observedAt, { ledger: ledger() })
    expect(value.usageBasis).toBe('immutable-ledger')
    expect(value.usage).toMatchObject({ totalTokens: 50000, inputTokens: 40000, outputTokens: 10000, cacheReadTokens: 1000, requests: 3 })
    expect(value.runs).toEqual(saved.runs)
    expect(value.ledger?.totals.unknownUsageAttempts).toBe(1)
    expect(adminTelemetrySchema.safeParse({ ...value, usage: saved.usage }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...value, ledger: null }).success).toBe(false)
  })
  it('rejects duplicate days and inconsistent totals instead of showing inflated or double-counted tokens', () => {
    const saved = snapshot()
    const value = createAdminTelemetry(saved.runs, saved.model.configured, saved.observedAt, { ledger: ledger() })
    const raw = value.ledger!
    expect(adminTelemetrySchema.safeParse({ ...value, ledger: { ...raw, totals: { ...raw.totals, reportedTokens: 50001 } } }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...value, ledger: { ...raw, daily: [raw.daily[0], raw.daily[0]] } }).success).toBe(false)
    expect(adminTelemetrySchema.safeParse({ ...value, ledger: { ...raw, daily: [{ ...raw.daily[0], unknownUsageAttempts: 5 }] } }).success).toBe(false)
  })
})

describe('private administrator R2 telemetry', () => {
  it('requires independent authorization before any storage and offers no public CORS', async () => {
    const storage = environment()
    const response = await worker.fetch(request('PUT', snapshot(), false), storage.env)
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(storage.get).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
    expect(storage.prepare).not.toHaveBeenCalled()
    const weak = await handleAdminTelemetry(request('GET'), { ...storage.env, ADMIN_TELEMETRY_TOKEN: 'short' }, time)
    expect(weak.status).toBe(403)
  })
  it('persists exact observations outside release paths and reads them without D1', async () => {
    const storage = environment()
    const value = snapshot()
    const uploaded = await handleAdminTelemetry(request('PUT', value), storage.env, time)
    expect(uploaded.status).toBe(200)
    expect(await uploaded.json()).toMatchObject({ accepted: true, observedAt: value.observedAt })
    expect(storage.put).toHaveBeenCalledWith(ADMIN_TELEMETRY_OBJECT, JSON.stringify(value), expect.objectContaining({ httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } }))
    const observed = await handleAdminTelemetry(request('GET'), storage.env, time)
    expect(await observed.json()).toEqual(value)
    expect(storage.prepare).not.toHaveBeenCalled()
    expect(JSON.stringify(value)).not.toContain(token)
  })
  it('keeps newer saved totals when an older upload arrives', async () => {
    const storage = environment(snapshot(new Date(time + 1_000).toISOString()))
    const response = await handleAdminTelemetry(request('PUT', snapshot()), storage.env, time + 1_000)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accepted: false, observedAt: new Date(time + 1_000).toISOString() })
    expect(storage.put).not.toHaveBeenCalled()
  })
  it('rechecks a conditional-write race before retaining a newer observation', async () => {
    const storage = environment(snapshot(new Date(time - 1_000).toISOString()))
    const newer = snapshot(new Date(time + 1_000).toISOString())
    const serialized = JSON.stringify(newer)
    storage.get.mockResolvedValueOnce({ body: null, size: serialized.length, etag: 'older', text: async () => JSON.stringify(snapshot(new Date(time - 1_000).toISOString())) })
    storage.get.mockResolvedValueOnce({ body: null, size: serialized.length, etag: 'newer', text: async () => serialized })
    storage.put.mockResolvedValueOnce(null)
    const response = await handleAdminTelemetry(request('PUT', snapshot()), storage.env, time)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accepted: false, observedAt: newer.observedAt })
    expect(storage.get).toHaveBeenCalledTimes(2)
    expect(storage.put).toHaveBeenCalledTimes(1)
  })
  it('does not manufacture a zero snapshot on missing, corrupt or unavailable storage', async () => {
    const missing = await handleAdminTelemetry(request('GET'), environment().env, time)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'telemetry_unavailable' })
    const malformed = await handleAdminTelemetry(request('GET'), environment({ ...snapshot(), apiKey: 'private-secret' }).env, time)
    expect(malformed.status).toBe(503)
    const failed = environment()
    failed.get.mockRejectedValueOnce(new Error('private storage detail'))
    const response = await handleAdminTelemetry(request('GET'), failed.env, time)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(/private storage|private-secret/)
  })
  it('bounds upload size and rejects future timestamps before writing', async () => {
    const storage = environment()
    expect((await handleAdminTelemetry(request('PUT', { ...snapshot(), extra: 'a'.repeat(ADMIN_TELEMETRY_MAX_BYTES) }), storage.env, time)).status).toBe(400)
    expect((await handleAdminTelemetry(request('PUT', snapshot(new Date(time + 30_001).toISOString())), storage.env, time)).status).toBe(400)
    expect(storage.put).not.toHaveBeenCalled()
    expect((await handleAdminTelemetry(request('POST', snapshot()), storage.env, time)).status).toBe(405)
  })
})
