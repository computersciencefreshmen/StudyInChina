import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'

const admin = 'a'.repeat(64), hash = (n: number) => n.toString(16).padStart(64, '0')

test('native DO storage/serialization and D1 prove bounded stage permits and preserve unknown work', { timeout: 60_000 }, async t => {
  const bundled = await build({ stdin: { resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), sourcefile: 'native-refill-entry.ts', loader: 'ts', contents: `
    import { CatalogRefillCoordinator } from './refill-coordinator'
    const fence = { scopeSha256:'1'.repeat(64),inputCatalogSha256:'2'.repeat(64),revision:1,canaryJson:'[]' }
    export class TestRefill extends CatalogRefillCoordinator {
      constructor(state,env) {
        const latch={blocking:false,entered:null,release:null}
        const jobs = async(_env,ids) => (await env.DB.prepare('SELECT * FROM test_jobs WHERE job_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results.map(row=>({jobId:row.job_id,sourceId:row.source_id,stage:row.stage,status:row.status,attempt:row.attempt,updatedAt:row.updated_at,leaseToken:row.lease_token,leaseUntil:null,protectedModel:row.protected_model===1,inScope:true}))
        super(state,env,{
          now:()=>Date.now(),gate:async()=>({fence,capture:true,model:true,reason:'ready',retryAt:Date.now()}),jobs,
          select:async(_env,input)=>{
            if(latch.blocking){latch.blocking=false;let timer;try{await new Promise(resolve=>{latch.release=resolve;timer=setTimeout(resolve,15000);latch.entered()})}finally{clearTimeout(timer)}}
            return {fence,candidates:(await env.DB.prepare("SELECT * FROM test_jobs WHERE status IN('queued','retry') ORDER BY job_id").all()).results.filter(row=>(row.stage==='capture')===(input.kind==='capture')&&!input.excludeJobIds.includes(row.job_id)).slice(0,input.limit).map(row=>({jobId:row.job_id,sourceId:row.source_id,stage:row.stage,status:row.status,attempt:row.attempt,updatedAt:row.updated_at,enqueuedAt:null,leaseToken:row.lease_token}))}
          },
          dispatch:async(_env,_fence,candidates,input)=>{
            const saved=await state.storage.get('refill-v1')
            for(const row of candidates){if(saved.outstanding[row.jobId].phase!=='sending'||saved.outstanding[row.jobId].dispatchToken!==input.dispatchToken)throw Error('queue_egress_preceded_durable_intent')}
            for(const row of candidates)await env.DB.prepare('INSERT INTO test_sends VALUES(?,?,?)').bind(input.dispatchToken,row.jobId,input.epochSha256).run()
            return {sent:candidates.map(row=>row.jobId),notSent:[],unconfirmed:[]}
          },plan:async()=>null,observe:async()=>true,decline:async()=>({declined:false,reason:'test_no_decline'})
        })
        this.nativeState=state
        this.latch=latch
      }
      async fetch(request) {
        const path=new URL(request.url).pathname
        if(path==='/test/block-select'){
          const saved=await this.nativeState.storage.get('refill-v1');saved.nextRefillAt=null;saved.lastRefillAt=null;await this.nativeState.storage.put('refill-v1',saved)
          this.latch.blocking=true;const entered=new Promise(resolve=>{this.latch.entered=resolve})
          this.pendingAlarm=super.alarm();this.nativeState.waitUntil(this.pendingAlarm);await entered
          return Response.json({selectionBlocked:true})
        }
        if(path==='/test/unblock-select'){this.latch.release();await this.pendingAlarm;return Response.json({released:true})}
        if(path==='/test/persisted-pair')return Response.json({state:await this.nativeState.storage.get('refill-v1'),snapshot:await this.nativeState.storage.get('refill-telemetry-v1')})
        if(new URL(request.url).pathname==='/test/alarm'){
          const saved=await this.nativeState.storage.get('refill-v1')
          if(saved){saved.nextRefillAt=null;saved.lastRefillAt=null;await this.nativeState.storage.put('refill-v1',saved)}
          await super.alarm()
          return super.fetch(new Request('https://catalog-refill.internal/status',{headers:request.headers}))
        }
        return super.fetch(request)
      }
    }
    export default {fetch(request,env){const name=new URL(request.url).pathname==='/test/wrong-object'?'wrong-object':'catalog-refill-v1';return env.REFILL_COORDINATOR.get(env.REFILL_COORDINATOR.idFromName(name)).fetch(request)}}
  ` }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false,
    // This fixture exercises the real coordinator and native DO/D1 bindings.
    // The companion dispatcher has its own native evidence/CAS tests. Egress
    // here is a D1 test receipt, and no real provider/queue resource is present.
    plugins: [{ name: 'isolated-refill-repository', setup(builder) {
      builder.onResolve({ filter: /^\.\/refill-dispatch$/ }, () => ({ path: 'test-only-refill-repository', namespace: 'refill-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'refill-fixture' }, () => ({ contents: 'export const selectRefillCandidates=()=>{throw Error("unexpected_default_selector")};export const dispatchRefillCandidates=()=>{throw Error("unexpected_default_dispatcher")};export const planDueCaptureJobs=()=>{throw Error("unexpected_default_planner")};export const observeRefillDispatch=()=>{throw Error("unexpected_default_observer")};export const readRefillDispatchStatus=async(env,token,options)=>{if(options?.includeJobState!==false)throw Error("redundant_subject_proof_read");await env.DB.prepare("INSERT INTO test_ledger_reads VALUES(0)").run();return {entries:[]}};export const declineRefillDispatch=()=>{throw Error("unexpected_default_decline")}' }))
    } }] })
  let egress = 0
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'native-refill-coordinator', modules: true, script: bundled.outputFiles[0].text,
    // Pinned workerd date; this is native storage/DO verification, not a claim
    // about newer production compatibility flags.
    compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { CONTINUOUS_REFILL_ENABLED: 'true', REFILL_MODEL_LIMIT: '2', MAINTENANCE_ADMIN_TOKEN: admin },
    durableObjects: { REFILL_COORDINATOR: { className: 'TestRefill', useSQLite: true } }, d1Databases: { DB: 'refill-native-db' },
    outboundService: async () => { egress++; return new WorkerResponse('external access forbidden', { status: 502 }) } }))
  try {
    await mf.ready
    assert.equal((await mf.dispatchFetch('https://refill.test/test/wrong-object', { headers: { authorization: 'Bearer ' + admin } })).status, 409)
    const db = await mf.getD1Database('DB'), at = new Date().toISOString()
    await db.prepare('CREATE TABLE test_jobs(job_id TEXT PRIMARY KEY,source_id TEXT,stage TEXT,status TEXT,attempt INTEGER,updated_at TEXT,lease_token TEXT,protected_model INTEGER)').run()
    await db.prepare('CREATE TABLE test_sends(dispatch_token TEXT,job_id TEXT,epoch TEXT,PRIMARY KEY(dispatch_token,job_id))').run()
    await db.prepare('CREATE TABLE test_ledger_reads(include_job_state INTEGER)').run()
    for (let n = 1; n <= 12; n++) await db.prepare("INSERT INTO test_jobs VALUES(?,?,'extract','queued',0,?,NULL,0)").bind(hash(n), hash(n + 100), at).run()
    const call = async (path: string, body?: unknown) => {
      const response = await mf.dispatchFetch('https://refill.test' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      assert.equal(response.status, 200)
      return response.json() as Promise<Record<string, unknown>>
    }
    await call('/wake', { reason: 'watchdog' }); const first = await call('/test/alarm')
    assert.equal((first.model as { pending: number }).pending, 8)
    const sent = (await db.prepare('SELECT * FROM test_sends ORDER BY job_id').all<{ dispatch_token: string; job_id: string; epoch: string }>()).results
    assert.equal(sent.length, 8)
    const permits = await Promise.all(sent.slice(0, 3).map((row:{job_id:string;dispatch_token:string;epoch:string}) => call('/acquire', { jobId: row.job_id, dispatchToken: row.dispatch_token, epochSha256: row.epoch })))
    assert.equal(permits.filter((result:Record<string,unknown>) => result.allowed).length, 2)
    const job = sent[0], permitToken = permits[0].permitToken
    await db.prepare("UPDATE test_jobs SET status='running',attempt=1,lease_token='native-lease' WHERE job_id=?").bind(job.job_id).run()
    assert.equal((await call('/claimed', { jobId: job.job_id, permitToken, leaseToken: 'native-lease' })).confirmed, true)
    assert.equal((await call('/release', { jobId: job.job_id, permitToken })).released, false)
    await db.prepare("UPDATE test_jobs SET status='unknown',protected_model=1 WHERE job_id=?").bind(job.job_id).run()
    assert.equal((await call('/release', { jobId: job.job_id, permitToken })).released, false)
    await call('/test/alarm')
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM test_sends').first('n'), 8)
    assert.equal(await db.prepare('SELECT status FROM test_jobs WHERE job_id=?').bind(job.job_id).first('status'), 'unknown')
    const final = await call('/status')
    assert.equal((final.model as { inflight: number }).inflight, 2); assert.equal(final.uncertainDeliveries, 1)
    assert.equal((await call('/test/block-select', {})).selectionBlocked, true)
    const committed = await call('/test/persisted-pair')
    const saved = committed.state as { outstanding: Record<string, { kind: string; permit: unknown }> }
    const snapshot = committed.snapshot as { model: { inflight: number; pending: number } }
    assert.equal(snapshot.model.inflight, Object.values(saved.outstanding).filter(entry => entry.kind === 'model' && entry.permit !== null).length)
    assert.equal(snapshot.model.pending + snapshot.model.inflight, Object.values(saved.outstanding).filter(entry => entry.kind === 'model').length)
    let acquired = false, timeout: ReturnType<typeof setTimeout> | undefined
    const pending = call('/acquire', { jobId: sent[2].job_id, dispatchToken: sent[2].dispatch_token, epochSha256: sent[2].epoch }).then(result => { acquired = true; return result })
    try {
      const fast = await Promise.race([call('/status'), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(Error('native_status_waited_for_blocked_select')), 3000) })])
      assert.deepEqual(fast, committed.snapshot); assert.equal(acquired, false)
      assert.equal(fast.refillLatencyP95Ms, null); assert.equal(fast.modelTaskBusyPercent, null)
    } finally { if (timeout) clearTimeout(timeout); await call('/test/unblock-select', {}); await pending }
    assert.equal(acquired, true)
    assert.ok(Number(await db.prepare('SELECT COUNT(*) n FROM test_ledger_reads').first('n')) > 0)
    assert.equal(await db.prepare('SELECT SUM(include_job_state) n FROM test_ledger_reads').first('n'), 0)
    assert.equal(egress, 0)
    t.diagnostic('Real native DO storage and D1; 8 durable dispatch receipts, 2 actual stage permits, 0 external egress; unknown row unchanged.')
  } finally { await mf.dispose() }
})
