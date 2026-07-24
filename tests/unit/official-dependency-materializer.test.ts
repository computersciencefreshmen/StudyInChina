import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildPipelineBootstrap,
  readPipelineBootstrapBundle,
} from '../../scripts/ingestion/build-pipeline-bootstrap'
import {
  buildOfficialDependencyMaterialization,
  OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
  OFFICIAL_DEPENDENCY_SPECS,
} from '../../scripts/ingestion/materialize-official-dependencies'
import { packageOfficialEntityImport } from '../../scripts/ingestion/package-official-entity-import'
import { validatePilotSourceManifestDirectory } from '../../scripts/validate-source-manifests'

type JsonObject = Record<string, unknown>

const fixtureDirectory = join(
  process.cwd(),
  'tests',
  'fixtures',
  'official-dependency-materializer',
)
const temporaryDirectories: string[] = []
const CHECKED_AT = '2026-07-24T08:00:00.000Z'

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function artifactFor(
  root: string,
  dependencyId: string,
  sourceUrl: string,
  checkedAt: string,
) {
  const localPath = `raw/dependencies/${dependencyId}.html`
  const bytes = readFileSync(join(root, localPath))
  const digest = sha256(bytes)
  const assetId = `${dependencyId}:html`
  return {
    assetId,
    officialUrl: sourceUrl,
    finalUrl: sourceUrl,
    localPath,
    contentType: 'text/html; charset=utf-8',
    byteLength: bytes.length,
    sha256: digest,
    httpStatus: 200,
    checkedAt,
    r2Key: `source-artifacts/${sha256(assetId).slice(0, 24)}/${digest}.html`,
    isFixture: false,
    unchanged: false,
  }
}

function priorityManifest(
  root = fixtureDirectory,
  checkedAt = CHECKED_AT,
): JsonObject {
  const dependencyArtifacts = OFFICIAL_DEPENDENCY_SPECS.map((spec) => ({
    ...artifactFor(root, spec.dependencyId, spec.sourceUrl, checkedAt),
    dependencyId: spec.dependencyId,
    role: 'dependency',
    batchScope: 'dependency',
  }))
  return {
    format: 'studyinchina.priority-official-harvest',
    formatVersion: 2,
    startedAt: checkedAt,
    completedAt: checkedAt,
    checkedAt,
    aiUsed: false,
    policy: {
      officialHttpsOnly: true,
      serialRequests: true,
      minimumDomainIntervalMs: 5_000,
      maxAttempts: 3,
      robotsEnforced: true,
    },
    thresholds: {
      programs: 1_015,
      scholarships: 55,
      sourceArtifacts: 54,
    },
    totals: {
      sourceArtifacts: 54,
      projects: 1_015,
      scholarships: 55,
      verified: 1_070,
      quarantined: 0,
      sources: 10,
      verifiedSources: 10,
      dependencies: 10,
    },
    sources: OFFICIAL_DEPENDENCY_SPECS.map((spec, index) => ({
      sourceId: spec.dependencyId,
      kind: 'dependency',
      required: true,
      officialUrls: [spec.sourceUrl],
      status: 'verified',
      contentState: 'changed',
      verified: 0,
      quarantined: 0,
      sourceArtifacts: [{
        ...(dependencyArtifacts[index] as JsonObject),
        dependencyId: undefined,
        role: undefined,
        batchScope: undefined,
      }],
      harvestPath: null,
      error: null,
    })).map((source) => ({
      ...source,
      sourceArtifacts: source.sourceArtifacts.map((artifact) => (
        Object.fromEntries(
          Object.entries(artifact).filter(([, value]) => value !== undefined),
        )
      )),
    })),
    gate: {
      passed: true,
      reasons: [],
      requiredFailures: [],
    },
    provenanceStatus: 'complete',
    sourceArtifacts: [],
    dependencyArtifacts,
    status: 'passed',
  }
}

function copyFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'studyinchina-dependencies-'))
  temporaryDirectories.push(directory)
  cpSync(fixtureDirectory, directory, { recursive: true })
  return directory
}

function databaseWithPipelineSchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const migrationDirectory = join(
    process.cwd(),
    'infra',
    'd1',
    'pipeline',
    'migrations',
  )
  for (const migration of readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(migrationDirectory, migration), 'utf8'))
  }
  return database
}

