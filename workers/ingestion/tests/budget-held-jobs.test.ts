import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BUDGET_OBSERVATION_KEY, BUDGET_POLICY_KEY, budgetPolicySha256 } from '../../shared/background-budget'
import { BUDGET_HELD_PREFIX, drainBudgetHeldJobs, rememberBudgetHeldJob } from '../src/budget-held-jobs'
import worker from '../src/index'
import { acquireDomainLease, claimJob, markJobRunning, releaseDomainLease } from '../src/repository'
import type { IngestionEnv, IngestionJob } from '../src/types'
import { discoveryDatabase, discoveryEnvironment, seedDiscoverySource } from './discovery-fixtures'

const NOW = '2026-11-13T08:00:00.000Z'
type PutOptions = { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }
class Bucket {
  objects = new Map<string, string>()
  dropPending = false
  dropResults = false
  failDelete = false
  async get(key: string) {
    const body = this.objects.get(key)
    if (body === undefined) return null
    const bytes = new TextEncoder().encode(body)
    return { size: bytes.byteLength, async text() { return body }, async arrayBuffer() { return bytes.buffer } }
  }
  async head() { return null }
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: PutOptions) {
    if (options?.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null
    assert.equal(typeof value, 'string')
    if (!(this.dropPending && key.startsWith(BUDGET_HELD_PREFIX))
      && !(this.dropResults && key.includes('/budget-held-jobs/results/'))) this.objects.set(key, value as string)
    return {}
  }
  async delete(key: string) { if (this.failDelete) throw new Error('R2 delete unavailable'); this.objects.delete(key) }
  async list(options: { prefix: string; limit: number; cursor?: string }) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix) && (!options.cursor || key > options.cursor)).sort()
    const page = keys.slice(0, options.limit)
    return { objects: page.map(key => ({ key })), truncated: keys.length > page.length,
      ...(keys.length > page.length ? { cursor: page.at(-1)! } : {}) }
  }
}

async function fixture() {
  const db = discoveryDatabase(), base = discoveryEnvironment(db), bucket = new Bucket(), sent: IngestionJob[] = []
  db.exec(readFileSync('infra/d1/pipeline/migrations/0017_automation_retry_state.sql', 'utf8'))
  const content = { format: 'studyinchina.cloudflare-budget-policy' as const, version: 1 as const, accountId: 'a'.repeat(32),
    baseMicroDollars: 5000000, totalMicroDollars: 10000000, pauseAtMicroDollars: 9000000, maxAgeSeconds: 7200 }
  const policySha256 = await budgetPolicySha256(content)
  bucket.objects.set(BUDGET_POLICY_KEY, JSON.stringify({ ...content, sha256: policySha256 }))
  function budget(state: 'ready' | 'paused', observedAt = NOW) {
    bucket.objects.set(BUDGET_OBSERVATION_KEY, JSON.stringify({ format: 'studyinchina.cloudflare-budget-observation', version: 1,
      policySha256, state, observedAt, periodStart: '2026-11-01', periodEnd: null,
      usageMicroDollars: state === 'paused' ? 4000000 : 1000000,
      totalMicroDollars: state === 'paused' ? 9000000 : 6000000, code: 'budget_test' }))
  }
  budget('paused')
  const env: IngestionEnv = { ...base, SNAPSHOTS_BUCKET: bucket, BUDGET_STATE_BUCKET: bucket,
    SCHEDULE_BATCH_LIMIT: '2', INGESTION_QUEUE: { async send(job) { sent.push(job) } } }
  async function seed(id: string) {
    const source = seedDiscoverySource(db, { id: `source-${id}` })
    const job: IngestionJob = { version: 1, jobId: `job-${id}`, sourceId: source.id, reason: 'scheduled', scheduledAt: NOW }
    assert.equal(await claimJob(env, job), true)
    return job
  }
  const pending = () => [...bucket.objects.keys()].filter(key => key.startsWith(BUDGET_HELD_PREFIX))
  const state = (job: IngestionJob) => db.prepare('SELECT * FROM ingestion_jobs WHERE job_id=?').get(job.jobId)
  return { db, env, bucket, budget, sent, seed, pending, state }
}

