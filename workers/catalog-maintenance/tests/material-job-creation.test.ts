import assert from 'node:assert/strict'
import test from 'node:test'
import { materialJobVersion } from '../src/material-job-version'
import { materialBatchJobId,readMaterialBatchContract } from '../src/material-batch-contract'
import { queueExtraction,seed,source } from '../src/repository'
import type { JobRow,MaintenanceEnv,RecordTarget } from '../src/types'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

export async function materialCreationFixture(){
  const f=makeEnv(),sourceId=await digest('https://test.edu.cn/catalog'),raw='e'.repeat(64),now=Date.now()
  const targets:RecordTarget[]=Array.from({length:17},(_,index)=>({recordId:`programme-${index}`,entityType:'program',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:scopeHash(index),identity:{name:{en:`Programme ${index}`},degreeLevel:'master'},year:null,intake:null,fields:{},reviewAfter:'2026-11-16'}))
  await seed(f.env,{...seedInput(),recordTargets:targets},now)
  const row=await source(f.env,sourceId);assert.ok(row)
  return{...f,env:f.env as MaintenanceEnv&{MODEL_BATCH_CONTRACT_VERSION?:string},sourceId,row,raw,now,key:`maintenance/snapshots/${sourceId}/${raw}.json`,targets}
}
const scopeHash=(index:number)=>index.toString(16).padStart(64,'a')
const rows=(f:Awaited<ReturnType<typeof materialCreationFixture>>)=>f.db.sqlite.prepare('SELECT * FROM maintenance_jobs ORDER BY job_id').all()as unknown as JobRow[]
test('new explicit v2 creation retains every target exactly once at 8/5, and repeated creation/rollback retains the original rows and hashes',async()=>{
  const f=await materialCreationFixture()
  try{
    f.env.MODEL_BATCH_CONTRACT_VERSION='2'
    await queueExtraction(f.env,f.row,f.raw,f.key,f.now)
    const jobs=rows(f),fields=jobs.filter(j=>j.stage==='maintain'&&JSON.parse(j.target_ids_json!).kind==='field-maintenance'),cycles=jobs.filter(j=>j.stage==='maintain'&&JSON.parse(j.target_ids_json!).kind==='cycle-discovery')
    assert.equal(jobs.length,8);assert.deepEqual(fields.map(j=>JSON.parse(j.target_ids_json!).targets.length).sort((a,b)=>a-b),[1,8,8]);assert.deepEqual(cycles.map(j=>JSON.parse(j.target_ids_json!).targets.length).sort((a,b)=>a-b),[2,5,5,5])
    for(const group of [fields,cycles])assert.deepEqual(group.flatMap(j=>JSON.parse(j.target_ids_json!).targets.map((p:{id:string})=>p.id)).sort(),f.targets.map(t=>`program:${t.recordId}`).sort())
    for(const job of jobs)assert.equal(await readMaterialBatchContract(job,job.stage==='extract'?'program':JSON.parse(job.target_ids_json!).kind==='cycle-discovery'?'cycles':'fields'),2)
    const before=JSON.stringify(jobs)
    await queueExtraction(f.env,f.row,f.raw,f.key,f.now+1000);delete f.env.MODEL_BATCH_CONTRACT_VERSION;await queueExtraction(f.env,f.row,f.raw,f.key,f.now+2000)
    assert.equal(JSON.stringify(rows(f)),before);assert.equal(f.messages.length,0)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
  }finally{f.db.sqlite.close()}
})
test('existing v1 queued/paid/unknown jobs never gain v2 aliases after enabling the new contract',async()=>{
  const f=await materialCreationFixture()
  try{
    await queueExtraction(f.env,f.row,f.raw,f.key,f.now)
    f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='unknown' WHERE stage='extract'").run()
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('old-paid','old-paid',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(f.sourceId,f.raw,'b'.repeat(64),new Date(f.now).toISOString())
    const before=JSON.stringify(rows(f)),ledger=JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all())
    f.env.MODEL_BATCH_CONTRACT_VERSION='2';await queueExtraction(f.env,f.row,f.raw,f.key,f.now+1000)
    assert.equal(JSON.stringify(rows(f)),before);assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all()),ledger)
    assert.ok(rows(f).every(j=>!j.target_ids_json||Array.isArray(JSON.parse(j.target_ids_json))||JSON.parse(j.target_ids_json).contractVersion===undefined))
  }finally{f.db.sqlite.close()}
})
test('an orphan model ledger remains protected even if an unrelated capture has the same snapshot',async()=>{
  const f=await materialCreationFixture()
  try{
    f.env.MODEL_BATCH_CONTRACT_VERSION='2'
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256) VALUES('capture-only',?,'capture','done',?,?,?,?)").run(f.sourceId,new Date(f.now).toISOString(),new Date(f.now).toISOString(),new Date(f.now).toISOString(),f.raw)
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('orphan','orphan',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(f.sourceId,f.raw,'b'.repeat(64),new Date(f.now).toISOString())
    await assert.rejects(queueExtraction(f.env,f.row,f.raw,f.key,f.now),/orphan_history_requires_review/u)
    assert.equal(rows(f).length,1);assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'unknown')
  }finally{f.db.sqlite.close()}
})
test('unclassifiable maintain history is not filtered out into a fresh cycle or field scope',async()=>{
  for(const body of ['not-json',JSON.stringify({kind:'unrecognized',contractVersion:2,targets:[]}),JSON.stringify({kind:'field-maintenance',contractVersion:2,targets:[]}),JSON.stringify(23)]){
    const f=await materialCreationFixture()
    try{
      f.env.MODEL_BATCH_CONTRACT_VERSION='2'
      f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,target_ids_json) VALUES('malformed',?,'maintain','held',?,?,?,?,?)").run(f.sourceId,new Date(f.now).toISOString(),new Date(f.now).toISOString(),new Date(f.now).toISOString(),f.raw,body)
      await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,'fields'),/history_requires_review/u)
      if(!body.includes('field-maintenance'))await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,'cycles'),/history_requires_review/u)
      await assert.rejects(queueExtraction(f.env,f.row,f.raw,f.key,f.now),/history_requires_review/u);assert.equal(rows(f).length,1)
    }finally{f.db.sqlite.close()}
  }
})
test('a competing v1 creator or orphan ledger introduced after selection rolls back every v2 row atomically',async()=>{
  for(const race of ['v1','orphan']){
    const f=await materialCreationFixture()
    try{
      f.env.MODEL_BATCH_CONTRACT_VERSION='2';const oldBatch=f.env.PIPELINE_DB.batch.bind(f.env.PIPELINE_DB)
      f.env.PIPELINE_DB.batch=async statements=>{
        if(race==='v1'){
          const id=await materialBatchJobId({engine:'program',sourceId:f.sourceId,snapshotSha256:f.raw,createdAt:new Date(f.now).toISOString(),version:1})
          f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256) VALUES(?,?,'extract','done',?,?,?,?)").run(id,f.sourceId,new Date(f.now).toISOString(),new Date(f.now).toISOString(),new Date(f.now).toISOString(),f.raw)
        }else f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('racing-orphan','racing-orphan',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(f.sourceId,f.raw,'b'.repeat(64),new Date(f.now).toISOString())
        return oldBatch(statements)
      }
      await assert.rejects(queueExtraction(f.env,f.row,f.raw,f.key,f.now))
      assert.equal(rows(f).length,race==='v1'?1:0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n,0);assert.equal(f.messages.length,0)
    }finally{f.db.sqlite.close()}
  }
})
