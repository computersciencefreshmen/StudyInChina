import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'

const account = '0123456789abcdef0123456789abcdef'
const admin = 'test-only-budget-runtime-admin-not-a-secret'
const billingToken = 'test-only-budget-runtime-billing-not-a-secret'
const billingUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/billable-usage`

test('real workerd and R2 persist actual parsed billing evidence and gate maintenance before D1 or models', { timeout: 120000 }, async t => {
  const bundled = await build({ stdin: {
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts', sourcefile: 'budget-runtime-entry.ts',
    contents: `
      import { handleFetch, handleQueue } from './index'
      import { ModelAdmission } from './admission'
      import { holdBudgetQueueMessage, drainBudgetQueueHolds, BUDGET_QUEUE_HOLD_PREFIX, BUDGET_QUEUE_HOLD_DONE_PREFIX } from './budget-queue-hold'
      import { digest } from './util'
      const metrics = { d1: 0, queueSends: 0 }
      let allowQueue = false
      const sent = []
      function trackedEnv(env, counters = metrics) {
        return { ...env, PIPELINE_DB: {
          prepare(sql) { counters.d1++; return env.PIPELINE_DB.prepare(sql) },
          batch(statements) { counters.d1++; return env.PIPELINE_DB.batch(statements) }
        }, MAINTENANCE_QUEUE: { async send(message) {
          counters.queueSends++
          if (!allowQueue) throw new Error('Unexpected queue send in budget test')
          sent.push(structuredClone(message))
        } } }
      }
      // The production DO implementation executes unchanged, with native DO
      // storage and R2. This wrapper only counts/delegates real D1 accesses.
      export class BudgetRuntimeAdmission extends ModelAdmission {
        constructor(state, env) {
          const counters = { d1: 0, queueSends: 0 }
          super(state, trackedEnv(env, counters))
          this.counters = counters
        }
        async fetch(request) {
          if (new URL(request.url).pathname === '/test/metrics') return Response.json(this.counters)
          return super.fetch(request)
        }
      }
      export default { async fetch(request, env) {
        const url = new URL(request.url), checked = trackedEnv(env)
        if (url.pathname === '/test/metrics') return Response.json(metrics)
        if (url.pathname === '/test/artifact') {
          const object = await env.SNAPSHOTS_BUCKET.get(url.searchParams.get('key'))
          return object ? new Response(await object.text(), { headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 404 })
        }
        if (url.pathname === '/test/hold') {
          const value = await request.json()
          if (await digest(value.frontierText) !== value.message.discoveryManifestSha256) throw new Error('Test frontier hash mismatch')
          await env.SNAPSHOTS_BUCKET.put('maintenance/frontiers/' + value.message.discoveryManifestSha256 + '.json', value.frontierText)
          const held = await holdBudgetQueueMessage(checked, value.message)
          const page = await env.SNAPSHOTS_BUCKET.list({ prefix: BUDGET_QUEUE_HOLD_PREFIX, limit: 8 })
          return Response.json({ held, pendingKeys: page.objects.map(object => object.key) })
        }
        if (url.pathname === '/test/drain-holds') {
          allowQueue = true
          const result = await drainBudgetQueueHolds(checked)
          const pending = await env.SNAPSHOTS_BUCKET.list({ prefix: BUDGET_QUEUE_HOLD_PREFIX, limit: 8 })
          const done = await env.SNAPSHOTS_BUCKET.list({ prefix: BUDGET_QUEUE_HOLD_DONE_PREFIX, limit: 8 })
          return Response.json({ result, sent, metrics, pendingKeys: pending.objects.map(object => object.key), doneKeys: done.objects.map(object => object.key) })
        }
        if (url.pathname === '/test/model' || url.pathname === '/test/model-metrics') {
          const stub = env.MODEL_ADMISSION.get(env.MODEL_ADMISSION.idFromName('test-budget-account'))
          const path = url.pathname === '/test/model' ? '/model/run' : '/test/metrics'
          return stub.fetch(new Request('https://admission.internal' + path, request))
        }
        if (url.pathname === '/test/queue') {
          const retries = [], acknowledgements = []
          await handleQueue({ messages: ['one', 'two'].map(id => ({ id, body: { version: 1, jobId: id }, attempts: 1,
            retry(options) { retries.push(options.delaySeconds) }, ack() { acknowledgements.push(id) }
          })) }, checked)
          return Response.json({ retries, acknowledgements })
        }
        return handleFetch(request, checked)
      } }
    `,
  }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })
  const calls: Array<{ url: string; method: string }> = []
  const billing = { usage: 4 }
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'maintenance-budget-runtime-test', script: bundled.outputFiles[0].text, modules: true,
    // Match the workerd version already pinned by the lockfile. This tests its
    // real fetch/R2/DO behavior without claiming production-date feature parity.
    compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { MAINTENANCE_ADMIN_TOKEN: admin, CLOUDFLARE_BILLING_READ_TOKEN: billingToken,
      MAINTENANCE_ENABLED: 'true', MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_SUBSCRIPTION_KEY: 'test-only-no-model-key' },
    d1Databases: { PIPELINE_DB: 'budget-runtime-empty-database' },
    r2Buckets: { SNAPSHOTS_BUCKET: 'budget-runtime-snapshots' },
    durableObjects: { MODEL_ADMISSION: { className: 'BudgetRuntimeAdmission', useSQLite: true } },
    outboundService: async request => {
      calls.push({ url: request.url, method: request.method })
      // Every destination is intercepted. There is no fallback to the Internet.
      if (request.url !== billingUrl || request.method !== 'GET') return new WorkerResponse(null, { status: 500 })
      assert.equal(request.headers.get('authorization'), `Bearer ${billingToken}`)
      const now = Date.now(), period = new Date(now - 2 * 86400000).toISOString()
      return WorkerResponse.json({ success: true, errors: [], result: [{ BillingAccountId: account, BillingCurrency: 'USD',
        BillingPeriodStart: period, ChargeCategory: 'Usage', ChargeDescription: 'Test-only Workers requests',
        ChargePeriodStart: period, ChargePeriodEnd: new Date(now - 86400000).toISOString(),
        ServiceName: 'Workers Standard', PricingUnit: 'Requests', ConsumedUnit: 'Requests',
        ContractedCost: billing.usage, CumulatedContractedCost: 9999 }] })
    },
  }))
  async function send(path: string, body?: unknown) {
    return mf.dispatchFetch(`https://budget-runtime.test${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  }
  async function blocked(state: 'unknown' | 'paused') {
    const beforeCalls = calls.length
    const tick = await send('/tick', {})
    assert.equal(tick.status, 200)
    assert.equal((await tick.json() as { state: string }).state, 'budget_wait')
    const status = await (await send('/status')).json() as { backend: { state: string }; budget: { allowed: boolean; state: string }; control: unknown }
    assert.equal(status.backend.state, 'budget_wait')
    assert.deepEqual({ allowed: status.budget.allowed, state: status.budget.state }, { allowed: false, state })
    assert.equal(status.control, null)
    for (const path of ['/targets', '/exports']) {
      const response = await send(path, {})
      assert.equal(response.status, 503)
      assert.equal((await response.json() as { error: string }).error, 'budget_wait')
    }
    // Execute the actual production batch handler inside workerd; callbacks let
    // us observe its retry contract without starting a persistent queue timer.
    const queue = await send('/test/queue', {})
    assert.deepEqual(await queue.json(), { retries: [3600, 3600], acknowledgements: [] })
    const model = await send('/test/model', { reservationKey: '1'.repeat(64), sourceId: '2'.repeat(64), snapshotSha256: '3'.repeat(64),
      universityIds: ['runtime-school'], pass: 'primary', lane: 'expansion', payload: 'Never send to a real model.' })
    assert.equal(model.status, 429)
    assert.equal((await model.json() as { error: string }).error, 'budget_wait')
    assert.equal((await send('/health')).status, 200)
    assert.deepEqual(await (await send('/test/metrics')).json(), { d1: 0, queueSends: 0 })
    assert.deepEqual(await (await send('/test/model-metrics')).json(), { d1: 0, queueSends: 0 })
    assert.equal(calls.length, beforeCalls, 'blocked admissions must not query billing or a model')
  }
  try {
    await mf.ready
    // No migrations or seeded records: accidental D1 work cannot be hidden by a
    // permissive database fixture, and every attempted query is counted above.
    await t.test('configured but unobserved costs gate HTTP, native DO and the queue handler with real R2', async () => {
      const response = await send('/budget', { accountId: account, baseUsd: 5, targetUsd: 10, pauseAtUsd: 9 })
      assert.equal(response.status, 200)
      assert.equal((await response.json() as { allowed: boolean }).allowed, false)
      await blocked('unknown')
      assert.equal(calls.length, 0)
    })
    await t.test('global fetch receives a fake official HTTP200 and persists the parsed threshold receipt in real R2', async () => {
      const response = await send('/budget/check', {})
      assert.equal(response.status, 200)
      const result = await response.json() as { state: string; allowed: boolean; cached: boolean; receiptKey: string; receiptSha256: string }
      assert.equal(result.state, 'paused')
      assert.equal(result.allowed, false)
      assert.equal(result.cached, false)
      assert.deepEqual(calls, [{ url: billingUrl, method: 'GET' }])
      const saved = await send(`/test/artifact?key=${encodeURIComponent(result.receiptKey)}`)
      assert.equal(saved.status, 200)
      const text = await saved.text(), receipt = JSON.parse(text)
      assert.equal(createHash('sha256').update(text).digest('hex'), result.receiptSha256)
      assert.equal(receipt.usageMicroDollars, 4000000)
      assert.equal(receipt.totalMicroDollars, 9000000)
      assert.equal(receipt.periodEnd, null)
      assert.equal(receipt.state, 'paused')
      const latest = await send('/test/artifact?key=maintenance/runtime/cloudflare-budget-observation.v1.json')
      assert.equal(await latest.text(), text)
      const serialized = JSON.stringify(result)
      for (const privateValue of [account, billingToken, 'usageMicroDollars', 'totalMicroDollars']) assert.equal(serialized.includes(privateValue), false)
      assert.equal((await (await send('/budget/check', {})).json() as { cached: boolean }).cached, true)
      assert.equal(calls.length, 1)
    })
    await t.test('persisted budget pause keeps native DO and HTTP admission closed without D1 or MiniMax requests', async () => {
      await blocked('paused')
    })
    await t.test('native R2 hold/list/drain/done/delete preserves an exact discovery continuation without D1 or model work', { timeout: 30000 }, async () => {
      const frontierText = JSON.stringify({ version: 1, sourceId: 'a'.repeat(64), sourceUrl: 'https://runtime-test.edu.cn/catalog',
        rawSha256: 'b'.repeat(64), depth: 0, allowedHosts: ['runtime-test.edu.cn'], missed: [],
        links: Array.from({ length: 6 }, (_, index) => ({ url: `https://runtime-test.edu.cn/program/${index}`,
          category: 'program_detail', label: `Programme ${index}`, priority: 2 })) })
      const sha256 = createHash('sha256').update(frontierText).digest('hex')
      const message = { version: 1, jobId: sha256, discoveryManifestSha256: sha256, discoveryOffset: 5 }
      const original = JSON.stringify(message)
      const heldResponse = await send('/test/hold', { frontierText, message })
      assert.equal(heldResponse.status, 200)
      const held = await heldResponse.json() as { held: boolean; pendingKeys: string[] }
      assert.equal(held.held, true)
      assert.equal(held.pendingKeys.length, 1)
      const marker = await (await send(`/test/artifact?key=${encodeURIComponent(held.pendingKeys[0])}`)).json() as {
        message: unknown; messageSha256: string; holdId: string
      }
      assert.deepEqual(marker.message, message)
      // Restore permission through the actual budget controller, with a fresh
      // fake official read. The hold primitive itself does not bypass that gate.
      billing.usage = 1
      const resume = await send('/budget/resume', { reason: 'operator-confirmed-budget-resume' })
      assert.equal(resume.status, 200)
      assert.equal((await resume.json() as { allowed: boolean }).allowed, true)
      const drainedResponse = await send('/test/drain-holds', {})
      assert.equal(drainedResponse.status, 200)
      const drained = await drainedResponse.json() as { result: { supported: boolean; sent: number; failed: number; code: string };
        sent: unknown[]; metrics: { d1: number; queueSends: number }; pendingKeys: string[]; doneKeys: string[] }
      assert.deepEqual(drained.result, { supported: true, sent: 1, failed: 0, code: 'budget_held_messages_requeued' })
      assert.deepEqual(drained.sent, [message])
      assert.equal(JSON.stringify(message), original)
      assert.deepEqual(drained.metrics, { d1: 0, queueSends: 1 })
      assert.deepEqual(drained.pendingKeys, [])
      assert.equal(drained.doneKeys.length, 1)
      const receipt = await (await send(`/test/artifact?key=${encodeURIComponent(drained.doneKeys[0])}`)).json() as {
        holdId: string; messageSha256: string; pendingKey: string
      }
      assert.equal(receipt.holdId, marker.holdId)
      assert.equal(receipt.messageSha256, marker.messageSha256)
      assert.equal(receipt.pendingKey, held.pendingKeys[0])
      assert.equal((await send(`/test/artifact?key=${encodeURIComponent(held.pendingKeys[0])}`)).status, 404)
      const again = await (await send('/test/drain-holds', {})).json() as { result: { sent: number }; sent: unknown[] }
      assert.equal(again.result.sent, 0)
      assert.deepEqual(again.sent, [message])
      assert.deepEqual(await (await send('/test/model-metrics')).json(), { d1: 0, queueSends: 0 })
      assert.equal(calls.length, 2)
      assert.ok(calls.every(call => call.url === billingUrl && call.method === 'GET'))
    })
  } finally { await mf.dispose() }
})
