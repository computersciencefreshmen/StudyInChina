import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'
import review from '../../quality/maintenance/batches/cufe-five-reviewed-20261122/review.json'
import archive from '../../quality/maintenance/batches/cufe-five-reviewed-20261122/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { applyFreshFieldVerifications, fieldValueSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { getApplicationState } from '@/lib/data/admission'

const day = '2026-11-22', school = 'uni-central-university-of-finance-and-economics'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/cufe-five-reviewed-20261122/field-receipt.json'

describe('five official CUFE Chinese undergraduate programmes in 2027', () => {
  it('adds five distinct degrees while preserving the complete original catalogue and three old masters', async () => {
    const counts = review.baseline.collectionLengths
    const released = reviewedCatalogueAt('bbe425227329dcf5c1b305f751b0a1617c778c6e')
    const original = { ...released, programs: released.programs.slice(0, counts.programs),
      admissionCycles: released.admissionCycles.slice(0, counts.admissionCycles), sources: released.sources.slice(0, counts.sources),
      cities: released.cities.slice(0, counts.cities), universities: released.universities.slice(0, counts.universities), scholarships: released.scholarships.slice(0, counts.scholarships) }
    expect(original.programs).toHaveLength(2361)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(review.baseline.counts[school]).toBe(0)
    for (const [id, hash] of Object.entries(review.baseline.preservedExistingSchoolRecordHashes)) {
      const old = bundle.programs.find(p => p.id === id)!
      expect(old.degreeLevel).toBe('master')
      expect(createHash('sha256').update(canonicalIdentityJson(old)).digest('hex')).toBe(hash)
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => p.universityId === school).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(10)
    }
    expect(snapshot.directory.programs.length).toBeGreaterThanOrEqual(review.baseline.directoryPrograms + 5)
    expect(snapshot.current.programs.length).toBeGreaterThanOrEqual(review.baseline.currentPrograms + 5)
  })

  it('uses the Chinese tuition column and preserves two separate annual windows and the actual language condition', () => {
    for (const id of ids) {
      const p = bundle.programs.find(p => p.id === id)!
      expect(p).toMatchObject({ degreeLevel: 'bachelor', teachingLanguages: ['Chinese'], durationMonths: 48 })
      expect(Object.keys(p.name)).toEqual(['en'])
      const cycles = bundle.admissionCycles.filter(c => c.programId === id)
      expect(cycles.map(c => [c.applicationRound, c.opensOn, c.closesOn])).toEqual([
        ['Phase 1', '2026-11-01', '2027-03-24'], ['Phase 2', '2027-04-01', '2027-06-16'],
      ])
      for (const c of cycles) {
        expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', tuitionCny: 25000,
          tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 600, applyUrl: 'https://cufe.17gz.org/' })
        expect(c.languageRequirements).toEqual([{ test: 'HSK', minimum: expect.stringMatching(/Level 5, score 180 or above.+humanities Chinese and mathematics/u) }])
        expect(c.eligibility?.[0].en).toMatch(/generally be no more than 25.+under 18/u)
        expect(JSON.stringify(c.languageRequirements)).not.toMatch(/IELTS|TOEFL|exempt|210/u)
      }
      expect(cycles.map(c => getApplicationState(c, '2027-03-25'))).toEqual(['closed', 'upcoming'])
    }
    const financialManagement = review.programmeEvidence['program-cufe-financial-management-bachelor-chinese']
    expect(financialManagement.faculty).toBe('School of Accountancy')
    expect(financialManagement.facultyInheritedFromRow).toBe(4)
    expect(financialManagement.cells).toEqual(['Financial Management', '4', '25,000', '/'])
  })

  it('checks all 120 leaf proofs and immutable receipts, invalidating a reused wrong annual or language scope', async () => {
    const leaves = readFieldVerifications().filter(l => l.receiptPath === receiptPath)
    expect(leaves).toHaveLength(120)
    for (const leaf of leaves) expect(validateFieldVerification(bundle, leaf, day)).toEqual(leaf)
    const { sha256, ...archiveContent } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(archiveContent)).digest('hex')).toBe(sha256)
    expect(review.privateArchive.archiveReceiptSha256).toBe(sha256)
    expect(review.privateArchive.status).toBe('readback_verified')
    expect(archive.objects).toHaveLength(3)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const leaf of leaves) expect(archive.objects.find(o => o.key === leaf.objectKey)?.readbackSha256).toBe(leaf.snapshotSha256)
    const first = leaves.find(l => l.entityType === 'admissionCycle' && l.fieldPath === 'languageRequirements')!
    for (const changes of [{ academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'unreviewed round' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, changes)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/mirror' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd())).integrityPassed).toBe(true)
  }, 30000)

  it('holds a contradicted qualification and missing annual route instead of counting an unresolved programme', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const p = projected.programs.find(p => p.id === id)!, cycle = projected.admissionCycles.find(c => c.programId === id)!
    expect(hasDetailedPublicProgram(p, [{ ...cycle, applyUrl: null }], day)).toBe(false)
    expect(hasDetailedPublicProgram(p, [{ ...cycle, eligibility: [] }], day)).toBe(false)
    const raw = structuredClone(bundle)
    const first = readFieldVerifications().find(l => l.recordId === cycle.id && l.fieldPath === 'eligibility')!
    const source = { ...raw.sources.find(s => s.id === first.sourceId)!, id: 'test-cufe-conflict', url: 'https://sice.cufe.edu.cn/test/conflicting-announcement' }
    raw.sources.push(source); raw.admissionCycles.find(c => c.id === cycle.id)!.sourceIds.push(source.id)
    const value = [{ en: 'Under-18 applicants are not eligible.' }]
    const conflict = { ...first, sourceId: source.id, sourceUrl: source.url, value, valueSha256: fieldValueSha256(value), observationOnly: true as const }
    const overlaid = applyFreshFieldVerifications(raw, projected, day, [first, conflict])
    expect(hasDetailedPublicProgram(overlaid.programs.find(p => p.id === id)!, overlaid.admissionCycles.filter(c => c.id === cycle.id), day)).toBe(false)
  })
})
