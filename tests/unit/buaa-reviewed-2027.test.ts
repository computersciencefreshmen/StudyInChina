import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-buaa-2027-20261117/review.json'
import receipt from '../../quality/maintenance/batches/reviewed-buaa-2027-20261117/identity-receipt.json'
import nenu from '../../quality/reviewed-nenu-2027-20261116/review.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { buildProgramCoverage } from '../../scripts/maintenance/program-coverage'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { canonicalIdentityJson, identityFingerprint } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { fieldVerificationContentSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectDetailedPublicPrograms, PUBLIC_PROGRAM_QUALITY_POLICY } from '@/lib/data/public-program-quality'
import { bundleSchema } from '@/lib/data/schema'

const TODAY = '2026-11-17', UNIVERSITY = 'uni-beihang-university'
const root = process.cwd(), directory = resolve(root, 'content/data')
const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const raw = loadMaintenanceBundle(root)
const identities = readIdentityAcceptances(directory, { strictProjection: true })
const fields = readFieldVerifications(directory)
const reviewedIds = new Set(review.reviewedPrograms.map(row => row.id))
const reviewedFields = fields.filter(entry => reviewedIds.has(entry.recordId) || entry.recordId.startsWith('cycle-2027-buaa-'))
const publicData = (data = raw, clock = TODAY, evidence = reviewedFields) => selectDetailedPublicPrograms(
  selectDiscoveryData(data, clock, identities, [...fields.filter(entry => !reviewedFields.includes(entry)), ...evidence]), clock,
)
const buaa = (data = raw, clock = TODAY, evidence = reviewedFields) => publicData(data, clock, evidence).programs.filter(row => row.universityId === UNIVERSITY)

