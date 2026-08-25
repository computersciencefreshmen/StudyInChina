import { describe, expect, it } from 'vitest'
import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import type { DataBundle } from '@/lib/data/types'
import {
  parseProgramCatalogFilters,
  programCatalogHref,
  queryProgramCatalog,
} from '@/lib/program-catalog'

const data = {
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
} as DataBundle

function tuitionFixture(): DataBundle {
  const fixturePrograms = data.programs.slice(0, 4).map((program, index) => ({
    ...program,
    id: `tuition-program-${index + 1}`,
    slug: `tuition-program-${index + 1}`,
    name: { en: `Tuition program ${index + 1}` },
    status: 'verified' as const,
  }))
  const cycleFacts = [
    { tuitionCny: 50_000, tuitionStatus: 'reference' as const },
    { tuitionCny: 30_000, tuitionStatus: 'confirmed' as const },
    { tuitionCny: null, tuitionStatus: null },
    { tuitionCny: 10_000, tuitionStatus: 'confirmed' as const },
  ]

  return {
    ...data,
    programs: fixturePrograms,
    admissionCycles: fixturePrograms.map((program, index) => ({
      id: `tuition-cycle-${index + 1}`,
      programId: program.id,
      academicYear: '2026-2027',
      intake: 'autumn' as const,
      opensOn: null,
      closesOn: null,
      dateStatus: 'not-announced' as const,
      tuitionPeriod: cycleFacts[index]!.tuitionCny === null
        ? null
        : 'academic-year' as const,
      applicationFeeCny: null,
      sourceIds: [],
      verifiedAt: '2026-08-25',
      reviewAfter: '2026-09-25',
      status: 'verified' as const,
      ...cycleFacts[index]!,
    })),
  }
}

describe('server-side program catalogue', () => {
  it('normalizes filters and returns only the requested 24-record page', () => {
    const filters = parseProgramCatalogFilters({ discipline: 'engineering', page: '1' })
    const result = queryProgramCatalog(data, filters, '2026-08-05')

    expect(filters.discipline).toBe('engineering-technology')
    expect(result.total).toBeGreaterThan(24)
    expect(result.items).toHaveLength(24)
    expect(result.items.every(({ program }) => program.id && program.universityId)).toBe(true)
  })

  it('preserves shareable filters while changing pages', () => {
    const filters = parseProgramCatalogFilters({
      q: 'Chinese',
      degree: 'master',
      city: 'beijing',
      scholarship: 'linked',
      sort: 'deadline',
    })
    const href = programCatalogHref('en', filters, 2)

    expect(href).toContain('/en/programs?')
    expect(href).toContain('q=Chinese')
    expect(href).toContain('degree=master')
    expect(href).toContain('city=beijing')
    expect(href).toContain('scholarship=linked')
    expect(href).toContain('sort=deadline')
    expect(href).toContain('page=2')
  })

  it('keeps stale identities browseable without classifying them as current unknown facts', () => {
    const staleProgram = {
      ...data.programs[0],
      status: 'stale' as const,
      teachingLanguages: [],
      durationMonths: null,
      applyUrl: null,
      languageRequirements: [],
    }
    const fixture = { ...data, programs: [staleProgram], admissionCycles: [] }

    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({}),
      '2026-08-25',
    ).total).toBe(1)
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ applicationState: 'not-announced' }),
      '2026-08-25',
    ).total).toBe(0)
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: 'unknown' }),
      '2026-08-25',
    ).total).toBe(0)
  })

  it('treats reference tuition as unknown rather than as a current known or ranged fee', () => {
    const fixture = tuitionFixture()

    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: 'known' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual([
      'tuition-program-2',
      'tuition-program-4',
    ])
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: 'unknown' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual([
      'tuition-program-1',
      'tuition-program-3',
    ])
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: 'under-20000' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual(['tuition-program-4'])
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: '20000-40000' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual(['tuition-program-2'])
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ tuition: 'over-40000' }),
      '2026-08-25',
    ).total).toBe(0)
  })

  it('sorts only confirmed current tuition and keeps reference and unknown fees stably last', () => {
    const fixture = tuitionFixture()

    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ sort: 'tuition-asc' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual([
      'tuition-program-4',
      'tuition-program-2',
      'tuition-program-1',
      'tuition-program-3',
    ])
    expect(queryProgramCatalog(
      fixture,
      parseProgramCatalogFilters({ sort: 'tuition-desc' }),
      '2026-08-25',
    ).items.map(({ program }) => program.id)).toEqual([
      'tuition-program-2',
      'tuition-program-4',
      'tuition-program-1',
      'tuition-program-3',
    ])
  })

  it('rejects unsupported filter values instead of passing them to queries', () => {
    const filters = parseProgramCatalogFilters({ degree: 'invalid', scholarship: 'anything', sort: 'drop-table' })

    expect(filters.degree).toBe('')
    expect(filters.scholarship).toBe('')
    expect(filters.sort).toBe('default')
  })
})
