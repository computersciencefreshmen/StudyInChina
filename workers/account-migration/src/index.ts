import type { BucketAlias, CopyResult, Descriptor, MigrationBucket, MigrationEnv, MigrationObject, ObjectMetadata } from './types'

export const MAX_OBJECT_BYTES = 16 * 1024 * 1024
export const MAX_BATCH = 4
export const MAX_LIST_OBJECTS = 64
export const ALIASES: BucketAlias[] = ['snapshots', 'releases', 'backups']
const JSON_LIMIT = 64 * 1024
const LIST_RESPONSE_LIMIT = 1024 * 1024
const SHA = /^[a-f0-9]{64}$/u
const HTTP_KEYS = ['contentType', 'contentLanguage', 'contentDisposition', 'contentEncoding', 'cacheControl', 'cacheExpiry']
const encode = new TextEncoder()
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const row = object(value)
  if (!row) throw new Error('invalid_canonical_value')
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? encode.encode(value).buffer as ArrayBuffer : value
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function receiptsPrefix(id: string) { return `__studyinchina_account_migration/${id}/` }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) }
function equal(a: string, b: string) { let difference = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return difference === 0 }
function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,96}$/u.test(id) }
function alias(value: unknown): BucketAlias { if (!ALIASES.includes(value as BucketAlias)) throw new Error('bucket_rejected'); return value as BucketAlias }
function bucket(env: MigrationEnv, name: BucketAlias): MigrationBucket { return name === 'snapshots' ? env.SNAPSHOTS_BUCKET : name === 'releases' ? env.RELEASES_BUCKET : env.BACKUPS_BUCKET }

