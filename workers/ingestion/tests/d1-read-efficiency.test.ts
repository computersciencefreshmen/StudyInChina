import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { listUnreleasedMaterializedEntityCandidates } from '../src/entity-materializer-scheduler'
import { sourceRevalidationDue } from '../src/source-observations'
import type { D1Database, D1PreparedStatement, D1Result } from '../src/types'

// The previous production selector is an independent equivalence oracle.
const previousMembershipSql = `SELECT decision.candidate_id
  FROM entity_materialization_decisions decision
  WHERE decision.decision_status = 'materialized' AND NOT EXISTS (
    SELECT 1 FROM entity_materialization_release_requests request,
      json_each(request.candidate_ids_json) requested
    WHERE requested.value = decision.candidate_id
  ) ORDER BY decision.decided_at, decision.candidate_id LIMIT ?1`
const observationIndex = readFileSync(resolve('infra/d1/pipeline/migrations/0020_source_observation_snapshot_index.sql'), 'utf8')
type SqlValue = string | number | bigint | Uint8Array | null

function adapter(database: DatabaseSync, queries: string[] = []): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      queries.push(sql)
      let values: SqlValue[] = []
      return {
        bind(...input: unknown[]) {
          values = input.map(value => {
            if (value === null || typeof value === 'string' || typeof value === 'number'
              || typeof value === 'bigint' || value instanceof Uint8Array) return value
            throw new TypeError('Unsupported SQLite fixture binding')
          })
          return this
        },
        async first<T>() { return (database.prepare(sql).get(...values) as T | undefined) ?? null },
        async all<T>(): Promise<D1Result<T>> { return { success: true, results: database.prepare(sql).all(...values) as T[] } },
        async run<T>(): Promise<D1Result<T>> { return { success: true, meta: { changes: Number(database.prepare(sql).run(...values).changes) } } },
      }
    },
    async batch<T>(statements: D1PreparedStatement[]) { return Promise.all(statements.map(statement => statement.run<T>())) },
  }
}

function fixture() {
  const database = new DatabaseSync(':memory:')
  // These selector-only tables keep the real column affinities/indexes. They
  // deliberately allow legacy rows that current production triggers reject,
  // so NULL/duplicate handling cannot silently change during the optimization.
  database.exec(`
    CREATE TABLE entity_materialization_decisions(candidate_id TEXT PRIMARY KEY,decision_status TEXT NOT NULL,decided_at TEXT NOT NULL);
    CREATE INDEX idx_entity_materialization_decisions_status ON entity_materialization_decisions(decision_status,decided_at);
    CREATE TABLE publication_jobs(id TEXT PRIMARY KEY,job_status TEXT NOT NULL);
    CREATE TABLE entity_materialization_release_requests(request_id TEXT PRIMARY KEY,publication_job_id TEXT,candidate_ids_json TEXT NOT NULL);
    CREATE TABLE ingestion_snapshots(snapshot_id TEXT PRIMARY KEY,fetched_at TEXT,content_type TEXT);
    CREATE TABLE ingestion_source_observations(observation_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,observed_at TEXT NOT NULL);
    CREATE INDEX idx_source_observations_latest ON ingestion_source_observations(source_id,observed_at DESC);
  `)
  return database
}
function decision(database: DatabaseSync, id: string | null, status = 'materialized', at = '2026-11-10T00:00:00Z') {
  database.prepare('INSERT INTO entity_materialization_decisions VALUES(?,?,?)').run(id, status, at)
}
function request(database: DatabaseSync, id: string, members: unknown[], status = 'queued') {
  database.prepare('INSERT INTO publication_jobs VALUES(?,?)').run(`job-${id}`, status)
  database.prepare('INSERT INTO entity_materialization_release_requests VALUES(?,?,?)').run(id, `job-${id}`, JSON.stringify(members))
}
function previous(database: DatabaseSync, limit = 500) {
  return database.prepare(previousMembershipSql).all(limit).map(row => row.candidate_id)
}
function plan(database: DatabaseSync, sql: string, parameter: string | number) {
  return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(parameter).map(row => String(row.detail))
}

test('release selection preserves empty-history behavior, decision status, deterministic order and LIMIT', async () => {
  const database = fixture()
  try {
    decision(database, 'candidate-z', 'materialized', '2026-11-09T00:00:00Z')
    decision(database, 'candidate-b'); decision(database, 'candidate-a')
    decision(database, 'candidate-conflict', 'conflict'); decision(database, 'candidate-held', 'quarantined')
    for (const limit of [1, 2, 3, 1000]) {
      assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database), limit), previous(database, limit))
    }
    assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database), 2), ['candidate-z', 'candidate-a'])
    await assert.rejects(listUnreleasedMaterializedEntityCandidates(adapter(database), 0), /limit must/)
    await assert.rejects(listUnreleasedMaterializedEntityCandidates(adapter(database), 1001), /limit must/)
  } finally { database.close() }
})

test('all historical requests retain membership, including failed, building and published jobs', async () => {
  const database = fixture()
  try {
    for (const status of ['queued', 'building', 'failed', 'published']) {
      decision(database, `candidate-${status}`)
      request(database, status, [`candidate-${status}`], status)
    }
    decision(database, 'candidate-new')
    assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database)), ['candidate-new'])
    assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database)), previous(database))
  } finally { database.close() }
})

