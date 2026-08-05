import { describe, expect, it } from 'vitest'
import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import type { DataBundle, Scholarship } from '@/lib/data/types'
import {
  parseScholarshipCatalogFilters,
  queryScholarshipCatalog,
  scholarshipCatalogHref,
  selectScholarshipCurrentCycle,
} from '@/lib/scholarship-catalog'

const data = {
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
} as DataBundle

describe('server-side scholarship catalogue', () => {
  it('returns only one 24-record page and a deterministic legacy current cycle', () => {
    const filters = parseScholarshipCatalogFilters({ page: '1' })
    const result = queryScholarshipCatalog(data, filters, '2026-08-05')

    expect(result.total).toBeGreaterThan(24)
    expect(result.items).toHaveLength(24)
    expect(result.items.every(({ currentCycle, scholarship }) => (
      currentCycle.id === `legacy:${scholarship.id}`
      && currentCycle.scholarshipId === scholarship.id
    ))).toBe(true)
  })

  it('caps internal page-size overrides at 100 records', () => {
    const filters = parseScholarshipCatalogFilters({})
    const result = queryScholarshipCatalog(data, filters, '2026-08-05', 1_000)

    expect(result.pageSize).toBe(100)
    expect(result.items).toHaveLength(100)
  })

  it('filters funding and linked degree levels using explicit structured facts', () => {
    const filters = parseScholarshipCatalogFilters({
      degree: 'master',
      funding: 'full-tuition',
    })
    const result = queryScholarshipCatalog(data, filters, '2026-08-05', 100)

    expect(result.total).toBeGreaterThan(0)
    expect(result.items.every(({ scholarship, programs: linkedPrograms }) => (
      scholarship.coverage.tuition === 'full'
      && linkedPrograms.some((program) => program.degreeLevel === 'master')
    ))).toBe(true)
  })

  it('does not infer missing scholarship cycle facts', () => {
    const scholarship = {
      ...data.scholarships[0],
      deadline: null,
    } as Scholarship
    const cycle = selectScholarshipCurrentCycle(scholarship, '2026-08-05')

    expect(cycle).toMatchObject({
      academicYear: null,
      opensOn: null,
      closesOn: null,
      deadlineState: 'not-announced',
      daysRemaining: null,
      legacy: true,
    })
  })

  it('preserves shareable filters while changing pages', () => {
    const filters = parseScholarshipCatalogFilters({
      q: 'government',
      institution: 'peking-university',
      degree: 'doctorate',
      funding: 'stipend',
      deadline: 'future',
      sort: 'deadline',
    })
    const href = scholarshipCatalogHref('en', filters, 2)

    expect(href).toContain('/en/scholarships?')
    expect(href).toContain('q=government')
    expect(href).toContain('institution=peking-university')
    expect(href).toContain('degree=doctorate')
    expect(href).toContain('funding=stipend')
    expect(href).toContain('deadline=future')
    expect(href).toContain('sort=deadline')
    expect(href).toContain('page=2')
  })

  it('rejects unsupported filter values instead of passing them to queries', () => {
    const filters = parseScholarshipCatalogFilters({
      degree: 'invalid',
      funding: 'drop-table',
      deadline: 'someday',
      sort: 'random',
    })

    expect(filters.degree).toBe('')
    expect(filters.funding).toBe('')
    expect(filters.deadline).toBe('')
    expect(filters.sort).toBe('default')
  })
})
