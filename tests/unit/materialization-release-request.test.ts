import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
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
  buildMaterializationReleaseRequest,
  materializationReleaseRequestSql,
  stableJson,
  type MaterializationReleaseRequestPlan,
} from '../../scripts/ingestion/request-materialization-release'

const temporaryDirectories: string[] = []
const CATALOG_BATCH_ID = 'c'.repeat(64)
const DEPENDENCY_BATCH_ID = 'd'.repeat(64)
const CREATED_AT = '2026-07-24T00:00:00.000Z'
const COMPLETED_AT = '2026-07-24T00:01:00.000Z'
const REQUESTED_AT = '2026-07-24T00:02:00.000Z'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function databaseWithPipelineSchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const directory = join(
    process.cwd(),
    'infra',
    'd1',
    'pipeline',
    'migrations',
  )
  for (const name of readdirSync(directory)
    .filter((item) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(item))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(directory, name), 'utf8'))
  }
  return database
}

type SeedOptions = {
  programs?: number
  scholarships?: number
}

function insertRecord(
  database: DatabaseSync,
  id: string,
  kind: 'organization' | 'location' | 'program' | 'scholarship',
  workflowStatus: 'validated' | 'applied',
): void {
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, id, kind, id, workflowStatus, CREATED_AT, CREATED_AT)
}

function seedSource(
  database: DatabaseSync,
  suffix: string,
): { sourceId: string; fetchId: string; fragmentId: string } {
  const sourceId = `source-${suffix}`
  const fetchId = `fetch-${suffix}`
  const fragmentId = `fragment-${suffix}`
  const artifactSha256 = sha256(`artifact-${suffix}`)
  const artifactUri =
    `r2://studyinchina-source-snapshots/release-tests/${artifactSha256}.html`
  database.prepare(`
    INSERT INTO source_documents (
      id, public_id, canonical_url, source_kind, authority_level,
      official, language_code, active, robots_policy, created_at, updated_at
    ) VALUES (?, ?, ?, 'other', 'primary_official', 1, 'en', 1,
      'enforce', ?, ?)
  `).run(
    sourceId,
    sourceId,
    `https://official.example/${suffix}`,
    CREATED_AT,
    CREATED_AT,
  )
  database.prepare(`
    INSERT INTO source_fetches (
      id, source_id, status, requested_at, completed_at, http_status,
      content_type, content_length, sha256, artifact_uri,
      parser_key, parser_version
    ) VALUES (?, ?, 'succeeded', ?, ?, 200, 'text/html', 1, ?, ?,
      'release-test', '1')
  `).run(
    fetchId,
    sourceId,
    CREATED_AT,
    COMPLETED_AT,
    artifactSha256,
    artifactUri,
  )
  database.prepare(`
    INSERT INTO source_fragments (
      id, fetch_id, locator_type, locator, text_excerpt, sha256, created_at
    ) VALUES (?, ?, 'text_offset', '0:1', 'x', ?, ?)
  `).run(fragmentId, fetchId, sha256('x'), COMPLETED_AT)
  return { sourceId, fetchId, fragmentId }
}

function insertAcceptedFact(
  database: DatabaseSync,
  recordId: string,
  claimId: string,
  extractorVersion: string,
  fragmentId: string,
): void {
  database.prepare(`
    INSERT INTO claims (
      id, subject_record_id, field_path, locale, value_type,
      raw_value_text, normalized_value_json, confidence,
      extraction_method, extractor_version, claim_status,
      provenance_precision, discovered_at, decided_at
    ) VALUES (?, ?, 'localized.name', 'en', 'localized_string',
      ?, ?, 1, 'selector', ?, 'candidate', 'field', ?, NULL)
  `).run(
    claimId,
    recordId,
    recordId,
    JSON.stringify(recordId),
    extractorVersion,
    COMPLETED_AT,
  )
  database.prepare(`
    INSERT INTO claim_evidence (claim_id, fragment_id, evidence_role)
    VALUES (?, ?, 'primary')
  `).run(claimId, fragmentId)
  database.prepare(`
    UPDATE claims SET claim_status = 'validated', decided_at = ?
    WHERE id = ? AND claim_status = 'candidate'
  `).run(COMPLETED_AT, claimId)
  database.prepare(`
    UPDATE claims SET claim_status = 'accepted', decided_at = ?
    WHERE id = ? AND claim_status = 'validated'
  `).run(COMPLETED_AT, claimId)
  database.prepare(`
    INSERT INTO canonical_fields (
      subject_record_id, field_path, locale, field_status, claim_id,
      value_json, verified_at, review_after, updated_at
    ) VALUES (?, 'localized.name', 'en', 'accepted', ?, ?, ?,
      '2026-08-24', ?)
  `).run(
    recordId,
    claimId,
    JSON.stringify(recordId),
    COMPLETED_AT,
    COMPLETED_AT,
  )
}

