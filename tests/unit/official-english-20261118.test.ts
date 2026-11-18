import { describe, expect, it } from 'vitest'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { findReviewedProgramTranslation, localize, localizeProgramText } from '@/lib/data/format'

const day = '2026-11-18'
const bundle = loadMaintenanceBundle(process.cwd())
const directory = getPublicCatalogSnapshot(bundle, day).directory
const han = /[\u3400-\u9fff]/u

describe('November 18 reviewed English translations for the official catalog', () => {
  it('shows distinct English major names and preserves the Chinese source wording', () => {
    const names = new Set(bundle.programs.filter(program => program.verifiedAt <= day && program.name.zh && !program.name.en).map(p => p.name.zh!))
    expect(names.size).toBeGreaterThanOrEqual(64)
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
    const xmu = directory.admissionCycles.find(row => row.id.includes('xiamen-university-bachelor-chinese-020302'))!
    const minimum = localizeProgramText(xmu.languageRequirements![0].minimum!, 'en')
    expect(minimum).toMatch(/Level 5.*at least 210.*instead of an HSK certificate.*UEC/iu)
    const swu = directory.admissionCycles.find(row => row.id.includes('southwest-university-animal-science-bachelor-chinese'))!
    expect(swu.eligibility!.map(item => localize(item, 'en')).join(' ')).toMatch(/at least 180.*exempt.*CSCA.*at least 200/iu)
    const scholarship = directory.scholarships.find(row => row.id === 'scholarship-xmu-new-international-students-bachelor-chinese-2027-first')!
    const summary = localize(scholarship.summary, 'en')
    expect(summary).toMatch(/2,500 per month.*five places are shared/iu)
    expect(summary).toMatch(/April 30, 2027.*English-taught undergraduate programs are excluded/iu)
  })
})
