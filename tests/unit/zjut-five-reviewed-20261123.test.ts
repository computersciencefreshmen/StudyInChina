import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/zjut-five-reviewed-20261123/review.json'
import archive from '../../quality/maintenance/batches/zjut-five-reviewed-20261123/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { applyFreshFieldVerifications, fieldValueSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-23', school = 'uni-zhejiang-university-of-technology'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/zjut-five-reviewed-20261123/field-receipt.json'

describe('five exact 2027 English master programmes at ZJUT', () => {
  it('preserves the entire 2377-program base, including all six old ZJUT bachelor records', async () => {
    const original = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(original.programs).toHaveLength(2377)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(review.baseline.liveZeroQualified).toBe(true)
    for (const [id, hash] of Object.entries(review.baseline.preservedExistingSchoolRecordHashes)) {
      const old = bundle.programs.find(p => p.id === id)!
      expect(old.degreeLevel).toBe('bachelor')
      expect(createHash('sha256').update(canonicalIdentityJson(old)).digest('hex')).toBe(hash)
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => p.universityId === school).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(cycle => ids.includes(cycle.programId))).toHaveLength(5)
    }
  })

  it('uses only the marked master column, three-year duration and the master English OR alternatives', () => {
    for (const id of ids) {
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      expect(evidence.enMasterCell).toContain(evidence.token)
      expect(evidence.cnMasterCell).toContain('◆ ' + evidence.officialName.zh)
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: evidence.officialName, degreeLevel: 'master', teachingLanguages: ['English'], durationMonths: 36 })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'English', opensOn: null, closesOn: '2027-05-30',
        tuitionCny: 24800, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 400, applyUrl: 'https://intlstudent.zjut.edu.cn/' })
      expect(c.languageRequirements).toHaveLength(1)
      const language = c.languageRequirements![0].minimum!
      expect(language).toContain('OR IELTS 6.0 / TOEFL 75 OR')
      expect(language).toContain('English-medium undergraduate curriculum')
      expect(language).toContain('native English speakers')
      expect(language).not.toMatch(/HSK|6\.5|85|CSCA/u)
      expect(JSON.stringify(c.eligibility)).not.toMatch(/2023|18.*25|35.*years|CSCA/u)
      expect(c.notes?.en).toContain('may move earlier or later')
    }
    expect(ids.some(id => /computer-science|international-business|mba/u.test(id))).toBe(false)
  })

  it('checks 60 strict source-field proofs and five actual archived original hashes', async () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(60)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.status).toBe('readback_verified')
    expect(archive.objects).toHaveLength(5)
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
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'Chinese' }, { applicationRound: 'unreviewed' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/mirror' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd())).integrityPassed).toBe(true)
  }, 30000)

  it('withholds missing or disputed annual conditions rather than upgrading the raw parent', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const p = projected.programs.find(p => p.id === id)!, c = projected.admissionCycles.find(c => c.programId === id)!
    expect(hasDetailedPublicProgram(p, [{ ...c, eligibility: [] }], day)).toBe(false)
    expect(hasDetailedPublicProgram(p, [{ ...c, applyUrl: null }], day)).toBe(false)
    const raw = structuredClone(bundle), first = readFieldVerifications().find(f => f.recordId === c.id && f.fieldPath === 'languageRequirements')!
    const source = { ...raw.sources.find(s => s.id === first.sourceId)!, id: 'test-zjut-conflict', url: 'https://www.gjxy.zjut.edu.cn/test/conflicting-announcement' }
    raw.sources.push(source); raw.admissionCycles.find(cycle => cycle.id === c.id)!.sourceIds.push(source.id)
    const value = [{ test: 'IELTS' as const, minimum: '6.5' }]
    const conflict = { ...first, sourceId: source.id, sourceUrl: source.url, value, valueSha256: fieldValueSha256(value), observationOnly: true as const }
    const overlaid = applyFreshFieldVerifications(raw, projected, day, [first, conflict])
    expect(hasDetailedPublicProgram(overlaid.programs.find(p => p.id === id)!, overlaid.admissionCycles.filter(cycle => cycle.id === c.id), day)).toBe(false)
  })
})
