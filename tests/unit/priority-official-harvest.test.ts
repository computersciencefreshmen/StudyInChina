import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MINIMUM_DOMAIN_INTERVAL_MS,
  OFFICIAL_DEPENDENCY_SOURCES,
  PKU_MASTER_CHINESE_2026_SOURCE,
  PRIORITY_HARVEST_THRESHOLDS,
  TSINGHUA_PRIORITY_SOURCES,
  ZJU_PRIORITY_PDF_SOURCES,
  assertRegisteredOfficialUrl,
  assertSafeHarvestOutputDirectory,
  buildDependencySourceArtifacts,
  buildMaterializationSourceArtifacts,
  buildPriorityHarvestRunManifest,
  buildSourceArtifactR2Key,
  contentStateOf,
  evaluateHarvestGate,
  evaluateSourceCountBaseline,
  validatePriorityHarvestConfig,
  type HarvestSourceRun,
  type RegisteredAsset,
} from '../../scripts/ingestion/run-priority-official-harvest'
import { DEFAULT_SCHOLARSHIP_INDEX_SOURCES } from '../../scripts/ingestion/scholarship-index-harvester'

function asset(
  unchanged: boolean,
  assetId = 'asset',
  officialUrl = `https://official.example.edu.cn/${assetId}.pdf`,
): RegisteredAsset {
  const sha256 = createHash('sha256').update(assetId).digest('hex')
  const checkedAt = '2026-07-24T00:00:00.000Z'
  return {
    assetId,
    officialUrl,
    finalUrl: officialUrl,
    localPath: `raw/${assetId}.pdf`,
    contentType: 'application/pdf',
    byteLength: 100,
    sha256,
    httpStatus: 200,
    checkedAt,
    r2Key: buildSourceArtifactR2Key({
      assetId, sha256, localPath: `${assetId}.pdf`, contentType: 'application/pdf',
    }),
    isFixture: false,
    unchanged,
  }
}

function source(
  sourceId: string,
  status: HarvestSourceRun['status'] = 'verified',
  required = true,
): HarvestSourceRun {
  const officialUrl = `https://iczu.zju.edu.cn/${sourceId}.pdf`
  return {
    sourceId,
    kind: 'zju_pdf',
    required,
    officialUrls: [officialUrl],
    status,
    contentState: 'changed',
    verified: status === 'verified' ? 1 : 0,
    quarantined: status === 'quarantined' ? 1 : 0,
    sourceArtifacts: status === 'verified' ? [asset(false, sourceId, officialUrl)] : [],
    harvestPath: null,
    error: status === 'verified' ? null : 'test failure',
  }
}

function dependencySource(sourceId: string, officialUrl: string): HarvestSourceRun {
  const baseAsset = asset(false, sourceId, officialUrl)
  const localPath = `raw/dependencies/${sourceId}.html`
  const dependencyAsset: RegisteredAsset = {
    ...baseAsset,
    localPath,
    contentType: 'text/html',
    r2Key: buildSourceArtifactR2Key({
      assetId: baseAsset.assetId,
      sha256: baseAsset.sha256,
      localPath,
      contentType: 'text/html',
    }),
  }
  return {
    sourceId,
    kind: 'dependency',
    required: true,
    officialUrls: [officialUrl],
    status: 'verified',
    contentState: 'changed',
    verified: 0,
    quarantined: 0,
    sourceArtifacts: [dependencyAsset],
    harvestPath: null,
    error: null,
  }
}

