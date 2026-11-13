import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../workers/catalog-api/src/index'
import type { ActiveReleaseRow, CatalogApiEnv } from '../../workers/catalog-api/src/types'

const paths = ['/internal/v1/admin-telemetry', '/internal/v1/admin-executor', '/internal/v1/admin-releases']
const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']
const token = 'migration-freeze-test-token-not-a-real-secret'

function fixture(flag?: string) {
  const prepare = vi.fn(() => { throw new Error('unexpected D1 access during migration freeze') })
  const get = vi.fn(async () => { throw new Error('unexpected R2 read during migration freeze') })
  const put = vi.fn(async () => { throw new Error('unexpected R2 write during migration freeze') })
  const env: CatalogApiEnv = { CATALOG_DB: { prepare }, RELEASES_BUCKET: { get, put },
    CATALOG_API_TOKEN: token, ADMIN_TELEMETRY_TOKEN: token, ADMIN_RELEASE_CONTROL_ENABLED: 'true',
    ...(flag === undefined ? {} : { ACCOUNT_MIGRATION_FROZEN: flag }) }
  return { env, prepare, get, put }
}

afterEach(() => vi.useRealTimers())

describe('catalog account migration writer freeze', () => {
  it.each(paths)('blocks every method at %s before auth, body parsing or storage', async path => {
    const f = fixture('true')
    for (const method of methods) for (const authorized of [false, true]) {
      const request = new Request(`https://catalog.test${path}?migration=private`, { method,
        headers: authorized ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
        ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { body: 'deliberately-invalid-json' } : {}) })
      const response = await worker.fetch(request, f.env)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: { code: 'account_migration_frozen' } })
      expect(response.headers.get('retry-after')).toBe('3600')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(request.bodyUsed).toBe(false)
    }
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.get).not.toHaveBeenCalled()
    expect(f.put).not.toHaveBeenCalled()
  })

  it.each([undefined, 'false', 'TRUE', '1'])('keeps original authorization when the flag is %s', async flag => {
    const f = fixture(flag)
    for (const path of paths) {
      const response = await worker.fetch(new Request(`https://catalog.test${path}`), f.env)
      expect(response.status).toBe(403)
      expect(response.headers.get('retry-after')).toBeNull()
      expect(await response.text()).not.toContain('account_migration_frozen')
    }
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.get).not.toHaveBeenCalled()
    expect(f.put).not.toHaveBeenCalled()
  })

  it('preserves public GET/HEAD releases and CORS OPTIONS while admin writers are frozen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T06:00:00Z'))
    const counts = JSON.stringify({ sources: 1, cities: 1, universities: 1, programs: 1, admissionCycles: 1, scholarships: 1 })
    const release: ActiveReleaseRow = { release_id: 'migration-snapshot-release', data_date: '2026-11-13',
      generated_at: '2026-11-13T01:00:00Z', activated_at: '2026-11-13T01:01:00Z', data_checked_through: '2026-11-12',
      raw_counts_json: counts, counts_json: counts, content_sha256: 'a'.repeat(64),
      compatibility_artifact_key: null, compatibility_content_sha256: null, compatibility_byte_length: null }
    const prepare = vi.fn(() => ({ bind() { return this }, async first<T>() { return release as T }, async all<T>() { return { success: true, results: [] as T[] } } }))
    const f = fixture('true')
    f.env.CATALOG_DB = { prepare }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const url = 'https://catalog.test/api/v1/releases/current'
      const frozen = await worker.fetch(new Request(url, { method }), f.env)
      const normal = await worker.fetch(new Request(url, { method }), { ...f.env, ACCOUNT_MIGRATION_FROZEN: undefined })
      expect(frozen.status).toBe(normal.status)
      expect([...frozen.headers]).toEqual([...normal.headers])
      expect(await frozen.text()).toBe(await normal.text())
      expect(frozen.headers.get('retry-after')).toBeNull()
    }
    expect(prepare).toHaveBeenCalledTimes(4)
    expect(f.get).not.toHaveBeenCalled()
    expect(f.put).not.toHaveBeenCalled()
  })

  it('preserves health and excludes similar, unknown admin paths from the exact freeze list', async () => {
    const f = fixture('true')
    for (const method of ['GET', 'HEAD']) {
      const health = await worker.fetch(new Request('https://catalog.test/health', { method }), f.env)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true, service: 'catalog-api' })
      expect(health.headers.get('retry-after')).toBeNull()
    }
    const unknown = await worker.fetch(new Request('https://catalog.test/internal/v1/admin-releases-other'), f.env)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: { code: 'not_found' } })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.get).not.toHaveBeenCalled()
    expect(f.put).not.toHaveBeenCalled()
  })
})
