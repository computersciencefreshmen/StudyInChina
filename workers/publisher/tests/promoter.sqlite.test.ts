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
import { handleQueue, scheduleValidatedCandidates } from '../src/index'
import { promoteCandidate } from '../src/promoter'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  PromotionFailure,
  PromotionJob,
  PublisherEnv,
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
    '0015_promotion_mapping_transforms.sql',
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
  fieldType?: SourceManifestV1['extraction']['fields'][number]['type']
  value?: unknown
  canonicalFieldPath?: string
  canonicalValueType?: 'url' | 'integer' | 'decimal_minor' | 'date' | 'json'
  valueTransform?: 'identity' | 'major_to_minor_2'
  additionalFields?: Array<{
    fieldPath: string
    value: string
    canonicalFieldPath: string
    withMapping: boolean
  }>
}

async function seedCandidate(database: DatabaseSync, options: SeedOptions) {
  const sourceId = `source-${options.candidateId}`
  const snapshotId = `snapshot-${options.candidateId}`
  const recordId = `record-${options.candidateId}`
  const sourceDocumentId = `document-${options.candidateId}`
  const fieldPath = options.fieldPath ?? 'applicationUrl'
  const value = options.value ?? `https://apply.example.edu.cn/${options.candidateId}`
  const fieldType = options.fieldType ?? 'string'
  const canonicalFieldPath = options.canonicalFieldPath ?? 'admissions_url'
  const canonicalValueType = options.canonicalValueType ?? 'url'
  const additionalFields = options.additionalFields ?? []
  const field = {
    path: fieldPath,
    type: fieldType,
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
      fields: [field, ...additionalFields.map((item) => ({
        path: item.fieldPath,
        type: 'string' as const,
        required: true,
        critical: options.critical,
      }))],
      rules: options.extractor === 'rules'
        ? [{ kind: 'regex', fieldPath, pattern: 'Apply: (https://\\S+)' }]
        : undefined,
    },
  }
  const primaryEvidence = { quote: `Apply at ${value}`, locator: 'text:primary' }
  const secondaryEvidence = { quote: `Official application: ${value}`, locator: 'text:secondary' }
  const fact: ExtractionFact = { fieldPath, value, evidence: primaryEvidence }
  const facts: ExtractionFact[] = [fact, ...additionalFields.map((item) => ({
    fieldPath: item.fieldPath,
    value: item.value,
    evidence: { quote: `Apply at ${item.value}`, locator: 'text:primary' },
  }))]
  const primary: ExtractionEnvelope = {
    sourceId,
    schemaVersion: manifest.extraction.schemaVersion,
    facts,
  }
  const secondary: ExtractionEnvelope = {
    sourceId,
    schemaVersion: manifest.extraction.schemaVersion,
    facts: [{ fieldPath, value, evidence: secondaryEvidence }, ...additionalFields.map((item) => ({
      fieldPath: item.fieldPath,
      value: item.value,
      evidence: { quote: `Official application: ${item.value}`, locator: 'text:secondary' },
    }))],
  }
  const provenance = options.extractor === 'rules'
    ? await ruleCandidateProvenance(manifest, facts, options.critical)
    : await miniMaxCandidateProvenance(
        manifest,
        facts,
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
    `INSERT INTO field_definitions (
       record_kind, field_path, value_type, risk_class, required_for_publish, max_age_days
     ) VALUES ('organization', ?, ?, ?, 1, 30)`,
  ).run(canonicalFieldPath, canonicalValueType, options.critical ? 'critical' : 'low')
  for (const item of additionalFields) {
    database.prepare(
      `INSERT INTO field_definitions (
         record_kind, field_path, value_type, risk_class, required_for_publish, max_age_days
       ) VALUES ('organization', ?, 'url', ?, 1, 30)`,
    ).run(item.canonicalFieldPath, options.critical ? 'critical' : 'low')
  }
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
         source_id, candidate_field_path, subject_record_id,
         canonical_field_path
       ) VALUES (?, ?, ?, ?)`,
    ).run(sourceId, fieldPath, recordId, canonicalFieldPath)
    if (options.valueTransform) {
      database.prepare(
        `INSERT INTO promotion_field_mapping_transforms (
           source_id, candidate_field_path, value_transform
         ) VALUES (?, ?, ?)`,
      ).run(sourceId, fieldPath, options.valueTransform)
    }
  }
  for (const item of additionalFields) {
    if (!item.withMapping) continue
    database.prepare(
      `INSERT INTO promotion_field_mappings (
         source_id, candidate_field_path, subject_record_id, canonical_field_path
       ) VALUES (?, ?, ?, ?)`,
    ).run(sourceId, item.fieldPath, recordId, item.canonicalFieldPath)
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
    JSON.stringify(facts),
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
  return { candidateId: options.candidateId, sourceId, recordId, value }
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  applyMigrations(sqlite)
  return { sqlite, database: new SqliteD1(sqlite) }
}

function environmentFixture(database: D1Database, limit = '20') {
  const jobs: PromotionJob[] = []
  const failures: PromotionFailure[] = []
  const environment: PublisherEnv = {
    PIPELINE_DB: database,
    PROMOTION_QUEUE: { async send(job) { jobs.push(job) } },
    PUBLISHER_DLQ: { async send(failure) { failures.push(failure) } },
    SCHEDULE_BATCH_LIMIT: limit,
  }
  return { environment, jobs, failures }
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

test('an unknown field mapping is deferred without guessing a target or isolating evidence', async () => {
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

    assert.equal(result.status, 'deferred')
    assert.equal(result.reasonCode, 'field_mapping_missing')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claims`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM canonical_fields`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM candidate_promotions`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.candidate_status, 'validated')
    const repeated = await promoteCandidate(database, seeded.candidateId)
    assert.equal(repeated.status, 'deferred')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
  } finally {
    sqlite.close()
  }
})

