import { describe, expect, it } from 'vitest'
import { GET as listPrograms } from '@/app/api/v1/programs/route'
import { GET as getCurrentRelease } from '@/app/api/v1/releases/current/route'

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
    const response = await getCurrentRelease()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.recordCounts.universities).toBeGreaterThan(0)
    expect(body.data.recordCounts.programs).toBeLessThan(120)
  })
})
