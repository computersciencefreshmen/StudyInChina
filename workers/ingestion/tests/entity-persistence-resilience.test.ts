import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { IngestionError } from '../src/errors'
import { processIngestionJob } from '../src/pipeline'
import { recordJobFailure } from '../src/repository'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Fetcher,
  IngestionEnv,
  IngestionJob,
  SourceManifestV1,
} from '../src/types'
import { sourceManifest } from './fixtures'

type SqlValue = string | number | bigint | null | Uint8Array

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.database, this.query, values as SqlValue[])
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null
  }

  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: this.database.prepare(this.query).all(...this.values) as T[] }
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.database.prepare(this.query).run(...this.values)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class SqliteD1 implements D1Database {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, query)
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }
}

const checkedAt = new Date('2026-07-20T00:00:00.000Z')
const initialNextFetchAt = '2026-07-21T00:00:00.000Z'

function databaseWithEntitySchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    '0001_domain.sql',
    '0002_evidence_workflow.sql',
    '0003_indexes_guards.sql',
    '0004_worker_runtime.sql',
    '0005_domain_throttle.sql',
    '0006_candidate_provenance_promotion.sql',
    '0007_snapshot_derivatives.sql',
    '0008_release_builder_contract.sql',
    '0009_entity_discovery_registry.sql',
  ]) {
    database.exec(readFileSync(resolve('infra/d1/pipeline/migrations', migration), 'utf8'))
  }
  return database
}

function seedInstitution(database: DatabaseSync, institutionId: string): void {
  database.prepare(
    `INSERT INTO records (id, public_id, kind, slug)
     VALUES (?, ?, 'location', ?), (?, ?, 'organization', ?)`,
  ).run(
    'example-city',
    'example-city',
    'example-city',
    institutionId,
    institutionId,
    institutionId,
  )
  database.prepare(
    `INSERT INTO locations (record_id, location_type, country_code)
     VALUES ('example-city', 'city', 'CN')`,
  ).run()
  database.prepare(
    `INSERT INTO organizations (record_id, organization_type, official_url)
     VALUES (?, 'university', 'https://admissions.example.edu.cn')`,
  ).run(institutionId)
  database.prepare(
    `INSERT INTO institutions
       (record_id, city_id, institution_type, admissions_url)
     VALUES (?, 'example-city', 'comprehensive', 'https://admissions.example.edu.cn')`,
  ).run(institutionId)
}

