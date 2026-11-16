import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions,Miniflare } from 'miniflare'
import { recheckFixture } from './source-rechecks-fixture'

test('native D1/R2 atomically registers only capture repairs, enforces scope/control CAS and performs zero queue/provider operations',{timeout:30000},async()=>{
  const f=await recheckFixture(5),config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'))as{compatibility_date:string;compatibility_flags?:string[]}
  const nativeDate=(createRequire(import.meta.url)('workerd')as{compatibilityDate:string}).compatibilityDate,compatibilityDate=process.env.MINIFLARE_WORKERD_PATH?config.compatibility_date:[config.compatibility_date,nativeDate].sort()[0]
  const bundled=await build({stdin:{contents:`
    import { registerSourceRechecks } from './source-rechecks'
    import { authorized } from './util'
    import { MaintenanceError } from './types'
    let queues=0,models=0
    export default {async fetch(request,env){
      if(new URL(request.url).pathname==='/test/counts')return Response.json({queues,models})
      if(!authorized(request,env))return Response.json({error:'unauthorized'},{status:401})
      const db={prepare:sql=>env.PIPELINE_DB.prepare(sql),async batch(statements){
        if(request.headers.has('x-test-race'))await env.PIPELINE_DB.prepare('UPDATE maintenance_control SET enabled=0').run()
        return env.PIPELINE_DB.batch(statements)
      }}
      try{return Response.json(await registerSourceRechecks({...env,PIPELINE_DB:db,MAINTENANCE_QUEUE:{async send(){queues++;throw Error('forbidden')}},MODEL_ADMISSION:{idFromName(){models++;throw Error('forbidden')}}},await request.json()))}
      catch(error){return Response.json({error:error instanceof MaintenanceError?error.code:'internal_error'},{status:409})}
    }}
  `,sourcefile:'source-rechecks-native.ts',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'browser',external:['node:crypto'],target:'es2022',write:false})
  let external=0
  const mf=new Miniflare(convertV4MiniflareOptions({name:'source-rechecks-native',modules:true,script:bundled.outputFiles[0].text,compatibilityDate,compatibilityFlags:config.compatibility_flags??[],host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},bindings:{MAINTENANCE_ADMIN_TOKEN:'native-recheck-test-only-1234567890',MAINTENANCE_ENABLED:'true',SCOPE_REGISTRY_SHA256:f.env.SCOPE_REGISTRY_SHA256!},d1Databases:{PIPELINE_DB:'rechecks-native'},r2Buckets:{SNAPSHOTS_BUCKET:'rechecks-native'},outboundService:async()=>{external++;throw Error('external_forbidden')}}))
  try{
    await mf.ready;const db=await mf.getD1Database('PIPELINE_DB')
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
    for(const table of ['maintenance_schools','maintenance_sources','maintenance_source_schools','maintenance_control','maintenance_jobs']){
      const rows=f.db.sqlite.prepare(`SELECT * FROM ${table}${table==='maintenance_schools'?" WHERE university_id='uni-000'":''}`).all()
      if(rows.length)await db.batch(rows.map(row=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row))))
    }
    const headers={authorization:'Bearer native-recheck-test-only-1234567890','content-type':'application/json'},call=(input:unknown,extra:Record<string,string>={})=>mf.dispatchFetch('https://worker/source-rechecks',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(input)})
    assert.equal((await mf.dispatchFetch('https://worker/source-rechecks',{method:'POST',body:JSON.stringify(f.input)})).status,401)
    const first=await call(f.input),body=await first.json()as{registered:boolean;receiptKey:string;error?:string}
    assert.equal(first.status,200,JSON.stringify(body));assert.equal(body.registered,true)
    assert.equal((await call(f.input)).status,200)
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='capture' AND status='queued' AND attempt=0").first('n'),5)
    assert.equal(await db.prepare('SELECT status FROM maintenance_jobs WHERE job_id=?').bind(f.originalJobId).first('status'),'held')
    assert.equal(await db.prepare('SELECT enqueued_at FROM maintenance_jobs WHERE job_id=?').bind(f.originalJobId).first('enqueued_at'),f.original.enqueued_at)
    // Native R2 receipt bytes must be readable and bound to the committed event.
    const ref=await db.prepare("SELECT details_json FROM maintenance_events WHERE kind='official_source_rechecks_registered'").first<string>('details_json');assert.ok(ref)
    const bucket=await mf.getR2Bucket('SNAPSHOTS_BUCKET')as unknown as{get(key:string):Promise<{text():Promise<string>}|null>}
    assert.ok(await bucket.get(body.receiptKey));assert.equal(JSON.parse(ref).objectKey,body.receiptKey)
    // Remove the new unstarted repair only in this local fixture to expose a
    // genuinely new operation to the late-control race, not an early active check.
    await db.prepare("DELETE FROM maintenance_jobs WHERE status='queued'").run()
    const race=await call({...f.input,operationId:'recheck-native-race'},{'x-test-race':'1'})
    assert.equal(race.status,409);assert.equal((await race.json()as{error:string}).error,'source_recheck_commit_conflict')
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_jobs').first('n'),5)
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').first('n'),0)
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first('n'),0)
    assert.deepEqual(await mf.dispatchFetch('https://worker/test/counts').then(r=>r.json()),{queues:0,models:0});assert.equal(external,0)
  }finally{await mf.dispose();f.db.sqlite.close()}
})
