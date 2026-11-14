import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEnv, seedInput, quotaResponse } from './fixture'
import { seed, control } from '../src/repository'
import { canonical, digest, gateRequest } from '../src/util'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { prepareRuntimeModelGuards, registerRuntimeModelGuards, readRuntimeModelDisposition, runtimeModelNoReplayReason, runtimeDispositionFence, runtimeUnknownSummary } from '../src/runtime-model-guards'
import { dispositionFence, readUnknownJobDisposition } from '../src/reviewed-terminal-quarantine'
import { legacyModelDispositionFence, readLegacyModelDisposition } from '../src/legacy-model-guards'
import { processMessage } from '../src/index'
import { evaluateRollout, rolloutStatus } from '../src/rollout'
import type { ModelRequest } from '../src/types'

async function fixture(onNetwork?:typeof fetch){
  let network=0
  const f=makeEnv(async(...args)=>{network++;return onNetwork?onNetwork(...args):quotaResponse()})
  f.env.SCOPE_REGISTRY_SHA256=EXISTING_SCHOOLS_V2_SHA256;f.env.SCOPE_SCHOOL_COUNT='295'
  const input=seedInput();input.scopeRegistrySha256=EXISTING_SCHOOLS_V2_SHA256
  for(let i=272;i<295;i++)input.schools.push({universityId:`uni-${String(i).padStart(3,'0')}`,name:{en:`University ${i}`},sourceSeeds:[]})
  await seed(f.env,input)
  const when=new Date(Date.now()-10000).toISOString(),sourceId=await digest('https://test.edu.cn/catalog'),text='International   admissions\n  Computer Science',raw='<html>'+text+'</html>',rawSha=await digest(raw),textSha=await digest(text),key=`maintenance/snapshots/${sourceId}/${rawSha}.json`,textKey=`maintenance/text/${sourceId}/${textSha}.txt`
  await f.bucket.put(`maintenance/snapshots/${sourceId}/${rawSha}.bin`,raw);await f.bucket.put(textKey,text)
  await f.bucket.put(key,canonical({version:1,sourceId,sourceUrl:'https://test.edu.cn/catalog',finalUrl:'https://test.edu.cn/catalog',checkedAt:when,contentType:'text/html',rawSha256:rawSha,rawKey:`maintenance/snapshots/${sourceId}/${rawSha}.bin`,textKey,textSha256:textSha,canonicalSha256:textSha,parserCandidates:[]}))
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=? WHERE source_id=?').run(rawSha,textSha,key,sourceId)
  const jobId=await digest('unknown-runtime-job')
  f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,attempt,snapshot_sha256,snapshot_key,error_code,target_ids_json) VALUES(?,?,'extract','unknown',100,?,?,?,1,?,?,'model_outcome_unknown','[]')").run(jobId,sourceId,when,when,when,rawSha,key)
  const attempts=[]
  for(let i=0;i<2;i++){
    const reservationKey=await digest('runtime-request-'+i),attemptId=`runtime-attempt-${i}`,requestSha256=await digest('runtime-payload-'+i)
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,completed_at,error_code,quota_json) VALUES(?,?,?,?,?,?,?,'unknown',?,?,'model_outcome_unknown','{}')").run(reservationKey,attemptId,sourceId,rawSha,i?'independent-review':'primary',requestSha256,'MiniMax-M3',when,when)
    await f.storage.put(`request:${reservationKey}`,{state:'unknown',attemptId,requestSha256,attemptCount:1})
    attempts.push({reservationKey,attemptId,requestSha256})
  }
  const body={operationId:'runtime-unknown-review-001',expectedRevision:0,attemptIds:attempts.map(a=>a.attemptId)}
  const prepare=()=>prepareRuntimeModelGuards(f.env,f.storage,body,()=>0)
  const register=(proofSha256:string)=>registerRuntimeModelGuards(f.env,f.storage,{proofSha256,expectedRevision:0,operatorId:'reviewer-test-only',decision:'preserve_unknown_permanent_no_replay'},()=>0)
  const request:ModelRequest={sourceId,snapshotSha256:rawSha,reservationKey:'e'.repeat(64),payload:'{"new":"payload"}',pass:'primary',lane:'expansion',universityIds:['uni-000']}
  async function aliasSource(){
    const url='https://test.edu.cn/new-url',alias=await digest(url),aliasText='International admissions Computer Science',aliasRaw='<p>'+aliasText+'</p>',r=await digest(aliasRaw),t=await digest(aliasText),snapshotKey=`maintenance/snapshots/${alias}/${r}.json`,tk=`maintenance/text/${alias}/${t}.txt`
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,discovery_depth,raw_sha256,canonical_sha256,snapshot_key) VALUES(?,?,'[\"test.edu.cn\"]','undergraduate_catalog',1,24,?,0,?,?,?)").run(alias,url,when,r,t,snapshotKey)
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(alias,'uni-000')
    await f.bucket.put(`maintenance/snapshots/${alias}/${r}.bin`,aliasRaw);await f.bucket.put(tk,aliasText)
    await f.bucket.put(snapshotKey,canonical({version:1,sourceId:alias,sourceUrl:url,finalUrl:url,checkedAt:when,contentType:'text/html',rawSha256:r,rawKey:`maintenance/snapshots/${alias}/${r}.bin`,textKey:tk,textSha256:t,canonicalSha256:t,parserCandidates:[]}))
    return{...request,sourceId:alias,snapshotSha256:r,snapshotKey}
  }
  return{...f,sourceId,rawSha,key,textKey,jobId,attempts,body,request,prepare,register,aliasSource,network:()=>network}
}

