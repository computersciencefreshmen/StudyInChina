import { describe, expect, it } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import { InvalidCursorError } from '@/lib/catalog-api/cursor'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'

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

    expect(service.listPrograms({ language: 'english' }).data).toHaveLength(0)
    expect(service.listPrograms({ tuitionMax: 35_000 }).data).toHaveLength(0)
    expect(service.listScholarships({ institution: 'example-university' }).data).toHaveLength(0)
  })
})
