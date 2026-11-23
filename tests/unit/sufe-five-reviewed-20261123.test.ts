import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/sufe-five-reviewed-20261123/review.json'
import archive from '../../quality/maintenance/batches/sufe-five-reviewed-20261123/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { buildProgramCoverage } from '@/lib/data/school-program-coverage'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-23', school = 'uni-shanghai-university-of-finance-and-economics'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/sufe-five-reviewed-20261123/field-receipt.json'

describe('five Chinese-taught 2027 international master programmes at SUFE', () => {
  it('adds five distinct degrees from a zero-qualified baseline and preserves every prior record', async () => {
    const original = reviewedCatalogueAt(review.baseline.gitCommit)
    const released = reviewedCatalogueAt('814783081e1d050565fc7be7697bebc474e8be16')
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(await catalogSha256(released)).toBe(review.outputCatalogSha256)
    expect(review.baseline.coverage.currentProgramCount).toBe(0)
    for (const collection of ['universities', 'programs', 'admissionCycles', 'scholarships', 'sources'] as const) {
      expect(released[collection].slice(0, original[collection].length)).toEqual(original[collection])
    }
    expect(released.programs.length - original.programs.length).toBe(5)
    expect(released.admissionCycles.length - original.admissionCycles.length).toBe(5)
    expect(released.sources.length - original.sources.length).toBe(4)
    expect(ids.every(id => original.programs.every(program => program.id !== id))).toBe(true)
    for (const [id, hash] of Object.entries(review.baseline.preservedExistingSchoolRecordHashes)) {
      expect(createHash('sha256').update(canonicalIdentityJson(bundle.programs.find(p => p.id === id))).digest('hex')).toBe(hash)
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => ids.includes(p.id)).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
    const coverage = await buildProgramCoverage(bundle, readMaintenanceScope(process.cwd()), day,
      readIdentityAcceptances(undefined, { strictProjection: true }), readFieldVerifications())
    expect(coverage.schools.find(row => row.universityId === school)).toMatchObject({ gap: 0, countedProgramIds: expect.arrayContaining(ids) })
  })

  it('keeps the exact 2027 Chinese track, semester tuition, HSK exemption and separate payment dates', () => {
    for (const id of ids) {
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: evidence.officialName, degreeLevel: 'master', teachingLanguages: ['Chinese'], durationMonths: 24 })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', opensOn: '2026-12-01', closesOn: '2027-05-31',
        tuitionCny: evidence.tuitionCnyPerSemester, tuitionPeriod: 'semester', tuitionStatus: 'confirmed', applicationFeeCny: 830, applyUrl: 'https://ao.sufe.edu.cn/' })
      expect(c.languageRequirements).toEqual([{ test: 'HSK', minimum: 'HSK Level 5, 180 points. Results are valid for two years from the test date. A university-issued certificate confirming a Chinese-taught bachelor’s programme may replace the HSK certificate.' }])
      expect(JSON.stringify(c.languageRequirements)).not.toMatch(/IELTS|TOEFL|Duolingo|HSKK|CSCA/u)
      expect(c.notes?.en).toContain('or its equivalent')
      expect(c.notes?.zh).toContain('不自动判断资格')
      expect(c.notes?.zh).toContain('本校应届毕业生')
      expect(c.notes?.zh).toContain('2027年6月20日')
      expect(c.notes?.zh).toContain('2027年7月15日23:59')
      expect(JSON.stringify(c.eligibility)).toContain('18 to 45 inclusive')
      expect(JSON.stringify(c.applicationMaterials)).toContain('2028年1月31日')
      expect(JSON.stringify(c.applicationMaterials)).toContain('计划申请奖学金者必须提交')
    }
    expect(new Set(ids.map(id => bundle.programs.find(p => p.id === id)!.name.zh)).size).toBe(5)
  })

  it('validates all 65 strict leaves against four immutable archives and rejects year, language and source changes', async () => {
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
    expect(validateFieldVerification(bundle, { ...first, verifiedAt: '2026-11-24T00:00:00Z' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd(), day)).integrityPassed).toBe(true)
  }, 30000)

  it('holds core eligibility if annual language, qualification, application route or deadline is missing', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const p = projected.programs.find(p => p.id === id)!, c = projected.admissionCycles.find(c => c.programId === id)!
    expect(hasDetailedPublicProgram(p, [c], day)).toBe(true)
    for (const change of [{ eligibility: [] }, { languageRequirements: [] }, { applyUrl: null }, { closesOn: null }]) {
      expect(hasDetailedPublicProgram(p, [{ ...c, ...change }], day)).toBe(false)
    }
  })
})