function seedSourceAndJob(
  database: DatabaseSync,
  manifest: SourceManifestV1,
  job: IngestionJob,
): void {
  seedInstitution(database, manifest.institutionId)
  database.prepare(
    `INSERT INTO ingestion_sources
       (source_id, manifest_json, enabled, next_fetch_at, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
  ).run(
    manifest.id,
    JSON.stringify(manifest),
    initialNextFetchAt,
    checkedAt.toISOString(),
    checkedAt.toISOString(),
  )
  database.prepare(
    `INSERT INTO ingestion_jobs
       (job_id, source_id, status, reason, scheduled_at, attempt,
        started_at, created_at, updated_at)
     VALUES (?, ?, 'running', ?, ?, 1, ?, ?, ?)`,
  ).run(
    job.jobId,
    job.sourceId,
    job.reason,
    job.scheduledAt,
    checkedAt.toISOString(),
    checkedAt.toISOString(),
    checkedAt.toISOString(),
  )
  database.prepare(
    `INSERT INTO ingestion_robots_cache
       (host, body, status_code, fetched_at, expires_at)
     VALUES ('admissions.example.edu.cn', '', 200, ?, '2099-01-01T00:00:00.000Z')`,
  ).run(checkedAt.toISOString())
}

function testJob(sourceId: string): IngestionJob {
  return {
    version: 1,
    jobId: `job-${sourceId}`,
    sourceId,
    reason: 'manual',
    scheduledAt: checkedAt.toISOString(),
  }
}

function environmentFor(database: DatabaseSync): IngestionEnv {
  const storedObjects = new Set<string>()
  return {
    INGESTION_DB: new SqliteD1(database),
    SNAPSHOTS_BUCKET: {
      async get() { return null },
      async head(key) { return storedObjects.has(key) ? {} : null },
      async put(key) { storedObjects.add(key); return {} },
      async delete(key) { storedObjects.delete(key) },
    },
    INGESTION_QUEUE: { async send() {} },
    INGESTION_DLQ: { async send() {} },
    QUARANTINE_QUEUE: { async send() {} },
    MINIMAX_API_URL: 'https://api.minimaxi.com/v1/chat/completions',
    MINIMAX_API_KEY: 'test-only',
    MINIMAX_MODEL: 'MiniMax-M2.7',
  }
}

function fetcherFor(html: string, invalidMiniMax = true): Fetcher {
  return async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url)
    if (url.hostname === 'api.minimaxi.com') {
      assert.equal(invalidMiniMax, true)
      return Response.json({
        choices: [{ message: { content: 'not-json' } }],
      })
    }
    assert.equal(url.hostname, 'admissions.example.edu.cn')
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return Number(row.count)
}

function plainRow(value: unknown): unknown {
  return value === null ? null : { ...(value as Record<string, unknown>) }
}

function catalogManifest(): SourceManifestV1 {
  return sourceManifest({
    id: 'example-undergraduate-catalog',
    entityType: 'program',
    sourceCategory: 'undergraduate_catalog',
    officialUrl: 'https://admissions.example.edu.cn/catalog/index.html',
  })
}

async function expectMiniMaxFailure(
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  job: IngestionJob,
  html: string,
): Promise<void> {
  await assert.rejects(
    processIngestionJob(environment, job, fetcherFor(html), checkedAt),
    (error: unknown) => error instanceof IngestionError
      && error.code === 'minimax_output_json_invalid'
      && error.retryable,
  )
}

test('directory entities survive MiniMax failure and repeated retries idempotently', async () => {
  const database = databaseWithEntitySchema()
  try {
    const manifest = catalogManifest()
    const job = testJob(manifest.id)
    seedSourceAndJob(database, manifest, job)
    const environment = environmentFor(database)
    const html = `
      <table>
        <tr><th>No.</th><th>Program</th><th>Link</th></tr>
        <tr><td>1</td><td>Bachelor of Engineering in Computer Science</td>
          <td><a href="../programs/cs.html">Details</a></td></tr>
      </table>
      <p>Deadline: 2026-09-01 Tuition: 30000 CNY</p>
    `

    await expectMiniMaxFailure(environment, manifest, job, html)

    assert.equal(count(database, 'ingestion_snapshots'), 1)
    assert.equal(count(database, 'source_discoveries'), 1)
    assert.equal(count(database, 'extracted_entity_candidates'), 1)
    assert.equal(count(database, 'entity_registry'), 1)
    assert.equal(count(database, 'catalog_reconciliation_items'), 1)
    assert.equal(count(database, 'entity_extraction_runs'), 1)
    assert.equal(count(database, 'ingestion_candidates'), 0)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT extraction_status, candidate_count
           FROM entity_extraction_runs`,
      ).get()),
      { extraction_status: 'completed', candidate_count: 1 },
    )
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT registry_status FROM entity_registry`,
      ).get()),
      { registry_status: 'pending' },
    )
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT disposition FROM catalog_reconciliation_items`,
      ).get()),
      { disposition: 'pending' },
    )

    await recordJobFailure(environment, {
      job,
      sourceId: manifest.id,
      attempt: 1,
      code: 'minimax_output_json_invalid',
      message: 'MiniMax output was invalid',
      retrying: true,
      now: checkedAt.toISOString(),
    })
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT status, outcome, completed_at FROM ingestion_jobs WHERE job_id = ?`,
      ).get(job.jobId)),
      { status: 'retrying', outcome: null, completed_at: null },
    )
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT raw_sha256, canonical_sha256, next_fetch_at
           FROM ingestion_sources WHERE source_id = ?`,
      ).get(manifest.id)),
      {
        raw_sha256: null,
        canonical_sha256: null,
        next_fetch_at: initialNextFetchAt,
      },
    )

    database.prepare(
      `UPDATE ingestion_jobs SET status = 'running', attempt = 2, updated_at = ?
        WHERE job_id = ?`,
    ).run(checkedAt.toISOString(), job.jobId)
    await expectMiniMaxFailure(environment, manifest, job, html)

    for (const table of [
      'ingestion_snapshots',
      'source_discoveries',
      'extracted_entity_candidates',
      'entity_registry',
      'catalog_reconciliation_items',
      'entity_extraction_runs',
    ]) {
      assert.equal(count(database, table), 1, `${table} must remain idempotent`)
    }
    assert.equal(
      (database.prepare(
        `SELECT status FROM ingestion_jobs WHERE job_id = ?`,
      ).get(job.jobId) as { status: string }).status,
      'running',
    )
  } finally {
    database.close()
  }
})

test('zero-candidate catalog writes a completed entity run before MiniMax failure', async () => {
  const database = databaseWithEntitySchema()
  try {
    const manifest = catalogManifest()
    const job = testJob(manifest.id)
    seedSourceAndJob(database, manifest, job)
    const environment = environmentFor(database)

    await expectMiniMaxFailure(
      environment,
      manifest,
      job,
      '<p>Deadline: 2026-09-01 Tuition: 30000 CNY</p>',
    )

    assert.equal(count(database, 'ingestion_snapshots'), 1)
    assert.equal(count(database, 'extracted_entity_candidates'), 0)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT extraction_status, candidate_count FROM entity_extraction_runs`,
      ).get()),
      { extraction_status: 'completed', candidate_count: 0 },
    )
    assert.equal(
      (database.prepare(
        `SELECT status FROM ingestion_jobs WHERE job_id = ?`,
      ).get(job.jobId) as { status: string }).status,
      'running',
    )
  } finally {
    database.close()
  }
})

test('ordinary rules-only pages retain the existing completed-result path', async () => {
  const database = databaseWithEntitySchema()
  try {
    const manifest = sourceManifest({
      extraction: {
        mode: 'rules-only',
        schemaVersion: 'deadline-v1',
        fields: [{ path: 'deadline', type: 'date', required: true }],
        rules: [{
          kind: 'regex',
          fieldPath: 'deadline',
          pattern: 'Deadline:\\s*(\\d{4}-\\d{2}-\\d{2})',
        }],
      },
    })
    const job = testJob(manifest.id)
    seedSourceAndJob(database, manifest, job)
    const environment = environmentFor(database)

    await processIngestionJob(
      environment,
      job,
      fetcherFor('<p>Deadline: 2026-09-01</p>', false),
      checkedAt,
    )

    assert.equal(count(database, 'ingestion_snapshots'), 1)
    assert.equal(count(database, 'ingestion_candidates'), 1)
    assert.equal(count(database, 'entity_extraction_runs'), 0)
    assert.deepEqual(
      plainRow(database.prepare(
        `SELECT status, outcome FROM ingestion_jobs WHERE job_id = ?`,
      ).get(job.jobId)),
      { status: 'completed', outcome: 'rule-pass' },
    )
  } finally {
    database.close()
  }
})
