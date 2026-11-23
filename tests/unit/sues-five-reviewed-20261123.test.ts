import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/sues-five-reviewed-20261123/review.json'
import archive from '../../quality/maintenance/batches/sues-five-reviewed-20261123/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-23', school = 'uni-moe-4131010856'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/sues-five-reviewed-20261123/field-receipt.json'

describe('five 2027 self-funded Chinese master programmes at SUES', () => {
  it('binds five concrete majors to the reviewed baseline and preserves the existing AI bachelor', async () => {
    const original = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(ids.every(id => original.programs.every(program => program.id !== id))).toBe(true)
    expect(bundle.programs.filter(program => ids.includes(program.id))).toHaveLength(5)
    expect(bundle.admissionCycles.filter(cycle => ids.includes(cycle.programId))).toHaveLength(5)
    for (const source of Object.values(review.sources)) {
      expect(bundle.sources.find(item => item.id === source.sourceId)?.url).toBe(source.url)
    }
    expect(review.baseline.localZeroQualified).toBe(true)
    const old = bundle.programs.find(p => p.id === 'program-4131010856-bachelor-69719a006cffb4723324')!
    expect(old.degreeLevel).toBe('bachelor')
    expect(createHash('sha256').update(canonicalIdentityJson(old)).digest('hex')).toBe(review.baseline.preservedExistingSchoolRecordHashes[old.id as keyof typeof review.baseline.preservedExistingSchoolRecordHashes])
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => p.universityId === school).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
  })

  it('uses unstarred master rows and preserves exact year, fees, HSK exemption and source qualification wording', () => {
    for (const id of ids) {
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: evidence.officialName, degreeLevel: 'master', teachingLanguages: ['Chinese'], durationMonths: 36 })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'other', teachingLanguage: 'Chinese', opensOn: '2027-01-01', closesOn: '2027-06-15',
        tuitionCny: 25000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 0, applyUrl: 'https://admission.sues.edu.cn/' })
      expect(c.languageRequirements).toEqual([{ test: 'HSK', minimum: 'HSK Level 4 with score 180 or above. International graduates of Chinese-taught undergraduate programmes at universities in China are exempt from providing an HSK certificate.' }])
      expect(c.notes?.zh).toContain('具有学士学位或同等学历')
      expect(c.notes?.en).toContain('Bachelor or higher education degree')
      expect(JSON.stringify(c.eligibility)).toContain('22周岁以上，35周岁以下')
      expect(JSON.stringify(c.applicationMaterials)).toContain('2027年2月28日')
      expect(JSON.stringify(c.applicationMaterials)).not.toMatch(/portfolio|作品集/u)
      expect(JSON.stringify(c.languageRequirements)).not.toMatch(/IELTS|TOEFL|CSCA|two years|两年/u)
      expect(evidence.selectedRowHasNoAsterisk).toBe(true)
    }
    expect(ids).not.toContain('program-sues-mechanical-professional-master-chinese')
  })

  it('validates all 65 strict leaves against four actual archived sources and rejects wrong year, track or source', async () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(65)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.status).toBe('readback_verified')
    expect(archive.objects).toHaveLength(4)
    expect(review.privateArchive.archiveReceiptSha256).toBe(sha256)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(object => object.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'languageRequirements')!
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'unreviewed' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/copy' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd(), day)).integrityPassed).toBe(true)
  }, 30000)

  it('does not retain current-complete eligibility if the annual language, eligibility or route is missing', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const p = projected.programs.find(p => p.id === id)!, c = projected.admissionCycles.find(c => c.programId === id)!
    for (const change of [{ eligibility: [] }, { languageRequirements: [] }, { applyUrl: null }]) {
      expect(hasDetailedPublicProgram(p, [{ ...c, ...change }], day)).toBe(false)
    }
  })
})
