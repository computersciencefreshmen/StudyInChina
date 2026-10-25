import assert from 'node:assert/strict'
import test from 'node:test'
import { control,seed,setControls } from '../src/repository'
import { evaluateRollout,rolloutStatus } from '../src/rollout'
import { handleFetch } from '../src/index'
import { canonical,digest } from '../src/util'
import { makeEnv,seedInput,TEST_CATALOG,TEST_GUARDS,TEST_SCOPE } from './fixture'

const start=Date.parse('2026-10-24T04:00:00.000Z'),first=Array.from({length:5},(_,index)=>`uni-${String(index).padStart(3,'0')}`)
async function fixture(){
  const f=makeEnv(),input=seedInput()
  for(const [index,school]of input.schools.entries())school.sourceSeeds=[{id:`official-${index}`,url:`https://test.edu.cn/${index}`,allowedHosts:['test.edu.cn'],sourceCategory:'undergraduate_catalog',enabled:true,registration:'catalogue_official'}]
  await seed(f.env,input,start);await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:first},start)
  const publication=async()=>{const ack={batchId:'first-published',outcome:'published',receiptSha256:'c'.repeat(64),sourceCommit:'d'.repeat(40),newInputCatalogSha256:TEST_CATALOG,acceptedProposalIds:['real-proposal'],heldProposalIds:[],unchangedProposalIds:[],deploymentId:'dpl_actualProof',stableProofSha256:'e'.repeat(64)},text=canonical(ack);f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES(?,?,?,?,?,?,'published',?,?)").run(ack.batchId,TEST_CATALOG,TEST_SCOPE,'maintenance/proof.json','f'.repeat(64),new Date(start).toISOString(),await digest(text),text)}
  const inspect=async(id:string,blocked=false)=>{
    const index=Number(id.slice(4)),url=`https://test.edu.cn/${index}`,sourceId=await digest(url),checkedAt=new Date(start-60000).toISOString(),due=new Date(start+86400000).toISOString()
    f.db.sqlite.prepare('UPDATE maintenance_sources SET last_attempt_at=?,due_at=?,failures=?,error_code=? WHERE source_id=?').run(checkedAt,due,blocked?1:0,blocked?'robots_disallowed':null,sourceId)
    f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id=?').run(checkedAt,id)
    if(blocked){f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,attempt,error_code) VALUES(?,?,'capture','held',?,?,?,1,'robots_disallowed')").run(`failed-${id}`,sourceId,due,checkedAt,checkedAt);return}
    const raw=`Official international programme for ${id}`,rawSha=await digest(raw),rawKey=`maintenance/snapshots/${sourceId}/${rawSha}.bin`,snapshotKey=`maintenance/snapshots/${sourceId}/${rawSha}.json`
    await f.bucket.put(rawKey,raw);await f.bucket.put(snapshotKey,canonical({version:1,sourceId,sourceUrl:url,finalUrl:url,checkedAt,contentType:'text/plain',rawSha256:rawSha,rawKey,textKey:null,textSha256:null,canonicalSha256:rawSha,parserCandidates:[]}))
    f.db.sqlite.prepare('UPDATE maintenance_sources SET last_success_at=?,raw_sha256=?,snapshot_key=? WHERE source_id=?').run(checkedAt,rawSha,snapshotKey,sourceId)
    f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`observed-${id}`,`captured-${id}`,sourceId,checkedAt,url,200,rawSha,rawSha,snapshotKey,'text/plain','captured',1)
  }
  return{...f,publication,inspect}
}
test('rollout requires five real first inspections and a maintained published batch, never seed rows alone',async()=>{
  const f=await fixture()
  try{
    assert.ok((await rolloutStatus(f.env,start)).reasons.includes('maintenance_publication_not_proven'))
    await f.publication();const seeded=await evaluateRollout(f.env,{expectedRevision:1},start)
    assert.equal(seeded.advanced,false);assert.equal(seeded.inspections.length,0);assert.ok(seeded.reasons.some(reason=>reason.startsWith('school_first_inspection_unproven:')));assert.ok(await f.bucket.get(seeded.receiptKey))
    for(const id of first)await f.inspect(id,id===first[4])
    const ready=await rolloutStatus(f.env,start);assert.equal(ready.state,'eligible');assert.equal(ready.inspections.filter(proof=>proof.kind==='blocked').length,1)
    const advanced=await evaluateRollout(f.env,{expectedRevision:1},start)
    assert.equal(advanced.advanced,true);assert.equal(advanced.addedSchoolIds.length,20);assert.equal(JSON.parse((await control(f.env))!.canary_json).length,25)
    const waiting=await rolloutStatus(f.env,start+60000);assert.equal(waiting.state,'holding');assert.equal(waiting.currentBatchIds.length,20);assert.ok(waiting.reasons.some(reason=>reason.startsWith('school_first_inspection_unproven:')))
  }finally{f.db.sqlite.close()}
})
test('each new batch may finish with explicit official-site blockers, and all 272 must be inspected before full scope',async()=>{
  const f=await fixture();await f.publication();let time=start,advances=0
  try{
    for(;;){const cfg=(await control(f.env))!,ids=JSON.parse(cfg.canary_json)as string[];for(const id of ids)if(!f.db.sqlite.prepare('SELECT last_attempt_at FROM maintenance_schools WHERE university_id=?').get(id)?.last_attempt_at)await f.inspect(id,true)
      const result=await evaluateRollout(f.env,{expectedRevision:cfg.revision},time);assert.equal(result.advanced,true,JSON.stringify(result.reasons));advances++;time+=60000
      if(result.state==='full_scope')break
      assert.ok(result.addedSchoolIds.length<=20);assert.equal(result.currentCanaryIds.length+result.addedSchoolIds.length,result.nextCanaryIds.length)
    }
    assert.equal(advances,15);assert.deepEqual(JSON.parse((await control(f.env))!.canary_json),[]);assert.equal((await rolloutStatus(f.env,time)).state,'full_scope')
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_schools WHERE last_attempt_at IS NOT NULL').get()?.count,272)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='school_reconciliation_report'").get()?.count,0)
  }finally{f.db.sqlite.close()}
})
test('unknown model outcomes, pending publication, expired or conflicting leases hold expansion',async()=>{
  const f=await fixture();await f.publication();for(const id of first)await f.inspect(id,true)
  try{
    const sourceId=await digest('https://test.edu.cn/0'),iso=new Date(start).toISOString()
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('reservation','attempt',?,'snapshot','primary','request','MiniMax-M3','unknown',?,'{}')").run(sourceId,iso)
    assert.ok((await rolloutStatus(f.env,start)).reasons.includes('model_outcome_unresolved'));f.db.sqlite.exec('DELETE FROM maintenance_model_attempts')
    f.db.sqlite.prepare("UPDATE maintenance_exports SET status='applied'").run();assert.ok((await rolloutStatus(f.env,start)).reasons.includes('publication_pending'));f.db.sqlite.prepare("UPDATE maintenance_exports SET status='published'").run()
    f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='running',lease_token='duplicate',lease_until=? WHERE job_id IN('failed-uni-000','failed-uni-001')").run(new Date(start+60000).toISOString())
    assert.ok((await rolloutStatus(f.env,start)).reasons.includes('execution_lease_conflict'))
    f.db.sqlite.prepare("UPDATE maintenance_jobs SET lease_token=job_id,lease_until=? WHERE status='running'").run(new Date(start-1).toISOString());assert.ok((await rolloutStatus(f.env,start)).reasons.includes('expired_execution_lease'))
    assert.equal((await control(f.env))!.revision,1)
  }finally{f.db.sqlite.close()}
})
test('pause and stale callers cannot resume or expand; a pause racing the R2 decision aborts the whole transaction',async()=>{
  const f=await fixture();await f.publication();for(const id of first)await f.inspect(id,true)
  try{
    assert.ok((await evaluateRollout(f.env,{expectedRevision:0},start)).reasons.includes('control_revision_conflict'));assert.equal((await control(f.env))!.revision,1)
    const put=f.bucket.put.bind(f.bucket);let pause=true
    f.bucket.put=async(key,value,options)=>{if(pause&&key.startsWith('maintenance/rollout/decisions/')){pause=false;f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=0,revision=revision+1').run()}return put(key,value,options)}
    const raced=await evaluateRollout(f.env,{expectedRevision:1},start);assert.equal(raced.advanced,false);assert.ok(raced.reasons.includes('rollout_commit_conflict'));assert.equal((await control(f.env))!.enabled,0);assert.equal((await control(f.env))!.revision,2);assert.deepEqual(JSON.parse((await control(f.env))!.canary_json),first)
    assert.ok((await evaluateRollout(f.env,{expectedRevision:2},start)).reasons.includes('operator_pause_preserved'))
  }finally{f.db.sqlite.close()}
})
test('quota failure persists a holding receipt in R2 and endpoints require the service token',async()=>{
  const f=await fixture(),headers={authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`}
  try{
    assert.equal((await handleFetch(new Request('https://worker/rollout'),f.env)).status,401)
    assert.equal((await handleFetch(new Request('https://worker/rollout',{headers}),f.env)).status,200)
    f.env.PIPELINE_DB={prepare(){throw new Error('D1_ERROR 7500 daily read quota exceeded')},async batch(){throw new Error('D1_ERROR 7500')}}
    const result=await evaluateRollout(f.env,{},start);assert.equal(result.backendState,'quota_wait');assert.equal(result.advanced,false);assert.ok(await f.bucket.get(result.receiptKey))
  }finally{f.db.sqlite.close()}
})
test('an internal execution error or missing raw snapshot cannot masquerade as an actual first inspection',async()=>{
  const f=await fixture();await f.publication();for(const id of first)await f.inspect(id,true)
  try{
    const sourceId=await digest('https://test.edu.cn/0')
    f.db.sqlite.prepare("UPDATE maintenance_sources SET error_code='execution_failed' WHERE source_id=?").run(sourceId)
    f.db.sqlite.prepare("UPDATE maintenance_jobs SET error_code='execution_failed' WHERE source_id=?").run(sourceId)
    assert.ok((await rolloutStatus(f.env,start)).reasons.includes('school_first_inspection_unproven:uni-000'))
    await f.inspect('uni-000',false);const raw=f.db.sqlite.prepare('SELECT raw_sha256 FROM maintenance_sources WHERE source_id=?').get(sourceId)?.raw_sha256
    f.bucket.objects.delete(`maintenance/snapshots/${sourceId}/${raw}.bin`)
    assert.ok((await rolloutStatus(f.env,start)).reasons.includes('school_first_inspection_unproven:uni-000'))
  }finally{f.db.sqlite.close()}
})
test('an operator can still pause a large staged scope within the Free per-invocation query budget',async()=>{
  const f=await fixture()
  try{
    const canary=Array.from({length:65},(_,index)=>`uni-${String(index).padStart(3,'0')}`)
    await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:canary},start)
    let queries=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{queries++;return prepare(sql)}
    const paused=await setControls(f.env,{expectedRevision:2,legacyGuardSha256:TEST_GUARDS,enabled:false,modelsEnabled:false},start)
    assert.equal(paused?.enabled,0);assert.deepEqual(JSON.parse(paused!.canary_json),canary);assert.ok(queries<50)
    assert.ok((await evaluateRollout(f.env,{expectedRevision:3},start)).reasons.includes('operator_pause_preserved'))
  }finally{f.db.sqlite.close()}
})
