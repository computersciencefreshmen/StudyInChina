import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/tju-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/tju-five-reviewed-20261126/archive-receipt.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { canonicalIdentityJson, identityFingerprint } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { studentMatchCatalog } from '@/lib/student-matching-data'
import { reviewedDataAt } from './reviewed-release-snapshot'

const day = '2026-11-26', bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const fields = readFieldVerifications().filter(f => f.receiptPath === 'quality/maintenance/batches/tju-five-reviewed-20261126/field-receipt.json')
const snapshot = getPublicCatalogSnapshot(bundle, day)

describe('refresh five existing Tianjin University Chinese master scopes', () => {
  it('reuses the exact programme and cycle IDs and their existing accepted identities', () => {
    const originalPrograms = reviewedDataAt(review.baseline.gitCommit, 'programs') as typeof bundle.programs
    const originalCycles = reviewedDataAt(review.baseline.gitCommit, 'admission-cycles') as typeof bundle.admissionCycles
    expect(ids).toHaveLength(5)
    expect(review.baseline.schoolCoverage.currentProgramCount).toBe(0)
    expect(review.scopeDecisions).toMatchObject({ newProgramIds: 0, newCycleIds: 0, existingIdentityFingerprintsUnchanged: true })
    const identities = readIdentityAcceptances(undefined, { strictProjection: true })
    for (const id of ids) {
      const p = bundle.programs.find(p => p.id === id)!, original = originalPrograms.find(p => p.id === id)!
      expect(p.name).toEqual(original.name)
      expect(p.slug).toBe(original.slug)
      expect(p.programUrl).toBe(original.programUrl)
      expect(identityFingerprint('program', p)).toBe(identityFingerprint('program', original))
      expect(identities.filter(i => i.entityType === 'program' && i.recordId === id)).toHaveLength(1)
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      expect(bundle.admissionCycles.find(c => c.id === evidence.reusedCycleId)?.programId).toBe(id)
      expect(originalCycles.find(c => c.id === evidence.reusedCycleId)?.programId).toBe(id)
    }
  })

  it('uses five exact 3Y Chinese-master rows, reference tuition and the published autumn window', () => {
    expect(review.annualYearEvidence.quote).toBe('Please click here for catalog of Master programs 2027.')
    expect(review.annualYearEvidence.yearNotInferredFromDeadline).toBe(true)
    expect(Object.values(review.programmeEvidence).map(e => e.row)).toEqual([2, 3, 4, 5, 6])
    const eligible = snapshot.directory.programs.filter(p => ids.includes(p.id))
    expect(eligible.map(p => p.id).sort()).toEqual([...ids].sort())
    for (const p of eligible) {
      const evidence = review.programmeEvidence[p.id as keyof typeof review.programmeEvidence]
      expect(evidence.cells.slice(5)).toEqual(['3Y', '硕士研究生', "Master's Degree", '中文', 'Chinese', '30000', '500'])
      expect(p.durationMonths).toBe(36)
      expect(p.teachingLanguages).toEqual(['Chinese'])
      const cycles = snapshot.directory.admissionCycles.filter(c => c.programId === p.id)
      expect(cycles).toHaveLength(1)
      expect(cycles[0]).toMatchObject({ id: evidence.reusedCycleId, academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese',
        opensOn: '2026-09-30', closesOn: '2027-05-31', tuitionCny: 30000, tuitionPeriod: 'academic-year', tuitionStatus: 'reference', applicationFeeCny: 500 })
      expect(hasDetailedPublicProgram(p, cycles, day)).toBe(true)
    }
  })

  it('keeps conflicting ages, language exemptions and plan-unit claims out of automatic qualification matching', () => {
    expect(review.commonFieldEvidence.ageChinese.quote).toContain('不超过35周岁')
    expect(review.commonFieldEvidence.ageEnglish.quote).toContain('under the age of 35')
    expect(review.commonFieldEvidence.planChinese.quote).toContain('不少于1000字')
    expect(review.commonFieldEvidence.planEnglish.quote).toContain('1000 words at least')
    const matches = studentMatchCatalog(snapshot.directory, 'en', day).filter(row => ids.includes(row.id))
    expect(matches).toHaveLength(5)
    for (const row of matches) {
      expect(JSON.stringify(row.education?.value)).not.toMatch(/35|exempt|waiv|1000/iu)
      expect(JSON.stringify(row.languageConditions?.value)).not.toMatch(/exempt|waiv|native|母语|豁免/iu)
      expect(row.budget).toBeNull()
      const c = snapshot.directory.admissionCycles.find(c => c.id === row.cycleId)!
      expect(c.notes?.en).toContain('Chinese says no older than 35 while English says under 35')
      expect(c.notes?.zh).toContain('须向校方确认')
      expect(c.languageRequirements).toEqual([{ test: 'HSK', minimum: 'HSK五级180分（含）以上。' }])
    }
  })

  it('binds all 105 leaves and four real readbacks to the exact annual and language scope', () => {
    expect(fields).toHaveLength(105)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(4)
    for (const source of archive.objects) {
      expect(source.readbackSha256).toBe(source.originalSha256)
      expect(source.readbackBytes).toBe(source.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(a => a.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'eligibility')!
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'English' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
  })
})
