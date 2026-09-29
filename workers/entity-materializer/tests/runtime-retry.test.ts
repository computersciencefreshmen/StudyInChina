import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clearAutomationRetry, isRetryableInfrastructureError, recordAutomationRetry } from '../src/runtime-retry'
import { listPendingEntityMaterializationCandidates } from '../../ingestion/src/entity-materializer-scheduler'
import { SqliteD1 } from './sqlite-fixture'

test('operational backoff grows, caps at six hours, and never changes evidence status', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync('infra/d1/pipeline/migrations/0017_automation_retry_state.sql', 'utf8'))
    const db = new SqliteD1(sqlite)
    const now = '2026-09-16T00:00:00.000Z'
    const read = () => sqlite.prepare('SELECT * FROM automation_retry_state').get() as { failure_count: number; next_attempt_at: string }
    await recordAutomationRetry(db, 'entity_materialization', 'candidate-a', new Error('timeout'), now)
    assert.equal(read().next_attempt_at, '2026-09-16T00:01:00.000Z')
    await recordAutomationRetry(db, 'entity_materialization', 'candidate-a', new Error('timeout'), now)
    assert.equal(read().next_attempt_at, '2026-09-16T00:02:00.000Z')
    for (let attempt = 2; attempt < 15; attempt++) await recordAutomationRetry(db, 'entity_materialization', 'candidate-a', new Error('timeout'), now)
    assert.equal(read().failure_count, 15)
    assert.equal(read().next_attempt_at, '2026-09-16T06:00:00.000Z')
    await clearAutomationRetry(db, 'entity_materialization', 'candidate-a')
    assert.equal(sqlite.prepare('SELECT count(*) AS total FROM automation_retry_state').get()?.total, 0)
  } finally { sqlite.close() }
})

test('a blocked oldest candidate cannot starve a fresh candidate before LIMIT', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync('infra/d1/pipeline/migrations/0017_automation_retry_state.sql', 'utf8'))
    sqlite.exec(`
      CREATE TABLE extracted_entity_candidates(candidate_id TEXT, institution_id TEXT, entity_type TEXT, entity_key TEXT, candidate_status TEXT, created_at TEXT);
      CREATE TABLE entity_registry(institution_id TEXT, entity_type TEXT, entity_key TEXT);
      CREATE TABLE catalog_reconciliation_items(candidate_id TEXT);
      CREATE TABLE entity_materialization_decisions(candidate_id TEXT);
      INSERT INTO extracted_entity_candidates VALUES ('blocked', 'school', 'program', 'a', 'validated', '2026-09-01T00:00:00Z'), ('fresh', 'school', 'program', 'b', 'validated', '2026-09-15T00:00:00Z');
      INSERT INTO entity_registry VALUES ('school','program','a'), ('school','program','b');
      INSERT INTO catalog_reconciliation_items VALUES ('blocked'), ('fresh');
    `)
    const db = new SqliteD1(sqlite)
    await recordAutomationRetry(db, 'entity_materialization', 'blocked', 'missing source dependency', '2026-09-16T00:00:00.000Z')
    assert.deepEqual(await listPendingEntityMaterializationCandidates(db, 1, '2026-09-16T00:00:30.000Z'), ['fresh'])
    assert.deepEqual(await listPendingEntityMaterializationCandidates(db, 2, '2026-09-16T00:02:00.000Z'), ['fresh', 'blocked'])
  } finally { sqlite.close() }
})

test('transient classification never treats a data constraint failure as a network outage', () => {
  assert.equal(isRetryableInfrastructureError(new Error('D1_ERROR: network temporarily unavailable')), true)
  assert.equal(isRetryableInfrastructureError(new Error('SQLITE_BUSY: database is locked')), true)
  assert.equal(isRetryableInfrastructureError(new Error('CHECK constraint failed: canonical_fields')), false)
  assert.equal(isRetryableInfrastructureError(new Error('forced publication failure')), false)
})