function seedBootstrapDependencies(database: DatabaseSync): void {
  const timestamp = '2026-07-01T00:00:00.000Z'
  for (const spec of OFFICIAL_DEPENDENCY_SPECS.filter(
    (candidate) => candidate.recordKind === 'location',
  )) {
    database.prepare(`
      INSERT INTO records (
        id, public_id, kind, slug, workflow_status, review_after,
        created_at, updated_at
      ) VALUES (?, ?, 'location', ?, 'validated', '2026-10-01', ?, ?)
    `).run(spec.recordId, spec.recordId, spec.slug, timestamp, timestamp)
    database.prepare(`
      INSERT INTO record_slugs (
        record_id, slug, valid_from, valid_to, is_current
      ) VALUES (?, ?, ?, NULL, 1)
    `).run(spec.recordId, spec.slug, timestamp)
    database.prepare(`
      INSERT INTO locations (
        record_id, parent_location_id, location_type, country_code
      ) VALUES (?, NULL, 'city', 'CN')
    `).run(spec.recordId)
  }
  for (const spec of OFFICIAL_DEPENDENCY_SPECS.filter(
    (candidate) => candidate.recordKind === 'organization',
  )) {
    database.prepare(`
      INSERT INTO records (
        id, public_id, kind, slug, workflow_status, review_after,
        created_at, updated_at
      ) VALUES (?, ?, 'organization', ?, 'validated', '2026-10-01', ?, ?)
    `).run(spec.recordId, spec.recordId, spec.slug, timestamp, timestamp)
    database.prepare(`
      INSERT INTO record_slugs (
        record_id, slug, valid_from, valid_to, is_current
      ) VALUES (?, ?, ?, NULL, 1)
    `).run(spec.recordId, spec.slug, timestamp)
    database.prepare(`
      INSERT INTO organizations (
        record_id, organization_type, official_url
      ) VALUES (?, 'university', ?)
    `).run(spec.recordId, spec.canonicalOfficialUrl)
    database.prepare(`
      INSERT INTO organization_domains (
        organization_id, domain, is_primary, verified_at
      ) VALUES (?, ?, 1, ?)
    `).run(spec.recordId, spec.bootstrapPrimaryDomain, timestamp)
    database.prepare(`
      INSERT INTO institutions (
        record_id, city_id, institution_type,
        ministry_code, admissions_url, featured
      ) VALUES (?, ?, 'comprehensive', NULL, ?, 0)
    `).run(spec.recordId, spec.cityId, spec.canonicalOfficialUrl)
  }
}