test('budget retry exhaustion remains recoverable through the normal cron using the original never-started job', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('exhausted'), before = f.state(job)
    let acks = 0, retries = 0
    // The fifth retry is the last one before the real provider sends max_retries=4 work to its DLQ.
    for (let attempts = 1; attempts <= 5; attempts++) await worker.queue({ queue: 'ingestion', messages: [{ id: 'provider-id', body: job, attempts,
      ack() { acks++ }, retry(options) { assert.equal(options?.delaySeconds, 3600); retries++ } }] }, f.env)
    assert.equal(retries, 5); assert.equal(acks, 0); assert.equal(f.pending().length, 1)
    assert.deepEqual(f.state(job), before)
    f.budget('ready')
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.parse(NOW) }, f.env)
    assert.deepEqual(f.sent, [job])
    assert.deepEqual(f.state(job), before, 'dispatch never resets or manufactures a business attempt')
    assert.equal(f.pending().length, 0)
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.parse(NOW) }, f.env)
    assert.deepEqual(f.sent, [job], 'normal cron does not keep redispatching the same queued job')
  } finally { f.db.close() }
})

test('a marker write that cannot be read back always retries and never acknowledges or changes D1', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('storage-failure'), before = f.state(job)
    f.bucket.dropPending = true
    let acks = 0, retries = 0
    await assert.rejects(worker.queue({ queue: 'ingestion', messages: [{ id: 'provider-id', body: job, attempts: 4,
      ack() { acks++ }, retry() { retries++ } }] }, f.env), /could not be persisted/u)
    assert.equal(acks, 0); assert.equal(retries, 1); assert.equal(f.pending().length, 0)
    assert.deepEqual(f.state(job), before)
  } finally { f.db.close() }
})

test('recovery is bounded and disabled markers yield to later jobs, then recover after re-enabling', async () => {
  const f = await fixture()
  try {
    const jobs = [await f.seed('one'), await f.seed('two'), await f.seed('three')]
    for (const job of jobs) await rememberBudgetHeldJob(f.env, job, new Date(NOW))
    const firstKey = f.pending().sort()[0], first = JSON.parse(f.bucket.objects.get(firstKey)!).job as IngestionJob
    f.db.prepare('UPDATE ingestion_sources SET enabled=0 WHERE source_id=?').run(first.sourceId)
    f.budget('ready')
    const one = await drainBudgetHeldJobs(f.env, 1, new Date(NOW))
    assert.equal(one.inspected, 1); assert.equal(one.retained, 1); assert.equal(f.sent.length, 0)
    await drainBudgetHeldJobs(f.env, 1, new Date(NOW))
    await drainBudgetHeldJobs(f.env, 1, new Date(NOW))
    assert.equal(f.sent.length, 2); assert.equal(f.pending().length, 1)
    f.db.prepare('UPDATE ingestion_sources SET enabled=1 WHERE source_id=?').run(first.sourceId)
    await drainBudgetHeldJobs(f.env, 1, new Date(NOW))
    assert.equal(f.sent.length, 3); assert.equal(f.pending().length, 0)
  } finally { f.db.close() }
})

test('permanent malformed markers cannot starve later valid work across bounded pages', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('after-poison')
    await rememberBudgetHeldJob(f.env, job, new Date(NOW))
    for (let i = 0; i < 4; i++) f.bucket.objects.set(`${BUDGET_HELD_PREFIX}!invalid-${i}`, '{}')
    f.budget('ready')
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    assert.equal((await drainBudgetHeldJobs(f.env, 2, new Date(NOW))).redispatched, 1)
    assert.deepEqual(f.sent, [job])
  } finally { f.db.close() }
})

test('all started, retrying, unknown, changed and terminal states refuse recovery without changing their ledger', async () => {
  const f = await fixture()
  try {
    const changes = ["status='running',attempt=1,started_at='2026-11-13T07:00:00Z'",
      "status='retrying',attempt=1,started_at='2026-11-13T07:00:00Z'",
      "status='completed',attempt=1,started_at='2026-11-13T07:00:00Z',completed_at='2026-11-13T07:01:00Z'",
      "status='failed',attempt=1,completed_at='2026-11-13T07:01:00Z'",
      "error_code='outcome_unknown'", "started_at='2026-11-13T07:00:00Z'", "scheduled_at='2026-11-12T07:00:00Z'"]
    for (let i = 0; i < changes.length; i++) {
      const job = await f.seed(`protected-${i}`)
      await rememberBudgetHeldJob(f.env, job, new Date(NOW))
      f.db.prepare(`UPDATE ingestion_jobs SET ${changes[i]} WHERE job_id=?`).run(job.jobId)
    }
    const before = f.db.prepare('SELECT * FROM ingestion_jobs ORDER BY job_id').all()
    f.budget('ready')
    const result = await drainBudgetHeldJobs(f.env, 20, new Date(NOW))
    assert.equal(result.discarded, changes.length); assert.equal(f.sent.length, 0)
    assert.deepEqual(f.db.prepare('SELECT * FROM ingestion_jobs ORDER BY job_id').all(), before)
    assert.equal(f.pending().length, 0)
  } finally { f.db.close() }
})

