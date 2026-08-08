import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SOURCE_CATEGORIES } from '../../workers/ingestion/src/manifest-schema'
import {
  buildCurrentSourceManifestCohort,
  buildSourceManifestCohort,
  CURRENT_SOURCE_MANIFEST_COHORT_INPUTS,
  SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
  dryRunSummary,
  parseSourceManifestCohortCli,
  verifySourceManifestCohortArtifact,
  writeSourceManifestCohort,
  type BuildSourceManifestCohortInput,
  type SourceManifestCohortArtifactManifest,
  type SourceManifestCohortInputFingerprint,
} from '../../scripts/ingestion/build-source-manifest-cohort'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
    sourceReconciliations: [],
  }
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'studyinchina-manifest-cohort-'))
  temporaryDirectories.push(directory)
  return directory
}

function inputFingerprints(): SourceManifestCohortInputFingerprint[] {
  const locked = (
    Object.keys(CURRENT_SOURCE_MANIFEST_COHORT_INPUTS) as Array<
      keyof typeof CURRENT_SOURCE_MANIFEST_COHORT_INPUTS
    >
  ).map((name, index): SourceManifestCohortInputFingerprint => ({
    name,
    repositoryPath: CURRENT_SOURCE_MANIFEST_COHORT_INPUTS[name],
    sha256: (index + 1).toString(16).padStart(64, '0'),
    byteLength: index + 1,
  }))
  return [...locked, {
    name: 'sourceReconciliation:test.v1.json',
    repositoryPath: `${SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY}/test.v1.json`,
    sha256: '7'.padStart(64, '0'),
    byteLength: 7,
  }]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
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

  it('uses exact official reconciliation only as an audit fallback', () => {
    const input = fixture()
    input.sourceReconciliations = [{
      institutionNameZh: '缺口大学',
      checkedAt: '2026-08-05',
      categories: [
        {
          sourceCategory: 'international_admissions_home',
          status: 'verified_official',
          officialUrl: 'https://international.gap.edu.cn/admissions',
          evidenceUrl: 'https://international.gap.edu.cn/admissions',
          note: 'Official international admissions entry exists.',
          checkedAt: '2026-08-05',
        },
        {
          sourceCategory: 'catalog_anchor',
          status: 'source_unavailable',
          officialUrl: null,
          evidenceUrl: 'https://www.gap.edu.cn/evidence/catalog-audit.pdf',
          note: 'The official evidence records an unavailable catalog source.',
          checkedAt: '2026-08-05',
        },
        {
          sourceCategory: 'university_scholarship',
          status: 'officially_not_provided',
          officialUrl: null,
          evidenceUrl: 'https://international.gap.edu.cn/admissions',
          note: 'The audited official section does not provide a scholarship catalog.',
          checkedAt: '2026-08-05',
        },
      ],
    }]

    const build = buildSourceManifestCohort(input)
    const fallback = build.candidates.find(
      (candidate) => candidate.manifest.institutionId === 'uni-gap-university',
    )?.manifest

    expect(build.summary).toMatchObject({
      candidateManifests: 2,
      catalogLinkedManifests: 1,
      reconciliationFallbackManifests: 1,
      exactOfficialHttpsSources: 6,
      targetsWithoutCandidate: 1,
    })
    expect(fallback).toBeDefined()
    expect(fallback?.manifestStatus).toBe('in_progress')
    expect(fallback?.catalogReconciliation.scope).toBe('limited_official_catalog')
    expect(fallback?.sources.map((source) => source.officialUrl)).toEqual([
      'https://international.gap.edu.cn/admissions',
      'https://www.gap.edu.cn/evidence/catalog-audit.pdf',
      'https://international.gap.edu.cn/admissions',
    ])
    expect(fallback?.sources.every(
      (source) => source.enabled === false && source.robots.mode === 'blocked',
    )).toBe(true)
    expect(fallback?.coverage.filter((entry) => (
      entry.sourceCategory === 'international_admissions_home'
      || entry.sourceCategory === 'catalog_anchor'
      || entry.sourceCategory === 'university_scholarship'
    )).map((entry) => [entry.sourceCategory, entry.status])).toEqual([
      ['international_admissions_home', 'parser_pending'],
      ['university_scholarship', 'officially_not_provided'],
      ['catalog_anchor', 'source_unavailable'],
    ])
    expect(fallback?.catalogReconciliation.entries).toEqual([
      expect.objectContaining({
        officialKey: 'audit-only:uni-gap-university:international-catalog',
        entityType: 'program',
        status: 'pending',
        note: expect.stringMatching(/not a publishable program/),
      }),
    ])
  })

  it('reports military, mapping, source-quality, and no-safe-entity gaps explicitly', () => {
    const build = buildSourceManifestCohort(fixture())

    expect(build.summary).toEqual({
      officialTargets: 4,
      militaryExcluded: 1,
      eligibleTargets: 3,
      candidateManifests: 1,
      catalogLinkedManifests: 1,
      reconciliationFallbackManifests: 0,
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

  it('loads the locked non-military cohort from the current catalog without network input', () => {
    const current = buildCurrentSourceManifestCohort('2026-08-06', resolve('.'))

    expect(current.build.summary).toMatchObject({
      officialTargets: 147,
      militaryExcluded: 3,
      eligibleTargets: 144,
      candidateManifests: 144,
      catalogLinkedManifests: 140,
      reconciliationFallbackManifests: 4,
      targetsWithoutCandidate: 0,
    })
    expect(current.build.summary.exactOfficialHttpsSources).toBeGreaterThanOrEqual(997)
    expect(
      current.build.summary.candidateManifests
      + current.build.summary.targetsWithoutCandidate,
    ).toBe(144)
    expect(current.inputFingerprints.slice(0, 6).map(
      (input) => input.repositoryPath,
    )).toEqual(Object.values(CURRENT_SOURCE_MANIFEST_COHORT_INPUTS))
    const reconciliationPaths = readdirSync(resolve(
      SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
    )).filter((fileName) => fileName.endsWith('.v1.json'))
      .sort((left, right) => left.localeCompare(right, 'en'))
      .map((fileName) => (
        `${SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY}/${fileName}`
      ))
    expect(current.inputFingerprints.slice(6).map(
      (input) => input.repositoryPath,
    )).toEqual(reconciliationPaths)
    expect(current.inputFingerprints.every(
      (input) => /^[a-f0-9]{64}$/u.test(input.sha256) && input.byteLength > 0,
    )).toBe(true)
  })

  it('writes and verifies a candidate-only bundle with an input ledger and checksums', () => {
    const build = buildSourceManifestCohort(fixture())
    const output = temporaryDirectory()
    const written = writeSourceManifestCohort(
      build,
      output,
      inputFingerprints(),
      resolve('.'),
    )
    const artifact = readJson<SourceManifestCohortArtifactManifest>(
      written.artifactManifestPath,
    )
    const verification = verifySourceManifestCohortArtifact(output)
    const repeatedOutput = temporaryDirectory()
    const repeated = writeSourceManifestCohort(
      build,
      repeatedOutput,
      inputFingerprints(),
      resolve('.'),
    )

    expect(artifact.disposition).toBe('candidate_only')
    expect(artifact.inputs.map((input) => input.name)).toEqual([
      'registry',
      'universities',
      'sources',
      'programs',
      'admissionCycles',
      'scholarships',
      'sourceReconciliation:test.v1.json',
    ])
    expect(artifact.files.map((file) => file.path)).toEqual([
      'gap-report.v1.json',
      'manifests/001-test-university.v2.candidate.json',
    ])
    expect(readFileSync(written.checksumPath, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(verification).toMatchObject({
      cohortId: 'test-double-first-class',
      checkedAt: '2026-08-06',
      candidateManifests: 1,
      exactOfficialHttpsSources: 3,
      verifiedFiles: 3,
    })
    expect(readFileSync(repeated.artifactManifestPath, 'utf8')).toBe(
      readFileSync(written.artifactManifestPath, 'utf8'),
    )
    expect(readFileSync(repeated.checksumPath, 'utf8')).toBe(
      readFileSync(written.checksumPath, 'utf8'),
    )
  })

  it('fails closed for tampering, stale output, or formal-manifest output', () => {
    const build = buildSourceManifestCohort(fixture())
    const tamperedOutput = temporaryDirectory()
    const written = writeSourceManifestCohort(
      build,
      tamperedOutput,
      inputFingerprints(),
      resolve('.'),
    )
    writeFileSync(
      join(written.manifestDirectory, '001-test-university.v2.candidate.json'),
      '{}\n',
      'utf8',
    )
    expect(() => verifySourceManifestCohortArtifact(tamperedOutput))
      .toThrow(/checksum mismatch/)

    const staleOutput = temporaryDirectory()
    writeFileSync(join(staleOutput, 'stale.json'), '{}\n', 'utf8')
    expect(() => writeSourceManifestCohort(
      build,
      staleOutput,
      inputFingerprints(),
      resolve('.'),
    )).toThrow(/must be empty/)

    expect(() => writeSourceManifestCohort(
      build,
      join(resolve('.'), 'content/source-manifests/candidate-artifact'),
      inputFingerprints(),
      resolve('.'),
    )).toThrow(/must not be inside/)
  })

  it('accepts only one explicit CLI mode and rejects the former generic output flag', () => {
    expect(parseSourceManifestCohortCli([
      '--checked-at', '2026-08-06', '--dry-run',
    ])).toEqual({ mode: 'dry-run', checkedAt: '2026-08-06' })
    expect(parseSourceManifestCohortCli([
      '--checked-at', '2026-08-06', '--artifact-output', 'candidate-bundle',
    ])).toEqual({
      mode: 'write-artifact',
      checkedAt: '2026-08-06',
      artifactOutput: 'candidate-bundle',
    })
    expect(parseSourceManifestCohortCli([
      '--verify-artifact', 'candidate-bundle',
    ])).toEqual({ mode: 'verify-artifact', artifactOutput: 'candidate-bundle' })
    expect(() => parseSourceManifestCohortCli([
      '--checked-at', '2026-08-06', '--output', 'content/source-manifests',
    ])).toThrow(/Unknown CLI option/)
  })
})
