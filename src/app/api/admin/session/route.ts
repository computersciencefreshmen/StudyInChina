import { createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, ADMIN_RESPONSE_HEADERS, ADMIN_SESSION_SECONDS, adminConfigured, createAdminSession, isAdminMutationOrigin, matchesAdminPassword, readAdminJson, requestAdminSession } from '@/lib/admin/auth'
import { consumeAdminLoginRateLimit } from '@/lib/admin/rate-limit'
import { getClientIp } from '@/lib/feedback/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: ADMIN_RESPONSE_HEADERS })

export function GET(request: Request) { return json(requestAdminSession(request)) }

export async function POST(request: Request) {
  if (!isAdminMutationOrigin(request)) return json({ error: 'forbidden' }, 403)
  if (!adminConfigured()) return json({ error: 'admin_not_configured' }, 503)
  try {
    const rateKey = createHmac('sha256', process.env.ADMIN_SESSION_SECRET!).update(`admin-login:${getClientIp(request.headers)}`).digest('hex')
    const rate = await consumeAdminLoginRateLimit(rateKey)
    if (!rate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { ...ADMIN_RESPONSE_HEADERS, 'Retry-After': String(rate.retryAfterSeconds) } })
  } catch { return json({ error: 'rate_limit_unavailable' }, 503) }
  let body: unknown
  try { body = await readAdminJson(request) } catch { return json({ error: 'invalid_request' }, 400) }
  if (!body || typeof body !== 'object' || !matchesAdminPassword((body as { password?: unknown }).password)) return json({ error: 'invalid_credentials' }, 401)
  const response = json({ configured: true, authenticated: true, expiresAt: new Date(Date.now() + ADMIN_SESSION_SECONDS * 1_000).toISOString() })
  response.cookies.set(ADMIN_COOKIE, createAdminSession(), { httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: ADMIN_SESSION_SECONDS })
  return response
}

export function DELETE(request: Request) {
  if (!isAdminMutationOrigin(request)) return json({ error: 'forbidden' }, 403)
  const response = json({ configured: adminConfigured(), authenticated: false, expiresAt: null })
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 0 })
  return response
}
