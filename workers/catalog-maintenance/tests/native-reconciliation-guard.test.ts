import assert from 'node:assert/strict'
import test from 'node:test'
import manifest from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { nativeReconciliationGate } from '../src/native-reconciliation-guard'
import { readMaintenanceControl } from '../src/head-reconciliation'
import { prepareExport } from '../src/exports'
import { processMessage } from '../src/index'
import { control, enqueueDue, seed, setControls, status } from '../src/repository'
import { runCloudTick } from '../src/runtime'
import { canonical, digest, gateRequest } from '../src/util'
import { makeEnv, quotaResponse, seedInput } from './fixture'

async function fixture() {
  let providerCalls=0,quotaCalls=0,sourceCalls=0
  let onQuota:(()=>Promise<void>)|undefined
  const f=makeEnv(async input=>{
    const url=String(input)
    if(url.includes('token_plan')){quotaCalls++;await onQuota?.();return quotaResponse()}
    if(url.includes('/anthropic/v1/messages')){providerCalls++;return Response.json({content:[{type:'text',text:'{}'}],stop_reason:'end_turn'})}
    sourceCalls++;throw Error('unexpected source call')
  })
  f.env.SCOPE_REGISTRY_SHA256=manifest.scopeRegistrySha256
  await seed(f.env,{...seedInput(),scopeRegistrySha256:manifest.scopeRegistrySha256,inputCatalogSha256:manifest.oldInputCatalogSha256})
  const cfg=await control(f.env);assert.ok(cfg)
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:cfg.legacy_guard_sha256,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']})
  const sourceId=await digest('https://test.edu.cn/catalog')
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=? WHERE source_id=?').run('1'.repeat(64),'2'.repeat(64),sourceId)
  const model=()=>gateRequest(f.env,'/model/run',{reservationKey:'f'.repeat(64),sourceId,universityIds:['uni-000'],snapshotSha256:'1'.repeat(64),pass:'primary',payload:'official programme evidence only',lane:'expansion',recordIds:[]})
  async function installResume() {
    const current=await control(f.env);assert.ok(current)
    const original={...current,input_catalog_sha256:manifest.oldInputCatalogSha256,scope_sha256:manifest.scopeRegistrySha256,seed_sha256:manifest.seedSha256,legacy_guard_sha256:manifest.legacyGuardSha256,revision:1,targets_complete:1}
    let resumedKey=''
    for(const phase of ['pause','advance','resume'] as const){
      const proof={phase,manifestSha256:manifest.sha256,createdAt:'2026-11-10T10:00:00.000Z',originalControl:original,pausedRevision:2,...(phase!=='pause'?{reconciledRevision:4}:{}),...(phase==='resume'?{restoredRevision:6}:{})}
      const sha256=await digest(canonical(proof)),objectKey=`maintenance/reconciliation/${manifest.operationId}/${phase}/${sha256}.json`
      await f.bucket.put(objectKey,canonical(proof))
      f.db.sqlite.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').run(`${manifest.operationId}:${phase}`,`native_git_head_${phase}`,proof.createdAt,canonical({proof,sha256,objectKey}))
      if(phase==='resume')resumedKey=objectKey
    }
    f.db.sqlite.prepare('UPDATE maintenance_control SET revision=6,input_catalog_sha256=?,seed_sha256=?,legacy_guard_sha256=?').run(manifest.newInputCatalogSha256,manifest.seedSha256,manifest.legacyGuardSha256)
    return resumedKey
  }
  return{...f,model,installResume,counts:()=>({providerCalls,quotaCalls,sourceCalls}),onQuota:(callback:()=>Promise<void>)=>{onQuota=callback}}
}

test('the optional flag preserves legacy admission and makes no extra authoritative query when absent',async()=>{
  const f=await fixture()
  try{
    const prepare=f.db.prepare.bind(f.db)
    f.db.prepare=()=>{throw Error('must not read D1')}
    assert.deepEqual(await nativeReconciliationGate(f.env),{required:false,ready:true,reason:'not_required'})
    f.db.prepare=prepare
    assert.equal((await f.model()).status,200);assert.equal(f.counts().providerCalls,1)
  }finally{f.db.sqlite.close()}
})

test('required unresolved recovery blocks scheduling, old queued jobs, export preparation and DO model calls',async()=>{
  const f=await fixture()
  try{
    await enqueueDue(f.env)
    const job=f.db.sqlite.prepare("SELECT job_id FROM maintenance_jobs WHERE status='queued'").get();assert.ok(job)
    f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    const count=f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n
    assert.deepEqual(await enqueueDue(f.env),{enabled:false,queued:0,nativeHeadReconciliationRequired:true})
    await processMessage(f.env,{version:1,jobId:String(job.job_id)})
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_jobs WHERE job_id=?').get(String(job.job_id))?.status,'queued')
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,count)
    await assert.rejects(prepareExport(f.env,{limit:1}),/native_head_reconciliation_required/)
    assert.equal((await f.model()).status,409)
    assert.deepEqual(f.counts(),{providerCalls:0,quotaCalls:0,sourceCalls:0})
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
    const meta=await readMaintenanceControl(f.env)
    assert.equal(meta.control?.enabled,1);assert.equal(meta.deployment.guardRequired,true);assert.equal(meta.deployment.guardReady,false)
    assert.equal((await status(f.env)).enabled,false)
    const tick=await runCloudTick(f.env);assert.equal(tick.state,'disabled');assert.equal(tick.code,'native_head_reconciliation_required')
  }finally{f.db.sqlite.close()}
})

