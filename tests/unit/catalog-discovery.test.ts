import { describe, expect, it } from 'vitest'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { identityFingerprint, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { selectPublishedData } from '@/lib/data/publication'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { isIndexableProgram, isIndexableScholarship } from '@/lib/seo/indexability'
import { parseProgramCatalogFilters, queryProgramCatalog } from '@/lib/program-catalog'
import { parseScholarshipCatalogFilters, queryScholarshipCatalog } from '@/lib/scholarship-catalog'
import type { DataBundle } from '@/lib/data/types'
import { fieldRecordScopeSha256, fieldValueSha256, type FieldVerification } from '@/lib/data/field-verification'
import { parseCatalogReleaseInfo } from '@/lib/catalog/release'
import { getApplicationState } from '@/lib/data/admission'

const today = '2026-10-24'
function fixture(): DataBundle {
  const audit = { sourceIds: ['official'], verifiedAt: '2026-10-19', reviewAfter: '2026-10-22', status: 'verified' as const }
  return {
    sources: [{ id: 'official', url: 'https://example.edu/official', title: 'Official catalogue', publisher: 'Example University', kind: 'program', language: 'en', official: true, accessedAt: '2026-10-19' }],
    cities: [{ ...audit, reviewAfter: '2027-01-01', id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, reviewAfter: '2027-01-01', id: 'university', slug: 'university', cityId: 'city', name: { en: 'Example University' }, region: null, officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Computer Science' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24,
      programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/old-apply', languageRequirements: [{ test: 'IELTS', minimum: 'STALE_SENTINEL' }],
      supplementaryDetails: { overview: { en: 'STALE_SENTINEL fees 99999' } } }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2027', intake: 'autumn', opensOn: '2026-10-01', closesOn: '2026-12-31', dateStatus: 'published', tuitionCny: 99999, applicationFeeCny: 88888, notes: { en: 'STALE_SENTINEL deadline' } }],
    scholarships: [{ ...audit, id: 'scholarship', slug: 'scholarship', name: { en: 'Example Scholarship' }, providerType: 'university', universityIds: ['university'], programIds: ['program'], coverage: { tuition: 'full', accommodation: 'full', insurance: true, stipendCnyPerMonth: 77777 }, deadline: '2026-10-31', applicationUrl: 'https://example.edu/old-award-apply', summary: { en: 'STALE_SENTINEL full award' }, eligibility: [{ en: 'STALE_SENTINEL qualification' }] }],
  }
}
function evidence(bundle: DataBundle): IdentityAcceptance[] {
  return ([['program', bundle.programs[0]], ['scholarship', bundle.scholarships[0]]] as const).map(([entityType, record]) => ({
    entityType, recordId: record.id, identitySha256: identityFingerprint(entityType, record), sourceIds: ['official'],
    acceptedAt: '2026-10-19T01:00:00.000Z', reviewer: 'independent-reviewer', receiptPath: 'quality/reviewed.json', receiptSha256: 'a'.repeat(64),
  }))
}
function fieldEvidence(bundle: DataBundle, entityType: FieldVerification['entityType'], fieldPath: string, value: unknown): FieldVerification {
  const record = entityType === 'program' ? bundle.programs[0] : entityType === 'scholarship' ? bundle.scholarships[0] : bundle.admissionCycles[0]
  return { entityType, recordId: record.id, recordScopeSha256: fieldRecordScopeSha256(entityType, record), fieldPath,
    value, valueSha256: fieldValueSha256(value), factStatus: 'known', sourceId: 'official', sourceUrl: bundle.sources[0].url,
    snapshotSha256: 'b'.repeat(64), objectKey: 'private/snapshots/should-not-be-public', locator: 'deadline paragraph', quote: 'officially checked value',
    verifiedAt: '2026-10-24T01:00:00.000Z', reviewAfter: '2026-10-27', review: { method: 'dual-model', reviewerId: 'independent-reviewer' },
    receiptPath: 'private-receipt-should-not-be-public', receiptSha256: 'c'.repeat(64) }
}

describe('public directory and current opportunities', () => {
  it('keeps reviewed identities through a review expiry without renewing raw facts', () => {
    const bundle = fixture(), before = JSON.stringify(bundle)
    const directory = selectDiscoveryData(bundle, today, evidence(bundle))
    expect(directory.programs.map(record => record.id)).toEqual(['program'])
    expect(directory.scholarships.map(record => record.id)).toEqual(['scholarship'])
    expect(directory.programs[0].slug).toBe('program')
    expect(directory.programs[0].discovery.currentFacts).toBe(false)
    expect(directory.admissionCycles).toEqual([])
    expect(selectPublishedData(bundle, today).programs).toEqual([])
    expect(selectPublishedData(bundle, today).scholarships).toEqual([])
    expect(JSON.stringify(bundle)).toBe(before)
  })

  it('fails closed for an old raw status without an accepted identity receipt', () => {
    const bundle = fixture()
    bundle.programs[0].status = 'stale'
    bundle.scholarships[0].status = 'stale'
    expect(selectDiscoveryData(bundle, today).programs).toEqual([])
    expect(selectDiscoveryData(bundle, today).scholarships).toEqual([])
  })

  it.each(['draft', 'archived'] as const)('never publishes %s identities through a ledger', status => {
    const bundle = fixture(), ledger = evidence(bundle)
    bundle.programs[0].status = status
    bundle.scholarships[0].status = status
    expect(selectDiscoveryData(bundle, today, ledger).programs).toEqual([])
    expect(selectDiscoveryData(bundle, today, ledger).scholarships).toEqual([])
  })

  it('rejects changed identity, non-official evidence, and future acceptance', () => {
    const bundle = fixture(), ledger = evidence(bundle)
    bundle.programs[0].name = { en: 'An unreviewed new programme' }
    expect(selectDiscoveryData(bundle, today, ledger).programs).toEqual([])
    bundle.sources[0].official = false
    expect(selectDiscoveryData(bundle, today, ledger).scholarships).toEqual([])
    const future = fixture(), futureLedger = evidence(future).map(entry => ({ ...entry, acceptedAt: '2026-10-25T00:00:00.000Z' }))
    expect(selectDiscoveryData(future, today, futureLedger).programs).toEqual([])
  })

  it('redacts all old prices, dates, application routes and narrative fields before serialization', () => {
    const bundle = fixture()
    const directory = selectDiscoveryData(bundle, today, evidence(bundle))
    const serialized = JSON.stringify(directory)
    for (const secret of ['STALE_SENTINEL', '99999', '88888', '77777', 'old-apply', 'old-award-apply', '2026-10-31']) expect(serialized).not.toContain(secret)
    expect(directory.programs[0].durationMonths).toBeNull()
    expect(directory.programs[0].supplementaryDetails).toBeUndefined()
    expect(directory.scholarships[0].eligibility).toBeUndefined()
    expect(directory.scholarships[0].programIds).toEqual([])
  })

  it('does not match old dynamic facts in funding, tuition, language and deadline filters', () => {
    const bundle = fixture(), directory = selectDiscoveryData(bundle, today, evidence(bundle))
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({}), today).total).toBe(1)
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({ language: 'English' }), today).total).toBe(0)
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({ tuition: 'known' }), today).total).toBe(0)
    expect(queryScholarshipCatalog(directory, parseScholarshipCatalogFilters({ funding: 'full-tuition' }), today).total).toBe(0)
    expect(queryScholarshipCatalog(directory, parseScholarshipCatalogFilters({ deadline: 'future' }), today).total).toBe(0)
  })

  it('returns safe directory API records while legacy current-only publication remains empty', () => {
    const bundle = fixture(), directory = selectDiscoveryData(bundle, today, evidence(bundle))
    const service = new CatalogApiService(directory, releaseFromBundle(bundle, today), today)
    expect(service.listPrograms().data).toHaveLength(1)
    expect(service.listScholarships().data).toHaveLength(1)
    expect(JSON.stringify(service.listScholarships())).not.toContain('STALE_SENTINEL')
    expect(service.listPrograms({ language: 'English' }).data).toHaveLength(0)
    expect(service.listScholarships({ program: 'program' }).data).toHaveLength(0)
  })

  it('keeps thin identity pages out of search-engine indexing', () => {
    const bundle = fixture(), directory = selectDiscoveryData(bundle, today, evidence(bundle))
    expect(isIndexableProgram(directory.programs[0], directory.admissionCycles, today)).toBe(false)
    expect(isIndexableScholarship(directory.scholarships[0])).toBe(false)
  })

  it('keeps current reviewed facts available before expiry without requiring a migration ledger', () => {
    const bundle = fixture(), directory = selectDiscoveryData(bundle, '2026-10-22')
    expect(directory.programs[0].discovery.currentFacts).toBe(true)
    expect(directory.programs[0].durationMonths).toBe(24)
    expect(directory.scholarships[0].coverage.stipendCnyPerMonth).toBe(77777)
  })

  it('shows an independently rechecked leaf in filters and APIs without restoring other old fields', () => {
    const bundle = fixture(), fields = [fieldEvidence(bundle, 'program', 'teachingLanguages', ['English']), fieldEvidence(bundle, 'scholarship', 'deadline', '2026-10-31')]
    const directory = selectDiscoveryData(bundle, today, evidence(bundle), fields)
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({ language: 'English' }), today).total).toBe(1)
    expect(queryScholarshipCatalog(directory, parseScholarshipCatalogFilters({ deadline: 'future' }), today).total).toBe(1)
    const service = new CatalogApiService(directory, releaseFromBundle(bundle, today), today)
    expect(service.listPrograms({ language: 'English' }).data[0].teachingLanguages).toEqual(['English'])
    expect(service.listPrograms().data[0].durationMonths).toBeNull()
    expect(service.listScholarships().data[0].deadline).toBe('2026-10-31')
    expect(service.listScholarships().data[0].fieldMeta.deadline.checkedAt).toContain(today)
    expect(directory.scholarships[0].status).toBe('stale')
    const serialized = JSON.stringify(service.listScholarships())
    for (const hidden of ['private/snapshots', 'private-receipt', 'STALE_SENTINEL']) expect(serialized).not.toContain(hidden)
    expect(selectPublishedData(bundle, today).scholarships).toEqual([])
  })

  it('creates a blank cycle only for an accepted program with independently checked scoped facts', () => {
    const bundle = fixture(), field = fieldEvidence(bundle, 'admissionCycle', 'closesOn', '2026-12-31')
    const directory = selectDiscoveryData(bundle, today, evidence(bundle), [field])
    expect(directory.admissionCycles).toHaveLength(1)
    expect(directory.admissionCycles[0].closesOn).toBe('2026-12-31')
    expect(directory.admissionCycles[0].opensOn).toBeNull()
    expect(directory.admissionCycles[0].tuitionCny).toBeNull()
    expect(directory.admissionCycles[0].notes).toBeUndefined()
    expect(directory.admissionCycles[0].dateStatus).toBe('not-announced')
    expect(directory.admissionCycles[0].status).toBe('stale')
    expect(selectDiscoveryData(bundle, today, [], [field]).admissionCycles).toEqual([])
    bundle.admissionCycles[0].dateStatus = 'previous-cycle-reference'
    expect(selectDiscoveryData(bundle, today, evidence(bundle), [field]).admissionCycles).toEqual([])
  })

  it('preserves additive count metadata without changing legacy publicCounts semantics', () => {
    const release = releaseFromBundle(fixture(), today)
    const counts = { universities: 1, programs: 1, scholarships: 1 }
    const parsed = parseCatalogReleaseInfo({ ...release, directoryCounts: counts,
      currentFactsCounts: { ...counts, programs: 0, scholarships: 0, admissionCycles: 0 } })
    expect(parsed.directoryCounts).toEqual(counts)
    expect(parsed.publicCounts).toEqual(release.publicCounts)
    expect(parsed.currentFactsCounts?.programs).toBe(0)
    expect(() => parseCatalogReleaseInfo({ ...release, directoryCounts: { ...counts, programs: -1 } })).toThrow()
  })

  it('does not infer an open window from an old opening date or a lone checked deadline', () => {
    const bundle = fixture(), ledger = evidence(bundle)
    const deadline = fieldEvidence(bundle, 'admissionCycle', 'closesOn', '2026-12-31')
    let directory = selectDiscoveryData(bundle, today, ledger, [deadline])
    expect(getApplicationState(directory.admissionCycles[0], today)).toBe('not-announced')
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({ applicationState: 'open' }), today).total).toBe(0)
    const published = fieldEvidence(bundle, 'admissionCycle', 'dateStatus', 'published')
    directory = selectDiscoveryData(bundle, today, ledger, [deadline, published])
    expect(getApplicationState(directory.admissionCycles[0], today)).toBe('dates-published')
    const opening = fieldEvidence(bundle, 'admissionCycle', 'opensOn', '2026-10-01')
    directory = selectDiscoveryData(bundle, today, ledger, [deadline, published, opening])
    expect(getApplicationState(directory.admissionCycles[0], today)).toBe('open')
    expect(queryProgramCatalog(directory, parseProgramCatalogFilters({ applicationState: 'open' }), today).total).toBe(1)
    const service = new CatalogApiService(directory, releaseFromBundle(bundle, today), today)
    expect(service.listPrograms({ applicationState: 'open' }).data).toHaveLength(1)
    expect(service.comparePrograms(['program']).data.items[0].currentCycle?.applicationState).toBe('open')
    expect(service.comparePrograms(['program']).data.items[0].currentCycle?.tuitionCny).toBeNull()
  })
})
