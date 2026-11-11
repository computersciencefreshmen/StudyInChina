import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { maintenanceCandidateExportSchema, maintenanceScopeSchema } from '../../../scripts/maintenance/contracts'
import { acknowledge, prepareExport } from '../src/exports'
import { handleFetch, processMessage } from '../src/index'
import { PINNED_HEAD_RECONCILIATION as pin, readMaintenanceControl, reconcileMaintenanceHead } from '../src/head-reconciliation'
import { control, continueTargetRefresh, refreshTargets, setControls } from '../src/repository'
import { canonical } from '../src/util'
import { makeEnv } from './fixture'
import type { D1PreparedStatement } from '../../publisher/src/types'
import type { ReconciliationTargetsUpload } from '../src/types'
import { prepareReconciliationTargets, registerReconciliationTargets } from '../src/reconciliation-targets'
import { buildMaintenanceTargets } from '../../../scripts/automation/build-maintenance-bootstrap'
import { loadMaintenanceBundle } from '../../../scripts/maintenance/build-scope'
import originalScopeJson from '../../../content/maintenance/scope-272.v1.json'
import upgradedScopeJson from '../../../content/maintenance/scope-295.v2.json'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { processScopeUpgrade } from '../src/scope-upgrade'

const originalExport = maintenanceCandidateExportSchema.parse(JSON.parse(readFileSync(new URL('../../../quality/maintenance/reconciliation/2026-11-10/prepared-export.json', import.meta.url), 'utf8')))
const originalScope=maintenanceScopeSchema.parse(originalScopeJson)
const currentTargets=buildMaintenanceTargets(loadMaintenanceBundle(process.cwd()),originalScope)
const targetPayload={inputCatalogSha256:pin.newInputCatalogSha256,recordTargets:currentTargets}
const targetBytes=new TextEncoder().encode(canonical(targetPayload))

