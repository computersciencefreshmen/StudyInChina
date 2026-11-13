import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import pin from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { BUDGET_OBSERVATION_KEY, BUDGET_POLICY_KEY, budgetCanonicalJson, budgetPolicySha256 } from '../../shared/background-budget'
import { BUDGET_QUEUE_HOLD_PREFIX as pending, BUDGET_QUEUE_HOLD_DONE_PREFIX as done,
  drainBudgetQueueHolds, holdBudgetQueueMessage, isBudgetHoldMessage } from '../src/budget-queue-hold'
import { handleQueue } from '../src/index'
import { runCloudTick } from '../src/runtime'
import type { MaintenanceMessage } from '../src/types'
import { canonical, digest } from '../src/util'
import { makeEnv, MemoryBucket } from './fixture'

const NOW = Date.parse('2026-11-13T12:00:00.000Z')
const discovery = (offset = 0): MaintenanceMessage => ({ version: 1, jobId: 'd'.repeat(64), discoveryManifestSha256: 'd'.repeat(64), discoveryOffset: offset })
const upload: MaintenanceMessage = { version: 1, jobId: pin.targetUpload.sha256, reconciliationTargetsUpload: {
  manifestSha256: pin.sha256, bodySha256: pin.targetUpload.sha256, byteLength: pin.targetUpload.byteLength, expectedRevision: 3,
  uploadKey: `maintenance/reconciliation/${pin.operationId}/target-uploads/${pin.targetUpload.sha256}/01234567-89ab-4cde-8fab-0123456789ab.json` } }
class HoldBucket extends MemoryBucket {
  lists: Array<{ prefix: string; limit: number }> = []
  async list(options: { prefix: string; limit: number }) {
    this.lists.push(options)
    const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix)).sort()
    return { objects: keys.slice(0, options.limit).map(key => ({ key })), truncated: keys.length > options.limit }
  }
  async delete(key: string) { this.objects.delete(key) }
  count(prefix: string) { return [...this.objects.keys()].filter(key => key.startsWith(prefix)).length }
}
async function fixture(t: TestContext, state: 'ready' | 'paused' = 'ready') {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const f = makeEnv(), bucket = new HoldBucket()
  f.env.SNAPSHOTS_BUCKET = bucket
  const policy = { format: 'studyinchina.cloudflare-budget-policy' as const, version: 1 as const,
    accountId: '0123456789abcdef0123456789abcdef', baseMicroDollars: 5000000, totalMicroDollars: 10000000,
    pauseAtMicroDollars: 9000000, maxAgeSeconds: 7200 }
  const sha256 = await budgetPolicySha256(policy)
  await bucket.put(BUDGET_POLICY_KEY, budgetCanonicalJson({ ...policy, sha256 }))
  const observation = { format: 'studyinchina.cloudflare-budget-observation', version: 1, policySha256: sha256, state,
    observedAt: new Date(NOW).toISOString(), periodStart: '2026-11-01T00:00:00Z', periodEnd: null,
    usageMicroDollars: 0, totalMicroDollars: 5000000, code: 'test_budget_observation' }
  await bucket.put(BUDGET_OBSERVATION_KEY, budgetCanonicalJson(observation))
  return { ...f, bucket, observation }
}

test('only exact safe continuation shapes can be held; ordinary jobs and unknown scopes keep legacy retry', async t => {
  const f = await fixture(t)
  try {
    assert.equal(isBudgetHoldMessage(discovery()), true)
    assert.equal(isBudgetHoldMessage(upload), true)
    for (const message of [{ version: 1, jobId: 'a'.repeat(64) }, { ...discovery(), seedSha256: 'a'.repeat(64) },
      { ...discovery(), jobId: 'a'.repeat(64) }, { ...discovery(), discoveryOffset: -1 }, { ...discovery(), discoveryOffset: 0.5 },
      { ...upload, reconciliationTargetsUpload: { ...upload.reconciliationTargetsUpload!, uploadKey: 'maintenance/other.json' } },
      { ...upload, reconciliationTargetsUpload: { ...upload.reconciliationTargetsUpload!, bodySha256: 'e'.repeat(64) } }]) {
      assert.equal(await holdBudgetQueueMessage(f.env, message, NOW), false)
    }
    assert.equal(f.bucket.count(pending), 0)
    const legacy = makeEnv()
    try {
      assert.equal(await holdBudgetQueueMessage(legacy.env, discovery(), NOW), false)
      assert.deepEqual(await drainBudgetQueueHolds(legacy.env), { supported: false, sent: 0, failed: 0, code: 'budget_held_drain_unavailable' })
    } finally { legacy.db.sqlite.close() }
  } finally { f.db.sqlite.close() }
})

