import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  materializeExtractedEntityCandidate,
  requestEntityMaterializationRelease,
} from '../src/entity-materializer'
import { sha256Hex } from '../src/hash'
import { buildOfficialEntityExtraction } from '../src/pipeline'
import { persistSnapshotEntityExtraction } from '../src/repository'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  SnapshotRecord,
  SourceManifestV1,
} from '../src/types'
import { sourceManifest } from './fixtures'

type SqlValue = string | number | bigint | Uint8Array | null

function sqliteValues(values: unknown[]): SqlValue[] {
  return values.map((value) => {
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'bigint'
      || value instanceof Uint8Array
    ) return value
    throw new TypeError(`Unsupported SQLite bind value: ${typeof value}`)
  })
}

class SqliteStatement implements D1PreparedStatement {
  private values: SqlValue[] = []

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = sqliteValues(values)
    return this
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null
  }

  async all<T>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: this.database.prepare(this.query).all(...this.values) as T[],
    }
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.runSync() as D1Result<T>
  }

  runSync(): D1Result {
    const result = this.database.prepare(this.query).run(...this.values)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class SqliteD1 implements D1Database {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.database, query)
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteStatement)) {
          throw new TypeError('Unexpected prepared statement implementation')
        }
        return statement.runSync() as D1Result<T>
      })
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const checkedAt = '2026-08-05T00:00:00.000Z'

function pipelineDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  const directory = resolve('infra/d1/pipeline/migrations')
  for (const fileName of readdirSync(directory)
    .filter((value) => value.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(resolve(directory, fileName), 'utf8'))
  }
  return database
}

function seedInstitution(database: DatabaseSync, institutionId: string): void {
  database.prepare(
    `INSERT INTO records (id, public_id, kind, slug, workflow_status)
     VALUES ('city-example', 'city-example', 'location', 'city-example', 'applied'),
            (?, ?, 'organization', ?, 'applied')`,
  ).run(institutionId, institutionId, institutionId)
  database.exec(
    `INSERT INTO locations (record_id, location_type, country_code)
     VALUES ('city-example', 'city', 'CN')`,
  )
  database.prepare(
    `INSERT INTO organizations (record_id, organization_type, official_url)
     VALUES (?, 'university', 'https://admissions.example.edu.cn')`,
  ).run(institutionId)
  database.prepare(
    `INSERT INTO institutions (
       record_id, city_id, institution_type, admissions_url
     ) VALUES (
       ?, 'city-example', 'comprehensive', 'https://admissions.example.edu.cn'
     )`,
  ).run(institutionId)
}

function manifestFor(
  sourceId: string,
  governmentScholarship = false,
): SourceManifestV1 {
  return sourceManifest({
    id: sourceId,
    institutionId: 'uni-example',
    entityType: governmentScholarship ? 'scholarship' : 'program',
    sourceCategory: governmentScholarship ? 'government_scholarship' : 'undergraduate_catalog',
    officialUrl: `https://admissions.example.edu.cn/catalog/${sourceId}.html`,
    allowedHosts: ['admissions.example.edu.cn'],
  })
}

