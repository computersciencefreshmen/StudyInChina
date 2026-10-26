import assert from 'node:assert/strict'
import test from 'node:test'
import type { MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { acknowledge,prepareExport,readExport } from '../src/exports'
import { persistProposals } from '../src/proposals'
import { seed } from '../src/repository'
import { digest,gateRequest } from '../src/util'
import { makeEnv,seedInput,TEST_CATALOG,TEST_SCOPE } from './fixture'

async function fixture(){
  const f=makeEnv();await seed(f.env,seedInput())
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
test('export claim, read and acknowledgement hold a global permit against a racing offline-fence acquisition',async()=>{
  const f=await fixture(),acquire={batchId:'export-race-fence',token:'f'.repeat(64),scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG},statuses:number[]=[],put=f.bucket.put.bind(f.bucket),get=f.bucket.get.bind(f.bucket)
  try{
    f.bucket.put=async(key,body,options)=>{if(key.startsWith('maintenance/exports/'))statuses.push((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status);return put(key,body,options)}
    const prepared=await prepareExport(f.env,{limit:100})
    f.bucket.get=async key=>{if(key.startsWith('maintenance/exports/'))statuses.push((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status);return get(key)}
    await readExport(f.env,prepared.batchId)
    await acknowledge(f.env,{batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:'4'.repeat(64),acceptedProposalIds:f.proposals.map(proposal=>proposal.id),heldProposalIds:[]})
    assert.deepEqual(statuses,[409,409,409]);assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,0)
    await assert.rejects(readExport(f.env,'missing-export'),/export_not_found/);await assert.rejects(acknowledge(f.env,{}),/invalid_acknowledgement/)
    assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,0)
    assert.equal((await gateRequest(f.env,'/offline-fence/acquire',{...acquire,inputCatalogSha256:'4'.repeat(64)})).status,200)
  }finally{f.db.sqlite.close()}
})
test('a writer still blocks offline acquisition after 120 seconds and another fetch garbage-collection cycle',async()=>{
  const f=await fixture(),clock=Date.now;let time=clock();Date.now=()=>time
  const get=f.bucket.get.bind(f.bucket),acquire={batchId:'slow-export-fence',token:'f'.repeat(64),scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG};let checked=0
  try{
    const prepared=await prepareExport(f.env,{limit:100})
    f.bucket.get=async key=>{
      if(key.startsWith('maintenance/exports/')){
        time+=120001
        const other=await gateRequest(f.env,'/fetch/acquire',{host:'unrelated.test.edu.cn'});assert.equal(other.status,200);const token=(await other.json()).token;await gateRequest(f.env,'/fetch/release',{token})
        assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,1)
        assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,409);checked++
      }
      return get(key)
    }
    await readExport(f.env,prepared.batchId)
    await acknowledge(f.env,{batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:'4'.repeat(64),acceptedProposalIds:f.proposals.map(proposal=>proposal.id),heldProposalIds:[]})
    assert.equal(checked,2);assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,0)
  }finally{Date.now=clock;f.db.sqlite.close()}
})
test('a slow export failure releases its dedicated permit in finally',async()=>{
  const f=await fixture(),clock=Date.now;let time=clock();Date.now=()=>time
  const get=f.bucket.get.bind(f.bucket),acquire={batchId:'failed-export-fence',token:'f'.repeat(64),scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG}
  try{
    const prepared=await prepareExport(f.env,{limit:100})
    f.bucket.get=async key=>{if(key.startsWith('maintenance/exports/')){time+=120001;assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,409);throw new Error('simulated slow export read failure')}return get(key)}
    await assert.rejects(readExport(f.env,prepared.batchId),/simulated slow export read failure/)
    assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,0)
    assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,200)
  }finally{Date.now=clock;f.db.sqlite.close()}
})
test('dedicated export permits share the global eight slots and never expire or release through the fetch path',async()=>{
  const f=await fixture(),clock=Date.now;let time=clock();Date.now=()=>time
  try{
    const tokens:string[]=[]
    for(let index=0;index<8;index++){const response=await gateRequest(f.env,'/export/acquire',{});assert.equal(response.status,200);tokens.push((await response.json()).token)}
    assert.equal((await gateRequest(f.env,'/export/acquire',{})).status,429);assert.equal((await gateRequest(f.env,'/fetch/acquire',{host:'full.test.edu.cn'})).status,429)
    time+=86400000;await gateRequest(f.env,'/fetch/release',{token:tokens[0]});assert.equal((await gateRequest(f.env,'/fetch/acquire',{host:'still-full.test.edu.cn'})).status,429)
    assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,8)
    for(const token of tokens)await gateRequest(f.env,'/export/release',{token})
    assert.equal((await(await gateRequest(f.env,'/offline-fence/status',{})).json()).activeFetches,0)
    assert.equal((await gateRequest(f.env,'/offline-fence/acquire',{batchId:'unknown-export-was-reconciled',token:'f'.repeat(64),scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG})).status,200)
  }finally{Date.now=clock;f.db.sqlite.close()}
})
test('all unchanged candidates can reject without requeueing them as review conflicts',async()=>{
  const f=await fixture()
  try{const prepared=await prepareExport(f.env,{limit:100}),ids=f.proposals.map(p=>p.id),ack={batchId:prepared.batchId,outcome:'rejected',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:TEST_CATALOG,acceptedProposalIds:[],heldProposalIds:ids,unchangedProposalIds:ids}
    await assert.rejects(acknowledge(f.env,{...ack,unchangedProposalIds:[ids[0],ids[0]]}),/unchanged_partition_must_be_held_subset/)
    await assert.rejects(acknowledge(f.env,{...ack,unchangedProposalIds:['not-in-export']}),/unchanged_partition_must_be_held_subset/)
    f.reset();await acknowledge(f.env,ack);assert.ok(f.queries()<50);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='consumed'").get()?.count,100);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='held'").get()?.count,0)
  }finally{f.db.sqlite.close()}
})
test('a changed final proposal aborts the entire batched acknowledgement before any consumption',async()=>{
  const f=await fixture()
  try{const prepared=await prepareExport(f.env,{limit:100});f.db.sqlite.prepare("UPDATE maintenance_proposals SET status='held' WHERE proposal_id=?").run(f.proposals[99].id)
    await assert.rejects(acknowledge(f.env,{batchId:prepared.batchId,outcome:'applied',receiptSha256:'2'.repeat(64),sourceCommit:'3'.repeat(40),newInputCatalogSha256:'4'.repeat(64),acceptedProposalIds:f.proposals.map(p=>p.id),heldProposalIds:[]}))
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'prepared');assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='consumed'").get()?.count,0);assert.equal(f.db.sqlite.prepare('SELECT input_catalog_sha256 FROM maintenance_control').get()?.input_catalog_sha256,TEST_CATALOG)
  }finally{f.db.sqlite.close()}
})
