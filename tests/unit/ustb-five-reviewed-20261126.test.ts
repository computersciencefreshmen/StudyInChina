import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/ustb-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/ustb-five-reviewed-20261126/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { buildProgramCoverage } from '@/lib/data/school-program-coverage'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'
import { getApplicationState } from '@/lib/data/admission'
import { studentMatchCatalog } from '@/lib/student-matching-data'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'

const day = '2026-11-26', school = 'uni-university-of-science-and-technology-beijing'
const bundle = loadMaintenanceBundle(process.cwd()), ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/ustb-five-reviewed-20261126/field-receipt.json'

describe('five 2027 Chinese master routes at USTB', () => {
  it('adds five concrete master identities without refreshing any of the four existing bachelor records', async () => {
    const before = reviewedCatalogueAt(review.baseline.gitCommit)
    expect(await catalogSha256(before)).toBe(review.inputCatalogSha256)
    expect(review.baseline.coverage).toMatchObject({ currentProgramCount: 0, rawProgramCount: 4 })
    expect(ids).toHaveLength(5)
    expect(before.programs.filter(p => p.universityId === school).every(p => p.degreeLevel === 'bachelor')).toBe(true)
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

  it('keeps the general 2–3 year range and does not invent a precise duration, full-time status or named award', () => {
    expect(review.annualYearEvidence.quote).toBe('2027年国际硕士研究生专业目录')
    expect(review.commonEvidence.duration.quote).toContain('一般为2-3年')
    expect(review.commonEvidence.durationEN.quote).toContain('2-3 years')
    expect(review.scopeDecisions.yearNotInferredFromDeadline).toBe(true)
    for (const id of ids) {
      const e = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      expect(e.literal).toBe(e.name.zh + '（中文、英文授课项目）')
      expect(e.englishNameProof.quote).toContain('Master:')
      expect(e.englishNameProof.quote).toContain(e.name.en)
      const p = bundle.programs.find(p => p.id === id)!, c = bundle.admissionCycles.find(c => c.programId === id)!
      expect(p).toMatchObject({ name: e.name, degreeLevel: 'master', teachingLanguages: ['Chinese'], durationMonths: 24, durationMonthsMax: 36 })
      expect(p.durationText?.en).toContain('Generally 2–3 years')
      expect(p.durationText?.zh).toContain('一般为2–3年')
      expect(p.supplementaryDetails?.qualification).toEqual({ en: 'Master’s degree', zh: '硕士学位' })
      expect(c).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', applicationRound: 'General graduate admission',
        opensOn: '2026-11-01', closesOn: '2027-06-15', dateStatus: 'published', tuitionCny: 31600, tuitionPeriod: 'academic-year', applicationFeeCny: 600,
        applyUrl: 'https://onlineapply.ustb.edu.cn/' })
      expect(getApplicationState(c, day)).toBe('open')
      expect(c.notes?.en).toContain('no full-time label')
      expect(c.notes?.en).toContain('generally in early September')
    }
  })

  it('preserves unresolved age and statement wording in notes while matching only confirmed common conditions', () => {
    const directory = getPublicCatalogSnapshot(bundle, day).directory
    const matches = studentMatchCatalog(directory, 'en', day).filter(r => ids.includes(r.id))
    expect(matches).toHaveLength(5)
    for (const id of ids) {
      const c = directory.admissionCycles.find(c => c.programId === id)!
      expect(c.languageRequirements).toHaveLength(1)
      expect(c.languageRequirements![0]).toMatchObject({ test: 'HSK' })
      expect(c.languageRequirements![0].minimum).toContain('Pass HSK Level 5')
      expect(c.languageRequirements![0].minimum).not.toMatch(/180|200|210|IELTS|TOEFL/u)
      expect(c.notes?.en).toContain('Under the age of 40')
      expect(c.notes?.zh).toContain('一般40周岁（含）以下')
      expect(c.notes?.en).toContain('At least 1,000 words')
      expect(c.notes?.zh).toContain('硕士1000字以上')
      expect(JSON.stringify(c.eligibility)).not.toMatch(/40|1000|age|年龄/u)
      const match = matches.find(r => r.id === id)!
      expect(match.education?.value.join(' ')).not.toMatch(/40|1000|age|年龄/u)
      expect(match.budget?.value).toBe(31600)
      expect(JSON.stringify(c.applicationMaterials)).toContain('optional')
      expect(JSON.stringify(c.applicationMaterials)).not.toMatch(/six months|six-month|两年|六个月/u)
    }
  })

  it('binds both range endpoints and all 85 fields to five archived originals, rejecting changed scope or authority', () => {
    const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
    expect(fields).toHaveLength(85)
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(5)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(a => a.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
    }
    for (const id of ids) {
      const ends = fields.filter(f => f.recordId === id && ['durationMonths', 'durationMonthsMax', 'durationText'].includes(f.fieldPath))
      expect(ends).toHaveLength(3)
      expect(ends.every(f => f.quote.includes('一般为2-3年'))).toBe(true)
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'languageRequirements')!
    for (const route of fields.filter(f => f.fieldPath === 'applyUrl')) {
      expect(route.sourceUrl).toBe(route.value)
      expect(route.quote).toContain('在线申请 Online Application')
    }
    for (const change of [{ academicYear: '2027-2028' }, { academicYear: '2028' }, { teachingLanguage: 'English' }, { applicationRound: 'Scholarship Program' }]) {
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
  }, 60000)
})
