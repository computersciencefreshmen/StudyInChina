import { describe, expect, it } from 'vitest'
import { SOURCE_CATEGORIES } from '../../workers/ingestion/src/manifest-schema'
import {
  buildSourceManifestCohort,
  dryRunSummary,
  type BuildSourceManifestCohortInput,
} from '../../scripts/ingestion/build-source-manifest-cohort'

function fixture(): BuildSourceManifestCohortInput {
  return {
    checkedAt: '2026-08-06',
    registry: {
      cohort: { id: 'test-double-first-class' },
      targets: [
        {
          targetId: 'target-001',
          ordinal: 1,
          officialNameZh: '测试大学',
          catalogInstitutionId: 'uni-test-university',
        },
        {
          targetId: 'target-002',
          ordinal: 2,
          officialNameZh: '缺口大学',
          catalogInstitutionId: 'uni-gap-university',
        },
        {
          targetId: 'target-003',
          ordinal: 3,
          officialNameZh: '未映射大学',
        },
        {
          targetId: 'target-004',
          ordinal: 4,
          officialNameZh: '国防科技大学',
        },
      ],
    },
    universities: [
      {
        id: 'uni-test-university',
        slug: 'test-university',
        name: { en: 'Test University', zh: '测试大学' },
        sourceIds: ['src-test-home'],
      },
      {
        id: 'uni-gap-university',
        slug: 'gap-university',
        name: { en: 'Gap University', zh: '缺口大学' },
        sourceIds: [],
      },
    ],
    sources: [
      {
        id: 'src-test-home',
        url: 'https://international.test.edu.cn/',
        title: 'Official international home',
        kind: 'university',
        official: true,
      },
      {
        id: 'src-test-program',
        url: 'https://international.test.edu.cn/programs/masters',
        title: 'Official international programme',
        kind: 'program',
        official: true,
      },
      {
        id: 'src-test-scholarship',
        url: 'https://international.test.edu.cn/scholarships/president',
        title: 'Official university scholarship',
        kind: 'scholarship',
        official: true,
      },
      {
        id: 'src-http-program',
        url: 'http://international.test.edu.cn/programs/legacy',
        title: 'Insecure legacy page',
        kind: 'program',
        official: true,
      },
      {
        id: 'src-unofficial-program',
        url: 'https://aggregator.example/programs/test',
        title: 'Third-party page',
        kind: 'program',
        official: false,
      },
    ],
    programs: [
      {
        id: 'program-test-master',
        universityId: 'uni-test-university',
        name: { en: 'Verified Master Programme' },
        sourceIds: [
          'src-test-program',
          'src-http-program',
          'src-unofficial-program',
        ],
      },
      {
        id: 'program-gap-master',
        universityId: 'uni-gap-university',
        name: { en: 'Unresolved Programme' },
        sourceIds: ['src-missing'],
      },
    ],
    admissionCycles: [],
    scholarships: [{
      id: 'scholarship-test-president',
      name: { en: 'Test University President Scholarship' },
      providerType: 'university',
      universityIds: ['uni-test-university'],
      sourceIds: ['src-test-scholarship'],
    }],
  }
}

describe('SourceManifestV2 cohort candidate builder', () => {
  it('maps only exact official HTTPS relationships and leaves every candidate pending', () => {
    const build = buildSourceManifestCohort(fixture())

    expect(build.candidates).toHaveLength(1)
    const candidate = build.candidates[0]!
    expect(candidate.fileName).toBe('001-test-university.v2.candidate.json')
    expect(candidate.manifest.manifestStatus).toBe('in_progress')
    expect(candidate.manifest.catalogReconciliation.status).toBe('in_progress')
    expect(candidate.manifest.catalogReconciliation.entries).toHaveLength(2)
    expect(candidate.manifest.catalogReconciliation.entries.every(
      (entry) => entry.status === 'pending' && entry.recordId === undefined,
    )).toBe(true)
    expect(candidate.manifest.sources.map((source) => source.officialUrl)).toEqual([
      'https://international.test.edu.cn/',
      'https://international.test.edu.cn/programs/masters',
      'https://international.test.edu.cn/scholarships/president',
    ])
    expect(candidate.manifest.sources.every(
      (source) => source.enabled === false && source.robots.mode === 'blocked',
    )).toBe(true)

    const mappedCoverage = candidate.manifest.coverage.filter(
      (coverage) => coverage.status === 'parser_pending',
    )
    expect(mappedCoverage.map((coverage) => coverage.sourceCategory)).toEqual([
      'university_scholarship',
      'program_detail',
      'catalog_anchor',
    ])
    const missingCoverage = candidate.manifest.coverage.filter(
      (coverage) => coverage.status === 'discovery_pending',
    )
    expect(missingCoverage).toHaveLength(SOURCE_CATEGORIES.length - mappedCoverage.length)
    expect(candidate.manifest.coverage.some(
      (coverage) => coverage.status === 'officially_not_provided',
    )).toBe(false)
  })

  it('reports military, mapping, source-quality, and no-safe-entity gaps explicitly', () => {
    const build = buildSourceManifestCohort(fixture())

    expect(build.summary).toEqual({
      officialTargets: 4,
      militaryExcluded: 1,
      eligibleTargets: 3,
      candidateManifests: 1,
      exactOfficialHttpsSources: 3,
      targetsWithoutCandidate: 2,
    })
    expect(build.gapReport.militaryExclusions.map((target) => target.officialNameZh)).toEqual([
      '国防科技大学',
    ])
    expect(build.gapReport.gaps.map((gap) => gap.code)).toEqual([
      'no_safe_entity_source',
      'catalog_mapping_missing',
    ])
    const testCoverage = build.gapReport.institutionCoverage.find(
      (coverage) => coverage.institutionId === 'uni-test-university',
    )
    expect(testCoverage?.rejectedSources).toEqual([
      { sourceId: 'src-http-program', reason: 'not_https' },
      { sourceId: 'src-unofficial-program', reason: 'not_official' },
    ])
    const gapCoverage = build.gapReport.institutionCoverage.find(
      (coverage) => coverage.institutionId === 'uni-gap-university',
    )
    expect(gapCoverage?.rejectedSources).toEqual([
      { sourceId: 'src-missing', reason: 'missing_source_record' },
    ])
  })

  it('is deterministic regardless of input order and exposes a no-write dry-run summary', () => {
    const input = fixture()
    const expected = buildSourceManifestCohort(input)
    const reordered = buildSourceManifestCohort({
      ...input,
      registry: { ...input.registry, targets: [...input.registry.targets].reverse() },
      universities: [...input.universities].reverse(),
      sources: [...input.sources].reverse(),
      programs: [...input.programs].reverse(),
      scholarships: [...input.scholarships].reverse(),
    })

    expect(reordered).toEqual(expected)
    expect(JSON.parse(dryRunSummary(expected))).toEqual({
      mode: 'dry-run',
      ...expected.summary,
    })
  })

  it('rejects a non-calendar checkedAt value before building candidates', () => {
    const input = fixture()
    input.checkedAt = '2026-02-30'

    expect(() => buildSourceManifestCohort(input)).toThrow(/checkedAt/)
  })
})
