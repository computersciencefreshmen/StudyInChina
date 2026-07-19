import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'

const allData = bundleSchema.parse({ sources, cities, universities, programs, admissionCycles, scholarships })

describe('production publication policy', () => {
  const published = selectPublishedData(allData)

  it('only exposes verified or stale records', () => {
    const records = [...published.cities, ...published.universities, ...published.programs, ...published.admissionCycles, ...published.scholarships]
    expect(records.every((record) => record.status === 'verified' || record.status === 'stale')).toBe(true)
  })

  it('keeps the unverified program templates out of the public catalogue', () => {
    expect(allData.programs.length).toBe(120)
    expect(published.programs).toHaveLength(0)
    expect(published.admissionCycles).toHaveLength(0)
  })

  it('publishes only records whose related entities remain public', () => {
    expect(published.cities).toHaveLength(12)
    expect(published.universities).toHaveLength(39)
    expect(published.scholarships).toHaveLength(2)
  })
})