test('a deferred candidate promotes exactly once after its exact mapping is added', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-mapping-added',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: false,
    })
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'deferred')
    sqlite.prepare(
      `INSERT INTO promotion_field_mappings (
         source_id, candidate_field_path, subject_record_id, canonical_field_path
       ) VALUES (?, 'applicationUrl', ?, 'admissions_url')`,
    ).run(seeded.sourceId, seeded.recordId)

    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'applied')
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'already-applied')
    for (const table of ['claims', 'canonical_fields', 'publication_jobs', 'outbox_events', 'record_versions']) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 1, table)
    }
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.candidate_status, 'applied')
  } finally {
    sqlite.close()
  }
})

test('partial mappings defer the entire candidate and do not consume scheduler capacity', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-partial-mapping',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: true,
      additionalFields: [{
        fieldPath: 'contactUrl', value: 'https://apply.example.edu.cn/contact',
        canonicalFieldPath: 'contact_url', withMapping: false,
      }],
    })
    const { environment, jobs } = environmentFixture(database)
    const controller = { scheduledTime: Date.parse('2026-07-20T01:00:00.000Z'), cron: '37 * * * *' }
    await scheduleValidatedCandidates(controller, environment)
    assert.equal(jobs.length, 0)
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'deferred')
    for (const table of ['claims', 'canonical_fields', 'publication_jobs', 'candidate_promotions', 'promotion_isolations']) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0, table)
    }
    sqlite.prepare(
      `INSERT INTO promotion_field_mappings (
         source_id, candidate_field_path, subject_record_id, canonical_field_path
       ) VALUES (?, 'contactUrl', ?, 'contact_url')`,
    ).run(seeded.sourceId, seeded.recordId)
    await scheduleValidatedCandidates(controller, environment)
    assert.deepEqual(jobs.map((job) => job.candidateId), [seeded.candidateId])
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'applied')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM claims`).get()?.count, 2)
  } finally {
    sqlite.close()
  }
})

test('disabled exact mappings stay deferred until re-enabled', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-disabled-mapping',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: true,
    })
    sqlite.prepare(`UPDATE promotion_field_mappings SET enabled = 0 WHERE source_id = ?`).run(seeded.sourceId)
    const { environment, jobs } = environmentFixture(database)
    const controller = { scheduledTime: Date.parse('2026-07-20T01:00:00.000Z'), cron: '37 * * * *' }
    await scheduleValidatedCandidates(controller, environment)
    assert.equal(jobs.length, 0)
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'deferred')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM candidate_promotions`).get()?.count, 0)
    sqlite.prepare(`UPDATE promotion_field_mappings SET enabled = 1 WHERE source_id = ?`).run(seeded.sourceId)
    await scheduleValidatedCandidates(controller, environment)
    assert.deepEqual(jobs.map((job) => job.candidateId), [seeded.candidateId])
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'applied')
  } finally {
    sqlite.close()
  }
})

