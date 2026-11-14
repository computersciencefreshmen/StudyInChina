import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueueDue, refreshTargets } from '../src/repository'
import { canonical } from '../src/util'
import type { SourceRow } from '../src/types'
import { now, followupFixture as fixture } from './target-followup-fixture'
const iso = new Date(now).toISOString()


test('publishing new targets seeds only their condition/cycle jobs from fresh evidence despite the 168-hour capture due date', async () => {
  const f = await fixture(); try {
    await f.refresh(); const before = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_observations').all())
    const result = await enqueueDue(f.env, now), jobs = f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all()
    assert.equal(result.queued, 2); assert.equal(f.messages.length, 2); assert.equal(jobs.length, 2); assert.ok(jobs.every(j => j.stage === 'maintain'))
    assert.ok(jobs.some(j => JSON.parse(String(j.target_ids_json)).kind === 'cycle-discovery'))
    for (const job of jobs) { const scope = JSON.parse(String(job.target_ids_json)), pins = Array.isArray(scope) ? scope : scope.targets; assert.deepEqual(pins.map((p: { id: string }) => p.id), ['program:programme-1', 'program:programme-2']); assert.ok(!String(job.target_ids_json).includes('programme-0')) }
    assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_observations').all()), before)
    assert.deepEqual(await f.drain(), { sources: 0, pending: 0 }); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 2)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('unchanged metadata produces no followup and never restarts old sources', async () => {
  const f = await fixture(0); try { await f.refresh(); assert.deepEqual(await f.drain(), { sources: 0, pending: 0 }); assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='target_followup_ready'").get()?.n, 0) } finally { f.db.sqlite.close() }
})

test('stale/future observation, missing fresh receipt, disabled source, canary and manual pause remain pending', async () => {
  for (const mode of ['stale', 'future', 'observation', 'disabled', 'canary', 'pause', 'modelPause']) {
    const f = await fixture(); try {
      await f.refresh()
      if (mode === 'stale' || mode === 'future') { const when = new Date(now + (mode === 'stale' ? -86400001 : 1)).toISOString(); f.db.sqlite.prepare('UPDATE maintenance_sources SET last_success_at=?').run(when) }
      if (mode === 'observation') f.db.sqlite.exec('DELETE FROM maintenance_observations')
      if (mode === 'disabled') f.db.sqlite.exec('UPDATE maintenance_sources SET enabled=0')
      if (mode === 'canary') f.db.sqlite.prepare('UPDATE maintenance_control SET canary_json=?').run('["uni-001"]')
      if (mode === 'pause') f.db.sqlite.exec('UPDATE maintenance_control SET enabled=0')
      if (mode === 'modelPause') f.db.sqlite.exec('UPDATE maintenance_control SET models_enabled=0')
      assert.equal((await f.drain()).sources, 0, mode); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 0, mode)
    } finally { f.db.sqlite.close() }
  }
})

test('tampered raw/text/source binding and malformed permanent STOP cannot seed a paid path', async () => {
  for (const mode of ['raw', 'text', 'binding', 'stop']) {
    const f = await fixture(); try {
      await f.refresh(); const source = f.db.sqlite.prepare('SELECT * FROM maintenance_sources').get() as unknown as SourceRow, snapshot = JSON.parse((await f.bucket.get(source.snapshot_key!)) && await (await f.bucket.get(source.snapshot_key!))!.text() || '{}')
      if (mode === 'raw') await f.bucket.put(snapshot.rawKey, 'changed')
      if (mode === 'text') await f.bucket.put(snapshot.textKey, 'changed')
      if (mode === 'binding') await f.bucket.put(source.snapshot_key!, canonical({ ...snapshot, sourceId: 'a'.repeat(64) }))
      if (mode === 'stop') f.db.sqlite.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').run('runtime-model-guards:registry', 'runtime_model_guard_registry_initialized', iso, '{}')
      await assert.rejects(f.drain(), /target_followup_snapshot_|runtime_model_guard_index_missing/)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('an unregistered unknown stays byte-for-byte unchanged and is not queued', async () => {
  const f = await fixture(); try {
    await f.refresh(); f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,'unknown',?,'{}')").run('old-key', 'old-attempt', f.ids[0], 'a'.repeat(64), 'primary', 'b'.repeat(64), 'MiniMax-M3', iso)
    const before = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all())
    assert.equal((await f.drain()).sources, 0); assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all()), before); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('a pause/catalog/scope/target/source/uncertain-send race rolls back all followup jobs and keeps progress retryable', async () => {
  for (const mode of ['pause', 'catalog', 'scope', 'target', 'source', 'unknown', 'reserved', 'send_started', 'job_unknown']) {
    const f = await fixture(); try {
      await f.refresh(); const batch = f.db.batch.bind(f.db); let raced = false
      f.db.batch = async statements => { if (!raced) { raced = true; if (mode === 'pause') f.db.sqlite.exec('UPDATE maintenance_control SET enabled=0'); if (mode === 'catalog') f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run('d'.repeat(64)); if (mode === 'scope') f.db.sqlite.prepare('UPDATE maintenance_control SET scope_sha256=?').run('d'.repeat(64)); if (mode === 'target') f.db.sqlite.prepare('UPDATE maintenance_record_targets SET record_scope_sha256=? WHERE record_id=?').run('d'.repeat(64), 'programme-1'); if (mode === 'source') f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?').run('d'.repeat(64)); if (['unknown','reserved','send_started'].includes(mode)) f.db.sqlite.prepare('INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run('late-key','late-attempt',f.ids[0],'a'.repeat(64),'primary','b'.repeat(64),'MiniMax-M3',mode,iso,'{}'); if (mode==='job_unknown') f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256) SELECT 'late-job',source_id,'extract','unknown',?,?,?,raw_sha256 FROM maintenance_sources WHERE source_id=?").run(iso,iso,iso,f.ids[0]) }; return batch(statements) }
      await assert.rejects(f.drain()); assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='maintain'").get()?.n, 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n, 0)
      assert.ok(![...f.bucket.objects.keys()].some(key => key.startsWith('maintenance/target-followup/progress/')))
    } finally { f.db.sqlite.close() }
  }
})

test('lost progress writes repeat deterministic jobs without another extraction or provider reservation', async () => {
  const f = await fixture(); try {
    await f.refresh(); const put = f.bucket.put.bind(f.bucket); let failed = false
    f.bucket.put = async (key,value,options) => { if (!failed && key.startsWith('maintenance/target-followup/progress/')) { failed=true; throw Error('local_progress_write_failed') }; return put(key,value,options) }
    await assert.rejects(f.drain(), /local_progress_write_failed/); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 2)
    assert.deepEqual(await f.drain(), { sources: 1, pending: 0 }); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 2); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('source batches are bounded and rotate, and unfinished exact pins survive a newer catalog refresh', async () => {
  const f = await fixture(30, 10); try {
    await f.refresh(); const first = await f.drain(); assert.equal(first.sources, 8); assert.equal(first.pending, 2)
    // No queue producer was called: the regular scheduler still owns all dispatch.
    assert.equal(f.messages.length, 0)
    const second = await f.drain(); assert.equal(second.sources, 2); assert.equal(second.pending, 0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(DISTINCT source_id) n FROM maintenance_jobs WHERE stage='maintain'").get()?.n, 10)
  } finally { f.db.sqlite.close() }
  const g = await fixture(42); try {
    await g.refresh(); assert.deepEqual(await g.drain(), { sources: 1, pending: 2 })
    const nextCatalog = 'e'.repeat(64); g.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run(nextCatalog)
    await refreshTargets(g.env, { inputCatalogSha256: nextCatalog, recordTargets: g.targets })
    assert.deepEqual(await g.drain(), { sources: 1, pending: 1 }); assert.deepEqual(await g.drain(), { sources: 1, pending: 0 })
    assert.ok(Number(g.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()!.n) > 2)
  } finally { g.db.sqlite.close() }
})
