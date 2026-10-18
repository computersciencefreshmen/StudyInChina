import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { getApplicationState } from '@/lib/data/admission'
import {
  getFreshnessState,
  getTodayDate,
  isCurrentVerifiedRecord,
  isWithinPostDeadlineGrace,
} from '@/lib/data/freshness'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'

const allData = bundleSchema.parse({ sources, cities, universities, programs, admissionCycles, scholarships })
const TODAY = '2026-07-20'
const CATALOG_AS_OF = '2026-10-19'
const ACTIONABLE_APPLICATION_STATES = new Set([
  'open',
  'upcoming',
  'rolling',
  'dates-published',
])

function publicationFixture(): DataBundle {
  // Synthetic review metadata isolates policy tests from later canonical rechecks.
  const meta = { status: 'verified' as const, verifiedAt: '2026-07-01', reviewAfter: TODAY }
  const city = { ...allData.cities[0], ...meta }
  const university = {
    ...allData.universities.find((item) => item.cityId === city.id)!,
    ...meta,
  }
  const program = {
    ...allData.programs.find((item) => (
      item.universityId === university.id
      && allData.admissionCycles.some((cycle) => cycle.programId === item.id)
    ))!,
    ...meta,
    verificationScope: 'facts' as const,
  }
  const admissionCycle = {
    ...allData.admissionCycles.find((item) => item.programId === program.id)!,
    ...meta,
    opensOn: '2026-07-01',
    closesOn: '2026-07-31',
    dateStatus: 'published' as const,
  }
  const scholarship = {
    ...allData.scholarships[0],
    ...meta,
    deadline: '2026-07-31',
    universityIds: [university.id, 'missing-university'],
    programIds: [program.id, 'missing-program'],
  }
  const sourceIds = new Set([
    ...city.sourceIds,
    ...university.sourceIds,
    ...program.sourceIds,
    ...admissionCycle.sourceIds,
    ...scholarship.sourceIds,
  ])

  return {
    sources: allData.sources.filter((source) => sourceIds.has(source.id)),
    cities: [city],
    universities: [university],
    programs: [program],
    admissionCycles: [admissionCycle],
    scholarships: [scholarship],
  }
}