test('confirmed pending markers bind the unchanged message hash and a unique hold epoch', async t => {
  const f = await fixture(t)
  try {
    const body = discovery(15)
    assert.equal(await holdBudgetQueueMessage(f.env, body, NOW), true)
    assert.equal(await holdBudgetQueueMessage(f.env, body, NOW), true)
    assert.equal(f.bucket.count(pending), 2)
    const markers = [...f.bucket.objects.keys()].filter(key => key.startsWith(pending))
    const hashes = []
    for (const key of markers) {
      const marker = JSON.parse(await (await f.bucket.get(key))!.text())
      assert.deepEqual(marker.message, body)
      assert.equal(marker.messageSha256, await digest(canonical(body)))
      assert.equal(key, `${pending}${marker.messageSha256}-${marker.holdId}.json`)
      hashes.push(marker.holdId)
    }
    assert.notEqual(hashes[0], hashes[1])
  } finally { f.db.sqlite.close() }
})

test('paused Queue acknowledges only safely persisted special messages before any D1 or model work', async t => {
  const f = await fixture(t, 'paused'), acked: string[] = [], retried: string[] = []
  f.env.PIPELINE_DB = { prepare() { assert.fail('no D1 while budget paused') }, async batch() { assert.fail('no D1 while budget paused') } }
  try {
    const bodies = [discovery(5), upload, { version: 1 as const, jobId: 'e'.repeat(64) }]
    await handleQueue({ messages: bodies.map((body, index) => ({ id: String(index), attempts: 99, body,
      ack() { acked.push(String(index)) }, retry(options) { assert.equal(options?.delaySeconds, 3600); retried.push(String(index)) } })) }, f.env)
    assert.deepEqual(acked, ['0', '1']); assert.deepEqual(retried, ['2'])
    assert.equal(f.bucket.count(pending), 2); assert.equal(f.messages.length, 0)
    assert.equal(f.storage.values.size, 0)
  } finally { f.db.sqlite.close() }
})

for (const mode of ['write-failure', 'lost-write', 'readback-failure'] as const) test(`a ${mode} cannot acknowledge away the original continuation`, async t => {
  const f = await fixture(t, 'paused'), originalPut = f.bucket.put.bind(f.bucket), originalGet = f.bucket.get.bind(f.bucket)
  let ack = 0, retry = 0
  f.bucket.put = async (key, body, options) => {
    if (key.startsWith(pending)) { if (mode === 'write-failure') throw new Error('R2 unavailable'); if (mode === 'lost-write') return null }
    return originalPut(key, body, options)
  }
  f.bucket.get = async key => { if (mode === 'readback-failure' && key.startsWith(pending)) throw new Error('R2 read unavailable'); return originalGet(key) }
  try {
    await handleQueue({ messages: [{ id: 'one', attempts: 4, body: discovery(), ack() { ack++ }, retry() { retry++ } }] }, f.env)
    assert.equal(ack, 0); assert.equal(retry, 1)
  } finally { f.db.sqlite.close() }
})

test('one ready drain lists only its prefix, sends at most eight original messages, confirms receipts, then deletes pending', async t => {
  const f = await fixture(t)
  try {
    for (let i = 0; i < 11; i++) await holdBudgetQueueMessage(f.env, discovery(i * 5), NOW)
    await f.bucket.put('maintenance/frontiers/unrelated.json', '{}')
    const result = await drainBudgetQueueHolds(f.env)
    assert.deepEqual(result, { supported: true, sent: 8, failed: 0, code: 'budget_held_messages_requeued' })
    assert.deepEqual(f.bucket.lists, [{ prefix: pending, limit: 8 }])
    assert.equal(f.messages.length, 8); assert.equal(f.bucket.count(pending), 3); assert.equal(f.bucket.count(done), 8)
    assert.ok(f.messages.every(message => canonical(message) === canonical(discovery(message.discoveryOffset))))
    assert.equal(f.storage.values.size, 0)
  } finally { f.db.sqlite.close() }
})

for (const mode of ['send', 'receipt-write', 'delete'] as const) test(`${mode} failure retains a replayable pending marker and never consumes a model attempt`, async t => {
  const f = await fixture(t), send = f.env.MAINTENANCE_QUEUE.send.bind(f.env.MAINTENANCE_QUEUE), put = f.bucket.put.bind(f.bucket), remove = f.bucket.delete.bind(f.bucket)
  try {
    await holdBudgetQueueMessage(f.env, upload, NOW)
    if (mode === 'send') f.env.MAINTENANCE_QUEUE.send = async () => { throw new Error('queue unavailable') }
    if (mode === 'receipt-write') f.bucket.put = async (key, body, options) => { if (key.startsWith(done)) throw new Error('receipt unavailable'); return put(key, body, options) }
    if (mode === 'delete') f.bucket.delete = async () => { throw new Error('delete unavailable') }
    const failed = await drainBudgetQueueHolds(f.env)
    assert.equal(failed.sent, mode === 'send' ? 0 : 1); assert.equal(failed.failed, 1)
    assert.equal(failed.code, 'budget_held_messages_require_review'); assert.equal(f.bucket.count(pending), 1)
    f.env.MAINTENANCE_QUEUE.send = send; f.bucket.put = put; f.bucket.delete = remove
    assert.equal((await drainBudgetQueueHolds(f.env)).failed, 0)
    assert.equal(f.bucket.count(pending), 0); assert.equal(f.bucket.count(done), 1)
    assert.ok(f.messages.every(message => canonical(message) === canonical(upload)))
    assert.equal(f.storage.values.size, 0)
  } finally { f.db.sqlite.close() }
})

