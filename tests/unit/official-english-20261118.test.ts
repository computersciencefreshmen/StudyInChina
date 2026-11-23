import { describe, expect, it, vi } from 'vitest'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { findReviewedProgramTranslation, localize, localizeProgramText } from '@/lib/data/format'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectDetailedPublicPrograms } from '@/lib/data/public-program-quality'
import { officialDisplayName } from '@/lib/program-display-name'
import { getOfficialTitleTranslation } from '@/lib/program-translations'
import { reviewedCatalogueAt, reviewedDataAt } from './reviewed-release-snapshot'

vi.mock('@/lib/program-translations', () => ({
  getOfficialTitleTranslation: vi.fn(async () => undefined),
  getProgramTitleTranslation: vi.fn(async () => undefined),
}))

const day = '2026-11-18'
// A source checked before this date may be imported much later. Pin the actual
// reviewed release rather than treating verifiedAt as an import timestamp.
const reviewedCommit = '5f5ec157d746f2e02e75b52f819744589e353d2b'
const bundle = reviewedCatalogueAt(reviewedCommit)
const directory = selectDetailedPublicPrograms(selectDiscoveryData(bundle, day,
  reviewedDataAt(reviewedCommit, 'identity-acceptances').entries,
  reviewedDataAt(reviewedCommit, 'field-verifications').entries), day, bundle)
const liveBundle = loadMaintenanceBundle(process.cwd())
const liveDirectory = getPublicCatalogSnapshot(liveBundle, day).directory
const han = /[\u3400-\u9fff]/u

describe('November 18 reviewed English translations for the official catalog', () => {
  it('shows distinct English major names and preserves the Chinese source wording', () => {
    const names = new Set(bundle.programs.filter(program => program.verifiedAt <= day && program.name.zh && !program.name.en).map(p => p.name.zh!))
    expect(names.size).toBe(64)
    for (const source of names) {
      const translated = findReviewedProgramTranslation(source, 'en')
      expect(translated, source).toBeTruthy()
      expect(translated, source).not.toMatch(han)
      expect(localize({ zh: source }, 'zh')).toBe(source)
    }
    expect(localize({ zh: '财政学' }, 'en')).toBe('Public Finance')
    expect(localize({ zh: '金融学' }, 'en')).toBe('Finance')
    expect(localize({ zh: '园林' }, 'en')).not.toBe(localize({ zh: '风景园林' }, 'en'))
  })
  it('renders every admitted cycle’s eligibility, language, materials and notes in English', () => {
    const observed = new Set<string>()
    for (const cycle of directory.admissionCycles) {
      for (const clause of [...(cycle.eligibility ?? []), ...(cycle.applicationMaterials ?? []), cycle.notes, cycle.tuitionSchedule]) {
        if (clause?.zh && !clause.en) {
          observed.add(clause.zh)
          expect(localize(clause, 'en'), cycle.id).not.toMatch(han)
        }
      }
      for (const requirement of cycle.languageRequirements ?? []) {
        if (requirement.minimum && han.test(requirement.minimum)) {
          observed.add(requirement.minimum)
          expect(localizeProgramText(requirement.minimum, 'en'), cycle.id).not.toMatch(han)
        }
      }
    }
    expect(observed.size).toBeGreaterThan(50)
  })
  it('retains source-specific alternatives, test exemptions and scholarship restrictions', () => {
    const xmu = liveDirectory.admissionCycles.find(row => row.id.includes('xiamen-university-bachelor-chinese-020302'))!
    const minimum = localizeProgramText(xmu.languageRequirements![0].minimum!, 'en')
    expect(minimum).toMatch(/Level 5.*at least 210.*instead of an HSK certificate.*UEC/iu)
    const swu = liveDirectory.admissionCycles.find(row => row.id.includes('southwest-university-animal-science-bachelor-chinese'))!
    expect(swu.eligibility!.map(item => localize(item, 'en')).join(' ')).toMatch(/at least 180.*exempt.*CSCA.*at least 200/iu)
    const scholarship = liveDirectory.scholarships.find(row => row.id === 'scholarship-xmu-new-international-students-bachelor-chinese-2027-first')!
    const summary = localize(scholarship.summary, 'en')
    expect(summary).toMatch(/2,500 per month.*five places are shared/iu)
    expect(summary).toMatch(/April 30, 2027.*English-taught undergraduate programs are excluded/iu)
  })
  it('preserves a contemporary Chinese-only foundation title when no approved English title is available', async () => {
    const program = { ...liveBundle.programs[0], name: { zh: '本科预科生项目' }, degreeLevel: 'foundation' as const }
    const university = liveBundle.universities.find(row => row.id === program.universityId)!
    const expectedName = findReviewedProgramTranslation(program.name.zh, 'en') || program.name.zh
    vi.mocked(getOfficialTitleTranslation).mockClear()
    expect(await officialDisplayName(program, university, 'en')).toBe(expectedName)
    expect(await officialDisplayName(program, university, 'zh')).toBe(program.name.zh)
    if (han.test(expectedName)) expect(getOfficialTitleTranslation).toHaveBeenCalledWith(program, university, 'en')
    expect(program.name).toEqual({ zh: '本科预科生项目' })
  })
})
