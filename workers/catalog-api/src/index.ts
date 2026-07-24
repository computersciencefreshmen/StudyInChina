import type { ActiveReleaseRow, CatalogApiEnv, R2ObjectBody } from './types'
import { CatalogSqlApi } from './sql-api'
import { InvalidCursorError } from './sql-cursor'
import { chinaCalendarDate, InvalidSearchQueryError } from './sql-data'

const RELEASE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/
const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300'
const PRIVATE_CACHE = 'private, max-age=60, stale-while-revalidate=300'
const MAX_RELEASE_ARTIFACT_BYTES = 20 * 1024 * 1024

class InvalidRequestError extends Error {}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': status >= 400 ? 'no-store' : PUBLIC_CACHE,
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let mismatch = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return mismatch === 0
}

function hasInternalAccess(request: Request, env: CatalogApiEnv) {
  if (!env.CATALOG_API_TOKEN) return false
  const authorization = request.headers.get('authorization') ?? ''
  const prefix = 'Bearer '
  return authorization.startsWith(prefix)
    && constantTimeEqual(authorization.slice(prefix.length), env.CATALOG_API_TOKEN)
}

async function getActiveRelease(env: CatalogApiEnv): Promise<ActiveReleaseRow | null> {
  return env.CATALOG_DB.prepare(`
    SELECT
      release.release_id,
      release.data_date,
      release.generated_at,
      json_object(
        'sources', (SELECT COUNT(*) FROM current_source_summaries),
        'cities', (
          SELECT COUNT(*) FROM current_locations WHERE location_type = 'city'
        ),
        'universities', (SELECT COUNT(*) FROM current_institutions),
        'programs', (SELECT COUNT(*) FROM current_programs),
        'admissionCycles', (SELECT COUNT(*) FROM current_program_cycles),
        'scholarships', (SELECT COUNT(*) FROM current_scholarships)
      ) AS counts_json,
      release.content_sha256,
      compatibility.artifact_key AS compatibility_artifact_key,
      compatibility.content_sha256 AS compatibility_content_sha256,
      compatibility.byte_length AS compatibility_byte_length
    FROM current_release AS release
    LEFT JOIN release_compatibility_artifacts AS compatibility
      ON compatibility.release_id = release.release_id
    LIMIT 1
  `).first<ActiveReleaseRow>()
}

