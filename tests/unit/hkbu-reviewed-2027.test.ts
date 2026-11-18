import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-hkbu-2027-20261117/review.json'
import identityReceipt from '../../quality/maintenance/batches/reviewed-hkbu-2027-20261117/identity-receipt.json'
import fieldReceipt from '../../quality/maintenance/batches/reviewed-hkbu-2027-20261117/field-receipt.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { canonicalIdentityJson, identityFingerprint, scopedNameReceiptMatches } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { fieldRecordScopeSha256, fieldVerificationContentSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { hasDetailedPublicProgram, selectDetailedPublicPrograms } from '@/lib/data/public-program-quality'
import { admissionCycleSchema, programSchema } from '@/lib/data/schema'
import { quotedAdmissionIntake, quotedAdmissionYear } from '@/lib/data/cycle-scope'

const TODAY = '2026-11-17', SCHOOL = 'uni-hong-kong-baptist-university'
const ROOT = process.cwd(), PATH = 'quality/maintenance/batches/reviewed-hkbu-2027-20261117'
const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const textSha = (value: string) => createHash('sha256').update(value).digest('hex')
const programs = review.reviewedPrograms.map(row => programSchema.parse(row))
const cycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
const ids = new Set(programs.map(row => row.id)), cycleIds = new Set(cycles.map(row => row.id))
const identities = readIdentityAcceptances(undefined, { strictProjection: true })
const fields = readFieldVerifications(), leaves = fields.filter(row => row.receiptPath === `${PATH}/field-receipt.json`)
function visible(bundle = loadMaintenanceBundle(ROOT), today = TODAY) {
  return selectDetailedPublicPrograms(selectDiscoveryData(bundle, today, identities, fields), today, bundle)
}

