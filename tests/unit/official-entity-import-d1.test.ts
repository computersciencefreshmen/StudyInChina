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

import { packageOfficialEntityImport } from '../../scripts/ingestion/package-official-entity-import'

const temporaryDirectories: string[] = []

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sqlValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
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

function applyPipelineMigrations(database: DatabaseSync): void {
  const directory = join(
    process.cwd(),
    'infra',
    'd1',
    'pipeline',
    'migrations',
  )
  for (const name of readdirSync(directory).filter((item) => (
    /^\d+.*\.sql$/u.test(item)
  )).sort()) {
    database.exec(readFileSync(join(directory, name), 'utf8'))
  }
}

function seedPrerequisites(database: DatabaseSync): void {
  database.exec(`
INSERT INTO records (
  id, public_id, kind, slug, workflow_status, created_at, updated_at
) VALUES
  ('location-beijing', 'location-beijing', 'location', 'beijing',
    'applied', '2020-07-24T00:00:00.000Z', '2020-07-24T00:00:00.000Z'),
  ('uni-tsinghua-university', 'uni-tsinghua-university', 'organization',
    'tsinghua-university', 'applied', '2020-07-24T00:00:00.000Z',
    '2020-07-24T00:00:00.000Z');
INSERT INTO locations (
  record_id, parent_location_id, location_type, country_code
) VALUES ('location-beijing', NULL, 'municipality', 'CN');
INSERT INTO organizations (
  record_id, organization_type, official_url
) VALUES (
  'uni-tsinghua-university', 'university', 'https://www.tsinghua.edu.cn/'
);
INSERT INTO institutions (
  record_id, city_id, institution_type, admissions_url, featured
) VALUES (
  'uni-tsinghua-university', 'location-beijing', 'comprehensive',
  'https://yz.tsinghua.edu.cn/', 1
);`)
}

function createFailedReservation(
  database: DatabaseSync,
  batchId: string,
  recordId: string,
): void {
  const manifestJson = JSON.stringify({
    format: 'studyinchina.pipeline.materialization-batch',
    formatVersion: 1,
    batchId,
    packageDigest: batchId,
    batchPurpose: 'catalog_entities',
    materializerVersion: 'failed-materializer/v1',
    provenanceStatus: 'complete',
    generatedAt: '2020-01-01T00:00:00.000Z',
    sourceManifestSha256: 'a'.repeat(64),
    sourceSqlSha256: 'b'.repeat(64),
    counts: {
      records: 1, programs: 1, scholarships: 0, organizations: 0,
      locations: 0, claims: 1, canonicalFields: 1, sourceFragments: 1,
      sourceDocuments: 1, programCycles: 0, scholarshipCycles: 0,
    },
    sourceArtifactCount: 1,
  })
  database.prepare(`
    INSERT INTO materialization_batches (
      batch_id, materializer_version, package_digest, batch_purpose,
      batch_status, provenance_status, expected_chunks, expected_records,
      expected_programs, expected_scholarships, expected_claims,
      expected_canonical_fields, expected_evidence_fragments,
      expected_source_documents, manifest_json, created_at, updated_at
    ) VALUES (?, 'failed-materializer/v1', ?, 'catalog_entities',
      'prepared', 'complete', 1, 1, 1, 0, 1, 1, 1, 1, ?,
      '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
  `).run(batchId, batchId, manifestJson)
  database.prepare(`
    UPDATE materialization_batches SET batch_status='reserving'
    WHERE batch_id=?
  `).run(batchId)
  database.prepare(`
    INSERT INTO materialization_batch_record_intents (
      batch_id, record_id, record_kind, package_digest, reserved_at
    ) VALUES (?, ?, 'program', ?, '2020-01-01T00:00:01.000Z')
  `).run(batchId, recordId, batchId)
  database.prepare(`
    UPDATE materialization_batches SET batch_status='reserved'
    WHERE batch_id=?
  `).run(batchId)
  database.prepare(`
    UPDATE materialization_batches
    SET batch_status='failed', error_code='test_failure',
        error_detail='explicit failure', updated_at='2020-01-01T00:00:02.000Z'
    WHERE batch_id=?
  `).run(batchId)
}

