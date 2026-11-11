import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEnv, seedInput } from './fixture'
import { seed } from '../src/repository'
import type { CapturedSnapshot } from '../src/capture'
import type { JobRow, SourceRow, ModelRequest } from '../src/types'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { buildDocumentPartitions, partitionEvidenceLocator, runPartitionedDocument, type DocumentPartitionContext } from '../src/document-partitions'
import { maintainFields, type FieldModelRunner } from '../src/field-updates'
import { digest } from '../src/util'
import { processMessage } from '../src/index'

const applicability = 'International students applying to Computer Science.'
const scope = 'Autumn 2027 admissions.'
async function fixture() {
  const f = makeEnv(); await seed(f.env, seedInput())
  const url = 'https://test.edu.cn/catalog', sourceId = await digest(url)
  // Actual HTTP text is normalized before capture; the large middle section
  // makes the later date reside outside the first owned range/header context.
  const text = `${applicability} ${scope} Application deadline: 2027-09-30. ${'official programme catalogue '.repeat(2500)} Later section: Application deadline: 2027-10-30.`
  const textSha = await digest(text)
  await f.bucket.put('maintenance/text/full.txt', text)
  await f.bucket.put('maintenance/raw/full.bin', text)
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt: '2026-11-11T01:00:00.000Z', contentType: 'text/plain',
    rawSha256: textSha, rawKey: 'maintenance/raw/full.bin', textKey: 'maintenance/text/full.txt', textSha256: textSha, canonicalSha256: textSha, parserCandidates: [] }
  const job = { job_id: await digest('partition-job'), source_id: sourceId, stage: 'maintain', snapshot_sha256: textSha } as JobRow
  const row = { source_id: sourceId, url, allowed_hosts_json: '["test.edu.cn"]' } as SourceRow
  const target: MaintenanceRecordTarget = { recordId: 'cycle-computer-science', entityType: 'admission-cycle', universityId: 'uni-000', sourceIds: [sourceId],
    recordScopeSha256: 'd'.repeat(64), identity: { name: { en: 'Computer Science' } }, year: '2027-2028', intake: 'autumn', fields: {}, reviewAfter: '2026-11-12' }
  return { ...f, text, snapshot, job, row, target }
}
function models(conflicting = false) {
  const requests: ModelRequest[] = [], paid = new Map<string, number>()
  const runner: FieldModelRunner = async (_env, request) => {
    requests.push(request)
    const text = (JSON.parse(request.payload) as { SOURCE_TEXT: string }).SOURCE_TEXT
    const date = conflicting && text.includes('Later section:') ? '2027-10-30' : '2027-09-30'
    const reused = paid.has(request.reservationKey)
    if (!reused) paid.set(request.reservationKey, paid.size)
    return { attemptId: `attempt-${paid.get(request.reservationKey)}`, reused, artifactKey: `models/${request.reservationKey}.json`, artifactSha256: 'a'.repeat(64),
      output: { records: [{ recordId: 'cycle-computer-science', year: '2027-2028', intake: 'autumn', applicabilityQuote: applicability, scopeQuote: scope,
        patches: [{ fieldPath: 'closesOn', value: date, factStatus: 'known', quote: `Application deadline: ${date}.` }] }] } }
  }
  return { requests, paid, runner }
}
async function runAll(f: Awaited<ReturnType<typeof fixture>>, runner: FieldModelRunner, snapshot = f.snapshot) {
  const segment = (context: DocumentPartitionContext, targets: MaintenanceRecordTarget[]) => maintainFields(f.env, f.job, f.row, context.snapshot, targets, runner, context)
  let result = await runPartitionedDocument(f.env, f.job, f.row, snapshot, 'fields', [f.target], segment), turns = 1
  while (result.pending && turns++ < 100) result = await runPartitionedDocument(f.env, f.job, f.row, snapshot, 'fields', [f.target], segment)
  assert.ok(turns < 100)
  return result
}

test('manifest owns every character once, preserves Unicode and chapter/page boundaries and hashes the full source', async () => {
  const text = `International admissions\n${'a'.repeat(13000)}\n## Chapter two\n${'汉字😀 '.repeat(14000)}\fEnd page`, hash = await digest(text)
  const snapshot = { rawSha256: 'a'.repeat(64), textKey: 'full.txt', textSha256: hash } as CapturedSnapshot
  const manifest = await buildDocumentPartitions('source', snapshot, text)
  assert.equal(manifest.partitions[0].start, 0); assert.equal(manifest.partitions.at(-1)?.end, text.length)
  assert.equal(manifest.partitions.map(part => text.slice(part.start, part.end)).join(''), text)
  for (let index = 0; index < manifest.partitions.length; index++) {
    const part = manifest.partitions[index]
    if (index) assert.equal(part.start, manifest.partitions[index - 1].end)
    assert.equal(part.sha256, await digest(text.slice(part.start, part.end)))
    assert.ok(part.end - part.start <= 44000)
    assert.ok(!/[\uD800-\uDBFF]/u.test(text[part.end - 1]))
  }
  assert.ok(manifest.partitions.some(part => part.boundary === 'chapter'))
  assert.equal(manifest.fullCoverage, true)
})