test('scheduler excludes unmapped candidates before LIMIT so older gaps cannot starve ready facts', async () => {
  const { sqlite, database } = fixture()
  try {
    const pending = await seedCandidate(sqlite, {
      candidateId: 'candidate-a-unmapped',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: false,
      canonicalFieldPath: 'unmapped_admissions_url',
    })
    const ready = await seedCandidate(sqlite, {
      candidateId: 'candidate-b-ready',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: true,
      canonicalFieldPath: 'ready_admissions_url',
    })
    const { environment, jobs } = environmentFixture(database, '1')
    await scheduleValidatedCandidates({
      scheduledTime: Date.parse('2026-07-20T01:00:00.000Z'), cron: '37 * * * *',
    }, environment)
    assert.deepEqual(jobs.map((job) => job.candidateId), [ready.candidateId])
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(pending.candidateId)?.candidate_status, 'validated')
  } finally {
    sqlite.close()
  }
})

test('malformed fact array entries cannot abort scheduling a healthy candidate', async () => {
  const { sqlite, database } = fixture()
  try {
    const ready = await seedCandidate(sqlite, {
      candidateId: 'candidate-z-healthy',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: true,
    })
    sqlite.prepare(
      `INSERT INTO ingestion_candidates (
         candidate_id, source_id, snapshot_id, extractor, gate_status,
         candidate_status, facts_json, issues_json, created_at, validated_at
       ) SELECT 'candidate-a-malformed', source_id, snapshot_id, extractor, gate_status,
                'validated', ?, '[]', '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'
           FROM ingestion_candidates WHERE candidate_id = ?`,
    ).run(JSON.stringify(['bad', null, 42, [], {}]), ready.candidateId)
    const { environment, jobs } = environmentFixture(database, '1')
    await scheduleValidatedCandidates({
      scheduledTime: Date.parse('2026-07-20T01:00:00.000Z'), cron: '37 * * * *',
    }, environment)
    assert.deepEqual(jobs.map((job) => job.candidateId), [ready.candidateId])
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = 'candidate-a-malformed'`,
    ).get()?.candidate_status, 'validated')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM candidate_promotions`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
  } finally {
    sqlite.close()
  }
})

test('a mapping without its field definition stays deferred and resumes when the definition returns', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-definition-missing',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: true,
    })
    sqlite.prepare(
      `DELETE FROM field_definitions WHERE record_kind = 'organization' AND field_path = 'admissions_url'`,
    ).run()
    assert.equal(sqlite.prepare(
      `SELECT count(*) AS count FROM promotion_field_mappings WHERE source_id = ? AND enabled = 1`,
    ).get(seeded.sourceId)?.count, 1)
    const { environment, jobs } = environmentFixture(database)
    const controller = { scheduledTime: Date.parse('2026-07-20T01:00:00.000Z'), cron: '37 * * * *' }
    await scheduleValidatedCandidates(controller, environment)
    assert.equal(jobs.length, 0)
    const deferred = await promoteCandidate(database, seeded.candidateId)
    assert.equal(deferred.status, 'deferred')
    assert.equal(deferred.reasonCode, 'field_mapping_missing')
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.candidate_status, 'validated')
    for (const table of ['claims', 'canonical_fields', 'candidate_promotions', 'promotion_isolations']) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0, table)
    }
    sqlite.prepare(
      `INSERT INTO field_definitions (
         record_kind, field_path, value_type, risk_class, required_for_publish, max_age_days
       ) VALUES ('organization', 'admissions_url', 'url', 'low', 1, 30)`,
    ).run()
    await scheduleValidatedCandidates(controller, environment)
    assert.deepEqual(jobs.map((job) => job.candidateId), [seeded.candidateId])
    assert.equal((await promoteCandidate(database, seeded.candidateId)).status, 'applied')
  } finally {
    sqlite.close()
  }
})

