import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { enqueueDue,seed,setControls } from '../src/repository'
import { canonical,digest } from '../src/util'
import { publishCoverageSnapshot,submitCoverageSnapshot,type CoverageSnapshot } from '../src/coverage'
import { getTodayDate } from '../../../src/lib/data/freshness'
import { makeEnv,seedInput,TEST_GUARDS,TEST_SCOPE } from './fixture'

type Fixture = ReturnType<typeof makeEnv>
const start = Date.parse('2026-11-12T04:00:00.000Z'), past = new Date(start-60000).toISOString()
const sourceSeed = (school:number,index=0) => ({id:`official-${school}-${index}`,url:`https://test.edu.cn/${school}/${index}`,allowedHosts:['test.edu.cn'],sourceCategory:'undergraduate_catalog',enabled:true,registration:'catalogue_official'})
async function enable(f:Fixture,input:ReturnType<typeof seedInput>,now=start) {
  await seed(f.env,input,now)
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']},now)
  await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:[]},now)
}
async function coverage(input:ReturnType<typeof seedInput>,count:(id:string)=>number,now=start):Promise<CoverageSnapshot> {
  const content = {format:'studyinchina.school-program-coverage' as const,version:1 as const,scopeRegistrySha256:input.scopeRegistrySha256,
    inputCatalogSha256:input.inputCatalogSha256,evaluatedOn:getTodayDate(new Date(now)),schools:input.schools.map(school=>{
      const currentProgramCount=count(school.universityId)
      return {universityId:school.universityId,rawProgramCount:currentProgramCount,directoryProgramCount:currentProgramCount,currentProgramCount,
        minimumProgramCount:5 as const,gap:Math.max(0,5-currentProgramCount),coverageBand:currentProgramCount===0?'zero' as const:currentProgramCount===1?'one' as const:currentProgramCount<5?'two-to-four' as const:'five-plus' as const,
        countedProgramIds:Array.from({length:currentProgramCount},(_,i)=>`program-${school.universityId}-${i}`),directoryScholarshipCount:0,currentScholarshipCount:0,reviewAfter:null as string|null}
    })}
  return {...content,sha256:await digest(canonical(content))}
}
function insertJob(f:Fixture,id:string,sourceId:string,stage='extract',priority=10,due=past) {
  f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?)")
    .run(id,sourceId,stage,priority,due,due,due)
}
function dispatched(f:Fixture) {
  return f.messages.map(message=>f.db.sqlite.prepare('SELECT j.stage,j.source_id,x.university_id FROM maintenance_jobs j JOIN maintenance_source_schools x ON x.source_id=j.source_id WHERE j.job_id=?').get(message.jobId) as {stage:string;source_id:string;university_id:string})
}