function metadata(value: MigrationObject): ObjectMetadata {
  const http: Record<string, string> = {}, custom: Record<string, string> = {}
  for (const [key, item] of Object.entries(value.httpMetadata ?? {})) {
    if (!HTTP_KEYS.includes(key)) throw new Error('metadata_unsupported')
    if (item === undefined) continue
    if (key === 'cacheExpiry' && item instanceof Date) http[key] = item.toISOString()
    else if (typeof item === 'string') http[key] = item
    else throw new Error('metadata_unsupported')
  }
  for (const [key, item] of Object.entries(value.customMetadata ?? {})) {
    if (typeof item !== 'string') throw new Error('metadata_unsupported')
    Object.defineProperty(custom, key, { value: item, enumerable: true, configurable: true })
  }
  return { http, custom }
}
async function describe(value: MigrationObject): Promise<Descriptor> {
  const meta = metadata(value)
  return { key: value.key, size: value.size, metadata: meta, metadataSha256: await sha256(canonical(meta)) }
}
export async function validateDescriptor(value: unknown): Promise<Descriptor> {
  const row = object(value), meta = object(row?.metadata), http = object(meta?.http), custom = object(meta?.custom)
  if (!row || Object.keys(row).sort().join(',') !== 'key,metadata,metadataSha256,size'
    || typeof row.key !== 'string' || encode.encode(row.key).byteLength > 1024 || !row.key
    || typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 0
    || !meta || Object.keys(meta).sort().join(',') !== 'custom,http' || !http || !custom
    || Object.keys(http).some(key => !HTTP_KEYS.includes(key))
    || [...Object.values(http), ...Object.values(custom)].some(item => typeof item !== 'string')
    || typeof row.metadataSha256 !== 'string' || !SHA.test(row.metadataSha256)
    || await sha256(canonical(meta)) !== row.metadataSha256) throw new Error('descriptor_invalid')
  if (typeof http.cacheExpiry === 'string' && !Number.isFinite(Date.parse(http.cacheExpiry))) throw new Error('descriptor_invalid')
  return row as Descriptor
}
async function bounded(response: Response | Request, maximum: number): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) throw new Error('body_too_large')
  if (!response.body) return new ArrayBuffer(0)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > maximum) { await reader.cancel(); throw new Error('body_too_large') }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes.buffer
}
function sourceOrigin(env: MigrationEnv): string {
  const url = new URL(env.SOURCE_URL ?? '')
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || url.host !== env.SOURCE_HOST || url.port) throw new Error('source_configuration_invalid')
  return url.origin
}
async function sourceFetch(env: MigrationEnv, name: BucketAlias, key: string, fetcher: typeof fetch): Promise<Response> {
  const url = new URL('/v1/object', sourceOrigin(env)); url.searchParams.set('bucket', name); url.searchParams.set('key', key)
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(60000), headers: {
    authorization: `Bearer ${env.MIGRATION_TRANSFER_TOKEN}`, 'x-migration-id': env.MIGRATION_ID,
  } })
  if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== url.href) {
    await response.body?.cancel(); throw new Error('source_redirect_rejected')
  }
  if (!response.ok || response.headers.get('x-migration-id') !== env.MIGRATION_ID || response.headers.get('x-migration-role') !== 'source') {
    await response.body?.cancel(); throw new Error('source_response_rejected')
  }
  return response
}
async function copyOne(env: MigrationEnv, name: BucketAlias, item: Descriptor, fetcher: typeof fetch): Promise<CopyResult> {
  const held = (code: string, sha: string | null = null): CopyResult => ({ ...item, state: 'held', code, sha256: sha })
  if (item.size > MAX_OBJECT_BYTES) return held('object_requires_large_transfer')
  if (item.key.startsWith(receiptsPrefix(env.MIGRATION_ID))) return held('reserved_receipt_key')
  try {
    const response = await sourceFetch(env, name, item.key, fetcher)
    const expectedSha = response.headers.get('x-object-sha256')
    if (response.headers.get('x-object-metadata-sha256') !== item.metadataSha256
      || response.headers.get('x-object-size') !== String(item.size) || !expectedSha || !SHA.test(expectedSha)) {
      await response.body?.cancel(); return held('source_changed_since_listing')
    }
    const bytes = await bounded(response, MAX_OBJECT_BYTES), hash = await sha256(bytes)
    if (bytes.byteLength !== item.size || hash !== expectedSha) return held('source_bytes_mismatch')
    const destination = bucket(env, name)
    let existing = await destination.get(item.key), state: CopyResult['state'] = 'reused'
    if (!existing) {
      const http: Record<string, string | Date> = { ...item.metadata.http }
      if (http.cacheExpiry) http.cacheExpiry = new Date(String(http.cacheExpiry))
      const saved = await destination.put(item.key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: http, customMetadata: item.metadata.custom })
      if (saved !== null) state = 'copied'
      existing = await destination.get(item.key)
    }
    if (!existing || existing.size !== item.size || (await describe(existing)).metadataSha256 !== item.metadataSha256
      || await sha256(await existing.arrayBuffer()) !== hash) return held('target_conflict_or_readback_mismatch', hash)
    const receiptKey = `${receiptsPrefix(env.MIGRATION_ID)}${name}/${await sha256(item.key)}/${hash}-${item.metadataSha256}.json`
    const receipt = { format: 'studyinchina.account-r2-copy', version: 1, migrationId: env.MIGRATION_ID,
      sourceOrigin: sourceOrigin(env), bucket: name, key: item.key, size: item.size, sha256: hash, metadataSha256: item.metadataSha256 }
    const text = canonical(receipt)
    await env.SNAPSHOTS_BUCKET.put(receiptKey, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
    const stored = await env.SNAPSHOTS_BUCKET.get(receiptKey)
    if (!stored || stored.size > JSON_LIMIT || await sha256(await stored.arrayBuffer()) !== await sha256(text)) return held('copy_receipt_unconfirmed', hash)
    return { ...item, state, code: 'verified', sha256: hash, receiptKey, receiptSha256: await sha256(text) }
  } catch (error) {
    const code = error instanceof Error && ['source_redirect_rejected', 'source_response_rejected', 'source_configuration_invalid', 'body_too_large'].includes(error.message)
      ? error.message : 'transfer_unavailable'
    return { ...item, state: 'error', code, sha256: null }
  }
}