test('two independent extractions per long-source segment, no publishing before full scan, and cross-part conflicts stay held', async () => {
  const f = await fixture(), m = models(true)
  try {
    // Make the field source exceed its old 100k hard hold.
    const long = f.text + ' '.repeat(55000)
    f.text = long; f.snapshot.textSha256 = await digest(long); f.snapshot.rawSha256 = f.snapshot.textSha256; f.job.snapshot_sha256 = f.snapshot.rawSha256
    await f.bucket.put(f.snapshot.textKey!, long); await f.bucket.put(f.snapshot.rawKey, long)
    const segment = (context: DocumentPartitionContext, targets: MaintenanceRecordTarget[]) => maintainFields(f.env, f.job, f.row, context.snapshot, targets, m.runner, context)
    const first = await runPartitionedDocument(f.env, f.job, f.row, f.snapshot, 'fields', [f.target], segment)
    assert.equal(first.pending, true); assert.equal(m.requests.length, 2)
    assert.equal((f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get() as { n: number }).n, 0)
    const result = await runAll(f, m.runner)
    assert.equal(result.pending, false); assert.equal(result.completeDocumentScan, true); assert.equal(result.completeSchoolCatalogueClaimed, false)
    assert.ok((result.conflictingClaims ?? 0) > 0)
    assert.equal((f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_proposals WHERE status='ready'").get() as { n: number }).n, 0)
    assert.ok(m.requests.every(request => request.snapshotSha256 === f.snapshot.rawSha256))
    assert.equal(new Set(m.requests.map(request => request.reservationKey)).size, m.requests.length)
  } finally { f.db.sqlite.close() }
})

test('a saved segment survives cursor failure without another model invocation; refresh audit binds new checkedAt but reuses exact model scopes', async () => {
  const f = await fixture(), m = models()
  try {
    const long = f.text + ' '.repeat(55000)
    f.text = long; f.snapshot.textSha256 = await digest(long); f.snapshot.rawSha256 = f.snapshot.textSha256; f.job.snapshot_sha256 = f.snapshot.rawSha256
    await f.bucket.put(f.snapshot.textKey!, long); await f.bucket.put(f.snapshot.rawKey, long)
    const originalPut = f.bucket.put.bind(f.bucket); let fail = true
    f.bucket.put = async (key, body, options) => { if (key.includes('partitions/jobs/') && fail) { fail = false; throw new Error('cursor_write_lost') }; return originalPut(key, body, options) }
    const segment = (context: DocumentPartitionContext, targets: MaintenanceRecordTarget[]) => maintainFields(f.env, f.job, f.row, context.snapshot, targets, m.runner, context)
    await assert.rejects(runPartitionedDocument(f.env, f.job, f.row, f.snapshot, 'fields', [f.target], segment), /cursor_write_lost/u)
    assert.equal(m.requests.length, 2)
    await runPartitionedDocument(f.env, f.job, f.row, f.snapshot, 'fields', [f.target], segment)
    assert.equal(m.requests.length, 2)
    await runAll(f, m.runner)
    const paid = m.paid.size
    const fresh = { ...f.snapshot, checkedAt: '2026-11-12T01:00:00.000Z' }
    await runAll(f, m.runner, fresh)
    assert.equal(m.paid.size, paid)
    assert.equal((f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get() as { n: number }).n, 2)
    assert.ok([...f.bucket.objects.keys()].some(key => /partitions\/results\/.*\/[a-f0-9]{64}\.json$/u.test(key)))
  } finally { f.db.sqlite.close() }
})

test('known unknown stops the original source scope; a healthy in-flight sibling causes a soft wait', async () => {
  const f = await fixture(), long = f.text + ' '.repeat(55000)
  try {
    f.snapshot.textSha256 = await digest(long); f.snapshot.rawSha256 = f.snapshot.textSha256; f.job.snapshot_sha256 = f.snapshot.rawSha256
    await f.bucket.put(f.snapshot.textKey!, long)
    const add = f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('key','attempt',?,?,'primary','hash','MiniMax-M3',?,?, '{}')")
    add.run(f.row.source_id, f.snapshot.rawSha256, 'send_started', new Date().toISOString())
    let calls = 0
    const run = () => runPartitionedDocument(f.env, f.job, f.row, f.snapshot, 'fields', [f.target], async () => { calls++; return { proposals: [], held: [] } })
    await assert.rejects(run(), (error: unknown) => (error as { code: string; retryAfter: number }).code === 'model_capacity_partition_source_busy' && (error as { retryAfter: number }).retryAfter === 20)
    f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET status='unknown'").run()
    await assert.rejects(run(), /partition_original_source_outcome_unknown/u)
    assert.equal(calls, 0)
    assert.equal([...f.bucket.objects.keys()].filter(key => key.includes('partitions/jobs/')).length, 0)
  } finally { f.db.sqlite.close() }
})

test('short sources use the unchanged engine path and do not call the partition callback', async () => {
  const f = await fixture()
  try {
    let calls = 0
    const result = await runPartitionedDocument(f.env, f.job, f.row, f.snapshot, 'fields', [f.target], async () => { calls++; return { proposals: [], held: [] } })
    assert.equal(result.handled, false); assert.equal(calls, 0)
  } finally { f.db.sqlite.close() }
})

test('offset evidence cannot cite an omitted middle range or stitch quotes across artificial context boundaries', async () => {
  const f = await fixture()
  try {
    const context = { fullText: 'header one OMITTED middle body two', body: { start: 26, end: 34 }, contexts: [{ start: 0, end: 10 }] } as DocumentPartitionContext
    assert.equal(partitionEvidenceLocator(context, 'header'), 'text:offset:0:10')
    assert.throws(() => partitionEvidenceLocator(context, 'OMITTED'), /outside_admitted/u)
    assert.throws(() => partitionEvidenceLocator(context, 'one body'), /not_in_original/u)
  } finally { f.db.sqlite.close() }
})

test('real queue dispatcher releases and reclaims a long field job through every segment and final persisted drain', async () => {
  const f = await fixture(), m = models(), long = f.text + ' '.repeat(55000)
  try {
    f.snapshot.textSha256 = await digest(long); f.snapshot.rawSha256 = f.snapshot.textSha256; f.snapshot.canonicalSha256 = f.snapshot.textSha256
    f.job.snapshot_sha256 = f.snapshot.rawSha256
    const key = `maintenance/snapshots/${f.row.source_id}/${f.snapshot.rawSha256}.json`
    await f.bucket.put(key, JSON.stringify(f.snapshot)); await f.bucket.put(f.snapshot.textKey!, long); await f.bucket.put(f.snapshot.rawKey, long)
    f.db.sqlite.prepare("UPDATE maintenance_control SET enabled=1,models_enabled=1,canary_json='[]'").run()
    const targetId = `admission-cycle:${f.target.recordId}`
    f.db.sqlite.prepare('INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(targetId, f.target.recordId, f.target.entityType, f.target.universityId, f.target.recordScopeSha256, f.target.year, f.target.intake, '{}', JSON.stringify(f.target))
    f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').run(targetId, f.row.source_id)
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json) VALUES(?,?,'maintain','queued','2000-01-01','2000-01-01','2000-01-01',?,?,?)")
      .run(f.job.job_id, f.row.source_id, f.snapshot.rawSha256, key, JSON.stringify([{ id: targetId, sha256: f.target.recordScopeSha256 }]))
    f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: async request => Response.json({ ok: true, ...await m.runner(f.env, await request.json() as ModelRequest) }) }) }
    let turns = 0, status = 'queued'
    while (['queued', 'retry'].includes(status) && turns++ < 30) {
      const calls = m.requests.length
      await processMessage(f.env, { version: 1, jobId: f.job.job_id })
      assert.ok(m.requests.length - calls <= 2)
      const observed = f.db.sqlite.prepare('SELECT status,lease_token FROM maintenance_jobs WHERE job_id=?').get(f.job.job_id) as { status: string; lease_token: string | null }
      status = observed.status; assert.equal(observed.lease_token, null)
      if (status === 'retry') f.db.sqlite.prepare("UPDATE maintenance_jobs SET due_at='2000-01-01' WHERE job_id=?").run(f.job.job_id)
    }
    assert.ok(turns < 30); assert.equal(status, 'done')
    assert.equal((f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_proposals WHERE status='ready'").get() as { n: number }).n, 1)
    assert.ok(f.messages.some(message => message.jobId === f.job.job_id))
    const final = f.db.sqlite.prepare('SELECT attempt FROM maintenance_jobs WHERE job_id=?').get(f.job.job_id) as { attempt: number }
    assert.equal(final.attempt, 1) // normal partition continuation is not a failure attempt
  } finally { f.db.sqlite.close() }
})