for(const corruption of ['missing-archive','changed-archive','changed-proof','wrong-manifest','wrong-phase','wrong-original-scope','wrong-revision'] as const){
  test(`an invalid durable resume (${corruption}) does not open the deployment barrier`,async()=>{
    const f=await fixture()
    try{
      const key=await f.installResume();f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
      if(corruption==='missing-archive')f.bucket.objects.delete(key)
      else if(corruption==='changed-archive')await f.bucket.put(key,'{}')
      else{
        const row=f.db.sqlite.prepare('SELECT details_json FROM maintenance_events WHERE event_id=?').get(`${manifest.operationId}:resume`)
        const saved=JSON.parse(String(row?.details_json))
        if(corruption==='wrong-manifest')saved.proof.manifestSha256='a'.repeat(64)
        else if(corruption==='wrong-phase')saved.proof.phase='advance'
        else if(corruption==='wrong-original-scope')saved.proof.originalControl.scope_sha256='a'.repeat(64)
        else if(corruption==='wrong-revision')saved.proof.restoredRevision=99
        else saved.proof.originalControl.enabled=0
        if(corruption!=='changed-proof'){
          saved.sha256=await digest(canonical(saved.proof));saved.objectKey=`maintenance/reconciliation/${manifest.operationId}/resume/${saved.sha256}.json`
          await f.bucket.put(saved.objectKey,canonical(saved.proof))
        }
        f.db.sqlite.prepare('UPDATE maintenance_events SET details_json=? WHERE event_id=?').run(canonical(saved),`${manifest.operationId}:resume`)
      }
      assert.equal((await nativeReconciliationGate(f.env)).ready,false)
      assert.equal((await f.model()).status,409);assert.equal(f.counts().providerCalls,0);assert.equal(f.counts().quotaCalls,0)
    }finally{f.db.sqlite.close()}
  })
}

test('verified recovery permits later canonical heads while a later manual pause remains authoritative',async()=>{
  const f=await fixture()
  try{
    await f.installResume();f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?,revision=7').run('e'.repeat(64))
    assert.equal((await nativeReconciliationGate(f.env)).ready,true)
    assert.equal((await enqueueDue(f.env)).enabled,true)
    assert.equal((await f.model()).status,200);assert.equal(f.counts().providerCalls,1)
    const cfg=await control(f.env);assert.ok(cfg)
    await setControls(f.env,{expectedRevision:cfg.revision,legacyGuardSha256:cfg.legacy_guard_sha256,enabled:false,modelsEnabled:false})
    assert.equal((await enqueueDue(f.env)).enabled,false);assert.equal((await status(f.env)).enabled,false)
    assert.equal((await f.model()).status,409);assert.equal(f.counts().providerCalls,1)
    const meta=await readMaintenanceControl(f.env);assert.equal(meta.deployment.guardReady,true);assert.equal(meta.control?.enabled,0)
  }finally{f.db.sqlite.close()}
})

test('unreadable D1 fails closed before quota or provider requests and still allows repair continuations to reach their own validation',async()=>{
  const f=await fixture()
  try{
    f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    const prepare=f.db.prepare.bind(f.db)
    f.db.prepare=sql=>{if(sql.startsWith('SELECT kind,details_json'))throw Error('D1 daily free read limit exceeded [7500]');return prepare(sql)}
    await assert.rejects(enqueueDue(f.env),/daily free read limit/)
    assert.equal((await f.model()).status,429)
    assert.deepEqual(f.counts(),{providerCalls:0,quotaCalls:0,sourceCalls:0})
    await assert.rejects(processMessage(f.env,{version:1,jobId:'a'.repeat(64),bootstrapUploadSha256:'a'.repeat(64)}),/bootstrap_upload_missing/)
    await assert.rejects(processMessage(f.env,{version:1,jobId:'a'.repeat(64),reconciliationTargetsUpload:{manifestSha256:'a'.repeat(64),bodySha256:'a'.repeat(64),byteLength:1,expectedRevision:1,uploadKey:'invalid'}}),/reconciliation_target_upload_binding_invalid/)
  }finally{f.db.sqlite.close()}
})

test('a D1 failure at the final pre-send guard records a definite unsent attempt and sends zero provider requests',async()=>{
  const f=await fixture()
  try{
    await f.installResume();f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    const prepare=f.db.prepare.bind(f.db);let guards=0
    f.db.prepare=sql=>{if(sql.startsWith('SELECT kind,details_json')&&++guards===2)throw Error('D1 daily free read limit exceeded [7500]');return prepare(sql)}
    const response=await f.model();assert.equal(response.status,429)
    assert.equal((await response.json()).error,'model_not_sent');assert.equal(f.counts().quotaCalls,1);assert.equal(f.counts().providerCalls,0)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'known_failed')
  }finally{f.db.sqlite.close()}
})

test('an unknown D1 backend failure is closed, without treating it as a usable recovery signal',async()=>{
  const f=await fixture()
  try{
    f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    const prepare=f.db.prepare.bind(f.db)
    f.db.prepare=sql=>{if(sql.startsWith('SELECT kind,details_json'))throw Error('database connection unavailable');return prepare(sql)}
    await assert.rejects(nativeReconciliationGate(f.env),/connection unavailable/)
    assert.equal((await f.model()).status,400)
    assert.deepEqual(f.counts(),{providerCalls:0,quotaCalls:0,sourceCalls:0})
  }finally{f.db.sqlite.close()}
})

test('a resume proof removed after admission but before send blocks the provider and preserves a retryable unsent outcome',async()=>{
  const f=await fixture()
  try{
    await f.installResume();f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    f.onQuota(async()=>{f.db.sqlite.prepare('DELETE FROM maintenance_events WHERE event_id=?').run(`${manifest.operationId}:resume`)})
    const response=await f.model();assert.equal(response.status,429)
    assert.equal((await response.json()).error,'model_waiting_control');assert.equal(f.counts().providerCalls,0)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'known_failed')
  }finally{f.db.sqlite.close()}
})
