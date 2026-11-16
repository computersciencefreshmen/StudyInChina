import assert from 'node:assert/strict'
import test from 'node:test'
import {selectRefillCandidates,dispatchRefillCandidates,readRefillDispatchStatus,declineRefillDispatch} from '../src/refill-dispatch'
import {refillProofBudget,REFILL_PROOF_TIME_MS} from '../src/refill-proof-budget'
import {canonical,digest} from '../src/util'
import {publishCoverageSnapshot} from '../src/coverage'
import {seedInput,TEST_CATALOG,TEST_SCOPE} from './fixture'
import {refillFixture,refillNow} from './refill-dispatch-fixture'
import {installUnknownProof} from './refill-proof-budget-fixture'
import {maintenanceRecordTargetSchema} from '../../../scripts/maintenance/field-contracts'

const select=(f:Awaited<ReturnType<typeof refillFixture>>,limit=8)=>selectRefillCandidates(f.env,{kind:'model',limit,excludeJobIds:[],now:refillNow})
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))

test('new priority-zero and review-urgent guides remain visible ahead of a persisted positive scan offset',async()=>{
 for(const urgency of ['priority','review']as const){
  const f=await refillFixture(40)
  try{
   f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done' WHERE stage<>'extract'")
   await select(f,1)
   const key=[...f.bucket.objects.keys()].find(key=>key.startsWith('maintenance/refill-dispatch/scan/'))!,hint=JSON.parse(await(await f.bucket.get(key))!.text())
   hint.offsets.programme=32;hint.visited=[];await f.bucket.put(key,canonical(hint))
   const urgent=f.jobs.filter(job=>job.stage==='extract').at(-1)!
   if(urgency==='priority')f.db.sqlite.prepare('UPDATE maintenance_jobs SET priority=0 WHERE job_id=?').run(urgent.jobId)
   else{
    const content={format:'studyinchina.school-program-coverage'as const,version:1 as const,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG,evaluatedOn:'2026-11-16',schools:seedInput().schools.map((school,index)=>({universityId:school.universityId,rawProgramCount:index===39?1:0,directoryProgramCount:index===39?1:0,currentProgramCount:index===39?1:0,minimumProgramCount:5 as const,gap:index===39?4:5,coverageBand:index===39?'one'as const:'zero'as const,countedProgramIds:index===39?['urgent-programme']:[],directoryScholarshipCount:0,currentScholarshipCount:0,reviewAfter:index===39?'2026-11-17':null}))}
    await publishCoverageSnapshot(f.env,{...content,sha256:await digest(canonical(content))},refillNow)
   }
   const plan=await select(f,1)
   assert.equal(plan.candidates[0]?.jobId,urgent.jobId,urgency)
   assert.equal(JSON.parse(await(await f.bucket.get(key))!.text()).offsets.programme,32,'urgent head does not reset the existing page cursor')
   assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
  }finally{f.db.sqlite.close()}
 }
})

test('seen urgent heads cannot crowd the last ordinary rows out of three complete cursor pages',async()=>{
 const f=await refillFixture(72)
 try{
  await select(f,1)
  f.db.sqlite.prepare("UPDATE maintenance_jobs SET priority=0 WHERE source_id=? AND stage<>'capture'").run(f.ids[0])
  const key=[...f.bucket.objects.keys()].find(key=>key.startsWith('maintenance/refill-dispatch/scan/'))!,hint=JSON.parse(await(await f.bucket.get(key))!.text())
  const fields=['job_id','source_id','stage','status','priority','due_at','created_at','updated_at','attempt','lease_token','lease_until','snapshot_sha256','snapshot_key','error_code','enqueued_at','target_ids_json']
  const pages:Array<Record<string,unknown>&{lane:string}>=[],heads:Array<Record<string,unknown>&{lane:string}>=[]
  for(const [stage,lane]of [['maintain','maintenance'],['extract','programme'],['award','award']]){
   const rows=f.db.sqlite.prepare('SELECT * FROM maintenance_jobs WHERE stage=? ORDER BY priority,due_at,job_id').all(stage).map((row):Record<string,unknown>&{lane:string}=>({...row,lane}))
   assert.equal(rows.filter(row=>row.priority===0).length,1)
   heads.push(rows[0]);pages.push(...rows.slice(32,64))
  }
  const tail=pages.toSorted((a,b)=>String(a.job_id).localeCompare(String(b.job_id))).slice(-3),ids=new Set(tail.map(row=>row.job_id))
  hint.offsets={maintenance:32,programme:32,award:32,future:0}
  hint.visited=await Promise.all([...heads,...pages.filter(row=>!ids.has(row.job_id))].map(async row=>({id:row.job_id,lane:row.lane,stamp:await digest(canonical(Object.fromEntries(fields.map(field=>[field,row[field]??null]))))})))
  assert.equal(hint.visited.length,96);await f.bucket.put(key,canonical(hint))
  const result=await select(f,3)
  assert.deepEqual(result.candidates.map(candidate=>candidate.jobId).sort(),[...ids].sort())
  assert.equal(result.selection.attempts,3)
  assert.deepEqual(JSON.parse(await(await f.bucket.get(key))!.text()).offsets,{maintenance:64,programme:64,award:64,future:0})
  assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
 }finally{f.db.sqlite.close()}
})

