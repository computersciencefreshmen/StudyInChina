import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import type { Bucket } from '../src/types'

test('real workerd tick capabilities authenticate and dispatch cannot resume poisoned administrative pointers', { timeout: 30000 }, async () => {
  const bundled = await build({ stdin: { contents: `
    import { handleFetch } from './index'
    let sends = 0
    export default { async fetch(request, env) {
      if (new URL(request.url).pathname === '/test-sends') return Response.json({ sends })
      return handleFetch(request, { ...env, MAINTENANCE_QUEUE: { async send() { sends++ } } })
    } }
  `, sourcefile: 'tick-modes-test-entry.ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', external: ['node:crypto'], target: 'es2022', write: false })
  let egress = 0
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'tick-modes-runtime-test', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, bindings: { MAINTENANCE_ADMIN_TOKEN: 'local-tick-test-not-a-secret', MAINTENANCE_ENABLED: 'true' }, d1Databases: { PIPELINE_DB: 'tick-modes-db' }, r2Buckets: { SNAPSHOTS_BUCKET: 'tick-modes-bucket' }, outboundService: async () => { egress++; return new WorkerResponse('external access forbidden', { status: 502 }) } }))
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB'), bucket = await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as Pick<Bucket,'get'|'put'>
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const sql = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8')
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    for (const key of ['maintenance/scope-upgrades/pending.json', 'maintenance/bootstrap-pending/initial.v1.json', 'maintenance/bootstrap-pending/upload.v1.json']) await bucket.put(key, 'invalid administrative intent must not be interpreted by dispatch')
    const headers = { authorization: 'Bearer local-tick-test-not-a-secret', 'content-type': 'application/json' }
    assert.equal((await mf.dispatchFetch('https://worker/tick')).status, 401)
    const capabilities = await mf.dispatchFetch('https://worker/tick', { headers })
    assert.equal(capabilities.status, 200); assert.deepEqual((await capabilities.json() as { modes: string[] }).modes, ['full', 'dispatch_only', 'administrative_only'])
    const dispatched = await mf.dispatchFetch('https://worker/tick/dispatch', { method: 'POST', headers, body: '{"mode":"dispatch_only"}' })
    assert.equal(dispatched.status, 200)
    const tick = await dispatched.json() as { mode: string; code: string; queued: number; receiptKey: string }
    assert.equal(tick.mode, 'dispatch_only'); assert.equal(tick.code, 'administrative_continuation_required'); assert.equal(tick.queued, 0); assert.ok(await bucket.get(tick.receiptKey))
    assert.equal((await mf.dispatchFetch('https://worker/test-sends').then(r => r.json()) as { sends: number }).sends, 0)
    assert.equal(await db.prepare('SELECT COUNT(*) count FROM maintenance_control').first('count'), 0)
    assert.equal(await db.prepare('SELECT COUNT(*) count FROM maintenance_jobs').first('count'), 0)
    assert.equal(await db.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').first('count'), 0)
    assert.equal(egress, 0)
  } finally { await mf.dispose() }
})
