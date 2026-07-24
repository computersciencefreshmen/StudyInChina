import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function databaseWithPipelineSchema() {
  const database = new DatabaseSync(':memory:')
  const migrationDirectory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const file of readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(migrationDirectory, file), 'utf8'))
  }
  return database
}

function insertBatch(
  database: DatabaseSync,
  batchId: string,
  batchStatus: 'prepared' | 'applied',
) {
  const manifestJson = JSON.stringify({
    format: 'studyinchina.pipeline.materialization-batch',
    formatVersion: 1,
    batchId,
    packageDigest: batchId,
    batchPurpose: 'catalog_entities',
    materializerVersion: 'official-entity-materializer-v1',
    provenanceStatus: 'complete',
    generatedAt: '2026-07-23T08:00:00.000Z',
    sourceManifestSha256: 'e'.repeat(64),
    sourceSqlSha256: 'f'.repeat(64),
    counts: {
      records: 1, programs: 1, scholarships: 0, organizations: 0,
      locations: 0, claims: 1, canonicalFields: 1, sourceFragments: 1,
      sourceDocuments: 1, programCycles: 0, scholarshipCycles: 0,
    },
    sourceArtifactCount: 1,
  })
  database.prepare(`
    INSERT INTO materialization_batches (
      batch_id, materializer_version, package_digest, batch_status,
      provenance_status, expected_chunks, expected_records, expected_programs,
      expected_scholarships, expected_claims, expected_canonical_fields,
      expected_evidence_fragments, expected_source_documents, manifest_json,
      created_at, completed_at, updated_at
    ) VALUES (?, 'official-entity-materializer-v1', ?, ?, 'complete',
      1, 1, 1, 0, 1, 1, 1, 1, ?,
      '2026-07-23T08:00:00.000Z',
      CASE WHEN ? = 'applied' THEN '2026-07-23T08:01:00.000Z' END,
      '2026-07-23T08:00:00.000Z')
  `).run(batchId, batchId, batchStatus, manifestJson, batchStatus)
}

describe('materialization batch database gates', () => {
  it('rejects direct applied inserts and invalid/incomplete apply transitions', () => {
    const database = databaseWithPipelineSchema()
    expect(() => insertBatch(database, 'a'.repeat(64), 'applied'))
      .toThrow(/must pass the apply transition/u)

    insertBatch(database, 'b'.repeat(64), 'prepared')
    expect(() => database.prepare(`
      UPDATE materialization_batches
      SET batch_status = 'applied',
          completed_at = '2026-07-23T08:01:00.000Z'
      WHERE batch_id = ?
    `).run('b'.repeat(64))).toThrow(/invalid.*state|incomplete or unverified/u)
    expect(database.prepare(`
      SELECT batch_status FROM materialization_batches WHERE batch_id = ?
    `).get('b'.repeat(64))).toEqual({ batch_status: 'prepared' })
    database.close()
  })

  it('pre-registers new record ids and requires complete reservations before import', () => {
    const database = databaseWithPipelineSchema()
    const batchId = 'c'.repeat(64)
    insertBatch(database, batchId, 'prepared')
    expect(() => database.prepare(`
      UPDATE materialization_batches SET batch_status='importing'
      WHERE batch_id=?
    `).run(batchId)).toThrow(/invalid materialization batch state transition/u)

    database.prepare(`
      UPDATE materialization_batches SET batch_status='reserving'
      WHERE batch_id=?
    `).run(batchId)
    expect(() => database.prepare(`
      UPDATE materialization_batches SET batch_status='reserved'
      WHERE batch_id=?
    `).run(batchId)).toThrow(/reservation is incomplete/u)
    database.prepare(`
      INSERT INTO materialization_batch_record_intents (
        batch_id, record_id, record_kind, package_digest, reserved_at
      ) VALUES (?, 'not-created-yet', 'program', ?,
        '2026-07-23T08:00:01.000Z')
    `).run(batchId, batchId)
    expect(() => database.prepare(`
      DELETE FROM materialization_batch_record_intents
      WHERE batch_id=? AND record_id='not-created-yet'
    `).run(batchId)).toThrow(/record intent is immutable/u)
    database.prepare(`
      UPDATE materialization_batches SET batch_status='reserved'
      WHERE batch_id=?
    `).run(batchId)
    expect(database.prepare(`
      SELECT batch_status FROM materialization_batches WHERE batch_id=?
    `).get(batchId)).toEqual({ batch_status: 'reserved' })
    expect(() => database.prepare(`
      UPDATE materialization_batches
      SET batch_status='superseded', superseded_by_batch_id=?
      WHERE batch_id=?
    `).run('b'.repeat(64), batchId))
      .toThrow(/invalid.*state|complete applied replacement/u)
    expect(database.prepare(`
      SELECT batch_status FROM materialization_batches WHERE batch_id=?
    `).get(batchId)).toEqual({ batch_status: 'reserved' })
    expect(database.prepare(`
      SELECT record_id, record_kind FROM materialization_batch_record_intents
      WHERE batch_id=?
    `).get(batchId)).toEqual({
      record_id: 'not-created-yet',
      record_kind: 'program',
    })
    database.prepare(`
      UPDATE materialization_batches SET batch_status='failed'
      WHERE batch_id=?
    `).run(batchId)
    expect(() => database.prepare(`
      DELETE FROM materialization_batch_record_intents
      WHERE batch_id=? AND record_id='not-created-yet'
    `).run(batchId)).toThrow(/record intent is immutable/u)
    expect(() => database.prepare(`
      DELETE FROM materialization_batches WHERE batch_id=?
    `).run(batchId)).toThrow(/batch audit row is immutable/u)
    database.close()
  })
})
