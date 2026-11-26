import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/xjtu-master-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/xjtu-master-five-reviewed-20261126/archive-receipt.json'
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
import { studentMatchCatalog } from '@/lib/student-matching-data'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-26', school = 'uni-xian-jiaotong-university'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/xjtu-master-five-reviewed-20261126/field-receipt.json'

describe('five 2027 English engineering masters at XJTU', () => {
  it('links five genuine master identities to the archived zero-coverage baseline', async () => {
    const before = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(await catalogSha256(before)).toBe(review.inputCatalogSha256)
    expect(review.baseline.coverage).toMatchObject({ currentProgramCount: 0, rawProgramCount: 7 })
    expect(ids).toHaveLength(5)
    const previousSchoolPrograms = before.programs.filter(p => p.universityId === school)
    expect(previousSchoolPrograms).toHaveLength(7)
    expect(previousSchoolPrograms.every(p => p.degreeLevel !== 'master')).toBe(true)
    expect(before.programs.some(p => ids.includes(p.id))).toBe(false)
    for (const p of previousSchoolPrograms) {
      expect(bundle.programs.some(current => current.id === p.id && current.universityId === school)).toBe(true)
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => ids.includes(p.id)).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
    const coverage = await buildProgramCoverage(bundle, readMaintenanceScope(process.cwd()), day,
      readIdentityAcceptances(undefined, { strictProjection: true }), readFieldVerifications())
    const schoolCoverage = coverage.schools.find(s => s.universityId === school)
    expect(schoolCoverage?.currentProgramCount).toBeGreaterThanOrEqual(5)
    expect(schoolCoverage?.gap).toBe(0)
  })

  it('distinguishes the two-year master table from the adjacent doctorate table and preserves the self-funded annual scope', () => {
    expect(review.annualYearEvidence.quote).toContain('2027 International Student Admission Program List（Master)')
    expect(review.scopeDecisions.yearNotInferredFromDeadline).toBe(true)
    for (const id of ids) {
      const e = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      expect(e.enTableIndex).toBe(2)
      expect(e.enCells.slice(4)).toEqual(['English', '2', 'Master of Engineering', 'Academic', 'Yes'])
      expect(e.cnCells.slice(4)).toEqual(['英文', '2', '工学硕士', '学术型', '是'])
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: e.name, degreeLevel: 'master', teachingLanguages: ['English'], durationMonths: 24 })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'English', applicationRound: 'Self-funded Program',
        opensOn: null, closesOn: '2027-05-15', dateStatus: 'published', tuitionCny: 39000, tuitionPeriod: 'academic-year', applicationFeeCny: 500,
        applyUrl: 'https://isso.xjtu.edu.cn/recruit/login' })
      expect(getApplicationState(c, day)).toBe('dates-published')
      expect(c.notes?.en).toContain('17:00 Beijing time')
      expect(c.notes?.en).toContain('separate registration fee is CNY400')
      expect(c.notes?.en).toContain('31 March 2027')
      expect(c.notes?.en).toContain('not applied here')
      expect(c.notes?.en).toContain('mandatory supervisor acceptance')
    }
    const first = review.programmeEvidence[ids[0] as keyof typeof review.programmeEvidence]
    const third = review.programmeEvidence[ids[2] as keyof typeof review.programmeEvidence]
    expect(first.enCells[1]).toBe('School of Energy and Power Engineering')
    expect(third.enCells[1]).toBe(first.enCells[1])
    expect(third.inheritedCells[1]).toMatchObject({ originRow: 2, rowspan: 3 })
  })

  it('keeps bilingual age/count differences out of eligibility matching and does not turn alternative English proofs into cumulative tests', () => {
    const directory = getPublicCatalogSnapshot(bundle, day).directory
    const matches = studentMatchCatalog(directory, 'en', day).filter(r => ids.includes(r.id))
    expect(matches).toHaveLength(5)
    for (const id of ids) {
      const c = directory.admissionCycles.find(c => c.programId === id)!
      expect(c.languageRequirements).toHaveLength(1)
      const language = c.languageRequirements![0].minimum!
      expect(language).toMatch(/IELTS at least 6\.0 OR TOEFL at least 80 OR Duolingo at least 110 OR/u)
      expect(language).not.toMatch(/HSK4|HSK5|IELTS.*7\.0|CSCA/u)
      expect(c.notes?.en).toContain('under 35')
      expect(c.notes?.zh).toContain('不超过35周岁')
      expect(c.notes?.en).toContain('minimum of 1000 words')
      expect(c.notes?.zh).toContain('硕士不少于1000字')
      expect(JSON.stringify(c.eligibility)).not.toMatch(/35|1000|age|年龄|不超过/u)
      const match = matches.find(r => r.id === id)!
      expect(match.education?.value.join(' ')).not.toMatch(/35|1000|age|年龄/u)
      expect(match.budget?.value).toBe(39000)
      expect(match.languageConditions?.value.join(' ')).toContain('Meet ONE English-proof option')
    }
  })

  it('binds all 70 accepted fields to three immutable byte-verified sources and rejects changes in year, track, round or authority', async () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(70)
    expect(fields.some(f => f.fieldPath === 'opensOn')).toBe(false)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(3)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(a => a.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'languageRequirements')!
    for (const route of fields.filter(f => f.fieldPath === 'applyUrl')) {
      expect(route.sourceUrl).toBe(route.value)
      expect(route.sourceUrl).toBe('https://isso.xjtu.edu.cn/recruit/login')
      expect(route.quote).toContain('Application & Admission System for International Student')
    }
    expect(first.sourceUrl).toBe('https://sie.xjtu.edu.cn/info/1224/5682.htm')
    expect(first.quote).toContain('雅思6.0分或托福80分或多邻国110分及以上')
    for (const change of [{ academicYear: '2027-2028' }, { academicYear: '2028' }, { teachingLanguage: 'Chinese' }, { applicationRound: 'Scholarship Program' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
    expect(validateFieldVerification(bundle, { ...first, sourceUrl: 'https://example.org/copied-guide' }, day)).toBeUndefined()
    const projected = getPublicCatalogSnapshot(bundle, day).directory
    const p = projected.programs.find(p => p.id === ids[0])!, c = projected.admissionCycles.find(c => c.programId === ids[0])!
    for (const change of [{ eligibility: [] }, { languageRequirements: [] }, { applyUrl: null }, { closesOn: null }]) {
      expect(hasDetailedPublicProgram(p, [{ ...c, ...change }], day)).toBe(false)
    }
    expect((await validateDirectory(process.cwd(), getTodayDate())).integrityPassed).toBe(true)
  }, 30000)
})
