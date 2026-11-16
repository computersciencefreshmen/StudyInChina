import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/reviewed-nenu-2027-20261116/review.json'
import receipt from '../../quality/reviewed-nenu-2027-20261116/identity-receipt.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { buildProgramCoverage } from '../../scripts/maintenance/program-coverage'
import { readMaintenanceScope } from '../../scripts/maintenance/scope-registry'
import { canonicalIdentityJson, identityAcceptanceSchema, identityFingerprint } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { selectPublishedData } from '@/lib/data/publication'
import { selectDiscoveryData, type DiscoveryMeta } from '@/lib/data/discovery'
import { projectVerifiedProgramName } from '@/lib/data/verified-program-name'
import { admissionCycleSchema, programSchema } from '@/lib/data/schema'
import type { Program } from '@/lib/data/types'

const TODAY = '2026-11-16'
const UNIVERSITY = 'uni-northeast-normal-university'
const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const textSha = (value: string) => createHash('sha256').update(value).digest('hex')
const reviewedPrograms = review.reviewedPrograms.map(row => programSchema.parse(row))
const reviewedCycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
const identities = reviewedPrograms.map(program => identityAcceptanceSchema.parse({
  entityType: 'program', recordId: program.id, identitySha256: identityFingerprint('program', program),
  sourceIds: review.sources.map(source => source.id), acceptedAt: receipt.acceptedAt, reviewer: review.reviewerId,
  receiptPath: 'quality/reviewed-nenu-2027-20261116/identity-receipt.json', receiptSha256: receipt.sha256,
  verifiedName: receipt.accepted.find(row => row.recordId === program.id)!.verifiedName,
  verifiedSourceUrl: review.sourceChain.pdfUrl,
}))

// Replay the immutable reviewed payload. Future legitimate rechecks and expiry
// of other catalogue rows must not change this evidence regression's clock.
function fixture() {
  const data = loadMaintenanceBundle(process.cwd())
  data.programs = structuredClone(reviewedPrograms)
  data.admissionCycles = structuredClone(reviewedCycles)
  data.scholarships = []
  const parentMeta = { status: 'verified' as const, verifiedAt: TODAY, reviewAfter: '2026-12-31' }
  data.universities = data.universities.filter(row => row.id === UNIVERSITY).map(row => ({ ...row, ...parentMeta }))
  const cities = new Set(data.universities.map(row => row.cityId))
  data.cities = data.cities.filter(row => cities.has(row.id)).map(row => ({ ...row, ...parentMeta }))
  return data
}
const scope = readMaintenanceScope(process.cwd())
async function count(data = fixture(), today = TODAY) {
  return (await buildProgramCoverage(data, scope, today, identities)).schools.find(row => row.universityId === UNIVERSITY)!
}

