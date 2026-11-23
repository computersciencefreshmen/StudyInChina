import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reviewedCatalogueAt } from './reviewed-release-snapshot'
import review from '../../quality/maintenance/batches/coverage-pilot-bit-20261122/review.json'
import archive from '../../quality/maintenance/batches/coverage-pilot-bit-20261122/archive-receipt.json'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { applyFreshFieldVerifications, fieldValueSha256, validateFieldVerification } from '@/lib/data/field-verification'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'

const today = '2026-11-22'
const bundle = loadMaintenanceBundle(process.cwd())
const id = 'program-beijing-institute-of-technology-mechanical-engineering-bachelor-english-beijing'
const cycleId = 'cycle-bit-mechanical-engineering-bachelor-english-beijing-2027'
const receiptPath = 'quality/maintenance/batches/coverage-pilot-bit-20261122/field-receipt.json'

describe('independently reviewed BIT English bachelor pilot', () => {
  it('preserves the entire old catalogue and all eight BIT records', async () => {
    // Check preservation when this pilot was published. Later reviewed patches can update other records.
    const released = reviewedCatalogueAt('4c874f9422b620dfbf8efc7904009ba7cab869cf')
    const original = { ...released, programs: released.programs.slice(0, 2360),
      admissionCycles: released.admissionCycles.slice(0, 1734), sources: released.sources.slice(0, 3022),
      cities: released.cities.slice(0, 65), universities: released.universities.slice(0, 305), scholarships: released.scholarships.slice(0, 415) }
    expect(original.programs).toHaveLength(2360)
    expect(await catalogSha256(original)).toBe(review.inputCatalogSha256)
    for (const [recordId, expected] of Object.entries(review.baseline.preservedExistingBitRecordHashes)) {
      const old = bundle.programs.find(p => p.id === recordId)!
      expect(createHash('sha256').update(canonicalIdentityJson(old)).digest('hex')).toBe(expected)
    }
    expect(bundle.programs.find(p => p.id === 'program-beijing-institute-of-technology-mechanical-engineering-master')?.degreeLevel).toBe('master')
  })

  it('adds exactly one currently qualified programme and one literal 2027 cycle', () => {
    const actual = getPublicCatalogSnapshot(bundle, today)
    expect(review.baseline.counts['uni-beijing-institute-of-technology']).toBe(0)
    for (const view of [actual.directory, actual.current]) {
      expect(view.programs.filter(p => p.universityId === 'uni-beijing-institute-of-technology').map(p => p.id)).toEqual([id])
      expect(view.admissionCycles.filter(c => c.programId === id)).toHaveLength(1)
    }
    expect(actual.directory.programs.length).toBeGreaterThanOrEqual(review.baseline.directoryPrograms + 1)
    expect(actual.current.programs.length).toBeGreaterThanOrEqual(review.baseline.currentPrograms + 1)
    expect(actual.directory.admissionCycles.find(c => c.id === cycleId)).toMatchObject({ academicYear: '2027', teachingLanguage: 'English',
      intake: 'other', opensOn: null, closesOn: '2027-06-01', tuitionCny: 30000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 600 })
    const cycle = bundle.admissionCycles.find(c => c.id === cycleId)!
    expect(cycle.languageRequirements).toHaveLength(1)
    expect(cycle.languageRequirements![0]).toEqual({ test: 'other', minimum: expect.stringMatching(/IELTS ≥ 6\.0 OR TOEFL ≥ 85 OR Duolingo ≥ 110 OR.+native speakers are exempted/u) })
    expect(JSON.stringify(cycle.languageRequirements)).not.toMatch(/HSK/u)
    expect(cycle.eligibility?.map(row => row.en).join(' ')).toMatch(/under 18.+guardian/u)
    expect(cycle.eligibility?.map(row => row.en).join(' ')).toMatch(/Mathematics and Physics/u)
    expect(cycle.eligibility?.map(row => row.en).join(' ')).toMatch(/before a pre-admission notice/u)
    expect(cycle.eligibility?.map(row => row.en).join(' ')).toMatch(/fewer than 15/u)
    expect(bundle.programs.find(p => p.id === id)?.details).toBeUndefined()
  })

  it('validates all 12 strict leaf bindings and the independently confirmed R2 readback hashes', async () => {
    const leaves = readFieldVerifications().filter(l => l.receiptPath === receiptPath)
    expect(leaves).toHaveLength(12)
    for (const leaf of leaves) expect(validateFieldVerification(bundle, leaf, today)).toEqual(leaf)
    const annual = leaves.find(l => l.recordId === cycleId && l.fieldPath === 'languageRequirements')!
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'Chinese' }, { intake: 'autumn' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === cycleId)!, change)
      expect(validateFieldVerification(changed, annual, today)).toBeUndefined()
    }
    const invalidSource = { ...annual, sourceUrl: 'https://example.org/unreviewed-mirror' }
    expect(validateFieldVerification(bundle, invalidSource, today)).toBeUndefined()
    expect(review.privateArchive.status).toBe('readback_verified')
    expect(review.privateArchive.initialStateAtSourceReview).toMatch(/planned-not-uploaded/u)
    const { sha256, ...archiveContent } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(archiveContent)).digest('hex')).toBe(sha256)
    expect(review.privateArchive.archiveReceiptSha256).toBe(sha256)
    expect(archive.objects).toHaveLength(3)
    for (const object of archive.objects) {
      expect(object.readbackSha256).toBe(object.originalSha256)
      expect(object.readbackBytes).toBe(object.originalBytes)
    }
    for (const leaf of leaves) expect(archive.objects.find(o => o.key === leaf.objectKey)?.readbackSha256).toBe(leaf.snapshotSha256)
    expect((await validateDirectory(process.cwd())).integrityPassed).toBe(true)
  }, 30000)

  it('withholds unresolved conditions and unusable routes rather than admitting a nonempty parent', () => {
    const projected = getPublicCatalogSnapshot(bundle, today).directory
    const program = projected.programs.find(p => p.id === id)!
    const cycle = projected.admissionCycles.find(c => c.id === cycleId)!
    expect(hasDetailedPublicProgram(program, [{ ...cycle, eligibility: [] }], today)).toBe(false)
    expect(hasDetailedPublicProgram(program, [{ ...cycle, applyUrl: null }], today)).toBe(false)
    expect(hasDetailedPublicProgram(program, [{ ...cycle, academicYear: '2028' }], today)).toBe(false)
    const raw = structuredClone(bundle)
    const first = readFieldVerifications().find(l => l.recordId === cycleId && l.fieldPath === 'eligibility')!
    const source = { ...raw.sources.find(s => s.id === first.sourceId)!, id: 'test-bit-conflicting-source', url: 'https://isc.bit.edu.cn/test/conflicting-announcement' }
    raw.sources.push(source)
    raw.admissionCycles.find(c => c.id === cycleId)!.sourceIds.push(source.id)
    const value = [{ en: 'Applicants under 18 are not eligible.' }]
    const conflict = { ...first, sourceId: source.id, sourceUrl: source.url, value, valueSha256: fieldValueSha256(value), observationOnly: true as const }
    const overlaid = applyFreshFieldVerifications(raw, projected, today, [first, conflict])
    expect(hasDetailedPublicProgram(overlaid.programs.find(p => p.id === id)!, overlaid.admissionCycles, today)).toBe(false)
  })
})