test('a later hold of the same message survives an older drain, including a previous completion receipt', async t => {
  const f = await fixture(t), send = f.env.MAINTENANCE_QUEUE.send.bind(f.env.MAINTENANCE_QUEUE)
  try {
    await holdBudgetQueueMessage(f.env, discovery(10), NOW)
    let heldAgain = false
    f.env.MAINTENANCE_QUEUE.send = async message => {
      await send(message)
      if (!heldAgain) { heldAgain = true; await holdBudgetQueueMessage(f.env, message, NOW + 1) }
    }
    assert.equal((await drainBudgetQueueHolds(f.env)).sent, 1)
    assert.equal(f.bucket.count(pending), 1, 'the new epoch must survive the old deletion')
    assert.equal((await drainBudgetQueueHolds(f.env)).sent, 1)
    await holdBudgetQueueMessage(f.env, discovery(10), NOW + 2)
    assert.equal((await drainBudgetQueueHolds(f.env)).sent, 1, 'a done receipt never rejects another legitimate hold')
    assert.equal(f.bucket.count(done), 3); assert.equal(f.bucket.count(pending), 0)
  } finally { f.db.sqlite.close() }
})

for (const mode of ['invalid-json', 'wrong-hash', 'oversize', 'invalid-done'] as const) test(`${mode} is an explicit bounded review failure, never silently discarded`, async t => {
  const f = await fixture(t)
  try {
    await holdBudgetQueueMessage(f.env, discovery(), NOW)
    const key = [...f.bucket.objects.keys()].find(key => key.startsWith(pending))!
    const marker = JSON.parse(await (await f.bucket.get(key))!.text())
    if (mode === 'invalid-json') await f.bucket.put(key, '{')
    if (mode === 'wrong-hash') await f.bucket.put(key, canonical({ ...marker, message: discovery(5) }))
    if (mode === 'oversize') await f.bucket.put(key, ' '.repeat(4097))
    if (mode === 'invalid-done') await f.bucket.put(`${done}${marker.messageSha256}-${marker.holdId}.json`, '{}')
    const result = await drainBudgetQueueHolds(f.env)
    assert.equal(result.failed, 1); assert.equal(result.sent, mode === 'invalid-done' ? 1 : 0)
    assert.equal(result.code, 'budget_held_messages_require_review'); assert.equal(f.bucket.count(pending), 1)
    assert.equal(f.bucket.lists.length, 1)
  } finally { f.db.sqlite.close() }
})

test('healthy ticks spend their eight dispatch slots on held continuations and leave soak/control/model fields unobserved', async t => {
  const f = await fixture(t)
  f.env.PIPELINE_DB = { prepare() { assert.fail('the recovery tick must not dispatch normal work or mutate controls') }, async batch() { assert.fail('no model/accounting mutations') } }
  try {
    for (let i = 0; i < 10; i++) await holdBudgetQueueMessage(f.env, discovery(i * 5), NOW)
    const tick = await runCloudTick(f.env)
    assert.equal(tick.state, 'running'); assert.equal(tick.code, 'budget_held_messages_requeued'); assert.equal(tick.queued, 8)
    for (const field of ['seedComplete', 'targetsComplete', 'modelsEnabled', 'canarySchoolCount'] as const) assert.equal(tick[field], null)
    assert.equal(f.messages.length, 8); assert.equal(f.bucket.count(pending), 2); assert.equal(f.storage.values.size, 0)
    await f.bucket.put(BUDGET_OBSERVATION_KEY, budgetCanonicalJson({ ...f.observation, state: 'paused' }))
    assert.equal((await runCloudTick(f.env)).state, 'budget_wait')
    assert.equal(f.messages.length, 8); assert.equal(f.bucket.lists.length, 1, 'paused ticks never drain held work')
  } finally { f.db.sqlite.close() }
})

test('a corrupt held marker stops the recovery tick with an explicit error and an honest zero dispatch count', async t => {
  const f = await fixture(t)
  try {
    await holdBudgetQueueMessage(f.env, discovery(), NOW)
    const key = [...f.bucket.objects.keys()].find(key => key.startsWith(pending))!
    await f.bucket.put(key, '{}')
    const tick = await runCloudTick(f.env)
    assert.equal(tick.state, 'error'); assert.equal(tick.code, 'budget_held_messages_require_review'); assert.equal(tick.queued, 0)
    assert.equal(tick.budgetQueueHoldDrain?.failed, 1); assert.equal(f.bucket.count(pending), 1)
  } finally { f.db.sqlite.close() }
})
