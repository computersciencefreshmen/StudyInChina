import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }
    return entities[character] ?? character
  })
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export type OriginEnvironment = {
  NEXT_PUBLIC_SITE_URL?: string
  VERCEL_URL?: string
  NODE_ENV?: string
}

export function isAllowedFeedbackOrigin(
  originHeader: string | null,
  requestUrl: string,
  environment: OriginEnvironment = process.env,
): boolean {
  const requestOrigin = normalizeOrigin(originHeader ?? undefined)
  if (!requestOrigin || originHeader === 'null') return false

  const allowedOrigins = new Set<string>()
  const publicOrigin = normalizeOrigin(environment.NEXT_PUBLIC_SITE_URL)
  if (publicOrigin) allowedOrigins.add(publicOrigin)

  const vercelOrigin = normalizeOrigin(
    environment.VERCEL_URL
      ? `https://${environment.VERCEL_URL}`
      : undefined,
  )
  if (vercelOrigin) allowedOrigins.add(vercelOrigin)

  if (environment.NODE_ENV !== 'production') {
    const localOrigin = normalizeOrigin(requestUrl)
    if (localOrigin) allowedOrigins.add(localOrigin)
  }

  return allowedOrigins.has(requestOrigin)
}

function firstForwardedAddress(value: string | null): string | null {
  if (!value) return null
  const address = value.split(',')[0]?.trim()
  return address && isIP(address) !== 0 ? address : null
}

export function getClientIp(headers: Headers): string {
  return (
    firstForwardedAddress(headers.get('x-vercel-forwarded-for')) ??
    firstForwardedAddress(headers.get('x-forwarded-for')) ??
    firstForwardedAddress(headers.get('x-real-ip')) ??
    'unknown'
  )
}

export function hashClientIp(ip: string, salt: string): string {
  if (salt.length < 32) {
    throw new Error('RATE_LIMIT_SALT must contain at least 32 characters')
  }

  return createHmac('sha256', salt).update(ip).digest('hex')
}
