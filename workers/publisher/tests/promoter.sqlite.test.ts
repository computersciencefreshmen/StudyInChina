import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { sha256Hex } from '../../ingestion/src/hash'
import {
  miniMaxCandidateProvenance,
  ruleCandidateProvenance,
} from '../../ingestion/src/provenance'
import type {
  ExtractionEnvelope,
  ExtractionFact,
  SourceManifestV1,
} from '../../ingestion/src/types'
import { promoteCandidate } from '../src/promoter'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../src/types'

type SqliteValue = string | number | bigint | Uint8Array | null

function sqliteValues(values: unknown[]): SqliteValue[] {
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
  private values: SqliteValue[] = []

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = sqliteValues(values)
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: this.database.prepare(this.query).all(...this.values) as T[],
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.runSync() as D1Result<T>
  }

  runSync(): D1Result {
    const result = this.database.prepare(this.query).run(...this.values)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class SqliteD1 implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.sqlite, query)
  }

  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<Array<D1Result<T>>> {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteStatement)) throw new TypeError('Unexpected statement')
        return statement.runSync() as D1Result<T>
      })
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

function applyMigrations(database: DatabaseSync): void {
  const directory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const name of [
    '0001_domain.sql',
    '0002_evidence_workflow.sql',
    '0003_indexes_guards.sql',
    '0004_worker_runtime.sql',
    '0005_domain_throttle.sql',
    '0006_candidate_provenance_promotion.sql',
  ]) {
    database.exec(readFileSync(join(directory, name), 'utf8'))
  }
}

type SeedOptions = {
  candidateId: string
  extractor: 'rules' | 'minimax-dual'
  gateStatus: 'rule-pass' | 'dual-pass' | 'quarantined'
  critical: boolean
  withMapping: boolean
  fieldPath?: string
}

