import { describe, expect, it } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import { InvalidCursorError } from '@/lib/catalog-api/cursor'
import {
  CatalogApiService,
  InvalidSearchQueryError,
  releaseFromBundle,
} from '@/lib/catalog-api/service'

const text = (en: string, zh = en, ru = en) => ({ en, zh, ru })

function fixture(): DataBundle {
  return {
    sources: [{
      id: 'source-1',
      url: 'https://example.edu/admissions',
      title: 'Official admissions',
      publisher: 'Example University',
      kind: 'admissions',
      language: 'en',
      official: true,
      accessedAt: '2026-07-20',
    }],
    cities: [{
      id: 'city-1', slug: 'beijing', name: text('Beijing'), province: text('Beijing'), region: 'north',
      coordinates: { lat: 39.9, lng: 116.4 }, overview: text('Capital'), climate: text('Seasonal'),
      foodHighlights: [text('Food')], sights: [text('Sight')], sourceIds: ['source-1'],
      verifiedAt: '2026-07-20', reviewAfter: '2026-10-20', status: 'verified',
    }],
    universities: [{
      id: 'uni-1', slug: 'example-university', name: text('Example University'), cityId: 'city-1', region: 'north',
      officialUrl: 'https://example.edu', admissionsUrl: 'https://example.edu/admissions', summary: text('Example'),
      featured: true, sourceIds: ['source-1'], verifiedAt: '2026-07-20', reviewAfter: '2026-10-20', status: 'verified',
    }],
    programs: [{
      id: 'program-1', slug: 'computer-science', universityId: 'uni-1', name: text('Computer Science'),
      degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 48,
      programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/apply', languageRequirements: [],
      sourceIds: ['source-1'], verifiedAt: '2026-07-20', reviewAfter: '2026-08-20', status: 'verified',
    }],
    admissionCycles: [{
      id: 'cycle-1', programId: 'program-1', academicYear: '2026-2027', intake: 'autumn',
      opensOn: '2026-01-01', closesOn: '2026-08-01', dateStatus: 'published', tuitionCny: 30000,
      tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', evidenceBasis: 'cycle-specific', applicationFeeCny: null,
      sourceIds: ['source-1'], verifiedAt: '2026-07-20', reviewAfter: '2026-08-20', status: 'verified',
    }],
    scholarships: [{
      id: 'scholarship-1', slug: 'example-scholarship', name: text('Example Scholarship'), providerType: 'university',
      universityIds: ['uni-1'], programIds: ['program-1'], coverage: { tuition: 'full', accommodation: 'unknown', insurance: true, stipendCnyPerMonth: null },
      deadline: null, applicationUrl: 'https://example.edu/scholarship', summary: text('Funding'), sourceIds: ['source-1'],
      verifiedAt: '2026-07-20', reviewAfter: '2026-08-20', status: 'verified',
    }],
  }
}

