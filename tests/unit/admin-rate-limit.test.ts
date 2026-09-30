import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const noRedis = { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('administrator login limiting', () => {
  it('explicitly enables production memory limiting and resets after its hour', async () => {
    const { consumeAdminLoginRateLimit } = await import('../../src/lib/admin/rate-limit')
    const environment = { ...noRedis, NODE_ENV: 'production' as const, ADMIN_LOGIN_RATE_LIMIT_MODE: 'memory' }
    const fetcher = vi.fn<typeof fetch>()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await consumeAdminLoginRateLimit('ip-hash', { environment, fetcher })).allowed).toBe(true)
    }
    expect(await consumeAdminLoginRateLimit('ip-hash', { environment, fetcher })).toEqual({
      allowed: false, remaining: 0, retryAfterSeconds: 3600,
    })
    expect((await consumeAdminLoginRateLimit('different-ip-hash', { environment, fetcher })).allowed).toBe(true)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect((await consumeAdminLoginRateLimit('ip-hash', { environment, fetcher })).allowed).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([undefined, 'distributed', 'Memory', 'unknown'])('retains production refusal without Redis for mode %s', async mode => {
    const { consumeAdminLoginRateLimit } = await import('../../src/lib/admin/rate-limit')
    await expect(consumeAdminLoginRateLimit('ip-hash', {
      environment: { ...noRedis, NODE_ENV: 'production', ADMIN_LOGIN_RATE_LIMIT_MODE: mode },
    })).rejects.toThrow('Distributed feedback rate limiting is not configured')
  })

  it('does not silently downgrade a configured distributed service failure', async () => {
    const { consumeAdminLoginRateLimit } = await import('../../src/lib/admin/rate-limit')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    await expect(consumeAdminLoginRateLimit('ip-hash', {
      environment: {
        NODE_ENV: 'production', ADMIN_LOGIN_RATE_LIMIT_MODE: 'distributed',
        UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'synthetic-token',
      }, fetcher,
    })).rejects.toThrow('Rate limit service request failed')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('isolates administrator counters from feedback in both memory and development defaults', async () => {
    const { consumeAdminLoginRateLimit } = await import('../../src/lib/admin/rate-limit')
    const { consumeFeedbackRateLimit } = await import('../../src/lib/feedback/rate-limit')
    const environment = { ...noRedis, NODE_ENV: 'development' as const }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await consumeFeedbackRateLimit('same-ip-hash', { environment })
    }
    expect((await consumeAdminLoginRateLimit('same-ip-hash', { environment })).allowed).toBe(true)
    expect((await consumeAdminLoginRateLimit('same-ip-hash', {
      environment: { ...noRedis, NODE_ENV: 'production', ADMIN_LOGIN_RATE_LIMIT_MODE: 'memory' },
    })).remaining).toBe(4)
    expect((await consumeFeedbackRateLimit('same-ip-hash', { environment })).allowed).toBe(false)
  })

  it('uses a separate administrator key in the distributed pipeline', async () => {
    const { consumeAdminLoginRateLimit } = await import('../../src/lib/admin/rate-limit')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ result: 1 }, { result: 1 }, { result: 3600 }]))
    expect((await consumeAdminLoginRateLimit('ip-hash', {
      environment: {
        NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
        UPSTASH_REDIS_REST_TOKEN: 'synthetic-token',
      }, fetcher,
    })).allowed).toBe(true)
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body[0]).toEqual(['INCR', 'feedback:rate:admin-login:ip-hash'])
  })
})

describe('production login with the real memory limiter', () => {
  const password = 'synthetic-admin-password-'.repeat(2)
  const request = (value: string) => new Request('https://example.test/api/admin/session', {
    method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ password: value }),
  })

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ADMIN_ACCESS_TOKEN', password)
    vi.stubEnv('ADMIN_SESSION_SECRET', 'synthetic-admin-session-'.repeat(2))
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  })

  it('authenticates without Redis while still rejecting a bad password and the sixth attempt', async () => {
    vi.stubEnv('ADMIN_LOGIN_RATE_LIMIT_MODE', 'memory')
    const { POST } = await import('../../src/app/api/admin/session/route')
    const accepted = await POST(request(password))
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(accepted.headers.get('set-cookie')).toMatch(/Secure/)
    expect(accepted.headers.get('set-cookie')).toMatch(/SameSite=strict/i)
    expect(await accepted.text()).not.toContain(password)
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect((await POST(request('wrong'))).status).toBe(401)
    }
    const limited = await POST(request(password))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('3600')
    expect(limited.headers.get('set-cookie')).toBeNull()
  })

  it('refuses production login by default when Redis is unavailable', async () => {
    vi.stubEnv('ADMIN_LOGIN_RATE_LIMIT_MODE', '')
    const { POST } = await import('../../src/app/api/admin/session/route')
    const response = await POST(request(password))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'rate_limit_unavailable' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
