import assert from 'node:assert/strict'
import test from 'node:test'
import type { MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { acknowledge,prepareExport } from '../src/exports'
import { persistProposals } from '../src/proposals'
import { seed, setControls, refreshTargets, control, continueTargetRefresh } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv,seedInput,TEST_CATALOG,TEST_GUARDS } from './fixture'

async function fixture(){
  const f=makeEnv();await seed(f.env,seedInput())
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:false,canaryUniversityIds:['uni-000']})
  const sourceId=await digest('https://test.edu.cn/catalog'),rawSha='1'.repeat(64),checkedAt=new Date().toISOString()
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run(rawSha,sourceId)
  const proposals:MaintenanceProposal[]=Array.from({length:100},(_,index)=>({id:`candidate-${String(index).padStart(3,'0')}`,universityId:'uni-000',entityType:'program',recordId:null,operation:'create',fields:{name:{en:`Programme ${index}`}},source:{id:sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:rawSha,objectKey:'maintenance/raw.bin',checkedAt,contentType:'text/html',locator:'text:document',quote:'International programme'},fieldEvidence:[{sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:rawSha,objectKey:'maintenance/raw.bin',locator:'text:document',quote:'International programme',fieldPath:'name.en'}],scope:{year:null,intake:null},status:'ready',warnings:[]}))
  await persistProposals(f.env,proposals,sourceId,rawSha)
  let queries=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{queries++;return prepare(sql)}
  return{...f,proposals,queries:()=>queries,reset:()=>{queries=0}}
}
test('100 candidates prepare/apply/publish in bounded SQL while unchanged receipts become consumed',async()=>{
  const f=await fixture()
  try{
    const prepared=await prepareExport(f.env,{limit:100});assert.equal(prepared.proposalCount,100);assert.ok(f.queries()<50);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='exported'").get()?.count,100)
    const accepted=f.proposals.slice(0,80).map(p=>p.id),held=f.proposals.slice(80).map(p=>p.id),unchanged=held.slice(0,10),ack={batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:'4'.repeat(64),acceptedProposalIds:accepted,heldProposalIds:held,unchangedProposalIds:unchanged}
    f.reset();await acknowledge(f.env,ack);assert.ok(f.queries()<50);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='consumed'").get()?.count,90);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='held'").get()?.count,10)
    await assert.rejects(acknowledge(f.env,{...ack,outcome:'published',unchangedProposalIds:[],deploymentId:'dpl_valid',stableProofSha256:'5'.repeat(64)}),/published_ack_must_match_applied_commit/)
    const published={...ack,outcome:'published',deploymentId:'dpl_valid',stableProofSha256:'5'.repeat(64)}
    f.reset();await acknowledge(f.env,published);assert.ok(f.queries()<50);assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'published');assert.equal((await acknowledge(f.env,published)).reused,true)
  }finally{f.db.sqlite.close()}
})
test('all unchanged candidates can reject without requeueing them as review conflicts',async()=>{
  const f=await fixture()
  try{const prepared=await prepareExport(f.env,{limit:100}),ids=f.proposals.map(p=>p.id),ack={batchId:prepared.batchId,outcome:'rejected',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:TEST_CATALOG,acceptedProposalIds:[],heldProposalIds:ids,unchangedProposalIds:ids}
    await assert.rejects(acknowledge(f.env,{...ack,unchangedProposalIds:[ids[0],ids[0]]}),/unchanged_partition_must_be_held_subset/)
    await assert.rejects(acknowledge(f.env,{...ack,unchangedProposalIds:['not-in-export']}),/unchanged_partition_must_be_held_subset/)
    f.reset();await acknowledge(f.env,ack);assert.ok(f.queries()<50);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='consumed'").get()?.count,100);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='held'").get()?.count,0)
  }finally{f.db.sqlite.close()}
})

