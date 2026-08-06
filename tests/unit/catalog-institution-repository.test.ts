import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import {
  CatalogRepositoryError,
  createD1CatalogRepository,
  createJsonCatalogRepository,
  createShadowCatalogRepository,
  deriveCatalogRelease,
  type CatalogFetch,
  type CatalogInstitutionListItem,
  type CatalogInstitutionListSort,
  type CatalogRepository,
} from '@/lib/catalog'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { classifyProgramField } from '@/lib/data/fields'
import { isCurrentVerifiedRecord } from '@/lib/data/freshness'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'

const TODAY = '2026-07-20'
const allData = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

function freshBundle(): DataBundle {
  return structuredClone(allData)
}

function compareItems(
  left: CatalogInstitutionListItem,
  right: CatalogInstitutionListItem,
  sort: CatalogInstitutionListSort,
): number {
  const comparison = sort === 'programs-desc'
      ? right.programCount - left.programCount
      : sort === 'scholarships-desc'
        ? right.scholarshipCount - left.scholarshipCount
        : 0
  return comparison
    || left.institution.slug.localeCompare(right.institution.slug)
    || left.institution.id.localeCompare(right.institution.id)
}

describe('CatalogRepository institution lists', () => {
  it('filters JSON institutions with the shared field taxonomy and exposes exact facets and counts', async () => {
    const bundle = freshBundle()
    const repository = createJsonCatalogRepository(() => bundle)
    const publicBundle = selectCatalogApiData(bundle, TODAY)
    const targetProgram = publicBundle.programs.find(
      (program) => isCurrentVerifiedRecord(program, TODAY)
        && classifyProgramField(program) === 'engineering-technology',
    )!
    const target = publicBundle.universities.find(
      (institution) => institution.id === targetProgram.universityId,
    )!
    const city = bundle.cities.find((item) => item.id === target.cityId)!
    const queryName = (target.name.en ?? target.name.zh)!.split(/\s+/u).slice(0, 2).join(' ')

    const result = await repository.listInstitutions({
      q: queryName,
      city: city.slug,
      region: target.region ?? city.region ?? undefined,
      discipline: 'engineering-technology',
      limit: 100,
      today: TODAY,
    })
    const item = result.items.find(({ institution }) => institution.id === target.id)

    expect(item).toMatchObject({
      institution: { id: target.id, slug: target.slug },
      city: { id: city.id, slug: city.slug },
      programCount: publicBundle.programs.filter((program) => program.universityId === target.id).length,
      scholarshipCount: publicBundle.scholarships.filter(
        (scholarship) => isCurrentVerifiedRecord(scholarship, TODAY)
          && scholarship.universityIds.includes(target.id),
      ).length,
    })
    expect(item?.disciplines).toContain('engineering-technology')
    expect(result.total).toBe(result.items.length)
    expect(result.facets.cities).toEqual([{ value: city.slug, name: city.name }])

    for (const discipline of ['engineering-technology', 'chinese-language'] as const) {
      const page = await repository.listInstitutions({ discipline, limit: 100, today: TODAY })
      expect(page.total).toBeGreaterThan(0)
      expect(page.items.every((entry) => entry.disciplines.includes(discipline))).toBe(true)
    }
  })

  it('sorts JSON institutions deterministically and binds cursors to their query', async () => {
    const repository = createJsonCatalogRepository(() => freshBundle())
    const sorts = ['default', 'name', 'programs-desc', 'scholarships-desc'] as const

    for (const sort of sorts) {
      const page = await repository.listInstitutions({ sort, limit: 100, today: TODAY })
      expect(page.items.length).toBeGreaterThan(1)
      for (let index = 1; index < page.items.length; index += 1) {
        expect(compareItems(page.items[index - 1]!, page.items[index]!, sort)).toBeLessThanOrEqual(0)
      }
    }

    const first = await repository.listInstitutions({ sort: 'default', limit: 1, today: TODAY })
    expect(first.total).toBe(selectCatalogApiData(freshBundle(), TODAY).universities.length)
    expect(first.nextCursor).not.toBeNull()
    const second = await repository.listInstitutions({
      sort: 'default',
      cursor: first.nextCursor!,
      limit: 1,
      today: TODAY,
    })
    expect(second.items[0]?.institution.id).not.toBe(first.items[0]?.institution.id)
    await expect(repository.listInstitutions({
      sort: 'name',
      cursor: first.nextCursor!,
      limit: 1,
      today: TODAY,
    })).rejects.toMatchObject({ code: 'INVALID_LIST_CURSOR' })
  })

  it('maps the Worker institution DTO, field freshness, filters, facets, and cursor metadata', async () => {
    const requests: string[] = []
    const release = deriveCatalogRelease(freshBundle(), 'd1')
    const payload = {
      data: [{
        type: 'institution',
        id: 'institution-example',
        slug: 'example-university',
        attributes: {
          name: { en: 'Example University', zh: 'Example University ZH' },
          summary: { en: 'Official summary' },
          institutionType: 'university',
          officialUrl: 'https://example.edu.cn/',
          admissionsUrl: 'https://example.edu.cn/admissions',
          featured: true,
          disciplineCodes: ['engineering-technology', 'chinese-language'],
        },
        relationships: {
          location: {
            id: 'city-example',
            slug: 'example-city',
            name: { en: 'Example City', zh: 'Example City ZH' },
            countryCode: 'CN',
            regionCode: 'east',
          },
          programs: { count: 7 },
          scholarships: { count: 3 },
        },
        sources: [{
          id: 'source-example',
          url: 'https://example.edu.cn/',
          title: 'Official university website',
          publisher: 'Example University',
          languageCode: 'en',
          authorityLevel: 'primary_official',
          checkedAt: '2026-08-07',
        }],
        fieldMeta: {
          name: {
            status: 'stale',
            officialUrl: 'https://example.edu.cn/',
            sourceTitle: 'Official university website',
            checkedAt: '2026-08-07',
            verifiedAt: '2026-07-01',
            reviewAfter: '2026-08-06',
            sourceIds: ['source-example'],
          },
        },
      }],
      meta: {
        release,
        nextCursor: 'worker-next',
        total: 1,
        facets: {
          cities: [{ value: 'example-city', name: { en: 'Example City', zh: 'Example City ZH' } }],
        },
      },
    }
    const fetcher: CatalogFetch = async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: fetcher,
    })

    const result = await repository.listInstitutions({
      q: 'example',
      city: 'example-city',
      region: 'east',
      discipline: 'engineering-technology',
      sort: 'programs-desc',
      cursor: 'worker-cursor',
      limit: 30,
      today: TODAY,
    })
    const request = new URL(requests[0]!)

    expect(request.pathname).toBe('/api/v1/institutions')
    expect(Object.fromEntries(request.searchParams)).toMatchObject({
      q: 'example',
      city: 'example-city',
      region: 'east',
      discipline: 'engineering-technology',
      sort: 'programs-desc',
      cursor: 'worker-cursor',
      limit: '30',
    })
    expect(result).toMatchObject({
      total: 1,
      nextCursor: 'worker-next',
      facets: { cities: [{ value: 'example-city' }] },
      items: [{
        institution: {
          id: 'institution-example',
          slug: 'example-university',
          cityId: 'city-example',
          region: 'east',
          status: 'stale',
          verifiedAt: '2026-07-01',
          reviewAfter: '2026-08-06',
        },
        city: { id: 'city-example', slug: 'example-city', region: 'east' },
        programCount: 7,
        scholarshipCount: 3,
        disciplines: ['chinese-language', 'engineering-technology'],
      }],
    })
  })

  it('compares Shadow institution pages, combines cursors, and fails open on shadow errors', async () => {
    const primaryBundle = freshBundle()
    const shadowBundle = freshBundle()
    const firstShadow = [...shadowBundle.universities]
      .sort((left, right) => left.slug.localeCompare(right.slug))[0]!
    firstShadow.featured = !firstShadow.featured
    const repository = createShadowCatalogRepository({
      primary: createJsonCatalogRepository(() => primaryBundle),
      shadow: createJsonCatalogRepository(() => shadowBundle),
    })

    const first = await repository.listInstitutions({ limit: 1, today: TODAY })
    expect(first.nextCursor).not.toBeNull()
    expect(repository.getLastReport()).toMatchObject({
      operation: 'listInstitutions',
      status: 'different',
      matches: false,
    })
    await expect(repository.listInstitutions({
      cursor: first.nextCursor!,
      limit: 1,
      today: TODAY,
    })).resolves.toMatchObject({ items: expect.any(Array) })

    const primary = createJsonCatalogRepository(() => primaryBundle)
    const failingShadow: CatalogRepository = {
      mode: 'd1',
      getBundle: async () => { throw new Error('shadow unavailable') },
      getRelease: async () => { throw new Error('shadow unavailable') },
      listInstitutions: async () => { throw new Error('shadow unavailable') },
      listPrograms: async () => { throw new Error('shadow unavailable') },
      listScholarships: async () => { throw new Error('shadow unavailable') },
    }
    const failOpen = createShadowCatalogRepository({ primary, shadow: failingShadow })
    await expect(failOpen.listInstitutions({ limit: 1, today: TODAY })).resolves.toMatchObject({
      items: expect.any(Array),
      nextCursor: expect.any(String),
    })
    expect(failOpen.getLastReport()).toMatchObject({
      operation: 'listInstitutions',
      status: 'shadow-error',
      shadowError: { message: 'shadow unavailable' },
    })
  })

  it('rejects malformed Worker institution relationship counts', async () => {
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: async () => new Response(JSON.stringify({
        data: [{
          type: 'institution',
          id: 'institution-example',
          slug: 'example-university',
          attributes: {
            name: { en: 'Example University' },
            summary: null,
            officialUrl: 'https://example.edu.cn/',
            admissionsUrl: null,
            featured: false,
            disciplineCodes: [],
          },
          relationships: {
            location: {
              id: 'city-example',
              slug: 'example-city',
              name: { en: 'Example City' },
              regionCode: 'east',
            },
            programs: { count: -1 },
            scholarships: { count: 0 },
          },
          sources: [],
          fieldMeta: {},
        }],
        meta: { total: 1, nextCursor: null, facets: { cities: [] } },
      }), { status: 200 }),
    })

    await expect(repository.listInstitutions({ today: TODAY })).rejects.toBeInstanceOf(
      CatalogRepositoryError,
    )
  })
})
