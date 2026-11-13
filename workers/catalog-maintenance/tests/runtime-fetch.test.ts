import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import type { ModelRequest, ModelResult } from '../src/types'
import { TERMINAL_QUARANTINE_POLICY } from '../src/reviewed-terminal-quarantine'

const sourceId = 'd'.repeat(64), snapshotSha256 = 'e'.repeat(64), scope = 'a'.repeat(64)
const adminToken = 'runtime-test-admin-token-not-a-real-secret'
const subscriptionKey = 'runtime-test-subscription-not-a-real-key'
const quotaUrl = 'https://api.minimax.cn/v1/token_plan/remains'
const modelUrl = 'https://api.minimaxi.com/anthropic/v1/messages'
const redirectUrl = 'https://credential-recipient.invalid/never-follow'

// The production functions run with workerd's global fetch, not an injected
// Node fetch double. Miniflare intercepts all egress below, including unexpected
// redirect destinations, so no provider or real model is contacted.
async function runtimeFixture() {
  const bundled = await build({
    stdin: {
      contents: `
        import { ModelAdmission, readQuotaProvider } from './admission'
        export { ModelAdmission }
        export default {
          async fetch(request, env) {
            const path = new URL(request.url).pathname
            if (path === '/old-redirect-mode') {
              try {
                await fetch('${quotaUrl}', { redirect: 'error' })
                return Response.json({ threw: false })
              } catch (error) {
                return Response.json({ threw: true, name: error.name })
              }
            }
            if (path === '/old-fetch-receiver') {
              try {
                const holder = { fetcher: fetch }
                await holder.fetcher('${modelUrl}', { method: 'POST', redirect: 'manual', body: '{}' })
                return Response.json({ threw: false })
              } catch (error) {
                return Response.json({ threw: true, name: error.name, illegalInvocation: error.message.includes('Illegal invocation') })
              }
            }
            if (path === '/quota') return Response.json(await readQuotaProvider(env))
            if (path === '/artifact') {
              const object = await env.SNAPSHOTS_BUCKET.get(new URL(request.url).searchParams.get('key'))
              return Response.json(JSON.parse(await object.text()))
            }
            if (path === '/model') {
              const id = env.MODEL_ADMISSION.idFromName('runtime-test-account')
              return env.MODEL_ADMISSION.get(id).fetch(new Request('https://admission.internal/model/run', request))
            }
            return new Response('not found', { status: 404 })
          }
        }
      `,
      resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
      sourcefile: 'runtime-fetch-entry.ts',
      loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
  })
  const calls: Array<{ url: string; method: string; authorization: string | null; body: string }> = []
  const provider = { quotaRedirect: 0, modelRedirect: 0, redirectLocation: redirectUrl }
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'maintenance-runtime-fetch-test', modules: true, script: bundled.outputFiles[0].text,
    // The lockfile's local workerd supports dates through 2026-09-18. Its real
    // Request implementation reproduces the unsupported redirect:error defect;
    // this transport test does not claim production-date feature parity.
    compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: {
      MAINTENANCE_ADMIN_TOKEN: adminToken, MINIMAX_SUBSCRIPTION_KEY: subscriptionKey,
      MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_ANTHROPIC_BASE: 'https://api.minimaxi.com/anthropic',
      MINIMAX_CREDIT_FALLBACK_DISABLED: 'false', MAINTENANCE_ENABLED: 'true',
      // Native reconciliation is independently tested. This isolated transport
      // fixture explicitly uses the supported deployment opt-out, without a fake
      // resume receipt or any change to the production guard.
      NATIVE_HEAD_RECONCILIATION_REQUIRED: 'false', SCOPE_REGISTRY_SHA256: scope,
    },
    d1Databases: { PIPELINE_DB: 'runtime-fetch-test-db' },
    r2Buckets: { SNAPSHOTS_BUCKET: 'runtime-fetch-test-snapshots' },
    durableObjects: { MODEL_ADMISSION: { className: 'ModelAdmission', useSQLite: true } },
    outboundService: async request => {
      const body = await request.text()
      calls.push({ url: request.url, method: request.method, authorization: request.headers.get('authorization'), body })
      if (request.url === quotaUrl) {
        if (provider.quotaRedirect) return new WorkerResponse(null, { status: provider.quotaRedirect, headers: { location: provider.redirectLocation } })
        const now = Date.now(), hour = 3600000
        return WorkerResponse.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general',
          current_interval_status: 1, current_interval_remaining_percent: 80, start_time: now - hour, end_time: now + 4 * hour,
          current_weekly_status: 3,
        }] })
      }
      if (request.url === modelUrl) {
        if (provider.modelRedirect) return new WorkerResponse(null, { status: provider.modelRedirect, headers: { location: provider.redirectLocation } })
        return WorkerResponse.json({ content: [{ type: 'text', text: '{"evidence":"test-only"}' }],
          stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      }
      // A redirect following regression is recorded and fails the assertions;
      // this handler never falls back to real outbound networking.
      return new WorkerResponse('unexpected test destination', { status: 500 })
    },
  }))
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB')
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const sql = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8')
      // D1.exec treats each input line as a statement. Keep the actual checked-in
      // multiline schema, preparing each complete migration statement instead.
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    await db.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
      enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,?,?,?,?,1,1,1,1,'[]',?)`)
      .bind(scope, 'b'.repeat(64), 'c'.repeat(64), 'f'.repeat(64), new Date().toISOString()).run()
    await db.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?,?,?,?)')
      .bind('runtime-school', '{"en":"Runtime Test School"}', '{}', scope).run()
    await db.prepare(`INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256)
      VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?)`)
      .bind(sourceId, 'https://runtime-test.edu.cn/catalog', '["runtime-test.edu.cn"]', new Date().toISOString(), snapshotSha256, 'f'.repeat(64)).run()
    await db.prepare('INSERT INTO maintenance_source_schools(source_id,university_id) VALUES(?,?)').bind(sourceId, 'runtime-school').run()
    return { mf, db, calls, provider }
  } catch (error) { await mf.dispose(); throw error }
}

function modelRequest(reservationKey: string): ModelRequest {
  return { reservationKey, sourceId, snapshotSha256, universityIds: ['runtime-school'],
    pass: 'primary', lane: 'expansion', payload: 'Test-only official evidence; no real model call.' }
}
function runModel(mf: Miniflare, input: ModelRequest) {
  return mf.dispatchFetch('https://runtime.test/model', { method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })
}

test('real workerd permanently rejects quarantined sources and canonical-text aliases before any provider or SQL attempt', { timeout: 120000 }, async () => {
  const { mf, db, calls } = await runtimeFixture()
  try {
    const subject = TERMINAL_QUARANTINE_POLICY.jobs[0]
    await db.prepare('UPDATE maintenance_sources SET canonical_sha256=? WHERE source_id=?').bind(subject.textSha256, sourceId).run()
    for (const [index, pass] of ['primary', 'independent-review'].entries()) {
      const input = { ...modelRequest(String(index + 5).repeat(64)), pass, payload: JSON.stringify({ newContract: index, callerTextSha256: '0'.repeat(64) }) } as ModelRequest
      const response = await runModel(mf, input)
      assert.equal(response.status, 409); assert.equal((await response.json() as { error: string }).error, 'terminal_quarantine_no_replay')
    }
    await db.prepare('INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,?,?,\'undergraduate_catalog\',1,24,?)')
      .bind(subject.job.source_id, subject.sourceUrl, JSON.stringify([new URL(subject.sourceUrl).hostname]), new Date().toISOString()).run()
    await db.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').bind(subject.job.source_id, 'runtime-school').run()
    const original = await runModel(mf, { ...modelRequest('7'.repeat(64)), sourceId: subject.job.source_id, snapshotSha256: '0'.repeat(64) })
    assert.equal((await original.json() as { error: string }).error, 'terminal_quarantine_no_replay')
    assert.equal(calls.length, 0)
    const attempts = await db.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').first()
    assert.equal(attempts?.count, 0)
  } finally { await mf.dispose() }
})

test('real workerd fetch admits supported manual requests and refuses credentialed redirects', { timeout: 120000 }, async t => {
  const { mf, db, calls, provider } = await runtimeFixture()
  try {
    await t.test('old redirect:error throws TypeError before any outbound request', async () => {
      const start = calls.length
      const response = await mf.dispatchFetch('https://runtime.test/old-redirect-mode')
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { threw: true, name: 'TypeError' })
      assert.equal(calls.length, start)
    })
    await t.test('production quota reader reaches the official endpoint through workerd global fetch', async () => {
      const start = calls.length
      const response = await mf.dispatchFetch('https://runtime.test/quota')
      const result = await response.json() as { payload: { base_resp: { status_code: number } }; transport: unknown }
      assert.deepEqual(result.transport, { state: 'received', httpStatus: 200, reason: null })
      assert.equal(result.payload.base_resp.status_code, 0)
      assert.deepEqual(calls.slice(start).map(({ url, method, authorization }) => ({ url, method, authorization })),
        [{ url: quotaUrl, method: 'GET', authorization: `Bearer ${subscriptionKey}` }])
    })
    await t.test('old native fetch property call throws illegal invocation before any outbound request', async () => {
      const start = calls.length
      const response = await mf.dispatchFetch('https://runtime.test/old-fetch-receiver')
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { threw: true, name: 'TypeError', illegalInvocation: true })
      assert.equal(calls.length, start)
    })
    for (const status of [301, 302, 303, 307, 308]) await t.test(`quota HTTP ${status} is rejected without forwarding its credential`, async () => {
      provider.quotaRedirect = status
      provider.redirectLocation = status === 301 ? `${quotaUrl}?unexpected=1` : redirectUrl
      const start = calls.length
      const result = await (await mf.dispatchFetch('https://runtime.test/quota')).json() as { payload: unknown; transport: { state: string; httpStatus: number; reason: string } }
      assert.equal(result.payload, null)
      assert.equal(result.transport.httpStatus, status)
      assert.notEqual(result.transport.state, 'received')
      assert.equal(result.transport.reason, 'redirect_or_url_mismatch')
      assert.deepEqual(calls.slice(start).map(call => call.url), [quotaUrl])
      provider.quotaRedirect = 0
      provider.redirectLocation = redirectUrl
    })
    await t.test('real DO admission completes a fake model POST, saves its artifact and reuses the reservation', async () => {
      const input = modelRequest('1'.repeat(64)), start = calls.length
      const response = await runModel(mf, input)
      const result = await response.json() as { ok: boolean } & ModelResult
      assert.equal(response.status, 200, JSON.stringify(result))
      assert.equal(result.ok, true)
      assert.deepEqual(result.output, { evidence: 'test-only' })
      assert.deepEqual(calls.slice(start).map(call => [call.url, call.method]), [[quotaUrl, 'GET'], [modelUrl, 'POST']])
      const post = calls.at(-1)!
      assert.equal(post.authorization, `Bearer ${subscriptionKey}`)
      assert.equal(JSON.parse(post.body).model, 'MiniMax-M3')
      const attempt = await db.prepare('SELECT status,output_key FROM maintenance_model_attempts WHERE reservation_key=?').bind(input.reservationKey).first()
      assert.equal(attempt?.status, 'completed')
      assert.equal(attempt?.output_key, result.artifactKey)
      const artifact = await mf.dispatchFetch(`https://runtime.test/artifact?key=${encodeURIComponent(result.artifactKey)}`)
      assert.deepEqual((await artifact.json() as { output: unknown }).output, result.output)
      const count = calls.length, repeated = await runModel(mf, input)
      assert.equal(repeated.status, 200)
      assert.equal((await repeated.json() as ModelResult).reused, true)
      assert.equal(calls.length, count)
    })
    for (const status of [302, 307, 308]) await t.test(`model HTTP ${status} cannot follow Location or publish a successful result`, async () => {
      provider.modelRedirect = status
      provider.redirectLocation = status === 302 ? modelUrl.replace('/messages', '/unexpected') : redirectUrl
      const input = modelRequest(String(status === 302 ? 2 : status === 307 ? 3 : 4).repeat(64)), start = calls.length
      const response = await runModel(mf, input)
      assert.notEqual(response.status, 200)
      const result = await response.json() as { ok: boolean; error: string; output?: unknown }
      assert.equal(result.ok, false)
      assert.equal(result.error, 'model_outcome_unknown')
      assert.equal(result.output, undefined)
      assert.deepEqual(calls.slice(start).map(call => call.url), [quotaUrl, modelUrl], JSON.stringify(result))
      const attempt = await db.prepare('SELECT status,output_key FROM maintenance_model_attempts WHERE reservation_key=?').bind(input.reservationKey).first()
      assert.equal(attempt?.status, 'unknown')
      assert.equal(attempt?.output_key, null)
      const count = calls.length
      const repeated = await runModel(mf, input)
      assert.equal(repeated.status, 409)
      assert.deepEqual(await repeated.json(), { ok: false, error: 'prior_model_outcome_requires_review' })
      assert.equal(calls.length, count, 'a redirected reservation must not silently retry the model')
      provider.modelRedirect = 0
      provider.redirectLocation = redirectUrl
    })
    assert.equal(calls.every(call => call.url === quotaUrl || call.url === modelUrl), true)
  } finally { await mf.dispose() }
})
