import { createHash } from 'node:crypto'
import { reviewedCatalogueAt, reviewedDataAt } from './reviewed-release-snapshot'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-sjtu-2027-20261117/review.json'
import identityReceipt from '../../quality/maintenance/batches/reviewed-sjtu-2027-20261117/identity-receipt.json'
import fieldReceipt from '../../quality/maintenance/batches/reviewed-sjtu-2027-20261117/field-receipt.json'
import cycleReceipt from '../../quality/maintenance/batches/reviewed-sjtu-2027-20261117/cycle-receipt.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { canonicalIdentityJson, identityFingerprint, scopedNameReceiptMatches } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { fieldRecordScopeSha256, fieldVerificationContentSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { getApplicationState, selectAdmissionCycle } from '@/lib/data/admission'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { hasDetailedPublicProgram, selectDetailedPublicPrograms } from '@/lib/data/public-program-quality'
import { admissionCycleSchema, programSchema } from '@/lib/data/schema'

const TODAY = '2026-11-17', UNIVERSITY = 'uni-shanghai-jiao-tong-university'
const hash = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const programs = review.reviewedPrograms.map(row => programSchema.parse(row))
const cycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
const ids = new Set(programs.map(row => row.id)), cycleIds = new Set(cycles.map(row => row.id))
const sourceIds = new Set(review.sources.map(row => row.id))
const raw = () => loadMaintenanceBundle(process.cwd())
const sjtuRelease = 'afe96955e48e608889c759aff5293133fc4f94c4'

