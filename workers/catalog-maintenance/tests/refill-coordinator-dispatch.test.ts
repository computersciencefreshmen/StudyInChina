import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRefillCoordinator, type RefillDependencies } from '../src/refill-coordinator'
import { claimJob, finishJob } from '../src/repository'
import { selectRefillCandidates, dispatchRefillCandidates, observeRefillDispatch, readRefillDispatchStatus, readRefillJobState, declineRefillDispatch } from '../src/refill-dispatch'
import type { RefillEnv, RefillStorage } from '../src/refill-contract'
import { MemoryStorage } from './fixture'
import { refillFixture, refillNow } from './refill-dispatch-fixture'

test('real production dispatcher never receives a 2+6 split of a recovered immutable token', { timeout: 30_000 }, async () => {
  const f = await refillFixture(12)
  try {
    let clock = refillNow + 14 * 60_000 + 40_000, alarmAt: number | null = null, providerCalls = 0
    const memory = new MemoryStorage(), storage = Object.assign(memory, {
      async setAlarm(at: number) { alarmAt = at }, async deleteAlarm() { alarmAt = null }, async getAlarm() { return alarmAt },
    }) as RefillStorage
    const env = f.env as RefillEnv
    env.CONTINUOUS_REFILL_ENABLED = 'true'; env.REFILL_MODEL_LIMIT = '2'; env.MAINTENANCE_ADMIN_TOKEN = 'a'.repeat(64)
    env.MODEL_ADMISSION = { idFromName() { providerCalls++; throw Error('provider_forbidden') }, get() { throw Error('provider_forbidden') } }
    const calls: Array<{ token: string; size: number }> = []
    const deps: RefillDependencies = {
      now: () => clock,
      gate: async () => { const cfg = f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()!; return { fence: { scopeSha256: String(cfg.scope_sha256), inputCatalogSha256: String(cfg.input_catalog_sha256), revision: Number(cfg.revision), canaryJson: String(cfg.canary_json) }, capture: true, model: true, reason: 'fixture_ready', retryAt: clock } },
      jobs: async (_env, ids) => (await Promise.all(ids.map(id => readRefillJobState(env, id)))).filter(row => row !== null),
      select: selectRefillCandidates, plan: async () => undefined, observe: observeRefillDispatch,
      dispatchStatus: readRefillDispatchStatus, decline: declineRefillDispatch,
      dispatch: async () => { throw Error('fixture_pre_send_crash') },
    }
    let coordinator = new CatalogRefillCoordinator({ storage, id: 'catalog-refill-v1' }, env, deps)
    env.REFILL_COORDINATOR = { idFromName: name => name, get: () => ({ fetch: request => coordinator.fetch(request) }) }
    const call = async (path: string, body?: unknown) => {
      const response = await coordinator.fetch(new Request('https://catalog-refill.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + env.MAINTENANCE_ADMIN_TOKEN, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
      assert.equal(response.status, 200); return response.json() as Promise<Record<string, unknown>>
    }
    await call('/wake', { reason: 'watchdog' }); clock += 10_000; await coordinator.alarm()
    // Arrange the exact last durable point before send-start. The real selector
    // produced all eight hashed proof descriptors; the real dispatcher has not
    // run, and there is no D1 delivery row or Queue message to erase/replay.
    const parked = await memory.get<{ outstanding: Record<string, { phase: string; dispatchToken: string }>; gateRetryAt: number | null }>('refill-v1')
    assert.equal(Object.keys(parked!.outstanding).length, 8)
    for (const entry of Object.values(parked!.outstanding)) entry.phase = 'prepared'
    parked!.gateRetryAt = null; await memory.put('refill-v1', parked)
    const originalIds = new Set(Object.keys(parked!.outstanding)), originalToken = Object.values(parked!.outstanding)[0].dispatchToken
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_refill_dispatches').get()!.n, 0)
    const legacy = f.jobs.find(job => job.stage === 'extract' && !originalIds.has(job.jobId))!
    clock += 20_000
    deps.dispatch = async (...args) => { calls.push({ token: args[3].dispatchToken, size: args[2].length }); return dispatchRefillCandidates(...args) }
    coordinator = new CatalogRefillCoordinator({ storage, id: 'catalog-refill-v1' }, env, deps)
    for (let n = 0; n < 254; n++) {
      f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='queued',due_at=? WHERE job_id=?").run(new Date(clock).toISOString(), legacy.jobId)
      const permit = await call('/acquire', { jobId: legacy.jobId }); assert.equal(permit.allowed, true)
      const job = await claimJob(env, legacy.jobId, clock); assert.ok(job)
      await finishJob(env, job, 'done')
      assert.equal((await call('/release', { jobId: legacy.jobId, permitToken: permit.permitToken })).released, true)
    }
    await coordinator.alarm()
    assert.equal(calls.length, 0, 'eight-job token cannot be sent as two jobs')
    assert.equal(f.messages.length, 0)
    assert.equal(((await call('/status')).model as { epochUsed: number }).epochUsed, 254)
    clock += 15 * 60_000; await coordinator.alarm()
    assert.equal(calls[0].token, originalToken); assert.equal(calls[0].size, 8)
    // The unchanged original proof has now expired: production rejects the
    // whole unsent token, then a fresh ordinary selection may make progress.
    assert.equal((await readRefillDispatchStatus(env, originalToken)).entries.length, 0)
    clock += 10_000; await coordinator.alarm()
    assert.ok(calls.every(batch => batch.size === 8))
    assert.equal(f.messages.length, 8)
    assert.equal((await call('/status')).uncertainDeliveries, 0)
    assert.equal(providerCalls, 0)
  } finally { f.db.sqlite.close() }
})
