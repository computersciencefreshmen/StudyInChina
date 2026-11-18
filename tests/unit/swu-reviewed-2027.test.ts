import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-swu-2027-20261117/review.json'
import receipt from '../../quality/maintenance/batches/reviewed-swu-2027-20261117/identity-receipt.json'
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
const UNIVERSITY = 'uni-southwest-university'
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

describe('SWU 2027-2028 independently reviewed Chinese bachelor core', () => {
  it('binds the exact official Chinese names and immutable receipt through the real strict directory validator', async () => {
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
      expect(entry.receiptPath).toBe('quality/maintenance/batches/reviewed-swu-2027-20261117/identity-receipt.json')
      expect(entry.verifiedName).toEqual({ zh: program.name.zh })
      expect(scopedNameReceiptMatches(entry, receipt)).toBe(true)
      expect(scopedNameReceiptMatches({ ...entry, verifiedName: { zh: '未审核专业' } }, receipt)).toBe(false)
    }
    for (const row of programs) expect(sha(row)).toBe(review.afterProgrammeSha256[row.id as keyof typeof review.afterProgrammeSha256])
    for (const row of cycles) expect(sha(row)).toBe(review.newCycleSha256[row.id as keyof typeof review.newCycleSha256])
    const fixedScope = JSON.parse(readFileSync('content/maintenance/scope-272.v1.json', 'utf8')) as { schools: unknown[] }
    expect(await validateDirectory(process.cwd())).toMatchObject({ integrityPassed: true, cohortSchools: fixedScope.schools.length })
  }, 30_000)

  it('binds five distinct official rows, exact year and merged-cell origins without inventing codes or English names', () => {
    expect(programs.map(row => row.name)).toEqual([{ zh: '动物科学' }, { zh: '园艺' }, { zh: '园林' }, { zh: '风景园林' }, { zh: '水产养殖学' }])
    expect(new Set(programs.map(row => row.id)).size).toBe(5)
    expect(review.programmeRows.map(row => row.xlsxEvidence.range)).toEqual(['A11:H11', 'A36:H36', 'A37:H37', 'A38:H38', 'A45:H45'])
    expect(review.sourceChain.workbookYearCell).toEqual({ cell: 'A1', value: '2027-2028学年度西南大学本科招生专业列表' })
    expect(review.academicYearRangeExplicitlyPublished).toBe(true)
    for (const row of review.programmeRows) {
      expect(row).toMatchObject({ degreeLevel: 'bachelor', officialProgramCode: null, teachingLanguages: ['Chinese'], durationMonths: 48, tuitionCny: 20000 })
      expect(row.languageRequirements[0]).toMatchObject({ level: 4, minimumScore: 200 })
      expect(row.existingExactIds).toEqual([])
      expect(row.xlsxEvidence.exactCells).toHaveLength(8)
      const source = review.sources.find(source => source.id === row.xlsxEvidence.sourceId)!
      expect(source.url).toBe(row.xlsxEvidence.url)
      expect(source.rawSha256).toBe(row.xlsxEvidence.rawSha256)
    }
    for (const row of review.programmeRows.slice(1, 4)) expect(row.xlsxEvidence).toMatchObject({ facultyOriginCell: 'B36', facultyMergedRange: 'B36:B38' })
    expect(review.sources.find(row => row.url.endsWith('.xlsx'))!.rawSha256).toBe('0de669df1bcbc5ee26d48a88744ded16250935170a09b61b79ac7bdbd34251df')
    for (const evidence of review.commonPolicy.allEvidence) {
      expect(textSha(evidence.quote)).toBe(evidence.quoteSha256)
      const source = review.sources.find(row => row.id === evidence.sourceId)!
      expect(source.url).toBe(evidence.url)
      expect(source.rawSha256).toBe(evidence.rawSha256)
    }
    expect(new URL(review.sourceChain.exactCatalogueAnchor.attributes.href, review.sourceChain.bachelorGuideUrl).href).toBe(review.sourceChain.programmeCatalogueUrl)
  })

  it('separates admission HSK200 from CSCA HSK180 exemption and preserves precise year, age, passport and self-funded scope', () => {
    expect(review.commonPolicy.cscaProfessionalChineseDirectionNotSpecified).toBe(true)
    expect(review.commonPolicy.timeZoneExplicitlyStated).toBe(false)
    expect(review.commonPolicy.eligibility).toMatchObject({ ageMinimumInclusive: 17, ageMaximumExclusive: 30, ageReferenceDate: '2027-09-01' })
    const cscaEvidence = review.commonPolicy.allEvidence.find(row => row.locator.startsWith('html:CSCA table'))!
    expect(cscaEvidence).toHaveProperty('inheritedNote.attributes.rowspan', '4')
    for (const cycle of cycles) {
      expect(cycle).toMatchObject({ academicYear: '2027-2028', intake: 'autumn', teachingLanguage: 'Chinese', applicationRound: 'self-funded',
        opensOn: '2027-01-01', closesOn: '2027-06-15', tuitionCny: 20000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed',
        applicationFeeCny: 500, applyUrl: 'https://swu.17gz.org/', evidenceBasis: 'cycle-specific', factScope: 'partial' })
      expect(getApplicationState(cycle, TODAY)).toBe('upcoming')
      const requirement = cycle.languageRequirements![0]
      expect(requirement.test).toBe('HSK')
      expect(requirement.minimum).toContain('4级200分')
      expect(requirement.minimum).not.toContain('180')
      const conditions = cycle.eligibility!.map(row => row.zh).join(' ')
      expect(conditions).toContain('17周岁及以上、未满30周岁')
      expect(conditions).toContain('2027年9月1日')
      expect(conditions).toContain('普通护照')
      expect(conditions).toContain('1年以上有效期')
      expect(conditions).toContain('未满18周岁')
      expect(conditions).toContain('中文、数学、物理、化学')
      expect(conditions).toContain('180分及以上成绩报告')
      expect(conditions).toContain('不替代本专业入学HSK四级200分要求')
      expect(conditions).not.toContain('理科中文')
      expect(conditions).not.toContain('任选')
      expect(fieldRecordScopeSha256('admissionCycle', cycle)).toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
      expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, applicationRound: 'new-silk-road-scholarship' })).not.toBe(review.annualScopeSha256[cycle.id as keyof typeof review.annualScopeSha256])
    }
  })

  it('passes actual public v2 for five new identities while retaining all previous 25 qualified objects and nine SWU identities', () => {
    const bundle = loadMaintenanceBundle(process.cwd()), snapshot = getPublicCatalogSnapshot(bundle, TODAY)
    expect(review.beforePublicProgrammeIds).toHaveLength(25)
    for (const projected of [snapshot.current, snapshot.directory]) {
      expect(projected.programs.filter(row => row.universityId === UNIVERSITY).map(row => row.id).sort()).toEqual([...ids].sort())
      expect(projected.admissionCycles.filter(row => cycleIds.has(row.id))).toHaveLength(5)
    }
    // Fresh-field proofs can retain a programme in the directory even when its
    // whole-record facts are expired. Preserve each projection's own baseline.
    expect(snapshot.directory.programs.map(row => row.id)).toEqual(expect.arrayContaining(review.beforePublicProgrammeIds))
    expect(snapshot.directory.admissionCycles.map(row => row.id)).toEqual(expect.arrayContaining(review.beforePublicAdmissionCycleIds))
    expect(snapshot.current.programs.map(row => row.id)).toEqual(expect.arrayContaining(review.beforeCurrentProgrammeIds))
    expect(snapshot.current.admissionCycles.map(row => row.id)).toEqual(expect.arrayContaining(review.beforeCurrentAdmissionCycleIds))
    expect(snapshot.directory.programs.length).toBeGreaterThanOrEqual(30)
    for (const [id, expected] of Object.entries(review.beforePublicProgrammeSha256)) expect(sha(bundle.programs.find(row => row.id === id))).toBe(expected)
    for (const [id, expected] of Object.entries(review.beforePublicAdmissionCycleSha256)) expect(sha(bundle.admissionCycles.find(row => row.id === id))).toBe(expected)
    const baseline = review.identityDedupe.find(row => row.catalogue === 'actual-baseline-96baa3f8')!
    expect(baseline.existingProgrammeCount).toBe(9)
    for (const before of baseline.existingProgrammes) expect(bundle.programs.find(row => row.id === before.id)).toMatchObject(before)
    expect(review.audit.existingRecordsChanged).toEqual([])
    expect(review.audit.existingNonemptyFieldsChanged).toEqual([])
  })

  it.each(['missing-language-requirement', 'missing-eligibility', 'missing-route', 'missing-duration', 'closed', 'expired-review', 'wrong-language', 'wrong-year', 'wrong-programme'])(
    'independently withholds %s without mutating or deleting raw identities', failure => {
      const raw = singleProgrammeFixture(), program = raw.programs[0], cycle = raw.admissionCycles[0]
      if (failure === 'missing-language-requirement') delete cycle.languageRequirements
      if (failure === 'missing-eligibility') delete cycle.eligibility
      if (failure === 'missing-route') delete cycle.applyUrl
      if (failure === 'missing-duration') program.durationMonths = null
      if (failure === 'closed') cycle.closesOn = '2026-11-16'
      if (failure === 'expired-review') cycle.reviewAfter = '2026-11-16'
      if (failure === 'wrong-language') cycle.teachingLanguage = 'English'
      if (failure === 'wrong-year') cycle.academicYear = '2024-2025'
      if (failure === 'wrong-programme') cycle.programId = programs[1].id
      expect(hasDetailedPublicProgram(program, [cycle], TODAY)).toBe(false)
      const before = JSON.stringify(raw)
      expect(selectDetailedPublicPrograms(selectDiscoveryData(raw, TODAY, readIdentityAcceptances()), TODAY).programs).toEqual([])
      expect(raw.programs).toHaveLength(1)
      expect(JSON.stringify(raw)).toBe(before)
    })

  it('does not combine round siblings or resurrect expired facts from accepted names', () => {
    const raw = singleProgrammeFixture(), first = raw.admissionCycles[0]
    const sibling = { ...structuredClone(first), id: `${first.id}-sibling`, applicationRound: 'new-silk-road-scholarship' }
    delete first.eligibility
    delete sibling.languageRequirements
    raw.admissionCycles.push(sibling)
    expect(hasDetailedPublicProgram(raw.programs[0], raw.admissionCycles, TODAY)).toBe(false)
    const full = singleProgrammeFixture(), afterExpiry = '2026-12-18'
    const directory = selectDiscoveryData(full, afterExpiry, readIdentityAcceptances())
    expect(directory.programs).toHaveLength(1)
    expect(directory.programs[0].durationMonths).toBeNull()
    expect(selectDetailedPublicPrograms(directory, afterExpiry).programs).toEqual([])
    expect(full.programs).toHaveLength(1)
  })
})
