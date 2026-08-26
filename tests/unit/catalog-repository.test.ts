import { describe, expect, it, vi } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import {
  CatalogRepositoryError,
  createCatalogRepository,
  createD1CatalogRepository,
  createJsonCatalogRepository,
  createShadowCatalogRepository,
  deriveCatalogRelease,
  type CatalogFetch,
  type CatalogRepository,
} from '@/lib/catalog'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'
import type { DataBundle } from '@/lib/data/types'

const allData = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

function copyBundle(): DataBundle {
  return structuredClone(allData)
}

function apiRelease(bundle: DataBundle) {
  return {
    ...deriveCatalogRelease(bundle, 'd1'),
    id: 'release-2026-07-20',
    generatedAt: '2026-07-20T12:00:00.000Z',
  }
}

function successfulFetch(bundle = copyBundle()): CatalogFetch {
  return vi.fn(async () => new Response(JSON.stringify({
    data: bundle,
    meta: { release: apiRelease(bundle) },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}

describe('CatalogRepository', () => {
  it('loads the existing JSON bundle without changing ids, slugs, or null values', async () => {
    const repository = createJsonCatalogRepository(() => copyBundle())
    const bundle = await repository.getBundle()
    const nullableProgram = bundle.programs.find((program) => program.durationMonths === null)!

    expect(repository.mode).toBe('json')
    expect(nullableProgram.id).toBe(allData.programs.find((program) => program.durationMonths === null)!.id)
    expect(nullableProgram.slug).toBe(allData.programs.find((program) => program.durationMonths === null)!.slug)
    expect(nullableProgram.durationMonths).toBeNull()
  })

  it('derives release metadata and all six record counts for JSON compatibility', async () => {
    const repository = createJsonCatalogRepository(() => copyBundle())

    await expect(repository.getRelease()).resolves.toEqual(deriveCatalogRelease(allData))
  })

  it('filters JSON programs by linked or specifically selected published scholarship scopes', async () => {
    const today = '2026-08-08'
    const repository = createJsonCatalogRepository(() => copyBundle())
    const published = selectPublishedData(copyBundle(), today)
    const linked = await repository.listPrograms({
      scholarship: 'linked',
      today,
      limit: 100,
    })

    expect(linked.total).toBeGreaterThan(0)
    expect(linked.items.every(({ program }) => published.scholarships.some((scholarship) => (
      scholarshipAppliesToProgram(scholarship, program)
    )))).toBe(true)

    const selected = published.scholarships.find((scholarship) => (
      scholarship.programIds.length > 0
    ))!
    const scoped = await repository.listPrograms({
      scholarship: selected.slug,
      today,
      limit: 100,
    })
    expect(scoped.total).toBeGreaterThan(0)
    expect(scoped.items.every(({ program }) => (
      scholarshipAppliesToProgram(selected, program)
    ))).toBe(true)
  })

  it('keeps JSON program scope strict while preserving institution scholarship search', async () => {
    const today = '2026-08-25'
    const bundle = copyBundle()
    const publicPrograms = selectPublishedData(bundle, today).programs
    const byUniversity = new Map<string, typeof publicPrograms>()
    for (const program of publicPrograms) {
      const programsAtUniversity = byUniversity.get(program.universityId) ?? []
      programsAtUniversity.push(program)
      byUniversity.set(program.universityId, programsAtUniversity)
    }
    const siblings = [...byUniversity.values()].find((items) => items.length >= 2)!
    const target = siblings[0]!
    const sibling = siblings[1]!
    const university = bundle.universities.find((item) => item.id === target.universityId)!
    const base = bundle.scholarships[0]!
    const scoped = {
      ...base,
      id: 'scholarship-strict-program-scope',
      slug: 'strict-program-scope',
      universityIds: [university.id],
      programIds: [target.id],
      deadline: null,
      verifiedAt: today,
      reviewAfter: '2026-09-24',
      status: 'verified' as const,
    }
    const universityOnly = {
      ...scoped,
      id: 'scholarship-university-attribution-only',
      slug: 'university-attribution-only',
      programIds: [],
    }
    const unscoped = {
      ...scoped,
      id: 'scholarship-unscoped-legacy',
      slug: 'unscoped-legacy',
      universityIds: [],
      programIds: [],
    }
    bundle.scholarships = [scoped, universityOnly, unscoped]
    const repository = createJsonCatalogRepository(() => bundle)

    const linked = await repository.listPrograms({ scholarship: 'linked', today, limit: 100 })
    expect(linked.items.map(({ program }) => program.id)).toEqual([target.id])
    expect(linked.items.map(({ program }) => program.id)).not.toContain(sibling.id)

    const selected = await repository.listPrograms({
      scholarship: scoped.slug,
      today,
      limit: 100,
    })
    expect(selected.items.map(({ program }) => program.id)).toEqual([target.id])
    await expect(repository.listPrograms({
      scholarship: universityOnly.slug,
      today,
      limit: 100,
    })).resolves.toMatchObject({ total: 0, items: [] })
    await expect(repository.listPrograms({
      scholarship: unscoped.slug,
      today,
      limit: 100,
    })).resolves.toMatchObject({ total: 0, items: [] })

    const institutionalSearch = await repository.listScholarships({
      institution: university.slug,
      today,
      limit: 100,
    })
    expect(institutionalSearch.items.map(({ scholarship }) => scholarship.id).sort()).toEqual([
      scoped.id,
      universityOnly.id,
    ].sort())
  })

  it('does not use stale scholarship relationships for the linked-program filter', async () => {
    const bundle = copyBundle()
    bundle.scholarships = bundle.scholarships.map((item) => ({ ...item, status: 'stale' }))
    const repository = createJsonCatalogRepository(() => bundle)

    const linked = await repository.listPrograms({
      scholarship: 'linked',
      today: '2026-08-25',
      limit: 100,
    })

    expect(linked.total).toBe(0)
  })

  it('projects only official tuition references without changing current tuition filters', async () => {
    const today = '2026-08-25'
    const bundle = copyBundle()
    const target = selectPublishedData(bundle, today).programs[0]!
    const rawTarget = bundle.programs.find((program) => program.id === target.id)!
    const officialSource = bundle.sources.find((source) => (
      source.official && source.kind === 'program' && source.url === rawTarget.programUrl
    ))!
    const university = bundle.universities.find((item) => item.id === rawTarget.universityId)!
    const city = bundle.cities.find((item) => item.id === university.cityId)!
    const unofficialSource = {
      ...officialSource,
      id: 'source-unofficial-tuition-reference',
      url: 'https://example.test/tuition',
      official: false,
    }
    const hiddenProgram = {
      ...rawTarget,
      id: 'program-hidden-tuition-reference',
      slug: 'program-hidden-tuition-reference',
      status: 'draft' as const,
    }
    const baseCycle = bundle.admissionCycles[0]!
    const currentCycle = {
      ...baseCycle,
      id: 'cycle-current-without-tuition',
      programId: rawTarget.id,
      academicYear: '2026-2027',
      opensOn: null,
      closesOn: null,
      dateStatus: 'not-announced' as const,
      tuitionCny: null,
      tuitionPeriod: null,
      tuitionStatus: null,
      applicationFeeCny: null,
      evidenceBasis: 'cycle-specific' as const,
      factScope: 'dates-only' as const,
      sourceIds: [officialSource.id],
      verifiedAt: today,
      reviewAfter: '2026-09-25',
      status: 'verified' as const,
    }
    const officialReference = {
      ...currentCycle,
      id: 'cycle-official-tuition-reference',
      academicYear: '2025-2026',
      opensOn: '2025-01-01',
      closesOn: '2025-10-01',
      dateStatus: 'previous-cycle-reference' as const,
      tuitionCny: 22_000,
      tuitionPeriod: 'academic-year' as const,
      tuitionStatus: 'reference' as const,
      verifiedAt: '2025-08-01',
      reviewAfter: '2025-09-01',
      status: 'stale' as const,
    }
    const unofficialReference = {
      ...officialReference,
      id: 'cycle-unofficial-tuition-reference',
      academicYear: '2023-2024',
      tuitionCny: 99_000,
      sourceIds: [unofficialSource.id],
      verifiedAt: today,
      reviewAfter: '2026-09-25',
      status: 'verified' as const,
    }
    const draftReference = {
      ...unofficialReference,
      id: 'cycle-draft-tuition-reference',
      academicYear: '2024-2025',
      tuitionCny: 88_000,
      sourceIds: [officialSource.id],
      status: 'draft' as const,
    }
    const hiddenReference = {
      ...officialReference,
      id: 'cycle-hidden-program-reference',
      programId: hiddenProgram.id,
    }
    bundle.sources.push(unofficialSource)
    bundle.cities = [city]
    bundle.universities = [university]
    bundle.scholarships = []
    bundle.programs = [{
      ...rawTarget,
      sourceIds: [officialSource.id],
      verifiedAt: today,
      reviewAfter: '2026-09-25',
      status: 'verified',
    }, hiddenProgram]
    bundle.admissionCycles = [
      currentCycle,
      officialReference,
      draftReference,
      hiddenReference,
    ]

    const repository = createJsonCatalogRepository(() => bundle)
    const page = await repository.listPrograms({ today, limit: 100 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      program: { id: rawTarget.id },
      currentCycle: { id: currentCycle.id, tuitionCny: null },
      latestTuitionReference: {
        id: officialReference.id,
        academicYear: '2025-2026',
        tuitionCny: 22_000,
        tuitionStatus: 'reference',
      },
    })
    await expect(repository.listPrograms({ today, tuition: 'known', limit: 100 }))
      .resolves.toMatchObject({ total: 0, items: [] })
    await expect(repository.listPrograms({ today, tuition: 'unknown', limit: 100 }))
      .resolves.toMatchObject({ total: 1 })

    const draftOnly = structuredClone(bundle)
    draftOnly.admissionCycles = draftOnly.admissionCycles.filter(
      (cycle) => cycle.id !== officialReference.id,
    )
    const draftOnlyPage = await createJsonCatalogRepository(() => draftOnly)
      .listPrograms({ today, limit: 100 })
    expect(draftOnlyPage.items[0]?.latestTuitionReference).toBeNull()

    expect(() => bundleSchema.parse({
      ...draftOnly,
      admissionCycles: [...draftOnly.admissionCycles, unofficialReference],
    })).toThrow(/Dynamic fact lacks an official source/)
  })

  it('keeps the D1 tuition reference field optional and demotes previous-cycle current data', async () => {
    const today = '2026-08-25'
    const bundle = copyBundle()
    const program = selectPublishedData(bundle, today).programs[0]!
    const university = bundle.universities.find((item) => item.id === program.universityId)!
    const baseCycle = bundle.admissionCycles[0]!
    const previousCycle = {
      ...baseCycle,
      id: 'remote-previous-tuition-reference',
      programId: program.id,
      academicYear: '2025-2026',
      opensOn: '2025-01-01',
      closesOn: '2025-10-01',
      dateStatus: 'previous-cycle-reference' as const,
      tuitionCny: 24_000,
      tuitionPeriod: 'academic-year' as const,
      tuitionStatus: 'confirmed' as const,
      verifiedAt: '2025-08-01',
      reviewAfter: '2025-09-01',
      status: 'stale' as const,
    }
    const withoutReference = {
      ...program,
      id: `${program.id}-without-reference`,
      slug: `${program.slug}-without-reference`,
    }
    const fetcher: CatalogFetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { program: withoutReference, university, currentCycle: null },
        { program, university, currentCycle: previousCycle },
      ],
      meta: { nextCursor: null, total: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: fetcher,
    })

    const page = await repository.listPrograms({ today, limit: 100 })
    expect(page.items[0]?.latestTuitionReference).toBeNull()
    expect(page.items[1]).toMatchObject({
      currentCycle: null,
      latestTuitionReference: {
        id: previousCycle.id,
        academicYear: '2025-2026',
        tuitionCny: 24_000,
        tuitionStatus: 'reference',
      },
    })
  })

  it('reads the internal D1 Catalog API envelope with an optional bearer token', async () => {
    const fetcher = successfulFetch()
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      apiToken: 'secret-token',
      apiTokenHost: 'catalog.example.test',
      fetch: fetcher,
    })

    const bundle = await repository.getBundle()
    const release = await repository.getRelease()

    expect(bundle.programs).toHaveLength(allData.programs.length)
    expect(release).toEqual(apiRelease(bundle))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://catalog.example.test/internal/v1/catalog-bundle',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer secret-token',
        },
      }),
    )
  })

  it('derives compatible release metadata when a transitional endpoint returns a bare bundle', async () => {
    const bundle = copyBundle()
    const repository = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: vi.fn(async () => new Response(JSON.stringify(bundle), { status: 200 })),
    })

    await expect(repository.getRelease()).resolves.toEqual(deriveCatalogRelease(bundle, 'd1'))
  })

  it('rejects HTTP failures and inconsistent remote release counts', async () => {
    const unavailable = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: vi.fn(async () => new Response('unavailable', { status: 503, statusText: 'Unavailable' })),
    })
    await expect(unavailable.getBundle()).rejects.toMatchObject({
      code: 'CATALOG_API_HTTP_ERROR',
    })

    const bundle = copyBundle()
    const release = apiRelease(bundle)
    release.recordCounts.programs += 1
    const mismatched = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: vi.fn(async () => new Response(JSON.stringify({ data: bundle, meta: { release } }), {
        status: 200,
      })),
    })
    await expect(mismatched.getBundle()).rejects.toMatchObject({
      code: 'RELEASE_COUNT_MISMATCH',
    })
  })

  it('returns the primary bundle in shadow mode and records structured field differences', async () => {
    const primaryBundle = copyBundle()
    const shadowBundle = copyBundle()
    const changedProgram = shadowBundle.programs.find(
      (program) => program.durationMonthsMax === undefined && program.status === 'draft',
    )!
    const originalSlug = changedProgram.slug
    changedProgram.slug = `${changedProgram.slug}-shadow`
    changedProgram.durationMonthsMax = null
    const missingScholarship = shadowBundle.scholarships.pop()!
    shadowBundle.sources.push({
      ...shadowBundle.sources[0],
      id: 'source-shadow-only',
      url: 'https://shadow.example.test/catalog',
    })
    const onReport = vi.fn()

    const repository = createShadowCatalogRepository({
      primary: createJsonCatalogRepository(() => primaryBundle),
      shadow: createJsonCatalogRepository(() => shadowBundle),
      onReport,
      maxDifferences: 10,
      now: () => new Date('2026-07-20T12:30:00.000Z'),
    })

    const returned = await repository.getBundle()
    const report = repository.getLastReport()!

    expect(returned.programs.find((program) => program.id === changedProgram.id)!.slug).toBe(originalSlug)
    expect(report).toMatchObject({
      operation: 'getBundle',
      checkedAt: '2026-07-20T12:30:00.000Z',
      status: 'different',
      matches: false,
      primaryMode: 'json',
      shadowMode: 'json',
      summary: { differenceCount: 4, storedDifferenceCount: 4, truncated: false },
    })
    expect(onReport).toHaveBeenCalledWith(report)
    expect(report.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'programs',
        recordId: changedProgram.id,
        path: '/slug',
        kind: 'value-mismatch',
        primaryValue: originalSlug,
        shadowValue: `${originalSlug}-shadow`,
      }),
      expect.objectContaining({
        scope: 'programs',
        recordId: changedProgram.id,
        path: '/durationMonthsMax',
        primaryPresent: false,
        shadowPresent: true,
        shadowValue: null,
      }),
      expect.objectContaining({
        scope: 'scholarships',
        recordId: missingScholarship.id,
        path: '/',
        kind: 'missing-in-shadow',
      }),
      expect.objectContaining({
        scope: 'sources',
        recordId: 'source-shadow-only',
        path: '/',
        kind: 'extra-in-shadow',
      }),
    ]))
  })

  it('ignores top-level collection order while preserving nested array order semantics', async () => {
    const primaryBundle = copyBundle()
    const reorderedBundle = copyBundle()
    for (const records of Object.values(reorderedBundle)) records.reverse()

    const repository = createShadowCatalogRepository({
      primary: createJsonCatalogRepository(() => primaryBundle),
      shadow: createJsonCatalogRepository(() => reorderedBundle),
    })

    await repository.getBundle()
    expect(repository.getLastReport()).toMatchObject({
      status: 'match',
      matches: true,
      summary: { differenceCount: 0 },
    })
  })

  it('fails open on a shadow backend error and keeps a structured diagnostic', async () => {
    const primary = createJsonCatalogRepository(() => copyBundle())
    const failingShadow: CatalogRepository = {
      mode: 'd1',
      getBundle: async () => { throw new Error('shadow unavailable') },
      getRelease: async () => { throw new Error('shadow unavailable') },
      listInstitutions: async () => { throw new Error('shadow unavailable') },
      listPrograms: async () => { throw new Error('shadow unavailable') },
      listScholarships: async () => { throw new Error('shadow unavailable') },
    }
    const repository = createShadowCatalogRepository({ primary, shadow: failingShadow })

    await expect(repository.getBundle()).resolves.toEqual(await primary.getBundle())
    expect(repository.getLastReport()).toMatchObject({
      status: 'shadow-error',
      matches: false,
      shadowError: { name: 'Error', message: 'shadow unavailable' },
    })
  })

  it('creates json, d1, and shadow modes through one environment-compatible factory', () => {
    const loader = () => copyBundle()
    const fetcher = successfulFetch()

    expect(createCatalogRepository({ mode: 'json', jsonLoader: loader }).mode).toBe('json')
    expect(createCatalogRepository({
      mode: 'd1',
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: fetcher,
    }).mode).toBe('d1')
    expect(createCatalogRepository({
      mode: 'shadow',
      jsonLoader: loader,
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      fetch: fetcher,
    }).mode).toBe('shadow')
    expect(() => createCatalogRepository({ mode: 'd1', apiUrl: ' ' })).toThrow(CatalogRepositoryError)
    expect(() => createCatalogRepository({ mode: 'd1', apiUrl: 'http://catalog.example.test/internal' })).toThrow(CatalogRepositoryError)
    expect(() => createCatalogRepository({ mode: 'd1', apiUrl: 'https://user:secret@catalog.example.test/internal' })).toThrow(CatalogRepositoryError)
  })

  it('binds bearer credentials to an explicit host and bounds remote responses', async () => {
    expect(() => createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      apiToken: 'secret-token',
    })).toThrowError(expect.objectContaining({ code: 'MISSING_TOKEN_HOST' }))

    expect(() => createD1CatalogRepository({
      apiUrl: 'https://attacker.example.test/internal/v1/catalog-bundle',
      apiToken: 'secret-token',
      apiTokenHost: 'catalog.example.test',
    })).toThrowError(expect.objectContaining({ code: 'TOKEN_HOST_MISMATCH' }))

    const oversized = createD1CatalogRepository({
      apiUrl: 'https://catalog.example.test/internal/v1/catalog-bundle',
      maxResponseBytes: 1_024,
      fetch: vi.fn(async () => new Response('x'.repeat(1_025), { status: 200 })),
    })
    await expect(oversized.getBundle()).rejects.toMatchObject({
      code: 'CATALOG_API_RESPONSE_TOO_LARGE',
    })
  })
})