test('prepare installs permanent denial before any waiver, preserving both real unknown outcomes and all durable requests',async()=>{
 const f=await fixture();try{
  const original=canonical([...f.storage.values]),p=await f.prepare(),d=await readRuntimeModelDisposition(f.env,(await control(f.env))!)
  assert.equal(p.permanentNoReplay,true);assert.equal(d.attempts.length,0)
  assert.equal(await runtimeModelNoReplayReason(f.env,f.request),'runtime_model_replay_protected')
  const alias=await f.aliasSource();assert.equal(await runtimeModelNoReplayReason(f.env,alias),'runtime_model_replay_protected')
  assert.equal(canonical([...f.storage.values]),original);assert.equal(f.network(),0)
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,2)
 }finally{f.db.sqlite.close()}
})

test('register revalidates actual DO, original artifacts and SQL then exposes separate exact attempt/job protection without rewriting outcomes',async()=>{
 const f=await fixture();try{
  const before=canonical([...f.storage.values]),p=await f.prepare(),r=await f.register(p.proofSha256)
  assert.equal(r.registered,true);assert.equal(canonical([...f.storage.values]),before)
  f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1,models_enabled=1').run()
  const d=await readRuntimeModelDisposition(f.env,(await control(f.env))!),summary=await runtimeUnknownSummary(f.env,d,false,false)
  assert.equal(d.state,'verified');assert.equal(summary.totalUnknownModels,2);assert.equal(summary.runtimeProtectedModels,2);assert.equal(summary.unresolvedModels,0)
  assert.equal(summary.totalUnknownJobs,1);assert.equal(summary.runtimeProtectedJobs,1);assert.equal(summary.unresolvedJobs,0)
  assert.equal(summary.modelSuccessesClaimed,false);assert.equal(summary.replayAllowed,false)
  assert.equal((await f.register(p.proofSha256)).reused,true)
 }finally{f.db.sqlite.close()}
})

test('caller IDs cannot replace artifacts, fake a durable unknown, or register while models/preflight/permits are active',async()=>{
 for(const mode of ['models','active','permit','request','raw','text','callerHash']){const f=await fixture();try{
  if(mode==='models')f.db.sqlite.prepare('UPDATE maintenance_control SET models_enabled=1').run()
  if(mode==='permit')await f.storage.put('gate',{models:[{expiresAt:Date.now()+60000}],fetches:[]})
  if(mode==='request')await f.storage.put(`request:${f.attempts[0].reservationKey}`,{state:'completed',attemptId:f.attempts[0].attemptId,requestSha256:f.attempts[0].requestSha256})
  if(mode==='raw')await f.bucket.put(`maintenance/snapshots/${f.sourceId}/${f.rawSha}.bin`,'tampered')
  if(mode==='text')await f.bucket.put(f.textKey,'tampered')
  const b=mode==='callerHash'?{...f.body,textSha256:'a'.repeat(64)}:f.body
  await assert.rejects(prepareRuntimeModelGuards(f.env,f.storage,b,()=>mode==='active'?1:0),/runtime_model_guard_/)
  assert.equal(f.bucket.objects.has('maintenance/runtime-model-guards/index.v1.json'),false);assert.equal(f.network(),0)
 }finally{f.db.sqlite.close()}}
})