test('a queue-send failure retains the marker and can retry once without altering a job', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('send-failed'), before = f.state(job)
    await rememberBudgetHeldJob(f.env, job, new Date(NOW)); f.budget('ready')
    f.env.INGESTION_QUEUE.send = async () => { throw new Error('queue unavailable') }
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    assert.equal(f.pending().length, 1); assert.deepEqual(f.state(job), before)
    f.env.INGESTION_QUEUE.send = async job => { f.sent.push(job) }
    await drainBudgetHeldJobs(f.env, 2, new Date(NOW))
    assert.deepEqual(f.sent, [job]); assert.equal(f.pending().length, 0)
  } finally { f.db.close() }
})

test('recovery rechecks current manifest and cost policy before dispatching an older scheduled job', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('current-policy')
    await rememberBudgetHeldJob(f.env, job, new Date(NOW)); f.budget('ready')
    f.env.INFRA_FORECAST_CNY = '95'
    // The original job says scheduled, but the current source is a discovery
    // anchor; its changed/current classification cannot bypass a discovery freeze.
    assert.equal((await drainBudgetHeldJobs(f.env, 2, new Date(NOW))).retained, 1)
    assert.equal(f.sent.length, 0); assert.equal(f.pending().length, 1)
    f.env.INFRA_FORECAST_CNY = '0'
    f.db.prepare("UPDATE ingestion_sources SET manifest_json=json_set(manifest_json,'$.robots.mode','blocked') WHERE source_id=?").run(job.sourceId)
    assert.equal((await drainBudgetHeldJobs(f.env, 2, new Date(NOW))).retained, 1)
    assert.equal(f.sent.length, 0)
    f.db.prepare("UPDATE ingestion_sources SET manifest_json=json_set(manifest_json,'$.robots.mode','enforce') WHERE source_id=?").run(job.sourceId)
    await drainBudgetHeldJobs(f.env, 2, new Date(NOW))
    assert.deepEqual(f.sent, [job])
  } finally { f.db.close() }
})

test('a crash after send cannot replay a job that started before its recovery receipt persisted', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('sent-before-crash')
    await rememberBudgetHeldJob(f.env, job, new Date(NOW)); f.budget('ready'); f.bucket.dropResults = true
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    assert.equal(f.sent.length, 1); assert.equal(f.pending().length, 1)
    assert.equal(await markJobRunning(f.env, job, 1, NOW), true)
    const running = f.state(job)
    f.bucket.dropResults = false
    await drainBudgetHeldJobs(f.env, 2, new Date(NOW))
    assert.equal(f.sent.length, 1); assert.equal(f.pending().length, 0)
    assert.deepEqual(f.state(job), running)
  } finally { f.db.close() }
})

test('done receipts bind the original payload and exact pending-marker hash before cleanup', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('bound-receipt')
    await rememberBudgetHeldJob(f.env, job, new Date(NOW)); f.budget('ready'); f.bucket.failDelete = true
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    const key = [...f.bucket.objects.keys()].find(key => key.includes('/budget-held-jobs/results/'))!
    const receipt = JSON.parse(f.bucket.objects.get(key)!)
    assert.match(receipt.jobSha256, /^[a-f0-9]{64}$/u); assert.match(receipt.markerSha256, /^[a-f0-9]{64}$/u)
    f.bucket.objects.set(key, JSON.stringify({ ...receipt, markerSha256: '0'.repeat(64) }))
    f.bucket.failDelete = false
    await assert.rejects(drainBudgetHeldJobs(f.env, 2, new Date(NOW)), /could not be recovered/u)
    assert.equal(f.sent.length, 1); assert.equal(f.pending().length, 1)
  } finally { f.db.close() }
})

