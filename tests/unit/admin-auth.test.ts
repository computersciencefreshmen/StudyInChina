import { describe, expect, it } from 'vitest'
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, adminConfigured, createAdminSession, isAdminMutationOrigin, matchesAdminPassword, readAdminJson, readAdminSession, requestAdminSession } from '../../src/lib/admin/auth'

const environment = { ADMIN_ACCESS_TOKEN: 'test-admin-access-'.repeat(3), ADMIN_SESSION_SECRET: 'test-admin-session-'.repeat(3) }
const now = Date.parse('2026-09-30T10:00:00Z')

describe('administrator session trust boundaries', () => {
  it('requires independently configured server secrets and rejects an incorrect credential', () => {
    expect(adminConfigured({})).toBe(false)
    expect(adminConfigured({ ...environment, ADMIN_SESSION_SECRET: 'short' })).toBe(false)
    expect(matchesAdminPassword(environment.ADMIN_ACCESS_TOKEN, environment)).toBe(true)
    expect(matchesAdminPassword('incorrect', environment)).toBe(false)
  })

  it('accepts signed sessions until expiration, rejects tampering and secret rotation', () => {
    const token = createAdminSession(environment, now)
    expect(readAdminSession(token, environment, now + 1).authenticated).toBe(true)
    expect(readAdminSession(token, environment, now + ADMIN_SESSION_SECONDS * 1_000).authenticated).toBe(false)
    expect(readAdminSession(`${token}x`, environment, now + 1).authenticated).toBe(false)
    expect(readAdminSession(token, { ...environment, ADMIN_SESSION_SECRET: 'rotated-session-'.repeat(3) }, now + 1).authenticated).toBe(false)
    expect(readAdminSession(undefined, environment, now).authenticated).toBe(false)
    expect(token).not.toContain(environment.ADMIN_ACCESS_TOKEN)
  })

  it('reads only its own cookie and requires exact same-origin mutations', () => {
    const token = createAdminSession(environment)
    const request = new Request('https://example.test/api/admin/status', { headers: { cookie: `other=value; ${ADMIN_COOKIE}=${token}`, origin: 'https://example.test' } })
    expect(requestAdminSession(request, environment).authenticated).toBe(true)
    expect(isAdminMutationOrigin(request)).toBe(true)
    expect(isAdminMutationOrigin(new Request(request.url, { headers: { origin: 'https://attacker.test' } }))).toBe(false)
    expect(isAdminMutationOrigin(new Request(request.url))).toBe(false)
  })

  it('accepts Next dev loopback normalization without trusting arbitrary forwarded hosts', () => {
    const dev = new Request('http://localhost:3327/api/admin/session', { headers: { host: '127.0.0.1:3327', origin: 'http://127.0.0.1:3327' } })
    expect(isAdminMutationOrigin(dev, { NODE_ENV: 'development' })).toBe(true)
    expect(isAdminMutationOrigin(dev, { NODE_ENV: 'production' })).toBe(false)
    const spoofed = new Request('http://localhost:3327/api/admin/session', { headers: { host: 'attacker.test', 'x-forwarded-host': 'attacker.test', origin: 'https://attacker.test' } })
    expect(isAdminMutationOrigin(spoofed, { NODE_ENV: 'development' })).toBe(false)
    expect(isAdminMutationOrigin(spoofed, { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://example.test' })).toBe(false)
    const configured = new Request('http://localhost:3327/api/admin/session', { headers: { origin: 'https://example.test' } })
    expect(isAdminMutationOrigin(configured, { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://example.test' })).toBe(true)
  })

  it('bounds administrator JSON bodies before accepting data', async () => {
    const request = (text: string, contentType = 'application/json') => new Request('https://example.test/api/admin/session', { method: 'POST', headers: { 'content-type': contentType }, body: text })
    await expect(readAdminJson(request('{"password":"example"}'))).resolves.toEqual({ password: 'example' })
    await expect(readAdminJson(request('x'.repeat(4_097)))).rejects.toThrow()
    await expect(readAdminJson(request('{}', 'text/plain'))).rejects.toThrow()
  })
})
