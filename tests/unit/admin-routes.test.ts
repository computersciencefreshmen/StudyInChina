import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_COOKIE, createAdminSession } from '../../src/lib/admin/auth'

const mocked = vi.hoisted(() => ({ snapshot: vi.fn(), runs: vi.fn(), launch: vi.fn(), limiter: vi.fn() }))
vi.mock('../../src/lib/admin/snapshot', () => ({ getAdminSnapshot: mocked.snapshot, readLocalVerificationRuns: mocked.runs }))
vi.mock('../../src/lib/admin/verification', async importOriginal => ({ ...await importOriginal<typeof import('../../src/lib/admin/verification')>(), launchVerification: mocked.launch }))
vi.mock('../../src/lib/feedback/rate-limit', () => ({ consumeFeedbackRateLimit: mocked.limiter }))
import { GET as status } from '../../src/app/api/admin/status/route'
import { GET as events } from '../../src/app/api/admin/events/route'
import { POST as start } from '../../src/app/api/admin/verification/route'
import { POST as login, DELETE as logout } from '../../src/app/api/admin/session/route'

const password = 'synthetic-admin-password-'.repeat(2)
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ADMIN_ACCESS_TOKEN', password)
  vi.stubEnv('ADMIN_SESSION_SECRET', 'synthetic-admin-session-'.repeat(2))
  mocked.limiter.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 })
})
afterEach(() => vi.unstubAllEnvs())

function authenticated(body: unknown, origin = 'https://example.test'): Request {
  return new Request('https://example.test/api/admin/verification', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${ADMIN_COOKIE}=${createAdminSession()}`, origin }, body: JSON.stringify(body) })
}

describe('administrator route authorization', () => {
  it('rejects unauthenticated snapshot, stream and start requests before reading files or spawning', async () => {
    const request = new Request('https://example.test/api/admin/status')
    expect((await status(request)).status).toBe(401)
    expect(events(request).status).toBe(401)
    expect((await start(new Request('https://example.test/api/admin/verification', { method: 'POST' }))).status).toBe(401)
    expect(mocked.snapshot).not.toHaveBeenCalled()
    expect(mocked.runs).not.toHaveBeenCalled()
    expect(mocked.launch).not.toHaveBeenCalled()
  })

  it('blocks cross-origin and non-typed commands before invoking the executor', async () => {
    expect((await start(authenticated({ collection: 'all', mode: 'sample' }, 'https://attacker.test'))).status).toBe(403)
    expect((await start(authenticated({ collection: 'all', mode: 'sample', command: 'arbitrary' }))).status).toBe(400)
    expect((await start(authenticated({ collection: 'all', mode: 'sample', model: 'MiniMax-M3', effort: 'max' }))).status).toBe(400)
    expect(mocked.launch).not.toHaveBeenCalled()
  })

  it('accepts typed administrator work and sanitizes failure responses', async () => {
    mocked.launch.mockResolvedValueOnce(1234)
    const accepted = await start(authenticated({ collection: 'programs', mode: 'sample', limit: 20 }))
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ accepted: true, pid: 1234 })
    mocked.launch.mockRejectedValueOnce(new Error('verification_already_running'))
    expect((await start(authenticated({ collection: 'all', mode: 'full' }))).status).toBe(409)
    mocked.launch.mockRejectedValueOnce(new Error('private-path-and-secret'))
    const failed = await start(authenticated({ collection: 'all', mode: 'sample' }))
    expect(failed.status).toBe(503)
    expect(await failed.text()).toBe('{"error":"executor_unavailable"}')
  })

  it('streams snapshot events and releases work when the browser disconnects', async () => {
    mocked.snapshot.mockResolvedValue({ generatedAt: '2026-09-30T10:00:00Z', runs: [] })
    const request = new Request('https://example.test/api/admin/events', { headers: { cookie: `${ADMIN_COOKIE}=${createAdminSession()}` } })
    const response = events(request)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toContain('no-store')
    const reader = response.body!.getReader()
    const chunk = await reader.read()
    expect(new TextDecoder().decode(chunk.value)).toContain('event: snapshot\ndata: {')
    await reader.cancel()
    reader.releaseLock()
  })
})

describe('administrator browser login', () => {
  const loginRequest = (value: unknown) => new Request('https://example.test/api/admin/session', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(value) })

  it('uses HttpOnly, HTTPS, strict cookies and never returns a secret', async () => {
    const response = await login(loginRequest({ password }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(response.headers.get('set-cookie')).toMatch(/Secure/)
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=strict/i)
    expect(await response.text()).not.toContain(password)
    expect((await login(loginRequest({ password: 'wrong' }))).status).toBe(401)
  })

  it('fails closed when rate limiting is unavailable and requires origin for logout', async () => {
    mocked.limiter.mockRejectedValueOnce(new Error('private redis token'))
    const unavailable = await login(loginRequest({ password }))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('private redis token')
    expect(logout(new Request('https://example.test/api/admin/session', { method: 'DELETE' })).status).toBe(403)
    const response = logout(new Request('https://example.test/api/admin/session', { method: 'DELETE', headers: { origin: 'https://example.test' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/)
  })
})