test('a second independent pause retains a new recovery marker for the same never-started job', async () => {
  const f = await fixture()
  try {
    const job = await f.seed('second-pause')
    await rememberBudgetHeldJob(f.env, job, new Date(NOW)); f.budget('ready')
    await drainBudgetHeldJobs(f.env, 2, new Date(NOW))
    const later = '2026-11-13T08:00:01.000Z'
    f.budget('paused', later)
    await rememberBudgetHeldJob(f.env, job, new Date(later)); f.budget('ready', later)
    await drainBudgetHeldJobs(f.env, 2, new Date(later))
    assert.equal(f.sent.length, 2)
    const claims = await Promise.all([markJobRunning(f.env, f.sent[0], 1, later), markJobRunning(f.env, f.sent[1], 1, later)])
    assert.deepEqual(claims.sort(), [false, true], 'duplicate provider deliveries have only one atomic business start')
  } finally { f.db.close() }
})

test('atomic job starts reject duplicates and unknown states while preserving legitimate subsequent retries', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('atomic')
    assert.deepEqual((await Promise.all([markJobRunning(f.env, job, 1, NOW), markJobRunning(f.env, job, 1, NOW)])).sort(), [false, true])
    assert.equal(await markJobRunning(f.env, job, 2, NOW), false, 'a running job cannot be restarted by a duplicate')
    f.db.prepare("UPDATE ingestion_jobs SET status='retrying' WHERE job_id=?").run(job.jobId)
    assert.equal(await markJobRunning(f.env, job, 1, NOW), false)
    assert.deepEqual((await Promise.all([markJobRunning(f.env, job, 2, NOW), markJobRunning(f.env, job, 2, NOW)])).sort(), [false, true])
    f.budget('ready')
    let fetched = 0, acked = 0
    context.mock.method(globalThis, 'fetch', async () => { fetched++; throw new Error('duplicate must not fetch') })
    await worker.queue({ queue: 'ingestion', messages: [{ id: 'late-provider-copy', body: job, attempts: 5,
      ack() { acked++ }, retry() { assert.fail('the already-claimed copy is safely acknowledged') } }] }, f.env)
    assert.equal(fetched, 0); assert.equal(acked, 1)
    const unknown = await f.seed('unknown')
    f.db.prepare("UPDATE ingestion_jobs SET error_code='model_outcome_unknown' WHERE job_id=?").run(unknown.jobId)
    assert.equal(await markJobRunning(f.env, unknown, 1, NOW), false)
    f.db.prepare("UPDATE ingestion_jobs SET status='retrying',attempt=1 WHERE job_id=?").run(unknown.jobId)
    assert.equal(await markJobRunning(f.env, unknown, 2, NOW), false, 'unknown null-start retries are not a proven pre-process failure')
  } finally { f.db.close() }
})

test('a proven claim SQL failure with null started_at can take its next legitimate retry', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('claim-sql-failure')
    f.budget('ready')
    const base = f.env.INGESTION_DB
    let firstClaim = true, fetched = 0, retried = 0
    f.env.INGESTION_DB = { batch: base.batch.bind(base), prepare(sql) {
      if (firstClaim && sql.includes("SET status = 'running'")) {
        firstClaim = false
        return base.prepare(sql.replace('UPDATE ingestion_jobs', 'UPDATE intentionally_missing_claim_table'))
      }
      return base.prepare(sql)
    } }
    context.mock.method(globalThis, 'fetch', async () => { fetched++; throw new TypeError('fetch failed') })
    const delivery = (attempts: number) => ({ id: `provider-claim-${attempts}`, body: job, attempts,
      ack() { assert.fail('a retryable failure cannot be acknowledged') }, retry() { retried++ } })
    await worker.queue({ queue: 'ingestion', messages: [delivery(1)] }, f.env)
    assert.equal(fetched, 0)
    assert.equal(f.state(job)?.status, 'retrying'); assert.equal(f.state(job)?.attempt, 1)
    assert.equal(f.state(job)?.started_at, null); assert.equal(f.state(job)?.error_code, 'job_start_failed')
    context.mock.timers.tick(5001)
    f.db.prepare(`INSERT INTO ingestion_robots_cache(host,body,status_code,fetched_at,expires_at)
      VALUES('admissions.example.edu.cn','User-agent: *\nAllow: /',200,?,?)`).run(NOW, '2026-11-14T08:00:00.000Z')
    await worker.queue({ queue: 'ingestion', messages: [delivery(2)] }, f.env)
    assert.equal(fetched, 1)
    assert.equal(f.state(job)?.attempt, 2); assert.notEqual(f.state(job)?.started_at, null)
    assert.equal(retried, 2)
  } finally { f.db.close() }
})

