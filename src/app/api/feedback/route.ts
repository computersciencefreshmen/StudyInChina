import { NextResponse } from 'next/server'
import {
  consumeFeedbackRateLimit,
  feedbackRequestSchema,
  getClientIp,
  hashClientIp,
  isAllowedFeedbackOrigin,
  readFeedbackJson,
  sendFeedbackEmail,
  verifyTurnstileToken,
} from '@/lib/feedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

function errorResponse(
  error: 'invalid_request' | 'forbidden' | 'rate_limited' | 'service_unavailable',
  status: 400 | 403 | 429 | 502,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...responseHeaders, ...extraHeaders } },
  )
}

export async function POST(request: Request) {
  if (
    !isAllowedFeedbackOrigin(
      request.headers.get('origin'),
      request.url,
      process.env,
    )
  ) {
    return errorResponse('forbidden', 403)
  }

  let rawBody: unknown
  try {
    rawBody = await readFeedbackJson(request)
  } catch {
    return errorResponse('invalid_request', 400)
  }

  const parsed = feedbackRequestSchema.safeParse(rawBody)
  if (!parsed.success) return errorResponse('invalid_request', 400)
  const feedback = parsed.data

  // A populated hidden field identifies simple form bots. A generic accepted
  // response prevents the endpoint from teaching bots how to bypass the trap.
  if (feedback.website.length > 0) {
    return NextResponse.json(
      { ok: true },
      { status: 202, headers: responseHeaders },
    )
  }

  const clientIp = getClientIp(request.headers)
  let rateLimit
  try {
    const hashedIp = hashClientIp(clientIp, process.env.RATE_LIMIT_SALT ?? '')
    rateLimit = await consumeFeedbackRateLimit(hashedIp)
  } catch {
    return errorResponse('service_unavailable', 502)
  }

  if (!rateLimit.allowed) {
    return errorResponse('rate_limited', 429, {
      'Retry-After': String(rateLimit.retryAfterSeconds),
    })
  }

  let captchaIsValid: boolean
  try {
    captchaIsValid = await verifyTurnstileToken(
      feedback.turnstileToken,
      process.env.TURNSTILE_SECRET_KEY ?? '',
    )
  } catch {
    return errorResponse('service_unavailable', 502)
  }

  if (!captchaIsValid) return errorResponse('forbidden', 403)

  try {
    await sendFeedbackEmail(feedback)
  } catch {
    return errorResponse('service_unavailable', 502)
  }

  return NextResponse.json(
    { ok: true },
    { status: 202, headers: responseHeaders },
  )
}
