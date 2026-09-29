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

function reviewedCycleFixture() {
  const data = readLegacyBundle()
  const cycleIds = new Set(reviewedCycles.map((cycle) => cycle.id))
  const programIds = new Set(reviewedCycles.map((cycle) => cycle.programId))
  data.admissionCycles = [
    ...data.admissionCycles.filter((cycle) => !cycleIds.has(cycle.id)),
    ...reviewedCycles,
  ]
  data.programs = data.programs.map((program) => programIds.has(program.id)
    ? { ...program, status: 'stale' }
    : program)
  return data
}

describe('September 28 official cycle review', () => {
  it('publishes four exact SIGS cycle fees without renewing old program facts', () => {
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
      expect(published.programs.find((item) => item.id === cycle.programId)).toMatchObject({
        status: 'stale', durationMonths: null, teachingLanguages: [],
        languageRequirements: [], applyUrl: null,
      })
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
