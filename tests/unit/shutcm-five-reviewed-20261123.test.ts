import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'
import review from '../../quality/maintenance/batches/shutcm-five-reviewed-20261123/review.json'
import archive from '../../quality/maintenance/batches/shutcm-five-reviewed-20261123/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { applyFreshFieldVerifications, fieldValueSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { getApplicationState } from '@/lib/data/admission'

const day = '2026-11-23', school = 'uni-shanghai-university-of-traditional-chinese-medicine'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/shutcm-five-reviewed-20261123/field-receipt.json'

describe('SHUTCM 2027 Chinese science bachelor source review', () => {
  it('preserves all 2371 prior programmes and the complete pre-batch catalogue', async () => {
    const c = review.baseline.collectionLengths
    const released = reviewedCatalogueAt('6bd945e22c0e9c1091cf9fe8b21e58bfb948ea86')
    const original = { ...released, programs: released.programs.slice(0, c.programs), admissionCycles: released.admissionCycles.slice(0, c.admissionCycles),
      sources: released.sources.slice(0, c.sources), cities: released.cities.slice(0, c.cities), universities: released.universities.slice(0, c.universities), scholarships: released.scholarships.slice(0, c.scholarships) }
    expect(original.programs).toHaveLength(2371)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(review.baseline.counts[school]).toBe(0)
    for (const [id, hash] of Object.entries(review.baseline.preservedExistingSchoolRecordHashes)) {
      expect(createHash('sha256').update(canonicalIdentityJson(bundle.programs.find(p => p.id === id))).digest('hex')).toBe(hash)
    }
  })

  it('publishes five distinct Chinese identities with exact upcoming 2027 cycles and science subjects', () => {
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    expect(ids).toHaveLength(5)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => p.universityId === school).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
    expect(snapshot.directory.programs.length).toBeGreaterThanOrEqual(review.baseline.directoryPrograms + 5)
    for (const id of ids) {
      const program = bundle.programs.find(p => p.id === id)!
      expect(Object.keys(program.name)).toEqual(['zh'])
      expect(program).toMatchObject({ degreeLevel: 'bachelor', durationMonths: 48, teachingLanguages: ['Chinese'], verificationScope: 'facts' })
      expect(program.details).toBeUndefined()
      const cycles = snapshot.directory.admissionCycles.filter(c => c.programId === id)
      expect(cycles).toHaveLength(1)
      const cycle = cycles[0]
      expect(cycle).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', opensOn: '2026-12-01', closesOn: '2027-06-30',
        tuitionCny: 28000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 450, applyUrl: 'https://apply.shutcm.edu.cn/' })
      expect(getApplicationState(cycle, day)).toBe('upcoming')
      expect(getApplicationState(cycle, '2026-12-01')).toBe('open')
      expect(cycle.languageRequirements).toEqual([{ test: 'HSK', minimum: '近两年内取得的HSK四级≥180分。' }])
      const conditions = JSON.stringify(cycle.eligibility)
      expect(conditions).toContain('理科中文、数学和物理')
      expect(conditions).not.toMatch(/免考|文科中文|化学/u)
      expect(conditions).toContain('不宜申请')
      expect(JSON.stringify(cycle.applicationMaterials)).toContain('申请奖学金必要文件')
    }
  })

  it('binds all 65 leaf proofs to immutable archived source bytes and checks strict receipts', async () => {
    const leaves = readFieldVerifications().filter(l => l.receiptPath === receiptPath)
    expect(leaves).toHaveLength(65)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(review.privateArchive.archiveReceiptSha256).toBe(sha256)
    expect(archive.objects).toHaveLength(2)
    for (const object of archive.objects) {
      expect(object.originalSha256).toBe(object.readbackSha256)
      expect(object.originalBytes).toBe(object.readbackBytes)
    }
    for (const leaf of leaves) {
      expect(archive.objects.find(o => o.key === leaf.objectKey)?.readbackSha256).toBe(leaf.snapshotSha256)
      expect(validateFieldVerification(bundle, leaf, day)).toEqual(leaf)
    }
    const first = leaves.find(l => l.entityType === 'admissionCycle' && l.fieldPath === 'eligibility')!
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'unverified' }]) {
      const wrong = structuredClone(bundle)
      Object.assign(wrong.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(wrong, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/mirror' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd(), day)).integrityPassed).toBe(true)
  }, 30000)

  it('does not admit missing or disputed annual conditions merely because the raw parent is fresh', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const program = projected.programs.find(p => p.id === id)!, cycle = projected.admissionCycles.find(c => c.programId === id)!
    expect(hasDetailedPublicProgram(program, [{ ...cycle, eligibility: [] }], day)).toBe(false)
    expect(hasDetailedPublicProgram(program, [{ ...cycle, applyUrl: null }], day)).toBe(false)
    const raw = structuredClone(bundle), first = readFieldVerifications().find(l => l.recordId === cycle.id && l.fieldPath === 'eligibility')!
    const source = { ...raw.sources.find(s => s.id === first.sourceId)!, id: 'test-shutcm-conflict', url: 'https://iec.shutcm.edu.cn/test/conflicting-announcement' }
    raw.sources.push(source); raw.admissionCycles.find(c => c.id === cycle.id)!.sourceIds.push(source.id)
    const value = [{ zh: '此专业免考CSCA。' }]
    const conflict = { ...first, sourceId: source.id, sourceUrl: source.url, value, valueSha256: fieldValueSha256(value), observationOnly: true as const }
    const overlaid = applyFreshFieldVerifications(raw, projected, day, [first, conflict])
    expect(hasDetailedPublicProgram(overlaid.programs.find(p => p.id === id)!, overlaid.admissionCycles.filter(c => c.id === cycle.id), day)).toBe(false)
  })
})