test('durable scheduler reverses shares only after a complete fresh coverage goal, never merely first attempts',async()=>{
  const f=makeEnv(),input=seedInput(),start=Date.parse('2026-10-25T04:00:00.000Z'),iso=new Date(start-60000).toISOString()
  try{
    for(let index=0;index<40;index++)input.schools[index].sourceSeeds=[{id:`official-${index}`,url:`https://test.edu.cn/${index}`,allowedHosts:['test.edu.cn'],sourceCategory:'undergraduate_catalog',enabled:true,registration:'catalogue_official'}]
    await seed(f.env,input,start);await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']},start)
    await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:[]},start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let index=0;index<40;index++)for(const stage of ['maintain','extract'])f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?,?)").run(`${stage}-${index}`,await digest(`https://test.edu.cn/${index}`),stage,stage==='maintain'?1:10,iso,iso,iso)
    for(const firstRoundComplete of [false,true]){
      f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=?').run(iso)
      if(firstRoundComplete)await submitCoverageSnapshot(f.env,await coverage(input,()=>5,start),start)
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

test('attempted schools with gaps, stale/unknown coverage or a mismatched registry keep seventy percent expansion',async()=>{
  for(const scenario of ['zero','one','two-to-four','expired','missing','incomplete','mismatched'] as const){
    const f=makeEnv(),input=seedInput()
    try{
      if(scenario==='zero'){
        input.schools.push(...Array.from({length:23},(_,i)=>({universityId:`uni-${272+i}`,name:{en:`University ${272+i}`},sourceSeeds:[]})))
        f.env.SCOPE_SCHOOL_COUNT='295'
      }
      input.schools[0].sourceSeeds=Array.from({length:50},(_,i)=>sourceSeed(0,i))
      await enable(f,input);f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=?').run(past)
      f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
      if(scenario!=='missing'){
        const snapshot=await coverage(input,id=>id==='uni-271'&&['zero','one','two-to-four'].includes(scenario)?{zero:0,one:1,'two-to-four':4}[scenario as 'zero'|'one'|'two-to-four']:5,scenario==='expired'?start-86400000:start)
        if(scenario==='incomplete'||scenario==='mismatched'){
          if(scenario==='incomplete')snapshot.schools.pop()
          else snapshot.schools[snapshot.schools.length-1].universityId='uni-not-in-committed-scope'
          const {sha256:_,...content}=snapshot;void _;snapshot.sha256=await digest(canonical(content))
        }
        await publishCoverageSnapshot(f.env,snapshot,start)
      }
      for(let i=0;i<40;i++)for(const stage of ['maintain','extract'])insertJob(f,`${stage}-${i}`,await digest(sourceSeed(0,i).url),stage)
      let maintained=0
      for(let i=0;i<10;i++){
        f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run();f.messages.length=0
        assert.equal((await enqueueDue(f.env,start+i*15*60000)).queued,8)
        maintained+=dispatched(f).filter(job=>job.stage==='maintain').length
      }
      assert.equal(maintained,24,scenario)
    }finally{f.db.sqlite.close()}
  }
})

test('a complete committed 272-school scope still uses maintenance shares with a newer 295-school deployment configuration',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:40},(_,i)=>sourceSeed(0,i))
    await enable(f,input);f.env.SCOPE_SCHOOL_COUNT='295'
    await submitCoverageSnapshot(f.env,await coverage(input,()=>5),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let i=0;i<40;i++)for(const stage of ['maintain','extract'])insertJob(f,`${stage}-${i}`,await digest(sourceSeed(0,i).url),stage)
    let maintained=0
    for(let i=0;i<10;i++){
      f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run();f.messages.length=0
      await enqueueDue(f.env,start+i*15*60000);maintained+=dispatched(f).filter(job=>job.stage==='maintain').length
    }
    assert.equal(maintained,56)
  }finally{f.db.sqlite.close()}
})

test('more than forty old high-coverage sources cannot crowd low-coverage schools out of capture admission',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>sourceSeed(0,i))
    for(let i=1;i<=8;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
    await enable(f,input)
    await submitCoverageSnapshot(f.env,await coverage(input,id=>id==='uni-000'?5:0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(past)
    f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id<>?').run(past,'uni-000')
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    const jobs=dispatched(f)
    assert.equal(new Set(jobs.map(job=>job.university_id)).size,8)
    assert.ok(jobs.every(job=>job.university_id!=='uni-000'))
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs j JOIN maintenance_source_schools x ON x.source_id=j.source_id WHERE j.stage='capture' AND x.university_id='uni-000'").get()?.n,0)
  }finally{f.db.sqlite.close()}
})

test('per-lane reservoirs keep low-coverage jobs ahead of a large older high-coverage backlog',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>sourceSeed(0,i))
    for(let i=1;i<=8;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
    await enable(f,input)
    await submitCoverageSnapshot(f.env,await coverage(input,id=>id==='uni-000'?5:0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let i=0;i<90;i++)insertJob(f,`old-${i}`,await digest(sourceSeed(0,i).url),'extract',1,'2026-10-01T00:00:00Z')
    for(let i=1;i<=8;i++)insertJob(f,`gap-${i}`,await digest(sourceSeed(i).url))
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    assert.deepEqual(new Set(dispatched(f).map(job=>job.university_id)),new Set(Array.from({length:8},(_,i)=>`uni-00${i+1}`)))
  }finally{f.db.sqlite.close()}
})

