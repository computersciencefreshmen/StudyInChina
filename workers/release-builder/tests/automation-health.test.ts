import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SqliteD1 } from '../../entity-materializer/tests/sqlite-fixture'
import { assertAutomatedReleaseHealth } from '../src/health-gate'
import { handleQueue, recordFailure } from '../src/index'
import { RELEASE_TABLES, type ReleaseArtifact, type ReleaseBuilderEnv } from '../src/types'

const now = new Date('2026-09-16T00:00:00.000Z')
function catalogFixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE release_pointer(singleton_id INTEGER, current_release_id TEXT);
    CREATE TABLE catalog_releases(release_id TEXT, release_status TEXT, generated_at TEXT);
    CREATE TABLE institutions(release_id TEXT, institution_id TEXT);
    CREATE TABLE programs(release_id TEXT, program_id TEXT);
    CREATE TABLE program_cycles(release_id TEXT, program_cycle_id TEXT, cycle_status TEXT, ends_on TEXT, academic_year TEXT);
    CREATE TABLE catalog_records(release_id TEXT, record_id TEXT, gate_status TEXT, review_after TEXT);
    CREATE TABLE application_routes(release_id TEXT, application_route_id TEXT, owner_record_id TEXT);
    CREATE TABLE application_windows(release_id TEXT, application_route_id TEXT, closes_on TEXT);
    INSERT INTO release_pointer VALUES(1,'active');
    INSERT INTO catalog_releases VALUES('active','active','2026-09-15T00:00:00.000Z');
    INSERT INTO institutions VALUES('active','school-a');
    INSERT INTO programs VALUES('active','program-a');
    INSERT INTO program_cycles VALUES('active','cycle-a','announced',NULL,'2026-2027');
    INSERT INTO catalog_records VALUES('active','cycle-a','publishable','2026-10-30');
    INSERT INTO application_routes VALUES('active','route-a','cycle-a');
    INSERT INTO application_windows VALUES('active','route-a','2026-09-17');
  `)
  const artifact = { manifest: { generatedAt: now.toISOString() }, tables: Object.fromEntries(RELEASE_TABLES.map((name) => [name, []])) } as unknown as ReleaseArtifact
  artifact.tables.institutions = [{ institution_id: 'school-a' }]
  artifact.tables.programs = [{ program_id: 'program-a' }]
  artifact.tables.program_cycles = [{ program_cycle_id: 'cycle-a' }]
  return { sqlite, database: new SqliteD1(sqlite), artifact }
}

test('same aggregate counts cannot hide a missing school or program identity', async () => {
  const { sqlite, database, artifact } = catalogFixture()
  try {
    for (const table of ['institutions', 'programs'] as const) {
      const original = artifact.tables[table]
      artifact.tables[table] = [table === 'institutions' ? { institution_id: 'replacement' } : { program_id: 'replacement' }]
      await assert.rejects(assertAutomatedReleaseHealth(database, artifact, now), { code: 'release_identity_loss' })
      artifact.tables[table] = original
    }
    artifact.tables.programs.push({ program_id: 'program-new' })
    assert.equal(await assertAutomatedReleaseHealth(database, artifact, now), 'active')
  } finally { sqlite.close() }
})

test('current admissions remain protected, while a past China-calendar deadline can retire naturally', async () => {
  const { sqlite, database, artifact } = catalogFixture()
  try {
    artifact.tables.program_cycles = []
    await assert.rejects(assertAutomatedReleaseHealth(database, artifact, now), { code: 'release_identity_loss' })
    sqlite.exec("UPDATE application_windows SET closes_on = '2026-09-16'")
    await assert.rejects(assertAutomatedReleaseHealth(database, artifact, new Date('2026-09-16T15:59:59Z')), { code: 'release_identity_loss' })
    assert.equal(await assertAutomatedReleaseHealth(database, artifact, new Date('2026-09-16T16:00:00Z')), 'active')
  } finally { sqlite.close() }
})

test('empty imports and delayed older snapshots cannot become active', async () => {
  const { sqlite, database, artifact } = catalogFixture()
  try {
    artifact.manifest.generatedAt = '2026-09-14T00:00:00Z'
    await assert.rejects(assertAutomatedReleaseHealth(database, artifact, now), { code: 'release_snapshot_superseded' })
    artifact.tables.programs = []
    await assert.rejects(assertAutomatedReleaseHealth(database, artifact, now), { code: 'release_identity_empty' })
  } finally { sqlite.close() }
})

const job = { version: 1 as const, outboxEventId: 'event-a', publicationJobId: 'job-a', catalogReleaseId: 'release-a', requestedAt: '2026-09-15T00:00:00Z' }
function outboxFixture(invalidPayload = false) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE publication_jobs(id TEXT PRIMARY KEY, catalog_release_id TEXT, job_status TEXT, error_detail TEXT);
    CREATE TABLE outbox_events(id TEXT PRIMARY KEY, aggregate_id TEXT, event_type TEXT, payload_json TEXT, event_status TEXT, available_at TEXT, lease_owner TEXT, lease_expires_at TEXT, attempt_count INTEGER, last_error TEXT);
    INSERT INTO publication_jobs VALUES('job-a','release-a','queued',NULL);
  `)
  sqlite.prepare('INSERT INTO outbox_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(job.outboxEventId, job.publicationJobId, 'catalog.release.requested', JSON.stringify(invalidPayload ? {} : job), 'pending', '2026-01-01T00:00:00Z', null, null, 0, null)
  const failures: unknown[] = []
  const environment = { PIPELINE_DB: new SqliteD1(sqlite), RELEASE_BUILDER_DLQ: { send: async (value: unknown) => { failures.push(value) } } } as unknown as ReleaseBuilderEnv
  return { sqlite, environment, failures }
}