describe('production publication policy', () => {
  const published = selectPublishedData(allData, CATALOG_AS_OF)

  it('keeps only current verified profile records', () => {
    const profiles = [...published.cities, ...published.universities]
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.every((record) => record.status === 'verified'
      && record.verifiedAt <= CATALOG_AS_OF && record.reviewAfter >= CATALOG_AS_OF)).toBe(true)
  })

  it('keeps unverified templates out while publishing verified identities', () => {
    expect(allData.programs.length).toBeGreaterThanOrEqual(280)
    expect(allData.programs.filter(
      (program) => program.status === 'draft',
    ).length).toBeLessThan(40)
    expect(published.programs.length).toBeGreaterThanOrEqual(240)
    expect(published.programs.filter(
      (program) => program.verificationScope === 'identity' || program.verificationScope === 'facts',
    ).length).toBeGreaterThanOrEqual(240)
    expect(published.programs.every(
      (program) => program.status === 'verified',
    )).toBe(true)

    const publishedCycleIds = new Set(published.admissionCycles.map((cycle) => cycle.id))
    const quarantinedCycles = allData.admissionCycles.filter(
      (cycle) => cycle.status === 'stale' || cycle.reviewAfter < CATALOG_AS_OF,
    )
    const actionableCycles = published.admissionCycles.filter((cycle) => (
      ACTIONABLE_APPLICATION_STATES.has(getApplicationState(cycle, CATALOG_AS_OF))
    ))

    expect(quarantinedCycles.length).toBeGreaterThan(0)
    expect(quarantinedCycles.every((cycle) => !publishedCycleIds.has(cycle.id))).toBe(true)
    // A school need not have an open intake every day. Availability is content,
    // while current evidence and an honest application state are the contract.
    for (const cycle of actionableCycles) {
      expect(cycle.status).toBe('verified')
      expect(cycle.reviewAfter >= CATALOG_AS_OF).toBe(true)
      expect(cycle.verifiedAt <= CATALOG_AS_OF).toBe(true)
      expect(cycle.sourceIds.length).toBeGreaterThan(0)
    }
  })

  it('publishes only records whose related entities remain public', () => {
    expect(published.cities.length).toBeGreaterThanOrEqual(35)
    expect(published.universities.length).toBeGreaterThanOrEqual(119)
    const universityIds = new Set(published.universities.map(item => item.id))
    const programIds = new Set(published.programs.map(item => item.id))
    expect(published.programs.every(item => universityIds.has(item.universityId))).toBe(true)
    expect(published.admissionCycles.every(item => programIds.has(item.programId))).toBe(true)
    expect(published.scholarships.every(item => item.universityIds.every(id => universityIds.has(id))
      && item.programIds.every(id => programIds.has(id)))).toBe(true)
  })

  it('treats reviewAfter as inclusive through the end of that calendar date', () => {
    const fixture = publicationFixture()
    const result = selectPublishedData(fixture, TODAY)

    expect(getFreshnessState({ reviewAfter: TODAY }, TODAY)).toBe('fresh')
    expect(isCurrentVerifiedRecord({ status: 'verified', reviewAfter: TODAY }, TODAY)).toBe(true)
    expect(result.cities).toHaveLength(1)
    expect(result.universities).toHaveLength(1)
    expect(result.programs).toHaveLength(1)
    expect(result.admissionCycles).toHaveLength(1)
    expect(result.scholarships).toHaveLength(1)
  })

  it('quarantines overdue and explicitly stale profiles without rewriting the audit', () => {
    const fixture = publicationFixture()
    fixture.cities[0] = { ...fixture.cities[0], reviewAfter: '2026-07-18' }
    fixture.universities[0] = { ...fixture.universities[0], status: 'stale', reviewAfter: '2026-07-18' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.cities).toEqual([])
    expect(result.universities).toEqual([])
    expect(result.programs).toEqual([])
    expect(fixture.cities[0].status).toBe('verified')
  })

  it('quarantines stale identities and decision facts while retaining raw evidence', () => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], status: 'stale' }
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], status: 'stale' }
    fixture.scholarships[0] = { ...fixture.scholarships[0], status: 'stale' }

    const snapshot = JSON.stringify(fixture)
    const result = selectPublishedData(fixture, TODAY)
    expect(result.programs).toHaveLength(0)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(0)
    expect(JSON.stringify(fixture)).toBe(snapshot)
  })

  it.each(['draft', 'archived'] as const)('excludes %s identities and dynamic records', (status) => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], status }
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], status }
    fixture.scholarships[0] = { ...fixture.scholarships[0], status }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(0)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(0)
  })

  it('withholds identity-only and future-verified programs even with otherwise current parents', () => {
    for (const condition of ['identity-only', 'future-verified'] as const) {
      const fixture = publicationFixture()
      fixture.programs[0] = condition === 'identity-only'
        ? { ...fixture.programs[0], verificationScope: 'identity' }
        : { ...fixture.programs[0], verifiedAt: '2026-07-21', reviewAfter: '2026-07-28' }
      const result = selectPublishedData(fixture, TODAY)
      expect(result.universities, condition).toHaveLength(1)
      expect(result.programs, condition).toEqual([])
      expect(result.admissionCycles, condition).toEqual([])
    }
  })

  it('requires every cited source to be official before publishing a current program', () => {
    const fixture = publicationFixture()
    const unofficial = { ...fixture.sources[0], id: 'source-unofficial-fixture', official: false }
    fixture.sources.push(unofficial)
    fixture.programs[0] = { ...fixture.programs[0], sourceIds: [...fixture.programs[0].sourceIds, unofficial.id] }
    const result = selectPublishedData(fixture, TODAY)
    expect(result.universities).toHaveLength(1)
    expect(result.programs).toEqual([])
    expect(result.admissionCycles).toEqual([])
  })

  it('excludes overdue identities and dynamic facts', () => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], reviewAfter: '2026-07-18' }
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], reviewAfter: '2026-07-18' }
    fixture.scholarships[0] = { ...fixture.scholarships[0], reviewAfter: '2026-07-18' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(0)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(0)
  })

  it('cascades a hidden parent program even when its admission cycle is otherwise current', () => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], status: 'draft' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(0)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships[0].programIds).toEqual([])
  })

  it('keeps a verified program identity when its admission cycle expires', () => {
    const fixture = publicationFixture()
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], reviewAfter: '2026-07-18' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(1)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships[0].programIds).toEqual([fixture.programs[0].id])
  })

  it('keeps a verified identity with no announced cycle distinct from an expired cycle', () => {
    const fixture = publicationFixture()
    fixture.admissionCycles = []

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs.map((program) => program.id)).toEqual([fixture.programs[0].id])
    expect(result.admissionCycles).toEqual([])
  })

  it('filters relationship IDs and sources to the records that remain published', () => {
    const fixture = publicationFixture()
    const result = selectPublishedData(fixture, TODAY)
    const expectedSourceIds = new Set([
      ...result.cities.flatMap((item) => item.sourceIds),
      ...result.universities.flatMap((item) => item.sourceIds),
      ...result.programs.flatMap((item) => item.sourceIds),
      ...result.admissionCycles.flatMap((item) => item.sourceIds),
      ...result.scholarships.flatMap((item) => item.sourceIds),
    ])

    expect(result.scholarships[0].universityIds).toEqual([fixture.universities[0].id])
    expect(result.scholarships[0].programIds).toEqual([fixture.programs[0].id])
    expect(result.sources.map((source) => source.id).sort()).toEqual([...expectedSourceIds].sort())
  })

  it('uses the China calendar date when deriving today at runtime', () => {
    expect(getTodayDate(new Date('2026-07-19T16:00:00.000Z'))).toBe(TODAY)
  })

  it('keeps the grace utility separate from immediate public deadline expiry', () => {
    expect(isWithinPostDeadlineGrace('2026-06-20', TODAY)).toBe(true)
    expect(isWithinPostDeadlineGrace('2026-06-19', TODAY)).toBe(false)

    const fixture = publicationFixture()
    fixture.admissionCycles[0] = {
      ...fixture.admissionCycles[0],
      closesOn: '2026-07-19',
      dateStatus: 'published',
    }
    fixture.scholarships[0] = { ...fixture.scholarships[0], deadline: '2026-07-19' }

    const result = selectPublishedData(fixture, TODAY)
    expect(result.programs).toHaveLength(1)
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(0)
  })

  it('keeps rolling and officially unannounced deadlines public', () => {
    const fixture = publicationFixture()
    fixture.admissionCycles[0] = {
      ...fixture.admissionCycles[0],
      closesOn: null,
      dateStatus: 'rolling',
    }
    fixture.scholarships[0] = { ...fixture.scholarships[0], deadline: null }

    const result = selectPublishedData(fixture, TODAY)
    expect(result.programs).toHaveLength(1)
    expect(result.admissionCycles).toHaveLength(1)
    expect(result.scholarships).toHaveLength(1)
  })
})
