import assert from 'node:assert/strict'
import test from 'node:test'
import {canonical} from '../src/util'
import {planDueCaptureJobs,claimJob} from '../src/repository'
import {selectRefillCandidates,dispatchRefillCandidates,readRefillDispatchStatus,observeRefillDispatch,declineRefillDispatch} from '../src/refill-dispatch'
import {BUDGET_POLICY_KEY} from '../../shared/background-budget'
import {refillFixture,refillNow} from './refill-dispatch-fixture'

const epoch='e'.repeat(64),select=(f:Awaited<ReturnType<typeof refillFixture>>,kind:'model'|'capture',limit=8,now=refillNow)=>selectRefillCandidates(f.env,{kind,limit,excludeJobIds:[],now})
test('independent reservoirs do not let captures replace proven model jobs; bounded claims precede every queue send and are idempotent',async()=>{
 const f=await refillFixture();try{
  const plan=await select(f,'model'),captures=await select(f,'capture',2)
  assert.equal(plan.candidates.length,8);assert.ok(plan.candidates.every(c=>c.stage!=='capture'));assert.equal(captures.candidates.length,2)
  const send=f.env.MAINTENANCE_QUEUE.send.bind(f.env.MAINTENANCE_QUEUE)
  f.env.MAINTENANCE_QUEUE.send=async(message,options)=>{const row=f.db.sqlite.prepare('SELECT status,candidate_json FROM maintenance_refill_dispatches WHERE job_id=?').get(message.jobId);assert.equal(row?.status,'prepared');assert.ok(f.db.sqlite.prepare('SELECT enqueued_at FROM maintenance_jobs WHERE job_id=?').get(message.jobId)?.enqueued_at);return send(message,options)}
  const result=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'dispatch-first',epochSha256:epoch,now:refillNow})
  assert.equal(result.sent.length,8);assert.equal(result.unconfirmed.length,0);assert.equal(f.messages.length,8)
  const replay=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'dispatch-first',epochSha256:epoch,now:refillNow});assert.equal(replay.sent.length,8);assert.equal(f.messages.length,8)
  assert.equal((await readRefillDispatchStatus(f.env,'dispatch-first')).entries.length,8)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
 }finally{f.db.sqlite.close()}
})

test('lost queue or claim replies are durable uncertain sends and never replayed by token, timeout or another owner',async()=>{
 for(const mode of ['queue','claim']as const){const f=await refillFixture(5);try{
  const plan=await select(f,'model',1)
  if(mode==='queue')f.env.MAINTENANCE_QUEUE.send=async()=>{throw Error('unknown queue result')}
  else{const batch=f.db.batch.bind(f.db);f.db.batch=async<T>(statements:Parameters<typeof f.db.batch>[0])=>{await batch<T>(statements);throw Error('commit reply lost')}}
  const result=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'dispatch-uncertain',epochSha256:epoch,now:refillNow});assert.deepEqual(result.unconfirmed,[plan.candidates[0].jobId])
  assert.equal(await observeRefillDispatch(f.env,'dispatch-uncertain',plan.candidates[0].jobId),false)
  const later=await select(f,'model',8,refillNow+900001);assert.ok(!later.candidates.some(c=>c.jobId===plan.candidates[0].jobId))
  const repeated=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'dispatch-uncertain',epochSha256:epoch,now:refillNow});assert.equal(repeated.unconfirmed.length,1)
  const expired=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'dispatch-uncertain',epochSha256:epoch,now:refillNow+86400000});assert.equal(expired.unconfirmed.length,1);assert.equal(expired.notSent.length,0)
  f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='retry',attempt=1 WHERE job_id=?").run(plan.candidates[0].jobId)
  assert.equal(await observeRefillDispatch(f.env,'dispatch-uncertain',plan.candidates[0].jobId),true)
  assert.equal((await readRefillDispatchStatus(f.env,'dispatch-uncertain')).entries[0].status,'observed')
 }finally{f.db.sqlite.close()}}
})

