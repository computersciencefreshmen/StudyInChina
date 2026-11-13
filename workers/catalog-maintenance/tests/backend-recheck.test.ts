import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import { control,seed,setControls } from '../src/repository'
import { quotaWait,recheckBackend,rememberQuotaWait } from '../src/runtime'
import { canonical,digest } from '../src/util'
import { makeEnv,seedInput,TEST_GUARDS } from './fixture'

const NOW=Date.parse('2026-11-13T06:00:00.000Z')
const WAIT_AT='2026-11-13T04:57:51.983Z'
const WAIT_KEY='maintenance/runtime/d1-quota-wait.v1.json'
const REASON={reason:'account-plan-change'}
async function fixture(withWait=true) {
  let providerCalls=0
  const f=makeEnv(async()=>{providerCalls++;throw new Error('unexpected provider call')})
  await seed(f.env,seedInput(),NOW-3600000)
  if(withWait)await rememberQuotaWait(f.env,WAIT_AT)
  const originalWait=await f.bucket.get(WAIT_KEY)
  return{...f,originalWait:originalWait?await originalWait.text():null,providerCalls:()=>providerCalls}
}
function request(f:Awaited<ReturnType<typeof fixture>>,method:string,authorized=true,body:unknown=REASON) {
  return new Request('https://maintenance.test/backend/recheck',{method,
    headers:{'content-type':'application/json',...(authorized?{authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`}:{})},
    ...(method==='POST'?{body:JSON.stringify(body)}:{})})
}
async function assertWaitPreserved(f:Awaited<ReturnType<typeof fixture>>,now=NOW) {
  const waiting=await quotaWait(f.env,now)
  assert.equal(waiting?.format,'studyinchina.d1-quota-wait')
  assert.equal(waiting.retryAt,'2026-11-14T00:00:00.000Z')
  assert.equal(f.providerCalls(),0);assert.equal(f.messages.length,0)
}

test('backend recheck requires authorization and explicit POST before any database probe',async()=>{
  const f=await fixture(),prepare=f.db.prepare.bind(f.db)
  let probes=0
  f.db.prepare=sql=>{probes++;return prepare(sql)}
  try{
    for(const [method,authorized,status]of [['POST',false,401],['GET',true,404],['OPTIONS',true,404]] as const){
      const response=await handleFetch(request(f,method,authorized),f.env)
      assert.equal(response.status,status)
    }
    assert.equal(probes,0)
    assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
    await assertWaitPreserved(f)
  }finally{f.db.sqlite.close()}
})

test('illegal reasons, extra operator flags and oversized bodies never reach the probe',async()=>{
  const f=await fixture(),prepare=f.db.prepare.bind(f.db)
  let probes=0
  f.db.prepare=sql=>{probes++;return prepare(sql)}
  try{
    for(const value of [null,[],{},'account-plan-change',{reason:'reset'},{reason:true},
      {reason:'account-plan-change',enabled:true},{reason:'account-plan-change',modelsEnabled:true}]){
      await assert.rejects(recheckBackend(f.env,value,NOW),/backend_recheck_reason_invalid/u)
      const response=await handleFetch(request(f,'POST',true,value),f.env)
      assert.equal(response.status,409)
    }
    assert.equal((await handleFetch(request(f,'POST',true,{reason:'account-plan-change',padding:'x'.repeat(2048)}),f.env)).status,409)
    assert.equal(probes,0)
    assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
    await assertWaitPreserved(f)
  }finally{f.db.sqlite.close()}
})

test('healthy backend performs actual SQLite read/write/readback and archives the exact wait before checksum-bound recovery',async()=>{
  const f=await fixture(),prepare=f.db.prepare.bind(f.db),statements:string[]=[]
  f.db.prepare=sql=>{statements.push(sql);return prepare(sql)}
  try{
    const result=await recheckBackend(f.env,REASON,NOW)
    assert.equal(result.state,'ready');assert.equal(result.readVerified,true);assert.equal(result.writeVerified,true)
    assert.equal(result.waitCleared,true);assert.equal(result.modelCallsPerformed,false)
    assert.equal(result.operatorFlagsChanged,false);assert.equal(result.publicationPerformed,false)
    assert.equal(statements.length,3)
    assert.match(statements[0],/^SELECT singleton FROM maintenance_control/u)
    assert.match(statements[1],/^INSERT INTO maintenance_events/u)
    assert.match(statements[2],/^SELECT details_json FROM maintenance_events/u)
    assert.equal(await quotaWait(f.env,NOW),null)
    assert.ok('receiptKey'in result)
    const receiptBytes=await(await f.bucket.get(result.receiptKey))!.text(),receipt=JSON.parse(receiptBytes)
    assert.equal(await digest(receiptBytes),result.receiptSha256)
    assert.equal(result.receiptKey,`maintenance/runtime/backend-rechecks/${result.receiptSha256}.json`)
    assert.equal(receiptBytes,canonical(receipt))
    assert.equal(receipt.readVerified,true);assert.equal(receipt.writeVerified,true)
    assert.equal(receipt.observedAt,new Date(NOW).toISOString())
    const previousSha=await digest(f.originalWait!)
    assert.equal(receipt.previousWaitSha256,previousSha)
    assert.equal(await(await f.bucket.get(`maintenance/runtime/quota-waits/${previousSha}.json`))!.text(),f.originalWait)
    const recovery=JSON.parse(await(await f.bucket.get(WAIT_KEY))!.text())
    assert.equal(recovery.format,'studyinchina.d1-quota-recovery')
    assert.equal(recovery.receiptSha256,result.receiptSha256);assert.equal(recovery.receiptKey,result.receiptKey)
    assert.equal(recovery.previousWaitSha256,previousSha)
    const saved=f.db.sqlite.prepare("SELECT * FROM maintenance_events WHERE kind='backend_quota_rechecked'").all()
    assert.equal(saved.length,1)
    assert.equal(saved[0].event_id,receipt.eventId)
    assert.equal(JSON.parse(String(saved[0].details_json)).previousWaitSha256,previousSha)
    assert.equal(f.providerCalls(),0);assert.equal(f.messages.length,0)
  }finally{f.db.sqlite.close()}
})

for(const phase of ['read','write'] as const)for(const kind of ['quota','sql'] as const){
  test(`${phase} ${kind} failure never clears cached waiting state`,async()=>{
    const f=await fixture(),prepare=f.db.prepare.bind(f.db)
    const error=new Error(kind==='quota'?`D1_ERROR daily ${phase==='read'?'read':'write'} quota exceeded`:'SQLITE_ERROR: no such table: missing_probe')
    f.db.prepare=sql=>{
      const statement=prepare(sql)
      if(phase==='read'&&sql.startsWith('SELECT singleton'))statement.first=async()=>{throw error}
      if(phase==='write'&&sql.startsWith('INSERT INTO maintenance_events'))statement.run=async()=>{throw error}
      return statement
    }
    try{
      const result=await recheckBackend(f.env,REASON,NOW)
      assert.equal(result.state,kind==='quota'?'quota_wait':'backend_unavailable')
      assert.equal(result.readVerified,phase==='write');assert.equal(result.writeVerified,false);assert.equal(result.waitCleared,false)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='backend_quota_rechecked'").get()?.n,0)
      await assertWaitPreserved(f)
      if(kind==='sql')assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
    }finally{f.db.sqlite.close()}
  })
}

for(const failure of ['missing-readback','different-readback','zero-write-changes'] as const){
  test(`${failure} cannot manufacture a confirmed write or clear the wait`,async()=>{
    const f=await fixture(),prepare=f.db.prepare.bind(f.db)
    f.db.prepare=sql=>{
      const statement=prepare(sql)
      if(sql.startsWith('SELECT details_json FROM maintenance_events')){
        if(failure==='missing-readback')statement.first=async()=>null
        if(failure==='different-readback')statement.first=async<T>()=>({details_json:'changed bytes'} as T)
      }
      if(failure==='zero-write-changes'&&sql.startsWith('INSERT INTO maintenance_events'))statement.run=async()=>({success:true,meta:{changes:0}})
      return statement
    }
    try{
      const result=await recheckBackend(f.env,REASON,NOW)
      assert.equal(result.state,'backend_unavailable');assert.equal(result.waitCleared,false)
      assert.equal(result.readVerified,true);assert.equal(result.writeVerified,false)
      assert.ok('code'in result);assert.equal(result.code,'backend_recheck_write_unconfirmed')
      assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
      await assertWaitPreserved(f)
    }finally{f.db.sqlite.close()}
  })
}

for(const storageFailure of ['history','receipt','lost-receipt-write'] as const){
  test(`R2 ${storageFailure} failure preserves waiting even after a successful database probe`,async()=>{
    const f=await fixture(),put=f.bucket.put.bind(f.bucket)
    f.bucket.put=async(key,body,options)=>{
      if(storageFailure==='history'&&key.startsWith('maintenance/runtime/quota-waits/'))throw new Error('R2 unavailable')
      if(key.startsWith('maintenance/runtime/backend-rechecks/')){
        if(storageFailure==='receipt')throw new Error('R2 unavailable')
        if(storageFailure==='lost-receipt-write')return null
      }
      return put(key,body,options)
    }
    try{
      const result=await recheckBackend(f.env,REASON,NOW)
      assert.equal(result.state,'backend_unavailable');assert.equal(result.waitCleared,false)
      assert.equal(result.readVerified,true);assert.equal(result.writeVerified,true)
      assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
      await assertWaitPreserved(f)
    }finally{f.db.sqlite.close()}
  })
}

for(const withWait of [true,false]){
  test(`a newer concurrent wait wins the ${withWait?'ETag':'initial-creation'} CAS`,async()=>{
    const f=await fixture(withWait),put=f.bucket.put.bind(f.bucket)
    let raced=false,newerText=''
    f.bucket.put=async(key,body,options)=>{
      if(key===WAIT_KEY&&typeof body==='string'&&JSON.parse(body).format==='studyinchina.d1-quota-recovery'&&!raced){
        raced=true
        await rememberQuotaWait(f.env,new Date(NOW+1000).toISOString())
        newerText=await(await f.bucket.get(WAIT_KEY))!.text()
      }
      return put(key,body,options)
    }
    try{
      const result=await recheckBackend(f.env,REASON,NOW)
      assert.equal(result.state,'cache_changed');assert.equal(result.waitCleared,false)
      assert.equal(result.readVerified,true);assert.equal(result.writeVerified,true)
      assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),newerText)
      assert.equal((await quotaWait(f.env,NOW+2000))?.observedAt,new Date(NOW+1000).toISOString())
      assert.equal(f.providerCalls(),0);assert.equal(f.messages.length,0)
    }finally{f.db.sqlite.close()}
  })
}

test('an initial recheck without a cached wait still requires read/write proof and creates a verifiable recovery receipt',async()=>{
  const f=await fixture(false)
  try{
    const result=await recheckBackend(f.env,REASON,NOW)
    assert.equal(result.state,'ready');assert.equal(result.waitCleared,true)
    assert.equal(result.readVerified,true);assert.equal(result.writeVerified,true)
    assert.ok('receiptKey'in result)
    const bytes=await(await f.bucket.get(result.receiptKey))!.text()
    assert.equal(await digest(bytes),result.receiptSha256)
    assert.equal(JSON.parse(bytes).previousWaitSha256,null)
    assert.equal(await quotaWait(f.env,NOW),null)
    assert.equal([...f.bucket.objects.keys()].filter(key=>key.startsWith('maintenance/runtime/quota-waits/')).length,0)
  }finally{f.db.sqlite.close()}
})

test('missing control and unavailable cache ETags fail closed before recovery',async()=>{
  for(const failure of ['missing-control','missing-etag'] as const){
    const f=await fixture()
    try{
      if(failure==='missing-control'){
        f.db.sqlite.prepare('DELETE FROM maintenance_control').run()
        const result=await recheckBackend(f.env,REASON,NOW)
        assert.equal(result.state,'backend_unavailable');assert.equal(result.waitCleared,false)
        assert.ok('code'in result);assert.equal(result.code,'backend_recheck_control_unavailable')
      }else{
        const get=f.bucket.get.bind(f.bucket)
        f.env.SNAPSHOTS_BUCKET={put:f.bucket.put.bind(f.bucket),async get(key){
          const value=await get(key)
          if(!value)return null
          const {etag,...withoutEtag}=value;void etag
          return withoutEtag
        }}
        await assert.rejects(recheckBackend(f.env,REASON,NOW),/backend_recheck_etag_unavailable/u)
      }
      assert.equal(await(await f.bucket.get(WAIT_KEY))!.text(),f.originalWait)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='backend_quota_rechecked'").get()?.n,0)
      await assertWaitPreserved(f)
    }finally{f.db.sqlite.close()}
  }
})

test('successful recheck preserves a manual pause, unknown jobs and model reservations without dispatch or provider calls',async()=>{
  const f=await fixture()
  try{
    await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:false,modelsEnabled:false,canaryUniversityIds:['uni-000']},NOW-10000)
    const sourceId=await digest('https://test.edu.cn/catalog')
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES('unknown-job',?,'maintain','unknown',?,?,?)")
      .run(sourceId,WAIT_AT,WAIT_AT,WAIT_AT)
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('unknown-reservation','unknown-attempt',?,'snapshot','primary','request','MiniMax-M3','unknown',?,'{}')")
      .run(sourceId,WAIT_AT)
    f.db.sqlite.prepare("INSERT INTO maintenance_legacy_guards VALUES('unknown-guard',NULL,NULL,NULL,'\"*\"','unknown',?,'unknown prior result',NULL)").run(TEST_GUARDS)
    await f.storage.put('unknown-reservation',{status:'unknown',neverReplay:true})
    const before={control:await control(f.env),jobs:f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all(),attempts:f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all(),guards:f.db.sqlite.prepare('SELECT * FROM maintenance_legacy_guards').all(),durable:structuredClone(f.storage.values)}
    const result=await recheckBackend(f.env,REASON,NOW)
    assert.equal(result.state,'ready')
    assert.deepEqual(await control(f.env),before.control)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all(),before.jobs)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').all(),before.attempts)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_legacy_guards').all(),before.guards)
    assert.deepEqual(f.storage.values,before.durable)
    assert.equal(f.providerCalls(),0);assert.equal(f.messages.length,0)
  }finally{f.db.sqlite.close()}
})