test('same-band reservoirs and final slots rotate across schools instead of one ninety-source school',async()=>{
  for(const lane of ['capture','extract']){
    const f=makeEnv(),input=seedInput()
    try{
      input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>sourceSeed(0,i))
      for(let i=1;i<=8;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
      await enable(f,input);await submitCoverageSnapshot(f.env,await coverage(input,()=>0),start)
      f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(lane==='capture'?past:new Date(start+30*86400000).toISOString())
      if(lane==='extract'){
        for(let i=0;i<90;i++)insertJob(f,`large-${i}`,await digest(sourceSeed(0,i).url))
        for(let i=1;i<=8;i++)insertJob(f,`small-${i}`,await digest(sourceSeed(i).url))
      }
      f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id=?').run(past,'uni-000')
      assert.equal((await enqueueDue(f.env,start)).queued,8)
      assert.equal(new Set(dispatched(f).map(job=>job.university_id)).size,8,lane)
      assert.ok(dispatched(f).every(job=>job.university_id!=='uni-000'),'older unattempted peer schools get a turn first')
    }finally{f.db.sqlite.close()}
  }
})

test('consecutive model-only ticks rotate all schools without forging attempts, including after a catalogue update',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    for(let i=0;i<16;i++)input.schools[i].sourceSeeds=[sourceSeed(i,0),sourceSeed(i,1)]
    await enable(f,input);await submitCoverageSnapshot(f.env,await coverage(input,()=>0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let i=0;i<16;i++)for(let n=0;n<2;n++)insertJob(f,`school-${String(i).padStart(2,'0')}-${n}`,await digest(sourceSeed(i,n).url))
    const batches:Array<Set<string>>=[]
    for(let tick=0;tick<3;tick++){
      if(tick===1){
        input.inputCatalogSha256='e'.repeat(64)
        f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run(input.inputCatalogSha256)
        await submitCoverageSnapshot(f.env,await coverage(input,()=>0,start+tick*900000),start+tick*900000)
      }
      f.messages.length=0
      assert.equal((await enqueueDue(f.env,start+tick*900000)).queued,8)
      batches.push(new Set(dispatched(f).map(job=>job.university_id)))
      // Model completion intentionally clears enqueued_at as the real ledger does.
      for(const message of f.messages)f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='done',enqueued_at=NULL WHERE job_id=?").run(message.jobId)
    }
    assert.equal(new Set([...batches[0],...batches[1]]).size,16)
    assert.deepEqual(batches[2],batches[0])
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools WHERE last_attempt_at IS NOT NULL').get()?.n,0)
  }finally{f.db.sqlite.close()}
})

