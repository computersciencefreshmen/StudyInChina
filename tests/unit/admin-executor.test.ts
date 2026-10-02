import { describe, expect, it, vi } from 'vitest'
import { ADMIN_COMMAND_LEASE_MS, ADMIN_COMMAND_TTL_MS, ADMIN_EXECUTOR_ID, ADMIN_EXECUTOR_OBJECT, handleAdminExecutor } from '../../workers/catalog-api/src/admin-executor'
import worker from '../../workers/catalog-api/src/index'
import type { CatalogApiEnv, R2ObjectBody } from '../../workers/catalog-api/src/types'

const token = 'administrator-executor-test-'.repeat(2)
const url = 'https://catalog.test/internal/v1/admin-executor'
const now = Date.parse('2026-10-02T10:00:00.000Z')
const commandId = 'bca14973-d37e-4b4d-8742-4ad95a64a90c'
const attemptId = '7ed8c4ed-32ac-4b11-b548-e59f10cb6b6c'
const command = { commandId, action: 'pause' }
const identity = { commandId, executorId: ADMIN_EXECUTOR_ID, attemptId }
function storage() {
  const values = new Map<string, { text: string; etag: string }>()
  let serial = 0
  const get = vi.fn(async (key: string): Promise<R2ObjectBody | null> => {
    const value = values.get(key)
    return value ? { body: null, size: new TextEncoder().encode(value.text).length, etag: value.etag, text: async () => value.text } : null
  })
  const put = vi.fn(async (key: string, text: string, options: { onlyIf: Headers | { etagMatches: string } }) => {
    const prior = values.get(key)
    if (prior ? options.onlyIf instanceof Headers || options.onlyIf.etagMatches !== prior.etag : !(options.onlyIf instanceof Headers) || options.onlyIf.get('if-none-match') !== '*') return null
    const etag = `etag-${++serial}`
    values.set(key, { text, etag })
    return { etag }
  })
  const prepare = vi.fn(() => { throw new Error('Executor control must not query catalog D1') })
  const env: CatalogApiEnv = { CATALOG_DB: { prepare }, RELEASES_BUCKET: { get, put }, ADMIN_TELEMETRY_TOKEN: token }
  return { env, get, put, prepare, values }
}
function request(method: string, body?: unknown, auth = true) {
  return new Request(url, { method, headers: auth ? { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function call(env: CatalogApiEnv, method: string, body?: unknown, time = now) {
  const response = await handleAdminExecutor(request(method, body), env, time)
  return { status: response.status, value: await response.json() }
}

describe('private administrator executor transport', () => {
  it('authorizes before any private storage, with no browser CORS or D1 query', async () => {
    const fixture = storage()
    const response = await worker.fetch(request('POST', command, false), fixture.env)
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(fixture.get).not.toHaveBeenCalled()
    expect(fixture.put).not.toHaveBeenCalled()
    expect(fixture.prepare).not.toHaveBeenCalled()
    expect((await handleAdminExecutor(request('GET'), { ...fixture.env, ADMIN_TELEMETRY_TOKEN: 'short' }, now)).status).toBe(403)
  })
  it('rejects arbitrary commands, paths, invalid model/effort and oversized bodies before enqueue', async () => {
    const fixture = storage()
    for (const body of [
      { ...command, shell: 'do not execute' }, { ...command, action: 'delete' },
      { ...command, action: 'start' }, { ...command, options: { collection: 'all', mode: 'full' } },
      { ...command, action: 'start', options: { collection: 'all', mode: 'full', model: 'MiniMax-M3', effort: 'max' } },
      { ...command, padding: 'a'.repeat(9 * 1_024) },
    ]) expect((await call(fixture.env, 'POST', body)).status).toBe(400)
    expect(fixture.put).not.toHaveBeenCalled()
  })
  it('enqueues once, claims with one unique attempt and acknowledges idempotently', async () => {
    const fixture = storage()
    const posted = await call(fixture.env, 'POST', command)
    expect(posted).toMatchObject({ status: 202, value: { ok: true, duplicate: false, command: { status: 'pending', commandId, expiresAt: new Date(now + ADMIN_COMMAND_TTL_MS).toISOString() } } })
    expect(await call(fixture.env, 'POST', command)).toMatchObject({ value: { duplicate: true, command: { status: 'pending' } } })
    expect(await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })).toMatchObject({ status: 200, value: { command: { status: 'claimed', attemptId } } })
    expect(await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })).toMatchObject({ status: 200, value: { command: { status: 'claimed' } } })
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity, attemptId: '4b8a9077-4bf4-47af-a7fb-e201d6c3d0a3' })).status).toBe(409)
    expect(await call(fixture.env, 'PATCH', { operation: 'complete', ...identity, result: 'completed' })).toMatchObject({ value: { command: { status: 'completed' } } })
    expect(await call(fixture.env, 'PATCH', { operation: 'complete', ...identity, result: 'completed' })).toMatchObject({ value: { command: { status: 'completed' } } })
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })).status).toBe(409)
    expect(fixture.prepare).not.toHaveBeenCalled()
    expect(JSON.stringify((await call(fixture.env, 'GET')).value)).not.toContain(token)
  })
  it('binds claims to the configured executor and attempt', async () => {
    const fixture = storage()
    await call(fixture.env, 'POST', command)
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity, executorId: 'another-machine' })).status).toBe(403)
    await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })
    expect((await call(fixture.env, 'PATCH', { operation: 'complete', ...identity, attemptId: '4b8a9077-4bf4-47af-a7fb-e201d6c3d0a3', result: 'completed' })).status).toBe(409)
  })
  it('expires unclaimed commands after five minutes without manufacturing execution', async () => {
    const fixture = storage()
    await call(fixture.env, 'POST', command)
    expect(await call(fixture.env, 'GET', undefined, now + ADMIN_COMMAND_TTL_MS)).toMatchObject({ value: { commands: [{ status: 'expired', error: 'command_expired' }] } })
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity }, now + ADMIN_COMMAND_TTL_MS)).status).toBe(409)
  })
  it('renews a live lease but never redispatches a claim after its owner loses acknowledgement', async () => {
    const fixture = storage()
    await call(fixture.env, 'POST', command)
    await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })
    expect(await call(fixture.env, 'PATCH', { operation: 'renew', ...identity }, now + 20_000)).toMatchObject({ value: { command: { leaseExpiresAt: new Date(now + 20_000 + ADMIN_COMMAND_LEASE_MS).toISOString() } } })
    const lostAt = now + 20_000 + ADMIN_COMMAND_LEASE_MS
    expect(await call(fixture.env, 'GET', undefined, lostAt)).toMatchObject({ value: { commands: [{ status: 'failed', error: 'execution_outcome_unknown' }] } })
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity }, lostAt)).status).toBe(409)
    expect((await call(fixture.env, 'PATCH', { operation: 'complete', ...identity, result: 'completed' }, lostAt)).status).toBe(409)
  })
  it('uses permanent UUID reservations even after bounded history has discarded an old entry', async () => {
    const fixture = storage()
    await call(fixture.env, 'POST', command)
    await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })
    await call(fixture.env, 'PATCH', { operation: 'complete', ...identity, result: 'completed' })
    const saved = fixture.values.get(ADMIN_EXECUTOR_OBJECT)!
    fixture.values.set(ADMIN_EXECUTOR_OBJECT, { ...saved, text: JSON.stringify({ version: 1, observedAt: new Date(now).toISOString(), commands: [] }) })
    expect(await call(fixture.env, 'POST', command, now + 1_000)).toMatchObject({ value: { duplicate: true, command: { status: 'failed', error: 'execution_outcome_unknown' } } })
    expect((await call(fixture.env, 'POST', { ...command, action: 'resume' })).status).toBe(409)
  })
  it('retries conditional-write conflicts without letting two commands run concurrently', async () => {
    const fixture = storage()
    const originalPut = fixture.put.getMockImplementation()!
    let collided = false
    fixture.put.mockImplementation(async (key, text, options) => {
      if (key === ADMIN_EXECUTOR_OBJECT && !collided) { collided = true; return null }
      return originalPut(key, text, options)
    })
    expect((await call(fixture.env, 'POST', command)).status).toBe(202)
    const second = { commandId: 'acfc71b7-7c69-43ec-845c-58e39d4df6ca', action: 'resume' }
    await call(fixture.env, 'POST', second)
    await call(fixture.env, 'PATCH', { operation: 'claim', ...identity })
    expect((await call(fixture.env, 'PATCH', { operation: 'claim', ...identity, commandId: second.commandId, attemptId: '4b8a9077-4bf4-47af-a7fb-e201d6c3d0a3' })).status).toBe(409)
  })
  it('returns only fixed safe errors on corrupt storage or storage failure', async () => {
    const fixture = storage()
    fixture.get.mockRejectedValueOnce(new Error('private-key-do-not-print'))
    const result = await call(fixture.env, 'GET')
    expect(result).toEqual({ status: 503, value: { error: 'executor_unavailable' } })
    expect(JSON.stringify(result)).not.toContain('private-key')
    expect((await handleAdminExecutor(request('DELETE'), fixture.env, now)).status).toBe(405)
  })
})
