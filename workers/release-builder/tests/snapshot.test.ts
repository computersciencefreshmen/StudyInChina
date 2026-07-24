import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { buildArtifactFromPipeline, ELIGIBLE_RECORD_FILTER } from '../src/snapshot'

test('release snapshots exclude records that belong to an incomplete materialization batch', async () => {
  const queries: string[] = []
  let batchCalls = 0
  const database = {
    prepare(sql: string) {
      queries.push(sql)
      return { sql }
    },
    async batch(statements: Array<{ sql: string }>) {
      batchCalls += 1
      assert.equal(statements.length, queries.length)
      return statements.map(() => ({ success: true, results: [] }))
    },
  }

  await assert.rejects(
    buildArtifactFromPipeline(
      database as never,
      {
        version: 1,
        outboxEventId: 'outbox-release-1',
        publicationJobId: 'publication-job-1',
        catalogReleaseId: 'catalog-release-1',
        requestedAt: '2026-07-23T08:00:00.000Z',
      },
      new Date('2026-07-23T08:00:00.000Z'),
    ),
    (error: Error & { code?: string }) => error.code === 'empty_release',
  )

  assert.equal(batchCalls, 1)
  assert.ok(queries.length > 20)
  assert.match(queries[0] ?? '', /materialization_batch_record_intents AS pending_intent/u)
  assert.match(queries[0] ?? '', /materialization_batch_records AS pending_batch_record/u)
  assert.match(queries[0] ?? '', /batch_status NOT IN \('applied', 'superseded'\)/u)
})

test('only an explicit terminal superseded status can stop a non-applied batch from hiding a record', () => {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE records (
      id TEXT PRIMARY KEY,
      workflow_status TEXT NOT NULL
    );
    CREATE TABLE materialization_batches (
      batch_id TEXT PRIMARY KEY,
      batch_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE materialization_batch_records (
      batch_id TEXT NOT NULL,
      record_id TEXT NOT NULL
    );
    CREATE TABLE materialization_batch_record_intents (
      batch_id TEXT NOT NULL,
      record_id TEXT NOT NULL
    );
    INSERT INTO records VALUES ('program-1', 'applied');
  `)
  const visible = () => database.prepare(`
    SELECT COUNT(*) AS count
    FROM records AS record
    WHERE ${ELIGIBLE_RECORD_FILTER}
  `).get() as { count: number }
  const addBatch = (
    id: string,
    status: 'prepared' | 'reserving' | 'reserved' | 'importing' | 'failed' | 'applied',
    updatedAt: string,
  ) => database.exec(`
    INSERT INTO materialization_batches VALUES ('${id}', '${status}', '${updatedAt}');
    INSERT INTO materialization_batch_records VALUES ('${id}', 'program-1');
  `)
  const addIntentBatch = (
    id: string,
    status: 'reserving' | 'reserved' | 'importing',
    updatedAt: string,
  ) => database.exec(`
    INSERT INTO materialization_batches VALUES ('${id}', '${status}', '${updatedAt}');
    INSERT INTO materialization_batch_record_intents VALUES ('${id}', 'program-1');
  `)
  const supersede = (id: string) => database.prepare(`
    UPDATE materialization_batches SET batch_status = 'superseded' WHERE batch_id = ?
  `).run(id)

  assert.equal(visible().count, 1)
  addBatch('batch-a', 'failed', '2026-07-23T08:00:00.000Z')
  assert.equal(visible().count, 0)
  addBatch('batch-b', 'applied', '2026-07-23T09:00:00.000Z')
  assert.equal(visible().count, 0)
  supersede('batch-a')
  assert.equal(visible().count, 1)
  addIntentBatch('batch-z', 'importing', '2026-07-23T09:00:00.000Z')
  addBatch('batch-c', 'applied', '2026-07-23T09:00:00.000Z')
  assert.equal(visible().count, 0)
  supersede('batch-z')
  assert.equal(visible().count, 1)
  addIntentBatch('batch-d', 'reserved', '2026-07-23T10:00:00.000Z')
  assert.equal(visible().count, 0)

  database.close()
})
