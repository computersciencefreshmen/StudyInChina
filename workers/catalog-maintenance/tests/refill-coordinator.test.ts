import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRefillCoordinator, readRefillGate, type RefillDependencies } from '../src/refill-coordinator'
import { acquireRefillPermit, wakeRefill } from '../src/refill-client'
import { type RefillCandidate, type RefillEnv, type RefillFence, type RefillJobState, type RefillStorage } from '../src/refill-contract'

const hash = (n: number) => n.toString(16).padStart(64, '0')
const token = hash(12345)
class Storage implements RefillStorage {
  values = new Map<string, unknown>()
  alarm: number | null = null
  reads = 0
  writes = 0
  deletes = 0
  alarmWrites = 0
  async get<T>(key: string): Promise<T | undefined> { this.reads++; return structuredClone(this.values.get(key)) as T | undefined }
  async put<T>(key: string, value: T) { this.writes++; this.values.set(key, structuredClone(value)) }
  async delete(key: string) { this.deletes++; return this.values.delete(key) }
  async transaction<T>(run: (txn: RefillStorage) => Promise<T>): Promise<T> { return run(this) }
  async setAlarm(at: number) { this.alarmWrites++; this.alarm = at }
  async deleteAlarm() { this.alarmWrites++; this.alarm = null }
  async getAlarm() { return this.alarm }
}
type Dispatch = { ids: string[]; token: string; epoch: string; at: number }
function fixture(options: { models?: number; captures?: number; flag?: string; role?: string; modelLimit?: string } = {}) {
  let now = Date.parse('2026-11-16T10:00:00Z')
  const storage = new Storage(), rows = new Map<string, RefillJobState>(), dispatches: Dispatch[] = []
  const env = { CONTINUOUS_REFILL_ENABLED: options.flag ?? 'true', MODEL_STATE_MIGRATION_ROLE: options.role ?? 'target', REFILL_MODEL_LIMIT: options.modelLimit ?? '2', MAINTENANCE_ADMIN_TOKEN: token } as RefillEnv
  const fence: RefillFence = { scopeSha256: hash(1), inputCatalogSha256: hash(2), revision: 3, canaryJson: '["school-a"]' }
  const add = (n: number, stage: RefillJobState['stage']) => {
    const row: RefillJobState = { jobId: hash(n), sourceId: hash(n + 10_000), stage, status: 'queued', attempt: 0, updatedAt: new Date(now).toISOString(), leaseToken: null, leaseUntil: null, protectedModel: false, inScope: true }
    rows.set(row.jobId, row); return row
  }
  for (let n = 1; n <= (options.models ?? 24); n++) add(n, 'extract')
  for (let n = 1001; n <= 1000 + (options.captures ?? 8); n++) add(n, 'capture')
  let gateOpen = true, modelOpen = true, expansionOpen = true, gateCalls = 0, selectionCalls = 0
  const candidate = (row: RefillJobState): RefillCandidate => ({ jobId: row.jobId, sourceId: row.sourceId, stage: row.stage,
    status: row.status as 'queued' | 'retry', attempt: row.attempt, updatedAt: row.updatedAt, enqueuedAt: null, leaseToken: row.leaseToken })
  const deps: RefillDependencies = {
    now: () => now,
    gate: async () => { gateCalls++; return { fence: { ...fence }, capture: gateOpen, model: gateOpen && modelOpen, expansion: expansionOpen && modelOpen, reason: gateOpen ? modelOpen ? 'ready' : 'quota_exhausted_or_overflow_margin' : 'budget_paused', retryAt: now + 300_000 } },
    jobs: async (_env, ids) => ids.flatMap(id => { const row = rows.get(id); return row ? [{ ...row }] : [] }),
    plan: async () => undefined,
    observe: async () => true,
    dispatchStatus: async () => ({ entries: [] }),
    decline: async () => ({ declined: true, reason: 'received_not_started' }),
    select: async (_env, { kind, limit, excludeJobIds, allowExpansion }) => { selectionCalls++; return { fence: { ...fence }, candidates: [...rows.values()].filter(row => row.inScope && ['queued', 'retry'].includes(row.status) && !row.protectedModel && (row.stage === 'capture') === (kind === 'capture') && (kind === 'capture' || allowExpansion !== false || row.stage === 'maintain') && !excludeJobIds.includes(row.jobId)).slice(0, limit).map(candidate) } },
    dispatch: async (_env, _fence, candidates, input) => {
      const saved = await storage.get<{ outstanding: Record<string, { phase: string; dispatchToken: string }> }>('refill-v1')
      for (const row of candidates) { assert.equal(saved!.outstanding[row.jobId].phase, 'sending'); assert.equal(saved!.outstanding[row.jobId].dispatchToken, input.dispatchToken) }
      dispatches.push({ ids: candidates.map(row => row.jobId), token: input.dispatchToken, epoch: input.epochSha256, at: now })
      return { sent: candidates.map(row => row.jobId), notSent: [], unconfirmed: [] }
    },
  }
  let coordinator = new CatalogRefillCoordinator({ storage }, env, deps)
  const call = async (path: string, body?: unknown, auth = token) => {
    const response = await coordinator.fetch(new Request('https://catalog-refill.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: response.status, value: await response.json() as Record<string, unknown> }
  }
  const alarm = async (advance = 10_000) => { now += advance; await coordinator.alarm() }
  const start = async () => { await call('/wake', { reason: 'watchdog' }); await alarm() }
  const metadata = (id: string) => { const d = dispatches.findLast(item => item.ids.includes(id))!; return { jobId: id, dispatchToken: d.token, epochSha256: d.epoch } }
  return { storage, env, rows, fence, deps, dispatches, add, call, alarm, start, metadata, now: () => now,
    advance: (milliseconds: number) => { now += milliseconds },
    restart: () => { coordinator = new CatalogRefillCoordinator({ storage }, env, deps) },
    setGate: (open: boolean, models = open) => { gateOpen = open; modelOpen = models },
    setExpansion: (open: boolean) => { expansionOpen = open },
    counts: () => ({ gateCalls, selectionCalls }) }
}

test('requires exact enable flag and freezes the source account before any backend or queue work', async () => {
  for (const options of [{ flag: 'false' }, { flag: 'TRUE' }, { role: 'source' }]) {
    const f = fixture(options)
    await f.call('/wake', { reason: 'watchdog' }); await f.alarm()
    assert.equal(f.counts().gateCalls, 0); assert.equal(f.dispatches.length, 0); assert.equal(f.storage.alarm, null)
  }
  assert.equal((await wakeRefill({} as RefillEnv, { reason: 'watchdog' })).enabled, false)
  assert.equal((await acquireRefillPermit({} as RefillEnv, { jobId: hash(1), dispatchToken: 'old' })).allowed, false)
  assert.equal((await acquireRefillPermit({} as RefillEnv, { jobId: hash(1) })).allowed, true)
})

test('frozen source RPC and alarms perform zero storage reads, writes, deletes or timer operations', async () => {
  const f = fixture({ role: 'source' })
  for (const [path, body] of [['/wake', { reason: 'watchdog' }], ['/status', undefined], ['/acquire', { jobId: hash(1) }],
    ['/release', { jobId: hash(1), permitToken: 'old' }], ['/claimed', { jobId: hash(1), permitToken: 'old', leaseToken: 'old' }],
    ['/decline', { jobId: hash(1), dispatchToken: 'old-dispatch', epochSha256: hash(2), reason: 'operator_pause' }]] as const) {
    assert.equal((await f.call(path, body)).status, 503)
  }
  await f.alarm()
  assert.deepEqual({ reads: f.storage.reads, writes: f.storage.writes, deletes: f.storage.deletes, alarmWrites: f.storage.alarmWrites },
    { reads: 0, writes: 0, deletes: 0, alarmWrites: 0 })
  assert.equal(f.counts().gateCalls, 0); assert.equal(f.dispatches.length, 0)
})

test('status before the first committed observation is unavailable rather than fabricated zero work', async () => {
  const f = fixture()
  const result = await f.call('/status')
  assert.equal(result.status, 503); assert.equal(result.value.error, 'refill_telemetry_unavailable')
  assert.equal(f.storage.reads, 1); assert.equal(f.storage.writes, 0); assert.equal(f.storage.alarmWrites, 0)
  assert.equal(f.counts().gateCalls, 0)
})

test('flag-off status immediately projects disabled while retaining historical evidence without writes', async () => {
  const f = fixture(); await f.start()
  const original = (await f.call('/status')).value
  f.env.CONTINUOUS_REFILL_ENABLED = 'false'; f.advance(90_000)
  const writes = f.storage.writes, deletes = f.storage.deletes, alarms = f.storage.alarmWrites, calls = f.counts()
  const disabled = (await f.call('/status')).value
  assert.equal(disabled.enabled, false); assert.equal(disabled.state, 'disabled')
  assert.equal(disabled.reason, 'continuous_refill_disabled'); assert.equal(disabled.idleReason, 'continuous_refill_disabled')
  assert.equal(disabled.observedAt, original.observedAt); assert.deepEqual(disabled.model, original.model)
  assert.deepEqual(disabled.capture, original.capture); assert.equal(disabled.nextWakeAt, original.nextWakeAt)
  assert.deepEqual(f.counts(), calls); assert.equal(f.storage.writes, writes); assert.equal(f.storage.deletes, deletes); assert.equal(f.storage.alarmWrites, alarms)
  assert.deepEqual(await f.storage.get('refill-telemetry-v1'), original)
})

test('status reads the committed snapshot while selection is blocked; acquire remains ordered behind the mutation', async () => {
  const f = fixture(); await f.start()
  for (const id of f.dispatches[0].ids) f.rows.get(id)!.status = 'done'
  let release!: () => void, entered!: () => void
  const latch = new Promise<void>(resolve => { release = resolve }), selecting = new Promise<void>(resolve => { entered = resolve })
  const select = f.deps.select
  f.deps.select = async (...args) => { entered(); await latch; return select(...args) }
  f.restart()
  const alarm = f.alarm(); await selecting
  const committed = await f.storage.get<Record<string, unknown>>('refill-telemetry-v1')
  assert.ok(committed)
  const writes = f.storage.writes, deletes = f.storage.deletes, timers = f.storage.alarmWrites, counts = f.counts()
  let acquired = false
  const permit = f.call('/acquire', { jobId: hash(9) }).then(value => { acquired = true; return value })
  // Advancing the display clock cannot turn an older persisted observation into
  // freshly measured utilisation or latency. Only a real save observes anew.
  f.advance(5000)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const status = await Promise.race([f.call('/status'), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(Error('status_waited_for_selection')), 1000) })])
    assert.equal(status.status, 200); assert.deepEqual(status.value, committed)
    assert.notEqual(status.value.observedAt, new Date(f.now()).toISOString())
    assert.equal(status.value.refillLatencyP95Ms, null); assert.equal(status.value.modelTaskBusyPercent, null)
    assert.equal(acquired, false); assert.deepEqual(f.counts(), counts)
    assert.equal(f.storage.writes, writes); assert.equal(f.storage.deletes, deletes); assert.equal(f.storage.alarmWrites, timers)
    assert.equal((await f.call('/status', undefined, 'wrong')).status, 401)
  } finally { if (timeout) clearTimeout(timeout); release(); await alarm; await permit }
  assert.equal(acquired, true)
})

