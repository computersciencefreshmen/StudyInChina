import { constantTimeEqual } from '../../ingestion/src/security'
import type { MaintenanceEnv } from './types'
export { canonicalJson as canonical } from '../../../scripts/maintenance/contracts'

export const HASH = /^[a-f0-9]{64}$/
export const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/
export const nowIso = (now = Date.now()) => new Date(now).toISOString()
export const after = (milliseconds: number, now = Date.now()) => nowIso(now + milliseconds)
export async function digest(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(v => v.toString(16).padStart(2, '0')).join('')
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}
export function authorized(request: Request, env: MaintenanceEnv): boolean {
  const expected = env.MAINTENANCE_ADMIN_TOKEN
  return Boolean(expected && expected.length >= 24 && constantTimeEqual(request.headers.get('authorization') ?? '', `Bearer ${expected}`))
}
export async function requestJson(request: Request, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('json_required')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('body_required')
  const chunks: Uint8Array[] = []; let count = 0
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; count += part.value.length; if (count > maxBytes) { await reader.cancel(); throw new Error('request_too_large') }; chunks.push(part.value) }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(count); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(bytes))
}
export const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
export function gateRequest(env: MaintenanceEnv, path: string, body: unknown): Promise<Response> {
  return env.MODEL_ADMISSION.get(env.MODEL_ADMISSION.idFromName('subscription-account-v1')).fetch(new Request(`https://admission.internal${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN ?? ''}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
}
