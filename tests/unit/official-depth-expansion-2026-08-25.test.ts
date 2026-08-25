import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'

const TODAY = '2026-08-25'
const LOCALES = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const

const PROGRAM_IDS = [
  'program-cug-wuhan-business-administration-high-level-postgraduate-master',
  'program-guangzhou-medical-university-medical-fields-academic-doctorate',
  'program-guizhou-medical-university-nursing-asean-cgs-bachelor',
  'program-guizhou-medical-university-preventive-medicine-asean-cgs-bachelor',
  'program-guizhou-medical-university-medical-laboratory-technology-asean-cgs-bachelor',
  'program-jiangxi-normal-university-business-administration-english-bachelor',
  'program-jiangxi-normal-university-international-economics-and-trade-english-bachelor',
  'program-jiangxi-normal-university-computer-science-and-technology-english-bachelor',
  'program-wuhan-textile-university-textile-engineering-english-master',
  'program-wuhan-textile-university-computer-science-and-technology-english-master',
  'program-wuhan-textile-university-business-administration-english-master',
] as const

const HISTORICAL_CYCLE_IDS = [
  'cycle-2026-cug-business-administration-high-level-postgraduate',
  'cycle-2026-gzhmu-medical-fields-academic-doctorate',
  'cycle-2026-guizhou-medical-university-nursing-asean-cgs-bachelor',
  'cycle-2026-guizhou-medical-university-preventive-medicine-asean-cgs-bachelor',
  'cycle-2026-guizhou-medical-university-medical-laboratory-technology-asean-cgs-bachelor',
] as const

const SCHOLARSHIP_IDS = [
  'scholarship-cug-international-chinese-language-teachers-2026',
  'scholarship-jxnu-international-student-university-scholarship',
  'scholarship-wtu-hubei-provincial-international-students',
  'scholarship-wtu-university-international-students',
] as const

const data = bundleSchema.parse({
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
})
const published = selectPublishedData(data, TODAY)
const sourceById = new Map(data.sources.map((source) => [source.id, source]))

function expectOfficialSources(sourceIds: string[], label: string): void {
  expect(sourceIds.length, label).toBeGreaterThan(0)
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId)
    expect(source, `${label}:${sourceId}`).toBeDefined()
    expect(source?.official, `${label}:${sourceId}`).toBe(true)
    expect(source?.accessedAt, `${label}:${sourceId}`).toBe(TODAY)

    const url = new URL(source?.url ?? 'http://invalid.local')
    expect(url.protocol, `${label}:${sourceId}`).toBe('https:')
    expect(url.hostname.endsWith('.edu.cn'), `${label}:${sourceId}`).toBe(true)
  }
}

function expectSixLanguageName(
  name: Partial<Record<typeof LOCALES[number], string>>,
  label: string,
): void {
  for (const locale of LOCALES) {
    expect(name[locale]?.trim(), `${label}:${locale}`).toBeTruthy()
  }
}

describe('official depth expansion on 2026-08-25', () => {
  it('publishes all eleven verified programs with six-language names and official evidence', () => {
    expect(new Set(PROGRAM_IDS).size).toBe(11)

    for (const id of PROGRAM_IDS) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      expect(program?.status, id).toBe('verified')
      expect((program?.reviewAfter ?? '').localeCompare(TODAY) >= 0, id).toBe(true)
      expectSixLanguageName(program?.name ?? {}, id)
      expectOfficialSources(program?.sourceIds ?? [], id)
      expect(published.programs.some((item) => item.id === id), id).toBe(true)
    }
  })

  it('retains five closed cycles only as stale previous-cycle references', () => {
    expect(new Set(HISTORICAL_CYCLE_IDS).size).toBe(5)

    for (const id of HISTORICAL_CYCLE_IDS) {
      const cycle = data.admissionCycles.find((item) => item.id === id)
      expect(cycle, id).toBeDefined()
      expect(cycle?.status, id).toBe('stale')
      expect(cycle?.dateStatus, id).toBe('previous-cycle-reference')
      expectOfficialSources(cycle?.sourceIds ?? [], id)
      expect(published.admissionCycles.some((item) => item.id === id), id).toBe(false)
    }
  })

  it('publishes four grounded scholarships with conservative deadlines and WTU scope', () => {
    expect(new Set(SCHOLARSHIP_IDS).size).toBe(4)

    for (const id of SCHOLARSHIP_IDS) {
      const scholarship = data.scholarships.find((item) => item.id === id)
      expect(scholarship, id).toBeDefined()
      expect(scholarship?.status, id).toBe('verified')
      expect((scholarship?.reviewAfter ?? '').localeCompare(TODAY) >= 0, id).toBe(true)
      expectSixLanguageName(scholarship?.name ?? {}, id)
      expectOfficialSources(scholarship?.sourceIds ?? [], id)
      expect(published.scholarships.some((item) => item.id === id), id).toBe(true)
    }

    const cugIclt = data.scholarships.find(
      (item) => item.id === 'scholarship-cug-international-chinese-language-teachers-2026',
    )
    expect(cugIclt?.deadline).toBeNull()

    for (const id of [
      'scholarship-wtu-hubei-provincial-international-students',
      'scholarship-wtu-university-international-students',
    ]) {
      const scholarship = data.scholarships.find((item) => item.id === id)
      expect(scholarship?.universityIds, id).toEqual(['uni-wuhan-textile-university'])
      expect(scholarship?.programIds, id).toEqual([])

      const publicScholarship = published.scholarships.find((item) => item.id === id)
      expect(publicScholarship?.universityIds, id).toEqual(['uni-wuhan-textile-university'])
    }
  })

  it('raises the targeted public university depth without inflating the Tibet limited case', () => {
    const universityBySlug = new Map(
      published.universities.map((university) => [university.slug, university]),
    )
    const programCounts = new Map<string, number>()
    for (const program of published.programs) {
      programCounts.set(
        program.universityId,
        (programCounts.get(program.universityId) ?? 0) + 1,
      )
    }

    const minimums = new Map<string, number>([
      ['china-university-of-geosciences-wuhan', 3],
      ['guangzhou-medical-university', 3],
      ['guizhou-medical-university', 5],
      ['jiangxi-normal-university', 5],
      ['wuhan-textile-university', 5],
    ])
    for (const [slug, minimum] of minimums) {
      const university = universityBySlug.get(slug)
      expect(university, slug).toBeDefined()
      expect(programCounts.get(university?.id ?? ''), slug).toBeGreaterThanOrEqual(minimum)
    }

    const tibet = universityBySlug.get('tibet-university')
    expect(tibet).toBeDefined()
    expect(programCounts.get(tibet?.id ?? ''), 'tibet-university').toBe(1)
  })
})