test('persists complete selection and send-start before egress; one alarm sends at most eight', async () => {
  const f = fixture()
  await f.start()
  assert.equal(f.dispatches.flatMap(d => d.ids).length, 8)
  await f.alarm()
  assert.equal(f.dispatches.flatMap(d => d.ids).length, 10)
  const status = (await f.call('/status')).value
  assert.deepEqual(status.model, { pending: 8, inflight: 0, eligible: null, limit: 2, epochUsed: 8, epochCap: 256 })
  assert.equal((status.capture as { pending: number }).pending, 2)
  assert.equal(JSON.stringify(status).includes('dispatchToken'), false)
  assert.equal((await f.call('/status', undefined, 'wrong')).status, 401)
})

test('real model permits enforce the pilot cap and duplicate deliveries do not share a permit', async () => {
  const f = fixture(); await f.start()
  const a = await f.call('/acquire', f.metadata(hash(1)))
  const b = await f.call('/acquire', f.metadata(hash(2)))
  const c = await f.call('/acquire', f.metadata(hash(3)))
  assert.equal(a.value.allowed, true); assert.equal(b.value.allowed, true)
  assert.equal(c.value.allowed, false); assert.equal(c.value.reason, 'refill_stage_capacity')
  assert.equal((await f.call('/acquire', f.metadata(hash(1)))).value.allowed, false)
  const status = (await f.call('/status')).value
  assert.equal((status.model as { inflight: number }).inflight, 2)
})

