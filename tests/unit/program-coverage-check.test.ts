import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import {
  buildProgramCoverageReport,
  coverageExitCode,
  renderProgramCoverageMarkdown,
} from '../../scripts/quality/check-program-coverage'
import { bundleSchema } from '../../src/lib/data/schema'
import type {
  AdmissionCycle,
  City,
  DataBundle,
  Program,
  University,
} from '../../src/lib/data/types'

const TODAY = '2026-07-30'
const CURRENT_META = {
  sourceIds: ['source-program-coverage-fixture'],
  verifiedAt: '2026-07-01',
  reviewAfter: '2026-07-31',
}

function city(): City {
  return {
    ...CURRENT_META,
    id: 'city-coverage',
    slug: 'coverage-city',
    name: { zh: '覆盖市', en: 'Coverage City' },
    province: null,
    region: 'east',
    coordinates: null,
    overview: null,
    climate: null,
    foodHighlights: [],
    sights: [],
    status: 'verified',
  }
}

function university(id: string, index: number): University {
  return {
    ...CURRENT_META,
    id,
    slug: id,
    name: { zh: `覆盖大学${index}`, en: `Coverage University ${index}` },
    cityId: 'city-coverage',
    region: 'east',
    officialUrl: `https://example.edu/${id}`,
    admissionsUrl: `https://example.edu/${id}/admissions`,
    summary: null,
    featured: false,
    status: 'verified',
  }
}

function program(
  id: string,
  universityId: string,
  status: Program['status'] = 'verified',
): Program {
  return {
    ...CURRENT_META,
    id,
    slug: id,
    universityId,
    name: { zh: id, en: id },
    degreeLevel: 'master',
    discipline: 'other',
    teachingLanguages: ['English'],
    durationMonths: null,
    programUrl: `https://example.edu/programs/${id}`,
    applyUrl: null,
    languageRequirements: [],
    verificationScope: 'identity',
    status,
  }
}

function expiredCycle(id: string, programId: string): AdmissionCycle {
  return {
    ...CURRENT_META,
    id,
    programId,
    academicYear: '2026-2027',
    intake: 'autumn',
    opensOn: '2026-01-01',
    closesOn: '2026-05-01',
    dateStatus: 'published',
    tuitionCny: null,
    applicationFeeCny: null,
    evidenceBasis: 'cycle-specific',
    factScope: 'dates-only',
    status: 'verified',
  }
}

function coverageFixture(): DataBundle {
  const fixtureUniversities = [
    university('university-no-identity', 1),
    university('university-draft', 2),
    university('university-expired', 3),
    university('university-one', 4),
    university('university-two', 5),
  ]
  const fixturePrograms = [
    program('draft-program', 'university-draft', 'draft'),
    program('expired-program', 'university-expired'),
    program('one-visible', 'university-one'),
    program('two-visible-a', 'university-two'),
    program('two-visible-b', 'university-two'),
    program('two-expired', 'university-two'),
  ]

  return {
    sources: [],
    cities: [city()],
    universities: fixtureUniversities,
    programs: fixturePrograms,
    admissionCycles: [
      expiredCycle('expired-cycle', 'expired-program'),
      expiredCycle('two-expired-cycle', 'two-expired'),
    ],
    scholarships: [],
  }
}

describe('public university program coverage check', () => {
  it('reports exact 0/1/2 distribution and classifies hidden inventory', () => {
    const report = buildProgramCoverageReport(coverageFixture(), {
      today: TODAY,
      mode: 'report',
      minimumPublishedPrograms: 1,
      generatedAt: '2026-07-30T00:00:00.000Z',
    })

    expect(report.summary).toMatchObject({
      publicUniversities: 5,
      publishedPrograms: 5,
      meetingMinimum: 3,
      belowMinimum: 2,
      distribution: { zero: 2, one: 2, two: 0, threeOrMore: 1 },
      belowMinimumByReason: { draft: 1, expired: 0, no_identity: 1 },
    })
    expect(report.lowCoverage.map((item) => [
      item.universityId,
      item.publishedProgramCount,
      item.gapReasons,
    ])).toEqual([
      ['university-no-identity', 0, ['no_identity']],
      ['university-draft', 0, ['draft']],
      ['university-expired', 1, ['no_identity']],
      ['university-one', 1, ['no_identity']],
    ])
    expect(renderProgramCoverageMarkdown(report)).toContain('## 0 published programs')
    expect(coverageExitCode(report)).toBe(0)
  })

  it('fails only strict mode when the configured minimum is unmet', () => {
    const report = buildProgramCoverageReport(coverageFixture(), {
      today: TODAY,
      mode: 'strict',
      minimumPublishedPrograms: 1,
    })

    expect(report.belowMinimum).toHaveLength(2)
    expect(coverageExitCode(report)).toBe(1)
    expect(coverageExitCode({ ...report, mode: 'report' })).toBe(0)
  })

  it('fails strict mode when a semantic program identity is duplicated', () => {
    const fixture = coverageFixture()
    const original = fixture.programs.find((item) => item.id === 'one-visible')!
    fixture.programs.push({
      ...structuredClone(original),
      id: 'one-visible-duplicate',
      slug: 'one-visible-duplicate',
    })
    const report = buildProgramCoverageReport(fixture, {
      today: TODAY,
      mode: 'strict',
      minimumPublishedPrograms: 1,
    })

    expect(report.summary.duplicateProgramIdentities).toBe(1)
    expect(report.identityDuplicates[0]).toMatchObject({
      universityId: 'university-one',
      programIds: ['one-visible', 'one-visible-duplicate'],
    })
    expect(coverageExitCode(report)).toBe(1)
    expect(coverageExitCode({ ...report, mode: 'report' })).toBe(0)
  })

  it('keeps the committed catalog audit advisory while exposing every gap', () => {
    const catalog = bundleSchema.parse({
      sources,
      cities,
      universities,
      programs,
      admissionCycles,
      scholarships,
    })
    const report = buildProgramCoverageReport(catalog, {
      today: TODAY,
      mode: 'report',
      minimumPublishedPrograms: 1,
    })

    expect(coverageExitCode(report)).toBe(0)
    expect(report.summary.duplicateProgramIdentities).toBe(0)
    expect(report.identityDuplicates).toHaveLength(0)
    expect(report.summary.belowMinimum).toBe(report.summary.distribution.zero)
    expect(report.lowCoverage).toHaveLength(
      report.summary.distribution.zero
      + report.summary.distribution.one
      + report.summary.distribution.two,
    )
    expect(report.lowCoverage.every((item) => item.gapReasons.length > 0)).toBe(true)
  })
})
