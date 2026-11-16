import assert from 'node:assert/strict'
import test from 'node:test'
import { materialBatchEnvelope,materialBatchJobId,readMaterialBatchContract,type MaterialEngine } from '../src/material-batch-contract'
import { buildDocumentPartitions,runPartitionedDocument,type DocumentPartitionContext } from '../src/document-partitions'
import { maintainFields } from '../src/field-updates'
import { discoverAdmissionCycles } from '../src/cycle-discovery'
import { extractIdentities } from '../src/extraction'
import { extractScholarshipIdentities } from '../src/scholarship-identities'
import type { CapturedSnapshot } from '../src/capture'
import type { JobRow,ModelRequest,SourceRow } from '../src/types'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { seed } from '../src/repository'
import { canonical,digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

const text='International students applying to Computer Science. Autumn 2027 admissions. Application deadline: 2027-09-30. Master Computer Science. Autumn 2028 admissions for Master Computer Science. Application opens 2027-11-01; application deadline 2028-04-30.'
async function fixture(engine:MaterialEngine,count=1){
  const f=makeEnv();await seed(f.env,seedInput())
  const body=engine==='cycles'?Array.from({length:count},(_,i)=>`International students: Master Computer Science ${i}. Autumn 2028 admissions for Master Computer Science ${i}. Application opens 2027-11-01; application deadline 2028-04-30.`).join('\n'):text
  const url='https://test.edu.cn/catalog',sourceId=await digest(url),sha=await digest(body),createdAt=new Date().toISOString()
  const snapshot:CapturedSnapshot={version:1,sourceId,sourceUrl:url,finalUrl:url,checkedAt:createdAt,contentType:'text/plain',rawSha256:sha,rawKey:`maintenance/snapshots/${sourceId}/${sha}.bin`,textKey:`maintenance/text/${sourceId}/${sha}.txt`,textSha256:sha,canonicalSha256:sha,parserCandidates:[]}
  const snapshotKey=`maintenance/snapshots/${sourceId}/${sha}.json`
  await f.bucket.put(snapshotKey,canonical(snapshot));await f.bucket.put(snapshot.textKey!,body);await f.bucket.put(snapshot.rawKey,body)
  const targets:MaintenanceRecordTarget[]=Array.from({length:count},(_,index)=>({recordId:`target-${index}`,entityType:engine==='cycles'?'program':'admission-cycle',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:String(index+1).padStart(64,'d'),identity:{name:{en:engine==='cycles'?`Computer Science ${index}`:'Computer Science'},...(engine==='cycles'?{degreeLevel:'master'}:{})},year:engine==='cycles'?null:'2027-2028',intake:engine==='cycles'?null:'autumn',fields:{},reviewAfter:'2026-11-16'}))
  const pins=targets.map(target=>({id:`${target.entityType}:${target.recordId}`,sha256:target.recordScopeSha256}))
  const job={job_id:await materialBatchJobId({engine,sourceId,snapshotSha256:sha,createdAt,pins,version:2}),source_id:sourceId,stage:engine==='program'?'extract':engine==='scholarship'?'award':'maintain',snapshot_sha256:sha,snapshot_key:snapshotKey,created_at:createdAt,target_ids_json:canonical(materialBatchEnvelope(engine,pins))}as JobRow
  const row={source_id:sourceId,url,allowed_hosts_json:'["test.edu.cn"]'}as SourceRow
  return{...f,snapshot,job,row,targets,pins}
}
test('v1 job hashes match the original formulas and merely deploying v2 does not upgrade existing jobs',async()=>{
  const sourceId='a'.repeat(64),snapshotSha256='b'.repeat(64),createdAt='2026-11-16T01:00:00.000Z',pins=[{id:'program:p',sha256:'c'.repeat(64)}]
  for(const engine of ['fields','cycles','program','scholarship']as const){
    const expected=engine==='fields'?`maintain:${sourceId}:${snapshotSha256}:2026-11-16:${canonical(pins)}:fields-v1`:engine==='cycles'?`cycle-discovery:${sourceId}:${snapshotSha256}:${canonical(pins)}:v1`:`${engine==='program'?'extract':'award'}:${sourceId}:${snapshotSha256}:identity-v1`
    assert.equal(await materialBatchJobId({engine,sourceId,snapshotSha256,createdAt,pins,version:1}),await digest(expected))
    for(const old of [null,canonical(pins),canonical({kind:'cycle-discovery',targets:pins})])assert.equal(await readMaterialBatchContract({target_ids_json:old}as JobRow,engine),1)
  }
})
test('changing a queued v1 envelope cannot upgrade its identity; malformed versions and excess complete pins are held',async()=>{
  const f=await fixture('fields',8)
  try{
    await assert.rejects(readMaterialBatchContract({...f.job,job_id:await materialBatchJobId({engine:'fields',sourceId:f.row.source_id,snapshotSha256:f.snapshot.rawSha256,createdAt:f.job.created_at,pins:f.pins,version:1})},'fields'),/job_binding_invalid/u)
    for(const scope of [{...materialBatchEnvelope('fields',f.pins),contractVersion:3},materialBatchEnvelope('fields',[...f.pins,{id:'program:extra',sha256:'e'.repeat(64)}]),{...materialBatchEnvelope('fields',f.pins),unreviewed:true}])await assert.rejects(readMaterialBatchContract({...f.job,target_ids_json:canonical(scope)},'fields'),/contract_invalid/u)
    await assert.rejects(readMaterialBatchContract(f.job,'fields',f.targets.slice(0,7)),/target_scope_changed/u)
    await assert.rejects(readMaterialBatchContract(f.job,'fields',[...f.targets.slice(0,7),{...f.targets[7],recordScopeSha256:'e'.repeat(64)}]),/target_scope_changed/u)
  }finally{f.db.sqlite.close()}
})
test('v2 fields retain all eight pins and independent review; both exact requests are audited as new contract scopes',async()=>{
  const f=await fixture('fields',8),requests:ModelRequest[]=[]
  try{
    const run=async(context:DocumentPartitionContext,targets:MaintenanceRecordTarget[])=>maintainFields(f.env,f.job,f.row,context.snapshot,targets,async(_env,request)=>{
      requests.push(request);const payload=JSON.parse(request.payload);assert.equal(payload.targets.length,8);assert.deepEqual(payload.materialBatchContract,{version:2,maxRecords:8})
      return{attemptId:request.pass,artifactKey:`maintenance/models/${request.reservationKey}.json`,artifactSha256:'a'.repeat(64),reused:false,output:{records:targets.map(target=>({recordId:target.recordId,year:'2027-2028',intake:'autumn',applicabilityQuote:'International students applying to Computer Science.',scopeQuote:'Autumn 2027 admissions.',patches:[{fieldPath:'closesOn',value:'2027-09-30',factStatus:'known',quote:'Application deadline: 2027-09-30.'}]}))}}
    },context)
    const first=await runPartitionedDocument(f.env,f.job,f.row,f.snapshot,'fields',f.targets,run);assert.equal(first.pending,true);assert.equal(requests.length,2)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get()?.n,0)
    const done=await runPartitionedDocument(f.env,f.job,f.row,f.snapshot,'fields',f.targets,run);assert.equal(done.pending,false);assert.equal(done.ready,8);assert.equal(done.completeSchoolCatalogueClaimed,false)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get()?.n,8)
  }finally{f.db.sqlite.close()}
})
test('v2 cycles use all five exact programmes with the unchanged annual/season evidence rules',async()=>{
  const f=await fixture('cycles',5),requests:ModelRequest[]=[]
  try{
    const result=await discoverAdmissionCycles(f.env,f.job,f.row,f.snapshot,f.targets,async(_env,request)=>{
      requests.push(request);const p=JSON.parse(request.payload);assert.equal(p.targets.length,5);assert.deepEqual(p.materialBatchContract,{version:2,maxRecords:5})
      return{attemptId:request.pass,artifactKey:`maintenance/models/${request.reservationKey}.json`,artifactSha256:'a'.repeat(64),reused:false,output:{cycles:f.targets.map((target,index)=>({programId:target.recordId,academicYear:'2028-2029',intake:'autumn',programQuote:`Master Computer Science ${index}.`,internationalQuote:'International students',cycleScopeQuote:`Autumn 2028 admissions for Master Computer Science ${index}.`,patches:[{fieldPath:'opensOn',value:'2027-11-01',factStatus:'known',quote:'Application opens 2027-11-01; application deadline 2028-04-30.'},{fieldPath:'dateStatus',value:'published',factStatus:'known',quote:'Application opens 2027-11-01; application deadline 2028-04-30.'}]}))}}
    })
    assert.equal(requests.length,2);assert.equal(result.proposals.length,5)
  }finally{f.db.sqlite.close()}
})
test('v2 identities force short-source partitioning, cap both passes at ten and keep unfinished ranges explicit',async()=>{
  for(const engine of ['program','scholarship']as const){
    const f=await fixture(engine)
    try{
      let calls=0
      f.env.MODEL_ADMISSION={idFromName:name=>name,get:()=>({fetch:async request=>{calls++;const input=await request.json()as ModelRequest,p=JSON.parse(input.payload);assert.deepEqual(p.materialBatchContract,{version:2,maxRecords:10});assert.ok(p.partitionPolicy.includes('at most 10'));return Response.json({ok:true,attemptId:input.pass,artifactKey:'maintenance/models/local.json',artifactSha256:'a'.repeat(64),reused:false,output:{programs:[],scholarships:[],moreCandidates:true}})}})}
      const segment=async(context:DocumentPartitionContext)=>{
        const result=engine==='program'?await extractIdentities(f.env,f.job,f.row,{partition:context,persist:false}):await extractScholarshipIdentities(f.env,f.job,f.row,async(_env,input)=>{calls++;const p=JSON.parse(input.payload);assert.deepEqual(p.materialBatchContract,{version:2,maxRecords:10});return{attemptId:input.pass,artifactKey:'maintenance/models/local.json',artifactSha256:'a'.repeat(64),reused:false,output:{scholarships:[],moreCandidates:true}}},{partition:context,persist:false})
        return{proposals:result.proposals??[],held:[],capacityLimited:result.partitionCapacityLimited}
      }
      const first=await runPartitionedDocument(f.env,f.job,f.row,f.snapshot,engine,[],segment);assert.equal(first.handled,true);assert.equal(first.unfinishedSections,1)
      const done=await runPartitionedDocument(f.env,f.job,f.row,f.snapshot,engine,[],segment);assert.equal(done.pending,false);assert.equal(done.unfinishedSections,1);assert.equal(done.completeSchoolCatalogueClaimed,false);assert.equal(calls,1)
    }finally{f.db.sqlite.close()}
  }
})
test('v2 12k partitions own the complete actual text and retain Unicode, while v1 manifest bytes remain unchanged',async()=>{
  const text='汉字😀 official catalogue\n\n'.repeat(2000),sha=await digest(text),snapshot={textKey:'full.txt',textSha256:sha,rawSha256:'a'.repeat(64)}as CapturedSnapshot
  const legacy=await buildDocumentPartitions('source',snapshot,text),again=await buildDocumentPartitions('source',snapshot,text,[],1),v2=await buildDocumentPartitions('source',snapshot,text,[],2)
  assert.equal(canonical(legacy),canonical(again));assert.equal(Object.hasOwn(legacy,'materialBatchContractVersion'),false)
  assert.equal(v2.materialBatchContractVersion,2);assert.equal(v2.partitions.map(part=>text.slice(part.start,part.end)).join(''),text)
  assert.ok(v2.partitions.every(part=>part.end-part.start<=12000&&!/[\uD800-\uDBFF]/u.test(text[part.end-1])))
})
test('a v2 key and short partition cannot escape an existing source unknown',async()=>{
  const f=await fixture('program')
  try{
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('old','old',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(f.row.source_id,f.snapshot.rawSha256,'e'.repeat(64),new Date().toISOString())
    let calls=0
    await assert.rejects(runPartitionedDocument(f.env,f.job,f.row,f.snapshot,'program',[],async()=>{calls++;return{proposals:[],held:[]}}),/material_batch_source_history_protected/u)
    assert.equal(calls,0);assert.equal(f.db.sqlite.prepare("SELECT status FROM maintenance_model_attempts WHERE reservation_key='old'").get()?.status,'unknown')
  }finally{f.db.sqlite.close()}
})