async function seedCandidate(
  database: DatabaseSync,
  suffix: string,
  governmentScholarship = false,
): Promise<string> {
  const manifest = manifestFor(`example-catalog-${suffix}`, governmentScholarship)
  const sourceId = manifest.id
  const snapshotId = `snapshot-${suffix}`
  const jobId = `job-${suffix}`
  const rawSha256 = await sha256Hex(`raw-${suffix}`)
  const canonicalSha256 = await sha256Hex(`canonical-${suffix}`)
  const snapshot: SnapshotRecord = {
    snapshotId,
    sourceId,
    r2Key: `snapshots/${rawSha256}.html`,
    rawSha256,
    canonicalSha256,
    contentType: 'text/html; charset=utf-8',
    byteLength: 512,
    finalUrl: manifest.officialUrl,
    fetchedAt: checkedAt,
    etag: null,
    lastModified: null,
  }
  database.prepare(
    `INSERT INTO ingestion_sources (
       source_id, manifest_json, enabled, created_at, updated_at
     ) VALUES (?, ?, 1, ?, ?)`,
  ).run(sourceId, JSON.stringify(manifest), checkedAt, checkedAt)
  database.prepare(
    `INSERT INTO ingestion_jobs (
       job_id, source_id, status, reason, scheduled_at,
       created_at, updated_at
     ) VALUES (?, ?, 'running', 'manual', ?, ?, ?)`,
  ).run(jobId, sourceId, checkedAt, checkedAt, checkedAt)

  const extraction = await buildOfficialEntityExtraction(
    manifest,
    snapshotId,
    jobId,
    manifest.officialUrl,
    governmentScholarship
      ? `<table>
           <tr><th>Scholarship</th><th>Details</th></tr>
           <tr><td>Chinese Government Scholarship ${suffix}</td>
             <td><a href="../../scholarships/${suffix}.html">Details</a></td></tr>
         </table>`
      : `<table>
           <tr><th>Program</th><th>Details</th></tr>
           <tr><td>Bachelor of Engineering in Computer Science ${suffix}</td>
             <td><a href="../../programs/${suffix}.html">Details</a></td></tr>
         </table>`,
    snapshot.contentType,
    checkedAt,
  )
  assert.ok(extraction)
  assert.equal(extraction.candidates.length, 1)
  await persistSnapshotEntityExtraction(
    { INGESTION_DB: new SqliteD1(database) },
    { snapshot, entityExtraction: extraction },
  )

  const sourceDocumentId = `source-document-${suffix}`
  database.prepare(
    `INSERT INTO source_documents (
       id, public_id, canonical_url, publisher_organization_id,
       source_kind, authority_level, official, language_code,
       active, robots_policy, created_at, updated_at
     ) VALUES (
       ?, ?, ?, 'uni-example', ?, 'primary_official',
       1, 'en', 1, 'enforce', ?, ?
     )`,
  ).run(
    sourceDocumentId,
    sourceDocumentId,
    manifest.officialUrl,
    governmentScholarship ? 'scholarship' : 'program',
    checkedAt,
    checkedAt,
  )
  database.prepare(
    `INSERT INTO promotion_source_bindings (
       source_id, source_document_id, enabled, created_at, updated_at
     ) VALUES (?, ?, 1, ?, ?)`,
  ).run(sourceId, sourceDocumentId, checkedAt, checkedAt)
  return extraction.candidates[0].candidateId
}

function count(database: DatabaseSync, table: string): number {
  return Number((database.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).get() as { count: number }).count)
}

function plainRow<T extends Record<string, unknown>>(value: unknown): T {
  return { ...(value as T) }
}

test('materializes a validated directory entity with evidence and remains idempotent', async () => {
  const database = pipelineDatabase()
  try {
    seedInstitution(database, 'uni-example')
    const candidateId = await seedCandidate(database, 'computer-science')
    const d1 = new SqliteD1(database)

    const result = await materializeExtractedEntityCandidate(d1, candidateId, {
      decidedAt: '2026-08-05T01:00:00.000Z',
    })
    assert.equal(result.status, 'materialized')
    assert.ok(result.recordId)
    assert.equal(result.mappedFields, 4)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT candidate_status, registered_at
           FROM extracted_entity_candidates WHERE candidate_id = ?`,
      ).get(candidateId)),
      {
        candidate_status: 'registered',
        registered_at: '2026-08-05T01:00:00.000Z',
      },
    )
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT registry_status, canonical_record_id
           FROM entity_registry`,
      ).get()),
      { registry_status: 'active', canonical_record_id: result.recordId },
    )
    assert.equal(
      (database.prepare(
        `SELECT disposition FROM catalog_reconciliation_items`,
      ).get() as { disposition: string }).disposition,
      'published',
    )
    assert.equal(count(database, 'programs'), 1)
    assert.equal(count(database, 'canonical_fields'), 4)
    assert.equal(count(database, 'entity_candidate_field_mappings'), 4)
    assert.equal(count(database, 'entity_materialization_decisions'), 1)
    assert.equal(count(database, 'record_versions'), 1)

    const before = {
      claims: count(database, 'claims'),
      fields: count(database, 'canonical_fields'),
      mappings: count(database, 'entity_candidate_field_mappings'),
      versions: count(database, 'record_versions'),
    }
    const repeated = await materializeExtractedEntityCandidate(d1, candidateId)
    assert.equal(repeated.status, 'already-materialized')
    assert.deepEqual({
      claims: count(database, 'claims'),
      fields: count(database, 'canonical_fields'),
      mappings: count(database, 'entity_candidate_field_mappings'),
      versions: count(database, 'record_versions'),
    }, before)
  } finally {
    database.close()
  }
})

