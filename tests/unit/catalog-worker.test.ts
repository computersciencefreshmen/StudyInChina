import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import worker from '../../workers/catalog-api/src/index'
import { chinaCalendarDate } from '../../workers/catalog-api/src/sql-data'
import type {
  CatalogApiEnv,
  D1PreparedStatement,
  R2ObjectBody,
} from '../../workers/catalog-api/src/types'

const release = {
  release_id: 'release-2026-07-20',
  data_date: '2026-07-20',
  generated_at: '2026-07-20T12:00:00.000Z',
  counts_json: JSON.stringify({ sources: 1, cities: 1, universities: 1, programs: 1, admissionCycles: 1, scholarships: 1 }),
  content_sha256: 'a'.repeat(64),
}

function environment(options: {
  compatibility?: boolean
  corruptCompatibilityArtifact?: boolean
} = {}): CatalogApiEnv {
  const envelope = JSON.stringify({
    data: { sources: [], cities: [], universities: [], programs: [], admissionCycles: [], scholarships: [] },
    meta: { release: { id: release.release_id, dataDate: release.data_date, generatedAt: release.generated_at, recordCounts: JSON.parse(release.counts_json) } },
  })
  const activeRelease = {
    ...release,
    content_sha256: 'b'.repeat(64),
    compatibility_artifact_key: options.compatibility === false
      ? null
      : `releases/${release.release_id}/compat-envelope.json`,
    compatibility_content_sha256: options.compatibility === false
      ? null
      : createHash('sha256').update(envelope).digest('hex'),
    compatibility_byte_length: options.compatibility === false
      ? null
      : new TextEncoder().encode(envelope).byteLength,
  }
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async <T,>() => activeRelease as T,
    all: async <T,>() => ({ success: true, results: [] as T[] }),
  }
  return {
    CATALOG_DB: { prepare: () => statement },
    RELEASES_BUCKET: {
      get: async (key): Promise<R2ObjectBody | null> => key.endsWith('/compat-envelope.json')
        ? {
            body: new Response(
              options.corruptCompatibilityArtifact ? `${envelope} ` : envelope,
            ).body,
          }
        : null,
    },
    CATALOG_API_TOKEN: 'test-secret',
  }
}

describe('catalog API worker', () => {
  it('returns current release metadata from D1', async () => {
    const response = await worker.fetch(new Request('https://catalog.test/api/v1/releases/current'), environment())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.id).toBe(release.release_id)
    expect(body.data.recordCounts.programs).toBe(1)
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}:\d{4}-\d{2}-\d{2}"$/u)
  })

  it('uses the China calendar date at the UTC day boundary', () => {
    expect(chinaCalendarDate(new Date('2026-07-20T15:59:59.999Z'))).toBe('2026-07-20')
    expect(chinaCalendarDate(new Date('2026-07-20T16:00:00.000Z'))).toBe('2026-07-21')
  })

  it('fails closed when the internal release artifact is requested without its bearer token', async () => {
    const response = await worker.fetch(new Request('https://catalog.test/internal/v1/catalog-bundle'), environment())
    expect(response.status).toBe(403)
  })

  it('streams the immutable compatibility envelope for an authenticated server', async () => {
    const response = await worker.fetch(new Request('https://catalog.test/internal/v1/catalog-bundle', {
      headers: { authorization: 'Bearer test-secret' },
    }), environment())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-catalog-release')).toBe(release.release_id)
    expect(body.meta.release.id).toBe(release.release_id)

  })
  it('fails closed when a normalized release has no lossless compatibility artifact', async () => {
    const response = await worker.fetch(new Request(
      'https://catalog.test/internal/v1/catalog-bundle',
      { headers: { authorization: 'Bearer test-secret' } },
    ), environment({ compatibility: false }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'release_compatibility_unavailable' },
    })
  })


  it('uses the compatibility checksum instead of the normalized artifact checksum', async () => {
    const response = await worker.fetch(new Request(
      'https://catalog.test/internal/v1/catalog-bundle',
      { headers: { authorization: 'Bearer test-secret' } },
    ), environment({ corruptCompatibilityArtifact: true }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'release_artifact_invalid' },
    })
  })
  it('bounds public API query input before issuing a catalog list query', async () => {
    const response = await worker.fetch(
      new Request(`https://catalog.test/api/v1/programs?q=${'x'.repeat(201)}`),
      environment(),
    )
    expect(response.status).toBe(400)
  })

  it('supports cacheable read-only CORS without opening the internal endpoint', async () => {
    const preflight = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs', { method: 'OPTIONS' }),
      environment(),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET')

    const internalPreflight = await worker.fetch(
      new Request('https://catalog.test/internal/v1/catalog-bundle', { method: 'OPTIONS' }),
      environment(),
    )
    expect(internalPreflight.status).toBe(405)
    expect(internalPreflight.headers.get('access-control-allow-origin')).toBeNull()
  })
})
