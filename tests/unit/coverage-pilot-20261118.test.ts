import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/coverage-pilot-20261118/review.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { applyFreshFieldVerifications, fieldValueSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { studentMatchCatalog } from '@/lib/student-matching-data'

const checked = '2026-11-18'
const bundle = loadMaintenanceBundle(process.cwd())
const codes = Object.keys(review.programmeEvidence)

describe('three zero-coverage schools and the scoped Xiamen funding opportunity', () => {
  it('admits each reviewed programme and its scoped intake through the production catalogue', () => {
    const before = getPublicCatalogSnapshot(bundle, '2026-11-17').directory
    const after = getPublicCatalogSnapshot(bundle, checked).directory
    expect(codes).toHaveLength(3)
    for (const id of codes) {
      const program = after.programs.find(p => p.id === id)
      expect(program).toBeDefined()
      expect(before.programs.some(p => p.id === id)).toBe(false)
      expect(after.admissionCycles.filter(c => c.programId === id)).toHaveLength(1)
      expect(after.admissionCycles.find(c => c.programId === id)).toMatchObject({ teachingLanguage: 'English', dateStatus: 'published' })
      expect(Object.keys(review.baseline.counts)).toContain(program!.universityId)
    }
    const award = after.scholarships.find(a => a.id === review.scholarship.recordId)!
    expect(award.coverage).toEqual({ tuition: 'full', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: 2500 })
    expect(after.programs.filter(p => scholarshipAppliesToProgram(award, p)).map(p => p.id).sort()).toEqual([...review.scholarship.scope.candidateProgramIds].sort())
  })
  it('preserves language alternatives, duration conditions and official application windows', () => {
    const cycles = getPublicCatalogSnapshot(bundle, checked).directory.admissionCycles
    const city = cycles.find(row => row.programId === 'program-cityuhk-ma-international-studies')!
    expect(city.languageRequirements![0].minimum).toMatch(/interview/i)
    expect(city).toMatchObject({ intake: 'other', closesOn: '2027-03-31' })
    const poly = cycles.find(row => row.programId === 'program-polyu-msc-data-science-and-analytics')!
    expect(poly).toMatchObject({ intake: 'autumn', opensOn: null, closesOn: '2027-02-25', tuitionCny: null })
    const hkustId = 'program-hkust-gz-phd-data-science-and-analytics'
    expect(cycles.find(c => c.programId === hkustId)).toMatchObject({ academicYear: '2026-2027', intake: 'spring', closesOn: '2026-12-04' })
    expect(bundle.programs.find(p => p.id === hkustId)).toMatchObject({ durationMonths: 36, durationMonthsMax: 48 })
    expect(getPublicCatalogSnapshot(bundle, '2026-12-05').directory.admissionCycles.some(c => c.programId === hkustId)).toBe(false)
  })
  it('binds each accepted leaf to an archived source whose bytes were verified by download', () => {
    const leaves = readFieldVerifications().filter(row => row.receiptPath === 'quality/maintenance/batches/coverage-pilot-20261118/field-receipt.json')
    expect(leaves).toHaveLength(31)
    const archived = new Map(review.privateArchive.objects.map(o => [o.key, o.sha256]))
    expect(archived.size).toBe(13)
    for (const leaf of leaves) {
      expect(archived.get(leaf.objectKey)).toBe(leaf.snapshotSha256)
      expect(validateFieldVerification(bundle, leaf, checked)).toEqual(leaf)
    }
  })
  it('excludes a contested annual language condition from matching while preserving other schools', () => {
    const scoped = structuredClone(bundle)
    const cycle = scoped.admissionCycles.find(row => row.programId === 'program-polyu-msc-data-science-and-analytics')!
    const first = readFieldVerifications().find(row => row.recordId === cycle.id && row.fieldPath === 'languageRequirements')!
    const source = { ...scoped.sources.find(row => row.id === first.sourceId)!, id: 'test-contradictory-source',
      url: 'https://www.polyu.edu.hk/test/conflicting-announcement' }
    scoped.sources.push(source)
    cycle.sourceIds.push(source.id)
    const value = [{ test: 'IELTS', minimum: '8.5' }]
    const conflict = { ...first, sourceId: source.id, sourceUrl: source.url, value, valueSha256: fieldValueSha256(value), observationOnly: true as const }
    const projected = getPublicCatalogSnapshot(bundle, checked).directory
    const before = studentMatchCatalog(projected, 'en', checked)
    const after = studentMatchCatalog(applyFreshFieldVerifications(scoped, projected, checked, [first, conflict]), 'en', checked)
    expect(before.map(item => item.id)).toContain(cycle.programId)
    expect(after.map(item => item.id)).toEqual(before.filter(item => item.id !== cycle.programId).map(item => item.id))
    const reconciled = { ...conflict, verifiedAt: '2026-11-18T08:10:00.000Z', value: first.value, valueSha256: first.valueSha256 }
    const resolved = studentMatchCatalog(applyFreshFieldVerifications(scoped, projected, checked, [reconciled, conflict, first]), 'en', checked)
    expect(resolved.map(item => item.id)).toContain(cycle.programId)
  })
})
