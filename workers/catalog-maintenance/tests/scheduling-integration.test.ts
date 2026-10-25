import assert from 'node:assert/strict'
import test from 'node:test'
import { enqueueDue,seed,setControls } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv,seedInput,TEST_GUARDS } from './fixture'

test('durable scheduler supplies both lanes before eight-slot selection and reverses shares only after actual first attempts',async()=>{
  const f=makeEnv(),input=seedInput(),start=Date.parse('2026-10-25T04:00:00.000Z'),iso=new Date(start-60000).toISOString()
  try{
    for(let index=0;index<40;index++)input.schools[index].sourceSeeds=[{id:`official-${index}`,url:`https://test.edu.cn/${index}`,allowedHosts:['test.edu.cn'],sourceCategory:'undergraduate_catalog',enabled:true,registration:'catalogue_official'}]
    await seed(f.env,input,start);await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']},start)
    await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:[]},start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let index=0;index<40;index++)for(const stage of ['maintain','extract'])f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?)").run(`${stage}-${index}`,await digest(`https://test.edu.cn/${index}`),stage,stage==='maintain'?1:10,iso,iso,iso)
    for(const firstRoundComplete of [false,true]){
      if(firstRoundComplete)f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=?').run(iso)
      let maintenance=0,expansion=0
      for(let index=0;index<10;index++){
        f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run();f.messages.length=0
        const result=await enqueueDue(f.env,start+index*15*60000);assert.equal(result.queued,8)
        for(const message of f.messages){const stage=f.db.sqlite.prepare('SELECT stage FROM maintenance_jobs WHERE job_id=?').get(message.jobId)?.stage;if(stage==='maintain')maintenance++;else expansion++}
      }
      assert.equal(maintenance,firstRoundComplete?56:24);assert.equal(expansion,firstRoundComplete?24:56)
    }
  }finally{f.db.sqlite.close()}
})
