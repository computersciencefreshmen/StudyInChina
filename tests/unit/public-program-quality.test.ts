import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataBundle, Program } from '@/lib/data/types'
import type { DiscoveryMeta } from '@/lib/data/discovery'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { hasDetailedPublicProgram, selectDetailedPublicPrograms, PUBLIC_PROGRAM_QUALITY_POLICY } from '@/lib/data/public-program-quality'
import { assertPublicProgramQualityBackend, getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { JsonCatalogRepository } from '@/lib/catalog/json'
import { directoryRevision } from '@/lib/catalog/directory-revision'
import { decodeCursor, encodeCursor } from '@/lib/catalog-api/cursor'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'

vi.mock('@/lib/data/identity-acceptance-store', () => ({ readIdentityAcceptances: () => [] }))
vi.mock('@/lib/data/field-verification-store', () => ({ readFieldVerifications: () => [] }))
const today = '2026-11-16'
function fixture(): DataBundle {
  const audit = { sourceIds: ['official'], status: 'verified' as const, verifiedAt: today, reviewAfter: '2026-12-01' }
  return {
    sources: [{ id: 'official', url: 'https://fixture.edu/program', title: 'International admissions 2027', publisher: 'University',
      kind: 'program', language: 'en', official: true, accessedAt: today }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null,
      overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'university', slug: 'university', name: { en: 'University' }, cityId: 'city', region: null,
      officialUrl: 'https://fixture.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Fine Arts' }, degreeLevel: 'bachelor',
      discipline: 'art-design', teachingLanguages: ['Chinese'], durationMonths: 48, programUrl: 'https://fixture.edu/program',
      applyUrl: 'https://fixture.edu/apply', languageRequirements: [{ test: 'HSK', minimum: '5' }],
      supplementaryDetails: { eligibility: [{ en: 'High-school diploma, ages 18–25.' }] } }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2027-2028', intake: 'autumn',
      opensOn: null, closesOn: '2027-06-25', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null, factScope: 'partial', evidenceBasis: 'cycle-specific' }],
    scholarships: [{ ...audit, id: 'award', slug: 'award', name: { en: 'Programme award' }, providerType: 'university',
      universityIds: ['university'], programIds: ['program'], coverage: { tuition: 'full', accommodation: 'none', insurance: false, stipendCnyPerMonth: 0 },
      deadline: '2027-06-25', applicationUrl: 'https://fixture.edu/award', summary: null }],
  }
}
afterEach(() => vi.restoreAllMocks())