test('explicit four/eight/sixteen model pilots work; malformed configuration keeps two actual permits', async () => {
  for (const [limit, expected] of [['4', 4], ['8', 8], ['16', 16], ['17', 2], ['8.0', 2], ['4.0', 2], ['', 2]] as const) {
    const f = fixture({ modelLimit: limit, models: 40 }); await f.start()
    for (let turn = 0; turn < 3; turn++) await f.alarm()
    const results = await Promise.all(Array.from({ length: expected + 1 }, (_, n) => f.call('/acquire', f.metadata(hash(n + 1)))))
    assert.equal(results.filter(r => r.value.allowed).length, expected)
    assert.equal((results.find(r => !r.value.allowed)!.value).reason, 'refill_stage_capacity')
    assert.equal(((await f.call('/status')).value.model as { inflight: number }).inflight, expected)
  }
})

test('larger pilots keep a bounded model prefill and reserve two of the thirty-two outstanding slots for captures', async () => {
  for (const [limit, watermark] of [['8', 16], ['16', 30]] as const) {
    const f = fixture({ modelLimit: limit, models: 80, captures: 20 }); await f.start()
    for (let turn = 0; turn < 5; turn++) await f.alarm()
    const saved = (await f.storage.get<{ outstanding: Record<string, { kind: string }> }>('refill-v1'))!
    assert.equal(Object.values(saved.outstanding).filter(entry => entry.kind === 'model').length, watermark)
    assert.equal(Object.values(saved.outstanding).filter(entry => entry.kind === 'capture').length, 2)
    assert.ok(Object.keys(saved.outstanding).length <= 32)
    assert.ok(f.dispatches.every(batch => batch.ids.length <= 8))
    assert.equal(new Set(f.dispatches.flatMap(batch => batch.ids)).size, watermark + 2)
  }
})

