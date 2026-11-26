import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/nuist-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/nuist-five-reviewed-20261126/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { buildProgramCoverage } from '@/lib/data/school-program-coverage'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { getApplicationState } from '@/lib/data/admission'
import { getTodayDate } from '@/lib/data/freshness'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-26', school = 'uni-nanjing-university-of-information-science-and-technology'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/nuist-five-reviewed-20261126/field-receipt.json'

describe('five 2027 Chinese-only self-funded NUIST master programmes', () => {
  it('links five distinct masters to their archived zero-coverage baseline', async () => {
    const original = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    expect(review.baseline.coverage).toMatchObject({ currentProgramCount: 0, rawProgramCount: 6 })
    expect(ids).toHaveLength(5)
    expect(original.programs.some(program => ids.includes(program.id))).toBe(false)
    for (const [id, hash] of Object.entries(review.baseline.preservedExistingSchoolRecordHashes)) {
      expect(createHash('sha256').update(canonicalIdentityJson(original.programs.find(p => p.id === id))).digest('hex')).toBe(hash)
      expect(bundle.programs.some(program => program.id === id && program.universityId === school)).toBe(true)
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => ids.includes(p.id)).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
    const coverage = await buildProgramCoverage(bundle, readMaintenanceScope(process.cwd()), day,
      readIdentityAcceptances(undefined, { strictProjection: true }), readFieldVerifications())
    const schoolCoverage = coverage.schools.find(row => row.universityId === school)
    expect(schoolCoverage?.currentProgramCount).toBeGreaterThanOrEqual(5)
    expect(schoolCoverage?.gap).toBe(0)
  })

  it('uses five single-language three-year PDF rows and a literal 2027 year independently of its deadline', () => {
    expect(review.annualYearEvidence.quote).toContain("2027 Master's Degree Programs")
    expect(review.scopeDecisions.yearNotInferredFromDeadline).toBe(true)
    for (const id of ids) {
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: evidence.reviewedDisplayName, degreeLevel: 'master', teachingLanguages: ['Chinese'], durationMonths: 36 })
      expect(evidence.tableCells.slice(3)).toEqual(['September', '3', 'Chinese', '20000'])
      expect(evidence.asterisk).toBe(false)
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', opensOn: null, closesOn: '2027-04-30',
        dateStatus: 'published', tuitionCny: 20000, tuitionPeriod: 'academic-year', applicationFeeCny: 500, applyUrl: 'https://nuist.17gz.org/member/login.do' })
      expect(getApplicationState(c, day)).toBe('dates-published')
      expect(c.languageRequirements).toEqual([{ test: 'HSK', minimum: 'HSK Band 5 or above. The reviewed Chinese-taught master’s requirements do not state a minimum numerical score, test-result validity period or exemption.' }])
      expect(JSON.stringify(c.languageRequirements)).not.toMatch(/180|210|IELTS|TOEFL|Duolingo|CSCA/u)
      expect(JSON.stringify(c.eligibility)).toContain('under the age of 35')
      expect(JSON.stringify(c.eligibility)).not.toMatch(/GPA|3\.0|80分/u)
      expect(c.notes?.zh).toContain('不承诺当前已经开放')
    }
  })

  it('strictly binds all 60 known leaves and seven actual archive readbacks without fabricating a known null opening date', async () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(60)
    expect(fields.some(f => f.fieldPath === 'opensOn')).toBe(false)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(7)
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
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'Longshan' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/copy' }, day)).toBeUndefined()
    expect((await validateDirectory(process.cwd(), getTodayDate())).integrityPassed).toBe(true)
  }, 30000)

  it('withholds detailed status if any annual core condition, route or concrete deadline is missing', () => {
    const projected = getPublicCatalogSnapshot(bundle, day).directory, id = ids[0]
    const p = projected.programs.find(p => p.id === id)!, c = projected.admissionCycles.find(c => c.programId === id)!
    expect(hasDetailedPublicProgram(p, [c], day)).toBe(true)
    for (const change of [{ eligibility: [] }, { languageRequirements: [] }, { applyUrl: null }, { closesOn: null }]) {
      expect(hasDetailedPublicProgram(p, [{ ...c, ...change }], day)).toBe(false)
    }
  })
})