test('scope-foreign and future cursor hints cannot suppress current schools or overwrite newer dispatch ages',async()=>{
  for(const invalid of ['foreign-scope','future-tick'] as const){
    const f=makeEnv(),input=seedInput(),key=`maintenance/scheduling/school-rotation/${TEST_SCOPE}.json`
    try{
      for(let i=0;i<16;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
      await enable(f,input)
      f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
      for(let i=0;i<16;i++)insertJob(f,`school-${String(i).padStart(2,'0')}`,await digest(sourceSeed(i).url))
      const future=Math.floor(start/900000)+10
      await f.bucket.put(key,JSON.stringify({format:'studyinchina.school-scheduling-rotation',version:1,
        scopeRegistrySha256:invalid==='foreign-scope'?'f'.repeat(64):TEST_SCOPE,lastScheduled:{'uni-000':future,'uni-not-in-scope':1}}))
      await enqueueDue(f.env,start)
      assert.ok(dispatched(f).some(job=>job.university_id==='uni-000'),invalid)
      if(invalid==='future-tick'){
        const after=JSON.parse(await (await f.bucket.get(key))!.text())
        assert.equal(after.lastScheduled['uni-000'],future,'an older concurrent tick cannot erase newer state')
        const event=f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='scheduler_tick'").get()
        assert.equal(JSON.parse(String(event?.details_json)).schoolRotationSaved,false)
      }
    }finally{f.db.sqlite.close()}
  }
})

test('a racing cursor creation merges through a bounded ETag retry and never erases another school age',async()=>{
  const f=makeEnv(),input=seedInput(),key=`maintenance/scheduling/school-rotation/${TEST_SCOPE}.json`
  try{
    await enable(f,input)
    const put=f.bucket.put.bind(f.bucket),tick=Math.floor(start/900000)
    let writes=0,raced=false
    f.bucket.put=async(k,body,options)=>{
      if(k===key){
        writes++
        if(!raced){raced=true;await put(key,JSON.stringify({format:'studyinchina.school-scheduling-rotation',version:1,scopeRegistrySha256:TEST_SCOPE,lastScheduled:{'uni-271':tick}}))}
      }
      return put(k,body,options)
    }
    assert.equal((await enqueueDue(f.env,start)).queued,1)
    const result=JSON.parse(await (await f.bucket.get(key))!.text())
    assert.equal(writes,2)
    assert.equal(result.lastScheduled['uni-000'],tick)
    assert.equal(result.lastScheduled['uni-271'],tick)
  }finally{f.db.sqlite.close()}
})

test('shared source priorities use eligible canary schools while preserving the full source association',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=[sourceSeed(0)];input.schools[1].sourceSeeds=[sourceSeed(1)];input.schools[2].sourceSeeds=[sourceSeed(0)]
    await enable(f,input)
    await setControls(f.env,{expectedRevision:2,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000','uni-001']},start)
    await submitCoverageSnapshot(f.env,await coverage(input,id=>id==='uni-000'?5:id==='uni-001'?1:0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(past)
    assert.equal((await enqueueDue(f.env,start)).queued,2)
    assert.equal(dispatched(f)[0].source_id,await digest(sourceSeed(1).url))
    const links=f.db.sqlite.prepare('SELECT university_id FROM maintenance_source_schools WHERE source_id=? ORDER BY university_id').all(await digest(sourceSeed(0).url))
    assert.deepEqual(links.map(row=>row.university_id),['uni-000','uni-002'])
    const cursor=JSON.parse(await (await f.bucket.get(`maintenance/scheduling/school-rotation/${TEST_SCOPE}.json`))!.text())
    assert.equal(cursor.lastScheduled['uni-002'],undefined,'only actually dispatched anchors advance')
  }finally{f.db.sqlite.close()}
})

test('an urgent job survives the bounded reservoir even when its school already has five programmes',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>sourceSeed(0,i));input.schools[1].sourceSeeds=[sourceSeed(1)]
    await enable(f,input);await submitCoverageSnapshot(f.env,await coverage(input,id=>id==='uni-001'?5:0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let i=0;i<90;i++)insertJob(f,`ordinary-${i}`,await digest(sourceSeed(0,i).url))
    insertJob(f,'urgent',await digest(sourceSeed(1).url),'maintain',0)
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    assert.equal(f.messages[0].jobId,'urgent')
  }finally{f.db.sqlite.close()}
})

test('an imminent official deadline enters capture before ninety ordinary low-coverage sources',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>sourceSeed(0,i));input.schools[1].sourceSeeds=[sourceSeed(1)]
    await enable(f,input);await submitCoverageSnapshot(f.env,await coverage(input,id=>id==='uni-001'?5:0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(past)
    const urgentSource=await digest(sourceSeed(1).url)
    f.db.sqlite.prepare("INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,fields_json,target_json) VALUES('urgent-cycle','cycle','admission-cycle','uni-001',?,?, '{}')")
      .run('d'.repeat(64),JSON.stringify({closesOn:'2026-11-13'}))
    f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').run('urgent-cycle',urgentSource)
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    assert.equal(dispatched(f)[0].source_id,urgentSource)
    assert.equal(dispatched(f)[0].stage,'capture')
  }finally{f.db.sqlite.close()}
})

