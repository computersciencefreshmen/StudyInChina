import { describe, expect, it } from 'vitest'
import review from '../../quality/audit-2026-09-28-data-changes.json'
import { readLegacyBundle } from '../../scripts/catalog/build-release'
import { selectPublishedData } from '@/lib/data/publication'
import { admissionCycleSchema } from '@/lib/data/schema'

// Replay the immutable reviewed cycle payload, not the current status of a live
// record that must legitimately expire or be reviewed again in a later release.
const reviewedCycles = review.changes
  .filter((change) => change.collection === 'admissionCycles' && change.before === null)
  .map((change) => admissionCycleSchema.parse(change.after))

function reviewedCycleFixture(staleParents = false) {
  const data = readLegacyBundle()
  const cycleIds = new Set(reviewedCycles.map((cycle) => cycle.id))
  const programIds = new Set(reviewedCycles.map((cycle) => cycle.programId))
  data.admissionCycles = [
    ...data.admissionCycles.filter((cycle) => !cycleIds.has(cycle.id)),
    ...reviewedCycles,
  ]
  // Synthetic current parents test the reviewed payload independently from
  // future canonical rechecks. No production review timestamp is changed.
  const parentMeta = { status: 'verified' as const, verifiedAt: '2026-09-28', reviewAfter: '2026-10-28' }
  data.programs = data.programs.filter(program => programIds.has(program.id))
    .map(program => ({ ...program, ...parentMeta, verificationScope: 'facts' as const,
      teachingLanguages: ['English'], status: staleParents ? 'stale' as const : 'verified' as const }))
  const universityIds = new Set(data.programs.map(program => program.universityId))
  data.universities = data.universities.filter(item => universityIds.has(item.id)).map(item => ({ ...item, ...parentMeta }))
  const cityIds = new Set(data.universities.map(item => item.cityId))
  data.cities = data.cities.filter(item => cityIds.has(item.id)).map(item => ({ ...item, ...parentMeta }))
  return data
}

describe('September 28 official cycle review', () => {
  it('publishes four exact reviewed SIGS fees when every synthetic parent is current', () => {
    expect(reviewedCycles.map((cycle) => [cycle.id, cycle.tuitionCny])).toEqual([
      ['cycle-thu-sigs-0830j2-autumn-2027', 40000],
      ['cycle-thu-sigs-0812j3-autumn-2027', 40000],
      ['cycle-thu-sigs-085700-autumn-2027', 62000],
      ['cycle-thu-sigs-125604-autumn-2027', 30000],
    ])
    const published = selectPublishedData(reviewedCycleFixture(), '2026-09-28')
    for (const cycle of reviewedCycles) {
      expect(published.admissionCycles.find((item) => item.id === cycle.id)).toMatchObject({
        opensOn: '2026-09-18', closesOn: '2027-05-15', tuitionCny: cycle.tuitionCny,
        tuitionPeriod: 'academic-year', applicationFeeCny: 800,
        verifiedAt: '2026-09-28', sourceIds: ['src-thu-sigs-international-graduate-2027'],
      })
      expect(published.programs.find((item) => item.id === cycle.programId)?.status).toBe('verified')
    }
  })

  it('withholds otherwise reviewed fees when their parent program remains stale', () => {
    const fixture = reviewedCycleFixture(true)
    const published = selectPublishedData(fixture, '2026-09-28')
    for (const cycle of reviewedCycles) {
      expect(fixture.admissionCycles.find(item => item.id === cycle.id)?.tuitionCny).toBe(cycle.tuitionCny)
      expect(published.admissionCycles.some(item => item.id === cycle.id)).toBe(false)
      expect(published.programs.some(item => item.id === cycle.programId)).toBe(false)
    }
  })

  it('withholds reviewed cycle fees once their review deadline passes', () => {
    const published = selectPublishedData(reviewedCycleFixture(), '2026-10-06')
    for (const cycle of reviewedCycles) {
      expect(published.admissionCycles.some((item) => item.id === cycle.id)).toBe(false)
      expect(published.programs.some((item) => item.id === cycle.programId)).toBe(true)
    }
  })
})
