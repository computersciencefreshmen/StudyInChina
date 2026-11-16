import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueueDue,planDueCaptureJobs } from '../src/repository'
import { BUDGET_POLICY_KEY } from '../../shared/background-budget'
import { canonical } from '../src/util'
import { refillFixture,refillNow } from './refill-dispatch-fixture'
import { verifyIdleLeaseRecovery } from './refill-lease-recovery-fixture'

test('idle watchdog and coordinator restarts recover only capture permits; model outcomes and requests remain protected',async()=>{
 const f=await refillFixture(3)
 try{
  const captures=f.jobs.filter(j=>j.stage==='capture').slice(0,2),model=f.jobs.find(j=>j.sourceId===f.ids[2]&&j.stage==='extract')!
  await f.storage.put('request:original',{status:'send_started',requestSha256:'original',reservationKey:'unchanged'})
  const originalRequests=canonical([...f.storage.values]),sql="INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('original','original',?,'raw','primary','request','MiniMax-M3','send_started','2026-11-16T03:59:00Z','{}')"
  // Insert the actual send record after acquire/claim, just as a consumer would.
  let inserted=false
  await verifyIdleLeaseRecovery(f.env,{capture:captures.map(j=>j.jobId),model:model.jobId},async()=>{
   if(!inserted){inserted=true;f.db.sqlite.prepare(sql).run(model.sourceId)}
   assert.equal(canonical([...f.storage.values]),originalRequests)
   return canonical(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all().map(row=>({...row})))
  })
  assert.equal(f.db.sqlite.prepare("SELECT status FROM maintenance_model_attempts WHERE attempt_id='original'").get()?.status,'send_started')
 }finally{f.db.sqlite.close()}
})

test('capture planning recovers at most64 leases per watchdog even after the epoch plan already exists; the old scheduler policy remains unchanged',async()=>{
 for(const mode of ['capture_plan_only','full']as const){
  const f=await refillFixture(20)
  try{
   await planDueCaptureJobs(f.env,refillNow)
   f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='running',attempt=3,lease_token='lost',lease_until=?,enqueued_at=?").run(new Date(refillNow-1).toISOString(),new Date(refillNow-600000).toISOString())
   await enqueueDue(f.env,refillNow,mode)
   assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='running'").get()?.n,mode==='full'?0:16)
   if(mode==='capture_plan_only')await enqueueDue(f.env,refillNow+1,mode)
   assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='running'").get()?.n,0)
   assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs WHERE attempt<>3').get()?.n,0)
   assert.equal(f.messages.length,0)
  }finally{f.db.sqlite.close()}
 }
})

test('freeze, budget, native readiness, pause and administrative-only gates forbid lease recovery',async()=>{
 for(const gate of ['source','budget','native','deployment','pause','seed','targets','administrative']as const){
  const f=await refillFixture(1)
  try{
   f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='running',attempt=2,lease_token='retained',lease_until=?").run(new Date(refillNow-1).toISOString())
   if(gate==='source')f.env.MODEL_STATE_MIGRATION_ROLE='source'
   if(gate==='budget')await f.bucket.put(BUDGET_POLICY_KEY,'{}')
   if(gate==='native')f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
   if(gate==='deployment')f.env.MAINTENANCE_ENABLED='false'
   if(gate==='pause')f.db.sqlite.exec('UPDATE maintenance_control SET enabled=0')
   if(gate==='seed')f.db.sqlite.exec('UPDATE maintenance_control SET seed_complete=0')
   if(gate==='targets')f.db.sqlite.exec('UPDATE maintenance_control SET targets_complete=0')
   const before=canonical(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all().map(row=>({...row})))
   if(gate==='administrative')await enqueueDue(f.env,refillNow,'administrative_only');else await planDueCaptureJobs(f.env,refillNow)
   assert.equal(canonical(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all().map(row=>({...row}))),before,gate)
   assert.equal(f.messages.length,0)
  }finally{f.db.sqlite.close()}
 }
 const frozen=await refillFixture(1)
 try{frozen.env.MODEL_STATE_MIGRATION_ROLE='source';frozen.db.prepare=()=>{throw Error('source_D1_forbidden')};frozen.bucket.get=async()=>{throw Error('source_R2_forbidden')};await planDueCaptureJobs(frozen.env,refillNow);await enqueueDue(frozen.env,refillNow,'capture_plan_only')}finally{frozen.db.sqlite.close()}
})

test('a late operator revision or renewed execution lease cannot be overwritten by recovery',async()=>{
 for(const race of ['revision','renewal']as const){
  const f=await refillFixture(1)
  try{
   const until=new Date(refillNow-1).toISOString();f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='running',lease_token='old',lease_until=?").run(until)
   const prepare=f.db.prepare.bind(f.db);let injected=false
   f.db.prepare=sql=>{if(!injected&&sql.startsWith('UPDATE maintenance_jobs SET status=CASE')){injected=true;if(race==='revision')f.db.sqlite.exec('UPDATE maintenance_control SET revision=revision+1');else f.db.sqlite.prepare('UPDATE maintenance_jobs SET lease_until=?').run(new Date(refillNow+600000).toISOString())}return prepare(sql)}
   if(race==='revision')await assert.rejects(planDueCaptureJobs(f.env,refillNow),/CHECK/);else await planDueCaptureJobs(f.env,refillNow)
   assert.equal(injected,true);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='running'").get()?.n,4)
  }finally{f.db.sqlite.close()}
 }
})