test('maintenance reserve and ordinary model deliveries cannot consume the two protected capture slots', async () => {
  const f = fixture({ modelLimit: '16', models: 80, captures: 0 }); await f.start()
  for (let turn = 0; turn < 4; turn++) await f.alarm()
  for (const id of [2001, 2002]) f.add(id, 'maintain')
  f.setExpansion(false); await f.alarm()
  const model = f.add(500, 'maintain')
  assert.equal((await f.call('/acquire', { jobId: model.jobId })).value.reason, 'refill_dispatch_budget')
  for (const id of [1001, 1002]) {
    const capture = f.add(id, 'capture')
    assert.equal((await f.call('/acquire', { jobId: capture.jobId })).value.allowed, true)
  }
  const saved = (await f.storage.get<{ outstanding: Record<string, { kind: string }> }>('refill-v1'))!
  assert.equal(Object.values(saved.outstanding).filter(entry => entry.kind === 'model').length, 30)
  assert.equal(Object.values(saved.outstanding).filter(entry => entry.kind === 'capture').length, 2)
  assert.equal(Object.keys(saved.outstanding).length, 32)
})

test('a rollback immediately denies new stage permits while keeping all existing owners until actual completion', async () => {
  const f = fixture({ modelLimit: '16', models: 40 }); await f.start()
  for (let turn = 0; turn < 3; turn++) await f.alarm()
  const permits = await Promise.all(Array.from({ length: 16 }, (_, n) => f.call('/acquire', f.metadata(hash(n + 1)))))
  assert.equal(permits.filter(result => result.value.allowed).length, 16)
  f.env.REFILL_MODEL_LIMIT = '4'
  assert.equal((await f.call('/acquire', f.metadata(hash(17)))).value.reason, 'refill_stage_capacity')
  const saved = (await f.storage.get<{ outstanding: Record<string, { permit: unknown }> }>('refill-v1'))!
  assert.equal(Object.values(saved.outstanding).filter(entry => entry.permit).length, 16)
})

test('old ordinary capture messages also respect two real permits when model backlog exists', async () => {
  const f = fixture();
  const results = await Promise.all([1001, 1002, 1003, 1004].map(n => f.call('/acquire', { jobId: hash(n) })))
  assert.equal(results.filter(r => r.value.allowed).length, 2)
  assert.ok(f.counts().selectionCalls > 0)
})

test('capture may borrow idle model slots only when no eligible model backlog exists', async () => {
  const f = fixture({ models: 0 });
  const results = await Promise.all([1001, 1002, 1003, 1004, 1005].map(n => f.call('/acquire', { jobId: hash(n) })))
  assert.equal(results.filter(r => r.value.allowed).length, 4)
})

test('larger model pilots cannot lend more than eight capture execution slots to an empty model lane', async () => {
  const f = fixture({ models: 0, captures: 20, modelLimit: '16' })
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => f.call('/acquire', { jobId: hash(1001 + n) })))
  assert.equal(results.filter(r => r.value.allowed).length, 8)
  assert.equal(results.filter(r => r.value.reason === 'refill_stage_capacity').length, 2)
})

test('an incomplete model proof scan permits two captures without proving idle model slots', async () => {
  const f = fixture({ models: 0 }), select = f.deps.select
  f.deps.select = async (...args) => ({ ...await select(...args), scanRetryAt: new Date(f.now() + 10_000).toISOString() })
  f.restart()
  const results = await Promise.all([1001, 1002, 1003, 1004].map(n => f.call('/acquire', { jobId: hash(n) })))
  assert.equal(results.filter(r => r.value.allowed).length, 2)
  assert.equal((await f.storage.get<{ modelDemand: boolean }>('refill-v1'))!.modelDemand, false)
  assert.equal(f.dispatches.length, 0)
})

test('models disabled still permits two captures without invoking the model selector or provider quota', async () => {
  const f = fixture({ models: 0 }); f.setGate(true, false)
  let selectors = 0, providerChecks = 0
  const gate = f.deps.gate
  f.deps.gate = async (...args) => { if (args[2]) providerChecks++; return gate(...args) }
  f.deps.select = async () => { selectors++; return { fence: null, candidates: [] } }
  f.restart()
  const results = await Promise.all([1001, 1002, 1003].map(n => f.call('/acquire', { jobId: hash(n) })))
  assert.equal(results.filter(r => r.value.allowed).length, 2)
  assert.equal(selectors, 0); assert.equal(providerChecks, 0); assert.equal(f.dispatches.length, 0)
})