export async function handleFetch(request: Request, env: MigrationEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!validId(env.MIGRATION_ID) || !['source', 'target'].includes(env.MIGRATION_ROLE)
    || !env.MIGRATION_TRANSFER_TOKEN || !SHA.test(env.MIGRATION_TRANSFER_TOKEN)) return json({ error: 'migration_not_configured' }, 503)
  if (!equal(request.headers.get('authorization') ?? '', `Bearer ${env.MIGRATION_TRANSFER_TOKEN}`)
    || request.headers.get('x-migration-id') !== env.MIGRATION_ID) return json({ error: 'forbidden' }, 403)
  const url = new URL(request.url)
  if (url.pathname === '/health' && request.method === 'GET') return json({ migrationId: env.MIGRATION_ID, role: env.MIGRATION_ROLE, maximumObjects: MAX_BATCH, maximumBytes: MAX_OBJECT_BYTES, sourceFrozen: env.SOURCE_FROZEN === 'true' })
  try {
    if (env.MIGRATION_ROLE === 'source') {
      const inventory = request.method === 'GET' && url.pathname === '/v1/inventory'
      if (env.SOURCE_FROZEN !== 'true' && !inventory) return json({ error: 'source_not_frozen' }, 409)
      if (request.method !== 'GET' || !['/v1/list', '/v1/inventory', '/v1/object'].includes(url.pathname)) return json({ error: 'not_found' }, 404)
      const name = alias(url.searchParams.get('bucket'))
      if (url.pathname === '/v1/list' || inventory) {
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 4096) throw new Error('cursor_invalid')
        const rawLimit = url.searchParams.get('limit')
        if (url.searchParams.getAll('limit').length > 1 || rawLimit !== null && (!/^[1-9][0-9]?$/u.test(rawLimit) || Number(rawLimit) > MAX_LIST_OBJECTS)) throw new Error('listing_limit_invalid')
        const limit = rawLimit === null ? MAX_BATCH : Number(rawLimit)
        const page = await bucket(env, name).list({ limit, ...(cursor ? { cursor } : {}), include: ['httpMetadata', 'customMetadata'] })
        if (page.objects.length > limit || page.truncated && !page.cursor) throw new Error('listing_invalid')
        const excludedReceiptKeys = page.objects.filter(item => item.key.startsWith(receiptsPrefix(env.MIGRATION_ID))).map(item => item.key)
        const objects = await Promise.all(page.objects.filter(item => !excludedReceiptKeys.includes(item.key)).map(describe))
        const result = { migrationId: env.MIGRATION_ID, role: 'source', bucket: name, objects, excludedReceiptKeys,
          sourceFrozen: env.SOURCE_FROZEN === 'true', cutoverReady: !inventory && env.SOURCE_FROZEN === 'true',
          truncated: page.truncated, cursor: page.truncated ? page.cursor : null }
        const text = JSON.stringify(result)
        if (encode.encode(text).byteLength > LIST_RESPONSE_LIMIT) return json({ error: 'listing_metadata_too_large' }, 413)
        return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
      }
      if (url.pathname === '/v1/object' && request.method === 'GET') {
        const key = url.searchParams.get('key')
        if (!key || key.startsWith(receiptsPrefix(env.MIGRATION_ID))) throw new Error('key_rejected')
        const value = await bucket(env, name).get(key)
        if (!value) return json({ error: 'source_object_missing' }, 404)
        if (value.size > MAX_OBJECT_BYTES) return json({ error: 'object_requires_large_transfer' }, 413)
        const item = await describe(value), bytes = await value.arrayBuffer()
        if (bytes.byteLength !== item.size) throw new Error('source_bytes_mismatch')
        // Transport is always raw binary: original gzip/content encoding lives in
        // the descriptor, never in headers that fetch could transparently decode.
        return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength),
          'cache-control': 'no-store', 'x-migration-id': env.MIGRATION_ID, 'x-migration-role': 'source',
          'x-object-sha256': await sha256(bytes), 'x-object-size': String(item.size), 'x-object-metadata-sha256': item.metadataSha256 } })
      }
    } else if (url.pathname === '/v1/copy' && request.method === 'POST') {
      sourceOrigin(env)
      const raw = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(request, JSON_LIMIT))))
      if (!raw || Object.keys(raw).sort().join(',') !== 'bucket,objects' || !Array.isArray(raw.objects) || !raw.objects.length || raw.objects.length > MAX_BATCH) throw new Error('copy_request_invalid')
      const name = alias(raw.bucket), objects: Descriptor[] = []
      for (const item of raw.objects) objects.push(await validateDescriptor(item))
      if (new Set(objects.map(item => item.key)).size !== objects.length) throw new Error('duplicate_keys')
      const results: CopyResult[] = []
      for (const item of objects) results.push(await copyOne(env, name, item, fetcher))
      return json({ migrationId: env.MIGRATION_ID, role: 'target', bucket: name, results })
    }
    return json({ error: 'not_found' }, 404)
  } catch { return json({ error: 'migration_request_rejected' }, 400) }
}
const worker = { fetch(request: Request, env: MigrationEnv) { return handleFetch(request, env) } }
export default worker
