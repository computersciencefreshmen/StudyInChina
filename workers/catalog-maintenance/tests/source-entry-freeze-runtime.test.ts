import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'

const admin = 'native-source-entry-test-only-admin-token'
test('real workerd source HTTP, scheduled and Queue entrances freeze before any background storage or network access', { timeout: 120000 }, async () => {
  const bundled = await build({ stdin: { contents: `
    import worker from './index'
    import { authorized } from './util'
    const counts={d1:0,r2:0,queue:0,ack:0,retries:[],scheduled:0,waitUntil:0,admission:[]}
    const blocked=kind=>()=>{counts[kind]++;throw Error('Frozen source touched background '+kind)}
    export default {async fetch(request,env){
      const frozen={...env,PIPELINE_DB:{prepare:blocked('d1'),batch:blocked('d1')},
        SNAPSHOTS_BUCKET:{get:blocked('r2'),put:blocked('r2'),list:blocked('r2'),delete:blocked('r2')},
        MAINTENANCE_QUEUE:{send:blocked('queue')},MODEL_ADMISSION:{idFromName:name=>name,get:()=>({fetch:async req=>{
          counts.admission.push(new URL(req.url).pathname);return Response.json({ok:true,protocolReached:true})
        }})}}
      const path=new URL(request.url).pathname
      if(path.startsWith('/fixture/')){
        if(!authorized(request,env))return new Response(null,{status:401})
        if(path==='/fixture/queue')await worker.queue({messages:[{body:{version:1,jobId:'a'.repeat(64)},attempts:99,ack:()=>counts.ack++,retry:options=>counts.retries.push(options.delaySeconds)},
          {body:{version:1,discoveryManifestSha256:'b'.repeat(64),discoveryOffset:8},attempts:99,ack:()=>counts.ack++,retry:options=>counts.retries.push(options.delaySeconds)}]},frozen)
        if(path==='/fixture/scheduled')await worker.scheduled({},frozen,{waitUntil:()=>counts.waitUntil++})
        return Response.json(counts)
      }
      return worker.fetch(request,frozen)
    }}
  `, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), sourcefile: 'source-entry-freeze-runtime.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })
  const outbound: string[] = []
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'source-entry-freeze-test', script: bundled.outputFiles[0].text, modules: true,
    compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { MAINTENANCE_ADMIN_TOKEN: admin, MAINTENANCE_ENABLED: 'true', MODEL_STATE_MIGRATION_ROLE: 'source', MODEL_STATE_MIGRATION_ID: 'native-source-freeze-test' },
    outboundService: async request => { outbound.push(request.url); return new WorkerResponse('No external access permitted', { status: 500 }) } }))
  try {
    await mf.ready
    const headers = { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }
    for (const [method, path] of [['POST', '/tick'], ['POST', '/budget/check'], ['POST', '/backend/recheck'], ['POST', '/budget/resume'],
      ['POST', '/controls'], ['POST', '/head-reconcile'], ['GET', '/health'], ['GET', '/status'], ['GET', '/artifacts?key=maintenance/runtime/private.json'],
      ['POST', '/model-state-migration/status'], ['GET', '/model-state-migration/export'], ['GET', '/model-state-migration/status/']]) {
      const response = await mf.dispatchFetch('https://freeze.test' + path, { method, headers, ...(method === 'POST' ? { body: 'not JSON' } : {}) })
      assert.equal(response.status, 503, path); assert.deepEqual(await response.json(), { ok: false, error: 'account_migration_frozen' })
    }
    assert.equal((await mf.dispatchFetch('https://freeze.test/tick', { method: 'POST' })).status, 401)
    const protocol = [
      ['GET', '/model-state-migration/status'], ['GET', '/model-state-migration/gate-inspection'], ['GET', '/model-state-migration/ledger-summary'],
      ['POST', '/model-state-migration/freeze'], ['POST', '/model-state-migration/export'], ['POST', '/model-state-migration/import'],
      ['POST', '/model-state-migration/finalize'], ['POST', '/model-state-migration/non-temporal-fetch-permit-recovery'],
      ['GET', '/model-state-migration/storage-inspection'], ['POST', '/model-state-migration/handoff-operation-recovery'],
    ]
    for (const [method, path] of protocol) {
      const response = await mf.dispatchFetch('https://freeze.test' + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })
      assert.equal(response.status, 200, path); assert.equal((await response.json() as { protocolReached: boolean }).protocolReached, true)
    }
    await mf.dispatchFetch('https://freeze.test/fixture/queue', { headers })
    const stats = await (await mf.dispatchFetch('https://freeze.test/fixture/scheduled', { headers })).json()
    assert.deepEqual(stats, { d1: 0, r2: 0, queue: 0, ack: 0, retries: [3600, 3600], scheduled: 0, waitUntil: 0, admission: protocol.map(([, path]) => path) })
    assert.deepEqual(outbound, [])
  } finally { await mf.dispose() }
})
