import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/cupb-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/cupb-five-reviewed-20261126/archive-receipt.json'
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

const day = '2026-11-26', school = 'uni-china-university-of-petroleum-beijing'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/cupb-five-reviewed-20261126/field-receipt.json'

describe('five 2027 Chinese science and engineering masters at CUPB', () => {
  it('preserves every existing record and admits five genuine new master identities from a zero-qualified school', async () => {
    const before = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(await catalogSha256(before)).toBe(review.inputCatalogSha256)
    expect(review.baseline.coverage).toMatchObject({ currentProgramCount: 0, rawProgramCount: 5 })
    expect(ids).toHaveLength(5)
    expect(before.programs.filter(p => p.universityId === school).every(p => p.degreeLevel !== 'master')).toBe(true)
    for (const name of ['programs', 'admissionCycles', 'sources', 'universities', 'cities', 'scholarships'] as const) {
      expect(bundle[name].slice(0, before[name].length)).toEqual(before[name])
    }
    const snapshot = getPublicCatalogSnapshot(bundle, day)
    for (const view of [snapshot.directory, snapshot.current]) {
      expect(view.programs.filter(p => ids.includes(p.id)).map(p => p.id).sort()).toEqual([...ids].sort())
      expect(view.admissionCycles.filter(c => ids.includes(c.programId))).toHaveLength(5)
    }
    const coverage = await buildProgramCoverage(bundle, readMaintenanceScope(process.cwd()), day,
      readIdentityAcceptances(undefined, { strictProjection: true }), readFieldVerifications())
    expect(coverage.schools.find(s => s.universityId === school)).toMatchObject({ currentProgramCount: 5, gap: 0 })
  }, 30000)

  it('uses the Chinese master rows and ordinary September 2027 deadline without inferring an exact opening', () => {
    expect(review.annualYearEvidence.quote).toContain('2027')
    expect(review.commonEvidence.deadline.quote).toContain('May 30, 2027 For September 2027 entry')
    expect(review.scopeDecisions.yearNotInferredFromDeadline).toBe(true)
    for (const id of ids) {
      const e = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      expect(e.nativeEnglishSection).toBe('Master Programs (Taught In Chinese)')
      expect(e.enRowProof.quote).toContain(e.name.en + ' 3 29000')
      expect(e.enRowProof.quote).not.toContain('Taught In English')
      expect(e.cnNameAndMergedLanguageDurationProof.quote).toBe(e.name.zh + ' 中文 3')
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ degreeLevel: 'master', teachingLanguages: ['Chinese'], durationMonths: 36 })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', applicationRound: 'Self-funded master admission',
        opensOn: null, closesOn: '2027-05-30', dateStatus: 'published', tuitionCny: 29000, tuitionPeriod: 'academic-year', applicationFeeCny: 400,
        applyUrl: 'https://admission.cup.edu.cn/' })
      expect(getApplicationState(c, day)).toBe('dates-published')
      expect(c.notes?.en).toContain('exact calendar opening date remains unconfirmed')
      expect(c.notes?.en).toContain('No full-time label')
    }
  })

  it('retains financial proof, the GRE alternative and HSK validity while separating unresolved boundaries and other tracks', () => {
    const directory = getPublicCatalogSnapshot(bundle, day).directory
    const matches = studentMatchCatalog(directory, 'en', day).filter(r => ids.includes(r.id))
    expect(matches).toHaveLength(5)
    for (const id of ids) {
      const c = directory.admissionCycles.find(c => c.programId === id)!
      expect(c.languageRequirements).toHaveLength(1)
      expect(c.languageRequirements![0]).toMatchObject({ test: 'HSK' })
      expect(c.languageRequirements![0].minimum).toContain('at least 180')
      expect(c.languageRequirements![0].minimum).toContain('two years before the application deadline')
      expect(c.languageRequirements![0].minimum).not.toMatch(/IELTS|TOEFL|GMAT/u)
      const materials = JSON.stringify(c.applicationMaterials)
      expect(materials).toContain('CNY53,000')
      expect(materials).toContain('at least one month')
      expect(materials).toContain('notarized locally')
      expect(materials).toContain('Chinese embassy or consulate')
      expect(materials).toContain('after 15 October 2026')
      expect(c.notes?.en).toContain('at least 1,000 words')
      expect(c.notes?.zh).toContain('35周岁以下')
      expect(JSON.stringify(c.eligibility)).not.toMatch(/35|1000|\bage\b|年龄/u)
      expect(JSON.stringify(c.eligibility)).toContain('Verbal plus Quantitative at least 300 AND Analytical Writing at least 3.0')
      expect(JSON.stringify(c.eligibility)).toContain('not applied to these five science/engineering majors')
      const match = matches.find(r => r.id === id)!
      expect(match.education?.value.join(' ')).not.toMatch(/35|1000|\bage\b|年龄/u)
      expect(match.budget?.value).toBe(29000)
    }
  })

  it('binds all 65 accepted fields to archived originals and fails closed for a changed year, route, authority or missing core fact', async () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(65)
    expect(fields.some(f => f.fieldPath === 'opensOn')).toBe(false)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(7)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(a => a.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
    }
    for (const material of fields.filter(f => f.fieldPath === 'applicationMaterials')) {
      expect(material.sourceId).toContain('brochure-cn')
      expect(material.locator).toContain('manual-transcription')
      expect(material.quote).toContain('中文授课项目53000元')
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'languageRequirements')!
    for (const route of fields.filter(f => f.fieldPath === 'applyUrl')) {
      expect(route.sourceUrl).toBe(route.value)
      expect(route.quote).toContain('Online Application')
    }
    for (const change of [{ academicYear: '2027-2028' }, { academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'CSC Type B' }]) {
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
  }, 60000)
})