describe('public programme core quality policy', () => {
  it('keeps an officially projected core-complete programme without requiring tuition, portfolio or marketing details', () => {
    const raw = fixture(), before = JSON.stringify(raw), directory = selectDiscoveryData(raw, today)
    expect(selectDetailedPublicPrograms(directory, today).programs.map(p => p.id)).toEqual(['program'])
    expect(getPublicCatalogSnapshot(raw, today).current.programs).toHaveLength(1)
    expect(getPublicCatalogSnapshot(raw, today).directory.programs).toHaveLength(1)
    expect(JSON.stringify(raw)).toBe(before)
  })

  it('publishes a source-backed literal admission year without fabricating a range or weakening core facts', () => {
    const raw = fixture(), cycle = raw.admissionCycles[0]
    cycle.academicYear = '2027'
    expect(getPublicCatalogSnapshot(raw, today).directory.admissionCycles[0].academicYear).toBe('2027')
    for (const year of ['', 'unknown', '2027-2029', '2025', '2030']) {
      cycle.academicYear = year
      expect(hasDetailedPublicProgram(raw.programs[0], [cycle], today)).toBe(false)
    }
    cycle.academicYear = '2027'; cycle.closesOn = null; cycle.dateStatus = 'not-announced'
    expect(hasDetailedPublicProgram(raw.programs[0], [cycle], today)).toBe(false)
  })

  it('keeps literal and range API filters and cursor bindings distinct', () => {
    const raw = fixture(), p = raw.programs[0], c = raw.admissionCycles[0]
    raw.programs.push({ ...structuredClone(p), id: 'range', slug: 'range' })
    raw.admissionCycles.push({ ...structuredClone(c), id: 'range-cycle', programId: 'range' })
    c.academicYear = '2027'
    const directory = getPublicCatalogSnapshot(raw, today).directory
    const service = new CatalogApiService(directory, releaseFromBundle(directory, today), today)
    expect(service.listPrograms({ academicYear: '2027' }).data.map(row => row.id)).toEqual(['program'])
    expect(service.listPrograms({ academicYear: '2027-2028' }).data.map(row => row.id)).toEqual(['range'])
    const cursor = encodeCursor('programs', { academicYear: '2027' }, 'program', 'program')
    expect(() => decodeCursor(cursor, 'programs', { academicYear: '2027' })).not.toThrow()
    expect(() => decodeCursor(cursor, 'programs', { academicYear: '2027-2028' })).toThrow('Invalid cursor')
    const priorPolicy = createHash('sha256').update(JSON.stringify(['studyinchina.public-program-core.v1', 'programs', []])).digest('base64url')
    const priorCursor = Buffer.from(JSON.stringify({ v: 2, resource: 'programs', queryFingerprint: priorPolicy, sortKey: 'program', id: 'program' })).toString('base64url')
    expect(() => decodeCursor(priorCursor, 'programs', {})).toThrow('Invalid cursor')
  })

  it.each(['language', 'eligibility', 'route', 'duration', 'teachingLanguage', 'cycle', 'official'])(
    'holds an identity when its %s core is absent without changing the raw or maintenance directory', missing => {
      const raw = fixture(), p = raw.programs[0]
      if (missing === 'language') p.languageRequirements = []
      if (missing === 'eligibility') delete p.supplementaryDetails
      if (missing === 'route') p.applyUrl = null
      if (missing === 'duration') p.durationMonths = null
      if (missing === 'teachingLanguage') p.teachingLanguages = []
      if (missing === 'cycle') raw.admissionCycles = []
      if (missing === 'official') raw.sources[0].official = false
      const before = JSON.stringify(raw), publicData = getPublicCatalogSnapshot(raw, today).directory
      expect(publicData.programs).toEqual([])
      expect(publicData.admissionCycles).toEqual([])
      expect(publicData.scholarships).toEqual([]) // never widen a programme-only award to all majors
      expect(raw.programs).toHaveLength(1)
      expect(JSON.stringify(raw)).toBe(before)
      if (missing !== 'official') expect(selectDiscoveryData(raw, today).programs).toHaveLength(1)
    })

  it('does not promote a duration-only leaf or treat explicit unknown or an empty requirement as a waiver', () => {
    const raw = fixture(), p = raw.programs[0] as Program & { discovery: DiscoveryMeta }
    p.status = 'stale'; p.discovery = { identityAcceptedAt: today, currentFacts: false, currentFieldPaths: ['durationMonths'] }
    expect(hasDetailedPublicProgram(p, raw.admissionCycles, today)).toBe(false)
    p.discovery = { ...p.discovery, currentFacts: true, fieldStates: { languageRequirements: 'unknown' } }
    expect(hasDetailedPublicProgram(p, raw.admissionCycles, today)).toBe(false)
    p.languageRequirements = []; p.discovery.fieldStates = {}
    expect(hasDetailedPublicProgram(p, raw.admissionCycles, today)).toBe(false)
    p.discovery.fieldStates = { languageRequirements: 'not_applicable' }
    expect(hasDetailedPublicProgram(p, raw.admissionCycles, today)).toBe(true)
  })

  it('requires one exact language/round scope and never combines sibling conditions', () => {
    const raw = fixture(), c = raw.admissionCycles[0]
    c.teachingLanguage = 'Chinese'; c.applicationRound = 'first'
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    c.applyUrl = 'https://fixture.edu/2027/chinese'; c.languageRequirements = [{ test: 'HSK', minimum: '5' }]
    const sibling = { ...c, id: 'second-round', applicationRound: 'second', languageRequirements: undefined, eligibility: [{ en: 'High-school graduate' }] }
    expect(hasDetailedPublicProgram(raw.programs[0], [c, sibling], today)).toBe(false)
    c.eligibility = [{ en: 'High-school graduate' }]
    expect(selectDetailedPublicPrograms({ ...raw, admissionCycles: [c, sibling] }, today).admissionCycles.map(c => c.id)).toEqual(['cycle'])
    c.teachingLanguage = 'English'
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
  })

  it('does not resurrect stale dates from fresh conditions, and requires a known closing date or explicit rolling rule', () => {
    const raw = fixture(), c = raw.admissionCycles[0] as typeof raw.admissionCycles[number] & { discovery: DiscoveryMeta }
    c.teachingLanguage = 'Chinese'; c.applyUrl = 'https://fixture.edu/2027/chinese'
    c.languageRequirements = [{ test: 'HSK', minimum: '5' }]; c.eligibility = [{ en: 'High-school graduate' }]
    c.discovery = { identityAcceptedAt: today, currentFacts: false, currentFieldPaths: ['applyUrl', 'languageRequirements', 'eligibility'] }
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    c.discovery.currentFieldPaths.push('closesOn')
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    c.discovery.currentFieldPaths.push('dateStatus')
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(true)
    c.discovery.fieldStates = { closesOn: 'unknown' }
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    delete c.discovery.fieldStates; c.closesOn = null
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    c.dateStatus = 'not-announced'
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
    c.dateStatus = 'rolling'
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(true)
    c.discovery.fieldStates = { dateStatus: 'unknown' }
    expect(hasDetailedPublicProgram(raw.programs[0], [c], today)).toBe(false)
  })

  it.each(['expired', 'old-year', 'historical', 'future-year', 'generic-name', 'unknown-degree'])(
    'rejects %s records despite unrelated fresh review dates', failure => {
      const raw = fixture(), c = raw.admissionCycles[0], p = raw.programs[0]
      if (failure === 'expired') c.closesOn = '2026-11-15'
      if (failure === 'old-year') c.academicYear = '2024-2025'
      if (failure === 'historical') c.dateStatus = 'previous-cycle-reference'
      if (failure === 'future-year') c.academicYear = '2030-2031'
      if (failure === 'generic-name') p.name = { en: 'Undergraduate Programs' }
      if (failure === 'unknown-degree') p.degreeLevel = 'other'
      expect(hasDetailedPublicProgram(p, [c], today)).toBe(false)
    })

  it('makes public list/search/detail/compare and school/award relations consistently empty while retaining internal identities', async () => {
    const raw = fixture(); delete raw.programs[0].supplementaryDetails
    const snapshot = getPublicCatalogSnapshot(raw, today), service = new CatalogApiService(snapshot.directory, releaseFromBundle(snapshot.directory, today), today)
    expect(service.listPrograms({ q: 'Fine Arts' }).data).toEqual([])
    expect(service.getProgram('program')).toBeNull()
    expect(service.getProgramCycles('program')).toBeNull()
    expect(service.comparePrograms(['program']).data).toMatchObject({ items: [], missingIds: ['program'] })
    expect(service.listInstitutions().data[0].programCount).toBe(0)
    expect(service.listScholarships().data).toEqual([])
    const repository = new JsonCatalogRepository(() => raw)
    expect((await repository.listPrograms({ q: 'Fine Arts', today })).total).toBe(0)
    expect((await repository.listPrograms({ view: 'directory', q: 'Fine Arts', today })).total).toBe(0)
    expect(selectDiscoveryData(raw, today).programs).toHaveLength(1)
  })

  it('binds public revisions and both cursor formats to the policy, and rejects unsupported remote bypasses', async () => {
    const raw = fixture(), oldRevision = createHash('sha256').update('studyinchina.directory-projection.v1\n').update(today).update('\n')
      .update(JSON.stringify(raw)).update('\n').update('[]').update('\n').update('[]').digest('hex')
    expect(directoryRevision(raw, today, [], [])).not.toBe(oldRevision)
    expect(PUBLIC_PROGRAM_QUALITY_POLICY).toBe('studyinchina.public-program-core.v2')
    const oldFingerprint = createHash('sha256').update(JSON.stringify(['programs', []])).digest('base64url')
    const oldApi = Buffer.from(JSON.stringify({ v: 2, resource: 'programs', queryFingerprint: oldFingerprint, sortKey: 'program', id: 'program' })).toString('base64url')
    expect(() => decodeCursor(oldApi, 'programs', {})).toThrow('Invalid cursor')
    const oldList = Buffer.from(JSON.stringify({ v: 1, backend: 'json', resource: 'programs', fingerprint: JSON.stringify(['programs', []]), page: 2 })).toString('base64url')
    await expect(new JsonCatalogRepository(() => raw).listPrograms({ today, cursor: oldList })).rejects.toThrow('cursor is invalid')
    expect(() => assertPublicProgramQualityBackend('json')).not.toThrow()
    for (const mode of ['d1', 'shadow'] as const) expect(() => assertPublicProgramQualityBackend(mode)).toThrow('locally verified quality projection')
  })
})