describe('CatalogApiService', () => {
  it('returns filters, source metadata, and explicit unknown fact statuses', () => {
    const bundle = fixture()
    const service = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-07-20'), '2026-07-20')
    const programs = service.listPrograms({ type: 'degree', language: 'english', tuitionMax: 35000 })
    expect(programs.data).toHaveLength(1)
    expect(programs.data[0].fieldMeta.durationMonths.status).toBe('known')
    const cycles = service.getProgramCycles('computer-science')
    expect(cycles?.data[0].fieldMeta.applicationFeeCny.status).toBe('officially_not_announced')
    const scholarships = service.listScholarships({ institution: 'example-university' })
    expect(scholarships.data[0].fieldMeta['coverage.accommodation'].status).toBe('officially_not_announced')
  })

  it('accepts the applicant-facing Chinese field and multilingual Chinese-program search aliases', () => {
    const bundle = fixture()
    bundle.programs.push({
      ...bundle.programs[0],
      id: 'program-mtcsol',
      slug: 'international-chinese-language-education',
      name: text('International Chinese Language Education', '国际中文教育', 'Международное преподавание китайского языка'),
      degreeLevel: 'master',
      discipline: 'chinese-education',
    })
    const service = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-07-20'), '2026-07-20')

    expect(service.listPrograms({ degree: 'master', discipline: 'chinese-language' }).data.map((program) => program.id))
      .toEqual(['program-mtcsol'])
    expect(service.listPrograms({ degree: 'master', q: 'MTCSOL' }).data.map((program) => program.id))
      .toEqual(['program-mtcsol'])
    expect(service.listPrograms({ degree: 'master', q: '国际中文教育' }).data.map((program) => program.id))
      .toEqual(['program-mtcsol'])
    expect(service.listPrograms({ degree: 'master', q: 'Международное преподавание китайского языка' }).data.map((program) => program.id))
      .toEqual(['program-mtcsol'])
  })

  it('returns exact institution metadata, public disciplines, sorts, and query-bound cursors', () => {
    const bundle = fixture()
    bundle.cities.push({
      ...bundle.cities[0],
      id: 'city-2',
      slug: 'shanghai',
      name: text('Shanghai'),
      province: text('Shanghai'),
      region: 'east',
    })
    bundle.universities.push(
      {
        ...bundle.universities[0],
        id: 'uni-2',
        slug: 'alpha-university',
        name: text('Alpha University'),
        cityId: 'city-2',
        region: 'east',
        featured: false,
      },
      {
        ...bundle.universities[0],
        id: 'uni-3',
        slug: 'zeta-university',
        name: text('Zeta University'),
        featured: false,
      },
    )
    bundle.programs.push(
      {
        ...bundle.programs[0],
        id: 'program-2',
        slug: 'business-administration',
        universityId: 'uni-2',
        name: text('Business Administration'),
        discipline: 'business',
      },
      {
        ...bundle.programs[0],
        id: 'program-3',
        slug: 'mechanical-engineering',
        universityId: 'uni-2',
        name: text('Mechanical Engineering'),
      },
      {
        ...bundle.programs[0],
        id: 'program-4',
        slug: 'data-science',
        universityId: 'uni-3',
        name: text('Data Science'),
      },
    )
    bundle.scholarships.push(
      {
        ...bundle.scholarships[0],
        id: 'scholarship-2',
        slug: 'alpha-scholarship-a',
        universityIds: ['uni-2'],
        programIds: ['program-2'],
      },
      {
        ...bundle.scholarships[0],
        id: 'scholarship-3',
        slug: 'alpha-scholarship-b',
        universityIds: ['uni-2'],
        programIds: ['program-3'],
      },
    )
    const service = new CatalogApiService(
      bundle,
      releaseFromBundle(bundle, '2026-07-20'),
      '2026-07-20',
    )

    const defaults = service.listInstitutions()
    expect(defaults.meta.total).toBe(3)
    expect(defaults.meta.facets?.cities?.map((item) => item.value)).toEqual([
      'beijing',
      'shanghai',
    ])
    expect(defaults.data.find((item) => item.id === 'uni-1')?.disciplines)
      .toEqual(['computing-data'])

    expect(service.listInstitutions({ sort: 'name' }).data.map((item) => item.id))
      .toEqual(['uni-2', 'uni-1', 'uni-3'])
    expect(service.listInstitutions({ sort: 'programs-desc' }).data.map((item) => item.id))
      .toEqual(['uni-2', 'uni-1', 'uni-3'])
    expect(service.listInstitutions({ sort: 'scholarships-desc' }).data.map((item) => item.id))
      .toEqual(['uni-2', 'uni-1', 'uni-3'])

    const query = {
      q: 'university',
      city: 'beijing',
      region: 'north',
      discipline: 'computing-data',
      sort: 'name' as const,
      limit: 1,
    }
    const first = service.listInstitutions(query)
    expect(first.data).toHaveLength(1)
    expect(first.meta.total).toBe(2)
    expect(first.meta.facets?.cities?.map((item) => item.value)).toEqual(['beijing'])
    expect(first.meta.nextCursor).toBeTruthy()

    const second = service.listInstitutions({
      ...query,
      cursor: first.meta.nextCursor ?? undefined,
    })
    expect(second.data).toHaveLength(1)
    expect(second.data[0].id).not.toBe(first.data[0].id)

    for (const changed of [
      { ...query, q: 'example' },
      { ...query, city: 'shanghai' },
      { ...query, region: 'east' },
      { ...query, discipline: 'business-economics' },
      { ...query, sort: 'programs-desc' as const },
    ]) {
      expect(() => service.listInstitutions({
        ...changed,
        cursor: first.meta.nextCursor ?? undefined,
      })).toThrow(InvalidCursorError)
    }
  })

  it('searches institution names only with NFKC AND token-prefix semantics', () => {
    const bundle = fixture()
    bundle.universities[0] = {
      ...bundle.universities[0]!,
      summary: text('Stale Summary Canary'),
      reviewAfter: '2026-07-19',
      status: 'stale',
    }
    bundle.cities[0] = {
      ...bundle.cities[0]!,
      name: text('City Search Canary'),
    }
    bundle.programs[0] = {
      ...bundle.programs[0]!,
      name: text('Program Search Canary'),
    }
    const service = new CatalogApiService(
      bundle,
      releaseFromBundle(bundle, '2026-07-20'),
      '2026-07-20',
    )

    expect(service.listInstitutions({ q: 'Ｕｎｉ Ｅｘａ' }).data.map((item) => item.id))
      .toEqual(['uni-1'])
    for (const query of ['stale summary', 'city search', 'program search']) {
      expect(service.listInstitutions({ q: query }).data).toEqual([])
    }
    expect(() => service.listInstitutions({ q: Array.from({ length: 21 }, () => 'term').join(' ') }))
      .toThrow(InvalidSearchQueryError)
    expect(() => service.listInstitutions({ q: '---' })).toThrow(InvalidSearchQueryError)
  })
  it('uses 24 as the institution page default and never returns more than 100 records', () => {
    const bundle = fixture()
    for (let index = 2; index <= 105; index += 1) {
      bundle.universities.push({
        ...bundle.universities[0],
        id: `uni-${index}`,
        slug: `university-${String(index).padStart(3, '0')}`,
        name: text(`University ${index}`),
        featured: false,
      })
    }
    const service = new CatalogApiService(
      bundle,
      releaseFromBundle(bundle, '2026-07-20'),
      '2026-07-20',
    )

    const defaultPage = service.listInstitutions()
    expect(defaultPage.data).toHaveLength(24)
    expect(defaultPage.meta.total).toBe(105)
    expect(defaultPage.meta.nextCursor).toBeTruthy()

    const maximumPage = service.listInstitutions({ limit: 101 })
    expect(maximumPage.data).toHaveLength(100)
    expect(maximumPage.meta.total).toBe(105)
    expect(maximumPage.meta.nextCursor).toBeTruthy()
  })
  it('uses stable opaque cursor pagination and rejects unknown cursors', () => {
    const bundle = fixture()
    bundle.universities.push({ ...bundle.universities[0], id: 'uni-2', slug: 'second-university' })
    const service = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-07-20'), '2026-07-20')
    const first = service.listInstitutions({ limit: 1 })
    expect(first.data).toHaveLength(1)
    expect(first.meta.nextCursor).toBeTruthy()
    const second = service.listInstitutions({ limit: 1, cursor: first.meta.nextCursor ?? undefined })
    expect(second.data).toHaveLength(1)
    expect(second.data[0].id).not.toBe(first.data[0].id)
    expect(() => service.listInstitutions({ cursor: 'not-a-cursor' })).toThrow(InvalidCursorError)
  })

  it('never treats an unregistered fallback URL as official evidence', () => {
    const bundle = fixture()
    bundle.sources = []
    const service = new CatalogApiService(
      bundle,
      releaseFromBundle(bundle, '2026-07-20'),
      '2026-07-20',
    )
    const program = service.getProgram('computer-science')?.data
    expect(program?.programUrl).toBe('https://example.edu/program')
    expect(program?.durationMonths).toBeNull()
    expect(program?.fieldMeta.durationMonths.status).toBe('source_unavailable')
  })

  it('uses only explicit legacy programIds for program filters and comparison counts', () => {
    const bundle = fixture()
    bundle.programs.push({
      ...bundle.programs[0],
      id: 'program-2',
      slug: 'software-engineering',
      name: text('Software Engineering'),
    })
    bundle.scholarships.push(
      {
        ...bundle.scholarships[0],
        id: 'scholarship-university-only',
        slug: 'university-only-scholarship',
        programIds: [],
      },
      {
        ...bundle.scholarships[0],
        id: 'scholarship-unscoped',
        slug: 'unscoped-scholarship',
        universityIds: [],
        programIds: [],
      },
    )
    const service = new CatalogApiService(
      bundle,
      releaseFromBundle(bundle, '2026-07-20'),
      '2026-07-20',
    )

    expect(service.listPrograms({ scholarship: 'linked' }).data.map((item) => item.id))
      .toEqual(['program-1'])
    expect(service.listPrograms({ scholarship: 'example-scholarship' }).data.map((item) => item.id))
      .toEqual(['program-1'])
    expect(service.listPrograms({ scholarship: 'university-only-scholarship' }).data)
      .toEqual([])
    expect(service.listPrograms({ scholarship: 'unscoped-scholarship' }).data)
      .toEqual([])

    const compared = service.comparePrograms(['program-1', 'program-2']).data.items
    expect(Object.fromEntries(compared.map((item) => [
      item.program.id,
      item.linkedScholarshipCount,
    ]))).toEqual({
      'program-1': 1,
      'program-2': 0,
    })

    expect(service.listScholarships({ institution: 'example-university' }).data.map((item) => item.id))
      .toEqual([
        'scholarship-1',
        'scholarship-university-only',
      ])
  })

  it('keeps confirmed identity but masks stale dynamic facts everywhere', () => {
    const bundle = fixture()
    const service = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-07-20'), '2026-11-01')
    const institution = service.getInstitution('example-university')?.data
    const program = service.getProgram('computer-science')?.data
    const cycle = service.getProgramCycles('computer-science')?.data[0]
    const scholarship = service.listScholarships().data[0]
    const scholarshipCycle = service.getScholarshipCycles('example-scholarship')?.data[0]

    expect(institution?.name.en).toBe('Example University')
    expect(institution?.summary).toBeNull()
    expect(institution?.disciplines).toEqual([])
    expect(program?.name.en).toBe('Computer Science')
    expect(program?.durationMonths).toBeNull()
    expect(program?.teachingLanguages).toBeNull()
    expect(program?.applyUrl).toBeNull()
    expect(program?.fieldMeta.durationMonths.status).toBe('stale')
    expect(cycle?.closesOn).toBeNull()
    expect(cycle?.tuitionCny).toBeNull()
    expect(cycle?.applicationState).toBe('not-announced')
    expect(scholarship.coverage.tuition).toBeNull()
    expect(scholarship.universityIds).toBeNull()
    expect(scholarshipCycle?.deadline).toBeNull()
    expect(scholarshipCycle?.academicYear).toBeNull()

    expect(service.listInstitutions({ discipline: 'computing-data' }).data).toHaveLength(0)
    expect(service.listPrograms({ language: 'english' }).data).toHaveLength(0)
    expect(service.listPrograms({ tuitionMax: 35_000 }).data).toHaveLength(0)
    expect(service.listScholarships({ institution: 'example-university' }).data).toHaveLength(0)
  })
})