function seedBatch(
  database: DatabaseSync,
  options: {
    batchId: string
    purpose: 'catalog_entities' | 'dependencies'
    version: string
    records: Array<{
      id: string
      kind: 'organization' | 'location' | 'program' | 'scholarship'
    }>
    counts: {
      programs: number
      scholarships: number
      organizations: number
      locations: number
    }
    source: { sourceId: string; fetchId: string; fragmentId: string }
  },
): void {
  const recordCount = options.records.length
  const packageDigest = sha256(`package-${options.batchId}`)
  const manifestJson = JSON.stringify({
    format: 'studyinchina.pipeline.materialization-batch',
    formatVersion: 1,
    batchId: options.batchId,
    packageDigest,
    batchPurpose: options.purpose,
    materializerVersion: options.version,
    provenanceStatus: 'complete',
    generatedAt: CREATED_AT,
    sourceManifestSha256: sha256(`manifest-${options.batchId}`),
    sourceSqlSha256: sha256(`sql-${options.batchId}`),
    counts: {
      records: recordCount,
      programs: options.counts.programs,
      scholarships: options.counts.scholarships,
      organizations: options.counts.organizations,
      locations: options.counts.locations,
      claims: recordCount,
      canonicalFields: recordCount,
      sourceFragments: 1,
      sourceDocuments: 1,
      programCycles: 0,
      scholarshipCycles: 0,
    },
    sourceArtifactCount: 1,
  })
  database.prepare(`
    INSERT INTO materialization_batches (
      batch_id, materializer_version, package_digest, batch_purpose, batch_status,
      provenance_status, expected_chunks, expected_records,
      expected_programs, expected_scholarships, expected_organizations,
      expected_locations, expected_claims, expected_canonical_fields,
      expected_evidence_fragments, expected_source_documents, manifest_json,
      created_at, started_at, updated_at
    ) VALUES (?, ?, ?, ?, 'prepared', 'complete', 1, ?, ?, ?, ?, ?, ?, ?, 1, 1,
      ?, ?, ?, ?)
  `).run(
    options.batchId,
    options.version,
    packageDigest,
    options.purpose,
    recordCount,
    options.counts.programs,
    options.counts.scholarships,
    options.counts.organizations,
    options.counts.locations,
    recordCount,
    recordCount,
    manifestJson,
    CREATED_AT,
    CREATED_AT,
    CREATED_AT,
  )
  database.prepare(`
    UPDATE materialization_batches
    SET batch_status = 'reserving', updated_at = ?
    WHERE batch_id = ?
  `).run(CREATED_AT, options.batchId)
  const intent = database.prepare(`
    INSERT INTO materialization_batch_record_intents (
      batch_id, record_id, record_kind, package_digest, reserved_at
    ) VALUES (?, ?, ?, ?, ?)
  `)
  for (const record of options.records) {
    intent.run(
      options.batchId,
      record.id,
      record.kind,
      packageDigest,
      CREATED_AT,
    )
  }
  database.prepare(`
    UPDATE materialization_batches
    SET batch_status = 'reserved', updated_at = ?
    WHERE batch_id = ?
  `).run(CREATED_AT, options.batchId)
  database.prepare(`
    UPDATE materialization_batches
    SET batch_status = 'importing', updated_at = ?
    WHERE batch_id = ?
  `).run(CREATED_AT, options.batchId)
  database.prepare(`
    INSERT INTO materialization_batch_chunks (
      batch_id, chunk_number, package_digest, chunk_sha256,
      statement_count, applied_at
    ) VALUES (?, 1, ?, ?, 1, ?)
  `).run(
    options.batchId,
    packageDigest,
    sha256(`chunk-${options.batchId}`),
    COMPLETED_AT,
  )
  const mapping = database.prepare(`
    INSERT INTO materialization_batch_records (
      batch_id, record_id, record_kind, created_at
    ) VALUES (?, ?, ?, ?)
  `)
  for (const record of options.records) {
    mapping.run(options.batchId, record.id, record.kind, CREATED_AT)
    insertAcceptedFact(
      database,
      record.id,
      `claim-${options.purpose}-${record.id}`,
      options.version,
      options.source.fragmentId,
    )
  }
  const fetch = database.prepare(`
    SELECT sha256, artifact_uri, content_type, content_length, completed_at
    FROM source_fetches WHERE id = ?
  `).get(options.source.fetchId) as {
    sha256: string
    artifact_uri: string
    content_type: string
    content_length: number
    completed_at: string
  }
  database.prepare(`
    INSERT INTO materialization_batch_source_artifacts (
      batch_id, source_id, fetch_id, artifact_sha256, artifact_uri,
      content_type, byte_length, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    options.batchId,
    options.source.sourceId,
    options.source.fetchId,
    fetch.sha256,
    fetch.artifact_uri,
    fetch.content_type,
    fetch.content_length,
    fetch.completed_at,
  )
  database.prepare(`
    UPDATE materialization_batches
    SET batch_status = 'applied', completed_at = ?, updated_at = ?
    WHERE batch_id = ?
  `).run(COMPLETED_AT, COMPLETED_AT, options.batchId)
}

function seedAppliedPair(
  database: DatabaseSync,
  options: SeedOptions = {},
): void {
  const programCount = options.programs ?? 1000
  const scholarshipCount = options.scholarships ?? 50
  database.exec('BEGIN IMMEDIATE')
  try {
    const dependencyRecords: Array<{
      id: string
      kind: 'organization' | 'location'
    }> = []
    for (let index = 0; index < 4; index += 1) {
      const id = `city-${index}`
      insertRecord(database, id, 'location', 'validated')
      database.prepare(`
        INSERT INTO locations (
          record_id, location_type, country_code, region_code
        ) VALUES (?, 'city', 'CN', ?)
      `).run(id, `CN-0${index}`)
      dependencyRecords.push({ id, kind: 'location' })
    }
    for (let index = 0; index < 6; index += 1) {
      const id = `uni-${index}`
      insertRecord(database, id, 'organization', 'validated')
      database.prepare(`
        INSERT INTO organizations (
          record_id, organization_type, official_url
        ) VALUES (?, 'university', ?)
      `).run(id, `https://uni-${index}.example/`)
      database.prepare(`
        INSERT INTO institutions (
          record_id, city_id, institution_type, admissions_url, featured
        ) VALUES (?, ?, 'comprehensive', ?, 0)
      `).run(
        id,
        `city-${index % 4}`,
        `https://uni-${index}.example/admissions`,
      )
      dependencyRecords.push({ id, kind: 'organization' })
    }
    insertRecord(database, 'city-extra', 'location', 'applied')
    database.prepare(`
      INSERT INTO locations (
        record_id, location_type, country_code, region_code
      ) VALUES ('city-extra', 'city', 'CN', 'CN-99')
    `).run()
    insertRecord(database, 'uni-extra', 'organization', 'applied')
    database.prepare(`
      INSERT INTO organizations (
        record_id, organization_type, official_url
      ) VALUES ('uni-extra', 'university', 'https://uni-extra.example/')
    `).run()
    database.prepare(`
      INSERT INTO institutions (
        record_id, city_id, institution_type, admissions_url, featured
      ) VALUES (
        'uni-extra', 'city-extra', 'comprehensive',
        'https://uni-extra.example/admissions', 0
      )
    `).run()

    const catalogRecords: Array<{
      id: string
      kind: 'program' | 'scholarship'
    }> = []
    for (let index = 0; index < programCount; index += 1) {
      const id = `program-${String(index).padStart(4, '0')}`
      insertRecord(database, id, 'program', 'validated')
      database.prepare(`
        INSERT INTO programs (
          record_id, institution_id, program_type, degree_level,
          attendance_mode, delivery_mode, official_url
        ) VALUES (?, ?, 'degree', 'master', 'full_time', 'on_campus', ?)
      `).run(
        id,
        `uni-${index % 6}`,
        `https://uni-${index % 6}.example/program/${index}`,
      )
      catalogRecords.push({ id, kind: 'program' })
    }
    for (let index = 0; index < scholarshipCount; index += 1) {
      const id = `scholarship-${String(index).padStart(3, '0')}`
      insertRecord(database, id, 'scholarship', 'validated')
      database.prepare(`
        INSERT INTO scholarships (
          record_id, provider_organization_id, scheme_type, official_url
        ) VALUES (?, ?, 'university', ?)
      `).run(
        id,
        `uni-${index % 6}`,
        `https://uni-${index % 6}.example/scholarship/${index}`,
      )
      catalogRecords.push({ id, kind: 'scholarship' })
    }
    const dependencySource = seedSource(database, 'dependency')
    const catalogSource = seedSource(database, 'catalog')
    seedBatch(database, {
      batchId: DEPENDENCY_BATCH_ID,
      purpose: 'dependencies',
      version: 'official-dependency-materializer/v1',
      records: dependencyRecords,
      counts: {
        programs: 0,
        scholarships: 0,
        organizations: 6,
        locations: 4,
      },
      source: dependencySource,
    })
    seedBatch(database, {
      batchId: CATALOG_BATCH_ID,
      purpose: 'catalog_entities',
      version: 'official-entity-materializer/v1',
      records: catalogRecords,
      counts: {
        programs: programCount,
        scholarships: scholarshipCount,
        organizations: 0,
        locations: 0,
      },
      source: catalogSource,
    })
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function writeManifest(
  directory: string,
  options: {
    name: string
    batchId: string
    purpose: 'catalog_entities' | 'dependencies'
    programs: number
    scholarships: number
    organizations: number
    locations: number
  },
): string {
  const path = join(directory, `${options.name}.manifest.json`)
  writeFileSync(path, JSON.stringify({
    format: 'studyinchina.pipeline.materialization',
    formatVersion: 1,
    batchId: options.batchId,
    batchPurpose: options.purpose,
    provenanceStatus: 'complete',
    counts: {
      records: (
        options.programs
        + options.scholarships
        + options.organizations
        + options.locations
      ),
      programs: options.programs,
      scholarships: options.scholarships,
      organizations: options.organizations,
      locations: options.locations,
      programCycles: 0,
      scholarshipCycles: 0,
    },
  }, null, 2), 'utf8')
  return path
}

function buildPlan(
  directory: string,
  catalogCounts = { programs: 1000, scholarships: 50 },
): MaterializationReleaseRequestPlan {
  const catalogManifestPath = writeManifest(directory, {
    name: 'catalog',
    batchId: CATALOG_BATCH_ID,
    purpose: 'catalog_entities',
    programs: catalogCounts.programs,
    scholarships: catalogCounts.scholarships,
    organizations: 0,
    locations: 0,
  })
  const dependencyManifestPath = writeManifest(directory, {
    name: 'dependency',
    batchId: DEPENDENCY_BATCH_ID,
    purpose: 'dependencies',
    programs: 0,
    scholarships: 0,
    organizations: 6,
    locations: 4,
  })
  return buildMaterializationReleaseRequest({
    catalogManifestPath,
    dependencyManifestPath,
    outputDirectory: join(directory, 'release'),
    requestedAt: REQUESTED_AT,
  }).plan
}

function count(
  database: DatabaseSync,
  table: string,
): number {
  return Number(
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number
    }).count,
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('materialization Catalog release request', () => {
  it('generates stable identities from the exact batch pair', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-plan-'))
    temporaryDirectories.push(directory)
    const first = buildPlan(directory)
    const second = buildMaterializationReleaseRequest({
      catalogManifestPath: first.catalog.path,
      dependencyManifestPath: first.dependency.path,
      outputDirectory: join(directory, 'release-two'),
      requestedAt: '2026-07-24T00:03:00.000Z',
    }).plan

    expect(second.requestId).toBe(first.requestId)
    expect(second.publicationJobId).toBe(first.publicationJobId)
    expect(second.catalogReleaseId).toBe(first.catalogReleaseId)
    expect(second.outboxEventId).toBe(first.outboxEventId)
    expect(second.payload).toEqual(first.payload)
    expect(readFileSync(first.requestSqlPath, 'utf8').match(
      /INSERT OR IGNORE INTO materialization_release_requests/gu,
    )).toHaveLength(1)
  })

  it('fails locally before SQL generation for weak or fixture remote manifests', () => {
    const weakDirectory = mkdtempSync(join(tmpdir(), 'studyinchina-release-weak-'))
    temporaryDirectories.push(weakDirectory)
    expect(() => buildPlan(
      weakDirectory,
      { programs: 999, scholarships: 50 },
    )).toThrow(/requires >=1000 programs/u)

    const fixtureDirectory = mkdtempSync(
      join(tmpdir(), 'studyinchina-fixture-release-'),
    )
    temporaryDirectories.push(fixtureDirectory)
    const catalogManifestPath = writeManifest(fixtureDirectory, {
      name: 'catalog',
      batchId: CATALOG_BATCH_ID,
      purpose: 'catalog_entities',
      programs: 1000,
      scholarships: 50,
      organizations: 0,
      locations: 0,
    })
    const dependencyManifestPath = writeManifest(fixtureDirectory, {
      name: 'dependency',
      batchId: DEPENDENCY_BATCH_ID,
      purpose: 'dependencies',
      programs: 0,
      scholarships: 0,
      organizations: 6,
      locations: 4,
    })
    expect(() => buildMaterializationReleaseRequest({
      catalogManifestPath,
      dependencyManifestPath,
      outputDirectory: join(fixtureDirectory, 'release'),
      requestedAt: REQUESTED_AT,
      remote: true,
    })).toThrow(/rejects fixture path/u)
  })

  it('keeps the PowerShell runner cross-platform and parser-valid', () => {
    const scriptPath = join(
      process.cwd(),
      'scripts',
      'ingestion',
      'request-materialization-release.ps1',
    )
    const script = readFileSync(scriptPath, 'utf8')
    expect(script).toContain('$targetFlag = if ($Remote)')
    expect(script).toContain('Get-Command "node"')
    expect(script).toContain('"tsx.cmd"')
    expect(script).toContain('"tsx"')
    expect(script).toContain('"npx"')
    expect(script).toContain('"d1", "migrations", "apply"')
    expect(script).toContain('relational_contract_valid')
    expect(script).not.toContain('MINIMAX')

    const escapedScriptPath = scriptPath.replaceAll("'", "''")
    const parserScript = [
      '$errors = $null',
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', `
        + '[ref]$null, [ref]$errors) | Out-Null',
      'if ($errors.Count -gt 0) {',
      '  $errors | ForEach-Object { Write-Error $_.Message }',
      '  exit 1',
      '}',
    ].join('; ')
    const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    const result = spawnSync(executable, [
      '-NoProfile', '-NonInteractive', '-Command', parserScript,
    ], { encoding: 'utf8' })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('creates one immutable job and outbox event and is retry-safe', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-d1-'))
    temporaryDirectories.push(directory)
    const database = databaseWithPipelineSchema()
    seedAppliedPair(database)
    const plan = buildPlan(directory)

    database.exec(readFileSync(plan.requestSqlPath, 'utf8'))
    database.exec(readFileSync(plan.requestSqlPath, 'utf8'))

    expect(count(database, 'materialization_release_requests')).toBe(1)
    expect(count(database, 'publication_jobs')).toBe(1)
    expect(count(database, 'outbox_events')).toBe(1)
    const row = database.prepare(`
      SELECT request.payload_json, request.catalog_batch_id,
             request.dependency_batch_id, job.catalog_release_id,
             job.job_status, job.source_change_set_ids_json,
             event.event_type, event.aggregate_id,
             event.payload_json AS event_payload_json, event.event_status
      FROM materialization_release_requests request
      JOIN publication_jobs job ON job.id = request.publication_job_id
      JOIN outbox_events event ON event.id = request.outbox_event_id
    `).get() as Record<string, unknown>
    expect(JSON.parse(String(row.payload_json))).toEqual(plan.payload)
    expect(row.event_payload_json).toBe(stableJson(plan.payload))
    expect(row.catalog_batch_id).toBe(CATALOG_BATCH_ID)
    expect(row.dependency_batch_id).toBe(DEPENDENCY_BATCH_ID)
    expect(row.catalog_release_id).toBe(plan.catalogReleaseId)
    expect(row.job_status).toBe('queued')
    expect(row.source_change_set_ids_json).toBe('[]')
    expect(row.event_type).toBe('catalog.release.requested')
    expect(row.aggregate_id).toBe(plan.publicationJobId)
    expect(row.event_status).toBe('pending')
    expect(() => database.prepare(`
      UPDATE materialization_release_requests SET requested_at = ?
      WHERE request_id = ?
    `).run('2026-07-24T00:04:00.000Z', plan.requestId)).toThrow(/immutable/u)
    expect(() => database.prepare(`
      DELETE FROM materialization_release_requests WHERE request_id = ?
    `).run(plan.requestId)).toThrow(/immutable/u)
    expect(() => database.prepare(`
      DELETE FROM publication_jobs WHERE id = ?
    `).run(plan.publicationJobId)).toThrow(/FOREIGN KEY/u)
    database.close()
  })

  it.each([
    {
      label: 'program institution',
      mutate: (database: DatabaseSync) => database.prepare(`
        UPDATE programs SET institution_id = 'uni-extra'
        WHERE record_id = 'program-0000'
      `).run(),
      error: /program institution is absent/u,
    },
    {
      label: 'scholarship provider',
      mutate: (database: DatabaseSync) => database.prepare(`
        UPDATE scholarships SET provider_organization_id = 'uni-extra'
        WHERE record_id = 'scholarship-000'
      `).run(),
      error: /scholarship provider is absent/u,
    },
    {
      label: 'institution city',
      mutate: (database: DatabaseSync) => database.prepare(`
        UPDATE institutions SET city_id = 'city-extra'
        WHERE record_id = 'uni-0'
      `).run(),
      error: /institution city is absent/u,
    },
  ])('fails closed when a $label dependency is unmapped', ({ mutate, error }) => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-map-'))
    temporaryDirectories.push(directory)
    const database = databaseWithPipelineSchema()
    seedAppliedPair(database)
    const plan = buildPlan(directory)
    mutate(database)

    expect(() => database.exec(
      readFileSync(plan.requestSqlPath, 'utf8'),
    )).toThrow(error)
    expect(count(database, 'materialization_release_requests')).toBe(0)
    expect(count(database, 'publication_jobs')).toBe(0)
    expect(count(database, 'outbox_events')).toBe(0)
    database.close()
  })

  it('rejects a below-threshold applied catalog batch even if a manifest lies', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-limit-'))
    temporaryDirectories.push(directory)
    const database = databaseWithPipelineSchema()
    seedAppliedPair(database, { programs: 999, scholarships: 50 })
    const plan = buildPlan(directory, { programs: 1000, scholarships: 50 })

    expect(() => database.exec(
      readFileSync(plan.requestSqlPath, 'utf8'),
    )).toThrow(/catalog materialization batch is not release-ready/u)
    expect(count(database, 'materialization_release_requests')).toBe(0)
    expect(count(database, 'publication_jobs')).toBe(0)
    expect(count(database, 'outbox_events')).toBe(0)
    database.close()
  })

  it('rolls back the request and outbox when job creation conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-atomic-'))
    temporaryDirectories.push(directory)
    const database = databaseWithPipelineSchema()
    seedAppliedPair(database)
    const plan = buildPlan(directory)
    database.prepare(`
      INSERT INTO publication_jobs (
        id, catalog_release_id, job_status, source_change_set_ids_json,
        created_at
      ) VALUES (?, 'catalog-release-existing', 'queued', '[]', ?)
    `).run(plan.publicationJobId, REQUESTED_AT)

    expect(() => database.exec(
      readFileSync(plan.requestSqlPath, 'utf8'),
    )).toThrow(/downstream identity collision/u)
    expect(count(database, 'materialization_release_requests')).toBe(0)
    expect(count(database, 'publication_jobs')).toBe(1)
    expect(count(database, 'outbox_events')).toBe(0)
    database.close()
  })

  it('rejects payload extensions and leaves no partial side effects', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-release-json-'))
    temporaryDirectories.push(directory)
    const database = databaseWithPipelineSchema()
    seedAppliedPair(database)
    const plan = buildPlan(directory)
    const tampered = {
      ...plan,
      payload: {
        ...plan.payload,
        untrustedInstruction: 'publish anyway',
      },
    } as unknown as MaterializationReleaseRequestPlan

    expect(() => database.exec(
      materializationReleaseRequestSql(tampered),
    )).toThrow(/payload contract mismatch/u)
    expect(count(database, 'materialization_release_requests')).toBe(0)
    expect(count(database, 'publication_jobs')).toBe(0)
    expect(count(database, 'outbox_events')).toBe(0)
    database.close()
  })
})