describe('independent HKBU 2027 full-time non-local core review', () => {
  it('passes the actual strict catalogue and all standard identity/field receipt bindings', async () => {
    for (const receipt of [review, identityReceipt, fieldReceipt]) {
      const { sha256, ...content } = receipt
      expect(sha(content)).toBe(sha256)
    }
    expect(identityReceipt.reviewSha256).toBe(review.sha256)
    expect(fieldReceipt.batchSha256).toBe(review.sha256)
    expect(review.method).toContain('AI-assisted')
    expect(review.method).toContain('not a claim of personal human sign-off')
    expect(review).toMatchObject({ modelCalls: false, cloudWrites: 0, oldModelLedgerMutations: false })
    const bundle = loadMaintenanceBundle(ROOT)
    expect(leaves).toHaveLength(50)
    for (const leaf of leaves) {
      expect(validateFieldVerification(bundle, leaf, TODAY)).toEqual(leaf)
      expect(leaf.receiptSha256).toBe(fieldReceipt.sha256)
      expect(fieldReceipt.fieldBindings).toContainEqual({ entityType: leaf.entityType, recordId: leaf.recordId,
        fieldPath: leaf.fieldPath, verificationSha256: fieldVerificationContentSha256(leaf) })
    }
    for (const entry of identities.filter(entry => ids.has(entry.recordId))) {
      const program = programs.find(row => row.id === entry.recordId)!
      expect(entry.identitySha256).toBe(identityFingerprint('program', program))
      expect(scopedNameReceiptMatches(entry, identityReceipt)).toBe(true)
      expect(entry.verifiedSourceUrl).toBe(program.programUrl)
      expect(entry.verifiedName).toEqual({ en: program.name.en })
    }
    expect(identities.filter(entry => ids.has(entry.recordId))).toHaveLength(5)
    expect((await validateDirectory(ROOT)).integrityPassed).toBe(true)
  }, 30_000)

  it('uses five actual degree identities with exact original source hashes, explicit 2027 entry and portal anchors', () => {
    expect(programs).toHaveLength(5)
    expect(review.sources).toHaveLength(5)
    for (const row of review.sources) {
      expect(row.rawBytes).toBeGreaterThan(250_000)
      expect(row.rawSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(row.textSha256).toMatch(/^[a-f0-9]{64}$/)
      for (const evidence of Object.values(row.evidence)) {
        expect(textSha(evidence.quote)).toBe(evidence.quoteSha256)
        expect(evidence.rawSha256).toBe(row.rawSha256)
        expect(evidence.textSha256).toBe(row.textSha256)
        expect(new URL(evidence.url).hostname).toBe('ar.hkbu.edu.hk')
      }
      expect(quotedAdmissionYear('2027', row.evidence.year.quote)).toBe(true)
      expect(quotedAdmissionIntake('2027', 'autumn', row.evidence.year.quote)).toBe(true)
      expect(row.evidence.portal.quote).toContain('APPLY NOW')
      expect(row.evidence.portal.quote).toContain('https://iss.hkbu.edu.hk/amsappl_pg/welcome.jsf')
      expect(row.evidence.portal.quote.length).toBeLessThan(4000)
    }
  })

  it('preserves the four original programmes and every old cycle without renewing or filling parent conditions', () => {
    const bundle = loadMaintenanceBundle(ROOT)
    expect(review.beforePrograms).toHaveLength(4)
    for (const before of review.beforePrograms) {
      const after = bundle.programs.find(row => row.id === before.id)!
      expect({ ...after, sourceIds: before.sourceIds }).toEqual(before)
      expect(after.sourceIds).toEqual(expect.arrayContaining(before.sourceIds))
      expect(after.details?.eligibility ?? after.supplementaryDetails?.eligibility).toBeUndefined()
    }
    for (const before of review.priorAdmissionCycles) {
      expect(bundle.admissionCycles.find(row => row.id === before.id)).toEqual(before)
      expect(visible(bundle).admissionCycles.some(row => row.id === before.id)).toBe(false)
    }
    expect(review.wholeExistingProgrammeRecordsRenewed).toBe(false)
    expect(review.parentConditionsNotPopulated).toBe(true)
  })

  it('publishes exactly five HKBU degrees through six self-contained 2027 English/non-local scopes', () => {
    const publicData = visible()
    expect(publicData.programs.filter(row => row.universityId === SCHOOL).map(row => row.id).sort()).toEqual([...ids].sort())
    expect(publicData.admissionCycles.filter(row => cycleIds.has(row.id))).toHaveLength(6)
    for (const cycle of cycles) {
      expect(cycle).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'English',
        dateStatus: 'published', applyUrl: 'https://iss.hkbu.edu.hk/amsappl_pg/welcome.jsf',
        tuitionCny: null, applicationFeeCny: null, factScope: 'partial', evidenceBasis: 'cycle-specific' })
      expect(cycle.applicationRound).toContain('non-local')
      expect(cycle.eligibility!.length).toBeGreaterThan(0)
      expect(cycle.languageRequirements!.length).toBeGreaterThan(0)
      expect(cycle.notes!.en).toContain('Fees published in HKD are not entered into CNY fields')
      const program = publicData.programs.find(row => row.id === cycle.programId)!
      expect(hasDetailedPublicProgram(program, [cycle], TODAY)).toBe(true)
    }
  })

  it('keeps Visual Arts rounds separate and excludes local-only July deadlines', () => {
    const arts = cycles.filter(cycle => cycle.programId === 'program-vm-hkbu-ma-visual-arts-master')
    expect(arts.map(cycle => [cycle.applicationRound, cycle.opensOn, cycle.closesOn])).toEqual([
      ['non-local Round 1', '2026-09-01', '2026-12-31'], ['non-local Round 2', null, '2027-04-23'],
    ])
    expect(cycles.filter(cycle => !arts.includes(cycle)).every(cycle => cycle.closesOn === '2027-06-07' && cycle.opensOn === '2026-10-06')).toBe(true)
    expect(cycles.some(cycle => cycle.closesOn?.startsWith('2027-07'))).toBe(false)
  })

  it.each(['eligibility', 'languageRequirements', 'applyUrl'] as const)('does not borrow a missing annual %s from a parent or a sibling round', field => {
    const bundle = loadMaintenanceBundle(ROOT), target = bundle.admissionCycles.find(row => row.id === cycles[0].id)!
    delete target[field]
    const publicData = visible(bundle)
    expect(publicData.admissionCycles.some(row => row.id === target.id)).toBe(false)
    expect(publicData.admissionCycles.some(row => row.id === cycles[1].id)).toBe(true)
    const leaf = leaves.find(leaf => leaf.recordId === target.id && leaf.fieldPath === field)!
    expect(validateFieldVerification(bundle, leaf, TODAY)).toBeUndefined()
  })

  it('keeps different programme language alternatives and honours qualifications distinct', () => {
    const byId = (id: string) => cycles.find(cycle => cycle.programId === id)!
    const ai = byId('program-vm-hkbu-msc-ai-digital-media-master')
    expect(ai.languageRequirements!.find(row => row.test === 'IELTS')!.minimum).toContain('6.0')
    expect(ai.languageRequirements!.find(row => row.test === 'TOEFL')!.minimum).toContain('74')
    expect(ai.eligibility![0].en).toContain('with honours')
    const film = byId('program-vm-hkbu-mfa-cinematic-arts-master')
    expect(film.languageRequirements![0].minimum).toContain('6.5')
    expect(film.languageRequirements![0].minimum).toContain('English enhancement course')
    expect(film.languageRequirements![0].minimum).toContain('6.0')
    const producing = byId('program-vm-hkbu-ma-producing-master')
    expect(producing.languageRequirements![0].minimum).toContain('6.5')
    expect(producing.languageRequirements![0].minimum).not.toContain('CET-6')
    expect(programs.find(row => row.id === film.programId)!.durationMonths).toBe(24)
    expect(programs.filter(row => row.id !== film.programId).map(row => row.durationMonths)).toEqual([12, 12, 12, 12])
  })

  it('adds Communication only once, keeps the BNBU degree distinct, and expires evidence without deleting records', () => {
    const bundle = loadMaintenanceBundle(ROOT)
    expect(bundle.programs.filter(row => row.universityId === SCHOOL && row.name.en === 'Master of Arts in Communication')).toHaveLength(1)
    const bnBu = bundle.programs.find(row => row.id === 'program-vm-bnbu-communication-master')!
    expect(bnBu.universityId).not.toBe(SCHOOL)
    expect(ids.has(bnBu.id)).toBe(false)
    const before = JSON.stringify(bundle), expired = visible(bundle, '2026-12-18')
    expect(expired.programs.some(row => ids.has(row.id))).toBe(false)
    expect(bundle.programs.filter(row => ids.has(row.id))).toHaveLength(5)
    expect(JSON.stringify(bundle)).toBe(before)
    for (const cycle of cycles) expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, academicYear: '2027-2028' }))
      .not.toBe(fieldRecordScopeSha256('admissionCycle', cycle))
  })
})
