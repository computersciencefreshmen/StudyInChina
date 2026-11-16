import assert from 'node:assert/strict'
import test from 'node:test'
import { materialJobVersion,materialJobVersionGuard } from '../src/material-job-version'
import { seed } from '../src/repository'
import { digest } from '../src/util'
import type { MaintenanceEnv } from '../src/types'
import { makeEnv,seedInput } from './fixture'

async function fixture(){
  const f=makeEnv();await seed(f.env,seedInput());const sourceId=await digest('https://test.edu.cn/catalog'),raw='d'.repeat(64),now='2026-11-16T00:00:00.000Z'
  const add=(id:string,stage:string,scope:unknown,status='queued')=>f.db.sqlite.prepare('INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,target_ids_json) VALUES(?,?,?,?,?,?,?,?,?)').run(id,sourceId,stage,status,now,now,now,raw,scope===null?null:JSON.stringify(scope))
  return{...f,env:f.env as MaintenanceEnv&{MODEL_BATCH_CONTRACT_VERSION?:string},sourceId,raw,now,add}
}
test('new version-two material jobs are opt-in, while existing paid v1 and v2 scopes keep their contracts',async()=>{
  const f=await fixture()
  try{
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'program'),1)
    f.env.MODEL_BATCH_CONTRACT_VERSION='2';assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'program'),2)
    f.add('old','extract',null,'unknown')
    const before=f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all()
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'program'),1)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all(),before)
    f.add('v2','award',{kind:'identity',contractVersion:2},'done');delete f.env.MODEL_BATCH_CONTRACT_VERSION
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'scholarship'),2)
  }finally{f.db.sqlite.close()}
})
test('field and cycle purposes remain separate and mixed or malformed contract history requires review',async()=>{
  const f=await fixture()
  try{
    f.env.MODEL_BATCH_CONTRACT_VERSION='2'
    f.add('old-cycle','maintain',{kind:'cycle-discovery',targets:[]},'done')
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'cycles'),1)
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'fields'),2)
    f.add('new-field','maintain',{kind:'field-maintenance',contractVersion:2,targets:[{id:'program:p',sha256:'a'.repeat(64)}]})
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'fields'),2)
    f.add('old-field','maintain',[])
    await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,'fields'),/material_batch_history_requires_review/)
    f.add('invalid','award',{kind:'identity',contractVersion:'2'})
    await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,'scholarship'),/material_batch_history_requires_review/)
  }finally{f.db.sqlite.close()}
})
test('orphan imported reservations cannot become a fresh v2 key, but another purpose with a real job is not an orphan',async()=>{
  const f=await fixture()
  try{
    f.env.MODEL_BATCH_CONTRACT_VERSION='2'
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run('request','attempt',f.sourceId,f.raw,'a'.repeat(64),f.now)
    await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,'program'),/material_batch_orphan_history_requires_review/)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'unknown')
    f.add('existing-identity','extract',null,'unknown')
    assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'fields'),2)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,1)
  }finally{f.db.sqlite.close()}
})

test('unclassifiable maintain envelopes cannot disappear from one purpose and authorize a fresh contract',async()=>{
  for(const body of ['broken-json',JSON.stringify({kind:'unknown',contractVersion:2,targets:[]}),JSON.stringify(23)]){
    const f=await fixture()
    try{
      f.env.MODEL_BATCH_CONTRACT_VERSION='2'
      f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,target_ids_json) VALUES('unclassified',?,'maintain','held',?,?,?,?,?)").run(f.sourceId,f.now,f.now,f.now,f.raw,body)
      for(const engine of ['fields','cycles']as const)await assert.rejects(materialJobVersion(f.env,f.sourceId,f.raw,engine),/history_requires_review/u)
    }finally{f.db.sqlite.close()}
  }
})

test('the final version guard closes a rolling-deploy race without deleting the competing original job',async()=>{
  const f=await fixture()
  try{
    f.env.MODEL_BATCH_CONTRACT_VERSION='2';assert.equal(await materialJobVersion(f.env,f.sourceId,f.raw,'program'),2)
    f.add('v1-winner','extract',null,'done')
    await assert.rejects(f.env.PIPELINE_DB.batch([materialJobVersionGuard(f.env,'guard',f.sourceId,f.raw,'program',2),f.env.PIPELINE_DB.prepare("INSERT INTO maintenance_events VALUES('must-not-exist','test',?,'{}')").bind(f.now)]))
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n,0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE event_id='must-not-exist'").get()?.n,0)
    assert.equal(f.db.sqlite.prepare("SELECT status FROM maintenance_jobs WHERE job_id='v1-winner'").get()?.status,'done')
  }finally{f.db.sqlite.close()}
})