function executeAtomic(database: DatabaseSync, sql: string): void {
  database.exec('BEGIN IMMEDIATE;')
  try {
    database.exec(sql)
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

function scalar(database: DatabaseSync, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('official dependency canonicalizer', () => {
  it('fails closed for a missing artifact, wrong host, absent name, or non-live input', () => {
    const missing = priorityManifest()
    ;(missing.dependencyArtifacts as unknown[]).pop()
    expect(() => buildOfficialDependencyMaterialization(missing, {
      manifestPath: join(fixtureDirectory, 'run-manifest.json'),
    })).toThrow(/exactly ten live dependency artifacts/u)

    const wrongHost = priorityManifest()
    ;((wrongHost.dependencyArtifacts as JsonObject[])[0]).officialUrl =
      'https://example.com/en/'
    expect(() => buildOfficialDependencyMaterialization(wrongHost, {
      manifestPath: join(fixtureDirectory, 'run-manifest.json'),
    })).toThrow(/official HTTPS allowlist|registered dependency URL/u)

    const nonLive = priorityManifest()
    ;((nonLive.dependencyArtifacts as JsonObject[])[0]).isFixture = true
    expect(() => buildOfficialDependencyMaterialization(nonLive, {
      manifestPath: join(fixtureDirectory, 'run-manifest.json'),
    })).toThrow(/not a live artifact/u)

    const temporary = copyFixture()
    const badPath = join(
      temporary,
      'raw',
      'dependencies',
      'institution-home-tsinghua.html',
    )
    writeFileSync(
      badPath,
      '<!doctype html><html><body>Official homepage without the expected name.</body></html>',
      'utf8',
    )
    expect(() => buildOfficialDependencyMaterialization(
      priorityManifest(temporary),
      { manifestPath: join(temporary, 'run-manifest.json') },
    )).toThrow(/does not contain expected English evidence "Tsinghua University"/u)
  })

  it('rejects checked-in fixture paths under the remote import contract', () => {
    expect(() => buildOfficialDependencyMaterialization(priorityManifest(), {
      manifestPath: join(fixtureDirectory, 'run-manifest.json'),
      remote: true,
    })).toThrow(/fixture path and cannot satisfy the remote contract/u)
  })

  it('produces a strict dependencies manifest accepted by the remote packager', () => {
    const directory = copyFixture()
    const runManifestPath = join(directory, 'run-manifest.json')
    const artifacts = buildOfficialDependencyMaterialization(
      priorityManifest(directory),
      { manifestPath: runManifestPath, remote: true },
    )
    const sqlPath = join(directory, 'official-dependencies.sql')
    const manifestPath = join(directory, 'official-dependencies.manifest.json')
    writeFileSync(sqlPath, artifacts.sql, 'utf8')
    writeFileSync(manifestPath, JSON.stringify({
      ...artifacts.manifest,
      inputPaths: [runManifestPath],
      inputPath: runManifestPath,
      provenanceManifestPath: runManifestPath,
      sqlPath,
    }), 'utf8')

    const packaged = packageOfficialEntityImport({
      manifestPath,
      outputDirectory: join(directory, 'import-package'),
      remote: true,
      maxCommandBytes: 22_000,
    })
    expect(packaged.manifest).toMatchObject({
      batchPurpose: 'dependencies',
      provenanceStatus: 'complete',
      counts: {
        records: 10,
        programs: 0,
        scholarships: 0,
        organizations: 6,
        locations: 4,
        claims: 16,
        canonicalFields: 16,
        sourceDocuments: 10,
        sourceFragments: 10,
      },
    })
    expect(packaged.manifest.recordMappings).toHaveLength(10)
    expect(packaged.manifest.sourceArtifacts).toHaveLength(10)
    expect(packaged.manifest.transports.commandChunks.expectedChunks)
      .toBeGreaterThan(0)
  })

  it('canonicalizes the ten records from the real Pipeline bootstrap without adding an entity', () => {
    const database = databaseWithPipelineSchema()
    const bootstrap = buildPipelineBootstrap(
      readPipelineBootstrapBundle(),
      validatePilotSourceManifestDirectory(),
      '2026-07-24T07:00:00.000Z',
    )
    database.exec(bootstrap.sql)
    const before = scalar(database, 'SELECT COUNT(*) AS count FROM records')
    const artifacts = buildOfficialDependencyMaterialization(
      priorityManifest(),
      { manifestPath: join(fixtureDirectory, 'run-manifest.json') },
    )
    executeAtomic(database, artifacts.sql)

    expect(before).toBe(53)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM records')).toBe(before)
    expect(scalar(database, `
      SELECT
        (SELECT COUNT(*) FROM materialization_batches)
        + (SELECT COUNT(*) FROM materialization_batch_records)
        + (SELECT COUNT(*) FROM materialization_batch_source_artifacts)
        AS count
    `)).toBe(0)
    expect(artifacts.manifest.recordMappings).toHaveLength(10)
    expect(artifacts.sql).not.toContain('materialization_batches')
    expect(artifacts.sql).not.toContain('materialization_batch_records')
    expect(artifacts.sql).not.toContain('materialization_batch_source_artifacts')
    expect(artifacts.sql).not.toContain('SET workflow_status')
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(database.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    })
    database.close()
  })

  it('materializes all ten existing dependencies twice without creating entities or cycles', () => {
    const artifacts = buildOfficialDependencyMaterialization(
      priorityManifest(),
      { manifestPath: join(fixtureDirectory, 'run-manifest.json') },
    )
    expect(artifacts.manifest).toMatchObject({
      format: 'studyinchina.pipeline.materialization',
      batchPurpose: 'dependencies',
      provenanceStatus: 'complete',
      materializerVersion: OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
      requiredSourceArtifacts: 10,
      counts: {
        records: 10,
        programs: 0,
        scholarships: 0,
        organizations: 6,
        locations: 4,
        sourceDocuments: 10,
        sourceFetches: 10,
        sourceFragments: 10,
        claimEvidence: 16,
        claims: 16,
        canonicalFields: 16,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(artifacts.manifest.sourceArtifacts).toHaveLength(10)
    expect(artifacts.manifest.recordMappings).toHaveLength(10)
    expect(artifacts.sql).not.toMatch(/INSERT INTO (?:records|organizations|locations|institutions)\s*\(/u)

    const database = databaseWithPipelineSchema()
    seedBootstrapDependencies(database)
    executeAtomic(database, artifacts.sql)
    executeAtomic(database, artifacts.sql)

    expect(scalar(database, 'SELECT COUNT(*) AS count FROM records')).toBe(10)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM organizations')).toBe(6)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM locations')).toBe(4)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM programs')).toBe(0)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM scholarships')).toBe(0)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM program_cycles')).toBe(0)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM scholarship_cycles')).toBe(0)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM source_documents source
      JOIN source_fetches fetch ON fetch.source_id = source.id
      WHERE source.official = 1
        AND source.authority_level = 'primary_official'
        AND fetch.status = 'succeeded'
    `)).toBe(10)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM source_fragments fragment
      JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
      WHERE fetch.parser_key = 'official-dependency-materializer'
    `)).toBe(10)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM claims
      WHERE extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
        AND claim_status = 'accepted'
    `)).toBe(16)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM claim_evidence evidence
      JOIN claims claim ON claim.id = evidence.claim_id
      WHERE claim.extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
        AND claim.claim_status = 'accepted'
        AND evidence.evidence_role = 'primary'
    `)).toBe(16)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM canonical_fields canonical
      JOIN claims claim ON claim.id = canonical.claim_id
      WHERE claim.extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
        AND claim.claim_status = 'accepted'
        AND canonical.field_status = 'accepted'
    `)).toBe(16)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM source_fetches fetch
      WHERE fetch.parser_key = 'official-dependency-materializer'
        AND EXISTS (
          SELECT 1
          FROM source_fragments fragment
          JOIN claim_evidence evidence ON evidence.fragment_id = fragment.id
          JOIN claims claim ON claim.id = evidence.claim_id
          WHERE fragment.fetch_id = fetch.id
            AND evidence.evidence_role = 'primary'
            AND claim.claim_status = 'accepted'
        )
    `)).toBe(10)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM materialization_batches')).toBe(0)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(database.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    })
    database.close()
  })

  it('keeps claim identity versioned by checkedAt and fragment across repeated values', () => {
    const database = databaseWithPipelineSchema()
    seedBootstrapDependencies(database)
    const first = buildOfficialDependencyMaterialization(
      priorityManifest(fixtureDirectory, '2026-07-24T08:00:00.000Z'),
      { manifestPath: join(fixtureDirectory, 'run-manifest.json') },
    )
    const second = buildOfficialDependencyMaterialization(
      priorityManifest(fixtureDirectory, '2026-08-24T08:00:00.000Z'),
      { manifestPath: join(fixtureDirectory, 'run-manifest.json') },
    )
    executeAtomic(database, first.sql)
    executeAtomic(database, second.sql)

    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM claims
      WHERE extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
    `)).toBe(32)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM claims
      WHERE extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
        AND claim_status = 'accepted'
    `)).toBe(16)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM claims
      WHERE extractor_version = '${OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION}'
        AND claim_status = 'superseded'
    `)).toBe(16)
    expect(scalar(database, `
      SELECT COUNT(*) AS count
      FROM canonical_fields
      WHERE verified_at = '2026-08-24T08:00:00.000Z'
    `)).toBe(16)
    database.close()
  })

  it('fails at SQL execution when a bootstrap primary domain drifts', () => {
    const artifacts = buildOfficialDependencyMaterialization(
      priorityManifest(),
      { manifestPath: join(fixtureDirectory, 'run-manifest.json') },
    )
    const database = databaseWithPipelineSchema()
    seedBootstrapDependencies(database)
    database.prepare(`
      UPDATE organization_domains
      SET domain = 'wrong.tsinghua.edu.cn'
      WHERE organization_id = 'uni-tsinghua-university'
    `).run()
    expect(() => executeAtomic(database, artifacts.sql))
      .toThrow(/CHECK constraint failed|actor_type/u)
    expect(scalar(database, 'SELECT COUNT(*) AS count FROM claims')).toBe(0)
    database.close()
  })
})
