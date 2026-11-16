import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRefillCoordinator, type RefillDependencies } from '../src/refill-coordinator'
import { closeRefillDeliveryBeforeClaim } from '../src/queue-refill-delivery'
import { handleQueue } from '../src/index'
import { claimJob, finishJob } from '../src/repository'
import { selectRefillCandidates, dispatchRefillCandidates, observeRefillDispatch, readRefillDispatchStatus, readRefillJobState, declineRefillDispatch } from '../src/refill-dispatch'
import { BUDGET_POLICY_KEY } from '../../shared/background-budget'
import { nextD1Reset } from '../src/runtime'
import { REFILL_SINGLETON, type RefillEnv, type RefillStorage } from '../src/refill-contract'
import type { MaintenanceMessage } from '../src/types'
import { canonical } from '../src/util'
import { MemoryStorage } from './fixture'
import { refillFixture, refillNow } from './refill-dispatch-fixture'

async function fixture() {
  const f = await refillFixture(12)
  let clock = refillNow, alarmAt: number | null = null, providerCalls = 0
  const storage = Object.assign(new MemoryStorage(), { async setAlarm(at: number) { alarmAt = at }, async deleteAlarm() { alarmAt = null }, async getAlarm() { return alarmAt } }) as RefillStorage
  const env = f.env as RefillEnv
  env.CONTINUOUS_REFILL_ENABLED = 'true'; env.REFILL_MODEL_LIMIT = '2'; env.MAINTENANCE_ADMIN_TOKEN = 'a'.repeat(64)
  env.MODEL_ADMISSION = { idFromName() { providerCalls++; throw Error('provider_forbidden') }, get() { throw Error('provider_forbidden') } }
  env.REFILL_COORDINATOR = { idFromName: name => name, get: () => ({ fetch: request => coordinator.fetch(request) }) }
  const deps: RefillDependencies = {
    now: () => clock,
    // Provider quota/network behavior is separately covered by coordinator
    // tests. Here the real Queue handler's budget/control/D1 gates and the real
    // dispatcher ledger/CAS execute against SQLite; no model can be called.
    gate: async () => { const cfg = f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()!; return { fence: { scopeSha256: String(cfg.scope_sha256), inputCatalogSha256: String(cfg.input_catalog_sha256), revision: Number(cfg.revision), canaryJson: String(cfg.canary_json) }, capture: true, model: true, reason: 'fixture_ready', retryAt: clock } },
    jobs: async (_env, ids) => (await Promise.all(ids.map(id => readRefillJobState(env, id)))).filter(row => row !== null),
    select: selectRefillCandidates, dispatch: dispatchRefillCandidates, plan: async () => undefined,
    observe: observeRefillDispatch, dispatchStatus: readRefillDispatchStatus, decline: declineRefillDispatch,
  }
  const coordinator = new CatalogRefillCoordinator({ storage, id: REFILL_SINGLETON }, env, deps)
  const call = async (path: string, body?: unknown) => {
    const response = await coordinator.fetch(new Request('https://catalog-refill.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + env.MAINTENANCE_ADMIN_TOKEN, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    assert.equal(response.status, 200)
    return response.json() as Promise<Record<string, unknown>>
  }
  await call('/wake', { reason: 'watchdog' }); clock += 10_000; await coordinator.alarm()
  assert.equal(f.messages.length, 8)
  const message = f.messages[0]
  assert.match(message.refill!.dispatchToken, /^[a-f0-9-]{36}$/u, 'use the actual UUID from the real coordinator, not a fabricated SHA token')
  const batch = async (body = message, attempts = 1) => {
    let acked = 0; const retry: Array<number | undefined> = []
    await handleQueue({ messages: [{ id: 'native-delivery-test', body, attempts, ack() { acked++ }, retry(options) { retry.push(options?.delaySeconds) } }] }, env)
    return { acked, retry }
  }
  const metadata = { jobId: message.jobId, ...message.refill! }
  const ledger = async () => (await readRefillDispatchStatus(env, message.refill!.dispatchToken)).entries.find(row => row.jobId === message.jobId)!
  const assertClosed = async () => { const row = await ledger(); assert.equal(row.status, 'observed'); assert.equal(row.resolution, 'received_not_started'); assert.match(row.receivedNotStartedReceiptSha256!, /^[a-f0-9]{64}$/u) }
  const status = async () => (await call('/status')).model as { pending: number; inflight: number }
  return { ...f, env, message, metadata, call, batch, ledger, assertClosed, status, clock: () => clock, providerCalls: () => providerCalls }
}

test('a duplicate may cancel an acquired but unclaimed delivery atomically; the late claimant cannot run', async () => {
  const f = await fixture()
  try {
    const acquired = await f.call('/acquire', f.metadata); assert.equal(acquired.allowed, true)
    assert.deepEqual(await f.batch(f.message, 3), { acked: 1, retry: [] })
    await f.assertClosed()
    assert.equal(await claimJob(f.env, f.message.jobId, f.clock(), f.message.refill), null)
    // A's finally must use the authoritative refusal proof, not an elapsed
    // permit timeout, to return capacity after its now-rejected claim.
    assert.equal((await f.call('/release', { jobId: f.message.jobId, permitToken: acquired.permitToken })).released, true)
    assert.deepEqual(await f.status(), { pending: 7, inflight: 0, eligible: null, limit: 2, epochUsed: 8, epochCap: 256 })
    assert.deepEqual(await f.batch(f.message, 4), { acked: 1, retry: [] })
    assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
  } finally { f.db.sqlite.close() }
})

test('once A has claimed, B only acknowledges proven duplicate progress and cannot release A capacity', async () => {
  const f = await fixture()
  try {
    const acquired = await f.call('/acquire', f.metadata)
    const job = await claimJob(f.env, f.message.jobId, f.clock(), f.message.refill); assert.ok(job)
    assert.equal((await f.call('/claimed', { jobId: job.job_id, permitToken: acquired.permitToken, leaseToken: job.lease_token })).confirmed, true)
    assert.deepEqual(await f.batch(f.message, 3), { acked: 1, retry: [] })
    assert.equal((await f.ledger()).resolution, 'job_progress')
    assert.equal((await f.status()).inflight, 1)
    const actual = f.db.sqlite.prepare('SELECT status,attempt,lease_token FROM maintenance_jobs WHERE job_id=?').get(job.job_id)!
    assert.equal(actual.status, 'running'); assert.equal(actual.attempt, job.attempt); assert.equal(actual.lease_token, job.lease_token)
    assert.equal((await f.call('/release', { jobId: job.job_id, permitToken: acquired.permitToken })).released, false)
    await finishJob(f.env, job, 'done')
    assert.equal((await f.call('/release', { jobId: job.job_id, permitToken: acquired.permitToken })).released, true)
    assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
  } finally { f.db.sqlite.close() }
})

test('claim winning during B refusal CAS rolls back cleanup and leaves only a provable duplicate ACK', async () => {
  const f = await fixture()
  try {
    const acquired = await f.call('/acquire', f.metadata)
    const original = f.db.batch.bind(f.db); let injected = false, claimedLease: string | null = null
    f.db.batch = async statements => {
      if (!injected) { injected = true; const claimed = await claimJob(f.env, f.message.jobId, f.clock(), f.message.refill); assert.ok(claimed); claimedLease = claimed.lease_token }
      return original(statements)
    }
    await closeRefillDeliveryBeforeClaim(f.env, f.message, 'claim_rejected')
    assert.equal((await f.ledger()).resolution, 'job_progress')
    assert.equal(f.db.sqlite.prepare('SELECT lease_token FROM maintenance_jobs WHERE job_id=?').get(f.message.jobId)!.lease_token, claimedLease)
    assert.equal((await f.call('/release', { jobId: f.message.jobId, permitToken: acquired.permitToken })).released, false)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()!.n, 0)
    assert.equal(f.providerCalls(), 0)
  } finally { f.db.sqlite.close() }
})

test('operator pause, model disable and leaving canary acknowledge exact unstarted messages without business attempts', async () => {
  for (const mode of ['operator', 'models', 'canary'] as const) {
    const f = await fixture()
    try {
      if (mode === 'operator') f.env.MAINTENANCE_ENABLED = 'false'
      if (mode === 'models') f.db.sqlite.exec('UPDATE maintenance_control SET models_enabled=0')
      if (mode === 'canary') f.db.sqlite.prepare('UPDATE maintenance_control SET canary_json=?').run('["unrelated-school"]')
      assert.deepEqual(await f.batch(), { acked: 1, retry: [] }, mode)
      await f.assertClosed()
      assert.equal(f.db.sqlite.prepare('SELECT attempt FROM maintenance_jobs WHERE job_id=?').get(f.message.jobId)!.attempt, 0)
      assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
    } finally { f.db.sqlite.close() }
  }
})

test('budget and cached quota early returns close delivery proof; resumed coordinator reclaims the watermark', async () => {
  for (const mode of ['budget', 'quota'] as const) {
    const f = await fixture()
    try {
      const now = Date.now()
      if (mode === 'budget') await f.bucket.put(BUDGET_POLICY_KEY, '{}')
      else await f.bucket.put('maintenance/runtime/d1-quota-wait.v1.json', canonical({ format: 'studyinchina.d1-quota-wait', version: 1, observedAt: new Date(now).toISOString(), retryAt: nextD1Reset(now) }))
      assert.deepEqual(await f.batch(), { acked: 1, retry: [] }, mode)
      await f.assertClosed()
      assert.equal(f.db.sqlite.prepare('SELECT attempt FROM maintenance_jobs WHERE job_id=?').get(f.message.jobId)!.attempt, 0)
      // These are fixture-only operator recovery actions. Neither the handler
      // nor coordinator is allowed to clear a real user's budget/quota hold.
      f.bucket.objects.delete(BUDGET_POLICY_KEY); f.bucket.objects.delete('maintenance/runtime/d1-quota-wait.v1.json')
      assert.equal((await f.call('/acquire', f.metadata)).allowed, false)
      assert.equal((await f.status()).pending, 7)
      assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
    } finally { f.db.sqlite.close() }
  }
})

test('bounded broker cleanup leaves historical provider unknowns byte-for-byte protected and never replays them', async () => {
  const f = await fixture()
  try {
    const source = f.db.sqlite.prepare('SELECT source_id FROM maintenance_jobs WHERE job_id=?').get(f.message.jobId)!.source_id
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('historic-key','historic-unknown',?,'historic-raw','primary','historic-request','MiniMax-M3','unknown',?,'{}')").run(source, new Date(f.clock() - 1000).toISOString())
    const protectedRequest = { state: 'unknown', attemptId: 'historic-unknown', requestSha256: 'historic-request', marker: 'unchanged' }
    await f.storage.put('request:historic-key', protectedRequest)
    const before = canonical({ ...f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts WHERE attempt_id=?').get('historic-unknown')! })
    assert.deepEqual(await f.batch(f.message, 3), { acked: 1, retry: [] })
    await f.assertClosed()
    await f.call('/acquire', f.metadata)
    assert.equal((await f.status()).pending, 7)
    assert.equal(canonical({ ...f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts WHERE attempt_id=?').get('historic-unknown')! }), before)
    assert.deepEqual(await f.storage.get('request:historic-key'), protectedRequest)
    const next = await selectRefillCandidates(f.env, { kind: 'model', limit: 8, excludeJobIds: [], now: f.clock() })
    assert.equal(next.candidates.some(candidate => candidate.sourceId === source), false)
    assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
  } finally { f.db.sqlite.close() }
})

test('a truly started unknown job keeps its execution permit even when duplicate messages can be acknowledged', async () => {
  const f = await fixture()
  try {
    const acquired = await f.call('/acquire', f.metadata)
    const job = await claimJob(f.env, f.message.jobId, f.clock(), f.message.refill); assert.ok(job)
    assert.equal((await f.call('/claimed', { jobId: job.job_id, permitToken: acquired.permitToken, leaseToken: job.lease_token })).confirmed, true)
    await finishJob(f.env, job, 'unknown', 'model_outcome_unknown')
    assert.deepEqual(await f.batch(f.message, 3), { acked: 1, retry: [] })
    assert.equal((await f.ledger()).resolution, 'job_progress')
    assert.equal((await f.call('/release', { jobId: job.job_id, permitToken: acquired.permitToken })).released, false)
    assert.equal((await f.status()).inflight, 1)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_jobs WHERE job_id=?').get(job.job_id)!.status, 'unknown')
    assert.equal(f.providerCalls(), 0)
  } finally { f.db.sqlite.close() }
})

test('a forged epoch cannot cause ACK, claim or cleanup of another live dispatch', async () => {
  const f = await fixture()
  try {
    const forged: MaintenanceMessage = { ...f.message, refill: { ...f.message.refill!, epochSha256: 'f'.repeat(64) } }
    const result = await f.batch(forged, 3)
    assert.equal(result.acked, 0); assert.equal(result.retry.length, 1); assert.ok(result.retry[0]! >= 30)
    assert.equal((await f.ledger()).status, 'sent')
    assert.equal(f.db.sqlite.prepare('SELECT attempt FROM maintenance_jobs WHERE job_id=?').get(f.message.jobId)!.attempt, 0)
    assert.equal(f.providerCalls(), 0); assert.equal(f.messages.length, 8)
  } finally { f.db.sqlite.close() }
})