test('real SQLite NULLs, empty arrays, duplicate members and legacy JSON values preserve NOT EXISTS semantics', async () => {
  const database = fixture()
  try {
    decision(database, null); decision(database, 'candidate-a'); decision(database, 'candidate-b'); decision(database, '123')
    for (const [id, values] of [['empty', []], ['null', [null]], ['duplicates', ['candidate-a', 'candidate-a']],
      ['legacy-types', [123, true, {}, ['candidate-b']]]] as Array<[string, unknown[]]>) {
      request(database, id, values)
      assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database)), previous(database))
    }
    // json_each's numeric 123 does not match a text candidate ID in either SQL.
    assert.deepEqual(await listUnreleasedMaterializedEntityCandidates(adapter(database)), [null, '123', 'candidate-b'])
  } finally { database.close() }
})

test('the membership query constructs one uncorrelated list instead of expanding JSON per decision', async () => {
  const database = fixture(), queries: string[] = []
  try {
    for (let id = 0; id < 1002; id++) decision(database, `candidate-${String(id).padStart(4, '0')}`)
    for (let batch = 0; batch < 50; batch++) request(database, `request-${batch}`,
      Array.from({ length: 20 }, (_, index) => `candidate-${String(batch * 20 + index).padStart(4, '0')}`))
    const actual = await listUnreleasedMaterializedEntityCandidates(adapter(database, queries), 20)
    assert.deepEqual(actual, ['candidate-1000', 'candidate-1001'])
    assert.deepEqual(actual, previous(database, 20))
    const oldPlan = plan(database, previousMembershipSql, 20), newPlan = plan(database, queries[0], 20)
    assert.ok(oldPlan.some(step => step.includes('CORRELATED')))
    assert.ok(newPlan.some(step => step.includes('LIST SUBQUERY')))
    assert.ok(newPlan.every(step => !step.includes('CORRELATED')))
    // SQLite's Once opcode fences the list construction within one execution.
    assert.ok(database.prepare(`EXPLAIN ${queries[0]}`).all(20).some(row => row.opcode === 'Once'))
  } finally { database.close() }
})

test('snapshot index preserves complete-observation freshness, fallback, binary exclusion and the 24h boundary', async () => {
  const database = fixture()
  try {
    const old = '2026-11-08T00:00:00.000Z', latest = '2026-11-09T00:00:00.000Z'
    database.prepare('INSERT INTO ingestion_snapshots VALUES(?,?,?)').run('html', old, 'text/html')
    database.prepare('INSERT INTO ingestion_snapshots VALUES(?,?,?)').run('no-observation', old, 'application/json')
    database.prepare('INSERT INTO ingestion_snapshots VALUES(?,?,?)').run('binary', old, 'application/pdf')
    database.prepare('INSERT INTO ingestion_source_observations VALUES(?,?,?,?)').run('old', 'source', 'html', old)
    database.prepare('INSERT INTO ingestion_source_observations VALUES(?,?,?,?)').run('latest', 'source', 'html', latest)
    database.prepare('INSERT INTO ingestion_source_observations VALUES(?,?,?,?)').run('other-snapshot', 'source', 'unrelated', '2026-11-10T00:00:00.000Z')
    const cases: Array<[string, string, boolean]> = [
      ['html', '2026-11-09T23:59:59.999Z', false], ['html', '2026-11-10T00:00:00.000Z', true],
      ['no-observation', '2026-11-10T00:00:00.000Z', true], ['binary', '2026-11-10T00:00:00.000Z', false],
      ['missing', '2026-11-10T00:00:00.000Z', false],
    ]
    for (const [id, now, expected] of cases) assert.equal(await sourceRevalidationDue(adapter(database), id, new Date(now)), expected)
    database.exec(observationIndex); database.exec(observationIndex)
    for (const [id, now, expected] of cases) assert.equal(await sourceRevalidationDue(adapter(database), id, new Date(now)), expected)
    assert.equal(database.prepare('SELECT fetched_at FROM ingestion_snapshots WHERE snapshot_id=?').get('html')?.fetched_at, old)
    assert.deepEqual(database.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
  } finally { database.close() }
})

test('freshness lookup gains a snapshot-leading covering index while retaining the source-leading index', async () => {
  const database = fixture(), queries: string[] = []
  try {
    await sourceRevalidationDue(adapter(database, queries), 'snapshot', new Date('2026-11-10T00:00:00Z'))
    const before = plan(database, queries[0], 'snapshot')
    database.exec(observationIndex)
    const after = plan(database, queries[0], 'snapshot')
    assert.ok(before.every(step => !step.includes('idx_source_observations_snapshot_latest')))
    assert.ok(after.some(step => step.includes('USING COVERING INDEX idx_source_observations_snapshot_latest (snapshot_id=?)')))
    assert.ok(database.prepare('PRAGMA index_list(ingestion_source_observations)').all()
      .some(row => row.name === 'idx_source_observations_latest'))
  } finally { database.close() }
})
