import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const migration = readFileSync(new URL('../../../infra/d1/pipeline/migrations/0020_maintenance_read_indexes.sql', import.meta.url), 'utf8')
const repository = readFileSync(new URL('../src/repository.ts', import.meta.url), 'utf8')
const admission = readFileSync(new URL('../src/admission.ts', import.meta.url), 'utf8')
// Exercise the deployed SQL itself so a later scheduler change cannot silently evade this regression.
const schedulerSql = repository.match(/const candidates = \(await env\.PIPELINE_DB\.prepare\(`([^`]+)`\)/)?.[1]
const guardSql = admission.match(/prepare\('(SELECT \* FROM maintenance_legacy_guards WHERE source_id IS NULL OR source_id=\? OR snapshot_sha256=\?)'\)/)?.[1]
assert.ok(schedulerSql, 'source scheduler SQL must be present')
assert.ok(guardSql, 'historical guard SQL must be present')

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../../../infra/d1/pipeline/migrations/0019_catalog_maintenance.sql', import.meta.url), 'utf8'))
  // Match the observed production-sized relation: 1,505 URLs, 4,041 records, 8,237 bindings.
  db.exec(`
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<271)
    INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256)
    SELECT printf('uni-%03d',i),'{}','{}','scope' FROM n;
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<1504)
    INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at)
    SELECT printf('source-%04d',i),printf('https://test.edu.cn/%d',i),'["test.edu.cn"]','undergraduate_catalog',1,168,'2026-10-25T00:00:00.000Z' FROM n;
    INSERT INTO maintenance_source_schools SELECT source_id,printf('uni-%03d',CAST(substr(source_id,8) AS INTEGER)%272) FROM maintenance_sources;
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<4040)
    INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,fields_json,target_json)
    SELECT printf('target-%04d',i),printf('program-%04d',i),'program',printf('uni-%03d',i%272),'scope','{"deadline":"2026-11-01"}','{}' FROM n;
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<8236)
    INSERT INTO maintenance_target_sources SELECT printf('target-%04d',i%4041),printf('source-%04d',i%1505) FROM n;
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<999)
    INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at)
    SELECT printf('job-%04d',i),printf('source-%04d',i),'capture','done','2026-10-25','2026-10-25','2026-10-25' FROM n;
    INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at)
    VALUES('pending-capture','source-0000','capture','queued','2026-10-25','2026-10-25','2026-10-25'),
      ('pending-maintain','source-0001','maintain','retry','2026-10-25','2026-10-25','2026-10-25');
    WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<3508)
    INSERT INTO maintenance_legacy_guards(guard_id,university_id,source_id,record_id,scope_json,state,artifact_sha256,reason,snapshot_sha256)
    SELECT printf('guard-%04d',i),'uni-000',CASE WHEN i%5=0 THEN NULL ELSE printf('source-%04d',i%1505) END,
      printf('program-%04d',i),'{}',CASE i%3 WHEN 0 THEN 'stop' WHEN 1 THEN 'unknown' ELSE 'consumed' END,'artifact','historical',
      CASE WHEN i%7=0 THEN NULL ELSE printf('snapshot-%04d',i) END FROM n;
  `)
  return db
}

function plan(db: DatabaseSync, sql: string, values: string[]) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => String(row.detail)).join('\n')
}

test('fixed read indexes replace repeated scheduling scans and preserve exact source order and fields', () => {
  const db = fixture()
  try {
    const args = ['2026-10-26T08:00:00.000Z', '[]', '[]']
    const before = db.prepare(schedulerSql).all(...args)
    const beforePlan = plan(db, schedulerSql, args)
    assert.equal(before.length, 40)
    assert.match(beforePlan, /SCAN x/)
    assert.match(beforePlan, /SCAN s/)
    db.exec(migration)
    db.exec(migration) // Applying a previously recorded migration again is harmless.
    const after = db.prepare(schedulerSql).all(...args)
    assert.deepEqual(after, before)
    const afterPlan = plan(db, schedulerSql, args)
    assert.match(afterPlan, /SEARCH x USING COVERING INDEX maintenance_target_sources_source \(source_id=\?\)/)
    assert.match(afterPlan, /SEARCH s USING INDEX maintenance_sources_enabled_due/)
    assert.match(afterPlan, /SEARCH j USING COVERING INDEX maintenance_jobs_source_stage_status/)
    assert.doesNotMatch(afterPlan, /\bSCAN [xsj]\b/)
    const bindingCount = Number(db.prepare('SELECT COUNT(*) count FROM maintenance_target_sources').get()!.count)
    const selectedBindings = after.reduce((sum, row) => sum + Number(db.prepare('SELECT COUNT(*) count FROM maintenance_target_sources WHERE source_id=?').get(String(row.source_id))!.count), 0)
    assert.equal(bindingCount, 8237)
    // EXPLAIN proves the old per-source full scan became a keyed range. These
    // cardinalities are not presented as measured Cloudflare billing/row-read totals.
    assert.equal(before.length * bindingCount, 329480)
    assert.ok(selectedBindings > 0 && selectedBindings < 300)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})

test('both historical guard OR branches use indexes without losing null-parent STOP or unknown guards', () => {
  const db = fixture()
  try {
    const args = ['source-0001', 'snapshot-0002']
    const rows = () => db.prepare(guardSql).all(...args).sort((a, b) => String(a.guard_id).localeCompare(String(b.guard_id)))
    const before = rows()
    assert.match(plan(db, guardSql, args), /SCAN maintenance_legacy_guards/)
    assert.ok(before.some(row => row.source_id === null && row.state === 'stop'))
    assert.ok(before.some(row => row.source_id === null && row.state === 'unknown'))
    db.exec(migration)
    assert.deepEqual(rows(), before)
    const after = plan(db, guardSql, args)
    assert.match(after, /MULTI-INDEX OR/)
    assert.match(after, /maintenance_legacy_guards_source/)
    assert.match(after, /maintenance_legacy_guards_snapshot/)
    assert.doesNotMatch(after, /SCAN maintenance_legacy_guards/)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM maintenance_legacy_guards').get()!.count, 3509)
    assert.equal(db.prepare("SELECT COUNT(*) count FROM maintenance_jobs WHERE stage='maintain' AND status='retry'").get()!.count, 1)
  } finally { db.close() }
})

test('source snapshot unresolved-attempt protection remains exact and uses a covering index', () => {
  const db = fixture()
  try {
    const extraction = readFileSync(new URL('../src/extraction.ts', import.meta.url), 'utf8')
    const sql = extraction.match(/prepare\("(SELECT COUNT\(\*\) count FROM maintenance_model_attempts WHERE source_id=\? AND snapshot_sha256=\? AND status IN\('reserved','send_started','unknown'\))"\)/)?.[1]
    assert.ok(sql, 'cross-contract unresolved-attempt SQL must be present')
    const insert = db.prepare('INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    for (const [index, state] of ['reserved', 'send_started', 'unknown', 'completed', 'known_failed'].entries()) {
      insert.run(`reservation-${index}`, `attempt-${index}`, 'source-0001', 'snapshot-0001', 'primary', 'request', 'MiniMax-M3', state, '2026-10-26', '{}')
    }
    insert.run('other-source', 'other-attempt', 'source-0002', 'snapshot-0001', 'primary', 'request', 'MiniMax-M3', 'unknown', '2026-10-26', '{}')
    const args = ['source-0001', 'snapshot-0001']
    assert.equal(db.prepare(sql).get(...args)!.count, 3)
    assert.match(plan(db, sql, args), /SCAN maintenance_model_attempts/)
    db.exec(migration)
    assert.equal(db.prepare(sql).get(...args)!.count, 3)
    assert.equal(db.prepare(sql).get('source-0001', 'different-snapshot')!.count, 0)
    assert.match(plan(db, sql, args), /SEARCH maintenance_model_attempts USING COVERING INDEX maintenance_model_attempts_source_snapshot_status/)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()!.count, 6)
  } finally { db.close() }
})
