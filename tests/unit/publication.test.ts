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
const CATALOG_AS_OF = getTodayDate()
const ACTIONABLE_APPLICATION_STATES = new Set([
  'open',
  'upcoming',
  'rolling',
  'dates-published',
])

function publicationFixture(): DataBundle {
  const city = { ...allData.cities[0], status: 'verified' as const, reviewAfter: TODAY }
  const university = {
    ...allData.universities.find((item) => item.cityId === city.id)!,
    status: 'verified' as const,
    reviewAfter: TODAY,
  }
  const program = {
    ...allData.programs.find((item) => (
      item.universityId === university.id
      && allData.admissionCycles.some((cycle) => cycle.programId === item.id)
    ))!,
    status: 'verified' as const,
    reviewAfter: TODAY,
  }
  const admissionCycle = {
    ...allData.admissionCycles.find((item) => item.programId === program.id)!,
    status: 'verified' as const,
    reviewAfter: TODAY,
  }
  const scholarship = {
    ...allData.scholarships[0],
    status: 'verified' as const,
    reviewAfter: TODAY,
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

  it('keeps only verified or stale profile records', () => {
    const profiles = [...published.cities, ...published.universities]
    expect(profiles.every((record) => record.status === 'verified' || record.status === 'stale')).toBe(true)
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
      (program) => program.status === 'verified' || program.status === 'stale',
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
    expect(actionableCycles.length).toBeGreaterThan(0)
  })

  it('publishes only records whose related entities remain public', () => {
    expect(published.cities.length).toBeGreaterThanOrEqual(35)
    expect(published.universities.length).toBeGreaterThanOrEqual(119)
    expect(published.scholarships.length).toBeGreaterThanOrEqual(10)
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

  it('keeps overdue and explicitly stale profiles but maps overdue verified profiles to stale', () => {
    const fixture = publicationFixture()
    fixture.cities[0] = { ...fixture.cities[0], reviewAfter: '2026-07-18' }
    fixture.universities[0] = { ...fixture.universities[0], status: 'stale', reviewAfter: '2026-07-18' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.cities[0].status).toBe('stale')
    expect(result.universities[0].status).toBe('stale')
    expect(fixture.cities[0].status).toBe('verified')
  })

  it('keeps stale identities discoverable while masking stale decision facts', () => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], status: 'stale' }
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], status: 'stale' }
    fixture.scholarships[0] = { ...fixture.scholarships[0], status: 'stale' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(1)
    expect(result.programs[0]).toMatchObject({
      status: 'stale',
      teachingLanguages: [],
      durationMonths: null,
      applyUrl: null,
      languageRequirements: [],
      verificationScope: 'identity',
    })
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(1)
    expect(result.scholarships[0]).toMatchObject({
      status: 'stale',
      deadline: null,
      applicationUrl: null,
      summary: null,
      coverage: {
        tuition: 'unknown',
        accommodation: 'unknown',
        insurance: 'unknown',
        stipendCnyPerMonth: null,
      },
    })
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

  it('keeps overdue identities but excludes overdue dynamic facts', () => {
    const fixture = publicationFixture()
    fixture.programs[0] = { ...fixture.programs[0], reviewAfter: '2026-07-18' }
    fixture.admissionCycles[0] = { ...fixture.admissionCycles[0], reviewAfter: '2026-07-18' }
    fixture.scholarships[0] = { ...fixture.scholarships[0], reviewAfter: '2026-07-18' }

    const result = selectPublishedData(fixture, TODAY)

    expect(result.programs).toHaveLength(1)
    expect(result.programs[0].status).toBe('stale')
    expect(result.programs[0].durationMonths).toBeNull()
    expect(result.admissionCycles).toHaveLength(0)
    expect(result.scholarships).toHaveLength(1)
    expect(result.scholarships[0].status).toBe('stale')
    expect(result.scholarships[0].deadline).toBeNull()
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

  it('keeps a deadline through day 30 and removes expired cycles and scholarships on day 31', () => {
    expect(isWithinPostDeadlineGrace('2026-06-20', TODAY)).toBe(true)
    expect(isWithinPostDeadlineGrace('2026-06-19', TODAY)).toBe(false)

    const fixture = publicationFixture()
    fixture.admissionCycles[0] = {
      ...fixture.admissionCycles[0],
      closesOn: '2026-06-19',
      dateStatus: 'published',
    }
    fixture.scholarships[0] = { ...fixture.scholarships[0], deadline: '2026-06-19' }

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
