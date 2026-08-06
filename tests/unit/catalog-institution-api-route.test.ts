import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogRepositoryError } from '@/lib/catalog'

const repository = vi.hoisted(() => ({
  getBundle: vi.fn(),
  getRelease: vi.fn(),
  listInstitutions: vi.fn(),
  listPrograms: vi.fn(),
  listScholarships: vi.fn(),
}))

vi.mock('@/lib/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/catalog')>('@/lib/catalog')
  return {
    ...actual,
    getCatalogRepository: () => ({ mode: 'd1', ...repository }),
  }
})

import { GET } from '@/app/api/v1/institutions/route'

const release = {
  id: 'release-example',
  dataDate: '2026-08-06',
  generatedAt: '2026-08-06T00:00:00.000Z',
  recordCounts: {
    sources: 1,
    cities: 1,
    universities: 1,
    programs: 7,
    admissionCycles: 1,
    scholarships: 3,
  },
}

const page = {
  items: [{
    institution: {
      id: 'institution-example',
      slug: 'example-university',
      name: { en: 'Example University', zh: 'Example University ZH' },
      cityId: 'city-example',
      region: 'east',
      officialUrl: 'https://example.edu.cn/',
      admissionsUrl: null,
      summary: { en: 'Official summary' },
      featured: true,
      sourceIds: ['source-example'],
      verifiedAt: '2026-08-06',
      reviewAfter: '2026-09-06',
      status: 'verified',
    },
    city: {
      id: 'city-example',
      slug: 'example-city',
      name: { en: 'Example City' },
      region: 'east',
    },
    programCount: 7,
    scholarshipCount: 3,
    disciplines: ['engineering-technology'],
  }],
  nextCursor: 'next-cursor',
  total: 1,
  facets: { cities: [{ value: 'example-city', name: { en: 'Example City' } }] },
  release,
}

describe('institution catalog API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repository.listInstitutions.mockResolvedValue(page)
  })

  it('uses the bounded Repository list path without reading a compatibility bundle', async () => {
    const response = await GET(new Request(
      'https://example.test/api/v1/institutions?q=Example&sort=programs-desc&limit=24',
    ))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('s-maxage=300')
    expect(repository.listInstitutions).toHaveBeenCalledTimes(1)
    expect(repository.listInstitutions).toHaveBeenCalledWith(expect.objectContaining({
      q: 'Example',
      sort: 'programs-desc',
      limit: 24,
    }))
    expect(repository.getBundle).not.toHaveBeenCalled()
    expect(repository.getRelease).not.toHaveBeenCalled()
    expect(body).toMatchObject({
      data: [{
        id: 'institution-example',
        city: { id: 'city-example', province: null },
        programCount: 7,
        scholarshipCount: 3,
        disciplines: ['engineering-technology'],
        fieldMeta: {
          admissionsUrl: { status: 'officially_not_announced' },
          summary: { status: 'known' },
        },
      }],
      meta: {
        release: { id: 'release-example' },
        pageSize: 1,
        nextCursor: 'next-cursor',
        total: 1,
        facets: { cities: [{ value: 'example-city' }] },
      },
    })
  })

  it('rejects invalid search, sort, and Repository cursors as client errors', async () => {
    for (const url of [
      'https://example.test/api/v1/institutions?q=---',
      'https://example.test/api/v1/institutions?sort=random',
    ]) {
      const response = await GET(new Request(url))
      expect(response.status).toBe(400)
    }
    expect(repository.listInstitutions).not.toHaveBeenCalled()

    repository.listInstitutions.mockRejectedValueOnce(
      new CatalogRepositoryError('INVALID_LIST_CURSOR', 'Catalog cursor is invalid.'),
    )
    const cursorResponse = await GET(new Request(
      'https://example.test/api/v1/institutions?cursor=bad-cursor',
    ))
    expect(cursorResponse.status).toBe(400)
    expect(await cursorResponse.json()).toEqual({
      error: { code: 'invalid_request', message: 'Invalid cursor.' },
    })
  })
})