test('runtime queue exhaustion retains a durable pending outbox for automatic recovery', async () => {
  const { sqlite, environment, failures } = outboxFixture()
  try {
    // The snapshot table is intentionally unavailable, representing a failed DB operation.
    let ack = false
    await handleQueue({ messages: [{ id: 'message', body: job, attempts: 4, ack() { ack = true }, retry() { assert.fail('exhausted queue should defer to durable scheduler') } }] }, environment)
    const row = sqlite.prepare('SELECT * FROM outbox_events').get()!
    assert.equal(ack, true)
    assert.equal(row.event_status, 'pending')
    assert.equal(row.lease_owner, null)
    assert.ok(Date.parse(String(row.available_at)) > Date.now())
    assert.equal(sqlite.prepare('SELECT job_status FROM publication_jobs').get()?.job_status, 'queued')
    assert.equal(failures.length, 1)
  } finally { sqlite.close() }
})

test('invalid immutable job contracts are isolated immediately without retrying unsafe data', async () => {
  const { sqlite, environment, failures } = outboxFixture(true)
  try {
    let ack = false
    await handleQueue({ messages: [{ id: 'message', body: job, attempts: 1, ack() { ack = true }, retry() { assert.fail('validation errors are terminal') } }] }, environment)
    assert.equal(ack, true)
    assert.equal(sqlite.prepare('SELECT event_status FROM outbox_events').get()?.event_status, 'dead_letter')
    assert.equal((failures[0] as { code: string }).code, 'outbox_contract_mismatch')
  } finally { sqlite.close() }
})

test('an expired executor cannot release a newer lease or reset its publication job', async () => {
  const { sqlite, environment } = outboxFixture()
  try {
    sqlite.exec("UPDATE outbox_events SET event_status='processing', lease_owner='new-owner'; UPDATE publication_jobs SET job_status='building'")
    await recordFailure(environment, job, 'old-owner', 'late failure', false, now)
    assert.equal(sqlite.prepare('SELECT lease_owner FROM outbox_events').get()?.lease_owner, 'new-owner')
    assert.equal(sqlite.prepare('SELECT job_status FROM publication_jobs').get()?.job_status, 'building')
    await recordFailure(environment, job, 'new-owner', 'network timeout', false, now)
    assert.equal(sqlite.prepare('SELECT event_status FROM outbox_events').get()?.event_status, 'pending')
    assert.equal(sqlite.prepare('SELECT job_status FROM publication_jobs').get()?.job_status, 'queued')
  } finally { sqlite.close() }
})
