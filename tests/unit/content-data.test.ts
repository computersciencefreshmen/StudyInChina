import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { bundleSchema } from '@/lib/data/schema'

const content = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

describe('published content data', () => {
  it('meets the first-release catalogue targets', () => {
    expect(content.cities).toHaveLength(12)
    expect(content.universities.length).toBeGreaterThanOrEqual(40)
    expect(content.programs.length).toBeGreaterThanOrEqual(100)
    expect(content.scholarships.length).toBeGreaterThanOrEqual(20)
  })

  it('provides English, Chinese and Russian for public names', () => {
    const names = [
      ...content.cities.map((item) => item.name),
      ...content.universities.map((item) => item.name),
      ...content.programs.map((item) => item.name),
      ...content.scholarships.map((item) => item.name),
    ]

    for (const name of names) {
      expect(name.en.trim()).not.toBe('')
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