test('a scan continuation wakes at least ten seconds later without claiming proven eligibility', async () => {
  for (const delay of [-1000, 500, 30_000]) {
    const f = fixture({ models: 0, captures: 0 })
    let scans = 0
    f.deps.select = async () => { scans++; return { fence: { ...f.fence }, candidates: [], nextDueAt: new Date(f.now() + 3_600_000).toISOString(), scanRetryAt: new Date(f.now() + delay).toISOString() } }
    f.restart(); await f.start()
    assert.equal(f.storage.alarm, f.now() + Math.max(10_000, delay))
    const saved = (await f.storage.get<{ modelDemand: boolean }>('refill-v1'))!
    const status = (await f.call('/status')).value
    assert.equal(saved.modelDemand, false); assert.equal(f.dispatches.length, 0)
    assert.equal((status.model as { eligible: unknown }).eligible, null)
    assert.equal(status.reason, 'no_eligible_work')
    const before = scans
    await f.call('/wake', { reason: 'completion' }); await f.alarm(1000)
    assert.equal(scans, before)
  }
})

test('completion hints cannot release running, expired-lease or unknown model work', async () => {
  const f = fixture(); await f.start()
  const metadata = f.metadata(hash(1)), acquired = (await f.call('/acquire', metadata)).value
  const row = f.rows.get(hash(1))!; row.status = 'running'; row.attempt++; row.leaseToken = 'lease'; row.leaseUntil = new Date(f.now() - 1).toISOString()
  const release = { jobId: hash(1), permitToken: acquired.permitToken }
  assert.equal((await f.call('/release', release)).value.released, false)
  row.status = 'unknown'; row.protectedModel = true
  await f.alarm(120_000)
  assert.equal((await f.call('/release', release)).value.released, false)
  assert.equal((await f.call('/status')).value.uncertainDeliveries, 1)
  row.status = 'done'; row.protectedModel = false
  assert.equal((await f.call('/release', release)).value.released, true)
  assert.equal((await f.call('/acquire', metadata)).value.allowed, false)
})

test('D1 retry state returns capacity even when a pre-send wait restored attempt count', async () => {
  const f = fixture(); await f.start()
  const acquired = (await f.call('/acquire', f.metadata(hash(1)))).value
  const row = f.rows.get(hash(1))!; row.status = 'running'; row.attempt = 1; row.leaseToken = 'actual-lease'
  assert.equal((await f.call('/claimed', { jobId: row.jobId, permitToken: acquired.permitToken, leaseToken: 'wrong' })).value.confirmed, false)
  assert.equal((await f.call('/claimed', { jobId: row.jobId, permitToken: acquired.permitToken, leaseToken: row.leaseToken })).value.confirmed, true)
  row.status = 'retry'; row.attempt = 0; row.updatedAt = new Date(f.now() + 1000).toISOString()
  assert.equal((await f.call('/release', { jobId: row.jobId, permitToken: acquired.permitToken })).value.released, true)
})

test('lost queue-send outcome survives restart and time passage without automatic replay', async () => {
  const f = fixture({ captures: 0 })
  let sends = 0
  f.deps.dispatch = async () => { sends++; throw new Error('queue_reply_lost') }
  f.restart(); await f.start()
  assert.equal(sends, 1)
  f.restart(); await f.alarm(16 * 60_000)
  assert.equal(sends, 1)
  assert.equal((await f.call('/status')).value.uncertainDeliveries, 8)
})

test('epoch changes reject old queue messages, preserve active permits and never reset window charges', async () => {
  const f = fixture(); await f.start()
  const old = f.metadata(hash(1)); await f.call('/acquire', old)
  const row = f.rows.get(hash(1))!; row.status = 'running'; row.attempt++
  const before = ((await f.call('/status')).value.model as { epochUsed: number }).epochUsed
  f.fence.revision++; await f.alarm()
  assert.equal((await f.call('/acquire', old)).value.allowed, false)
  const after = (await f.call('/status')).value.model as { inflight: number; epochUsed: number }
  assert.equal(after.inflight, 1); assert.ok(after.epochUsed >= before)
})

test('a changed timestamp alone cannot prove a same-attempt retry completed', async () => {
  const f = fixture(); await f.start()
  const acquired = (await f.call('/acquire', f.metadata(hash(1)))).value
  const row = f.rows.get(hash(1))!; row.status = 'retry'; row.updatedAt = new Date(f.now() + 1000).toISOString()
  assert.equal((await f.call('/release', { jobId: row.jobId, permitToken: acquired.permitToken })).value.released, false)
})

test('maintenance can use its reserved quota without expansion pending jobs stealing its watermark', async () => {
  const f = fixture(); await f.start(); f.setExpansion(false); f.add(500, 'maintain')
  await f.alarm()
  assert.ok(f.dispatches.find(d => d.ids.includes(hash(500))))
  assert.equal((await f.call('/acquire', f.metadata(hash(1)))).value.allowed, false)
  assert.equal((await f.call('/acquire', f.metadata(hash(500)))).value.allowed, true)
})

