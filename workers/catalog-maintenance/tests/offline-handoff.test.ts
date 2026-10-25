import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch,processMessage } from '../src/index'
import { processOfflineHandoff } from '../src/offline-handoff'
import { offlineHandoffSchema,OFFLINE_TABLES,type OfflineHandoff } from '../src/offline-handoff-contract'
import { control,seed,setControls,source } from '../src/repository'
import { canonical,digest,gateRequest } from '../src/util'
import { runCloudTick } from '../src/runtime'
import { makeEnv,seedInput,TEST_CATALOG,TEST_GUARDS,TEST_SCOPE } from './fixture'

const token='f'.repeat(64),batchId='offline-handoff-test'
async function fixture(includeUnknown=true){
  let network=0;const f=makeEnv(async()=>{network++;throw new Error('must use cache, never call provider')})
  await seed(f.env,seedInput());await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']})
  const cfg=(await control(f.env))!,sourceId=await digest('https://test.edu.cn/catalog'),checkedAt=new Date(Date.now()-1000).toISOString(),dueAt=new Date(Date.now()+86400000).toISOString(),raw='Official international Bachelor Computer Science catalogue 2027',rawSha=await digest(raw),rawKey=`maintenance/snapshots/${sourceId}/${rawSha}.bin`,snapshotKey=`maintenance/snapshots/${sourceId}/${rawSha}.json`,textKey=`maintenance/text/${sourceId}/${rawSha}.txt`
  const bodies=new Map<string,string>([[rawKey,raw],[textKey,raw],[snapshotKey,canonical({version:1,sourceId,sourceUrl:'https://test.edu.cn/catalog',finalUrl:'https://test.edu.cn/catalog',checkedAt,contentType:'text/plain',rawSha256:rawSha,rawKey,textKey,textSha256:rawSha,canonicalSha256:rawSha,parserCandidates:[]})]])
  const payload='completed stable request',requestSha=await digest(payload),reservationKey='1'.repeat(64),unknownPayload='unknown stable request',unknownSha=await digest(unknownPayload),unknownKey='3'.repeat(64)
  const artifact=canonical({attemptId:'complete-attempt',reservationKey,requestSha256:requestSha,sourceId,snapshotSha256:rawSha,pass:'primary',model:'MiniMax-M3',output:{programs:[]},usage:null,completedAt:checkedAt}),artifactSha=await digest(artifact),modelKey=`maintenance/models/${reservationKey}/${artifactSha}.json`;bodies.set(modelKey,artifact)
  const rows=Object.fromEntries(Object.keys(OFFLINE_TABLES).map(table=>[table,[]]))as unknown as OfflineHandoff['tableRows'],sourceRow={...JSON.parse(JSON.stringify(await source(f.env,sourceId))),last_attempt_at:checkedAt,last_success_at:checkedAt,due_at:dueAt,raw_sha256:rawSha,canonical_sha256:rawSha,snapshot_key:snapshotKey}
  rows.maintenance_sources.push(sourceRow);rows.maintenance_source_schools.push({source_id:sourceId,university_id:'uni-000'})
  rows.maintenance_observations.push({observation_id:'offline-observation',job_id:'offline-job',source_id:sourceId,checked_at:checkedAt,final_url:sourceRow.url,http_status:200,raw_sha256:rawSha,canonical_sha256:rawSha,snapshot_key:snapshotKey,content_type:'text/plain',outcome:'captured',candidate_count:0})
  rows.maintenance_jobs.push({job_id:'offline-job',source_id:sourceId,stage:'extract',status:'done',priority:10,due_at:checkedAt,created_at:checkedAt,updated_at:checkedAt,attempt:1,lease_token:null,lease_until:null,snapshot_sha256:rawSha,snapshot_key:snapshotKey,error_code:null,enqueued_at:null,target_ids_json:null})
  const base={source_id:sourceId,snapshot_sha256:rawSha,pass:'primary' as const,model:'MiniMax-M3' as const,started_at:checkedAt,completed_at:checkedAt,usage_json:null,quota_json:'{}'}
  rows.maintenance_model_attempts.push({...base,reservation_key:reservationKey,attempt_id:'complete-attempt',request_sha256:requestSha,status:'completed',output_key:modelKey,output_sha256:artifactSha,error_code:null},{...base,reservation_key:unknownKey,attempt_id:'unknown-attempt',request_sha256:unknownSha,status:'unknown',output_key:null,output_sha256:null,error_code:'model_outcome_unknown'})
  const manifest=offlineHandoffSchema.parse({format:'studyinchina.offline-maintenance-handoff',version:1,batchId,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG,seedSha256:cfg.seed_sha256,legacyGuardSha256:TEST_GUARDS,artifacts:await Promise.all([...bodies].map(async([objectKey,body])=>({objectKey,sha256:await digest(body),byteLength:new TextEncoder().encode(body).length}))),tableRows:rows,requestReservations:[{reservationKey,state:'completed',attemptId:'complete-attempt',requestSha256:requestSha},{reservationKey:unknownKey,state:'unknown',attemptId:'unknown-attempt',requestSha256:unknownSha,retryable:false}]})
  if(!includeUnknown){manifest.tableRows.maintenance_model_attempts=manifest.tableRows.maintenance_model_attempts.filter(row=>row.status!=='unknown');manifest.requestReservations=manifest.requestReservations.filter(row=>row.state!=='unknown')}
  await gateRequest(f.env,'/offline-fence/acquire',{batchId,token,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG})
  const post=async(path:string,body:string,sha:string)=>handleFetch(new Request(`https://worker${path}`,{method:'POST',headers:{authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`,'x-offline-token':token,[path.includes('/artifact?')?'x-artifact-sha256':'x-manifest-sha256']:sha,'content-type':'application/octet-stream','content-length':String(new TextEncoder().encode(body).length)},body}),f.env)
  const stage=async(value:OfflineHandoff=manifest,corrupt=false)=>{for(const artifact of value.artifacts){const response=await post(`/offline-handoff/artifact?batchId=${batchId}&key=${encodeURIComponent(artifact.objectKey)}`,corrupt&&artifact.objectKey===rawKey?'corrupted bytes':bodies.get(artifact.objectKey)!,artifact.sha256);assert.equal(response.status,200)}const text=canonical(value),sha=await digest(text),response=await post(`/offline-handoff/manifest?batchId=${batchId}`,text,sha);assert.equal(response.status,200);return sha}
  const drain=async()=>{let count=0;while(f.messages.length){assert.ok(count++<100,'bounded handoff');await processMessage(f.env,f.messages.shift()!)}return count}
  return{...f,manifest,stage,drain,sourceId,rawSha,checkedAt,network:()=>network,modelInput:{reservationKey,sourceId,snapshotSha256:rawSha,pass:'primary',lane:'maintenance',payload,universityIds:['uni-000']},unknownInput:{reservationKey:unknownKey,sourceId,snapshotSha256:rawSha,pass:'primary',lane:'maintenance',payload:unknownPayload,universityIds:['uni-000']}}
}
test('full staged handoff imports exact rows, preserves done/unknown, adopts cached models, acknowledges D1 then releases fence',async()=>{
  const f=await fixture(false)
  try{
    await f.stage();assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence.phase,'held_for_handoff')
    const originalBatch=f.db.batch.bind(f.db);f.env.PIPELINE_DB.batch=async statements=>{assert.ok(statements.length<40);return originalBatch(statements)}
    await f.drain();assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence,null)
    assert.equal(f.db.sqlite.prepare("SELECT status FROM maintenance_jobs WHERE job_id='offline-job'").get()?.status,'done')
    assert.equal(f.db.sqlite.prepare("SELECT last_attempt_at FROM maintenance_schools WHERE university_id='uni-000'").get()?.last_attempt_at,f.checkedAt)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='offline_handoff_applied'").get()?.count,1)
    const cached=await gateRequest(f.env,'/model/run',f.modelInput);assert.equal(cached.status,200);assert.equal((await cached.json()).reused,true)
    assert.equal(f.network(),0)
    const request={batchId,token,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG};assert.equal((await gateRequest(f.env,'/offline-fence/acquire',request)).status,409)
  }finally{f.db.sqlite.close()}
})
test('unresolved offline sends remain unknown and block the same evidence even after prompt/reservation changes',async()=>{
  const f=await fixture()
  try{
    await f.stage();await f.drain();assert.equal(f.db.sqlite.prepare("SELECT status FROM maintenance_model_attempts WHERE attempt_id='unknown-attempt'").get()?.status,'unknown')
    const unknown=await gateRequest(f.env,'/model/run',f.unknownInput);assert.equal(unknown.status,409);assert.equal((await unknown.json()).error,'legacy_scope_stop_or_reservation')
    const changed=await gateRequest(f.env,'/model/run',{...f.unknownInput,reservationKey:'8'.repeat(64),payload:'new prompt must not replay old unknown evidence'});assert.equal(changed.status,409);assert.equal((await changed.json()).error,'legacy_scope_stop_or_reservation');assert.equal(f.network(),0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_legacy_guards WHERE state='unknown' AND snapshot_sha256=?").get(f.rawSha)?.count,1)
  }finally{f.db.sqlite.close()}
})
test('staging remains available during D1 daily-quota failure and tick durably resumes the same immutable handoff',async()=>{
  const f=await fixture(),db=f.env.PIPELINE_DB
  try{
    f.env.PIPELINE_DB={prepare(){throw new Error('D1 free tier daily row read limit exceeded; midnight UTC')},async batch(){throw new Error('D1 daily quota exceeded')}}
    const sha=await f.stage();await assert.rejects(processOfflineHandoff(f.env,batchId,sha),/daily row read limit exceeded/)
    assert.equal((await runCloudTick(f.env)).state,'quota_wait');assert.ok(f.messages.some(message=>message.offlineHandoffSha256===sha));assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence.phase,'held_for_handoff')
    f.env.PIPELINE_DB=db;await f.drain();assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence,null);assert.equal(f.network(),0)
  }finally{f.db.sqlite.close()}
})
test('corrupt raw artifacts or conflicting existing attempts hold the fence and never partially overwrite a row chunk',async()=>{
  for(const kind of ['artifact','sql']){const f=await fixture()
    try{
      if(kind==='sql'){const row=f.manifest.tableRows.maintenance_model_attempts[1];f.db.sqlite.prepare('INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.reservation_key,row.attempt_id,row.source_id,row.snapshot_sha256,row.pass,'9'.repeat(64),row.model,row.status,row.started_at,row.quota_json)}
      const sha=await f.stage(f.manifest,kind==='artifact');await assert.rejects(async()=>{await processOfflineHandoff(f.env,batchId,sha);await f.drain()})
      assert.equal((await source(f.env,f.sourceId))!.raw_sha256,null);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='offline_handoff_applied'").get()?.count,0);assert.ok((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence);assert.equal(f.network(),0)
    }finally{f.db.sqlite.close()}
  }
})
test('source hosts inherited only from disabled/candidate registrations cannot be activated by a handoff',async()=>{
  const f=await fixture()
  try{const school=JSON.parse(String(f.db.sqlite.prepare("SELECT seed_json FROM maintenance_schools WHERE university_id='uni-000'").get()?.seed_json));school.sourceSeeds.forEach((entry:Record<string,unknown>)=>{entry.enabled=false;entry.registration='candidate'});f.db.sqlite.prepare("UPDATE maintenance_schools SET seed_json=? WHERE university_id='uni-000'").run(JSON.stringify(school));await f.stage();await assert.rejects(f.drain(),/source_host_not_registered/);assert.ok((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).fence)}finally{f.db.sqlite.close()}
})
