import { ADMIN_TELEMETRY_MAX_BYTES, adminTelemetrySchema, type AdminTelemetry } from '../../../src/lib/admin/telemetry-contract'
import type { CatalogApiEnv } from './types'

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export const ADMIN_TELEMETRY_OBJECT = 'admin-telemetry/latest.v1.json'
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })
function authorized(request: Request, configured: string | undefined) {
  if (!configured || configured.length < 32) return false
  const supplied = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${configured}`
  let mismatch = supplied.length ^ expected.length
  for (let index = 0; index < Math.max(supplied.length, expected.length); index++) mismatch |= (supplied.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0)
  return mismatch === 0
}
async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length')) > ADMIN_TELEMETRY_MAX_BYTES) throw new Error('invalid_body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > ADMIN_TELEMETRY_MAX_BYTES) { await reader.cancel(); throw new Error('invalid_body') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export async function handleAdminTelemetry(request: Request, env: CatalogApiEnv, now = Date.now()): Promise<Response> {
  if (!authorized(request, env.ADMIN_TELEMETRY_TOKEN)) return reply({ error: 'forbidden' }, 403)
  if (request.method !== 'GET' && request.method !== 'PUT') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, PUT' } })
  try {
    if (request.method === 'GET') {
      const object = await env.RELEASES_BUCKET.get(ADMIN_TELEMETRY_OBJECT)
      if (!object) return reply({ error: 'telemetry_unavailable' }, 404)
      if (!object.text || object.size === undefined || object.size > ADMIN_TELEMETRY_MAX_BYTES) throw new Error('invalid_snapshot')
      const snapshot = adminTelemetrySchema.parse(JSON.parse(await object.text()))
      return reply(snapshot)
    }
    let snapshot
    try {
      snapshot = adminTelemetrySchema.parse(await readBoundedJson(request))
      if (Date.parse(snapshot.observedAt) > now + 30_000) throw new Error('future_observation')
    } catch { return reply({ error: 'invalid_telemetry' }, 400) }
    if (!env.RELEASES_BUCKET.put) throw new Error('write_unavailable')
    // The private object is separate from published releases. Conditional writes prevent
    // a delayed concurrent upload from replacing a newer observation or its Token totals.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await env.RELEASES_BUCKET.get(ADMIN_TELEMETRY_OBJECT)
      let previous: AdminTelemetry | null = null
      if (existing) {
        if (!existing.text || existing.size === undefined || existing.size > ADMIN_TELEMETRY_MAX_BYTES) throw new Error('invalid_snapshot')
        previous = adminTelemetrySchema.parse(JSON.parse(await existing.text()))
        if (Date.parse(previous.observedAt) >= Date.parse(snapshot.observedAt)) return reply({ ok: true, accepted: false, observedAt: previous.observedAt })
        if (!existing.etag) throw new Error('invalid_snapshot')
      }
      const onlyIf = existing ? { etagMatches: existing.etag! } : new Headers({ 'If-None-Match': '*' })
      const saved = await env.RELEASES_BUCKET.put(ADMIN_TELEMETRY_OBJECT, JSON.stringify(snapshot), { onlyIf, httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } })
      if (saved) return reply({ ok: true, accepted: true, observedAt: snapshot.observedAt })
    }
    throw new Error('concurrent_write_unavailable')
  } catch { return reply({ error: 'telemetry_unavailable' }, 503) }
}