test('a retry meeting a busy domain preserves its logical attempt across a fresh broker message', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('domain-busy-retry')
    assert.equal(await markJobRunning(f.env, job, 1, NOW), true)
    f.db.prepare("UPDATE ingestion_jobs SET status='retrying' WHERE job_id=?").run(job.jobId)
    f.budget('ready')
    const before = f.state(job)
    const domain = new URL(JSON.parse(f.db.prepare('SELECT manifest_json FROM ingestion_sources WHERE source_id=?').get(job.sourceId)!.manifest_json as string).officialUrl).hostname
    const busy = await acquireDomainLease(f.env, domain, new Date())
    assert.ok(busy)
    let acked = 0, retries = 0, fetched = 0
    const delivery = (body: IngestionJob, attempts: number) => ({ id: `provider-${attempts}`, body, attempts,
      ack() { acked++ }, retry() { retries++ } })
    await worker.queue({ queue: 'ingestion', messages: [delivery(job, 2)] }, f.env)
    assert.equal(acked, 1); assert.equal(retries, 0); assert.equal(f.sent.length, 1)
    const republished = f.sent[0]
    assert.equal(republished.jobId, job.jobId); assert.equal(republished.deliveryAttemptOffset, 1)
    assert.deepEqual(f.state(job), before)
    await releaseDomainLease(f.env, busy, new Date())
    context.mock.timers.tick(5001)
    f.db.prepare(`INSERT INTO ingestion_robots_cache(host,body,status_code,fetched_at,expires_at)
      VALUES(?,'User-agent: *\nAllow: /',200,?,?)`).run(domain, NOW, '2026-11-14T08:00:00.000Z')
    context.mock.method(globalThis, 'fetch', async () => { fetched++; throw new TypeError('fetch failed') })
    await worker.queue({ queue: 'ingestion', messages: [delivery(republished, 1)] }, f.env)
    assert.equal(fetched, 1, 'fresh provider attempts=1 must execute logical retry two')
    assert.equal(f.state(job)?.status, 'retrying'); assert.equal(f.state(job)?.attempt, 2)
    assert.equal(retries, 1)
    context.mock.timers.tick(5001)
    await worker.queue({ queue: 'ingestion', messages: [delivery(job, 2)] }, f.env)
    assert.equal(fetched, 1, 'a late copy of the same logical attempt cannot execute again')
    assert.equal(acked, 2)
    context.mock.timers.tick(5001)
    await worker.queue({ queue: 'ingestion', messages: [delivery(republished, 2)] }, f.env)
    assert.equal(fetched, 2, 'the subsequent legitimate provider retry remains logical attempt three')
    assert.equal(f.state(job)?.status, 'retrying'); assert.equal(f.state(job)?.attempt, 3)
  } finally { f.db.close() }
})

test('a failing duplicate claim cannot change another running or unknown execution into a retry', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) })
  const f = await fixture()
  try {
    const job = await f.seed('protected-running')
    assert.equal(await markJobRunning(f.env, job, 1, NOW), true)
    const before = f.state(job), base = f.env.INGESTION_DB
    f.budget('ready')
    f.env.INGESTION_DB = { batch: base.batch.bind(base), prepare(sql) {
      return base.prepare(sql.includes("SET status = 'running'")
        ? sql.replace('UPDATE ingestion_jobs', 'UPDATE intentionally_missing_claim_table') : sql)
    } }
    let fetched = 0, retries = 0
    context.mock.method(globalThis, 'fetch', async () => { fetched++; throw new Error('unknown running work must not replay') })
    await worker.queue({ queue: 'ingestion', messages: [{ id: 'duplicate-with-database-error', body: job, attempts: 2,
      ack() { assert.fail('a failed claim is not a successful duplicate observation') }, retry() { retries++ } }] }, f.env)
    assert.equal(fetched, 0); assert.equal(retries, 1)
    assert.deepEqual(f.state(job), before)
  } finally { f.db.close() }
})
