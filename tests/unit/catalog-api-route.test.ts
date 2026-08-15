import { describe, expect, it } from 'vitest'
import { GET as listPrograms } from '@/app/api/v1/programs/route'
import { GET as getCurrentRelease } from '@/app/api/v1/releases/current/route'
import { createCatalogRepository } from '@/lib/catalog'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { getTodayDate } from '@/lib/data/freshness'

describe('catalog API routes', () => {
  it('serves only publication-gated records with cache policy and release metadata', async () => {
    const response = await listPrograms(new Request('https://example.test/api/v1/programs?limit=1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('s-maxage=300')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].status).toBe('verified')
    expect(body.data[0].fieldMeta.programUrl.officialUrl).toMatch(/^https:\/\//)
    expect(body.meta.release.id).toMatch(/^json:/)
  })

  it('exposes the linked-scholarship program filter through the compatibility API', async () => {
    const response = await listPrograms(new Request('https://example.test/api/v1/programs?scholarship=linked&limit=100'))
    const body = await response.json() as { data: unknown[] }

    expect(response.status).toBe(200)
    expect(body.data.length).toBeGreaterThan(0)
  })

  it('rejects invalid pagination input without exposing an internal error', async () => {
    const response = await listPrograms(new Request('https://example.test/api/v1/programs?limit=1000'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      error: { code: 'invalid_request', message: 'limit exceeds the maximum.' },
    })
  })

  it('bounds query and cursor input before scanning the catalog', async () => {
    const queryResponse = await listPrograms(new Request(`https://example.test/api/v1/programs?q=${'a'.repeat(201)}`))
    expect(queryResponse.status).toBe(400)
    const cursorResponse = await listPrograms(new Request(`https://example.test/api/v1/programs?cursor=${'a'.repeat(1025)}`))
    expect(cursorResponse.status).toBe(400)
  })

  it('reports record counts for the current public release', async () => {
    const repository = createCatalogRepository()
    const publicBundle = selectCatalogApiData(
      await repository.getBundle(),
      getTodayDate(),
    )
    const response = await getCurrentRelease()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.recordCounts.universities).toBeGreaterThan(0)
    expect(body.data.recordCounts.programs).toBe(publicBundle.programs.length)
    expect(body.data.recordCounts).toEqual(body.data.publicCounts)
    expect(body.data.rawCounts.programs).toBeGreaterThanOrEqual(body.data.publicCounts.programs)
    expect(body.data.dataCheckedThrough).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(body.data.evaluatedForDate).toBe(getTodayDate())
    expect(body.data.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(body.data.catalogBackend).toBe('json')
    expect(body.data.recordCounts.programs).toBeGreaterThan(0)
  })

  it('reports the immutable Vercel deployment SHA separately from release identity', async () => {
    const previous = process.env.VERCEL_GIT_COMMIT_SHA
    const sha = 'b'.repeat(40)
    process.env.VERCEL_GIT_COMMIT_SHA = sha
    try {
      const response = await getCurrentRelease()
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.data.deploymentSha).toBe(sha)
      expect(body.meta.release.deploymentSha).toBe(sha)
      expect(body.data.id).not.toBe(sha)
      expect(body.data.dataDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    } finally {
      process.env.VERCEL_GIT_COMMIT_SHA = previous
    }
  })
})