test('registration CAS rolls back when a job, attempt, or controls changes at the atomic boundary',async()=>{
 for(const mode of ['revision','job','attempt']){const f=await fixture();try{
  const p=await f.prepare(),batch=f.env.PIPELINE_DB.batch.bind(f.env.PIPELINE_DB)
  f.env.PIPELINE_DB.batch=async statements=>{if(mode==='revision')f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1').run();if(mode==='job')f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='held' WHERE job_id=?").run(f.jobId);if(mode==='attempt')f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET error_code='changed' WHERE attempt_id=?").run(f.attempts[1].attemptId);return batch(statements)}
  await assert.rejects(f.register(p.proofSha256))
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='runtime_model_guards_registered'").get()?.n,0)
  assert.equal(await runtimeModelNoReplayReason(f.env,f.request),'runtime_model_replay_protected')
 }finally{f.db.sqlite.close()}}
})

test('a new third unknown stays unresolved and both old default fences reject it even when the reviewed set is valid',async()=>{
 const f=await fixture();try{
  await f.register((await f.prepare()).proofSha256)
  const cfg=(await control(f.env))!,d=await readRuntimeModelDisposition(f.env,cfg),rf=runtimeDispositionFence(d),lease=await readUnknownJobDisposition(f.env,cfg),legacy=await readLegacyModelDisposition(f.env,cfg)
  const jf=dispositionFence(lease,rf.jobs),mf=legacyModelDispositionFence(legacy,new Date(Date.now()-120000).toISOString(),rf.attempts)
  const allowed=()=>f.db.sqlite.prepare(`SELECT (${jf.sql}) AND (${mf.sql}) AND (${rf.sql}) yes`).get(...[...jf.bindings,...mf.bindings,...rf.bindings] as Array<string|number|null>)?.yes
  assert.equal(allowed(),1)
  f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,? ,?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run('7'.repeat(64),'third-runtime-attempt',f.sourceId,f.rawSha,'8'.repeat(64),new Date().toISOString())
  assert.equal(allowed(),0);assert.equal((await runtimeUnknownSummary(f.env,d,false,false)).unresolvedModels,1)
 }finally{f.db.sqlite.close()}
})

test('a registered tuple cannot disappear/change between rollout read and commit; altered proof never grants a waiver',async()=>{
 for(const mode of ['deleteJob','jobStatus','attemptStatus','attemptSha','proof']){const f=await fixture();try{
  const p=await f.prepare();await f.register(p.proofSha256);const d=await readRuntimeModelDisposition(f.env,(await control(f.env))!),fence=runtimeDispositionFence(d)
  if(mode==='deleteJob')f.db.sqlite.prepare('DELETE FROM maintenance_jobs WHERE job_id=?').run(f.jobId)
  if(mode==='jobStatus')f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='held' WHERE job_id=?").run(f.jobId)
  if(mode==='attemptStatus')f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET status='completed' WHERE attempt_id=?").run(f.attempts[0].attemptId)
  if(mode==='attemptSha')f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET request_sha256=? WHERE attempt_id=?").run('a'.repeat(64),f.attempts[0].attemptId)
  if(mode==='proof')await f.bucket.put(`maintenance/runtime-model-guards/proofs/${p.proofSha256}.json`,'{}')
  if(mode!=='proof')assert.equal(f.db.sqlite.prepare(`SELECT (${fence.sql}) yes`).get(...fence.bindings as Array<string|number|null>)?.yes,0)
  assert.equal((await readRuntimeModelDisposition(f.env,(await control(f.env))!)).state,'invalid')
 }finally{f.db.sqlite.close()}}
})

test('scope changes revoke only the waiver; permanent alias denial survives every revision/model/profile',async()=>{
 const f=await fixture();try{
  await f.register((await f.prepare()).proofSha256)
  f.db.sqlite.prepare('UPDATE maintenance_control SET scope_sha256=?,revision=revision+1').run('f'.repeat(64));f.env.MINIMAX_FLASH_CANARY='{}'
  const d=await readRuntimeModelDisposition(f.env,(await control(f.env))!);assert.equal(d.state,'scope_mismatch');assert.equal(d.attempts.length,0)
  assert.equal(await runtimeModelNoReplayReason(f.env,{...f.request,reservationKey:'1'.repeat(64)}),'runtime_model_replay_protected')
 }finally{f.db.sqlite.close()}
})

test('prepartition and final DO admission deny a new URL with the verified normalized text and create no new unknown/provider calls',async()=>{
 const f=await fixture();try{
  await f.register((await f.prepare()).proofSha256);const alias=await f.aliasSource();f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1').run()
  const unknownBefore=f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='unknown'").get()?.n
  const id=await digest('new-alias-job'),when=new Date(Date.now()-1000).toISOString()
  f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key) VALUES(?,?,'extract','queued',?,?,?,?,?)").run(id,alias.sourceId,when,when,when,alias.snapshotSha256,alias.snapshotKey)
  await processMessage(f.env,{version:1,jobId:id})
  assert.deepEqual({...f.db.sqlite.prepare('SELECT status,error_code FROM maintenance_jobs WHERE job_id=?').get(id)},{status:'held',error_code:'runtime_model_replay_protected'})
  const response=await gateRequest(f.env,'/model/run',alias);assert.equal(response.status,409);assert.equal((await response.json()).error,'runtime_model_replay_protected')
  assert.equal(f.network(),0);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='unknown'").get()?.n,unknownBefore)
 }finally{f.db.sqlite.close()}
})