test('a pinned v2 deployment settles old exports without the new table; historical control survives a committed scope upgrade', async () => {
  const f = await fixture()
  try {
    await f.ready(); await f.targets(); await f.request('resume', 5)
    f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED = 'true'
    f.env.SCOPE_REGISTRY_SHA256 = EXISTING_SCHOOLS_V2_SHA256; f.env.SCOPE_SCHOOL_COUNT = '295'
    f.db.sqlite.exec('DROP TABLE maintenance_scope_upgrades')
    const transition = await readMaintenanceControl(f.env)
    assert.equal(transition.deployment.guardReady, true)
    assert.equal(transition.deployment.scopeUpgradePending, false)
    await assert.rejects(f.request('pause', 6), /reconciliation_pin_mismatch/u)
    const nextScope = maintenanceScopeSchema.parse(upgradedScopeJson)
    const body = canonical({ format: 'studyinchina.maintenance-scope-upgrade', version: 1, expectedRevision: 6,
      inputCatalogSha256: pin.newInputCatalogSha256, legacyGuardSha256: pin.legacyGuardSha256, previousScope: originalScope, nextScope })
    const hash = createHash('sha256').update(body).digest('hex')
    await f.bucket.put(`maintenance/scope-upgrades/uploads/${hash}.json`, body)
    let result = await processScopeUpgrade(f.env, hash)
    while (!result.completed) result = await processScopeUpgrade(f.env, hash)
    const observation = await readMaintenanceControl(f.env)
    assert.equal(observation.control?.scope_sha256, EXISTING_SCHOOLS_V2_SHA256)
    assert.equal(observation.deployment.guardReady, true)
    assert.equal(observation.reconciliation.scopeUpgrade?.verified, true)
    assert.equal(observation.reconciliation.resumed?.restoredRevision, 6)
    await assert.rejects(f.request('pause', 8), /reconciliation_pin_mismatch/u)
  } finally { f.db.sqlite.close() }
})
async function fixture() {
  const f = makeEnv(); f.env.SCOPE_REGISTRY_SHA256 = pin.scopeRegistrySha256
  const canary = JSON.stringify(['uni-peking-university']), at = '2026-11-10T00:00:00.000Z'
  f.db.sqlite.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,canary_json,revision,updated_at) VALUES(1,?,?,?,?,1,1,1,1,?,1,?)').run(pin.scopeRegistrySha256,pin.oldInputCatalogSha256,pin.seedSha256,pin.legacyGuardSha256,canary,at)
  f.db.sqlite.prepare('INSERT INTO maintenance_schools VALUES(?,?,?,?,NULL)').run('uni-peking-university','{}','{}',pin.scopeRegistrySha256)
  for(const school of originalScope.schools)f.db.sqlite.prepare('INSERT OR IGNORE INTO maintenance_schools VALUES(?,?,?,?,NULL)').run(school.universityId,JSON.stringify(school.name),'{}',pin.scopeRegistrySha256)
  const source = originalExport.proposals[0].source
  f.db.sqlite.prepare('INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,?,?,?,1,168,?)').run(source.id,source.url,'[]','undergraduate_catalog',at)
  const key = `maintenance/exports/${pin.preparedExport.batchId}/${pin.preparedExport.sha256}.json`
  await f.bucket.put(key,canonical(originalExport))
  f.db.sqlite.prepare("INSERT INTO maintenance_exports(batch_id,input_catalog_sha256,scope_sha256,object_key,sha256,created_at,status) VALUES(?,?,?,?,?,?,'prepared')").run(pin.preparedExport.batchId,pin.oldInputCatalogSha256,pin.scopeRegistrySha256,key,pin.preparedExport.sha256,at)
  for (const proposal of originalExport.proposals) f.db.sqlite.prepare("INSERT INTO maintenance_proposals(proposal_id,university_id,source_id,snapshot_sha256,status,proposal_json,created_at,export_id) VALUES(?,?,?,?,'exported',?,?,?)").run(proposal.id,proposal.universityId,proposal.source.id,proposal.source.snapshotSha256,canonical(proposal),at,pin.preparedExport.batchId)
  const addGuard = f.db.sqlite.prepare('INSERT INTO maintenance_legacy_guards(guard_id,scope_json,state,artifact_sha256,reason) VALUES(?,?,?,?,?)')
  for (let index=0;index<pin.preservedHistory.legacyGuards;index++) addGuard.run(`guard-${index}`,'"*"','stop',pin.legacyGuardSha256,'preserved historical stop')
  const addAttempt=f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,'completed',?,'{}')")
  for(let index=0;index<pin.preservedHistory.completedModelAttempts;index++)addAttempt.run(`reservation-${index}`,`attempt-${index}`,source.id,source.snapshotSha256,'primary','a'.repeat(64),'MiniMax-M3',at)
  const request=(phase:'pause'|'advance'|'resume',expectedRevision:number)=>reconcileMaintenanceHead(f.env,{phase,expectedRevision,manifestSha256:pin.sha256})
  const reject=()=>acknowledge(f.env,{batchId:pin.preparedExport.batchId,outcome:'rejected',receiptSha256:pin.preparedExport.rejectionReview.sha256,sourceCommit:pin.sourceCommit,newInputCatalogSha256:pin.oldInputCatalogSha256,acceptedProposalIds:[],heldProposalIds:pin.preparedExport.proposalIds,unchangedProposalIds:[]})
  const ready=async()=>{await request('pause',1);await reject();return request('advance',3)}
  const targets=async()=>{const refresh=await refreshTargets(f.env,targetPayload,true);assert.equal(refresh.refreshSha256,pin.targetUpload.sha256);while(!(await control(f.env))?.targets_complete)await continueTargetRefresh(f.env,refresh.refreshSha256,false)}
  const historyHash=()=>createHash('sha256').update(JSON.stringify({guards:f.db.sqlite.prepare('SELECT * FROM maintenance_legacy_guards ORDER BY guard_id').all(),attempts:f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts ORDER BY attempt_id').all()})).digest('hex')
  return {...f,request,reject,ready,targets,historyHash,source}
}

test('fixed reconciliation holds every real export candidate, refreshes while paused and restores only its durable original control',async()=>{
  const f=await fixture()
  try{
    const before=f.historyHash(),paused=await f.request('pause',1)
    assert.equal(paused.control?.enabled,0);assert.equal(paused.control?.models_enabled,0);assert.equal(paused.reconciliation.paused?.originalControl.enabled,1)
    assert.equal((await prepareExport(f.env,{limit:1})).reused,true) // existing immutable exports stay readable when paused
    await assert.rejects(f.request('advance',2),/reconciliation_rejection_revision_changed/)
    await f.reject();const advanced=await f.request('advance',3)
    assert.equal(advanced.control?.input_catalog_sha256,pin.newInputCatalogSha256);assert.equal(advanced.control?.targets_complete,0);assert.equal(advanced.control?.revision,4)
    await assert.rejects(f.request('resume',4),/reconciliation_targets_or_revision_changed/)
    await assert.rejects(prepareExport(f.env,{limit:1}),/export_requires_enabled_complete_targets/)
    await f.targets();assert.equal((await control(f.env))?.revision,5)
    f.env.MAINTENANCE_ENABLED='false'
    await assert.rejects(f.request('resume',5),/subscription_model_configuration_unavailable/)
    assert.equal((await control(f.env))?.enabled,0)
    f.env.MAINTENANCE_ENABLED='true'
    const resumed=await f.request('resume',5)
    assert.equal(resumed.control?.enabled,1);assert.equal(resumed.control?.models_enabled,1);assert.equal(resumed.control?.revision,6)
    assert.equal(f.historyHash(),before)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_proposals WHERE status='held'").get()?.n,12)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'rejected')
    for(const phase of ['pause','advance','resume'] as const)await f.request(phase,1)
    assert.equal((await control(f.env))?.revision,6);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind LIKE 'native_git_head_%'").get()?.n,3)
  }finally{f.db.sqlite.close()}
})

test('failed pause archive is durably disabled and retries the same original snapshot',async()=>{
  const f=await fixture()
  try{
    const put=f.bucket.put.bind(f.bucket);let fail=true
    f.bucket.put=async(key,body,options)=>{if(fail&&key.startsWith('maintenance/reconciliation/')){fail=false;throw Error('R2 unavailable')}return put(key,body,options)}
    await assert.rejects(f.request('pause',1),/R2 unavailable/)
    assert.equal((await control(f.env))?.enabled,0);assert.equal((await control(f.env))?.revision,2)
    const retry=await f.request('pause',1);assert.equal(retry.reconciliation.paused?.originalControl.enabled,1);assert.equal(retry.control?.revision,2)
  }finally{f.db.sqlite.close()}
})

test('an ambiguous committed pause response is idempotent and does not create a second snapshot',async()=>{
  const f=await fixture()
  try{
    const batch=f.db.batch.bind(f.db);let lose=true
    f.db.batch=async <T>(statements:D1PreparedStatement[])=>{const result=await batch<T>(statements);if(lose){lose=false;throw Error('lost response')}return result}
    const paused=await f.request('pause',1);assert.equal(paused.control?.revision,2)
    assert.equal((await f.request('pause',1)).reconciliation.paused?.proofSha256,paused.reconciliation.paused?.proofSha256)
  }finally{f.db.sqlite.close()}
})

test('operator revisions before advance or during target refresh prevent automatic restoration',async()=>{
  for(const stage of ['paused','advanced'] as const){
    const f=await fixture()
    try{
      if(stage==='paused'){
        await f.request('pause',1)
        await setControls(f.env,{expectedRevision:2,legacyGuardSha256:pin.legacyGuardSha256,enabled:false,modelsEnabled:false})
        await f.reject();await assert.rejects(f.request('advance',4),/reconciliation_rejection_revision_changed/)
        assert.equal((await control(f.env))?.input_catalog_sha256,pin.oldInputCatalogSha256)
      }else{
        await f.ready();await setControls(f.env,{expectedRevision:4,legacyGuardSha256:pin.legacyGuardSha256,enabled:false,modelsEnabled:false})
        await f.targets();await assert.rejects(f.request('resume',6),/reconciliation_targets_or_revision_changed/)
      }
      assert.equal((await control(f.env))?.enabled,0)
    }finally{f.db.sqlite.close()}
  }
})

for(const blocker of ['unknown-job','running-job','queued-lease','unknown-model','reserved-model','send-started-model','prepared-export','applied-export','staged-targets','missing-guard'] as const){
  test(`atomic advance rejects ${blocker} without changing the head or deleting history`,async()=>{
    const f=await fixture()
    try{
      await f.request('pause',1);await f.reject()
      if(blocker.endsWith('job')||blocker==='queued-lease')f.db.sqlite.prepare('INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,lease_token,lease_until) VALUES(?,?,\'extract\',?,?,?,?,?,?)').run('blocked-job',f.source.id,blocker==='unknown-job'?'unknown':blocker==='running-job'?'running':'queued','2026-11-10','2026-11-10','2026-11-10',blocker==='unknown-job'?null:'preserved-token',blocker==='unknown-job'?null:'2026-11-11')
      if(blocker.endsWith('model'))f.db.sqlite.prepare('UPDATE maintenance_model_attempts SET status=? WHERE attempt_id=?').run(blocker==='unknown-model'?'unknown':blocker==='reserved-model'?'reserved':'send_started','attempt-0')
      if(blocker.endsWith('export'))f.db.sqlite.prepare('INSERT INTO maintenance_exports(batch_id,input_catalog_sha256,scope_sha256,object_key,sha256,created_at,status) VALUES(?,?,?,?,?,?,?)').run('another-export',pin.oldInputCatalogSha256,pin.scopeRegistrySha256,'preserved.json','a'.repeat(64),'2026-11-10',blocker==='prepared-export'?'prepared':'applied')
      if(blocker==='staged-targets')f.db.sqlite.prepare("INSERT INTO maintenance_target_refreshes(refresh_sha256,input_catalog_sha256,plan_sha256,total_operations,expected_count,status,created_at) VALUES(?,?,?,1,0,'staged',?)").run('a'.repeat(64),pin.oldInputCatalogSha256,'b'.repeat(64),'2026-11-10')
      if(blocker==='missing-guard')f.db.sqlite.prepare('DELETE FROM maintenance_legacy_guards WHERE guard_id=?').run('guard-0')
      const before=f.historyHash()
      await assert.rejects(f.request('advance',3),/reconciliation_cas_or_fence_conflict/)
      assert.equal((await control(f.env))?.input_catalog_sha256,pin.oldInputCatalogSha256);assert.equal((await control(f.env))?.revision,3);assert.equal((await control(f.env))?.enabled,0)
      assert.equal(f.historyHash(),before);assert.equal((await readMaintenanceControl(f.env)).reconciliation.advanced,null)
    }finally{f.db.sqlite.close()}
  })
}

test('authentication, exact manifest, CAS and rejected partition are mandatory',async()=>{
  const f=await fixture()
  try{
    for(const path of ['/control','/head-reconcile'])assert.equal((await handleFetch(new Request(`https://maintenance.test${path}`),f.env)).status,401)
    await assert.rejects(reconcileMaintenanceHead(f.env,{phase:'pause',expectedRevision:1,manifestSha256:'f'.repeat(64)}),/invalid_pinned_reconciliation/)
    await assert.rejects(reconcileMaintenanceHead(f.env,{phase:'pause',expectedRevision:1,manifestSha256:pin.sha256,newInputCatalogSha256:'f'.repeat(64)}),/invalid_pinned_reconciliation/)
    await assert.rejects(f.request('pause',0),/reconciliation_control_revision_changed/)
    await f.request('pause',1);await f.reject()
    f.db.sqlite.prepare("UPDATE maintenance_proposals SET status='consumed' WHERE proposal_id=?").run(pin.preparedExport.proposalIds[0])
    await assert.rejects(f.request('advance',3),/reconciliation_rejection_partition_changed/)
    assert.equal((await control(f.env))?.input_catalog_sha256,pin.oldInputCatalogSha256)
  }finally{f.db.sqlite.close()}
})

test('target completion failure rolls back control, completed status and audit event, then safely retries',async()=>{
  const f=await fixture()
  try{
    await f.ready()
    const refresh=await refreshTargets(f.env,{inputCatalogSha256:pin.newInputCatalogSha256,recordTargets:[]},true)
    f.db.sqlite.exec("CREATE TRIGGER fail_target_completion BEFORE UPDATE OF status ON maintenance_target_refreshes WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'forced completion boundary failure'); END")
    await assert.rejects(continueTargetRefresh(f.env,refresh.refreshSha256,false),/target_refresh_completion_conflict/)
    assert.equal((await control(f.env))?.targets_complete,0);assert.equal((await control(f.env))?.revision,4)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_target_refreshes').get()?.status,'staged')
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_refreshed'").get()?.n,0)
    f.db.sqlite.exec('DROP TRIGGER fail_target_completion')
    await continueTargetRefresh(f.env,refresh.refreshSha256,false)
    await continueTargetRefresh(f.env,refresh.refreshSha256,false)
    assert.equal((await control(f.env))?.revision,5);assert.equal((await control(f.env))?.targets_complete,1)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_refreshed'").get()?.n,1)
  }finally{f.db.sqlite.close()}
})

test('concurrent finishing target deliveries increment the control revision exactly once',async()=>{
  const f=await fixture()
  try{
    await f.ready()
    const refresh=await refreshTargets(f.env,{inputCatalogSha256:pin.newInputCatalogSha256,recordTargets:[]},true)
    // Reproduce a durable checkpoint after all target chunks, before completion.
    f.db.sqlite.prepare('UPDATE maintenance_target_refreshes SET completed_operations=total_operations WHERE refresh_sha256=?').run(refresh.refreshSha256)
    await Promise.all([continueTargetRefresh(f.env,refresh.refreshSha256,false),continueTargetRefresh(f.env,refresh.refreshSha256,false)])
    assert.equal((await control(f.env))?.revision,5)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_refreshed'").get()?.n,1)
  }finally{f.db.sqlite.close()}
})

test('an operator revision racing the final target transaction is retained and prevents restoration',async()=>{
  const f=await fixture()
  try{
    await f.ready()
    const refresh=await refreshTargets(f.env,{inputCatalogSha256:pin.newInputCatalogSha256,recordTargets:[]},true)
    f.db.sqlite.prepare('UPDATE maintenance_target_refreshes SET completed_operations=total_operations WHERE refresh_sha256=?').run(refresh.refreshSha256)
    const get=f.bucket.get.bind(f.bucket);let changed=false
    f.bucket.get=async key=>{if(!changed&&key.startsWith('maintenance/target-refresh/')){changed=true;await setControls(f.env,{expectedRevision:4,legacyGuardSha256:pin.legacyGuardSha256,enabled:false,modelsEnabled:false})}return get(key)}
    await assert.rejects(continueTargetRefresh(f.env,refresh.refreshSha256,false),/target_refresh_completion_conflict/)
    assert.equal((await control(f.env))?.revision,5);assert.equal((await control(f.env))?.targets_complete,0)
    await continueTargetRefresh(f.env,refresh.refreshSha256,false)
    await assert.rejects(f.request('resume',6),/reconciliation_targets_or_revision_changed/)
    assert.equal((await control(f.env))?.enabled,0)
  }finally{f.db.sqlite.close()}
})

function uploadRequest(bytes:Uint8Array<ArrayBuffer>=targetBytes,overrides:Record<string,string>={}) {
  return new Request('https://maintenance.test/head-reconcile-targets',{method:'POST',headers:{'content-type':'application/json','content-length':String(pin.targetUpload.byteLength),'x-maintenance-reconcile-sha256':pin.sha256,'x-maintenance-targets-sha256':pin.targetUpload.sha256,'x-maintenance-expected-revision':'4',...overrides},body:bytes})
}
async function uploaded(f:Awaited<ReturnType<typeof fixture>>,bytes:Uint8Array<ArrayBuffer>=targetBytes) {
  const receipt=await registerReconciliationTargets(f.env,uploadRequest(bytes))
  assert.equal(receipt.pending,true)
  const upload=f.messages.at(-1)?.reconciliationTargetsUpload
  assert.ok(upload);return upload
}

test('the pinned full 4129-target stream is validated in Queue, reuses its plan, and completed upload replay performs no write',async()=>{
  const f=await fixture()
  try{
    assert.equal(currentTargets.length,4129);assert.equal(targetBytes.byteLength,3642343)
    assert.equal(createHash('sha256').update(targetBytes).digest('hex'),pin.targetUpload.sha256)
    await f.ready()
    f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    const request=uploadRequest(),body=request.body,put=f.bucket.put.bind(f.bucket);let preservedStream=false
    f.bucket.put=async(key,value,options)=>{if(key.includes('/target-uploads/'))preservedStream=value===body;return put(key,value,options)}
    await registerReconciliationTargets(f.env,request)
    assert.equal(preservedStream,true)
    const message=f.messages.at(-1);assert.ok(message?.reconciliationTargetsUpload)
    await processMessage(f.env,message);await processMessage(f.env,message)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_target_refreshes').get()?.n,1)
    assert.equal((await control(f.env))?.revision,4);assert.equal((await control(f.env))?.enabled,0)
    while(!(await control(f.env))?.targets_complete)await processMessage(f.env,{version:1,jobId:pin.targetUpload.sha256,targetRefreshSha256:pin.targetUpload.sha256})
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_record_targets WHERE active=1').get()?.n,4129)
    const count=f.bucket.objects.size,queued=f.messages.length
    const replay=await registerReconciliationTargets(f.env,uploadRequest())
    assert.equal(replay.pending,false);assert.equal(replay.bodySha256,pin.targetUpload.sha256);assert.equal(replay.byteLength,pin.targetUpload.byteLength);assert.equal(replay.expectedRevision,4)
    assert.equal(f.bucket.objects.size,count);assert.equal(f.messages.length,queued);assert.equal((await control(f.env))?.revision,5);assert.equal((await control(f.env))?.models_enabled,0)
    assert.equal((await readMaintenanceControl(f.env)).deployment.guardReady,false)
  }finally{f.db.sqlite.close()}
})

test('tampered, oversized and incomplete streams remain paused; a fresh immutable upload can recover',async()=>{
  const f=await fixture()
  try{
    await f.ready()
    const initial=f.bucket.objects.size
    await assert.rejects(registerReconciliationTargets(f.env,uploadRequest(targetBytes,{'content-length':String(pin.targetUpload.byteLength+1)})),/reconciliation_target_upload_metadata_invalid/)
    assert.equal(f.bucket.objects.size,initial)
    const tampered=targetBytes.slice();tampered[20]^=1
    const wrong=await uploaded(f,tampered)
    await assert.rejects(prepareReconciliationTargets(f.env,wrong),/reconciliation_target_upload_checksum_mismatch/)
    const incomplete=await uploaded(f,targetBytes.slice(0,100))
    await assert.rejects(prepareReconciliationTargets(f.env,incomplete),/reconciliation_target_upload_size_mismatch/)
    const oversized=await uploaded(f,new Uint8Array(pin.targetUpload.byteLength+1))
    await assert.rejects(prepareReconciliationTargets(f.env,oversized),/reconciliation_target_upload_size_mismatch/)
    assert.equal((await control(f.env))?.revision,4);assert.equal((await control(f.env))?.enabled,0)
    const retry=await uploaded(f)
    assert.notEqual(retry.uploadKey,wrong.uploadKey);assert.notEqual(retry.uploadKey,incomplete.uploadKey)
    const result=await prepareReconciliationTargets(f.env,retry)
    assert.equal(result.targetsComplete,false);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_target_refreshes').get()?.n,1)
  }finally{f.db.sqlite.close()}
})

test('failed native upload does not enqueue and a retry preserves the original control snapshot',async()=>{
  const f=await fixture()
  try{
    await f.ready();const put=f.bucket.put.bind(f.bucket);let fail=true
    f.bucket.put=async(key,value,options)=>{if(fail&&key.includes('/target-uploads/')){fail=false;throw Error('upload interrupted')}return put(key,value,options)}
    await assert.rejects(registerReconciliationTargets(f.env,uploadRequest()),/upload interrupted/)
    assert.equal(f.messages.length,0);assert.equal((await control(f.env))?.revision,4);assert.equal((await control(f.env))?.models_enabled,0)
    await uploaded(f)
    assert.equal(f.messages.length,1);assert.equal((await readMaintenanceControl(f.env)).reconciliation.paused?.originalControl.models_enabled,1)
  }finally{f.db.sqlite.close()}
})

test('upload bindings and an operator revision racing Queue planning fail closed',async()=>{
  const f=await fixture()
  try{
    await f.ready();const upload=await uploaded(f)
    for(const changed of [{...upload,bodySha256:'a'.repeat(64)},{...upload,byteLength:1},{...upload,uploadKey:'maintenance/../outside.json'}] satisfies ReconciliationTargetsUpload[])await assert.rejects(prepareReconciliationTargets(f.env,changed),/reconciliation_target_upload_binding_invalid/)
    const put=f.bucket.put.bind(f.bucket);let changed=false
    f.bucket.put=async(key,value,options)=>{const saved=await put(key,value,options);if(!changed&&key.startsWith('maintenance/target-refresh/')){changed=true;await setControls(f.env,{expectedRevision:4,legacyGuardSha256:pin.legacyGuardSha256,enabled:false,modelsEnabled:false})}return saved}
    await assert.rejects(prepareReconciliationTargets(f.env,upload),/target_refresh_repair_control_changed/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_target_refreshes').get()?.n,0)
    assert.equal((await control(f.env))?.revision,5);assert.equal((await control(f.env))?.targets_complete,0);assert.equal((await control(f.env))?.enabled,0)
    await assert.rejects(prepareReconciliationTargets(f.env,upload),/reconciliation_target_upload_control_changed/)
  }finally{f.db.sqlite.close()}
})
