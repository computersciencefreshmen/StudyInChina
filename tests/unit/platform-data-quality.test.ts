import { describe, expect, it } from 'vitest'
import {
  buildPlatformDataQualityScorecard,
  conciseScorecardSummary,
  parsePlatformDataQualityArgs,
} from '../../scripts/quality/platform-data-quality'
import type { DataBundle } from '@/lib/data/types'
import type { SourceManifestRecord } from '../../scripts/source-manifest-registry'

const audit = {
  sourceIds: ['source-1'],
  verifiedAt: '2026-08-01',
  reviewAfter: '2026-12-31',
  status: 'verified' as const,
}

function fixture(): DataBundle {
  return {
    sources: [{
      id: 'source-1', url: 'https://example.edu', title: 'Official', publisher: 'Example',
      kind: 'university', language: 'en', official: true, accessedAt: '2026-08-01',
    }],
    cities: [
      { ...audit, id: 'city-1', slug: 'one', name: { en: 'One' }, province: null, region: 'east', coordinates: { lat: 1, lng: 2 }, overview: null, climate: null, foodHighlights: [], sights: [] },
      { ...audit, id: 'city-2', slug: 'two', name: { en: 'Two' }, province: null, region: 'east', coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] },
    ],
    universities: [
      { ...audit, id: 'uni-1', slug: 'one', name: { en: 'One' }, cityId: 'city-1', region: 'east', officialUrl: 'https://one.edu', admissionsUrl: null, summary: null, featured: false },
      { ...audit, id: 'uni-2', slug: 'two', name: { en: 'Two' }, cityId: 'city-2', region: 'east', officialUrl: 'https://two.edu', admissionsUrl: null, summary: null, featured: false },
    ],
    programs: [
      { ...audit, id: 'program-1', slug: 'one', universityId: 'uni-1', name: { en: 'One' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24, programUrl: 'https://one.edu/p', applyUrl: 'https://one.edu/apply', languageRequirements: [{ test: 'IELTS', minimum: '6.0' }] },
      { ...audit, id: 'program-2', slug: 'two', universityId: 'uni-1', name: { en: 'Two' }, degreeLevel: 'master', discipline: 'science', teachingLanguages: [], durationMonths: null, programUrl: 'https://one.edu/p2', applyUrl: null, languageRequirements: [] },
      { ...audit, id: 'program-3', slug: 'three', universityId: 'uni-2', name: { en: 'Three' }, degreeLevel: 'bachelor', discipline: 'business', teachingLanguages: ['Chinese'], durationMonths: null, programUrl: 'https://two.edu/p', applyUrl: null, languageRequirements: [] },
    ],
    admissionCycles: [{ ...audit, id: 'cycle-1', programId: 'program-1', academicYear: '2026-2027', intake: 'autumn', opensOn: '2026-01-01', closesOn: '2026-10-01', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null }],
    scholarships: [{ ...audit, id: 'scholarship-1', slug: 'one', name: { en: 'One' }, providerType: 'university', universityIds: ['uni-1'], programIds: [], coverage: { tuition: 'full', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null }, deadline: '2026-10-01', applicationUrl: 'https://one.edu/s', summary: null }],
  }
}

describe('platform data-quality scorecard', () => {
  it('calculates public coverage and gaps without mutating the catalog', () => {
    const data = fixture()
    const snapshot = JSON.stringify(data)
    const report = buildPlatformDataQualityScorecard(data, [] as SourceManifestRecord[], {
      today: '2026-08-06',
      generatedAt: '2026-08-06T00:00:00.000Z',
    })

    expect(report.metrics.publicRecords).toMatchObject({ universities: 2, programs: 3, scholarships: 1 })
    expect(report.metrics.programCoverage).toMatchObject({
      schoolsBelowThreePrograms: 2,
      programsWithVerifiedIdentity: 3,
      identityCoveragePct: 100,
      programsWithFreshDisposition: 1,
      freshDispositionCoveragePct: 33.33,
      programsWithDatedOrRollingCycle: 1,
      datedOrRollingCoveragePct: 33.33,
      programsActiveOrUpcoming: 1,
      activeUpcomingCoveragePct: 33.33,
      programsWithCurrentCycle: 1,
      currentCycleCoveragePct: 33.33,
      currentCycleCoverageSemantics: 'deprecated_alias_of_dated_or_rolling',
      durationCoveragePct: 33.33,
      applicationUrlCoveragePct: 33.33,
      teachingLanguageCoveragePct: 66.67,
      requirementsCoveragePct: 33.33,
    })
    expect(report.metrics.scholarships).toMatchObject({
      identityRecords: 1,
      freshRecords: 1,
      universitiesCovered: 1,
      recordsWithDeadline: 1,
    })
    expect(report.metrics.cities).toEqual({ withCoordinates: 1, coordinateCoveragePct: 50 })
    expect(report.gates.allPassed).toBe(false)
    expect(JSON.stringify(data)).toBe(snapshot)
  })

  it('does not let a date-free fee reference raise actionable cycle coverage', () => {
    const data = fixture()
    data.admissionCycles.push({
      ...data.admissionCycles[0],
      id: 'cycle-program-2-fee-reference',
      programId: 'program-2',
      opensOn: null,
      closesOn: null,
      dateStatus: 'not-announced',
      tuitionCny: 24_000,
      tuitionStatus: 'reference',
      evidenceBasis: 'recurring-official-rule',
    })

    const report = buildPlatformDataQualityScorecard(data, [], { today: '2026-08-06' })

    expect(report.metrics.publicRecords.admissionCycles).toBe(2)
    expect(report.metrics.programCoverage).toMatchObject({
      programsWithFreshDisposition: 1,
      programsWithDatedOrRollingCycle: 1,
      programsActiveOrUpcoming: 1,
      programsWithCurrentCycle: 1,
    })
  })

  it('reports overdue verified data and published cycles with no dates', () => {
    const data = fixture()
    data.universities[0].reviewAfter = '2026-08-05'
    data.admissionCycles.push({
      ...data.admissionCycles[0],
      id: 'cycle-no-dates',
      programId: 'program-2',
      opensOn: null,
      closesOn: null,
    })
    const report = buildPlatformDataQualityScorecard(data, [], { today: '2026-08-06' })

    expect(report.metrics.anomalies.verifiedOverdueRecords).toBe(1)
    expect(report.metrics.anomalies.publishedCyclesWithoutAnyDate).toBe(1)
  })

  it('does not count stale scholarship identities as fresh university coverage', () => {
    const data = fixture()
    data.scholarships[0].status = 'stale'

    const report = buildPlatformDataQualityScorecard(data, [], { today: '2026-08-06' })

    expect(report.metrics.publicRecords.scholarships).toBe(1)
    expect(report.metrics.scholarships).toMatchObject({
      identityRecords: 1,
      freshRecords: 0,
      universitiesCovered: 0,
      recordsWithDeadline: 0,
    })
  })

  it('parses strict and explicit output options and keeps console output concise', () => {
    expect(parsePlatformDataQualityArgs(['--strict', '--output', 'quality.json', '--today', '2026-08-06']))
      .toEqual({ strict: true, outputPath: 'quality.json', today: '2026-08-06' })
    expect(() => parsePlatformDataQualityArgs(['--today', '06-08-2026'])).toThrow(/YYYY-MM-DD/)

    const report = buildPlatformDataQualityScorecard(fixture(), [], { today: '2026-08-06' })
    expect(conciseScorecardSummary(report)).toContain('gates ')
    expect(conciseScorecardSummary(report).split('\n')).toHaveLength(1)
  })
})