describe('independently audited NENU 2027 official programme core', () => {
  it('binds the reviewed payload, exact official table rows and same-year guide to immutable hashes', () => {
    const { sha256: reviewSha, ...reviewContent } = review
    const { sha256: receiptSha, ...receiptContent } = receipt
    expect(sha(reviewContent)).toBe(reviewSha)
    expect(sha(receiptContent)).toBe(receiptSha)
    expect(receipt.reviewSha256).toBe(reviewSha)
    expect(review.modelCalls).toBe(false)
    expect(review.oldModelLedgerMutations).toBe(false)
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of personal human sign-off')
    expect(new URL(review.sourceChain.exactAnchor.href, review.sourceChain.guideUrl).href).toBe(review.sourceChain.pdfUrl)
    expect(textSha(review.sourceChain.exactAnchor.quote)).toBe(review.sourceChain.exactAnchor.quoteSha256)
    expect(review.sourceChain.guideScopeQuote.quote).toContain('2027–2028')
    for (const evidence of [...review.commonPolicy.allEvidence, ...review.programmeRows.map(row => row.evidence)]) {
      expect(textSha(evidence.quote)).toBe(evidence.quoteSha256)
      const source = review.sources.find(row => row.id === evidence.sourceId)!
      expect(evidence.rawSha256).toBe(source.rawSha256)
      expect(evidence.textSha256).toBe(source.textSha256)
      expect(evidence.url).toBe(source.url)
    }
    for (const row of reviewedPrograms) expect(sha(row)).toBe(review.afterProgrammeSha256[row.id as keyof typeof review.afterProgrammeSha256])
    for (const row of reviewedCycles) expect(sha(row)).toBe(review.newCycleSha256[row.id as keyof typeof review.newCycleSha256])
    expect(() => readIdentityAcceptances(undefined, { strictProjection: true })).not.toThrow()
  })

  it('retains five existing identities while replacing their old primary document and only reviewing previously empty facts', () => {
    expect(reviewedPrograms).toHaveLength(5)
    expect(new Set(reviewedPrograms.map(row => row.id)).size).toBe(5)
    for (const before of review.beforePrograms) {
      const after = reviewedPrograms.find(row => row.id === before.id)!
      expect(after).toMatchObject({ id: before.id, slug: before.slug, name: before.name,
        universityId: before.universityId, degreeLevel: before.degreeLevel })
      expect(before).toMatchObject({ verificationScope: 'identity', teachingLanguages: [],
        durationMonths: null, applyUrl: null, languageRequirements: [] })
      expect(before).not.toHaveProperty('details')
      expect(before).not.toHaveProperty('supplementaryDetails')
      expect(after.programUrl).toBe(review.sourceChain.pdfUrl)
      expect(after.sourceIds).toEqual(expect.arrayContaining(before.sourceIds))
      expect(after).not.toHaveProperty('details')
      expect(after).not.toHaveProperty('supplementaryDetails')
    }
  })

  it('preserves the unusual duration, per-year fees and unknown score/season instead of inventing defaults', () => {
    expect(reviewedPrograms.find(row => row.name.en === 'Sculpture')!.durationMonths).toBe(60)
    expect(reviewedPrograms.filter(row => row.name.en !== 'Sculpture').map(row => row.durationMonths)).toEqual([48, 48, 48, 48])
    for (const cycle of reviewedCycles) {
      const program = reviewedPrograms.find(row => row.id === cycle.programId)!
      expect(cycle).toMatchObject({ academicYear: '2027-2028', intake: 'other', teachingLanguage: 'Chinese',
        opensOn: null, closesOn: '2027-06-25', applicationFeeCny: 400, tuitionPeriod: 'academic-year',
        tuitionStatus: 'confirmed', applyUrl: 'https://nenu.17gz.org', factScope: 'partial' })
      expect(cycle.tuitionCny).toBe(program.name.en === 'Law' ? 16000 : 19600)
      expect(cycle.languageRequirements).toEqual([{ test: 'HSK', minimum: 'Level 5; minimum score not stated' }])
      expect(cycle.eligibility!.map(row => row.en).join(' ')).toContain('between 18 and 25 years old')
      expect(cycle.eligibility!.map(row => row.en)).toContain('Required CSCA subjects: Humanities Chinese, Mathematics.')
      expect(cycle.notes!.en).toContain('does not waive CSCA')
      expect(cycle.languageRequirements![0].minimum).not.toContain('180')
    }
  })

  it('publishes five distinct current programmes and their exact annual Chinese-track conditions', async () => {
    const published = selectPublishedData(fixture(), TODAY, identities)
    expect(published.programs.map(row => row.id).sort()).toEqual(reviewedPrograms.map(row => row.id).sort())
    expect(published.admissionCycles).toHaveLength(5)
    expect(await count()).toMatchObject({ currentProgramCount: 5, coverageBand: 'five-plus', gap: 0 })
  })

  it.each(['eligibility', 'languageRequirements', 'applyUrl'] as const)('does not borrow a missing annual %s from the parent programme', async field => {
    const data = fixture()
    delete data.admissionCycles[0][field]
    expect(await count(data)).toMatchObject({ currentProgramCount: 4, coverageBand: 'two-to-four', gap: 1 })
  })

  it('expires the reviewed facts without deleting identities or renewing their original dates', async () => {
    const data = fixture(), before = JSON.stringify(data)
    const published = selectPublishedData(data, '2026-12-17', identities)
    expect(published.programs).toHaveLength(0)
    expect(published.admissionCycles).toHaveLength(0)
    const directory = selectDiscoveryData(data, '2026-12-17', identities)
    expect(directory.programs).toHaveLength(5)
    expect((directory.programs as Array<Program & { discovery: DiscoveryMeta }>).every(row => !row.discovery.currentFacts
      && row.durationMonths === null && row.teachingLanguages.length === 0)).toBe(true)
    expect(await count(data, '2026-12-17')).toMatchObject({ currentProgramCount: 0, gap: 5 })
    expect(JSON.stringify(data)).toBe(before)
  })

  it('requires the new exact identity receipt after the source URL changes; the old acceptance cannot authorize it', () => {
    const data = fixture(), row = data.programs[0]
    expect(projectVerifiedProgramName(row, data.sources, review.previousIdentityAcceptances.map(entry => identityAcceptanceSchema.parse(entry)), TODAY)).toBeUndefined()
    expect(projectVerifiedProgramName(row, data.sources, identities, TODAY)).toMatchObject({ name: { en: row.name.en }, programUrl: review.sourceChain.pdfUrl })
  })
})