test('prepared-before-send recovery uses the same durable token exactly once', async () => {
  const f = fixture({ captures: 0 }); await f.start()
  const saved = await f.storage.get<{ outstanding: Record<string, { phase: string }> }>('refill-v1')
  for (const entry of Object.values(saved!.outstanding)) entry.phase = 'prepared'
  await f.storage.put('refill-v1', saved)
  const originalToken = f.dispatches[0].token; f.dispatches.length = 0
  f.restart(); await f.alarm()
  assert.equal(f.dispatches.length, 1); assert.equal(f.dispatches[0].token, originalToken)
  await f.alarm(); assert.equal(f.dispatches.length, 1)
})

test('only an authoritative not_sent receipt frees a lost-send reservation for new work', async () => {
  const f = fixture({ captures: 0 }); await f.start()
  const dispatch = f.dispatches[0]
  const saved = await f.storage.get<{ outstanding: Record<string, { phase: string }> }>('refill-v1')
  for (const entry of Object.values(saved!.outstanding)) entry.phase = 'uncertain'
  await f.storage.put('refill-v1', saved)
  f.deps.dispatchStatus = async () => ({ entries: dispatch.ids.map(jobId => ({ jobId, status: 'not_sent', epochSha256: dispatch.epoch })) })
  f.restart(); await f.alarm()
  assert.equal(f.dispatches.length, 2); assert.notEqual(f.dispatches[1].token, dispatch.token)
})

test('an exact received-not-started receipt closes sent pending work without rewriting historical model protection', async () => {
  const f = fixture({ captures: 0 }); await f.start()
  const original = f.dispatches[0], row = f.rows.get(hash(1))!
  row.protectedModel = true
  f.deps.dispatchStatus = async () => ({ entries: [{ jobId: row.jobId, status: 'observed', resolution: 'received_not_started',
    receivedNotStartedReceiptSha256: hash(900), epochSha256: original.epoch }] })
  f.restart(); await f.alarm()
  assert.equal(row.status, 'queued'); assert.equal(row.protectedModel, true)
  assert.equal(f.dispatches.flatMap(d => d.ids).filter(id => id === row.jobId).length, 1)
  assert.ok(f.dispatches[1].ids.includes(hash(9)))
})

test('a missing receipt hash or a genuinely unknown job cannot falsely return capacity', async () => {
  for (const unknownJob of [false, true]) {
    const f = fixture({ captures: 0 }); await f.start()
    const original = f.dispatches[0], row = f.rows.get(hash(1))!
    row.protectedModel = true; if (unknownJob) row.status = 'unknown'
    f.deps.dispatchStatus = async () => ({ entries: [{ jobId: row.jobId, status: 'observed', resolution: 'received_not_started',
      receivedNotStartedReceiptSha256: unknownJob ? hash(900) : null, epochSha256: original.epoch }] })
    f.restart(); await f.alarm()
    assert.equal(f.dispatches.length, 1); assert.equal((await f.call('/status')).value.uncertainDeliveries, 1)
    assert.equal(row.protectedModel, true)
  }
})

test('epoch invalidation preserves queued pending work when the D1 decline proof fails', async () => {
  const f = fixture({ captures: 0 }); await f.start()
  f.deps.decline = async () => ({ declined: false, reason: 'refusal_unproven' })
  f.restart(); f.fence.revision++; await f.alarm()
  assert.equal(f.dispatches.length, 1)
  assert.equal((await f.call('/acquire', f.metadata(hash(1)))).value.allowed, false)
  assert.equal(((await f.call('/status')).value.model as { pending: number }).pending, 8)
})

test('a second Durable Object identity is rejected before storage, D1 or dispatch work', async () => {
  const f = fixture()
  const coordinator = new CatalogRefillCoordinator({ storage: f.storage, id: 'wrong-object' }, { ...f.env,
    REFILL_COORDINATOR: { idFromName: () => 'expected-singleton', get: () => { throw new Error('no stub expected') } } }, f.deps)
  const response = await coordinator.fetch(new Request('https://catalog-refill.internal/status', { headers: { authorization: 'Bearer ' + token } }))
  assert.equal(response.status, 409); await coordinator.alarm()
  assert.equal(f.storage.values.size, 0); assert.equal(f.counts().gateCalls, 0); assert.equal(f.dispatches.length, 0)
})

test('the watchdog plans new capture/followup jobs once per window; completion never scans sources', async () => {
  const f = fixture({ models: 0, captures: 0 }); let plans = 0
  f.deps.plan = async () => { plans++ }; f.restart()
  await f.call('/wake', { reason: 'watchdog', planCaptures: true }); await f.alarm()
  assert.equal(plans, 1)
  await f.call('/wake', { reason: 'watchdog', planCaptures: true }); await f.alarm()
  await f.call('/wake', { reason: 'completion' }); await f.alarm()
  assert.equal(plans, 1)
  await f.alarm(15 * 60_000)
  await f.call('/wake', { reason: 'watchdog', planCaptures: true }); await f.alarm()
  assert.equal(plans, 2)
})