async function seedCandidate(database: DatabaseSync, options: SeedOptions) {
  const sourceId = `source-${options.candidateId}`
  const snapshotId = `snapshot-${options.candidateId}`
  const recordId = `record-${options.candidateId}`
  const sourceDocumentId = `document-${options.candidateId}`
  const fieldPath = options.fieldPath ?? 'applicationUrl'
  const value = `https://apply.example.edu.cn/${options.candidateId}`
  const field = {
    path: fieldPath,
    type: 'string' as const,
    required: true,
    critical: options.critical,
  }
  const manifest: SourceManifestV1 = {
    version: 1,
    id: sourceId,
    institutionId: 'uni-test',
    entityType: 'university',
    sourceCategory: 'application_portal',
    officialUrl: `https://admissions.example.edu.cn/${sourceId}`,
    allowedHosts: ['admissions.example.edu.cn'],
    enabled: true,
    schedule: { intervalHours: 168 },
    fetch: { maxBytes: 1024 * 1024 },
    robots: { mode: 'enforce' },
    extraction: {
      mode: options.extractor === 'rules' ? 'rules-only' : 'minimax',
      schemaVersion: `schema-${options.candidateId}`,
      fields: [field],
      rules: options.extractor === 'rules'
        ? [{ kind: 'regex', fieldPath, pattern: 'Apply: (https://\\S+)' }]
        : undefined,
    },
  }
  const primaryEvidence = { quote: `Apply at ${value}`, locator: 'text:primary' }
  const secondaryEvidence = { quote: `Official application: ${value}`, locator: 'text:secondary' }
  const fact: ExtractionFact = { fieldPath, value, evidence: primaryEvidence }
  const primary: ExtractionEnvelope = {
    sourceId,
    schemaVersion: manifest.extraction.schemaVersion,
    facts: [fact],
  }
  const secondary: ExtractionEnvelope = {
    sourceId,
    schemaVersion: manifest.extraction.schemaVersion,
    facts: [{ fieldPath, value, evidence: secondaryEvidence }],
  }
  const provenance = options.extractor === 'rules'
    ? await ruleCandidateProvenance(manifest, [fact], options.critical)
    : await miniMaxCandidateProvenance(
        manifest,
        [fact],
        primary,
        secondary,
        'MiniMax-M2.7',
        options.critical,
      )
  const rawHash = await sha256Hex(sourceId)

  database.prepare(
    `INSERT INTO records (id, public_id, kind, workflow_status, row_version)
     VALUES (?, ?, 'organization', 'validated', 1)`,
  ).run(recordId, recordId)
  database.prepare(
    `INSERT OR IGNORE INTO field_definitions (
       record_kind, field_path, value_type, risk_class, required_for_publish, max_age_days
     ) VALUES ('organization', 'admissions_url', 'url', ?, 1, 30)`,
  ).run(options.critical ? 'critical' : 'low')
  database.prepare(
    `INSERT INTO source_documents (
       id, public_id, canonical_url, source_kind, authority_level,
       official, language_code, active, robots_policy
     ) VALUES (?, ?, ?, 'admissions', 'primary_official', 1, 'en', 1, 'enforce')`,
  ).run(sourceDocumentId, sourceDocumentId, manifest.officialUrl)
  database.prepare(
    `INSERT INTO ingestion_sources (source_id, manifest_json, enabled)
     VALUES (?, ?, 1)`,
  ).run(sourceId, JSON.stringify(manifest))
  database.prepare(
    `INSERT INTO ingestion_snapshots (
       snapshot_id, source_id, r2_key, raw_sha256, canonical_sha256,
       content_type, byte_length, final_url, fetched_at
     ) VALUES (?, ?, ?, ?, ?, 'text/html', 128, ?, '2026-07-20T00:00:00.000Z')`,
  ).run(
    snapshotId,
    sourceId,
    `snapshots/${rawHash}`,
    rawHash,
    rawHash,
    manifest.officialUrl,
  )
  database.prepare(
    `INSERT INTO promotion_source_bindings (source_id, source_document_id)
     VALUES (?, ?)`,
  ).run(sourceId, sourceDocumentId)
  if (options.withMapping) {
    database.prepare(
      `INSERT INTO promotion_field_mappings (
         source_id, candidate_field_path, subject_record_id, canonical_field_path
       ) VALUES (?, ?, ?, 'admissions_url')`,
    ).run(sourceId, fieldPath, recordId)
  }
  database.prepare(
    `INSERT INTO ingestion_candidates (
       candidate_id, source_id, snapshot_id, extractor, gate_status,
       facts_json, issues_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, '[]', '2026-07-20T00:00:00.000Z')`,
  ).run(
    options.candidateId,
    sourceId,
    snapshotId,
    options.extractor,
    options.gateStatus,
    JSON.stringify([fact]),
  )
  database.prepare(
    `INSERT INTO ingestion_candidate_provenance (
       candidate_id, schema_version, model_name, prompt_fingerprint,
       extractor_fingerprint, primary_extraction_json,
       secondary_extraction_json, field_evidence_json, contains_critical,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-07-20T00:00:00.000Z')`,
  ).run(
    options.candidateId,
    provenance.schemaVersion,
    provenance.model,
    provenance.promptFingerprint,
    provenance.extractorFingerprint,
    provenance.primaryExtraction === null ? null : JSON.stringify(provenance.primaryExtraction),
    provenance.secondaryExtraction === null ? null : JSON.stringify(provenance.secondaryExtraction),
    JSON.stringify(provenance.fieldEvidence),
    provenance.containsCritical ? 1 : 0,
  )
  return { candidateId: options.candidateId, recordId, value }
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  applyMigrations(sqlite)
  return { sqlite, database: new SqliteD1(sqlite) }
}

