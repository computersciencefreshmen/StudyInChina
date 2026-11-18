import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-xmu-2027-20261117/review.json'
import receipt from '../../quality/maintenance/batches/reviewed-xmu-2027-20261117/identity-receipt.json'
import nenu from '../../quality/reviewed-nenu-2027-20261116/review.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { canonicalIdentityJson, identityFingerprint, scopedNameReceiptMatches } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { fieldRecordScopeSha256 } from '@/lib/data/field-verification'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { hasDetailedPublicProgram, selectDetailedPublicPrograms } from '@/lib/data/public-program-quality'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { getApplicationState } from '@/lib/data/admission'
import { admissionCycleSchema, programSchema } from '@/lib/data/schema'

const TODAY = '2026-11-17'
const UNIVERSITY = 'uni-xiamen-university'
const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const textSha = (value: string) => createHash('sha256').update(value).digest('hex')
const programs = review.reviewedPrograms.map(row => programSchema.parse(row))
const cycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
const ids = new Set(programs.map(row => row.id))
const cycleIds = new Set(cycles.map(row => row.id))

describe('XMU 2027 independently reviewed Chinese economics core', () => {
  it('binds source/tool/visual review, immutable payload and the existing traced receipt layout', async () => {
    const { sha256: reviewSha, ...reviewContent } = review
    const { sha256: receiptSha, ...receiptContent } = receipt
    expect(sha(reviewContent)).toBe(reviewSha)
    expect(sha(receiptContent)).toBe(receiptSha)
    expect(receipt.reviewSha256).toBe(reviewSha)
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of personal human sign-off')
    expect(review.modelCalls).toBe(false)
    expect(review.cloudWrites).toBe(0)
    expect(review.academicYearRangeNotInferred).toBe(true)
    const identities = readIdentityAcceptances(undefined, { strictProjection: true }).filter(row => ids.has(row.recordId))
    expect(identities).toHaveLength(5)
    for (const identity of identities) {
      const program = programs.find(row => row.id === identity.recordId)!
      expect(identity.receiptPath).toBe('quality/maintenance/batches/reviewed-xmu-2027-20261117/identity-receipt.json')
      expect(identity.identitySha256).toBe(identityFingerprint('program', program))
      expect(identity.verifiedName).toEqual({ zh: program.name.zh })
      expect(scopedNameReceiptMatches(identity, receipt)).toBe(true)
    }
    for (const row of programs) expect(sha(row)).toBe(review.afterProgrammeSha256[row.id as keyof typeof review.afterProgrammeSha256])
    for (const row of cycles) expect(sha(row)).toBe(review.newCycleSha256[row.id as keyof typeof review.newCycleSha256])
    expect(await validateDirectory(process.cwd())).toMatchObject({ integrityPassed: true, cohortSchools: 272 })
  }, 20_000)

  it('proves the five original rows and shared cells without inventing English names or relabeling English tracks', () => {
    expect(review.programmeRows.map(row => [row.officialRowNumber, row.officialProgramCode, row.verifiedName.zh])).toEqual([
      [8, '020201K', '财政学'], [9, '020202', '税收学'], [10, '020401', '国际经济与贸易'],
      [11, '020302', '金融工程'], [12, '020301K', '金融学'],
    ])
    for (const row of review.programmeRows) {
      expect(row).toMatchObject({ school: '经济学院', degreeLabel: '本科', teachingLanguageLabel: '汉语', durationYears: 4, studyModeLabel: '全日制' })
      for (const index of [1, 2, 3, 7, 8, 9]) expect(row.originCells[index]).toMatchObject({ originRowIndex: 8, rowspan: 6 })
    }
    expect(programs).toHaveLength(5)
    expect(new Set(programs.map(row => row.id)).size).toBe(5)
    for (const row of programs) expect(Object.keys(row.name)).toEqual(['zh'])
    expect(review.identityDedupe.map(row => row.programmeCount)).toEqual([2302, 2302])
    for (const scope of review.identityDedupe) {
      for (const row of scope.matches) expect(row.existingExactIds).toEqual([])
      expect(scope.existingXmuBa.filter(row => row.teachingLanguages.includes('English'))).toHaveLength(4)
    }
    for (const evidence of review.commonPolicy.allEvidence) expect(textSha(evidence.quote)).toBe(evidence.quoteSha256)
    expect(review.sources.find(row => row.url.endsWith('/CN_BA.htm'))!.rawSha256).toBe('fc5852dcdb41d9e5e8f13c61f1f38e2a55a50e66623a7453e1926b9a47779c5a')
    expect(review.sources.find(row => row.url.endsWith('/2036.htm'))!.rawSha256).toBe('0640b24ecc86004e9cea70bef223f45ffee2510d63e2e7df3095dd84efeadf13')
  })

  it('keeps literal 2027, the self-funded schedule, annual economics fee class and HSK5 score 210', () => {
    for (const cycle of cycles) {
      expect(cycle).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', applicationRound: 'self-funded',
        opensOn: '2026-12-01', closesOn: '2027-05-31', tuitionCny: 26000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed',
        applicationFeeCny: 400, applyUrl: 'https://application.xmu.edu.cn/', evidenceBasis: 'cycle-specific', factScope: 'partial' })
      expect(getApplicationState(cycle, TODAY)).toBe('upcoming')
      expect(cycle.languageRequirements).toHaveLength(1)
      expect(cycle.languageRequirements![0]).toMatchObject({ test: 'HSK' })
      expect(cycle.languageRequirements![0].minimum).toContain('5级210分')
      expect(cycle.languageRequirements![0].minimum).not.toContain('180')
      expect(cycle.languageRequirements![0].minimum).toContain('UEC')
      const conditions = cycle.eligibility!.map(row => row.zh).join(' ')
      expect(conditions).toContain('18–30周岁')
      expect(conditions).toContain('2027年9月1日')
      expect(conditions).toContain('高中毕业')
      expect(conditions).toContain('2027年4月30日')
      expect(conditions).toContain('文科中文和数学')
      expect(cycle.notes!.zh).toContain('北京时间')
      expect(fieldRecordScopeSha256('admissionCycle', cycle)).toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
      expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, applicationRound: 'new-student-scholarship' })).not.toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
    }
    for (const program of programs) expect(program.durationMonths).toBe(48)
  })

  it('adds all five to the actual public v2 directory while preserving the five reviewed NENU programmes', () => {
    const bundle = loadMaintenanceBundle(process.cwd())
    const snapshot = getPublicCatalogSnapshot(bundle, TODAY)
    for (const projected of [snapshot.current, snapshot.directory]) {
      expect(projected.programs.filter(row => row.universityId === UNIVERSITY).map(row => row.id).sort()).toEqual([...ids].sort())
      expect(projected.admissionCycles.filter(row => cycleIds.has(row.id))).toHaveLength(5)
      expect(projected.programs.filter(row => nenu.reviewedPrograms.some(old => old.id === row.id))).toHaveLength(5)
    }
    // Other independently reviewed schools may be added in parallel. This batch
    // must preserve the prior identities, rather than freeze the catalogue size.
    expect(snapshot.directory.programs.length).toBeGreaterThanOrEqual(10)
    for (const before of review.identityDedupe[1].existingXmuBa) {
      const current = bundle.programs.find(row => row.id === before.id)!
      expect(current).toMatchObject(before)
    }
    expect(review.audit.existingRecordsChanged).toEqual([])
    expect(review.audit.existingNonemptyFieldsChanged).toEqual([])
    const rawReceipt = JSON.parse(readFileSync('quality/reviewed-nenu-2027-20261116/identity-receipt.json', 'utf8'))
    expect(rawReceipt.sha256).toBe('51ff260fb2add36aa61e796445c410f52d048bb999734b2f16377f64ade7d150')
  })

  it.each(['wrong-language', 'closed', 'old-year', 'missing-conditions', 'missing-route'])(
    'withholds a tampered %s annual scope without borrowing siblings or deleting raw identities', failure => {
      const program = structuredClone(programs[0]), cycle = structuredClone(cycles[0])
      if (failure === 'wrong-language') cycle.teachingLanguage = 'English'
      if (failure === 'closed') cycle.closesOn = '2026-11-16'
      if (failure === 'old-year') cycle.academicYear = '2025'
      if (failure === 'missing-conditions') delete cycle.eligibility
      if (failure === 'missing-route') delete cycle.applyUrl
      expect(hasDetailedPublicProgram(program, [cycle], TODAY)).toBe(false)
      const raw = loadMaintenanceBundle(process.cwd())
      raw.programs = [program]; raw.admissionCycles = [cycle]; raw.scholarships = []
      const projected = selectDetailedPublicPrograms(selectDiscoveryData(raw, TODAY, readIdentityAcceptances()), TODAY)
      expect(projected.programs).toEqual([])
      expect(raw.programs).toHaveLength(1)
    })
})