test('at most two complete candidate proofs overlap, with serialized hint CAS and stable planned order',async()=>{
 const f=await refillFixture(12)
 try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done' WHERE stage<>'extract'")
  const initial=await select(f,8),expected=initial.candidates.map(candidate=>candidate.jobId)
  for(const key of f.bucket.objects.keys())if(key.startsWith('maintenance/refill-dispatch/scan/'))f.bucket.objects.delete(key)
  let active=0,peak=0,hintWrites=0,hintPeak=0
  const db=f.env.PIPELINE_DB,put=f.bucket.put.bind(f.bucket),get=f.bucket.get.bind(f.bucket)
  f.env.PIPELINE_DB={prepare(sql){const original=db.prepare(sql);const wrap=(s:typeof original):typeof original=>({bind(...values){return wrap(s.bind(...values))},async first<T>(){if(sql==='SELECT * FROM maintenance_sources WHERE source_id=?'){active++;peak=Math.max(peak,active)}return s.first<T>()},all:s.all.bind(s),run:s.run.bind(s)});return wrap(original)},batch:db.batch.bind(db)}
  f.bucket.get=async key=>{await delay(10);return get(key)}
  f.bucket.put=async(key,body,options)=>{const hint=key.startsWith('maintenance/refill-dispatch/scan/');if(hint){hintWrites++;hintPeak=Math.max(hintPeak,hintWrites)}await delay(10);try{const result=await put(key,body,options);if(key.startsWith('maintenance/refill-dispatch/candidates/'))active--;return result}finally{if(hint)hintWrites--}}
  const plan=await select(f,8)
  assert.equal(plan.candidates.length,8);assert.deepEqual(plan.candidates.map(candidate=>candidate.jobId),expected)
  assert.equal(peak,2);assert.equal(active,0);assert.equal(hintPeak,1)
  assert.equal(plan.selection.attempts,8);assert.ok(plan.selection.cachedBytes<=16*1024*1024);assert.equal(f.messages.length,0)
 }finally{f.db.sqlite.close()}
})

test('a stalled maintenance proof cannot hide an already saved programme proof until after the shared deadline',{timeout:15000},async()=>{
 const f=await refillFixture(12)
 try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done' WHERE stage IN('capture','award'); UPDATE maintenance_jobs SET priority=1 WHERE stage='maintain'")
  const initial=await select(f,8)
  assert.equal(initial.candidates[0].stage,'maintain');assert.equal(initial.candidates[1].stage,'maintain')
  const programme=initial.candidates.find(candidate=>candidate.stage==='extract')!,blocked=initial.candidates[0].sourceId
  assert.notEqual(programme.sourceId,blocked)
  for(const key of f.bucket.objects.keys())if(key.startsWith('maintenance/refill-dispatch/scan/'))f.bucket.objects.delete(key)
  const get=f.bucket.get.bind(f.bucket);let stalled=0
  f.bucket.get=async key=>{if(key.includes(blocked)&&key.endsWith('.bin')){stalled++;return new Promise(()=>{})}return get(key)}
  const began=performance.now(),result=await select(f,8),elapsed=performance.now()-began
  assert.equal(stalled,1);assert.equal(result.selection.timedOut,true);assert.equal(result.selection.attempts,2)
  assert.ok(elapsed>=REFILL_PROOF_TIME_MS-100&&elapsed<12000)
  assert.deepEqual(result.candidates.map(candidate=>candidate.jobId),[programme.jobId])
  assert.ok(f.bucket.objects.has(result.candidates[0].proofKey))
  assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
 }finally{f.db.sqlite.close()}
})