test('a missing committed deny index fails closed instead of forgetting the permanent replay guard',async()=>{
 const f=await fixture();try{await f.register((await f.prepare()).proofSha256);f.bucket.objects.delete('maintenance/runtime-model-guards/index.v1.json');await assert.rejects(runtimeModelNoReplayReason(f.env,f.request),/index_missing/)}finally{f.db.sqlite.close()}
})

test('actual admission handler takes an exclusive registration gate before R2 awaits and rejects parallel business without quota/provider access',async()=>{
 const f=await fixture();try{
  const get=f.bucket.get.bind(f.bucket);let release=()=>{},reached=()=>{};const held=new Promise<void>(r=>{release=r}),waiting=new Promise<void>(r=>{reached=r});let intercepted=false
  f.bucket.get=async key=>{if(!intercepted&&key===`maintenance/snapshots/${f.sourceId}/${f.rawSha}.bin`){intercepted=true;reached();await held}return get(key)}
  const prepare=gateRequest(f.env,'/runtime-model-guards/prepare',f.body);await waiting
  const business=await gateRequest(f.env,'/model/run',f.request)
  assert.equal(business.status,429);assert.equal((await business.json()).error,'model_capacity_runtime_guard_registration')
  release();const result=await prepare;assert.equal(result.status,200);assert.equal((await result.json()).permanentNoReplay,true)
  assert.equal(f.network(),0)
 }finally{f.db.sqlite.close()}
})

test('an operator cannot register changed proof bytes, changed operation parameters or a different reviewer under an existing receipt',async()=>{
 const f=await fixture();try{
  const p=await f.prepare();await assert.rejects(prepareRuntimeModelGuards(f.env,f.storage,{...f.body,attemptIds:[f.body.attemptIds[0]]},()=>0),/operation_conflict/)
  await f.register(p.proofSha256)
  await assert.rejects(registerRuntimeModelGuards(f.env,f.storage,{proofSha256:p.proofSha256,expectedRevision:0,operatorId:'another-reviewer',decision:'preserve_unknown_permanent_no_replay'},()=>0),/registration_conflict/)
  await f.bucket.put(`maintenance/runtime-model-guards/proofs/${p.proofSha256}.json`,'{}');await assert.rejects(f.register(p.proofSha256),/proof_hash_mismatch/)
 }finally{f.db.sqlite.close()}
})