describe('priority official harvest orchestration contract', () => {
  it('allows only the two dedicated harvest roots and their descendants', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'studyinchina-harvest-safe-'))
    const repositoryRoot = join(temporaryRoot, 'repository')
    mkdirSync(repositoryRoot)
    try {
      await expect(assertSafeHarvestOutputDirectory(
        join(repositoryRoot, '.official-harvest'),
        repositoryRoot,
      )).resolves.toBeUndefined()
      await expect(assertSafeHarvestOutputDirectory(
        join(repositoryRoot, 'artifacts', 'official-harvest', 'weekly'),
        repositoryRoot,
      )).resolves.toBeUndefined()
      await expect(assertSafeHarvestOutputDirectory(
        join(repositoryRoot, 'src'),
        repositoryRoot,
      )).rejects.toThrow(/must be under \.official-harvest/u)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects the repository root, --output .., and the user home ancestor', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'studyinchina-harvest-ancestor-'))
    const repositoryRoot = join(temporaryRoot, 'repository')
    mkdirSync(repositoryRoot)
    try {
      await expect(assertSafeHarvestOutputDirectory(
        repositoryRoot,
        repositoryRoot,
      )).rejects.toThrow(/dedicated directory inside/u)
      await expect(assertSafeHarvestOutputDirectory(
        resolve(repositoryRoot, '..'),
        repositoryRoot,
      )).rejects.toThrow(/dedicated directory inside/u)
      await expect(assertSafeHarvestOutputDirectory(homedir()))
        .rejects.toThrow(/dedicated directory inside/u)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects symlink or junction traversal inside an allowed harvest root', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'studyinchina-harvest-link-'))
    const repositoryRoot = join(temporaryRoot, 'repository')
    const outside = join(temporaryRoot, 'outside')
    const artifacts = join(repositoryRoot, 'artifacts')
    mkdirSync(artifacts, { recursive: true })
    mkdirSync(outside)
    const linkedOutput = join(artifacts, 'official-harvest')
    try {
      try {
        symlinkSync(
          outside,
          linkedOutput,
          process.platform === 'win32' ? 'junction' : 'dir',
        )
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : ''
        if (code === 'EPERM' || code === 'EACCES') return
        throw error
      }
      await expect(assertSafeHarvestOutputDirectory(linkedOutput, repositoryRoot))
        .rejects.toThrow(/symbolic link/u)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('registers the exact priority source shape on official HTTPS hosts', () => {
    expect(() => validatePriorityHarvestConfig()).not.toThrow()
    expect(TSINGHUA_PRIORITY_SOURCES).toHaveLength(2)
    expect(TSINGHUA_PRIORITY_SOURCES.map((item) => item.expectedVerifiedCount)).toEqual([99, 118])
    expect(ZJU_PRIORITY_PDF_SOURCES).toHaveLength(6)
    expect(ZJU_PRIORITY_PDF_SOURCES.reduce(
      (total, item) => total + item.auditedVerifiedCount,
      0,
    )).toBe(612)
    expect(PKU_MASTER_CHINESE_2026_SOURCE.expectedDocuments).toBe(36)
    expect(PKU_MASTER_CHINESE_2026_SOURCE.expectedPrograms).toBe(177)
    expect(PKU_MASTER_CHINESE_2026_SOURCE.expectedQuarantinedIndexAnchors).toBe(1)
    expect(OFFICIAL_DEPENDENCY_SOURCES.map((item) => item.officialUrl)).toEqual([
      'https://www.tsinghua.edu.cn/en/',
      'https://english.pku.edu.cn/',
      'https://www.zju.edu.cn/english/',
      'https://www.fudan.edu.cn/en/',
      'https://en.sjtu.edu.cn/',
      'https://en.ustc.edu.cn/',
      'https://english.beijing.gov.cn/',
      'https://english.shanghai.gov.cn/',
      'https://eng.hangzhou.gov.cn/index.html',
      'https://en.ustc.edu.cn/About.htm',
    ])
    expect(new Set(
      DEFAULT_SCHOLARSHIP_INDEX_SOURCES.map((item) => item.institutionId),
    ).size).toBe(6)
    expect(MINIMUM_DOMAIN_INTERVAL_MS).toBeGreaterThanOrEqual(5_000)

    for (const item of [
      ...TSINGHUA_PRIORITY_SOURCES,
      ...ZJU_PRIORITY_PDF_SOURCES,
      ...OFFICIAL_DEPENDENCY_SOURCES,
    ]) {
      expect(assertRegisteredOfficialUrl(item.officialUrl, item.allowedHosts).protocol).toBe('https:')
    }
    expect(assertRegisteredOfficialUrl(
      PKU_MASTER_CHINESE_2026_SOURCE.indexUrl,
      PKU_MASTER_CHINESE_2026_SOURCE.allowedHosts,
    ).hostname).toBe('admission.pku.edu.cn')
    for (const item of DEFAULT_SCHOLARSHIP_INDEX_SOURCES) {
      expect(assertRegisteredOfficialUrl(item.officialUrl, item.allowedHosts).protocol).toBe('https:')
    }
  })

  it('rejects insecure, credentialed, nonstandard-port, and unregistered URLs', () => {
    const allowlist = ['admission.pku.edu.cn']
    expect(() => assertRegisteredOfficialUrl(
      'http://admission.pku.edu.cn/catalog',
      allowlist,
    )).toThrow(/official HTTPS host allowlist/u)
    expect(() => assertRegisteredOfficialUrl(
      'https://user:secret@admission.pku.edu.cn/catalog',
      allowlist,
    )).toThrow(/official HTTPS host allowlist/u)
    expect(() => assertRegisteredOfficialUrl(
      'https://admission.pku.edu.cn:8443/catalog',
      allowlist,
    )).toThrow(/official HTTPS host allowlist/u)
    expect(() => assertRegisteredOfficialUrl(
      'https://evil.example/catalog',
      allowlist,
    )).toThrow(/official HTTPS host allowlist/u)
    expect(() => assertRegisteredOfficialUrl(
      'https://sub.admission.pku.edu.cn/catalog',
      allowlist,
    )).toThrow(/official HTTPS host allowlist/u)
  })

  it('reports changed, unchanged, and mixed content without skipping parsing', () => {
    expect(contentStateOf([])).toBe('unknown')
    expect(contentStateOf([asset(false)])).toBe('changed')
    expect(contentStateOf([asset(true)])).toBe('unchanged')
    expect(contentStateOf([asset(true, 'one'), asset(false, 'two')])).toBe('mixed')
  })

  it('uses stable per-asset content keys across runs without cross-source collisions', () => {
    const sha256 = createHash('sha256').update('same official bytes').digest('hex')
    const keyInput = {
      assetId: 'pku-master-chinese-2026:yx_00001.pdf',
      sha256,
      localPath: 'raw/pku/yx_00001.pdf',
      contentType: 'application/pdf',
    }
    const first = buildSourceArtifactR2Key(keyInput)
    expect(buildSourceArtifactR2Key({ ...keyInput })).toBe(first)
    expect(buildSourceArtifactR2Key({ ...keyInput, assetId: 'another-source:same.pdf' }))
      .not.toBe(first)
    expect(first).toMatch(/^source-artifacts\/[0-9a-f]{24}\/[0-9a-f]{64}\.pdf$/u)
  })

  it('excludes a captured scholarship index that no deduplicated entity uses as primary evidence', () => {
    const usedUrl = 'https://isd.pku.edu.cn/en/scholarship.php'
    const unusedUrl = 'https://isd.pku.edu.cn/en/list.php?cate=21&cate2=8'
    const scholarshipSource: HarvestSourceRun = {
      ...source('pku-scholarship-source'),
      kind: 'scholarship_index',
      officialUrls: [usedUrl, unusedUrl],
      sourceArtifacts: [
        asset(false, 'pku-scholarship-used', usedUrl),
        asset(false, 'pku-scholarship-deduplicated', unusedUrl),
      ],
      primaryEvidenceOfficialUrls: [usedUrl],
    }
    const artifacts = buildMaterializationSourceArtifacts([scholarshipSource])
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.officialUrl).toBe(usedUrl)
    expect(artifacts.some((item) => item.officialUrl === unusedUrl)).toBe(false)
  })

  it('fails a required source when its audited count is lower by one', () => {
    const sourceConfig = TSINGHUA_PRIORITY_SOURCES[0]!
    expect(evaluateSourceCountBaseline({
      sourceId: sourceConfig.id,
      actual: sourceConfig.expectedVerifiedCount,
      expected: sourceConfig.expectedVerifiedCount,
    })).toEqual({ status: 'verified', error: null })
    expect(evaluateSourceCountBaseline({
      sourceId: sourceConfig.id,
      actual: sourceConfig.expectedVerifiedCount - 1,
      expected: sourceConfig.expectedVerifiedCount,
    })).toEqual({
      status: 'failed',
      error: `verified_count_mismatch:${sourceConfig.expectedVerifiedCount - 1}`
        + `!=${sourceConfig.expectedVerifiedCount}`,
    })
  })

  it('fails closed below thresholds or when any required source is not verified', () => {
    const healthy = [source('required-source')]
    expect(evaluateHarvestGate({
      sources: healthy,
      projects: PRIORITY_HARVEST_THRESHOLDS.programs,
      scholarships: PRIORITY_HARVEST_THRESHOLDS.scholarships,
      sourceArtifacts: PRIORITY_HARVEST_THRESHOLDS.sourceArtifacts,
    })).toEqual({ passed: true, reasons: [], requiredFailures: [] })

    const artifactShortfall = evaluateHarvestGate({
      sources: healthy,
      projects: PRIORITY_HARVEST_THRESHOLDS.programs,
      scholarships: PRIORITY_HARVEST_THRESHOLDS.scholarships,
      sourceArtifacts: PRIORITY_HARVEST_THRESHOLDS.sourceArtifacts - 1,
    })
    expect(artifactShortfall.passed).toBe(false)
    expect(artifactShortfall.requiredFailures).toEqual([])
    expect(artifactShortfall.reasons).toEqual(['source_artifacts_count_mismatch:53!=54'])

    const unusedArtifactOverflow = evaluateHarvestGate({
      sources: healthy,
      projects: PRIORITY_HARVEST_THRESHOLDS.programs,
      scholarships: PRIORITY_HARVEST_THRESHOLDS.scholarships,
      sourceArtifacts: PRIORITY_HARVEST_THRESHOLDS.sourceArtifacts + 1,
    })
    expect(unusedArtifactOverflow.reasons).toEqual(['source_artifacts_count_mismatch:55!=54'])

    const result = evaluateHarvestGate({
      sources: [source('failed-source', 'failed'), source('optional-source', 'failed', false)],
      projects: 1_005,
      scholarships: 54,
      sourceArtifacts: 53,
    })
    expect(result.passed).toBe(false)
    expect(result.requiredFailures).toEqual(['failed-source'])
    expect(result.reasons).toContain('projects_below_threshold:1005<1006')
    expect(result.reasons).toContain('scholarships_below_threshold:54<55')
    expect(result.reasons).toContain('source_artifacts_count_mismatch:53!=54')
    expect(result.reasons).toContain('required_sources_failed:failed-source')
  })

  it('builds a machine-readable manifest with no AI and an explicit gate result', () => {
    const manifest = buildPriorityHarvestRunManifest({
      startedAt: '2026-07-24T00:00:00.000Z',
      completedAt: '2026-07-24T01:00:00.000Z',
      checkedAt: '2026-07-24T00:00:00.000Z',
      delayMs: 5_000,
      maxAttempts: 3,
      sources: [
        ...Array.from({ length: 54 }, (_, index) => source(`required-source-${index}`)),
        ...OFFICIAL_DEPENDENCY_SOURCES.map((item) => dependencySource(item.id, item.officialUrl)),
      ],
      projects: 1_006,
      scholarships: 55,
    })
    expect(manifest.format).toBe('studyinchina.priority-official-harvest')
    expect(manifest.aiUsed).toBe(false)
    expect(manifest.policy).toMatchObject({
      officialHttpsOnly: true,
      serialRequests: true,
      minimumDomainIntervalMs: 5_000,
      robotsEnforced: true,
    })
    expect(manifest.status).toBe('passed')
    expect(manifest.totals).toMatchObject({
      projects: 1_006,
      scholarships: 55,
      verified: 1_061,
      verifiedSources: 64,
      sourceArtifacts: 54,
      dependencies: 10,
    })
    expect(manifest.provenanceStatus).toBe('complete')
    expect(manifest.sourceArtifacts).toHaveLength(54)
    expect(manifest.dependencyArtifacts).toHaveLength(10)
    expect(manifest.dependencyArtifacts).toEqual(buildDependencySourceArtifacts(manifest.sources))
    expect(manifest.dependencyArtifacts[0]).toMatchObject({
      role: 'dependency',
      batchScope: 'dependency',
      isFixture: false,
      checkedAt: manifest.checkedAt,
    })
    const dependencyUrls = new Set(OFFICIAL_DEPENDENCY_SOURCES.map((item) => item.officialUrl))
    expect(manifest.sourceArtifacts.some((item) => dependencyUrls.has(item.officialUrl))).toBe(false)
    expect(manifest.sourceArtifacts[0]).toMatchObject({
      assetId: expect.any(String),
      capturedAt: manifest.checkedAt,
      checkedAt: manifest.checkedAt,
      httpStatus: 200,
      isFixture: false,
      unchanged: false,
      captureMode: 'live',
      provenanceStatus: 'complete',
    })
    expect(manifest.sourceArtifacts[0]!.artifactUri).toMatch(
      /^r2:\/\/studyinchina-source-snapshots\/source-artifacts\/[0-9a-f]{24}\/[0-9a-f]{64}\.pdf$/u,
    )
  })

  it('keeps R2 persistence and Pipeline imports fail-closed and strictly ordered', () => {
    const workflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/official-catalog-harvest.yml'),
      'utf8',
    )
    const r2Step = workflow.indexOf('- name: Upload deterministic private R2 source snapshot')
    const pipelineStep = workflow.indexOf(
      '- name: Strictly import dependencies, then catalog, into Pipeline D1',
    )
    const firstGet = workflow.indexOf('npx wrangler r2 object get', r2Step)
    const firstPut = workflow.indexOf('npx wrangler r2 object put', r2Step)
    const bootstrap = workflow.indexOf('import-pipeline-bootstrap.ps1', pipelineStep)
    const dependencies = workflow.indexOf(
      'materialize-official-dependencies.ts',
      pipelineStep,
    )
    const catalog = workflow.indexOf('materialize-official-entities.ts', pipelineStep)
    const dependencyImport = workflow.indexOf(
      'import-official-entities.ps1',
      dependencies,
    )
    const catalogImport = workflow.indexOf(
      'import-official-entities.ps1',
      catalog,
    )
    const releaseRequest = workflow.indexOf('request-materialization-release.ps1')

    expect(r2Step).toBeGreaterThan(-1)
    expect(pipelineStep).toBeGreaterThan(r2Step)
    expect(firstGet).toBeGreaterThan(r2Step)
    expect(firstPut).toBeGreaterThan(firstGet)
    expect(workflow).toContain(
      "elif grep -Fqi 'The specified key does not exist.' \"${probe_log}\"; then",
    )
    expect(workflow).toContain(
      'planned.size !== catalog.length + dependencies.length',
    )
    expect(workflow).toContain('if [[ "${upload_count}" -ne 64 ]]; then')
    expect(bootstrap).toBeGreaterThan(pipelineStep)
    expect(dependencies).toBeGreaterThan(bootstrap)
    expect(dependencyImport).toBeGreaterThan(dependencies)
    expect(catalog).toBeGreaterThan(dependencyImport)
    expect(catalogImport).toBeGreaterThan(catalog)
    expect(releaseRequest).toBeGreaterThan(catalogImport)
    expect(workflow).toContain('-CatalogManifestPath "${materialization_manifest}"')
    expect(workflow).toContain('-DependencyManifestPath "${dependency_manifest}"')
  })
})