function buildExecutableMaterialization(directory: string): string {
  const generatedAt = new Date(Date.now() - 60_000).toISOString()
  const artifactBody = '{"catalog":"official"}\n'
  const artifactPath = join(directory, 'official-capture.json')
  writeFileSync(artifactPath, artifactBody, 'utf8')
  const artifactSha256 = sha256(artifactBody)
  const artifactUri = (
    `r2://studyinchina-source-snapshots/materializations/${artifactSha256}.json`
  )
  const facts = [
    {
      id: 'claim-name',
      field: 'localized.name',
      locale: 'zh',
      type: 'localized_string',
      raw: '测试项目',
      normalized: JSON.stringify('测试项目'),
    },
    {
      id: 'claim-url',
      field: 'official_url',
      locale: '',
      type: 'url',
      raw: 'https://yz.tsinghua.edu.cn/',
      normalized: JSON.stringify('https://yz.tsinghua.edu.cn/'),
    },
    {
      id: 'claim-type',
      field: 'program_type',
      locale: '',
      type: 'string',
      raw: 'degree',
      normalized: JSON.stringify('degree'),
    },
    {
      id: 'claim-level',
      field: 'degree_level',
      locale: '',
      type: 'string',
      raw: 'master',
      normalized: JSON.stringify('master'),
    },
  ]
  const factSql = facts.flatMap((fact) => [
    `INSERT INTO field_definitions (
      record_kind, field_path, value_type, risk_class, required_for_publish
    ) VALUES (
      'program', ${sqlValue(fact.field)}, ${sqlValue(fact.type)}, 'high', 1
    ) ON CONFLICT(record_kind, field_path) DO NOTHING;`,
    `INSERT INTO claims (
      id, subject_record_id, field_path, locale, value_type, raw_value_text,
      normalized_value_json, confidence, extraction_method, extractor_version,
      claim_status, provenance_precision, discovered_at
    ) VALUES (
      ${sqlValue(fact.id)}, 'program-one', ${sqlValue(fact.field)},
      ${sqlValue(fact.locale)}, ${sqlValue(fact.type)}, ${sqlValue(fact.raw)},
      ${sqlValue(fact.normalized)}, 1, 'pdf',
      'official-entity-materializer/v1', 'candidate', 'field',
      ${sqlValue(generatedAt)}
    ) ON CONFLICT(id) DO NOTHING;`,
    `INSERT OR IGNORE INTO claim_evidence (
      claim_id, fragment_id, evidence_role
    ) VALUES (${sqlValue(fact.id)}, 'fragment-one', 'primary');`,
    `UPDATE claims SET claim_status='validated', decided_at=${sqlValue(generatedAt)}
      WHERE id=${sqlValue(fact.id)} AND claim_status='candidate';`,
    `UPDATE claims SET claim_status='accepted', decided_at=${sqlValue(generatedAt)}
      WHERE id=${sqlValue(fact.id)} AND claim_status='validated';`,
    `INSERT INTO canonical_fields (
      subject_record_id, field_path, locale, field_status, claim_id,
      value_json, verified_at, review_after, updated_at
    ) VALUES (
      'program-one', ${sqlValue(fact.field)}, ${sqlValue(fact.locale)},
      'accepted', ${sqlValue(fact.id)}, ${sqlValue(fact.normalized)},
      ${sqlValue(generatedAt)}, '2026-08-23', ${sqlValue(generatedAt)}
    ) ON CONFLICT(subject_record_id, field_path, locale) DO UPDATE SET
      field_status=excluded.field_status,
      claim_id=excluded.claim_id,
      value_json=excluded.value_json,
      verified_at=excluded.verified_at,
      review_after=excluded.review_after,
      updated_at=excluded.updated_at;`,
  ])
  const sql = `-- Strict executable materialization.
PRAGMA foreign_keys = ON;
INSERT INTO records (
  id, public_id, kind, slug, workflow_status, review_after,
  row_version, created_at, updated_at
) VALUES (
  'program-one', 'program-one', 'program', 'program-one', 'draft',
  '2026-08-23', 1, ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
) ON CONFLICT(id) DO NOTHING;
INSERT INTO programs (
  record_id, institution_id, program_type, degree_level,
  attendance_mode, delivery_mode, official_url
) VALUES (
  'program-one', 'uni-tsinghua-university', 'degree', 'master',
  'full_time', 'on_campus', 'https://yz.tsinghua.edu.cn/'
) ON CONFLICT(record_id) DO NOTHING;
INSERT INTO source_documents (
  id, public_id, canonical_url, publisher_organization_id, source_kind,
  authority_level, official, language_code, active, robots_policy
) VALUES (
  'source-one', 'source-one', 'https://yz.tsinghua.edu.cn/',
  'uni-tsinghua-university', 'program', 'primary_official', 1, 'zh', 1,
  'enforce'
) ON CONFLICT(id) DO NOTHING;
INSERT INTO source_fetches (
  id, source_id, status, requested_at, completed_at, http_status,
  content_type, content_length, sha256, artifact_uri, parser_key,
  parser_version
) VALUES (
  'fetch-one', 'source-one', 'succeeded', ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)}, 200, 'application/json',
  ${Buffer.byteLength(artifactBody)}, ${sqlValue(artifactSha256)},
  ${sqlValue(artifactUri)}, 'strict-test', '1'
) ON CONFLICT(id) DO NOTHING;
INSERT INTO source_fragments (
  id, fetch_id, locator_type, locator, text_excerpt, sha256, created_at
) VALUES (
  'fragment-one', 'fetch-one', 'pdf_page', 'page 1', '测试项目',
  ${sqlValue(sha256('测试项目'))}, ${sqlValue(generatedAt)}
) ON CONFLICT(id) DO NOTHING;
${factSql.join('\n')}
UPDATE records SET workflow_status='applied' WHERE id='program-one';
PRAGMA optimize;
`
  const sqlPath = join(directory, 'materialization.sql')
  writeFileSync(sqlPath, sql, 'utf8')
  const manifestPath = join(directory, 'materialization.manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    format: 'studyinchina.pipeline.materialization',
    formatVersion: 1,
    batchId: 'b'.repeat(64),
    materializerVersion: 'official-entity-materializer/v1',
    provenanceStatus: 'complete',
    batchPurpose: 'catalog_entities',
    generatedAt,
    contentSha256: sha256(sql),
    sqlPath,
    inputPaths: [join(directory, 'live-harvest.json')],
    counts: {
      records: 1,
      programs: 1,
      scholarships: 0,
      organizations: 0,
      locations: 0,
      claims: 4,
      canonicalFields: 4,
      sourceDocuments: 1,
      sourceFragments: 1,
      programCycles: 0,
      scholarshipCycles: 0,
    },
    recordMappings: [{ recordId: 'program-one', recordKind: 'program' }],
    sourceArtifacts: [{
      sourceId: 'source-one',
      fetchId: 'fetch-one',
      localPath: artifactPath,
      artifactSha256,
      artifactUri,
      contentType: 'application/json',
      byteLength: Buffer.byteLength(artifactBody),
      capturedAt: generatedAt,
      isFixture: false,
      captureMode: 'live',
    }],
  }, null, 2), 'utf8')
  return manifestPath
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('official entity import package against Pipeline D1 schema', () => {
  it('rolls back failed finalize, applies exact batch, and locks provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-d1-batch-'))
    temporaryDirectories.push(directory)
    const database = new DatabaseSync(':memory:')
    applyPipelineMigrations(database)
    seedPrerequisites(database)
    const fullyCoveredFailedBatch = 'd'.repeat(64)
    const incompletelyCoveredFailedBatch = 'e'.repeat(64)
    createFailedReservation(database, fullyCoveredFailedBatch, 'program-one')
    createFailedReservation(
      database,
      incompletelyCoveredFailedBatch,
      'program-not-covered',
    )
    const packaged = packageOfficialEntityImport({
      manifestPath: buildExecutableMaterialization(directory),
      outputDirectory: join(directory, 'package'),
      remote: false,
      maxCommandBytes: 12_000,
    }).manifest

    for (const chunk of packaged.transports.commandChunks.chunks) {
      executeAtomic(database, readFileSync(chunk.path, 'utf8'))
    }
    expect(database.prepare(
      "SELECT workflow_status FROM records WHERE id='program-one'",
    ).get()).toEqual({ workflow_status: 'validated' })
    expect(database.prepare(`
      SELECT batch_status, materialization_batches.package_digest AS package_digest,
        COUNT(*) AS chunks
      FROM materialization_batches
      JOIN materialization_batch_chunks USING(batch_id)
      WHERE batch_id=?
      GROUP BY batch_status, materialization_batches.package_digest
    `).get(packaged.batchId)).toEqual({
      batch_status: 'importing',
      package_digest: packaged.packageDigest,
      chunks: packaged.transports.commandChunks.expectedChunks,
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM materialization_batch_record_intents
      WHERE batch_id=? AND package_digest=?
    `).get(packaged.batchId, packaged.packageDigest)).toEqual({ count: 1 })
    expect(() => database.prepare(`
      INSERT INTO materialization_batch_chunks (
        batch_id, chunk_number, package_digest, chunk_sha256,
        statement_count, applied_at
      ) VALUES (?, 999, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(packaged.batchId, 'f'.repeat(64), 'c'.repeat(64)))
      .toThrow(/chunk package digest mismatch/u)

    const finalizeSql = readFileSync(packaged.finalizationSqlPath, 'utf8')
    expect(finalizeSql).not.toMatch(/UPDATE\s+records/iu)
    expect(finalizeSql.match(/UPDATE\s+materialization_batches/giu))
      .toHaveLength(1)

    database.prepare(`
      DELETE FROM claim_evidence WHERE claim_id='claim-name'
    `).run()
    expect(() => database.exec(finalizeSql)).toThrow(/incomplete or unverified/u)
    database.prepare(`
      INSERT INTO claim_evidence (claim_id, fragment_id, evidence_role)
      VALUES ('claim-name', 'fragment-one', 'primary')
    `).run()

    database.prepare(`
      UPDATE records SET kind='scholarship' WHERE id='program-one'
    `).run()
    expect(() => database.exec(finalizeSql)).toThrow(/incomplete or unverified/u)
    database.prepare(`
      UPDATE records SET kind='program' WHERE id='program-one'
    `).run()

    database.prepare(`
      DELETE FROM materialization_batch_source_artifacts WHERE batch_id=?
    `).run(packaged.batchId)
    expect(() => database.exec(finalizeSql)).toThrow(
      /incomplete or unverified/u,
    )
    expect(database.prepare(
      "SELECT workflow_status FROM records WHERE id='program-one'",
    ).get()).toEqual({ workflow_status: 'validated' })
    expect(database.prepare(
      'SELECT batch_status FROM materialization_batches WHERE batch_id=?',
    ).get(packaged.batchId)).toEqual({ batch_status: 'importing' })

    const artifact = packaged.sourceArtifacts[0]
    database.prepare(`
      INSERT INTO materialization_batch_source_artifacts (
        batch_id, source_id, fetch_id, artifact_sha256, artifact_uri,
        content_type, byte_length, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      packaged.batchId,
      artifact.sourceId,
      artifact.fetchId,
      artifact.artifactSha256,
      artifact.artifactUri,
      artifact.contentType,
      artifact.byteLength,
      artifact.capturedAt,
    )
    database.prepare(`
      UPDATE records
      SET workflow_status='published', row_version=41,
          updated_at='2020-01-01T00:00:00.000Z'
      WHERE id='program-one'
    `).run()
    database.exec(finalizeSql)
    const appliedRecord = database.prepare(`
      SELECT workflow_status, row_version, updated_at
      FROM records WHERE id='program-one'
    `).get() as { workflow_status: string; row_version: number; updated_at: string }
    expect(appliedRecord.workflow_status).toBe('published')
    expect(appliedRecord.row_version).toBe(42)
    expect(appliedRecord.updated_at).not.toBe('2020-01-01T00:00:00.000Z')
    expect(database.prepare(
      'SELECT batch_status FROM materialization_batches WHERE batch_id=?',
    ).get(packaged.batchId)).toEqual({ batch_status: 'applied' })
    expect(() => database.prepare(`
      UPDATE source_fetches SET artifact_uri='r2://studyinchina-source-snapshots/tampered'
      WHERE id='fetch-one'
    `).run()).toThrow(/applied materialization batch/u)
    expect(() => database.prepare(`
      UPDATE source_fetches SET completed_at='2026-07-25T00:00:00.000Z'
      WHERE id='fetch-one'
    `).run()).toThrow(/applied materialization batch/u)
    expect(() => database.prepare(`
      DELETE FROM source_fetches WHERE id='fetch-one'
    `).run()).toThrow(/applied materialization batch/u)
    expect(() => database.prepare(`
      INSERT INTO materialization_batch_chunks (
        batch_id, chunk_number, package_digest, chunk_sha256,
        statement_count, applied_at
      ) VALUES (?, 999, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(
      packaged.batchId,
      packaged.packageDigest,
      'c'.repeat(64),
    )).toThrow(/applied materialization batch chunks are immutable/u)

    expect(database.prepare(`
      SELECT batch_status FROM materialization_batches WHERE batch_id=?
    `).get(fullyCoveredFailedBatch)).toEqual({ batch_status: 'failed' })
    expect(() => database.prepare(`
      UPDATE materialization_batches
      SET batch_status='superseded', superseded_by_batch_id=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE batch_id=?
    `).run(packaged.batchId, incompletelyCoveredFailedBatch))
      .toThrow(/requires a complete applied replacement/u)
    expect(database.prepare(`
      SELECT batch_status FROM materialization_batches WHERE batch_id=?
    `).get(incompletelyCoveredFailedBatch)).toEqual({ batch_status: 'failed' })
    database.prepare(`
      UPDATE materialization_batches
      SET batch_status='superseded', superseded_by_batch_id=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE batch_id=?
    `).run(packaged.batchId, fullyCoveredFailedBatch)
    expect(database.prepare(`
      SELECT batch_status, superseded_by_batch_id
      FROM materialization_batches WHERE batch_id=?
    `).get(fullyCoveredFailedBatch)).toEqual({
      batch_status: 'superseded',
      superseded_by_batch_id: packaged.batchId,
    })
  })
})