test('the real rollout advances other schools with reviewed runtime unknowns, while a late tuple change atomically preserves the old canary',async()=>{
 for(const race of [false,true]){const f=await fixture();try{
  await f.register((await f.prepare()).proofSha256)
  const ids=Array.from({length:5},(_,i)=>`uni-${String(i).padStart(3,'0')}`),when=new Date(Date.now()-1000).toISOString()
  f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1,canary_json=?').run(canonical(ids))
  for(const [i,school]of ids.entries()){
    const url=i?`https://test.edu.cn/rollout-${i}`:'https://test.edu.cn/catalog',sourceId=await digest(url)
    if(i){f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,?,'[\"test.edu.cn\"]','undergraduate_catalog',1,24,?)").run(sourceId,url,when);f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(sourceId,school)}
    f.db.sqlite.prepare("UPDATE maintenance_sources SET last_attempt_at=?,failures=1,error_code='robots_disallowed' WHERE source_id=?").run(when,sourceId)
    f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id=?').run(when,school)
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,attempt,error_code) VALUES(?,?,'capture','held',?,?,?,1,'robots_disallowed')").run(`capture-blocked-${i}`,sourceId,when,when,when)
  }
  const ack={batchId:'runtime-verified-published-batch',outcome:'published',sourceCommit:'d'.repeat(40),deploymentId:'dpl_realTestProof',stableProofSha256:'e'.repeat(64),acceptedProposalIds:['previous-evidence-checked-record']},text=canonical(ack)
  f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES(?,?,?,?,?,?,'published',?,?)").run(ack.batchId,(await control(f.env))!.input_catalog_sha256,EXISTING_SCHOOLS_V2_SHA256,'maintenance/test-export.json','f'.repeat(64),when,await digest(text),text)
  const before=await rolloutStatus(f.env);assert.equal(before.state,'eligible',canonical(before.reasons));assert.equal(before.runtimeUnknownDisposition?.runtimeProtectedModels,2)
  if(race){const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET request_sha256=? WHERE attempt_id=?").run('1'.repeat(64),f.attempts[0].attemptId);return batch(statements)}}
  const result=await evaluateRollout(f.env,{expectedRevision:0});assert.equal(result.advanced,!race)
  assert.equal(JSON.parse((await control(f.env))!.canary_json).length,race?5:25)
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,2)
  assert.equal(f.network(),0)
 }finally{f.db.sqlite.close()}}
})


test('a real pending quota preflight prevents registration even before any SQL or durable send permit exists',async()=>{
 let release=()=>{},reached=()=>{},first=true
 const wait=new Promise<void>(r=>{release=r}),seen=new Promise<void>(r=>{reached=r})
 const f=await fixture(async()=>{if(first){first=false;reached();await wait;return quotaResponse()}return new Response('fake provider unavailable',{status:500})})
 try{
  f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1').run()
  const running=gateRequest(f.env,'/model/run',f.request);await seen
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='send_started'").get()?.n,0)
  f.db.sqlite.prepare('UPDATE maintenance_control SET models_enabled=0').run()
  const blocked=await gateRequest(f.env,'/runtime-model-guards/prepare',f.body)
  assert.equal(blocked.status,409);assert.equal((await blocked.json()).error,'runtime_model_guard_admission_not_idle')
  assert.equal(f.bucket.objects.has('maintenance/runtime-model-guards/index.v1.json'),false)
  release();await running
 }finally{release();f.db.sqlite.close()}
})


test('successful prepare also persists a fixed-PK deny marker, so losing its index before registration still fails closed',async()=>{
 const f=await fixture();try{await f.prepare();f.bucket.objects.delete('maintenance/runtime-model-guards/index.v1.json');await assert.rejects(runtimeModelNoReplayReason(f.env,f.request),/index_missing/)}finally{f.db.sqlite.close()}
})