test('late control/job/source/target/association/unknown/STOP races roll back the exact atomic claim without sending',async()=>{
 for(const race of ['pause','revision','catalogue','job','source','target','association','unknown','stop']as const){const f=await refillFixture(5);try{
  if(race==='target')f.db.sqlite.exec("UPDATE maintenance_jobs SET status='held' WHERE stage<>'maintain'")
  const plan=await select(f,'model',1),chosen=plan.candidates[0],batch=f.db.batch.bind(f.db);let injected=false
  f.db.batch=async<T>(statements:Parameters<typeof f.db.batch>[0])=>{if(!injected){injected=true
   if(race==='pause')f.db.sqlite.exec('UPDATE maintenance_control SET enabled=0')
   if(race==='revision')f.db.sqlite.exec('UPDATE maintenance_control SET revision=revision+1')
   if(race==='catalogue')f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run('a'.repeat(64))
   if(race==='job')f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='unknown' WHERE job_id=?").run(chosen.jobId)
   if(race==='source')f.db.sqlite.prepare('UPDATE maintenance_sources SET allowed_hosts_json=? WHERE source_id=?').run('["different.edu.cn"]',chosen.sourceId)
   if(race==='target')f.db.sqlite.prepare('UPDATE maintenance_record_targets SET target_json=? WHERE target_id IN(SELECT target_id FROM maintenance_target_sources WHERE source_id=?)').run('{}',chosen.sourceId)
   if(race==='association')f.db.sqlite.prepare('DELETE FROM maintenance_source_schools WHERE source_id=?').run(chosen.sourceId)
   if(race==='unknown')f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('key','late-unknown',?,'raw','primary','request','MiniMax-M3','unknown','now','{}')").run(chosen.sourceId)
   if(race==='stop')f.db.sqlite.prepare("INSERT INTO maintenance_legacy_guards VALUES('new-stop',NULL,?,NULL,'\"*\"','stop','hash','operator-stop',NULL)").run(chosen.sourceId)
  }return batch<T>(statements)}
  const result=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:`dispatch-${race}`,epochSha256:epoch,now:refillNow});assert.equal(result.sent.length,0,race);assert.equal(f.messages.length,0,race);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_refill_dispatches').get()?.n,0,race);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n,0,race)
 }finally{f.db.sqlite.close()}}
})

test('future due hints wake only executable scoped retries; disabled, unknown, stale and protected sources cannot become candidates',async()=>{
 const f=await refillFixture(5);try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done'")
  const job=f.jobs.find(j=>j.stage==='extract')!,due=new Date(refillNow+5000).toISOString()
  f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='retry',due_at=? WHERE job_id=?").run(due,job.jobId)
  const plan=await select(f,'model',1);assert.equal(plan.candidates.length,0);assert.equal(plan.nextDueAt,due)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run('a'.repeat(64),job.sourceId)
  assert.equal((await select(f,'model',1)).nextDueAt,null)
  await f.bucket.put(BUDGET_POLICY_KEY,'{}');assert.equal((await select(f,'capture',1)).fence,null)
 }finally{f.db.sqlite.close()}
})

test('single-slot continuous allocation preserves 30/70 and programme/award 2:1 without waiting for a new fifteen-minute tick',async()=>{
 const f=await refillFixture(40);try{
  let maintenance=0,program=0,awards=0
  for(let i=0;i<30;i++){
   const now=refillNow+i*1000,plan=await select(f,'model',1,now);assert.equal(plan.candidates.length,1)
   const chosen=plan.candidates[0];maintenance+=chosen.stage==='maintain'?1:0;program+=chosen.stage==='extract'?1:0;awards+=chosen.stage==='award'?1:0
   assert.equal((await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:`continuous-${i}`,epochSha256:epoch,now})).sent.length,1)
   f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='done',attempt=1 WHERE job_id=?").run(chosen.jobId);assert.equal(await observeRefillDispatch(f.env,`continuous-${i}`,chosen.jobId),true)
  }
  assert.equal(maintenance,9);assert.equal(program,14);assert.equal(awards,7)
 }finally{f.db.sqlite.close()}
})