test('one source shared by a hundred schools cannot occupy a hundred candidate slots',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    for(let i=0;i<100;i++)input.schools[i].sourceSeeds=[sourceSeed(0)]
    for(let i=100;i<108;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
    await enable(f,input);await submitCoverageSnapshot(f.env,await coverage(input,()=>0),start)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(past)
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    assert.equal(new Set(f.messages.map(message=>message.jobId)).size,8)
    assert.equal(new Set(dispatched(f).map(job=>job.source_id)).size,8)
  }finally{f.db.sqlite.close()}
})

test('disabled sources cannot consume slots even when their pending jobs are urgent',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    input.schools[0].sourceSeeds=Array.from({length:40},(_,i)=>sourceSeed(0,i))
    input.schools[1].sourceSeeds=Array.from({length:8},(_,i)=>sourceSeed(1,i))
    await enable(f,input)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start+30*86400000).toISOString())
    for(let i=0;i<40;i++){
      const id=await digest(sourceSeed(0,i).url)
      insertJob(f,`disabled-${i}`,id,'extract',0)
      f.db.sqlite.prepare('UPDATE maintenance_sources SET enabled=0 WHERE source_id=?').run(id)
    }
    for(let i=0;i<8;i++)insertJob(f,`active-${i}`,await digest(sourceSeed(1,i).url))
    assert.equal((await enqueueDue(f.env,start)).queued,8)
    assert.ok(dispatched(f).every(job=>job.university_id==='uni-001'))
  }finally{f.db.sqlite.close()}
})

test('bounded priorities omit fact payloads and query plans use one due-job range plus indexed source lookups',async()=>{
  const f=makeEnv(),input=seedInput()
  try{
    f.db.sqlite.exec(readFileSync(new URL('../../../infra/d1/pipeline/migrations/0022_maintenance_lookup_indexes.sql',import.meta.url),'utf8'))
    for(let i=0;i<8;i++)input.schools[i].sourceSeeds=[sourceSeed(i)]
    await enable(f,input)
    const snapshot=await coverage(input,()=>40)
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot))>24*1024)
    await submitCoverageSnapshot(f.env,snapshot,start)
    for(let i=0;i<8;i++)insertJob(f,`extract-${i}`,await digest(sourceSeed(i).url))
    const queries:Array<{sql:string;values:unknown[]}>=[],prepare=f.db.prepare.bind(f.db)
    f.db.prepare=sql=>{
      const statement=prepare(sql),bind=statement.bind.bind(statement)
      statement.bind=(...values:unknown[])=>{if(sql.startsWith('WITH school_meta'))queries.push({sql,values});return bind(...values)}
      return statement
    }
    await enqueueDue(f.env,start)
    assert.equal(queries.length,2)
    for(const query of queries){
      const metadata=String(query.values[0])
      assert.ok(Buffer.byteLength(metadata)<10*1024)
      assert.doesNotMatch(metadata,/countedProgramIds|program-uni|currentProgramCount/u)
    }
    const plans=queries.map(query=>f.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values as never[]).map(row=>String(row.detail)))
    assert.ok(plans[0].some(detail=>/SEARCH j USING INDEX maintenance_jobs_active_source_stage \(source_id=/u.test(detail)),plans[0].join('\n'))
    assert.ok(plans[0].some(detail=>/SEARCH x USING COVERING INDEX maintenance_source_school_lookup \(university_id=/u.test(detail)))
    const jobSearch=plans[1].findIndex(detail=>/SEARCH j USING INDEX maintenance_jobs_due/u.test(detail))
    const sourceSearch=plans[1].findIndex(detail=>/SEARCH s USING INDEX sqlite_autoindex_maintenance_sources_1/u.test(detail))
    assert.ok(jobSearch>=0&&sourceSearch>jobSearch,'due jobs are outermost, not rescanned for each school/source')
    assert.equal(plans[1].filter(detail=>/SEARCH j USING INDEX maintenance_jobs_due/u.test(detail)).length,1)
    assert.ok(plans.flat().every(detail=>!/^SCAN (?:t|maintenance_record_targets)\b/u.test(detail)))
  }finally{f.db.sqlite.close()}
})