test('queue acknowledges deferred dependencies without retrying or sending them to DLQ', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-queue-deferred',
      extractor: 'minimax-dual', gateStatus: 'dual-pass', critical: false, withMapping: false,
    })
    const { environment, failures } = environmentFixture(database)
    let acknowledgements = 0
    let retries = 0
    await handleQueue({ messages: [{
      id: 'message-deferred', attempts: 4,
      body: { version: 1, candidateId: seeded.candidateId, requestedAt: '2026-07-20T01:00:00.000Z' },
      ack() { acknowledgements += 1 },
      retry() { retries += 1 },
    }] }, environment)
    assert.equal(acknowledgements, 1)
    assert.equal(retries, 0)
    assert.deepEqual(failures, [])
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 0)
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM promotion_isolations`).get()?.count, 0)
    assert.equal(sqlite.prepare(
      `SELECT candidate_status FROM ingestion_candidates WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.candidate_status, 'validated')
  } finally {
    sqlite.close()
  }
})

test('a critical rule-only manifest stays quarantined even when mappings are missing', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-unsafe-unmapped',
      extractor: 'rules', gateStatus: 'rule-pass', critical: true, withMapping: false,
    })
    const result = await promoteCandidate(database, seeded.candidateId)
    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'source_manifest_invalid')
    assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM publication_jobs`).get()?.count, 0)
    assert.equal(sqlite.prepare(
      `SELECT reason_code FROM promotion_isolations WHERE candidate_id = ?`,
    ).get(seeded.candidateId)?.reason_code, 'source_manifest_invalid')
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

test('converts a verified major-unit tuition value to canonical minor units', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-tuition-transform',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: true,
      withMapping: true,
      fieldPath: 'tuitionCny',
      fieldType: 'money',
      value: 30_000,
      canonicalFieldPath: 'tuition_minor',
      canonicalValueType: 'decimal_minor',
      valueTransform: 'major_to_minor_2',
    })
    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(result.status, 'applied')
    assert.deepEqual({ ...sqlite.prepare(
      `SELECT raw_value_text, normalized_value_json
         FROM claims WHERE subject_record_id = ?`,
    ).get(seeded.recordId) }, {
      raw_value_text: '30000',
      normalized_value_json: '3000000',
    })
    const canonical = sqlite.prepare(
      `SELECT value_json FROM canonical_fields WHERE subject_record_id = ?`,
    ).get(seeded.recordId) as { value_json: string }
    assert.equal(JSON.parse(canonical.value_json), 3_000_000)
    const diff = JSON.parse((sqlite.prepare(
      `SELECT diff_json FROM change_sets WHERE subject_record_id = ?`,
    ).get(seeded.recordId) as { diff_json: string }).diff_json) as Array<Record<string, unknown>>
    assert.deepEqual(diff.map((item) => ({
      candidateValue: item.candidateValue,
      value: item.value,
      valueTransform: item.valueTransform,
    })), [{
      candidateValue: 30_000,
      value: 3_000_000,
      valueTransform: 'major_to_minor_2',
    }])
    assert.equal(sqlite.prepare(
      `SELECT count(*) AS count FROM claim_evidence`,
    ).get()?.count, 2)
  } finally {
    sqlite.close()
  }
})

test('quarantines a major-unit amount that cannot be represented exactly', async () => {
  const { sqlite, database } = fixture()
  try {
    const seeded = await seedCandidate(sqlite, {
      candidateId: 'candidate-invalid-tuition-transform',
      extractor: 'minimax-dual',
      gateStatus: 'dual-pass',
      critical: true,
      withMapping: true,
      fieldPath: 'tuitionCny',
      fieldType: 'money',
      value: 12.345,
      canonicalFieldPath: 'tuition_minor',
      canonicalValueType: 'decimal_minor',
      valueTransform: 'major_to_minor_2',
    })
    const result = await promoteCandidate(
      database,
      seeded.candidateId,
      new Date('2026-07-20T01:00:00.000Z'),
    )

    assert.equal(result.status, 'quarantined')
    assert.equal(result.reasonCode, 'canonical_transform_invalid')
    for (const table of [
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
    ).get(seeded.candidateId)?.reason_code, 'canonical_transform_invalid')
  } finally {
    sqlite.close()
  }
})
