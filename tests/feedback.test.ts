import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/feedback/route'
import { feedbackRequestSchema } from '@/lib/feedback/schema'
import {
  escapeHtml,
  hashClientIp,
  isAllowedFeedbackOrigin,
} from '@/lib/feedback/security'
import {
  FEEDBACK_RATE_LIMIT,
  MemoryFeedbackRateLimiter,
  consumeFeedbackRateLimit,
} from '@/lib/feedback/rate-limit'

const validFeedback = {
  category: 'incorrect-data',
  message: 'The deadline has changed.',
  sourceUrl: 'https://university.example/admissions',
  replyEmail: 'reader@example.com',
  pageUrl: 'https://study.example/en/programs/example',
  recordId: 'program:example-1',
  consent: true,
  turnstileToken: 'verified-token',
  website: '',
} as const

describe('feedbackRequestSchema', () => {
  it('accepts the documented request contract', () => {
    expect(feedbackRequestSchema.safeParse(validFeedback).success).toBe(true)
  })

  it('rejects messages longer than 2,000 Unicode characters', () => {
    const result = feedbackRequestSchema.safeParse({
      ...validFeedback,
      message: '🙂'.repeat(2_001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-HTTP URLs and missing consent', () => {
    expect(
      feedbackRequestSchema.safeParse({
        ...validFeedback,
        pageUrl: 'javascript:alert(1)',
        consent: false,
      }).success,
    ).toBe(false)
  })

  it('normalizes blank optional fields', () => {
    const result = feedbackRequestSchema.parse({
      ...validFeedback,
      sourceUrl: ' ',
      replyEmail: '',
      recordId: '',
    })
    expect(result.sourceUrl).toBeUndefined()
    expect(result.replyEmail).toBeUndefined()
    expect(result.recordId).toBeUndefined()
  })
})

describe('feedback security helpers', () => {
  it('allows only configured origins in production', () => {
    const environment = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://study.example',
      VERCEL_URL: 'preview-study.vercel.app',
    }

    expect(
      isAllowedFeedbackOrigin(
        'https://study.example',
        'https://internal.example/api/feedback',
        environment,
      ),
    ).toBe(true)
    expect(
      isAllowedFeedbackOrigin(
        'https://preview-study.vercel.app',
        'https://internal.example/api/feedback',
        environment,
      ),
    ).toBe(true)
    expect(
      isAllowedFeedbackOrigin(
        'https://attacker.example',
        'https://internal.example/api/feedback',
        environment,
      ),
    ).toBe(false)
  })

  it('HMACs IP addresses without exposing the original value', () => {
    const digest = hashClientIp(
      '203.0.113.42',
      'a-test-only-salt-with-more-than-32-characters',
    )
    expect(digest).toHaveLength(64)
    expect(digest).not.toContain('203.0.113.42')
    expect(digest).toBe(
      hashClientIp(
        '203.0.113.42',
        'a-test-only-salt-with-more-than-32-characters',
      ),
    )
  })

  it('escapes feedback before HTML rendering', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;',
    )
  })
})

describe('feedback rate limiting', () => {
  it('allows five attempts, blocks the sixth, and resets after one hour', () => {
    let now = 1_000
    const limiter = new MemoryFeedbackRateLimiter(() => now)

    for (let attempt = 1; attempt <= FEEDBACK_RATE_LIMIT; attempt += 1) {
      expect(limiter.consume('hashed-ip').allowed).toBe(true)
    }
    expect(limiter.consume('hashed-ip').allowed).toBe(false)

    now += 60 * 60 * 1_000
    expect(limiter.consume('hashed-ip').allowed).toBe(true)
  })

  it('uses an atomic Upstash pipeline with a one-hour TTL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify([{ result: 1 }, { result: 1 }, { result: 3_600 }]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    const result = await consumeFeedbackRateLimit('hashed-ip', {
      environment: {
        NODE_ENV: 'production',
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'secret-token',
      },
      fetcher,
    })

    expect(result.allowed).toBe(true)
    const [, request] = fetcher.mock.calls[0] ?? []
    expect(request?.body).toContain('INCR')
    expect(request?.body).toContain('3600')
    expect(request?.body).toContain('EXPIRE')
  })
})

describe('POST /api/feedback', () => {
  const apiFetch = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://study.example')
    vi.stubEnv(
      'RATE_LIMIT_SALT',
      'a-test-only-salt-with-more-than-32-characters',
    )
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret')
    vi.stubEnv('RESEND_API_KEY', 'resend-secret')
    vi.stubEnv('RESEND_FROM', 'StudyInChina <noreply@study.example>')
    vi.stubEnv('CONTACT_RECIPIENT', 'owner@study.example')
    vi.stubGlobal('fetch', apiFetch)
  })

  afterEach(() => {
    apiFetch.mockReset()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function request(
    body: unknown = validFeedback,
    origin = 'https://study.example',
  ) {
    return new Request('https://study.example/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify(body),
    })
  }

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('returns 400 for invalid input and 403 for a foreign origin', async () => {
    expect((await POST(request({ ...validFeedback, message: '' }))).status).toBe(
      400,
    )
    expect((await POST(request(validFeedback, 'https://attacker.example'))).status).toBe(
      403,
    )
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('returns 429 before CAPTCHA verification after the fifth attempt', async () => {
    apiFetch.mockResolvedValueOnce(
      jsonResponse([{ result: 6 }, { result: 0 }, { result: 1_800 }]),
    )

    const response = await POST(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('1800')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for an invalid Turnstile token', async () => {
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse([{ result: 1 }, { result: 1 }, { result: 3_600 }]),
      )
      .mockResolvedValueOnce(jsonResponse({ success: false }))

    expect((await POST(request())).status).toBe(403)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('returns 202 only after Resend accepts the message', async () => {
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse([{ result: 1 }, { result: 1 }, { result: 3_600 }]),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ id: 'email-id' }, 200))

    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(apiFetch).toHaveBeenCalledTimes(3)

    const resendBody = String(apiFetch.mock.calls[2]?.[1]?.body)
    expect(resendBody).toContain('The deadline has changed.')
    expect(resendBody).not.toContain('203.0.113.42')
  })

  it('returns 502 when the email provider rejects delivery', async () => {
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse([{ result: 1 }, { result: 1 }, { result: 3_600 }]),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ message: 'failed' }, 500))

    expect((await POST(request())).status).toBe(502)
  })

  it('silently accepts honeypot submissions without contacting services', async () => {
    const response = await POST(request({ ...validFeedback, website: 'bot' }))
    expect(response.status).toBe(202)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
