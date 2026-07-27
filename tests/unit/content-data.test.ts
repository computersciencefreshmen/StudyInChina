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
  it('publishes the expanded institution and official program-identity layer', () => {
    expect(content.cities.length).toBeGreaterThanOrEqual(35)
    expect(content.universities.length).toBeGreaterThanOrEqual(120)
    expect(content.programs.length).toBeGreaterThanOrEqual(280)
    expect(content.scholarships.length).toBeGreaterThanOrEqual(20)

    expect(published.cities.length).toBeGreaterThanOrEqual(35)
    expect(published.universities.length).toBeGreaterThanOrEqual(119)
    expect(published.programs.length).toBeGreaterThanOrEqual(240)
    expect(published.admissionCycles.length).toBeGreaterThanOrEqual(30)
    expect(published.programs.filter(
      (program) => program.verificationScope === 'identity' || program.verificationScope === 'facts',
    ).length).toBeGreaterThanOrEqual(240)
  })

  it('separates verified identities from complete program and cycle facts', () => {
    const officialProgramSources = new Map(
      published.sources
        .filter((source) => source.official && source.kind === 'program')
        .map((source) => [source.id, source]),
    )

    for (const program of published.programs) {
      expect(program.teachingLanguages).not.toContain('To be confirmed')
      expect(program.sourceIds.some(
        (id) => officialProgramSources.get(id)?.url === program.programUrl,
      )).toBe(true)
      if (program.verificationScope === 'identity') {
        expect(program.details).toBeUndefined()
        expect(program.durationMonths).toBeNull()
        expect(program.languageRequirements).toHaveLength(0)
        continue
      }
      if (program.verificationScope === 'facts') {
        expect(program.details).toBeUndefined()
        expect(program.durationMonths).not.toBeNull()
        continue
      }
      expect(program.details).toBeDefined()
      expect(program.durationMonths).not.toBeNull()
      expect(program.languageRequirements.length).toBeGreaterThan(0)
      expect(program.programUrl).not.toBe(program.applyUrl)
      expect(program.durationMonthsMax).not.toBeNull()
      expect(published.admissionCycles.some(
        (cycle) => cycle.programId === program.id,
      )).toBe(true)
    }

    for (const cycle of published.admissionCycles) {
      expect(cycle.evidenceBasis).toMatch(/^(cycle-specific|recurring-official-rule)$/)
      if (cycle.factScope === 'dates-only') {
        expect(cycle.tuitionCny).toBeNull()
        expect(cycle.applicationFeeCny).toBeNull()
        expect(cycle.dateStatus).toMatch(/^(published|rolling)$/)
        continue
      }
      if (cycle.factScope === 'partial') {
        expect(
          cycle.tuitionCny !== null || cycle.applicationFeeCny !== null,
        ).toBe(true)
        continue
      }
      expect(cycle.tuitionCny).not.toBeNull()
      expect(cycle.tuitionPeriod).toBeTruthy()
      expect(cycle.tuitionStatus).toMatch(/^(confirmed|reference)$/)
      expect(cycle.applicationFeeCny).not.toBeNull()
    }

    expect(published.programs.map((program) => program.id))
      .not.toContain('program-fudan-university-chinese-language-program-language')
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
      expect(name.ru).not.toMatch(/translation pending/i)
    }
  })

  it('uses secure official links for every application path', () => {
    const urls = [
      ...content.universities.flatMap(
        (item) => [item.officialUrl, item.admissionsUrl],
      ),
      ...content.programs.flatMap(
        (item) => [item.programUrl, item.applyUrl],
      ),
      ...content.scholarships.map((item) => item.applicationUrl),
    ].filter((url): url is string => typeof url === 'string')

    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).toMatch(/^https:\/\//)
  })

  it('keeps unannounced dates and fees null instead of presenting estimates as facts', () => {
    const unannounced = content.admissionCycles.filter(
      (cycle) => cycle.dateStatus === 'not-announced',
    )
    expect(unannounced.length).toBeGreaterThan(0)

    for (const cycle of unannounced) {
      expect(cycle.opensOn).toBeNull()
      expect(cycle.closesOn).toBeNull()
    }
  })
})