test('quarantines low-confidence entities without leaking canonical records', async () => {
  const database = pipelineDatabase()
  try {
    seedInstitution(database, 'uni-example')
    const candidateId = await seedCandidate(database, 'low-confidence')
    database.prepare(
      `UPDATE extracted_entity_candidates SET confidence_ppm = 700000
        WHERE candidate_id = ?`,
    ).run(candidateId)

    const result = await materializeExtractedEntityCandidate(
      new SqliteD1(database),
      candidateId,
      { decidedAt: '2026-08-05T01:00:00.000Z' },
    )
    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'entity_confidence_below_threshold')
    assert.equal(count(database, 'programs'), 0)
    assert.equal(count(database, 'canonical_fields'), 0)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT candidate_status FROM extracted_entity_candidates
          WHERE candidate_id = ?`,
      ).get(candidateId)),
      { candidate_status: 'quarantined' },
    )
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT disposition, reason_code FROM catalog_reconciliation_items`,
      ).get()),
      {
        disposition: 'unparseable',
        reason_code: 'entity_confidence_below_threshold',
      },
    )
  } finally {
    database.close()
  }
})

test('quarantines a government scholarship when its provider is not explicit', async () => {
  const database = pipelineDatabase()
  try {
    seedInstitution(database, 'uni-example')
    const candidateId = await seedCandidate(database, 'government-award', true)

    const result = await materializeExtractedEntityCandidate(
      new SqliteD1(database),
      candidateId,
      { decidedAt: '2026-08-05T01:00:00.000Z' },
    )

    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'entity_candidate_invalid')
    assert.match(result.issues?.join(' ') ?? '', /providerOrganizationId/u)
    assert.equal(count(database, 'scholarships'), 0)
    assert.equal(count(database, 'canonical_fields'), 0)
  } finally {
    database.close()
  }
})

test('creates one release request per UTC day and rejects unsafe cohorts', async () => {
  const database = pipelineDatabase()
  try {
    seedInstitution(database, 'uni-example')
    const safeCandidateId = await seedCandidate(database, 'safe-release')
    const unsafeCandidateId = await seedCandidate(database, 'unsafe-release')
    const d1 = new SqliteD1(database)
    await materializeExtractedEntityCandidate(d1, safeCandidateId, {
      decidedAt: '2026-08-05T01:00:00.000Z',
    })
    database.prepare(
      `UPDATE extracted_entity_candidates SET confidence_ppm = 100000
        WHERE candidate_id = ?`,
    ).run(unsafeCandidateId)
    await materializeExtractedEntityCandidate(d1, unsafeCandidateId, {
      decidedAt: '2026-08-05T01:00:00.000Z',
    })

    const requested = await requestEntityMaterializationRelease(
      d1,
      [safeCandidateId],
      '2026-08-05T02:00:00.000Z',
    )
    assert.equal(requested.status, 'requested')
    const repeated = await requestEntityMaterializationRelease(
      d1,
      [safeCandidateId],
      '2026-08-05T03:00:00.000Z',
    )
    assert.equal(repeated.status, 'already-requested')
    assert.equal(repeated.requestId, requested.requestId)
    assert.equal(count(database, 'entity_materialization_release_requests'), 1)
    assert.equal(count(database, 'publication_jobs'), 1)
    assert.equal(count(database, 'outbox_events'), 1)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT event_type, event_status FROM outbox_events`,
      ).get()),
      { event_type: 'catalog.release.requested', event_status: 'pending' },
    )

    await assert.rejects(
      requestEntityMaterializationRelease(
        d1,
        [unsafeCandidateId],
        '2026-08-06T02:00:00.000Z',
      ),
      /unsafe candidate/iu,
    )
    assert.equal(count(database, 'entity_materialization_release_requests'), 1)
    assert.equal(count(database, 'publication_jobs'), 1)
  } finally {
    database.close()
  }
})
