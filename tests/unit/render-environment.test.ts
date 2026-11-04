import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSiteUrl } from '@/lib/site'
import { deploymentShaFromEnvironment } from '@/lib/catalog-api/runtime'
import { getClientIp, isAllowedFeedbackOrigin } from '@/lib/feedback/security'
import { isAdminMutationOrigin } from '@/lib/admin/auth'

const renderOrigin = 'https://studyinchina-test.onrender.com'
afterEach(() => vi.unstubAllEnvs())

describe('hosting environment origin resolution', () => {
  it('uses Render external URL for canonical metadata without requiring a Vercel environment', () => {
    expect(resolveSiteUrl({ RENDER_EXTERNAL_URL: renderOrigin }).origin).toBe(renderOrigin)
    expect(resolveSiteUrl({ RENDER_EXTERNAL_URL: renderOrigin, NEXT_PUBLIC_SITE_URL: ' https://atlas.example ' }).origin)
      .toBe('https://atlas.example')
  })

  it('preserves explicit, Vercel production/preview and local fallback behavior', () => {
    expect(resolveSiteUrl({}).origin).toBe('http://localhost:3000')
    expect(resolveSiteUrl({ VERCEL_ENV: 'production', RENDER_EXTERNAL_URL: renderOrigin }).origin)
      .toBe('https://studyinchina.vercel.app')
    expect(resolveSiteUrl({ VERCEL_URL: 'studyinchina-preview.vercel.app', RENDER_EXTERNAL_URL: renderOrigin }).origin)
      .toBe('https://studyinchina-preview.vercel.app')
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3327' }).origin).toBe('http://localhost:3327')
  })

  it.each([
    { RENDER: 'true' },
    { RENDER_EXTERNAL_URL: 'http://studyinchina-test.onrender.com' },
    { RENDER_EXTERNAL_URL: renderOrigin, NEXT_PUBLIC_SITE_URL: 'http://atlas.example' },
    { VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'http://atlas.example' },
  ])('requires HTTPS for hosted production: %j', environment => {
    expect(() => resolveSiteUrl(environment)).toThrow('must use HTTPS in production')
  })
})

describe('hosting deployment SHA provenance', () => {
  it('uses Render immutable commit SHA when Vercel has not provided one', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    vi.stubEnv('RENDER_GIT_COMMIT', 'a'.repeat(40))
    expect(deploymentShaFromEnvironment()).toBe('a'.repeat(40))
    expect(deploymentShaFromEnvironment('b'.repeat(40))).toBe('b'.repeat(40))
  })

  it('preserves Vercel precedence and refuses malformed selected metadata', () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'a'.repeat(40))
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40))
    expect(deploymentShaFromEnvironment()).toBe('b'.repeat(40))
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'main')
    expect(deploymentShaFromEnvironment()).toBeNull()
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined)
    vi.stubEnv('RENDER_GIT_COMMIT', 'A'.repeat(40))
    expect(deploymentShaFromEnvironment()).toBeNull()
    vi.stubEnv('RENDER_GIT_COMMIT', undefined)
    expect(deploymentShaFromEnvironment()).toBeNull()
  })
})

describe('Render proxy public origin trust boundary', () => {
  const environment = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: renderOrigin, NEXT_PUBLIC_SITE_URL: 'https://atlas.example' }
  const internalUrl = 'http://localhost:10000/api/admin/session'
  const mutation = (origin: string) => new Request(internalUrl, {
    headers: { origin, host: 'attacker.example', 'x-forwarded-host': 'attacker.example' },
  })

  it.each([renderOrigin, 'https://atlas.example'])('accepts only configured public origin %s behind an internal URL', origin => {
    expect(isAdminMutationOrigin(mutation(origin), environment)).toBe(true)
    expect(isAllowedFeedbackOrigin(origin, internalUrl, environment)).toBe(true)
  })

  it.each(['https://attacker.example', 'https://studyinchina-test.onrender.com.attacker.example', 'http://studyinchina-test.onrender.com', 'null'])
    ('rejects arbitrary or downgraded origin %s despite forwarded host values', origin => {
      expect(isAdminMutationOrigin(mutation(origin), environment)).toBe(false)
      expect(isAllowedFeedbackOrigin(origin, internalUrl, environment)).toBe(false)
    })

  it('does not trust an invalid or HTTP Render external URL', () => {
    for (const RENDER_EXTERNAL_URL of ['invalid', 'http://studyinchina-test.onrender.com']) {
      const untrusted = { NODE_ENV: 'production', RENDER_EXTERNAL_URL }
      expect(isAdminMutationOrigin(mutation('http://studyinchina-test.onrender.com'), untrusted)).toBe(false)
      expect(isAllowedFeedbackOrigin('http://studyinchina-test.onrender.com', internalUrl, untrusted)).toBe(false)
    }
  })
})

describe('Render client IP trust boundary', () => {
  it('ignores alternate Vercel and real-IP headers when Render provides its client IP', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.42, 10.0.0.1',
      'x-vercel-forwarded-for': '198.51.100.1',
      'x-real-ip': '198.51.100.2',
    })
    expect(getClientIp(headers, { RENDER: 'true' })).toBe('203.0.113.42')
    headers.set('x-vercel-forwarded-for', '198.51.100.3')
    headers.set('x-real-ip', '198.51.100.4')
    expect(getClientIp(headers, { RENDER: 'true' })).toBe('203.0.113.42')
  })

  it.each([undefined, '', 'not-an-ip', 'not-an-ip, 203.0.113.42'])
    ('uses the same unknown bucket for absent/invalid Render forwarding: %s', forwarded => {
      const headers = new Headers({ 'x-vercel-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' })
      if (forwarded !== undefined) headers.set('x-forwarded-for', forwarded)
      expect(getClientIp(headers, { RENDER: 'true' })).toBe('unknown')
    })

  it('keeps existing Vercel and legacy precedence outside Render', () => {
    const headers = new Headers({ 'x-vercel-forwarded-for': '198.51.100.1', 'x-forwarded-for': '203.0.113.42', 'x-real-ip': '198.51.100.2' })
    expect(getClientIp(headers, {})).toBe('198.51.100.1')
    headers.delete('x-vercel-forwarded-for')
    expect(getClientIp(headers, {})).toBe('203.0.113.42')
    headers.delete('x-forwarded-for')
    expect(getClientIp(headers, {})).toBe('198.51.100.2')
  })
})
