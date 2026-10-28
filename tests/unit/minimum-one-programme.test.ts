import { describe, expect, it } from 'vitest'
import { selectMinimumOneProgrammes } from '../../scripts/maintenance/select-minimum-one'
import type { MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { identityFingerprint, type IdentityAcceptanceLedger } from '../../src/lib/data/identity-acceptance'
import type { DataBundle } from '../../src/lib/data/types'

const today = '2026-10-27', zero = '0'.repeat(64)
function fixture(): { bundle: DataBundle; acceptances: IdentityAcceptanceLedger } {
  const audit = { sourceIds: ['official'], verifiedAt: '2026-10-19', reviewAfter: '2027-01-01', status: 'verified' as const }
  return { bundle: {
    sources: [{ id: 'official', url: 'https://example.edu/admissions', title: 'Official', publisher: 'University', kind: 'program', language: 'en', official: true, accessedAt: '2026-10-19' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: ['first', 'second', 'hidden'].map(id => ({ ...audit, id, slug: id, name: { en: id }, cityId: 'city', region: null,
      officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false, ...(id === 'hidden' ? { status: 'draft' as const } : {}) })),
    programs: [{ ...audit, status: 'stale', reviewAfter: '2026-10-22', id: 'old-program', slug: 'old-program', universityId: 'first', name: { en: 'Real Existing Major' },
      degreeLevel: 'master', discipline: 'other', teachingLanguages: [], durationMonths: null, programUrl: 'https://example.edu/major', applyUrl: null, languageRequirements: [] }],
    admissionCycles: [], scholarships: [],
  }, acceptances: { schemaVersion: 1, entries: [] } }
}
function proposal(id: string, universityId = 'first'): MaintenanceProposal {
  const evidence = { sourceId: 'source', url: 'https://example.edu/catalogue', snapshotSha256: zero, objectKey: 'maintenance/raw/source.html', locator: 'text:document', quote: 'An unverified fixture quote' }
  return { id, universityId, entityType: 'program', recordId: null, operation: 'create', status: 'ready', warnings: [],
    fields: { name: { en: id }, degreeLevel: 'master', programType: 'degree', programUrl: evidence.url, internationalAdmissionsEvidence: evidence },
    source: { id: evidence.sourceId, ...evidence, checkedAt: '2026-10-27T00:00:00.000Z', contentType: 'text/html' },
    fieldEvidence: [{ ...evidence, fieldPath: 'name.en' }], scope: { year: null, intake: null },
    review: { decision: 'approved', reviewerId: 'independent-fixture', method: 'human', reviewedAt: '2026-10-27T01:00:00.000Z', candidateSha256: zero,
      snapshotSha256: zero, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } } }
}

describe('minimum one accepted visible programme per school', () => {
  it('does not count an unaccepted raw programme as coverage', () => {
    const f = fixture(), result = selectMinimumOneProgrammes({ ...f, proposals: [proposal('candidate')], today })
    expect(f.bundle.programs).toHaveLength(1)
    expect(result.coveredUniversityIds).toEqual([])
    expect(result.selected.map(p => p.id)).toEqual(['candidate'])
  })
  it('preserves input order, selects at most one per school and never mutates candidates or data', () => {
    const f = fixture(), candidates = [proposal('second-choice', 'second'), proposal('first-choice'), proposal('extra-depth'), proposal('extra-second', 'second')]
    const before = JSON.stringify({ f, candidates })
    const result = selectMinimumOneProgrammes({ ...f, proposals: candidates, today })
    expect(result.selected).toEqual(candidates.slice(0, 2))
    expect(result.skipped.map(p => p.reason)).toEqual(['school_already_selected', 'school_already_selected'])
    expect(JSON.stringify({ f, candidates })).toBe(before)
  })
  it('skips a school whose stale programme has a valid accepted identity', () => {
    const f = fixture(), record = f.bundle.programs[0]
    f.acceptances.entries.push({ entityType: 'program', recordId: record.id, identitySha256: identityFingerprint('program', record), sourceIds: record.sourceIds,
      acceptedAt: '2026-10-20T00:00:00.000Z', reviewer: 'independent', receiptPath: 'quality/real-receipt.json', receiptSha256: zero })
    const result = selectMinimumOneProgrammes({ ...f, proposals: [proposal('already-covered'), proposal('uncovered', 'second')], today })
    expect(result.coveredUniversityIds).toEqual(['first'])
    expect(result.selected.map(p => p.id)).toEqual(['uncovered'])
    expect(result.skipped[0].reason).toBe('school_already_covered')
  })
  it('counts a current officially verified programme using the actual publication projection', () => {
    const f = fixture(); Object.assign(f.bundle.programs[0], { status: 'verified', reviewAfter: '2027-01-01' })
    expect(selectMinimumOneProgrammes({ ...f, proposals: [proposal('covered')], today }).selected).toEqual([])
  })
  it('ignores held and unapproved candidates without consuming the school slot', () => {
    const f = fixture(), held = proposal('held'), rejected = proposal('rejected'), unchecked = proposal('unchecked'), missing = proposal('missing')
    held.status = 'held'; rejected.review!.decision = 'rejected'; unchecked.review!.checks.evidenceLocated = false; delete missing.review
    const result = selectMinimumOneProgrammes({ ...f, proposals: [held, rejected, unchecked, missing, proposal('valid')], today })
    expect(result.selected.map(p => p.id)).toEqual(['valid'])
    expect(result.skipped.map(p => p.reason)).toEqual(['producer_held', 'review_not_approved', 'review_not_approved', 'review_not_approved'])
  })
  it('skips invisible schools, non-programme proposals and explicitly unpublished target identities', () => {
    const f = fixture(), scholarship = proposal('award'), draft = proposal('draft-target'), archived = proposal('archived-target')
    scholarship.entityType = 'scholarship'; draft.recordId = f.bundle.programs[0].id; f.bundle.programs[0].status = 'draft'
    f.bundle.programs.push({ ...f.bundle.programs[0], id: 'archived', slug: 'archived', status: 'archived' }); archived.recordId = 'archived'
    const result = selectMinimumOneProgrammes({ ...f, proposals: [proposal('hidden-school', 'hidden'), scholarship, draft, archived, proposal('valid')], today })
    expect(result.selected.map(p => p.id)).toEqual(['valid'])
    expect(result.skipped.map(p => p.reason)).toEqual(['school_not_visible', 'not_program', 'target_identity_unpublished', 'target_identity_unpublished'])
  })
  it('does not trust a changed or future acceptance to suppress a genuinely uncovered school', () => {
    const f = fixture(), record = f.bundle.programs[0]
    for (const [identitySha256, acceptedAt] of [[zero, '2026-10-20T00:00:00.000Z'], [identityFingerprint('program', record), '2027-01-01T00:00:00.000Z']]) {
      f.acceptances.entries = [{ entityType: 'program', recordId: record.id, identitySha256, acceptedAt, sourceIds: record.sourceIds, reviewer: 'independent', receiptPath: 'receipt.json', receiptSha256: zero }]
      expect(selectMinimumOneProgrammes({ ...f, proposals: [proposal('candidate')], today }).selected).toHaveLength(1)
    }
  })
})
