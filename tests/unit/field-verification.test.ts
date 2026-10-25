import { describe, expect, it } from 'vitest'
import { applyFreshFieldVerifications, fieldRecordScopeSha256, fieldValueSha256, validateFieldVerification, type FieldVerification } from '@/lib/data/field-verification'
import type { DataBundle } from '@/lib/data/types'

const TODAY = '2026-10-24'
function fixture(): DataBundle {
  const audit = { status: 'stale' as const, verifiedAt: '2026-10-01', reviewAfter: '2026-10-10', sourceIds: ['official'] }
  return { sources: [{ id: 'official', url: 'https://example.edu/admissions', title: 'Official guide', publisher: 'University', kind: 'program', official: true, language: 'en', accessedAt: TODAY }], cities: [], universities: [],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Computer Science' }, degreeLevel: 'master', discipline: 'engineering',
      programUrl: 'https://example.edu/admissions', applyUrl: 'https://example.edu/apply', teachingLanguages: ['English'], durationMonths: 24,
      languageRequirements: [{ test: 'IELTS', minimum: '7.0' }], supplementaryDetails: { eligibility: [{ en: 'OLD QUALIFICATION' }] } }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-10-01', closesOn: '2026-11-30',
      dateStatus: 'published', tuitionCny: 99000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 800, evidenceBasis: 'cycle-specific', factScope: 'complete' }],
    scholarships: [{ ...audit, id: 'award', slug: 'award', name: { en: '2027 award' }, providerType: 'university', universityIds: ['university'], programIds: [],
      coverage: { tuition: 'full', accommodation: 'full', insurance: true, stipendCnyPerMonth: 9999 }, deadline: '2026-10-31', applicationUrl: 'https://example.edu/apply',
      summary: { en: 'OLD AWARD CONDITIONS' }, eligibility: [{ en: 'OLD QUALIFICATION' }] }] }
}
function receipt(data: DataBundle, type: FieldVerification['entityType'] = 'scholarship', fieldPath = 'deadline', value: unknown = '2026-10-31'): FieldVerification {
  const record = type === 'scholarship' ? data.scholarships[0] : type === 'program' ? data.programs[0] : data.admissionCycles[0]
  return { entityType: type, recordId: record.id, recordScopeSha256: fieldRecordScopeSha256(type, record), fieldPath, value, valueSha256: fieldValueSha256(value), factStatus: 'known',
    sourceId: 'official', sourceUrl: data.sources[0].url, snapshotSha256: '1'.repeat(64), objectKey: 'snapshots/official.html', locator: 'paragraph:12', quote: 'Applications close on October 31, 2026.',
    verifiedAt: '2026-10-24T00:00:00.000Z', reviewAfter: '2026-10-27', review: { method: 'dual-model', reviewerId: 'independent-review' }, receiptPath: 'quality/field-review.json', receiptSha256: '2'.repeat(64) }
}
function redacted(raw: DataBundle): DataBundle {
  const copy = structuredClone(raw)
  copy.scholarships[0] = { ...copy.scholarships[0], coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: null, applicationUrl: null, summary: null, eligibility: undefined }
  copy.programs[0] = { ...copy.programs[0], applyUrl: null, durationMonths: null, teachingLanguages: [], languageRequirements: [], supplementaryDetails: undefined }
  return copy
}

describe('field-specific evidence publication', () => {
  it('rechecks only a deadline without reviving historical money or qualification text', () => {
    const raw = fixture(), projected = redacted(raw), before = JSON.stringify(raw)
    const result = applyFreshFieldVerifications(raw, projected, TODAY, [receipt(raw)])
    expect(result.scholarships[0].deadline).toBe('2026-10-31')
    expect(result.scholarships[0].coverage.stipendCnyPerMonth).toBeNull()
    expect(result.scholarships[0].eligibility).toBeUndefined()
    expect(result.scholarships[0].status).toBe('stale')
    expect(result.scholarships[0].reviewAfter).toBe('2026-10-10')
    expect(JSON.stringify(result)).not.toContain('OLD QUALIFICATION')
    expect(JSON.stringify(raw)).toBe(before)
    expect(projected.scholarships[0].deadline).toBeNull()
  })
  it('independently removes the accepted value after its own review expires', () => {
    const raw = fixture(), entry = receipt(raw)
    expect(validateFieldVerification(raw, entry, '2026-10-27')).toBeDefined()
    expect(applyFreshFieldVerifications(raw, redacted(raw), '2026-10-28', [entry]).scholarships[0].deadline).toBeNull()
  })
  it('rejects a future check, a long renewal and a source URL mismatch', () => {
    const raw = fixture(), entry = receipt(raw)
    for (const patch of [{ verifiedAt: '2026-10-25T00:00:00.000Z' }, { reviewAfter: '2027-01-01' }, { sourceUrl: 'https://different.edu/admissions' }])
      expect(validateFieldVerification(raw, { ...entry, ...patch }, TODAY)).toBeUndefined()
  })
  it('rejects a value that no longer matches canonical facts', () => {
    const raw = fixture(), entry = receipt(raw)
    raw.scholarships[0].deadline = '2026-11-30'
    expect(validateFieldVerification(raw, entry, TODAY)).toBeUndefined()
  })
  it('binds evidence to the year and intake even when the fee remains identical', () => {
    const raw = fixture(), entry = receipt(raw, 'admissionCycle', 'tuitionCny', 99000)
    expect(validateFieldVerification(raw, entry, TODAY)).toBeDefined()
    raw.admissionCycles[0].academicYear = '2028-2029'
    expect(validateFieldVerification(raw, entry, TODAY)).toBeUndefined()
  })
  it('binds scholarship evidence to its exact named annual scope', () => {
    const raw = fixture(), entry = receipt(raw)
    raw.scholarships[0].name = { en: '2028 award' }
    expect(validateFieldVerification(raw, entry, TODAY)).toBeUndefined()
  })
  it('rejects unknown paths, wrong value types and prototype paths', () => {
    const raw = fixture(), entry = receipt(raw)
    for (const fieldPath of ['summary', '__proto__.polluted', 'reviewAfter', 'status'])
      expect(validateFieldVerification(raw, { ...entry, fieldPath }, TODAY)).toBeUndefined()
    expect(validateFieldVerification(raw, { ...entry, value: 123, valueSha256: fieldValueSha256(123) }, TODAY)).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('does not grant identity acceptance or resurrect excluded records', () => {
    const raw = fixture(), entry = receipt(raw), projected = redacted(raw)
    projected.scholarships = []
    expect(applyFreshFieldVerifications(raw, projected, TODAY, [entry]).scholarships).toEqual([])
    raw.scholarships[0].status = 'archived'
    expect(validateFieldVerification(raw, entry, TODAY)).toBeUndefined()
  })
  it('updates one program fact without the other unreviewed application conditions', () => {
    const raw = fixture(), entry = receipt(raw, 'program', 'durationMonths', 24)
    const result = applyFreshFieldVerifications(raw, redacted(raw), TODAY, [entry])
    expect(result.programs[0].durationMonths).toBe(24)
    expect(result.programs[0].teachingLanguages).toEqual([])
    expect(result.programs[0].languageRequirements).toEqual([])
    expect(result.programs[0].applyUrl).toBeNull()
  })
})