test('one failed proof drains its bounded sibling before propagating a backend error',async()=>{
 const f=await refillFixture(4)
 try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done' WHERE stage<>'extract'")
  const initial=await select(f,2)
  for(const key of f.bucket.objects.keys())if(key.startsWith('maintenance/refill-dispatch/scan/'))f.bucket.objects.delete(key)
  const get=f.bucket.get.bind(f.bucket);let siblingFinished=false
  f.bucket.get=async key=>{
   if(key.endsWith('.bin')&&key.includes(initial.candidates[0].sourceId))throw Error('test_backend_failure')
   if(key.endsWith('.bin')&&key.includes(initial.candidates[1].sourceId)){await delay(100);siblingFinished=true}
   return get(key)
  }
  await assert.rejects(select(f,2),/test_backend_failure/)
  assert.equal(siblingFinished,true);assert.equal(f.messages.length,0)
 }finally{f.db.sqlite.close()}
})

test('repeated scans never defer a verified future retry or lose its precise due date',async()=>{
 const f=await refillFixture(1)
 try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done'")
  const job=f.jobs.find(j=>j.stage==='extract')!,due=new Date(refillNow+5000).toISOString()
  f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='retry',due_at=? WHERE job_id=?").run(due,job.jobId)
  for(let n=0;n<3;n++){const plan=await select(f,1);assert.equal(plan.candidates.length,0);assert.equal(plan.nextDueAt,due);assert.equal(plan.selection.attempts,1)}
 }finally{f.db.sqlite.close()}
})

test('fair preselection proves only the requested batch, reusing one-shot artifact bytes with50ms per I/O and a real unknown registry',{timeout:20000},async()=>{
 const f=await refillFixture(20)
 try{
  const guard=await installUnknownProof(f)
  for(const row of f.db.sqlite.prepare('SELECT target_id,target_json FROM maintenance_record_targets').all()){
   const target=JSON.parse(String(row.target_json));target.fields['supplementaryDetails.applicationMaterials']=Array.from({length:35},(_,i)=>({name:`Official material ${i}`,evidence:{quote:'Official programme-specific application condition '.repeat(20),sourceIds:target.sourceIds}}))
   assert.equal(maintenanceRecordTargetSchema.safeParse(target).success,true)
   f.db.sqlite.prepare('UPDATE maintenance_record_targets SET target_json=? WHERE target_id=?').run(canonical(target),row.target_id)
  }
  for(const[key,body]of f.bucket.objects)if(key.endsWith('.json')&&key.startsWith('maintenance/snapshots/')){const snapshot=JSON.parse(new TextDecoder().decode(body));snapshot.parserCandidates=Array.from({length:100},(_,i)=>({kind:'programme',name:`Degree ${i}`,quote:'Full official catalogue paragraph '.repeat(30),offset:i*100}));await f.bucket.put(key,canonical(snapshot))}
  const reads=new Map<string,number>(),get=f.bucket.get.bind(f.bucket)
  f.bucket.get=async key=>{await delay(50);reads.set(key,(reads.get(key)??0)+1);const object=await get(key);if(!object)return null;const response=new Response(await object.arrayBuffer());return{etag:object.etag,size:object.size,text:()=>response.text(),arrayBuffer:()=>response.arrayBuffer()}}
  const db=f.env.PIPELINE_DB
  f.env.PIPELINE_DB={prepare(sql){const original=db.prepare(sql);const wrap=(s:typeof original):typeof original=>({bind(...values){return wrap(s.bind(...values))},async first(){await delay(50);return s.first()},async all(){await delay(50);return s.all()},run:s.run.bind(s)});return wrap(original)},batch:db.batch.bind(db)}
  const started=performance.now(),plan=await select(f,2),elapsed=Math.ceil(performance.now()-started)
  assert.equal(plan.candidates.length,2);assert.equal(plan.selection.attempts,2);assert.equal(plan.selection.timedOut,false);assert.ok(elapsed<REFILL_PROOF_TIME_MS)
  assert.equal(reads.get(guard.key),1);assert.equal(reads.get('maintenance/runtime-model-guards/index.v1.json'),1)
  assert.ok(plan.selection.r2CacheHits>0);assert.ok(plan.selection.cachedBytes<=16*1024*1024)
  for(const key of reads.keys())if(key.startsWith('maintenance/snapshots/')||key.startsWith('maintenance/text/'))assert.equal(reads.get(key),1,key)
  assert.equal(f.messages.length,0)
  // Fresh dispatch must observe a mutation after the selector's cache dies.
  const chosen=plan.candidates[0],snapshot=JSON.parse(await(await get(chosen.snapshotKey!))!.text())
  await f.bucket.put(snapshot.rawKey,'changed-after-selection')
  const result=await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:'fresh-performance-dispatch',epochSha256:'e'.repeat(64),now:refillNow})
  assert.equal(result.sent.length,0);assert.equal(f.messages.length,0)
  console.log(JSON.stringify({proofBudgetFixture:{delayPerIoMs:50,wallElapsedMs:elapsed,...plan.selection,physicalR2ReadsIncludingFreshDispatch:[...reads.values()].reduce((n,v)=>n+v,0)}}))
 }finally{f.db.sqlite.close()}
})