test('watchdog capture planning survives an earlier alarm and restart without replaying protected model work', async () => {
  const f = fixture({ models: 1, captures: 0 }), select = f.deps.select
  let plans = 0
  f.deps.select = async (...args) => ({ ...await select(...args), scanRetryAt: new Date(f.now() + 10_000).toISOString() })
  f.deps.plan = async () => { plans++; f.add(1001, 'capture') }
  f.restart(); await f.start()
  const modelId = hash(1), model = f.rows.get(modelId)!
  await f.call('/acquire', f.metadata(modelId))
  model.status = 'unknown'; model.protectedModel = true
  const original = (await f.storage.get<{ outstanding: Record<string, Record<string, unknown>> }>('refill-v1'))!.outstanding[modelId]
  const earlierAlarm = f.storage.alarm!
  f.advance(1000)
  await f.call('/wake', { reason: 'watchdog', planCaptures: true })
  assert.equal(f.storage.alarm, earlierAlarm)
  f.restart(); await f.alarm(earlierAlarm - f.now())
  assert.equal(plans, 1)
  assert.deepEqual(f.dispatches.flatMap(batch => batch.ids), [modelId, hash(1001)])
  const retained = (await f.storage.get<{ outstanding: Record<string, Record<string, unknown>> }>('refill-v1'))!.outstanding[modelId]
  for (const key of ['candidate', 'dispatchToken', 'epochSha256', 'permit']) assert.deepEqual(retained[key], original[key])
  assert.equal(model.status, 'unknown'); assert.equal(model.protectedModel, true)
})

test('repeated watchdogs sharing an earlier alarm plan captures only once in the same window', async () => {
  const f = fixture({ models: 0, captures: 0 })
  let plans = 0
  f.deps.plan = async () => { plans++ }
  f.deps.select = async () => ({ fence: { ...f.fence }, candidates: [], scanRetryAt: new Date(f.now() + 10_000).toISOString() })
  f.restart(); await f.start()
  for (let turn = 0; turn < 3; turn++) {
    const earlierAlarm = f.storage.alarm!
    await f.call('/wake', { reason: 'watchdog', planCaptures: true })
    await f.call('/wake', { reason: 'watchdog', planCaptures: true })
    assert.equal(f.storage.alarm, earlierAlarm)
    f.restart(); await f.alarm(earlierAlarm - f.now())
    assert.equal(plans, 1)
  }
  assert.equal(f.dispatches.length, 0)
})

test('extended dispatch fences compare by current scope/catalog/revision/canary only', async () => {
  const f = fixture(), select = f.deps.select
  f.deps.select = async (...args) => { const plan = await select(...args); return { ...plan, fence: { ...plan.fence!, selectedAt: new Date(f.now()).toISOString(), fairness: { revision: 0 } } } }
  f.restart(); await f.start(); assert.equal(f.dispatches.flatMap(d => d.ids).length, 8)
})

test('real provider quota freshness and maintenance reservation are evaluated after the GET completes', async () => {
  const original = globalThis.fetch, now = Date.now(), start = now - 3_600_000
  let calls = 0, remaining = 93, models = 1
  const cfg = { singleton: 1, scope_sha256: hash(1), input_catalog_sha256: hash(2), revision: 1, canary_json: '[]', enabled: 1, get models_enabled() { return models }, seed_complete: 1, targets_complete: 1 }
  const env = { CONTINUOUS_REFILL_ENABLED: 'true', MAINTENANCE_ENABLED: 'true', MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_SUBSCRIPTION_KEY: 'fake-test-only', SCOPE_REGISTRY_SHA256: hash(1),
    SNAPSHOTS_BUCKET: { get: async () => null }, PIPELINE_DB: { prepare: (sql: string) => ({ first: async () => sql.includes('SELECT * FROM maintenance_control') ? cfg : { present: 1 }, bind() { return this } }) } } as unknown as RefillEnv
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://api.minimax.cn/v1/token_plan/remains'); calls++
    await new Promise(resolve => setTimeout(resolve, 5))
    return Response.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_remaining_percent: remaining, current_interval_status: 1,
      current_weekly_status: 3, start_time: start, end_time: start + 5 * 3_600_000 }] })
  }
  try {
    const full = await readRefillGate(env, now, true)
    assert.equal(full.model, true); assert.equal(full.expansion, true)
    remaining = 15
    const reserved = await readRefillGate(env, Date.now(), true)
    assert.equal(reserved.model, true); assert.equal(reserved.expansion, false)
    remaining = 5
    const exhausted = await readRefillGate(env, Date.now(), true)
    assert.equal(exhausted.model, false); assert.equal(exhausted.capture, true)
    const before = calls; models = 0
    const disabled = await readRefillGate(env, Date.now(), true)
    assert.equal(disabled.capture, true); assert.equal(disabled.model, false); assert.equal(calls, before)
  } finally { globalThis.fetch = original }
})

