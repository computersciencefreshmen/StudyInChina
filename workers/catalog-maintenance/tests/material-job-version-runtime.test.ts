import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions,Miniflare } from 'miniflare'

test('native D1 validates fresh, retained and malformed contracts and atomically rejects version races without provider calls',{timeout:30000},async()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'))as{compatibility_date:string;compatibility_flags?:string[]},nativeDate=(createRequire(import.meta.url)('workerd')as{compatibilityDate:string}).compatibilityDate
  const bundled=await build({stdin:{contents:`
    import { materialJobVersion,materialJobVersionGuard } from './material-job-version'
    import { MaintenanceError } from './types'
    export default {async fetch(request,env){
      const {sourceId,raw,engine,expected}=await request.json()
      try{
        if(expected===undefined)return Response.json({version:await materialJobVersion(env,sourceId,raw,engine)})
        await env.PIPELINE_DB.batch([materialJobVersionGuard(env,'native-version',sourceId,raw,engine,expected),env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind('native-version')])
        return Response.json({guarded:true})
      }catch(error){return Response.json({error:error instanceof MaintenanceError?error.code:String(error).includes('Expression tree')?'native_depth_limit':'version_guard_conflict'},{status:409})}
    }}
  `,sourcefile:'material-version-native.ts',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'browser',external:['node:crypto'],target:'es2022',write:false})
  let outbound=0
  const mf=new Miniflare(convertV4MiniflareOptions({name:'material-version-native',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:process.env.MINIFLARE_WORKERD_PATH?config.compatibility_date:[config.compatibility_date,nativeDate].sort()[0],compatibilityFlags:config.compatibility_flags??[],host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},bindings:{MODEL_BATCH_CONTRACT_VERSION:'2'},d1Databases:{PIPELINE_DB:'material-version'},outboundService:async()=>{outbound++;throw Error('external_forbidden')}}))
  try{
    await mf.ready;const db=await mf.getD1Database('PIPELINE_DB')
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
    const sourceId='a'.repeat(64),raw='b'.repeat(64),now=new Date().toISOString()
    await db.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,'https://test.edu.cn/catalog','[\"test.edu.cn\"]','current_guide',1,168,?)").bind(sourceId,now).run()
    const call=(engine:string,expected?:number)=>mf.dispatchFetch('https://worker/version',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceId,raw,engine,...(expected===undefined?{}:{expected})})})
    for(const engine of ['program','scholarship','fields','cycles']){
      assert.deepEqual(await call(engine).then(r=>r.json()),{version:2})
      const guarded=await call(engine,2);assert.equal(guarded.status,200,JSON.stringify(await guarded.json()))
    }
    await db.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,target_ids_json) VALUES('legacy-cycle',?,'maintain','done',?,?,?,?,?)").bind(sourceId,now,now,now,raw,JSON.stringify({kind:'cycle-discovery',targets:[]})).run()
    assert.deepEqual(await call('cycles').then(r=>r.json()),{version:1});assert.deepEqual(await call('fields').then(r=>r.json()),{version:2})
    assert.equal((await call('cycles',2)).status,409);assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').first('n'),0)
    await db.prepare("UPDATE maintenance_jobs SET target_ids_json='not-json'").run()
    for(const engine of ['fields','cycles'])assert.deepEqual(await call(engine).then(r=>r.json()),{error:'material_batch_history_requires_review'})
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first('n'),0);assert.equal(outbound,0)
  }finally{await mf.dispose()}
})
