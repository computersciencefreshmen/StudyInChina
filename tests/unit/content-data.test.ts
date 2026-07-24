import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { bundleSchema } from '@/lib/data/schema'
import { selectPublishedData } from '@/lib/data/publication'

const content = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})
const published = selectPublishedData(content, '2026-07-20')

describe('published content data', () => {
  it('retains the full candidate catalogue while only publishing reviewed facts', () => {
    expect(content.cities).toHaveLength(12)
    expect(content.universities.length).toBeGreaterThanOrEqual(40)
    expect(content.programs.length).toBeGreaterThanOrEqual(100)
    expect(content.scholarships.length).toBeGreaterThanOrEqual(20)

    expect(published.cities).toHaveLength(12)
    expect(published.universities.length).toBeGreaterThanOrEqual(39)
    expect(published.programs).toHaveLength(4)
    expect(published.admissionCycles).toHaveLength(5)
  })

  it('publishes no incomplete project templates', () => {
    const officialProgramSources = new Map(
      published.sources
        .filter((source) => source.official && source.kind === 'program')
        .map((source) => [source.id, source]),
    )

    for (const program of published.programs) {
      expect(program.details).toBeDefined()
      expect(program.durationMonths).not.toBeNull()
      expect(program.teachingLanguages).not.toContain('To be confirmed')
      expect(program.languageRequirements.length).toBeGreaterThan(0)
      expect(program.programUrl).not.toBe(program.applyUrl)
      expect(program.durationMonthsMax).not.toBeNull()
      expect(program.sourceIds.some((id) => officialProgramSources.get(id)?.url === program.programUrl)).toBe(true)
      expect(published.admissionCycles.some((cycle) => cycle.programId === program.id)).toBe(true)
    }

    for (const cycle of published.admissionCycles) {
      expect(cycle.tuitionCny).not.toBeNull()
      expect(cycle.tuitionPeriod).toBeTruthy()
      expect(cycle.tuitionStatus).toMatch(/^(confirmed|reference)$/)
      expect(cycle.evidenceBasis).toMatch(/^(cycle-specific|recurring-official-rule)$/)
      expect(cycle.applicationFeeCny).not.toBeNull()
    }

    expect(published.programs.map((program) => program.id))
      .not.toContain('program-fudan-university-chinese-language-program-language')
    expect(published.admissionCycles.find((cycle) => cycle.programId === 'program-nanjing-university-chinese-language-program-language')?.evidenceBasis).toBe('recurring-official-rule')
  })

  it('provides English, Chinese and Russian for public names', () => {
    const names = [
      ...content.cities.map((item) => item.name),
      ...content.universities.map((item) => item.name),
      ...content.programs.map((item) => item.name),
      ...content.scholarships.map((item) => item.name),
    ]

    for (const name of names) {
      expect(name.en?.trim()).not.toBe('')
      expect(name.zh?.trim()).not.toBe('')
      expect(name.ru?.trim()).not.toBe('')
    }
  })

  it('uses secure official links for every application path', () => {
    const urls = [
      ...content.universities.flatMap((item) => [item.officialUrl, item.admissionsUrl]),
      ...content.programs.flatMap((item) => [item.programUrl, item.applyUrl]),
      ...content.scholarships.map((item) => item.applicationUrl),
    ]

    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).toMatch(/^https:\/\//)
  })

  it('keeps unannounced dates and fees null instead of presenting estimates as facts', () => {
    const unannounced = content.admissionCycles.filter((cycle) => cycle.dateStatus === 'not-announced')
    expect(unannounced.length).toBeGreaterThan(0)

    for (const cycle of unannounced) {
      expect(cycle.opensOn).toBeNull()
      expect(cycle.closesOn).toBeNull()
    }
  })
})