test('identity-only applied ACK with unchanged catalog safely revalidates completed targets without rewriting or stalling',async()=>{
  const f=await fixture()
  try{
    const payload={inputCatalogSha256:TEST_CATALOG,recordTargets:[]}
    const first=await refreshTargets(f.env,payload)
    const prepared=await prepareExport(f.env,{limit:100}),accepted=f.proposals.slice(0,1).map(p=>p.id),held=f.proposals.slice(1).map(p=>p.id)
    await acknowledge(f.env,{batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:TEST_CATALOG,acceptedProposalIds:accepted,heldProposalIds:held,unchangedProposalIds:held})
    assert.equal((await control(f.env))?.targets_complete,0)
    const before=(await control(f.env))!.revision,result=await refreshTargets(f.env,payload)
    assert.equal(result.reused,true);assert.equal(result.refreshSha256,first.refreshSha256)
    assert.equal((await control(f.env))?.targets_complete,1);assert.equal((await control(f.env))?.revision,before+1)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_target_refreshes').get()?.n,1)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_revalidated'").get()?.n,1)
    await refreshTargets(f.env,payload);assert.equal((await control(f.env))?.revision,before+1)
    // HTTP admission defers the expensive readback to the existing Queue path.
    f.db.sqlite.prepare('UPDATE maintenance_control SET targets_complete=0').run()
    const queued=await refreshTargets(f.env,payload,true)
    assert.equal(queued.targetsComplete,false);assert.equal((await control(f.env))?.targets_complete,0)
    assert.equal(f.messages.at(-1)?.targetRefreshSha256,first.refreshSha256)
    await continueTargetRefresh(f.env,first.refreshSha256,false)
    assert.equal((await control(f.env))?.targets_complete,1)
  }finally{f.db.sqlite.close()}
})

test('completed refresh cannot restore readiness over another staged plan or altered active target set',async()=>{
  for(const changed of ['staged','active-set','artifact']as const){
    const f=await fixture()
    try{
      const payload={inputCatalogSha256:TEST_CATALOG,recordTargets:[]},result=await refreshTargets(f.env,payload)
      f.db.sqlite.prepare('UPDATE maintenance_control SET targets_complete=0').run()
      if(changed==='staged')f.db.sqlite.prepare("INSERT INTO maintenance_target_refreshes(refresh_sha256,input_catalog_sha256,plan_sha256,total_operations,expected_count,status,created_at) VALUES(?,?,?,1,0,'staged',?)").run('9'.repeat(64),TEST_CATALOG,'8'.repeat(64),new Date().toISOString())
      if(changed==='active-set')f.db.sqlite.prepare("INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,fields_json,target_json,active) VALUES('program:unexpected','unexpected','program','uni-000',?,'{}','{}',1)").run('7'.repeat(64))
      if(changed==='artifact')f.bucket.objects.delete(`maintenance/target-refresh/${result.refreshSha256}.json`)
      await assert.rejects(refreshTargets(f.env,payload),/target_refresh_reuse_/u)
      assert.equal((await control(f.env))?.targets_complete,0)
    }finally{f.db.sqlite.close()}
  }
})
test('a changed final proposal aborts the entire batched acknowledgement before any consumption',async()=>{
  const f=await fixture()
  try{const prepared=await prepareExport(f.env,{limit:100});f.db.sqlite.prepare("UPDATE maintenance_proposals SET status='held' WHERE proposal_id=?").run(f.proposals[99].id)
    await assert.rejects(acknowledge(f.env,{batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:'4'.repeat(64),acceptedProposalIds:f.proposals.map(p=>p.id),heldProposalIds:[]}))
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'prepared');assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='consumed'").get()?.count,0);assert.equal(f.db.sqlite.prepare('SELECT input_catalog_sha256 FROM maintenance_control').get()?.input_catalog_sha256,TEST_CATALOG)
  }finally{f.db.sqlite.close()}
})

test('an operator pause racing immutable export storage prevents a new prepared batch',async()=>{
  const f=await fixture()
  try{
    const put=f.bucket.put.bind(f.bucket)
    f.bucket.put=async(key,body,options)=>{const saved=await put(key,body,options);if(key.startsWith('maintenance/exports/'))await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:false,modelsEnabled:false});return saved}
    await assert.rejects(prepareExport(f.env,{limit:100}),/CHECK constraint/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_exports').get()?.n,0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_proposals WHERE status='ready'").get()?.n,100)
    assert.equal(f.db.sqlite.prepare('SELECT enabled FROM maintenance_control').get()?.enabled,0)
  }finally{f.db.sqlite.close()}
})