test('validated dual candidate atomically creates canonical data and a publication outbox job', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-dual',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: true,
      withMapping: true,
    })
    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(
      result.status,
      'applied',
      JSON.stringify({
        result,
        isolation: sqlite.prepare(
          `SELECT reason_code, issues_json FROM promotion_isolations WHERE candidate_id = ?`,
        ).get(seeded.candidateId),
      }),
    )
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.candidate_status, 'applied')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claims`).get()?.count, 1)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claim_evidence`).get()?.count, 2)
    const canonical = sqlite.prepare(
      `SELECT field_status, value_json FROM canonical_fields WHERE subject_record_id = ?`,
    ).get(seeded.recordId) as { field_status: string; value_json: string }
    assert.equal(canonical.field_status, 'accepted')
    assert.equal(JSON.parse(canonical.value_json), seeded.value)
    assert.equal(sqlite.prepare(`SELECT change_status FROM change_sets`).get()?.change_status, 'applied')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM record_versions`).get()?.count, 1)
    assert.equal(sqlite.prepare(`SELECT job_status FROM publication_jobs`).get()?.job_status, 'queued')
    assert.equal(sqlite.prepare(`SELECT event_status FROM outbox_events`).get()?.event_status, 'pending')
  } finally {
    sqlite.close()
  }
})

test('repeating the same promotion is idempotent', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-repeat',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: true,
      withMapping: true,
    })
    await promoteCandidate(database, seeded.candidateId, new Date('2026-07-20T01:00:00.000Z'))
    const repeated = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T02:00:00.000Z'),
    )

    assert.equal(repeated.status, 'already-applied')
    for (const table of [
      'claims',
      'canonical_fields',
      'change_sets',
      'record_versions',
      'publication_jobs',
      'outbox_events',
    ]) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 1)
    }
    assert.equal(sqlite.prepare(`SELECT row_version FROM records`).get()?.row_version, 2)
  } finally {
    sqlite.close()
  }
})

test('a noncritical rule-pass candidate can promote with one evidence fragment', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-rule-safe',
      extractor: 'rules',
      gateStatus: 'rule-pass',
      critical: false,
      withMapping: true,
    })
    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(result.status, 'applied')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claim_evidence`).get()?.count, 1)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 1)
  } finally {
    sqlite.close()
  }
})

test('quarantined candidates and critical rule-only candidates never publish', async () => {
  for (const options of [
    {
      candidateId: 'candidate-quarantined',
      extractor: 'minimax-dual' as const,
      gateStatus: 'quarantined' as const,
      critical: true,
    },
    {
      candidateId: 'candidate-critical-rule',
      extractor: 'rules' as const,
      gateStatus: 'rule-pass' as const,
      critical: true,
    },
  ]) {
    const { sqlite, database } = fixture()
    try {
      await seedCandidate(sqlite, { ...options, withMapping: true })
      const result = await promoteCandidate(
        database,
        options.candidateId,
        new Date('2026-07-20T01:00:00.000Z'),
      )
      assert.equal(result.status, 'quarantined')
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 0)
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claims`).get()?.count, 0)
    } finally {
      sqlite.close()
    }
  }
})

test('an unknown field mapping is isolated without guessing a canonical target', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-unknown',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: false,
      withMapping: false,
      fieldPath: 'unknownField',
    })
    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'field_mapping_missing')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claims`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM canonical_fields`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 0)
    assert.equal(sqlite.prepare(
      `SELECT reason_code FROM promotion_isolations WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.reason_code, 'field_mapping_missing')
  } finally {
    sqlite.close()
  }
})

test('a late publication error rolls back every canonical write before isolation', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-rollback',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: true,
      withMapping: true,
    })
    sqlite.exec(`
      CREATE TRIGGER force_publication_failure
      BEFORE INSERT ON publication_jobs
      BEGIN
        SELECT RAISE(ABORT, 'forced publication failure');
      END;
    `)

    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'promotion_transaction_failed')
    for (const table of [
      'source_fetches',
      'source_fragments',
      'claims',
      'canonical_fields',
      'change_sets',
      'record_versions',
      'publication_jobs',
      'outbox_events',
    ]) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0)
    }
    assert.equal(sqlite.prepare(
      `SELECT reason_code FROM promotion_isolations WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.reason_code, 'promotion_transaction_failed')
  } finally {
    sqlite.close()
  }
})