describe('independent BUAA 2027 source-backed core review', () => {
  it('binds the immutable AI/tool/visual review, receipt and exact public-source hashes', () => {
    const { sha256: reviewSha, ...reviewContent } = review
    const { sha256: receiptSha, ...receiptContent } = receipt
    expect(sha(reviewContent)).toBe(reviewSha)
    expect(sha(receiptContent)).toBe(receiptSha)
    expect(receipt.reviewSha256).toBe(reviewSha)
    expect(review.privatePacketContentSha256).toBe('ee3916671a6de2991e4f293076614aee80544aee41ad47b75037f5268259129a')
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of Henry or any other personal human sign-off')
    expect(review.modelCalls).toBe(false)
    expect(review.oldModelLedgerMutations).toBe(false)
    expect(review.sources.map(source => source.rawSha256)).toEqual([
      '2ee3f7a6e40cd9004b1bbdfd7ebbaabb0e7e06069f118235d8f3e8942eb23e84',
      '8651b20bd19327b0ca76013a33172a5794c4809c039af1a64bc572e0615e24d2',
      '58397f04aa8f7cceeb873f5cf779a7f54cc3aa27572ec4750f1cf8f3e85a5e39',
    ])
    for (const source of review.sources) {
      expect(new URL(source.url).hostname).toMatch(/(?:^|\.)buaa\.edu\.cn$/u)
      expect(raw.sources.find(row => row.id === source.id)).toMatchObject({ url: source.url, official: true })
    }
    for (const program of review.reviewedPrograms) {
      const current = raw.programs.find(row => row.id === program.id)!
      expect(sha(current)).toBe(review.afterProgrammeSha256[program.id as keyof typeof review.afterProgrammeSha256])
      expect(receipt.accepted.find(entry => entry.recordId === program.id)?.identitySha256).toBe(identityFingerprint('program', current))
    }
    expect(JSON.stringify(review)).not.toMatch(/[A-Z]:\\|private-data-review-20261116/u)
    expect(review.portalTransportVerification).toMatchObject({ originalGuideUrl: 'http://admission.buaa.edu.cn/', verifiedHttpsUrl: 'https://admission.buaa.edu.cn/', httpStatus: 200 })
  })

  it('preserves two exact existing identities and all their original audit dates without renewing raw sibling locales', () => {
    expect(review.beforePrograms).toHaveLength(2)
    expect(review.reviewedPrograms).toHaveLength(5)
    expect(new Set(review.reviewedPrograms.map(row => row.id)).size).toBe(5)
    for (const before of review.beforePrograms) {
      const after = raw.programs.find(row => row.id === before.id)!
      expect(after).toMatchObject({ id: before.id, slug: before.slug, universityId: before.universityId, degreeLevel: before.degreeLevel,
        status: 'stale', verifiedAt: before.verifiedAt, reviewAfter: before.reviewAfter })
      expect(after.name.ru).toBe(before.name.ru)
      expect(after).not.toHaveProperty('details')
      expect(after).not.toHaveProperty('supplementaryDetails')
      expect(after.programUrl).toBe('https://is.buaa.edu.cn/info/1292/3117.htm')
    }
    expect(review.wholeExistingProgrammeRecordsRenewed).toBe(false)
    expect(review.existingNonemptyFieldAudit.every(row => row.wholeRecordRenewed === false)).toBe(true)
    expect(raw.programs.find(row => row.id === review.priorUnselectedProgramme.id)).toEqual(review.priorUnselectedProgramme)
    expect(buaa().some(row => row.id === review.priorUnselectedProgramme.id)).toBe(false)
    expect(buaa().every(row => !Object.hasOwn(row.name, 'ru'))).toBe(true)
  })

  it('publishes five distinct cores through the actual worktree v2 selector and forty exact scoped leaves', async () => {
    expect(PUBLIC_PROGRAM_QUALITY_POLICY).toBe('studyinchina.public-program-core.v2')
    expect(bundleSchema.safeParse(raw).success).toBe(true)
    expect(buaa().map(row => row.id).sort()).toEqual([...reviewedIds].sort())
    expect(reviewedFields).toHaveLength(40)
    expect(reviewedFields.every(entry => validateFieldVerification(raw, entry, TODAY))).toBe(true)
    expect(reviewedFields.map(fieldVerificationContentSha256)).toEqual(review.fieldReviewContentSha256)
    const summary = await buildProgramCoverage(raw, readMaintenanceScope(root), TODAY, identities, fields)
    expect(summary.schools.find(row => row.universityId === UNIVERSITY)).toMatchObject({ currentProgramCount: 5, coverageBand: 'five-plus', gap: 0 })
    const projected = publicData()
    for (const id of reviewedIds) {
      const program = projected.programs.find(row => row.id === id)!
      expect(program).toMatchObject({ durationMonths: 48, teachingLanguages: ['Chinese'] })
      expect((program as typeof program & { discovery?: { currentFacts: boolean } }).discovery?.currentFacts).toBe(false)
      expect(program.languageRequirements).toEqual([]) // Only the annual Chinese track has language authority.
      const cycle = projected.admissionCycles.find(row => row.programId === id)!
      expect(cycle).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese', opensOn: '2026-11-01', closesOn: '2027-05-30', dateStatus: 'published', applyUrl: 'https://admission.buaa.edu.cn/', tuitionCny: null, applicationFeeCny: null })
      expect(cycle.languageRequirements).toEqual([{ test: 'HSK', minimum: 'HSK五级及以上，成绩不低于180分；须提交有效期两年内的成绩报告。' }])
    }
  })

  it('keeps official single-year scope and the exact PDF chemistry distinction without English-track exemptions', () => {
    expect(review.academicYear).toBe('2027')
    expect(review.yearRepresentation).toBe('official-single-admission-year')
    for (const row of review.programmeRows) {
      const chemistry = row.recordId.includes('materials')
      const cycle = publicData().admissionCycles.find(c => c.programId === row.recordId)!
      const wording = cycle.eligibility!.map(value => value.zh).join(' ')
      expect(wording).toContain(chemistry ? '理科中文、数学、物理、化学' : '理科中文、数学、物理')
      expect(wording.includes('化学')).toBe(chemistry)
      expect(wording).toContain('中文语种试卷')
      expect(wording).toContain('高中毕业及以上学历')
      expect(wording).not.toMatch(/IELTS|TOEFL|无需参加专业中文/u)
      expect(row.pdfRow.url).toContain('2027nian')
      expect(row.pdfRow.sha256).toBe(review.sources[1].rawSha256)
      expect(row.pdfRow.locator.rawTableRows.every(value => value.originalExtractedCells[3]?.includes(chemistry ? 'Chemistry' : '物理') || value.originalExtractedCells[3]?.includes('Physics'))).toBe(true)
    }
  })

  it('preserves the already reviewed NENU five and their records byte-for-byte', () => {
    for (const program of nenu.reviewedPrograms) expect(sha(raw.programs.find(row => row.id === program.id))).toBe(nenu.afterProgrammeSha256[program.id as keyof typeof nenu.afterProgrammeSha256])
    for (const cycle of nenu.reviewedAdmissionCycles) expect(sha(raw.admissionCycles.find(row => row.id === cycle.id))).toBe(nenu.newCycleSha256[cycle.id as keyof typeof nenu.newCycleSha256])
    expect(publicData().programs.filter(row => row.universityId === 'uni-northeast-normal-university')).toHaveLength(5)
  })

  it.each(['languageRequirements','eligibility','applyUrl','closesOn'] as const)('holds a programme when its annual %s proof is removed', path => {
    const selected = review.reviewedAdmissionCycles[0]
    const remaining = reviewedFields.filter(entry => entry.recordId !== selected.id || entry.fieldPath !== path)
    expect(buaa(raw, TODAY, remaining)).toHaveLength(4)
  })

  it('rejects unsupported year changes, lost official authority and expired evidence without resurrecting raw facts', () => {
    const changed = structuredClone(raw), cycle = changed.admissionCycles.find(row => row.id === review.reviewedAdmissionCycles[0].id)!
    cycle.academicYear = '2027-2028'
    expect(buaa(changed)).toHaveLength(4)
    cycle.academicYear = 'unknown'
    expect(buaa(changed)).toHaveLength(4)
    const untrusted = structuredClone(raw)
    untrusted.sources.find(row => row.id === 'src-reviewed-buaa-2027-csca')!.official = false
    expect(buaa(untrusted)).toHaveLength(0)
    expect(buaa(raw, '2026-12-17')).toHaveLength(0)
    expect(buaa(raw, TODAY, [])).toHaveLength(0)
  })
})