describe('SJTU reviewed 2027 direct Chinese bachelor core', () => {
  it('binds the immutable AI-assisted review and standard scoped receipts through strict directory validation', async () => {
    for (const artifact of [review, identityReceipt, fieldReceipt, cycleReceipt]) {
      const { sha256, ...content } = artifact
      expect(hash(content)).toBe(sha256)
    }
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of personal human sign-off')
    expect(review.privateProofHashBasis).toBe('candidate-proof.json original UTF-8 file bytes')
    expect(review.privateProofSha256).toBe('e45d95e9bfebf885fc226b88ca38c17c8f4bd271cd358e35e861b9a9bb5b13ed')
    expect(identityReceipt.reviewSha256).toBe(review.sha256)
    expect(fieldReceipt.batchSha256).toBe(review.sha256)
    expect(cycleReceipt.batchSha256).toBe(review.sha256)
    const identities = readIdentityAcceptances(undefined, { strictProjection: true }).filter(entry => ids.has(entry.recordId))
    expect(identities).toHaveLength(5)
    for (const entry of identities) {
      const program = programs.find(row => row.id === entry.recordId)!
      expect(entry.identitySha256).toBe(identityFingerprint('program', program))
      expect(entry.verifiedName).toEqual(program.name)
      expect(entry.verifiedSourceUrl).toBe(program.programUrl)
      expect(scopedNameReceiptMatches(entry, identityReceipt)).toBe(true)
      expect(scopedNameReceiptMatches({ ...entry, verifiedName: { zh: '未经审阅专业' } }, identityReceipt)).toBe(false)
    }
    expect(await validateDirectory(process.cwd())).toMatchObject({ integrityPassed: true, cohortSchools: 272 })
  }, 30_000)

  it('retains five direct official rows, exact bilingual names and the merged CSCA subjects without inventing scope', () => {
    expect(programs.map(row => row.name.zh)).toEqual(['人工智能', '材料科学与工程', '航空航天工程', '生物医学工程', '智慧能源工程'])
    expect(programs.at(-1)?.name.en).toBe('Smart Energy')
    expect(review.programmeRows.map(row => row.sequence)).toEqual([4, 5, 6, 8, 9])
    expect(review.academicYear).toBe('2027')
    expect(review.academicYearRangeInferred).toBe(false)
    expect(review.applicationRounds).toHaveLength(3)
    for (const row of review.programmeRows) {
      expect(row.starredCluster).toBe(false)
      expect(row.specificMajor).toBe('——')
      expect(row.cscaSubjects).toEqual(['理科中文', '数学'])
      expect(row.cscaMergedSequences).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    }
    for (const program of programs) {
      expect(program).toMatchObject({ degreeLevel: 'bachelor', teachingLanguages: ['Chinese'], durationMonths: 48, verificationScope: 'facts' })
      expect(program.details).toBeUndefined()
      expect(program).not.toHaveProperty('officialProgramCode')
      expect(JSON.stringify(program)).not.toMatch(/BEng|full.time|full_time/u)
      expect(hash(program)).toBe(review.afterProgrammeSha256[program.id as keyof typeof review.afterProgrammeSha256])
    }
    for (const quote of review.evidenceQuotes) {
      expect(createHash('sha256').update(quote.quote).digest('hex')).toBe(quote.quoteSha256)
      expect(review.sources.some(source => source.id === quote.sourceId && source.url === quote.url && source.rawSha256 === quote.rawSha256)).toBe(true)
    }
    expect(review.sourceDifferences.selectedPagesIdentical).toEqual([1, 2, 6])
    expect(review.sourceDifferences.unselectedDiscrepancyPages).toEqual([3])
  })

  it('keeps HSK alternatives, English evidence, conditional prep, guardian, finance and validity requirements in every annual scope', () => {
    expect(cycles).toHaveLength(15)
    for (const cycle of cycles) {
      expect(cycle).toMatchObject({ academicYear: '2027', teachingLanguage: 'Chinese', intake: 'autumn',
        tuitionCny: 50000, tuitionPeriod: 'academic-year', applicationFeeCny: 800, applyUrl: 'https://apply.sjtu.edu.cn/' })
      expect(cycle.applicationRound).toMatch(/^general-admissions-round-[123]$/u)
      expect(cycle.languageRequirements?.map(item => item.test)).toEqual(['HSK', 'other'])
      expect(cycle.languageRequirements?.[0].minimum).toContain('HSK5级200分（含）以上或HSK6级180分（含）以上')
      expect(cycle.languageRequirements?.[0].minimum).toContain('其他同等证明材料')
      const english = cycle.languageRequirements?.[1].minimum ?? ''
      expect(english).toContain('以下至少一项')
      for (const test of ['TOEFL', 'IELTS', 'Duolingo']) expect(english).toContain(test)
      expect(english).not.toMatch(/(?:6\.0|6\.5|80分|90分|120分)/u)
      const conditions = cycle.eligibility!.map(row => row.zh).join(' ')
      for (const clause of ['有条件录取', '一年预科', '不等同于已满足本科直接入学条件', '2027年6月30日',
        '理科中文', '数学', '12个月', '2027年9月1日', '未满18周岁', '10万元', '两年内']) expect(conditions).toContain(clause)
      expect(conditions).not.toMatch(/物理|化学|书写.*60|写作.*60|仅限自费|BEng|全日制/u)
      expect(hash(cycle)).toBe(review.newCycleSha256[cycle.id as keyof typeof review.newCycleSha256])
    }
  })

  it('binds field receipts to exact programme/year/language/round scope and rejects sibling mutations', () => {
    const bundle = raw(), entries = readFieldVerifications().filter(entry => ids.has(entry.recordId) || cycleIds.has(entry.recordId))
    expect(entries).toHaveLength(100)
    expect(new Set(entries.map(entry => `${entry.entityType}:${entry.recordId}:${entry.fieldPath}`)).size).toBe(entries.length)
    for (const entry of entries) {
      expect(validateFieldVerification(bundle, entry, TODAY)).toEqual(entry)
      expect(entry.receiptSha256).toBe(fieldReceipt.sha256)
      expect(fieldReceipt.fieldBindings.some(binding => binding.recordId === entry.recordId && binding.fieldPath === entry.fieldPath
        && binding.verificationSha256 === fieldVerificationContentSha256(entry))).toBe(true)
    }
    const cycle = cycles[0], entry = entries.find(row => row.recordId === cycle.id && row.fieldPath === 'closesOn')!
    for (const patch of [{ academicYear: '2028' }, { teachingLanguage: 'English' as const },
      { applicationRound: 'general-admissions-round-2' }, { programId: programs[1].id }]) {
      expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, ...patch })).not.toBe(entry.recordScopeSha256)
      const altered = structuredClone(bundle)
      Object.assign(altered.admissionCycles.find(row => row.id === cycle.id)!, patch)
      expect(validateFieldVerification(altered, entry, TODAY)).toBeUndefined()
    }
  })

  it('preserves every historical raw object and ledger entry, including all old SJTU and public-core records', () => {
    const removeNew: Record<string, Set<string>> = { programs: ids, 'admission-cycles': cycleIds, sources: sourceIds }
    for (const [file, baseline] of Object.entries(review.preservation)) {
      const value = reviewedDataAt(sjtuRelease, file)
      const rows = Array.isArray(value) ? value.filter(row => !removeNew[file]?.has(row.id))
        : value.entries.filter((row: { recordId: string }) => !ids.has(row.recordId) && !cycleIds.has(row.recordId))
      expect(hash(rows.slice(0, baseline.beforeCount))).toBe(baseline.beforeCanonicalSha256)
    }
    const bundle = reviewedCatalogueAt(sjtuRelease), snapshot = getPublicCatalogSnapshot(bundle, TODAY)
    expect(bundle.programs.filter(row => row.universityId === UNIVERSITY && !ids.has(row.id))).toHaveLength(6)
    for (const [id, expected] of Object.entries(review.beforePublicProgrammeSha256)) expect(hash(bundle.programs.find(row => row.id === id))).toBe(expected)
    for (const [id, expected] of Object.entries(review.beforePublicAdmissionCycleSha256)) expect(hash(bundle.admissionCycles.find(row => row.id === id))).toBe(expected)
    expect(snapshot.directory.programs).toHaveLength(35)
    expect(snapshot.directory.admissionCycles).toHaveLength(46)
    expect(snapshot.current.programs).toHaveLength(30)
    expect(snapshot.current.admissionCycles).toHaveLength(41)
    expect(snapshot.directory.programs.filter(row => ids.has(row.id))).toHaveLength(5)
    expect(snapshot.directory.admissionCycles.filter(row => cycleIds.has(row.id))).toHaveLength(15)
    expect(review.audit).toMatchObject({ existingRecordsChanged: [], existingNonemptyFieldsChanged: [], originalFilesCommitted: false,
      modelApiCalls: 0, cloudWrites: 0, privateUploads: 0 })
  })

  it('uses inclusive raw calendar boundaries without selecting or borrowing another round', () => {
    for (const program of programs) {
      const rounds = cycles.filter(row => row.programId === program.id)
      expect(selectAdmissionCycle(rounds, program.id, TODAY)).toBeUndefined()
      expect(rounds.map(row => getApplicationState(row, TODAY))).toEqual(['upcoming', 'upcoming', 'upcoming'])
      for (const cycle of rounds) expect(selectAdmissionCycle(rounds, program.id, TODAY, {
        teachingLanguage: 'Chinese', applicationRound: cycle.applicationRound,
      })?.id).toBe(cycle.id)
      expect(getApplicationState(rounds[0], '2026-11-18')).toBe('open')
      expect(getApplicationState(rounds[0], '2027-01-05')).toBe('open')
      expect(getApplicationState(rounds[0], '2027-01-06')).toBe('closed')
      expect(getApplicationState(rounds[1], '2027-01-05')).toBe('upcoming')
      expect(getApplicationState(rounds[1], '2027-01-06')).toBe('open')
      expect(getApplicationState(rounds[2], '2027-03-01')).toBe('open')
    }
    // Calendar behavior does not renew evidence: expired facts remain withheld.
    const expired = getPublicCatalogSnapshot(raw(), '2026-12-18')
    expect(expired.directory.programs.filter(row => ids.has(row.id))).toEqual([])
  })

  it('retains exact-scope fresh leaf evidence when only its parent review date has expired', () => {
    const bundle = raw()
    bundle.programs = [structuredClone(programs[0])]
    bundle.admissionCycles = [{ ...structuredClone(cycles[0]), reviewAfter: '2026-11-16' }]
    bundle.scholarships = []
    expect(hasDetailedPublicProgram(bundle.programs[0], bundle.admissionCycles, TODAY)).toBe(false)
    const directory = selectDiscoveryData(bundle, TODAY, readIdentityAcceptances(), readFieldVerifications())
    expect(selectDetailedPublicPrograms(directory, TODAY).programs.map(row => row.id)).toEqual([programs[0].id])
  })

  it.each(['language', 'eligibility', 'route', 'duration', 'closed', 'wrong-year', 'wrong-language'])(
    'withholds a source scope with %s missing or invalid without changing raw identities', failure => {
      const bundle = raw()
      bundle.programs = [structuredClone(programs[0])]
      bundle.admissionCycles = [structuredClone(cycles[0])]
      bundle.scholarships = []
      const program = bundle.programs[0], cycle = bundle.admissionCycles[0]
      if (failure === 'language') delete cycle.languageRequirements
      if (failure === 'eligibility') delete cycle.eligibility
      if (failure === 'route') cycle.applyUrl = null
      if (failure === 'duration') program.durationMonths = null
      if (failure === 'closed') cycle.closesOn = '2026-11-16'
      if (failure === 'wrong-year') cycle.academicYear = '2024'
      if (failure === 'wrong-language') cycle.teachingLanguage = 'English'
      const before = JSON.stringify(bundle)
      expect(hasDetailedPublicProgram(program, [cycle], TODAY)).toBe(false)
      expect(selectDetailedPublicPrograms(selectDiscoveryData(bundle, TODAY, readIdentityAcceptances(), readFieldVerifications()), TODAY).programs).toEqual([])
      expect(JSON.stringify(bundle)).toBe(before)
    })
})
