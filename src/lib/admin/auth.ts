import 'server-only'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AdminSession } from './types'

export const ADMIN_COOKIE = 'studyinchina_admin'
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60
type Environment = Record<string, string | undefined>

export function adminConfigured(environment: Environment = process.env): boolean {
  return (environment.ADMIN_ACCESS_TOKEN?.length ?? 0) >= 32 && (environment.ADMIN_SESSION_SECRET?.length ?? 0) >= 32
}

export function matchesAdminPassword(value: unknown, environment: Environment = process.env): boolean {
  if (!adminConfigured(environment) || typeof value !== 'string' || value.length > 512) return false
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(value), digest(environment.ADMIN_ACCESS_TOKEN!))
}

export function createAdminSession(environment: Environment = process.env, now = Date.now()): string {
  if (!adminConfigured(environment)) throw new Error('Administrator authentication is not configured')
  const payload = Buffer.from(JSON.stringify({ expires: now + ADMIN_SESSION_SECONDS * 1_000, nonce: randomBytes(24).toString('base64url') })).toString('base64url')
  const signature = createHmac('sha256', environment.ADMIN_SESSION_SECRET!).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function readAdminSession(token: string | undefined, environment: Environment = process.env, now = Date.now()): AdminSession {
  const configured = adminConfigured(environment)
  const denied: AdminSession = { configured, authenticated: false, expiresAt: null }
  if (!configured || !token || token.length > 512) return denied
  const parts = token.split('.')
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return denied
  const expected = createHmac('sha256', environment.ADMIN_SESSION_SECRET!).update(parts[0]).digest()
  const received = Buffer.from(parts[1], 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return denied
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(payload.expires) || payload.expires <= now || payload.expires > now + ADMIN_SESSION_SECONDS * 1_000) return denied
    return { configured, authenticated: true, expiresAt: new Date(payload.expires).toISOString() }
  } catch { return denied }
}

export function requestAdminSession(request: Request, environment: Environment = process.env): AdminSession {
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1)
  return readAdminSession(token, environment)
}

export function isAdminMutationOrigin(request: Request, environment: Environment = process.env): boolean {
  // Never trust arbitrary forwarded-host values: use the request URL or configured public origins.
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return false
  try {
    const incoming = new URL(origin)
    const target = new URL(request.url)
    if (!['http:', 'https:'].includes(incoming.protocol) || origin !== incoming.origin) return false
    if (incoming.origin === target.origin) return true
    const publicOrigins = [environment.NEXT_PUBLIC_SITE_URL, environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined]
      .filter((value): value is string => Boolean(value)).flatMap(value => { try { return [new URL(value).origin] } catch { return [] } })
    if (publicOrigins.includes(incoming.origin)) return true
    // Next dev normalizes its internal URL to localhost. The actual browser can use 127.0.0.1.
    // Permit only loopback Host values in development, with exact browser host/port/protocol.
    const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    const host = request.headers.get('host')?.toLowerCase()
    return environment.NODE_ENV !== 'production' && loopback(target.hostname) && loopback(incoming.hostname)
      && incoming.protocol === target.protocol && host === incoming.host
  } catch { return false }
}

export const ADMIN_RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }

export async function readAdminJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Invalid request')
  if (Number(request.headers.get('content-length') || 0) > 4_096) throw new Error('Invalid request')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Invalid request')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 4_096) { await reader.cancel(); throw new Error('Invalid request') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
