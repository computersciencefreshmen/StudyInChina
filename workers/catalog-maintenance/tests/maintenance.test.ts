import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch, handleQueue,processMessage } from '../src/index'
import { normalizePlanQuota, quotaAdmission } from '../src/admission'
import { acknowledge, prepareExport, readExport } from '../src/exports'
import { claimJob, continueSeed,control, enqueueDue,finishJob,queueExtraction,refreshTargets,seed,setControls,source } from '../src/repository'
import { captureSource } from '../src/capture'
import { digest, gateRequest } from '../src/util'
import type { ModelRequest } from '../src/types'
import { makeEnv, quotaResponse, seedInput, TEST_CATALOG, TEST_GUARDS } from './fixture'

async function enabled(fixture:ReturnType<typeof makeEnv>,models=true){await seed(fixture.env,seedInput());await setControls(fixture.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:models,canaryUniversityIds:['uni-000']})}
const modelRequest=async():Promise<ModelRequest>=>({reservationKey:await digest('request-one'),sourceId:await digest('https://test.edu.cn/catalog'),universityIds:['uni-000'],snapshotSha256:'d'.repeat(64),pass:'primary',payload:'explicit test payload',lane:'expansion',recordIds:[]})

test('authenticated versioned bootstrap evidence is readable while traversal stays rejected',async()=>{
  const f=makeEnv(),key='maintenance/bootstrap-pending/initial.v1.json',headers={authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`}
  await f.bucket.put(key,'{"seedSha256":"pinned-history"}')
  const response=await handleFetch(new Request(`https://worker/artifacts?key=${encodeURIComponent(key)}`,{headers}),f.env)
  assert.equal(response.status,200);assert.equal(await response.text(),'{"seedSha256":"pinned-history"}')
  assert.equal((await handleFetch(new Request(`https://worker/artifacts?key=${encodeURIComponent(key)}`),f.env)).status,401)
  assert.equal((await handleFetch(new Request('https://worker/artifacts?key=maintenance/a/../secret',{headers}),f.env)).status,409)
  f.db.sqlite.close()
})

test('seed is fixed to272, initially disabled, immutable and complete before canary activation',async()=>{
  const fixture=makeEnv();await seed(fixture.env,seedInput());assert.equal((await control(fixture.env))?.enabled,0);assert.equal((await control(fixture.env))?.seed_complete,1)
  assert.equal((await seed(fixture.env,seedInput())).reused,true)
  const wrong=seedInput();wrong.schools.pop();await assert.rejects(seed(fixture.env,wrong),/invalid_fixed_scope_seed/)
  await assert.rejects(setControls(fixture.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true}),/initial_canary_required/)
  assert.deepEqual(await enqueueDue(fixture.env),{enabled:false,queued:0});fixture.db.sqlite.close()
})
test('unauthenticated endpoints and non-maintenance artifact keys never expose private data',async()=>{
  const{env,db}=makeEnv();assert.equal((await handleFetch(new Request('https://worker/status'),env)).status,401)
  const response=await handleFetch(new Request('https://worker/artifacts?key=private/credentials',{headers:{authorization:`Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`}}),env)
  assert.equal(response.status,409);assert.equal((await handleFetch(new Request('https://worker/health'),env)).status,200);db.sqlite.close()
})
test('scheduler and claims preserve finite jobs and exactly one current owner',async()=>{
  const fixture=makeEnv();await enabled(fixture,false);assert.equal((await enqueueDue(fixture.env)).queued,1);assert.equal((await enqueueDue(fixture.env)).queued,0)
  const id=fixture.messages[0].jobId,claims=await Promise.all(Array.from({length:10},()=>claimJob(fixture.env,id)))
  assert.equal(claims.filter(Boolean).length,1);fixture.db.sqlite.close()
})
test('official quota needs one valid shared pool and both current windows',async()=>{
  const payload=await quotaResponse().json(),quota=normalizePlanQuota(payload);assert.ok(quota);assert.equal(quotaAdmission(quota,'expansion',false,false).allow,true)
  assert.equal(normalizePlanQuota({...payload,model_remains:[...(payload.model_remains??[]),...(payload.model_remains??[])]}),null)
  const low=normalizePlanQuota(await quotaResponse(15,80).json());assert.equal(quotaAdmission(low,'expansion',true,false).code,'maintenance_quota_reserved');assert.equal(quotaAdmission(low,'maintenance',true,false).allow,true)
  assert.equal(quotaAdmission(null,'maintenance',false,true).allow,false)
  assert.equal(quotaAdmission({...quota,checkedAt:new Date(Date.now()-31000).toISOString()},'maintenance',false,true).allow,false)
})
test('account fetch permits enforce global8 and same-host1 across callers',async()=>{
  const fixture=makeEnv(),responses=await Promise.all(Array.from({length:12},(_,i)=>gateRequest(fixture.env,'/fetch/acquire',{host:`h${i}.edu.cn`})))
  assert.equal(responses.filter(r=>r.ok).length,8)
  const tokens=await Promise.all(responses.filter(r=>r.ok).map(r=>r.json()))
  assert.equal((await gateRequest(fixture.env,'/fetch/acquire',{host:'h0.edu.cn'})).status,429)
  for(const token of tokens)await gateRequest(fixture.env,'/fetch/release',token)
  assert.equal((await gateRequest(fixture.env,'/fetch/acquire',{host:'new.edu.cn'})).status,200);fixture.db.sqlite.close()
})
test('lost model reply persists unknown before releasing capacity and never sends again',async()=>{
  let modelCalls=0
  const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();modelCalls++;throw new Error('simulated lost reply')})
  await enabled(fixture);const request=await modelRequest()
  const first=await gateRequest(fixture.env,'/model/run',request);assert.equal(first.status,409);assert.equal((await first.json()).error,'model_outcome_unknown')
  const second=await gateRequest(fixture.env,'/model/run',request);assert.equal((await second.json()).error,'prior_model_outcome_requires_review');assert.equal(modelCalls,1)
  assert.equal(fixture.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'unknown');fixture.db.sqlite.close()
})
test('legacy snapshot reservation blocks same bytes independent of prompt, but permits new evidence',async()=>{
  let modelCalls=0
  const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();modelCalls++;return Response.json({content:[{type:'text',text:'{"programs":[]}'}],usage:{input_tokens:1,output_tokens:1},stop_reason:'end_turn'})})
  const input=seedInput(),request=await modelRequest();input.legacyGuards.entries.push({id:'old-scope',universityId:'uni-000',sourceId:request.sourceId,recordId:'old-record',fields:'*',state:'unknown',artifactSha256:'e'.repeat(64),reason:'historical ambiguous attempt',snapshotSha256:request.snapshotSha256} as never)
  await seed(fixture.env,input);await setControls(fixture.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']})
  assert.equal((await (await gateRequest(fixture.env,'/model/run',request)).json()).error,'legacy_scope_stop_or_reservation');assert.equal(modelCalls,0)
  const changed={...request,snapshotSha256:'f'.repeat(64),reservationKey:await digest('new-evidence')};assert.equal((await gateRequest(fixture.env,'/model/run',changed)).status,200);assert.equal(modelCalls,1);fixture.db.sqlite.close()
})
test('completed exact requests reuse immutable artifacts without consuming another model call',async()=>{
  let calls=0;const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();calls++;return Response.json({content:[{type:'text',text:'{"programs":[]}'}],usage:{input_tokens:5,output_tokens:2},stop_reason:'end_turn'})})
  await enabled(fixture);const input=await modelRequest();assert.equal((await gateRequest(fixture.env,'/model/run',input)).status,200);assert.equal((await (await gateRequest(fixture.env,'/model/run',input)).json()).reused,true);assert.equal(calls,1);fixture.db.sqlite.close()
})
test('definite provider429 retries after a durable cooldown and retains both attempt receipts',async()=>{
  let calls=0,time=Date.now();const originalClock=Date.now;Date.now=()=>time
  const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();calls++;return calls===1?new Response('busy',{status:429,headers:{'retry-after':'60'}}):Response.json({content:[{type:'text',text:'{"programs":[]}'}],usage:{input_tokens:1,output_tokens:1},stop_reason:'end_turn'})})
  try{await enabled(fixture);const request=await modelRequest();assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,429);assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,429);assert.equal(calls,1);time+=61000;assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,200);assert.equal(calls,2);const rows=fixture.db.sqlite.prepare('SELECT status,error_code FROM maintenance_model_attempts ORDER BY started_at').all();assert.equal(rows.length,2);assert.equal(rows[0].status,'known_failed');assert.equal(rows[0].error_code,'model_http_429');assert.equal(rows[1].status,'completed')}finally{Date.now=originalClock;fixture.db.sqlite.close()}
})
test('a D1 daily-quota admission failure waits without reserving or sending a model',async()=>{
  let calls=0
  const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();calls++;return Response.json({content:[{type:'text',text:'{"programs":[]}'}],usage:{input_tokens:1,output_tokens:1},stop_reason:'end_turn'})})
  await enabled(fixture);const request=await modelRequest(),database=fixture.env.PIPELINE_DB
  fixture.env.PIPELINE_DB={prepare(){throw new Error('D1_ERROR 7500 daily read quota exceeded')},async batch(){throw new Error('D1_ERROR 7500')}}
  const response=await gateRequest(fixture.env,'/model/run',request),waiting=await response.json()
  assert.equal(response.status,429);assert.equal(waiting.error,'quota_backend_wait');assert.ok(waiting.retryAfter>=60);assert.equal(calls,0);assert.equal(fixture.storage.values.has(`request:${request.reservationKey}`),false)
  fixture.env.PIPELINE_DB=database;assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,200);assert.equal(calls,1);fixture.db.sqlite.close()
})
test('a definite pre-send persistence failure retries after cooldown without replaying a sent request',async()=>{
  let calls=0,time=Date.now(),failOnce=true;const originalClock=Date.now;Date.now=()=>time
  const fixture=makeEnv(async input=>{if(String(input).includes('token_plan'))return quotaResponse();calls++;return Response.json({content:[{type:'text',text:'{"programs":[]}'}],usage:{input_tokens:1,output_tokens:1},stop_reason:'end_turn'})})
  try{
    await enabled(fixture);const request=await modelRequest(),prepare=fixture.db.prepare.bind(fixture.db)
    fixture.db.prepare=sql=>{if(failOnce&&sql.startsWith('INSERT INTO maintenance_model_attempts')){failOnce=false;throw new Error('simulated failure before any provider send')}return prepare(sql)}
    const first=await gateRequest(fixture.env,'/model/run',request);assert.equal(first.status,429);assert.equal((await first.json()).error,'model_not_sent');assert.equal(calls,0)
    assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,429);assert.equal(calls,0)
    time+=61000;assert.equal((await gateRequest(fixture.env,'/model/run',request)).status,200);assert.equal(calls,1);assert.equal(fixture.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()?.status,'completed')
  }finally{Date.now=originalClock;fixture.db.sqlite.close()}
})
test('staged bootstrap resumes bounded SQL chunks and cannot activate with a partial guard ledger',async()=>{
  const fixture=makeEnv(),input=seedInput()
  for(let index=0;index<400;index++)input.legacyGuards.entries.push({id:`guard-${index}`,universityId:'uni-000',sourceId:null,recordId:`record-${index}`,fields:'*',state:'unknown',artifactSha256:'e'.repeat(64),reason:'retained legacy request'}as never)
  const initial=await seed(fixture.env,input,Date.now(),true);assert.equal(initial.seedComplete,false);assert.equal((await control(fixture.env))?.seed_complete,0)
  await continueSeed(fixture.env,initial.seedSha256,false);assert.equal((await control(fixture.env))?.seed_complete,0)
  await assert.rejects(setControls(fixture.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']}),/control_revision_or_guard_mismatch/)
  while(!(await control(fixture.env))?.seed_complete)await continueSeed(fixture.env,initial.seedSha256,false)
  assert.equal(fixture.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_legacy_guards').get()?.count,400);fixture.db.sqlite.close()
})
test('target refresh is pinned to the applied catalogue and deactivates removed targets',async()=>{
  const fixture=makeEnv();await enabled(fixture,false)
  const sourceId=await digest('https://test.edu.cn/catalog'),target={recordId:'program-one',entityType:'program',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:'d'.repeat(64),identity:{name:{en:'Computer Science'}},year:null,intake:null,fields:{durationMonths:null},reviewAfter:'2026-10-24'}
  await assert.rejects(refreshTargets(fixture.env,{inputCatalogSha256:'0'.repeat(64),recordTargets:[target]}),/target_refresh_catalogue_mismatch/)
  await refreshTargets(fixture.env,{inputCatalogSha256:TEST_CATALOG,recordTargets:[target]});assert.equal(fixture.db.sqlite.prepare('SELECT active FROM maintenance_record_targets').get()?.active,1)
  await refreshTargets(fixture.env,{inputCatalogSha256:TEST_CATALOG,recordTargets:[]});assert.equal(fixture.db.sqlite.prepare('SELECT active FROM maintenance_record_targets').get()?.active,0);assert.equal((await control(fixture.env))?.targets_complete,1);fixture.db.sqlite.close()
})
test('one captured mixed URL retains both programme and scholarship discovery jobs',async()=>{
  const fixture=makeEnv(),input=seedInput();input.schools[0].sourceSeeds.push({...input.schools[0].sourceSeeds[0],id:'official-award',sourceCategory:'university_scholarship'})
  await seed(fixture.env,input);const row=await source(fixture.env,await digest('https://test.edu.cn/catalog'));assert.ok(row);assert.equal(JSON.parse(row.categories_json??'[]').length,2)
  await queueExtraction(fixture.env,row,'d'.repeat(64),'maintenance/snapshots/test.json');assert.deepEqual(fixture.db.sqlite.prepare('SELECT stage FROM maintenance_jobs ORDER BY stage').all().map(row=>row.stage),['award','extract']);fixture.db.sqlite.close()
})
test('finite exports retain the21st school and regular cadence yields to fresh urgent deadlines',async()=>{
  const fixture=makeEnv();await seed(fixture.env,seedInput())
  const sourceId=await digest('https://test.edu.cn/catalog'),createdAt=new Date().toISOString()
  for(let index=0;index<21;index++){
    const proposal={id:`proposal-${index}`,universityId:`uni-${String(index).padStart(3,'0')}`,entityType:'program',recordId:null,operation:'create',fields:{},source:{id:sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:'d'.repeat(64),objectKey:'maintenance/test.bin',checkedAt:createdAt,contentType:'text/html',locator:'text:document',quote:'International programme'},fieldEvidence:[{fieldPath:'name.en',sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:'d'.repeat(64),objectKey:'maintenance/test.bin',locator:'text:document',quote:'International programme'}],scope:{year:null,intake:null},status:'ready',warnings:[]}
    fixture.db.sqlite.prepare('INSERT INTO maintenance_proposals(proposal_id,university_id,source_id,snapshot_sha256,status,proposal_json,created_at) VALUES(?,?,?,?,?,?,?)').run(proposal.id,proposal.universityId,sourceId,'d'.repeat(64),'ready',JSON.stringify(proposal),createdAt)
  }
  const first=await prepareExport(fixture.env,{limit:100}),batch=await readExport(fixture.env,first.batchId);assert.equal(new Set(batch.proposals.map(p=>p.universityId)).size,20);assert.equal(fixture.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='ready'").get()?.count,1)
  await acknowledge(fixture.env,{batchId:first.batchId,outcome:'applied',receiptSha256:'1'.repeat(64),sourceCommit:'2'.repeat(40),newInputCatalogSha256:'3'.repeat(64),acceptedProposalIds:batch.proposals.map(p=>p.id),heldProposalIds:[]})
  await assert.rejects(prepareExport(fixture.env,{limit:100}),/export_cadence_wait/)
  const pending=fixture.db.sqlite.prepare("SELECT proposal_id,proposal_json FROM maintenance_proposals WHERE status='ready'").get();assert.ok(pending);const urgent=JSON.parse(String(pending.proposal_json));urgent.operation='patch';urgent.recordId='existing-cycle';urgent.fields={patches:[{fieldPath:'closesOn',value:new Date(Date.now()+2*86400000).toISOString().slice(0,10),factStatus:'known'}]};fixture.db.sqlite.prepare('UPDATE maintenance_proposals SET proposal_json=? WHERE proposal_id=?').run(JSON.stringify(urgent),String(pending.proposal_id));assert.equal((await prepareExport(fixture.env,{limit:100})).proposalCount,1);fixture.db.sqlite.close()
})
test('a later unchanged official capture renews only supported leaf evidence using cached independent outputs',async()=>{
  let time=Date.now(),calls=0;const originalClock=Date.now;Date.now=()=>time
  const sourceUrl='https://test.edu.cn/catalog',text='International students Spring 2027 Computer Science. Application deadline: December 10, 2026.'
  const fieldOutput={records:[{recordId:'cycle-one',year:'2026-2027',intake:'spring',applicabilityQuote:'International students Spring 2027 Computer Science.',scopeQuote:'Spring 2027',patches:[{fieldPath:'closesOn',value:'2026-12-10',factStatus:'known',quote:'December 10, 2026'}]}]}
  const fetcher:typeof fetch=async input=>{const url=String(input);if(url.includes('token_plan'))return quotaResponse();if(url.includes('/anthropic/v1/messages')){calls++;return Response.json({content:[{type:'text',text:JSON.stringify(fieldOutput)}],usage:{input_tokens:1,output_tokens:1},stop_reason:'end_turn'})}if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');return new Response(`<html><body>${text}</body></html>`,{headers:{'content-type':'text/html'}})}
  const fixture=makeEnv(fetcher),sourceId=await digest(sourceUrl)
  try{
    await seed(fixture.env,{...seedInput(),recordTargets:[{recordId:'cycle-one',entityType:'admission-cycle',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:'f'.repeat(64),identity:{name:{en:'Computer Science'},programId:'program-one'},year:'2026-2027',intake:'spring',fields:{closesOn:null,tuitionCny:9999},reviewAfter:'2026-10-24'}]})
    await setControls(fixture.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']})
    const captureAndMaintain=async()=>{await enqueueDue(fixture.env);const capture=fixture.db.sqlite.prepare("SELECT job_id FROM maintenance_jobs WHERE stage='capture' AND status='queued' ORDER BY created_at DESC LIMIT 1").get();assert.ok(capture);const job=await claimJob(fixture.env,String(capture.job_id));assert.ok(job);const row=await source(fixture.env,sourceId);assert.ok(row);await captureSource(fixture.env,job,row,fetcher,async()=>{});await finishJob(fixture.env,job,'done');const jobs=fixture.db.sqlite.prepare("SELECT job_id FROM maintenance_jobs WHERE stage='maintain' AND status='queued'").all();for(const candidate of jobs)await processMessage(fixture.env,{version:1,jobId:String(candidate.job_id)})}
    await captureAndMaintain();assert.equal(calls,2);const first=fixture.db.sqlite.prepare('SELECT proposal_json FROM maintenance_proposals').get();assert.ok(first);const original=JSON.parse(String(first.proposal_json));time+=8*86400000;await captureAndMaintain();assert.equal(calls,2)
    const proposals=fixture.db.sqlite.prepare('SELECT proposal_json FROM maintenance_proposals ORDER BY created_at').all().map(row=>JSON.parse(String(row.proposal_json)));assert.equal(proposals.length,2);assert.notEqual(proposals[1].source.checkedAt,original.source.checkedAt);assert.deepEqual(proposals[1].fields.patches.map((patch:{fieldPath:string})=>patch.fieldPath),['closesOn']);assert.equal(proposals[1].extractionAttemptId,original.extractionAttemptId)
  }finally{Date.now=originalClock;fixture.db.sqlite.close()}
})
test('real queue path captures official bytes, independently extracts, exports and separates apply/publish acknowledgement',async()=>{
  const sourceUrl='https://test.edu.cn/catalog'
  const text='International students: Bachelor Computer Science programme.'
  let calls=0
  const output={programs:[{universityId:'uni-000',name:{en:'Computer Science'},degreeLevel:'bachelor',programType:'degree',programUrl:sourceUrl,evidence:{quote:text,locator:'document'},internationalEvidence:{quote:'International students',locator:'document'},fieldEvidence:[{fieldPath:'name.en',quote:'Computer Science',locator:'document'},{fieldPath:'degreeLevel',quote:'Bachelor',locator:'document'}]}]}
  const fetcher:typeof fetch=async input=>{const url=String(input);if(url.includes('token_plan'))return quotaResponse();if(url.includes('/anthropic/v1/messages')){calls++;return Response.json({content:[{type:'text',text:JSON.stringify(output)}],usage:{input_tokens:10,output_tokens:20},stop_reason:'end_turn'})}if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}});return new Response(`<html><body>${text}</body></html>`,{headers:{'content-type':'text/html;charset=utf-8'}})}
  const fixture=makeEnv(fetcher);await enabled(fixture)
  // Avoid actual five-second waits by priming a robots observation; production
  // still enforces the inter-request gap and the durable host permit.
  fixture.db.sqlite.prepare('INSERT INTO maintenance_robots VALUES(?,?,?,?)').run('test.edu.cn',200,'User-agent: *\nAllow: /',new Date(Date.now()+3600000).toISOString())
  const originalFetch=globalThis.fetch;globalThis.fetch=fetcher
  try {
    await enqueueDue(fixture.env)
    const deliver=async()=>{const messages=fixture.messages.splice(0);for(const body of messages){let acked=false;await handleQueue({messages:[{id:body.jobId,body,attempts:1,ack(){acked=true},retry(){throw new Error('unexpected retry')}}]},fixture.env);assert.equal(acked,true)}}
    await deliver();await enqueueDue(fixture.env);await deliver();assert.equal(calls,2)
    const prepared=await prepareExport(fixture.env,{limit:10}),batch=await readExport(fixture.env,prepared.batchId);assert.equal(batch.proposals.length,1);assert.equal(batch.proposals[0].status,'ready');assert.notEqual(batch.proposals[0].extractionAttemptId,batch.proposals[0].review?.reviewAttemptId)
    const ack={batchId:batch.batchId,outcome:'applied',receiptSha256:'1'.repeat(64),sourceCommit:'2'.repeat(40),newInputCatalogSha256:'3'.repeat(64),acceptedProposalIds:batch.proposals.map(p=>p.id),heldProposalIds:[]}
    await acknowledge(fixture.env,ack);assert.equal(fixture.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'applied');assert.equal((await control(fixture.env))?.input_catalog_sha256,ack.newInputCatalogSha256)
    await assert.rejects(acknowledge(fixture.env,{...ack,outcome:'published'}),/stable_publication_proof_required/)
    await acknowledge(fixture.env,{...ack,outcome:'published',deploymentId:'dpl_test',stableProofSha256:'4'.repeat(64)})
    assert.equal(fixture.db.sqlite.prepare('SELECT status FROM maintenance_exports').get()?.status,'published');assert.notEqual((await control(fixture.env))?.input_catalog_sha256,TEST_CATALOG)
  }finally{globalThis.fetch=originalFetch;fixture.db.sqlite.close()}
})