test('budget/quota waits sleep until retryAt despite a burst of completion notifications', async () => {
  const f = fixture(); f.setGate(false); await f.start()
  const next = f.storage.alarm
  for (let n = 0; n < 30; n++) await f.call('/wake', { reason: 'completion' })
  assert.equal(f.storage.alarm, next)
  const calls = f.counts().gateCalls; await f.alarm(10_000)
  assert.equal(f.counts().gateCalls, calls); assert.equal(f.dispatches.length, 0)
})

test('watchdog repairs an absent alarm without repeating a send', async () => {
  const f = fixture(); await f.start()
  const expected = f.storage.alarm; f.storage.alarm = null
  await f.call('/wake', { reason: 'watchdog' })
  assert.equal(f.storage.alarm, expected); assert.equal(f.dispatches.length, 1)
})

test('window budget bounds sustained dispatch to 256 model and 64 capture jobs', async () => {
  const f = fixture({ models: 400, captures: 100 }); await f.start()
  for (let turn = 0; turn < 65; turn++) {
    for (const dispatch of f.dispatches) for (const id of dispatch.ids) f.rows.get(id)!.status = 'done'
    await f.alarm()
  }
  const sent = f.dispatches.flatMap(d => d.ids)
  assert.equal(sent.filter(id => Number.parseInt(id, 16) < 1000).length, 256)
  assert.equal(sent.filter(id => Number.parseInt(id, 16) >= 1000).length, 64)
  assert.equal(new Set(sent).size, sent.length)
})

test('prepared recovery crossing a window durably recharges before send and cannot yield 264 model sends', async () => {
  const f = fixture({ models: 400, captures: 0 }); await f.start()
  const saved = await f.storage.get<{ outstanding: Record<string, { phase: string; chargeWindow: number }> }>('refill-v1')
  for (const entry of Object.values(saved!.outstanding)) entry.phase = 'prepared'
  await f.storage.put('refill-v1', saved); f.dispatches.length = 0
  const dispatch = f.deps.dispatch
  f.deps.dispatch = async (...args) => {
    const value = await f.storage.get<{ window: number; used: { model: number }; outstanding: Record<string, { chargeWindow: number }> }>('refill-v1')
    for (const candidate of args[2]) assert.equal(value!.outstanding[candidate.jobId].chargeWindow, value!.window)
    assert.ok(value!.used.model <= 256)
    return dispatch(...args)
  }
  f.restart(); await f.alarm(15 * 60_000)
  assert.equal(((await f.call('/status')).value.model as { epochUsed: number }).epochUsed, 8)
  for (let turn = 0; turn < 36; turn++) {
    for (const sent of f.dispatches) for (const id of sent.ids) f.rows.get(id)!.status = 'done'
    await f.call('/wake', { reason: 'completion' }); await f.alarm()
  }
  assert.equal(f.dispatches.flatMap(d => d.ids).length, 256)
  assert.equal(((await f.call('/status')).value.model as { epochUsed: number }).epochUsed, 256)
})

test('a prepared token is never split to use two leftover slots or to bypass an expansion reserve', async () => {
  const f = fixture({ models: 400, captures: 0 }); await f.start()
  const saved = await f.storage.get<{ outstanding: Record<string, { phase: string }> }>('refill-v1')
  for (const entry of Object.values(saved!.outstanding)) entry.phase = 'prepared'
  await f.storage.put('refill-v1', saved); f.dispatches.length = 0
  f.advance(15 * 60_000)
  for (let n = 0; n < 254; n++) {
    const row = f.rows.get(hash(399))!
    row.status = 'queued'
    const permit = (await f.call('/acquire', { jobId: row.jobId })).value
    assert.equal(permit.allowed, true)
    row.status = 'retry'; row.attempt++; row.updatedAt = new Date(f.now() + n + 1).toISOString()
    assert.equal((await f.call('/release', { jobId: row.jobId, permitToken: permit.permitToken })).value.released, true)
  }
  await f.alarm()
  assert.equal(f.dispatches.length, 0)
  const remaining = await f.storage.get<{ outstanding: Record<string, { phase: string }> }>('refill-v1')
  assert.equal(Object.values(remaining!.outstanding).filter(entry => entry.phase === 'prepared').length, 8)
  assert.equal(((await f.call('/status')).value.model as { epochUsed: number }).epochUsed, 254)

  const mixed = fixture({ models: 8, captures: 0 }); mixed.rows.get(hash(1))!.stage = 'maintain'; await mixed.start()
  const original = mixed.dispatches[0]
  const parked = await mixed.storage.get<{ outstanding: Record<string, { phase: string }> }>('refill-v1')
  for (const entry of Object.values(parked!.outstanding)) entry.phase = 'prepared'
  await mixed.storage.put('refill-v1', parked); mixed.dispatches.length = 0
  mixed.setExpansion(false); mixed.add(500, 'maintain'); await mixed.alarm()
  assert.equal(mixed.dispatches.some(sent => sent.token === original.token), false)
  assert.ok(mixed.dispatches.some(sent => sent.ids.includes(hash(500))))
})