test('large priority-one maintenance pools cannot consume expansion SQL reservoirs or proof budgets for limit1 or8',async()=>{
 for(const limit of [1,8]){const f=await refillFixture(40);try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET priority=1 WHERE stage='maintain'")
  const baseline=f.db.sqlite.prepare("SELECT * FROM maintenance_jobs WHERE stage<>'capture'").all()
  // A school with many finite jobs still gets one round before its second;
  // nonmaintenance pools remain visible even behind >96 higher-priority rows.
  for(let n=1;n<4;n++)for(const row of baseline){const copy={...row,job_id:String(row.job_id)+`-extra-${n}`};if(row.stage!=='maintain')continue;f.db.sqlite.prepare(`INSERT INTO maintenance_jobs(${Object.keys(copy).join(',')}) VALUES(${Object.keys(copy).map(()=>'?').join(',')})`).run(...Object.values(copy)as never[])}
  let maintain=0,program=0,award=0
  for(let round=0;round<30;round++){
   const now=refillNow+round*1000,plan=await select(f,'model',limit,now);assert.equal(plan.candidates.length,limit)
   for(const c of plan.candidates){maintain+=c.stage==='maintain'?1:0;program+=c.stage==='extract'?1:0;award+=c.stage==='award'?1:0}
   const token=`priority-pool-${limit}-${round}`;assert.equal((await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:token,epochSha256:epoch,now})).sent.length,limit)
   // Preserve the finite available pool for this scheduling regression only.
   // Observed delivery+increased attempt permits a fresh logical retry.
   for(const c of plan.candidates){f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='retry',attempt=attempt+1,enqueued_at=NULL WHERE job_id=?").run(c.jobId);assert.equal(await observeRefillDispatch(f.env,token,c.jobId),true)}
  }
  assert.equal(maintain,limit*9);assert.equal(program,limit*14);assert.equal(award,limit*7)
 }finally{f.db.sqlite.close()}}
})

test('model budget reserve excludes expansion only, and a corrupt proof or changed token cannot authorize sending',async()=>{
 const f=await refillFixture();try{
  const maintenance=await selectRefillCandidates(f.env,{kind:'model',limit:8,excludeJobIds:[],now:refillNow,allowExpansion:false});assert.ok(maintenance.candidates.every(c=>c.stage==='maintain'))
  const c=maintenance.candidates[0],raw=await f.bucket.get(c.proofKey);assert.ok(raw);await f.bucket.put(c.proofKey,canonical({changed:true}))
  await assert.rejects(dispatchRefillCandidates(f.env,maintenance.fence!,maintenance.candidates,{dispatchToken:'corrupted-proof',epochSha256:epoch,now:refillNow}),/candidate_proof_corrupt/);assert.equal(f.messages.length,0)
 }finally{f.db.sqlite.close()}
})

test('capture planning is persistence-only and creates at most64 new jobs per epoch, including concurrent or repeated watchdogs',async()=>{
 const f=await refillFixture(90);try{
  f.db.sqlite.exec('DELETE FROM maintenance_jobs');f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(refillNow-1000).toISOString())
  const first=await planDueCaptureJobs(f.env,refillNow),second=await planDueCaptureJobs(f.env,refillNow+1000)
  assert.equal(first.plannedCaptureJobs,64);assert.equal(second.plannedCaptureJobs,0);assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,64)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
 }finally{f.db.sqlite.close()}
})

test('a confirmed preclaim refusal closes only its exact dispatch; a late delivery cannot claim it and unknown/running races refuse cleanup',async()=>{
 for(const mode of ['decline','claimed','historical-unknown','job-unknown','race']as const){const f=await refillFixture(5);try{
  const plan=await select(f,'model',1),c=plan.candidates[0],token=`refusal-${mode}`,delivery={dispatchToken:token,epochSha256:epoch}
  await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{...delivery,now:refillNow})
  if(mode==='claimed')assert.ok(await claimJob(f.env,c.jobId,refillNow,delivery))
  if(mode==='historical-unknown')f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('key','uncertain',?,'raw','primary','request','MiniMax-M3','unknown','now','{}')").run(c.sourceId)
  if(mode==='job-unknown')f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='unknown' WHERE job_id=?").run(c.jobId)
  if(mode==='race'){const batch=f.db.batch.bind(f.db);f.db.batch=async<T>(statements:Parameters<typeof f.db.batch>[0])=>{assert.ok(await claimJob(f.env,c.jobId,refillNow,delivery));return batch<T>(statements)}}
  const result=await declineRefillDispatch(f.env,{...delivery,jobId:c.jobId,reason:'claim_rejected'})
  assert.equal(result.declined,mode==='decline'||mode==='historical-unknown')
  if(mode==='historical-unknown')assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts WHERE attempt_id=?').get('uncertain')?.status,'unknown')
  if(mode==='decline'){
   assert.equal(await claimJob(f.env,c.jobId,refillNow,delivery),null)
   assert.equal(f.db.sqlite.prepare('SELECT enqueued_at FROM maintenance_jobs WHERE job_id=?').get(c.jobId)?.enqueued_at,null)
   const status=await readRefillDispatchStatus(f.env,token);assert.equal(status.entries[0].resolution,'received_not_started');assert.match(status.entries[0].receivedNotStartedReceiptSha256!,/^[a-f0-9]{64}$/)
   assert.equal((await declineRefillDispatch(f.env,{...delivery,jobId:c.jobId,reason:'claim_rejected'})).declined,true)
   f.db.sqlite.prepare("DELETE FROM maintenance_events WHERE kind='refill_received_not_started'").run();await assert.rejects(readRefillDispatchStatus(f.env,token),/refusal_receipt_missing/)
  }
 }finally{f.db.sqlite.close()}}
})

