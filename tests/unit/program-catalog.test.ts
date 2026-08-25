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

  it('rejects unsupported filter values instead of passing them to queries', () => {
    const filters = parseProgramCatalogFilters({ degree: 'invalid', scholarship: 'anything', sort: 'drop-table' })

    expect(filters.degree).toBe('')
    expect(filters.scholarship).toBe('')
    expect(filters.sort).toBe('default')
  })
})
