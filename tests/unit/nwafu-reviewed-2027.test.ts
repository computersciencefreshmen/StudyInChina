import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-nwafu-2027-20261117/review.json'
import receipt from '../../quality/maintenance/batches/reviewed-nwafu-2027-20261117/identity-receipt.json'
import nenu from '../../quality/reviewed-nenu-2027-20261116/review.json'
import xmu from '../../quality/maintenance/batches/reviewed-xmu-2027-20261117/review.json'
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
const UNIVERSITY = 'uni-northwest-a-and-f-university'
const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const textSha = (value: string) => createHash('sha256').update(value).digest('hex')
const programs = review.reviewedPrograms.map(row => programSchema.parse(row))
const cycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
const ids = new Set(programs.map(row => row.id))
const cycleIds = new Set(cycles.map(row => row.id))

function singleProgrammeFixture() {
  const data = loadMaintenanceBundle(process.cwd())
  data.programs = [structuredClone(programs[0])]
  data.admissionCycles = [structuredClone(cycles[0])]
  data.scholarships = []
  return data
}

describe('NWAFU 2027 independently reviewed Chinese bachelor core', () => {
  it('verifies the immutable review and exact scoped identity receipts using the real strict directory validator', async () => {
    const { sha256: reviewSha, ...reviewContent } = review
    const { sha256: receiptSha, ...receiptContent } = receipt
    expect(sha(reviewContent)).toBe(reviewSha)
    expect(sha(receiptContent)).toBe(receiptSha)
    expect(receipt.reviewSha256).toBe(reviewSha)
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of personal human sign-off')
    expect(review.modelCalls).toBe(false)
    expect(review.cloudWrites).toBe(0)
    expect(review.privateUploads).toBe(0)
    expect(review.audit.originalXlsxCommitted).toBe(false)
    const identities = readIdentityAcceptances(undefined, { strictProjection: true }).filter(row => ids.has(row.recordId))
    expect(identities).toHaveLength(5)
    for (const entry of identities) {
      const program = programs.find(row => row.id === entry.recordId)!
      expect(entry.identitySha256).toBe(identityFingerprint('program', program))
      expect(entry.receiptPath).toBe('quality/maintenance/batches/reviewed-nwafu-2027-20261117/identity-receipt.json')
      expect(entry.verifiedName).toEqual(program.name)
      expect(scopedNameReceiptMatches(entry, receipt)).toBe(true)
      const changedScope = { ...entry, verifiedName: { en: 'Unreviewed major' } }
      expect(scopedNameReceiptMatches(changedScope, receipt)).toBe(false)
    }
    for (const row of programs) expect(sha(row)).toBe(review.afterProgrammeSha256[row.id as keyof typeof review.afterProgrammeSha256])
    for (const row of cycles) expect(sha(row)).toBe(review.newCycleSha256[row.id as keyof typeof review.newCycleSha256])
    expect(await validateDirectory(process.cwd())).toMatchObject({ integrityPassed: true, cohortSchools: 272 })
  }, 20_000)

  it('binds five genuinely new bilingual identities to exact official HTML rows and XLSX cells, leaving the sixth candidate private', () => {
    expect(programs.map(row => row.name.zh)).toEqual(['汉语国际教育', '数据科学与大数据技术', '计算机科学与技术', '工商管理', '农业水利工程'])
    expect(programs.map(row => row.name.en)).toEqual(['Teaching Chinese to Speakers of Other Languages', 'Data Science and Big Data Technology',
      'Computer Science and Technology', 'Business Administration', 'Agricultural Water Conservancy Engineering'])
    expect(new Set(programs.map(row => row.id)).size).toBe(5)
    expect(review.programmeRows).toHaveLength(5)
    expect(review.programmeRows.map(row => row.xlsxEvidence.range)).toEqual(['A3:F3', 'A4:F4', 'A5:F5', 'A6:F6', 'A7:F7'])
    for (const row of review.programmeRows) {
      expect(row.durationMonths).toBe(48)
      expect(row.teachingLanguages).toEqual(['Chinese'])
      expect(row.officialProgramCode).toBeNull()
      expect(row.xlsxEvidence.yearEvidenceCell).toBe('A1')
      expect(row.xlsxEvidence.sharedLanguageEvidenceRange).toBe('A9:F9')
      expect(row.htmlEvidence.exactCellTexts).toHaveLength(6)
      expect(row.existingExactIds).toEqual([])
    }
    expect(review.identityDedupe.map(row => row.existingBachelorCount)).toEqual([0, 0])
    expect(review.identityDedupe.map(row => row.existingProgrammeCount)).toEqual([3, 3])
    expect(review.audit.additionalVeterinaryMajorKeptPrivateOnly).toBe(true)
    expect(programs.some(row => row.name.zh === '动物医学')).toBe(false)
    expect(review.sources.find(row => row.url.endsWith('.xlsx'))!.rawSha256).toBe('b6e76820f7bf731fc997d8edd285bfa3f461be9553a11f11962963bdb264f562')
    expect(review.sources.find(row => row.url.endsWith('.htm'))!.rawSha256).toBe('d1d4ce45b433833bd1420fa558d5dc5aa421e3113d6dad2c65f8dae0c32604f8')
    for (const evidence of review.commonPolicy.allEvidence) {
      expect(textSha(evidence.quote)).toBe(evidence.quoteSha256)
      const source = review.sources.find(row => row.id === evidence.sourceId)!
      expect(source.url).toBe(evidence.url)
      expect(source.rawSha256).toBe(evidence.rawSha256)
    }
    for (const row of review.programmeRows) {
      for (const evidence of [row.xlsxEvidence, row.htmlEvidence]) {
        const source = review.sources.find(source => source.id === evidence.sourceId)!
        expect(source.url).toBe(evidence.url)
        expect(source.rawSha256).toBe(evidence.rawSha256)
      }
    }
    expect(new URL(review.sourceChain.exactCatalogueAnchor.attributes.href, review.sourceChain.guideUrl).href).toBe(review.sourceChain.programmeCatalogueUrl)
  })

  it('preserves the source-only year, unknown HSK score and age date, conditional waiver and per-major CSCA requirements', () => {
    expect(review.commonPolicy.ageMaximum).toBe(25)
    expect(review.commonPolicy.timeZoneExplicitlyStated).toBe(false)
    expect(review.commonPolicy.maximumAgeReferenceDateExplicitlyStated).toBe(false)
    expect(review.academicYearRangeNotInferred).toBe(true)
    for (const [index, cycle] of cycles.entries()) {
      expect(cycle).toMatchObject({ academicYear: '2027', intake: 'other', teachingLanguage: 'Chinese', applicationRound: 'self-funded',
        opensOn: '2026-11-01', closesOn: '2027-05-31', tuitionCny: 18000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed',
        applicationFeeCny: 400, applyUrl: 'https://nwsuaf.17gz.org/', evidenceBasis: 'cycle-specific', factScope: 'partial' })
      expect(getApplicationState(cycle, TODAY)).toBe('open')
      const requirement = cycle.languageRequirements![0]
      expect(requirement.test).toBe('HSK')
      expect(requirement.minimum).toContain('4级')
      expect(requirement.minimum).toContain('未公布数值最低分')
      expect(requirement.minimum).toContain('初中和高中')
      expect(requirement.minimum).toContain('申请免试')
      expect(requirement.minimum).not.toMatch(/180|210/u)
      const conditions = cycle.eligibility!.map(row => row.zh).join(' ')
      expect(conditions).toContain('不超过25周岁')
      expect(conditions).toContain('未说明此年龄上限的计算日期')
      expect(conditions).toContain('2027年9月1日未满18周岁')
      expect(conditions).toContain('2023年4月30日至2027年4月30日')
      expect(conditions).toContain(review.programmeRows[index].cscaSubjects.zh)
      expect(conditions).toContain('汉语言本科专业的HSK4免考专业中文例外不移用于本专业')
      expect(fieldRecordScopeSha256('admissionCycle', cycle)).toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
      expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, applicationRound: 'scholarship' })).not.toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
    }
    expect(cycles[0].eligibility!.at(-1)!.zh).toContain('中文(文)、数学')
    expect(cycles[1].eligibility!.at(-1)!.zh).toContain('中文（理）、数学、物理')
  })

  it('passes the actual public v2 gate for five new programmes and preserves all reviewed NENU and XMU objects', () => {
    const bundle = loadMaintenanceBundle(process.cwd()), snapshot = getPublicCatalogSnapshot(bundle, TODAY)
    for (const projected of [snapshot.current, snapshot.directory]) {
      expect(projected.programs.filter(row => row.universityId === UNIVERSITY).map(row => row.id).sort()).toEqual([...ids].sort())
      expect(projected.admissionCycles.filter(row => cycleIds.has(row.id))).toHaveLength(5)
      for (const prior of [nenu, xmu]) expect(projected.programs.filter(row => prior.reviewedPrograms.some(old => old.id === row.id))).toHaveLength(5)
    }
    expect(snapshot.directory.programs.length).toBeGreaterThanOrEqual(15)
    for (const prior of [nenu, xmu]) {
      for (const row of prior.reviewedPrograms) expect(bundle.programs.find(current => current.id === row.id)).toEqual(row)
      for (const row of prior.reviewedAdmissionCycles) expect(bundle.admissionCycles.find(current => current.id === row.id)).toEqual(row)
    }
    expect(review.audit.existingRecordsChanged).toEqual([])
    expect(review.audit.existingNonemptyFieldsChanged).toEqual([])
  })

  it.each(['missing-language-requirement', 'missing-eligibility', 'missing-route', 'missing-duration', 'closed', 'expired-review', 'wrong-language', 'wrong-year', 'wrong-programme'])(
    'independently withholds %s without changing the raw identity', failure => {
      const raw = singleProgrammeFixture(), program = raw.programs[0], cycle = raw.admissionCycles[0]
      if (failure === 'missing-language-requirement') delete cycle.languageRequirements
      if (failure === 'missing-eligibility') delete cycle.eligibility
      if (failure === 'missing-route') delete cycle.applyUrl
      if (failure === 'missing-duration') program.durationMonths = null
      if (failure === 'closed') cycle.closesOn = '2026-11-16'
      if (failure === 'expired-review') cycle.reviewAfter = '2026-11-16'
      if (failure === 'wrong-language') cycle.teachingLanguage = 'English'
      if (failure === 'wrong-year') cycle.academicYear = '2025'
      if (failure === 'wrong-programme') cycle.programId = programs[1].id
      expect(hasDetailedPublicProgram(program, [cycle], TODAY)).toBe(false)
      const before = JSON.stringify(raw)
      const discovery = selectDiscoveryData(raw, TODAY, readIdentityAcceptances())
      expect(selectDetailedPublicPrograms(discovery, TODAY).programs).toEqual([])
      expect(raw.programs).toHaveLength(1)
      expect(JSON.stringify(raw)).toBe(before)
    })

  it('does not combine conditions from different rounds or restore expired facts from preserved identity receipts', () => {
    const raw = singleProgrammeFixture(), first = raw.admissionCycles[0]
    const second = { ...structuredClone(first), id: `${first.id}-sibling`, applicationRound: 'scholarship' }
    delete first.eligibility
    delete second.languageRequirements
    raw.admissionCycles.push(second)
    expect(hasDetailedPublicProgram(raw.programs[0], raw.admissionCycles, TODAY)).toBe(false)
    const full = singleProgrammeFixture(), afterExpiry = '2026-12-18'
    const directory = selectDiscoveryData(full, afterExpiry, readIdentityAcceptances())
    expect(directory.programs).toHaveLength(1)
    expect(directory.programs[0].durationMonths).toBeNull()
    expect(selectDetailedPublicPrograms(directory, afterExpiry).programs).toEqual([])
    expect(full.programs).toHaveLength(1)
  })
})
