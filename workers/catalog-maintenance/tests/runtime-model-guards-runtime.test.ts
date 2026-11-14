import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import type { Bucket } from '../src/types'
import { canonical, digest } from '../src/util'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'

test('real workerd HTTP→existing DO→D1/R2 prepares/registers exact unknowns, preserves all requests and rejects alias/Flash/new-key replay with zero egress', {timeout:120000},async()=>{
  const token='native-runtime-guards-test-only-admin-token'
  const bundled=await build({stdin:{contents:`
    import worker from './index'
    import {ModelAdmission} from './admission'
    export class FixtureAdmission extends ModelAdmission {
      constructor(state,env){super(state,env);this.fixtureStorage=state.storage}
      async fetch(request){
        if(request.headers.get('authorization')==='Bearer ${token}'&&new URL(request.url).pathname==='/fixture-state'){
          const values=await request.json()
          if(values.install)for(const item of values.install)await this.fixtureStorage.put(item.key,item.value)
          const output=[];for(const key of values.keys||[])output.push([key,await this.fixtureStorage.get(key)])
          return Response.json(output)
        }
        return super.fetch(request)
      }
    }
    export default {async fetch(request,env){
      const path=new URL(request.url).pathname
      if(path==='/fixture-state'||path==='/fixture-model')return env.MODEL_ADMISSION.get(env.MODEL_ADMISSION.idFromName('subscription-account-v1')).fetch(new Request('https://admission.internal'+(path==='/fixture-model'?'/model/run':path),request))
      return worker.fetch(request,env)
    }}
  `,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),sourcefile:'runtime-model-guards-native.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false})
  const outbound:string[]=[]
  const mf=new Miniflare(convertV4MiniflareOptions({name:'runtime-model-guards-native',script:bundled.outputFiles[0].text,modules:true,compatibilityDate:'2026-09-18',host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},
    bindings:{MAINTENANCE_ADMIN_TOKEN:token,MAINTENANCE_ENABLED:'true',MINIMAX_MODEL:'MiniMax-M3',MINIMAX_SUBSCRIPTION_KEY:'not-a-real-provider-key',NATIVE_HEAD_RECONCILIATION_REQUIRED:'false',SCOPE_REGISTRY_SHA256:EXISTING_SCHOOLS_V2_SHA256,SCOPE_SCHOOL_COUNT:'295',MINIMAX_FLASH_CANARY:'{}'},
    d1Databases:{PIPELINE_DB:'runtime-model-guards-db'},r2Buckets:{SNAPSHOTS_BUCKET:'runtime-model-guards-snapshots'},durableObjects:{MODEL_ADMISSION:{className:'FixtureAdmission',useSQLite:true}},
    outboundService:async request=>{outbound.push(request.url);return new WorkerResponse('All external access denied in this test',{status:500})}}))
  const call=(path:string,body:unknown)=>mf.dispatchFetch('https://guard-native.test'+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})
  try{
    await mf.ready;const db=await mf.getD1Database('PIPELINE_DB'),bucket=await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as Bucket
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
    const when=new Date(Date.now()-1000).toISOString()
    await db.prepare("INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,?,?,?, ?,1,0,1,1,'[]',?)").bind(EXISTING_SCHOOLS_V2_SHA256,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),when).run()
    await db.batch(Array.from({length:295},(_,i)=>db.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?,?,?,?)').bind(`uni-${String(i).padStart(3,'0')}`,'{"en":"Native test"}','{}',EXISTING_SCHOOLS_V2_SHA256)))
    const sources=[]
    for(const [url,text]of [['https://guard-native.edu.cn/original','Official   international\n  admissions'],['https://guard-native.edu.cn/another','Official international admissions']]){
      const sourceId=await digest(url),raw='<html>'+text+'</html>',rawSha=await digest(raw),textSha=await digest(text),snapshotKey=`maintenance/snapshots/${sourceId}/${rawSha}.json`,rawKey=`maintenance/snapshots/${sourceId}/${rawSha}.bin`,textKey=`maintenance/text/${sourceId}/${textSha}.txt`
      await db.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256,snapshot_key) VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?,?)").bind(sourceId,url,'["guard-native.edu.cn"]',when,rawSha,textSha,snapshotKey).run()
      await db.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').bind(sourceId,'uni-000').run()
      await bucket.put(rawKey,raw);await bucket.put(textKey,text);await bucket.put(snapshotKey,canonical({version:1,sourceId,sourceUrl:url,finalUrl:url,checkedAt:when,contentType:'text/html',rawSha256:rawSha,rawKey,textKey,textSha256:textSha,canonicalSha256:textSha,parserCandidates:[]}));sources.push({sourceId,rawSha,snapshotKey})
    }
    const original=sources[0],jobId=await digest('native-unknown-job'),attemptIds=['native-unknown-attempt-1','native-unknown-attempt-2'],requests=[]
    await db.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,attempt,snapshot_sha256,snapshot_key,error_code) VALUES(?,?,'extract','unknown',?,?,?,1,?,?,'model_outcome_unknown')").bind(jobId,original.sourceId,when,when,when,original.rawSha,original.snapshotKey).run()
    for(const [i,attemptId]of attemptIds.entries()){
      const reservation=await digest('native-old-reservation-'+i),payload=await digest('native-old-payload-'+i)
      await db.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,completed_at,quota_json,error_code) VALUES(?,?,?,?,?,?,'MiniMax-M3','unknown',?,?,'{}','model_outcome_unknown')").bind(reservation,attemptId,original.sourceId,original.rawSha,i?'independent-review':'primary',payload,when,when).run()
      requests.push({key:`request:${reservation}`,value:{state:'unknown',attemptId,requestSha256:payload,attemptCount:1}})
    }
    await call('/fixture-state',{install:requests});const keys=requests.map(r=>r.key),before=await (await call('/fixture-state',{keys})).json()
    assert.equal((await mf.dispatchFetch('https://guard-native.test/runtime-model-guards/prepare',{method:'POST',body:'{}'})).status,401)
    const prep=await call('/runtime-model-guards/prepare',{operationId:'native-unknown-review',expectedRevision:0,attemptIds});assert.equal(prep.status,200);const proof=await prep.json() as {proofSha256:string;permanentNoReplay:boolean};assert.equal(proof.permanentNoReplay,true)
    const reg=await call('/runtime-model-guards/register',{proofSha256:proof.proofSha256,expectedRevision:0,operatorId:'native-test-reviewer',decision:'preserve_unknown_permanent_no_replay'});assert.equal(reg.status,200);assert.equal((await reg.json() as {registered:boolean}).registered,true)
    await db.prepare('UPDATE maintenance_control SET models_enabled=1,revision=revision+1').run()
    for(const s of sources){const response=await call('/fixture-model',{reservationKey:'f'.repeat(64),sourceId:s.sourceId,snapshotSha256:s.rawSha,pass:'primary',lane:'expansion',universityIds:['uni-000'],payload:'{"newModelProfile":"Flash","newPayload":true}' });assert.equal(response.status,409);assert.equal((await response.json()as {error:string}).error,'runtime_model_replay_protected')}
    assert.deepEqual(await(await call('/fixture-state',{keys})).json(),before)
    const rows=await db.prepare("SELECT status,COUNT(*) n FROM maintenance_model_attempts GROUP BY status").all();assert.deepEqual(rows.results,[{status:'unknown',n:2}]);assert.deepEqual(outbound,[])
  }finally{await mf.dispose()}
})
