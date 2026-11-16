import assert from 'node:assert/strict'
import test from 'node:test'
import { registerSourceRechecks,sourceRecheckOriginalJobSha256 } from '../src/source-rechecks'
import { canonical } from '../src/util'
import { recheckFixture } from './source-rechecks-fixture'
import { BUDGET_POLICY_KEY } from '../../shared/background-budget'
test('only a new capture is created; old held/provider unknown history, source and control remain byte-identical and exact replay is a no-op',async()=>{
  const f=await recheckFixture()
  try{
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('unknown-key','unknown-attempt',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(f.sourceId,'a'.repeat(64),'b'.repeat(64),new Date(f.now).toISOString())
    const before={source:JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_sources').all()),control:JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()),models:JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all())}
    const result=await registerSourceRechecks(f.env,f.input,f.now);assert.equal(result.reused,false);assert.equal(result.entries.length,1)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').get(f.originalJobId),f.original)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='capture' AND status='queued' AND attempt=0").get()?.n,1)
    assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_sources').all()),before.source);assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()),before.control);assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all()),before.models)
    assert.equal((await registerSourceRechecks(f.env,f.input,f.now+1000)).reused,true)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,2)
    assert.equal(f.messages.length,0);assert.equal(result.firstInspectionClaimed,false);assert.equal(result.modelCallsPerformed,false)
    await assert.rejects(registerSourceRechecks(f.env,{...f.input,operationId:'another-operation'},f.now),/newer_capture_requires_review/u)
    await assert.rejects(registerSourceRechecks(f.env,{...f.input,expectedRevision:2},f.now),/registration_conflict/u)
  }finally{f.db.sqlite.close()}
})
test('job hash includes enqueued_at and rejects omitted/unknown columns',async()=>{
  const f=await recheckFixture()
  try{
    assert.notEqual(await sourceRecheckOriginalJobSha256({...f.original,enqueued_at:null}),f.originalJobSha256)
    const omitted={...f.original};delete omitted.enqueued_at
    await assert.rejects(sourceRecheckOriginalJobSha256(omitted),/original_job_invalid/u)
    await assert.rejects(sourceRecheckOriginalJobSha256({...f.original,unexpected:'extension'}),/original_job_invalid/u)
  }finally{f.db.sqlite.close()}
})
test('current source seed, canary, revision and original held proof are independently required',async()=>{
  for(const mutation of ['paused','outside','revision','scope','catalog','seed-url','seed-disabled','source-disabled','bad-job-sha','job-status','job-unknown','robots-denied','non-seed-child','recovered-source','older-source-attempt']){
    const f=await recheckFixture()
    try{
      if(mutation==='paused')f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=0').run()
      if(mutation==='outside')f.db.sqlite.prepare('UPDATE maintenance_control SET canary_json=?').run('["uni-001"]')
      if(mutation==='revision')f.input.expectedRevision=0
      if(mutation==='scope')f.input.scopeRegistrySha256='e'.repeat(64)
      if(mutation==='catalog')f.input.inputCatalogSha256='e'.repeat(64)
      if(mutation.startsWith('seed-')){const school=f.db.sqlite.prepare('SELECT seed_json FROM maintenance_schools WHERE university_id=?').get('uni-000')!,seed=JSON.parse(String(school.seed_json));if(mutation==='seed-url')seed.sourceSeeds[0].url='https://test.edu.cn/elsewhere';else seed.sourceSeeds[0].enabled=false;f.db.sqlite.prepare('UPDATE maintenance_schools SET seed_json=? WHERE university_id=?').run(canonical(seed),'uni-000')}
      if(mutation==='source-disabled')f.db.sqlite.prepare('UPDATE maintenance_sources SET enabled=0').run()
      if(mutation==='bad-job-sha')f.input.sources[0].originalJobSha256='e'.repeat(64)
      if(mutation==='job-status'||mutation==='job-unknown')f.db.sqlite.prepare('UPDATE maintenance_jobs SET status=?').run(mutation==='job-status'?'done':'unknown')
      if(mutation==='robots-denied')f.db.sqlite.prepare("UPDATE maintenance_jobs SET error_code='robots_disallowed'").run()
      if(mutation==='non-seed-child')f.db.sqlite.prepare("UPDATE maintenance_sources SET url='https://test.edu.cn/discovered-child'").run()
      if(mutation==='recovered-source')f.db.sqlite.prepare('UPDATE maintenance_sources SET failures=0,error_code=NULL').run()
      if(mutation==='older-source-attempt')f.db.sqlite.prepare("UPDATE maintenance_sources SET last_attempt_at='2000-01-01T00:00:00.000Z'").run()
      await assert.rejects(registerSourceRechecks(f.env,f.input,f.now),/source_recheck_/u,mutation)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,1)
      assert.equal(f.messages.length,0)
    }finally{f.db.sqlite.close()}
  }
})
test('source migration freeze, native guard, deployment disable, duplicate and >5 requests cannot create work',async()=>{
  for(const mutation of ['source-freeze','deployment','native','budget','duplicate','over-cap']){
    const f=await recheckFixture()
    try{
      if(mutation==='source-freeze')f.env.MODEL_STATE_MIGRATION_ROLE='source'
      if(mutation==='deployment')f.env.MAINTENANCE_ENABLED='false'
      if(mutation==='native')f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
      if(mutation==='budget')await f.bucket.put(BUDGET_POLICY_KEY,'{}')
      if(mutation==='duplicate')f.input.sources.push(f.input.sources[0])
      if(mutation==='over-cap')f.input.sources=Array.from({length:6},()=>f.input.sources[0])
      await assert.rejects(registerSourceRechecks(f.env,f.input,f.now))
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,1)
    }finally{f.db.sqlite.close()}
  }
})
test('a late control or original-row race atomically rolls back every new job and event',async()=>{
  for(const mutation of ['control','job','source','school']){
    const f=await recheckFixture()
    try{
      const batch=f.env.PIPELINE_DB.batch.bind(f.env.PIPELINE_DB)
      f.env.PIPELINE_DB.batch=async statements=>{
        if(mutation==='control')f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=0').run()
        if(mutation==='job')f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run()
        if(mutation==='source')f.db.sqlite.prepare('UPDATE maintenance_sources SET failures=99').run()
        if(mutation==='school')f.db.sqlite.prepare("UPDATE maintenance_schools SET seed_json='{}' WHERE university_id='uni-000'").run()
        return batch(statements)
      }
      await assert.rejects(registerSourceRechecks(f.env,f.input,f.now),/commit_conflict/u)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,1)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='official_source_rechecks_registered'").get()?.n,0)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n,0)
    }finally{f.db.sqlite.close()}
  }
})