test('old model unknown evidence blocks model replay while a new official capture remains eligible without resetting any old outcome',async()=>{
 const f=await refillFixture(5);try{
  const id=f.ids[0];f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('key','old-unknown',?,'raw','primary','request','MiniMax-M3','unknown','now','{}')").run(id)
  assert.ok(!(await select(f,'model')).candidates.some(c=>c.sourceId===id))
  const captures=await select(f,'capture',8);assert.ok(captures.candidates.some(c=>c.sourceId===id))
  assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts WHERE attempt_id=?').get('old-unknown')?.status,'unknown')
 }finally{f.db.sqlite.close()}
})

test('budget holds allow only exact bounded preclaim cleanup, while the frozen source touches no storage',async()=>{
 const f=await refillFixture(5);try{
  const plan=await select(f,'model',1),c=plan.candidates[0],delivery={dispatchToken:'budget-cleanup',epochSha256:epoch}
  await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{...delivery,now:refillNow})
  const messages=f.messages.length;await f.bucket.put(BUDGET_POLICY_KEY,'{}')
  assert.equal((await select(f,'model',1)).fence,null)
  assert.equal((await declineRefillDispatch(f.env,{...delivery,jobId:c.jobId,reason:'budget_wait'})).declined,true)
  assert.equal(f.messages.length,messages);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
  const frozen={...f.env,MODEL_STATE_MIGRATION_ROLE:'source',PIPELINE_DB:{prepare(){throw Error('frozen_storage_forbidden')},async batch(){throw Error('frozen_storage_forbidden')}},SNAPSHOTS_BUCKET:{async get(){throw Error('frozen_bucket_forbidden')},async put(){throw Error('frozen_bucket_forbidden')}}}
  assert.equal((await declineRefillDispatch(frozen,{...delivery,jobId:c.jobId,reason:'budget_wait'})).declined,false)
 }finally{f.db.sqlite.close()}
})

test('concurrent dispatch owners cannot send one job twice; wrong epoch/token cannot claim a delivered job',async()=>{
 const f=await refillFixture(5);try{
  const plan=await select(f,'model',1),c=plan.candidates[0]
  const results=await Promise.all(['concurrent-owner-a','concurrent-owner-b'].map(dispatchToken=>dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken,epochSha256:epoch,now:refillNow})))
  assert.equal(results.reduce((n,r)=>n+r.sent.length,0),1);assert.equal(f.messages.length,1)
  const delivery=(f.messages[0]as unknown as{refill:{dispatchToken:string;epochSha256:string}}).refill
  assert.equal(await claimJob(f.env,c.jobId,refillNow,{...delivery,epochSha256:'f'.repeat(64)}),null)
  assert.equal(await claimJob(f.env,c.jobId,refillNow,{...delivery,dispatchToken:'a-different-owner'}),null)
  assert.ok(await claimJob(f.env,c.jobId,refillNow,delivery));assert.equal(await claimJob(f.env,c.jobId,refillNow,delivery),null)
 }finally{f.db.sqlite.close()}
})

test('refill selection probes ready stage/status/due indexes without historical fact or whole-ledger counts',async()=>{
 const f=await refillFixture(5);try{
  const prepare=f.db.prepare.bind(f.db);let sql='',params:unknown[]=[]
  f.db.prepare=query=>{const statement=prepare(query);if(query.includes('lane_order<=32')){sql=query;const bind=statement.bind.bind(statement);statement.bind=(...values:unknown[])=>{params=values;return bind(...values)}}return statement}
  await select(f,'model',1)
  assert.ok(sql);assert.ok(!/COUNT\s*\(/i.test(sql))
  const plan=f.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params as never[]).map(row=>String(row.detail)).join('\n')
  assert.match(plan,/SEARCH j USING INDEX maintenance_refill_job_stage_due/)
  assert.ok(!/SCAN maintenance_model_attempts|SCAN maintenance_jobs/.test(plan))
 }finally{f.db.sqlite.close()}
})