async function bytesFor(object: R2ObjectBody): Promise<Uint8Array> {
  if (object.size !== undefined && object.size > MAX_RELEASE_ARTIFACT_BYTES) {
    throw new Error('release artifact is too large')
  }
  if (!object.body && !object.text) throw new Error('release artifact has no body')
  if (!object.body && object.text) {
    const bytes = new TextEncoder().encode(await object.text())
    if (bytes.byteLength > MAX_RELEASE_ARTIFACT_BYTES) throw new Error('release artifact is too large')
    return bytes
  }
  const reader = object.body!.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RELEASE_ARTIFACT_BYTES) {
      await reader.cancel('release artifact is too large').catch(() => undefined)
      throw new Error('release artifact is too large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifiedArtifactBytes(object: R2ObjectBody, expectedSha256: string) {
  const bytes = await bytesFor(object)
  if (await sha256Hex(bytes) !== expectedSha256) {
    throw new Error('release artifact checksum mismatch')
  }
  return bytes
}

function stringParam(
  params: URLSearchParams,
  name: string,
  maximumLength = 200,
): string | undefined {
  const value = params.get(name)?.trim()
  if (value && value.length > maximumLength) {
    throw new InvalidRequestError(`${name} is too long.`)
  }
  return value || undefined
}

function integerParam(params: URLSearchParams, name: string, minimum: number, maximum: number) {
  const raw = stringParam(params, name)
  if (raw === undefined) return undefined
  if (!/^\d+$/u.test(raw)) throw new InvalidRequestError(`${name} must be an integer.`)
  const value = Number(raw)
  if (value < minimum || value > maximum) {
    throw new InvalidRequestError(`${name} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function nonNegativeNumberParam(params: URLSearchParams, name: string) {
  const raw = stringParam(params, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidRequestError(`${name} must be a non-negative number.`)
  }
  return value
}

function safeSlug(value: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new InvalidRequestError('slug is invalid.')
  }
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/u.test(decoded)) {
    throw new InvalidRequestError('slug is invalid.')
  }
  return decoded
}

function publicResponse(request: Request, payload: unknown, etag: string) {
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': PUBLIC_CACHE,
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
      },
    })
  }
  return json(payload, 200, { ETag: etag, 'Access-Control-Allow-Origin': '*' })
}

async function publicCatalogResponse(request: Request, environment: CatalogApiEnv, url: URL) {
  const release = await getActiveRelease(environment)
  if (!release) return json({ error: { code: 'release_unavailable' } }, 503)
  const today = chinaCalendarDate()
  const etag = `"${release.content_sha256}:${today}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': PUBLIC_CACHE,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  const api = new CatalogSqlApi(environment.CATALOG_DB, release, today)
  const parts = url.pathname.split('/').filter(Boolean)
  const resource = parts[2]

  if (resource === 'institutions' && parts.length === 3) {
    return publicResponse(request, await api.listInstitutions({
      q: stringParam(url.searchParams, 'q'),
      city: stringParam(url.searchParams, 'city'),
      region: stringParam(url.searchParams, 'region'),
      discipline: stringParam(url.searchParams, 'discipline'),
      cursor: stringParam(url.searchParams, 'cursor', 1_024),
      limit: integerParam(url.searchParams, 'limit', 1, 100),
    }), etag)
  }
  if (resource === 'institutions' && parts.length === 4) {
    const result = await api.getInstitution(safeSlug(parts[3]!))
    return result
      ? publicResponse(request, result, etag)
      : json({ error: { code: 'not_found' } }, 404)
  }
  if (resource === 'programs' && parts.length === 3) {
    return publicResponse(request, await api.listPrograms({
      q: stringParam(url.searchParams, 'q'),
      institution: stringParam(url.searchParams, 'institution'),
      city: stringParam(url.searchParams, 'city'),
      type: stringParam(url.searchParams, 'type'),
      degree: stringParam(url.searchParams, 'degree'),
      discipline: stringParam(url.searchParams, 'discipline'),
      language: stringParam(url.searchParams, 'language'),
      academicYear: stringParam(url.searchParams, 'academicYear'),
      intake: stringParam(url.searchParams, 'intake'),
      tuitionMin: nonNegativeNumberParam(url.searchParams, 'tuitionMin'),
      tuitionMax: nonNegativeNumberParam(url.searchParams, 'tuitionMax'),
      applicationState: stringParam(url.searchParams, 'applicationState'),
      scholarship: stringParam(url.searchParams, 'scholarship'),
      cursor: stringParam(url.searchParams, 'cursor', 1_024),
      limit: integerParam(url.searchParams, 'limit', 1, 100),
    }), etag)
  }
  if (resource === 'programs' && parts.length === 4) {
    const result = await api.getProgram(safeSlug(parts[3]!))
    return result
      ? publicResponse(request, result, etag)
      : json({ error: { code: 'not_found' } }, 404)
  }
  if (resource === 'programs' && parts.length === 5 && parts[4] === 'cycles') {
    const result = await api.getProgramCycles(safeSlug(parts[3]!))
    return result
      ? publicResponse(request, result, etag)
      : json({ error: { code: 'not_found' } }, 404)
  }
  if (resource === 'scholarships' && parts.length === 3) {
    return publicResponse(request, await api.listScholarships({
      q: stringParam(url.searchParams, 'q'),
      provider: stringParam(url.searchParams, 'provider'),
      institution: stringParam(url.searchParams, 'institution'),
      program: stringParam(url.searchParams, 'program'),
      cursor: stringParam(url.searchParams, 'cursor', 1_024),
      limit: integerParam(url.searchParams, 'limit', 1, 100),
    }), etag)
  }
  if (resource === 'scholarships' && parts.length === 4) {
    const result = await api.getScholarship(safeSlug(parts[3]!))
    return result
      ? publicResponse(request, result, etag)
      : json({ error: { code: 'not_found' } }, 404)
  }
  if (resource === 'scholarships' && parts.length === 5 && parts[4] === 'cycles') {
    const result = await api.getScholarshipCycles(safeSlug(parts[3]!))
    return result
      ? publicResponse(request, result, etag)
      : json({ error: { code: 'not_found' } }, 404)
  }
  return json({ error: { code: 'not_found' } }, 404)
}

async function currentReleaseResponse(request: Request, env: CatalogApiEnv) {
  const release = await getActiveRelease(env)
  if (!release) return json({ error: { code: 'release_unavailable' } }, 503)
  const today = chinaCalendarDate()
  const etag = `"${release.content_sha256}:${today}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': PUBLIC_CACHE,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  return publicResponse(
    request,
    new CatalogSqlApi(env.CATALOG_DB, release, today).currentRelease(),
    etag,
  )
}

async function internalBundleResponse(request: Request, env: CatalogApiEnv) {
  if (!env.CATALOG_API_TOKEN) {
    return json({ error: { code: 'service_not_configured' } }, 503)
  }
  if (!hasInternalAccess(request, env)) return json({ error: { code: 'forbidden' } }, 403)

  const release = await getActiveRelease(env)
  if (!release || !RELEASE_ID_PATTERN.test(release.release_id)) {
    return json({ error: { code: 'release_unavailable' } }, 503)
  }
  if (
    !release.compatibility_artifact_key
    || !release.compatibility_content_sha256
    || release.compatibility_byte_length === null
  ) {
    return json({ error: { code: 'release_compatibility_unavailable' } }, 503)
  }
  const expectedKey = `releases/${release.release_id}/compat-envelope.json`
  if (
    release.compatibility_artifact_key !== expectedKey
    || !/^[a-f0-9]{64}$/u.test(release.compatibility_content_sha256)
    || release.compatibility_byte_length < 2
    || release.compatibility_byte_length > MAX_RELEASE_ARTIFACT_BYTES
  ) {
    return json({ error: { code: 'release_compatibility_invalid' } }, 503)
  }
  const etag = `"${release.compatibility_content_sha256}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': PRIVATE_CACHE },
    })
  }
  const artifact = await env.RELEASES_BUCKET.get(release.compatibility_artifact_key)
  if (!artifact) return json({ error: { code: 'release_artifact_missing' } }, 503)
  let bytes: Uint8Array
  try {
    bytes = await verifiedArtifactBytes(artifact, release.compatibility_content_sha256)
    if (bytes.byteLength !== release.compatibility_byte_length) {
      throw new Error('release compatibility artifact size mismatch')
    }
  } catch {
    return json({ error: { code: 'release_artifact_invalid' } }, 503)
  }
  const headers = {
    'Cache-Control': PRIVATE_CACHE,
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    'X-Catalog-Release': release.release_id,
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers,
  })
}

async function handle(request: Request, env: CatalogApiEnv) {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/v1/')) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: { code: 'method_not_allowed' } }, 405, { Allow: 'GET, HEAD' })
  }
  if (url.pathname === '/health') return json({ ok: true, service: 'catalog-api' })
  if (url.pathname === '/api/v1/releases/current') return currentReleaseResponse(request, env)
  if (url.pathname === '/internal/v1/catalog-bundle') return internalBundleResponse(request, env)
  if (url.pathname.startsWith('/api/v1/')) {
    try {
      return await publicCatalogResponse(request, env, url)
    } catch (error) {
      if (
        error instanceof InvalidRequestError
        || error instanceof InvalidCursorError
        || error instanceof InvalidSearchQueryError
      ) {
        return json({ error: { code: 'invalid_request', message: error.message } }, 400)
      }
      throw error
    }
  }
  return json({ error: { code: 'not_found' } }, 404)
}

const catalogApiWorker = {
  fetch(request: Request, env: CatalogApiEnv) {
    return handle(request, env).catch(() =>
      json({ error: { code: 'internal_error' } }, 500),
    )
  },
}

export default catalogApiWorker