test('eight failed proofs cannot pin the first page forever; a valid40th target is reached without changing jobs or outcomes',async()=>{
 const f=await refillFixture(40)
 try{
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='done' WHERE stage<>'maintain'")
  const valid=f.jobs.filter(j=>j.stage==='maintain').at(-1)!
  f.db.sqlite.prepare('UPDATE maintenance_record_targets SET target_json=? WHERE target_id NOT IN(SELECT target_id FROM maintenance_target_sources WHERE source_id=?)').run('{}',valid.sourceId)
  f.db.sqlite.prepare('UPDATE maintenance_jobs SET priority=100 WHERE job_id=?').run(valid.jobId)
  const before=canonical(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs ORDER BY job_id').all().map(r=>({...r})))
  let found=false,total=0
  for(let i=0;i<7;i++){const plan=await select(f,1);assert.ok(plan.selection.attempts<=8);total+=plan.selection.attempts;if(plan.candidates.length){assert.equal(plan.candidates[0].jobId,valid.jobId);found=true;break}assert.ok(plan.scanRetryAt)}
  assert.equal(found,true);assert.ok(total<=48)
  assert.equal(canonical(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs ORDER BY job_id').all().map(r=>({...r}))),before)
  assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
 }finally{f.db.sqlite.close()}
})

test('the8s deadline returns already persisted proofs, records scan progress and never waits forever for an R2 read',{timeout:15000},async()=>{
 const f=await refillFixture(5)
 try{
  const initial=await select(f,2);assert.equal(initial.candidates.length,2)
  for(const key of f.bucket.objects.keys())if(key.startsWith('maintenance/refill-dispatch/scan/'))f.bucket.objects.delete(key)
  const blocked=initial.candidates[1].sourceId,get=f.bucket.get.bind(f.bucket);let stalled=0
  f.bucket.get=async key=>{if(key.includes(blocked)&&key.endsWith('.bin')){stalled++;return new Promise(()=>{})}return get(key)}
  const began=performance.now(),result=await select(f,2),elapsed=performance.now()-began
  assert.equal(stalled,1);assert.equal(result.selection.timedOut,true);assert.ok(elapsed>=REFILL_PROOF_TIME_MS-100&&elapsed<12000)
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].jobId,initial.candidates[0].jobId);assert.ok(result.scanRetryAt)
  assert.equal(f.messages.length,0)
 }finally{f.db.sqlite.close()}
})

test('scan hints invalidate on scope/catalog/control changes and malformed hints never authorize a candidate',async()=>{
 const f=await refillFixture(8)
 try{
  const first=await select(f,1),second=await select(f,1);assert.notEqual(first.candidates[0].jobId,second.candidates[0].jobId)
  f.db.sqlite.exec('UPDATE maintenance_control SET revision=revision+1')
  const revision=await select(f,1);assert.equal(revision.candidates[0].jobId,first.candidates[0].jobId)
  const keys=[...f.bucket.objects.keys()].filter(k=>k.startsWith('maintenance/refill-dispatch/scan/'))
  for(const key of keys)await f.bucket.put(key,'{"offsets":{"maintenance":999999999},"proof":true}')
  const malformed=await select(f,1);assert.equal(malformed.candidates[0].jobId,first.candidates[0].jobId)
  f.db.sqlite.exec("UPDATE maintenance_jobs SET status='unknown'")
  assert.equal((await select(f,8)).candidates.length,0);assert.equal(f.messages.length,0)
 }finally{f.db.sqlite.close()}
})

test('ledger-only status skips current subject scans but preserves immutable proof, tuple and refusal receipt validation',async()=>{
 const f=await refillFixture(6)
 try{
  await installUnknownProof(f)
  const plan=await select(f,2),token='ledger-only-performance',epoch='e'.repeat(64)
  assert.equal((await dispatchRefillCandidates(f.env,plan.fence!,plan.candidates,{dispatchToken:token,epochSha256:epoch,now:refillNow})).sent.length,2)
  let reads=0;const get=f.bucket.get.bind(f.bucket);f.bucket.get=async key=>{reads++;return get(key)}
  const full=await readRefillDispatchStatus(f.env,token),fullReads=reads;reads=0
  const light=await readRefillDispatchStatus(f.env,token,{includeJobState:false})
  assert.equal(reads,2);assert.ok(fullReads>reads)
  assert.deepEqual(light.entries,full.entries.map(row=>({...row,job:null})))
  assert.equal((await declineRefillDispatch(f.env,{dispatchToken:token,epochSha256:epoch,jobId:plan.candidates[0].jobId,reason:'claim_rejected'})).declined,true)
  assert.ok((await readRefillDispatchStatus(f.env,token,{includeJobState:false})).entries.find(row=>row.jobId===plan.candidates[0].jobId)?.receivedNotStartedReceiptSha256)
  f.db.sqlite.exec("DELETE FROM maintenance_events WHERE kind='refill_received_not_started'")
  await assert.rejects(readRefillDispatchStatus(f.env,token,{includeJobState:false}),/refusal_receipt_missing/)
  await f.bucket.put(plan.candidates[1].proofKey,'{}')
  await assert.rejects(readRefillDispatchStatus(f.env,token,{includeJobState:false}))
 }finally{f.db.sqlite.close()}
})

test('invocation cache handles concurrent one-shot bodies, unknown-size objects and the16MiB retention bound',async()=>{
 const f=await refillFixture(1)
 try{
  let calls=0;const bodies:Response[]=[];f.env.SNAPSHOTS_BUCKET.get=async key=>{calls++;const data=new Uint8Array(key.startsWith('large')?9*1024*1024:4).fill(65),response=new Response(data);bodies.push(response);return{etag:'one-shot',...(key==='unknown'?{}:{size:data.length}),text:()=>response.text(),arrayBuffer:()=>response.arrayBuffer()}}
  const budget=refillProofBudget(f.env)
  const pair=await Promise.all([budget.env.SNAPSHOTS_BUCKET.get('small'),budget.env.SNAPSHOTS_BUCKET.get('small')]);assert.equal(await pair[0]!.text(),'AAAA');assert.equal((await pair[1]!.arrayBuffer()).byteLength,4);assert.equal(calls,1)
  const uncached=await Promise.all([budget.env.SNAPSHOTS_BUCKET.get('unknown'),budget.env.SNAPSHOTS_BUCKET.get('unknown')]);assert.equal(await uncached[0]!.text(),'AAAA');assert.equal(await uncached[1]!.text(),'AAAA')
  await(await budget.env.SNAPSHOTS_BUCKET.get('large'))!.arrayBuffer();await(await budget.env.SNAPSHOTS_BUCKET.get('large-two'))!.arrayBuffer()
  assert.ok(budget.diagnostics().cachedBytes<=16*1024*1024)
  assert.equal(calls,5);assert.equal(bodies.every(body=>body.bodyUsed),true,'every acquired one-shot body is consumed; uncached reads do not abandon the initial object')
 }finally{f.db.sqlite.close()}
})
