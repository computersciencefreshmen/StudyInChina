import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerBootstrapRequest,preparePendingBootstrap,runCloudTick,runtimeStatus,buildSoakObservation,type RuntimeTick } from '../src/runtime'
import { processMessage } from '../src/index'
import { control,seed,setControls } from '../src/repository'
import { extractIdentities } from '../src/extraction'
import { prepareExport } from '../src/exports'
import { canonical,digest,gateRequest } from '../src/util'
import type { JobRow } from '../src/types'
import { makeEnv,seedInput,TEST_GUARDS,TEST_SCOPE } from './fixture'

const canary=['uni-000','uni-001','uni-002','uni-003','uni-004']
async function uploadRequest(value:unknown,override?:string){const body=JSON.stringify(value),hash=override??await digest(body);return{hash,request:new Request('https://worker/bootstrap',{method:'POST',headers:{'content-type':'application/json','content-length':String(new TextEncoder().encode(body).length),'x-maintenance-bootstrap-sha256':hash,'x-maintenance-scope-sha256':TEST_SCOPE,'x-maintenance-canary-ids':canary.join(','),'x-maintenance-models-enabled':'true'},body})}}

test('streamed bootstrap and validation survive unavailable D1 and retain an immutable initial intent',async()=>{
  const f=makeEnv(),database=f.env.PIPELINE_DB;let reads=0
  f.env.PIPELINE_DB={prepare(){reads++;throw new Error('D1_ERROR 7500 daily read quota exceeded')},async batch(){throw new Error('D1_ERROR 7500')}}
  const value={seed:seedInput(),activation:{canaryUniversityIds:canary,modelsEnabled:true}},upload=await uploadRequest(value)
  assert.equal((await registerBootstrapRequest(f.env,upload.request)).activationValidated,false);assert.equal(reads,0)
  await preparePendingBootstrap(f.env,upload.hash);assert.equal(reads,0)
  const receipt=await runCloudTick(f.env);assert.equal(receipt.state,'quota_wait');assert.ok(receipt.receiptSha256);assert.ok(receipt.retryAt?.endsWith('T00:00:00.000Z'))
  const status=await runtimeStatus(f.env);assert.equal(status.backend.state,'quota_wait');assert.equal(status.control,null);assert.equal(status.soak.passed,false);assert.ok(status.bootstrapPending)
  const changed=await uploadRequest({...value,seed:{...seedInput(),inputCatalogSha256:'f'.repeat(64)}})
  await assert.rejects(registerBootstrapRequest(f.env,changed.request),/immutable_bootstrap_conflict/)
  f.env.PIPELINE_DB=database;f.db.sqlite.close()
})
test('restored D1 seeds through the Queue, activates only the five approved schools, and never overwrites a later pause',async()=>{
  const f=makeEnv(),upload=await uploadRequest({seed:seedInput(),activation:{canaryUniversityIds:canary,modelsEnabled:true}})
  await registerBootstrapRequest(f.env,upload.request);await processMessage(f.env,f.messages.shift()!)
  assert.equal((await runCloudTick(f.env)).state,'waiting_for_seed')
  while(f.messages.length){const message=f.messages.shift()!;assert.ok(message.bootstrapSeedSha256||message.seedSha256);await processMessage(f.env,message)}
  assert.equal((await control(f.env))?.seed_complete,1);assert.equal((await control(f.env))?.models_enabled,0)
  const running=await runCloudTick(f.env);assert.equal(running.state,'running');const cfg=await control(f.env);assert.ok(cfg);assert.deepEqual(JSON.parse(cfg.canary_json),canary);assert.equal(cfg.models_enabled,1)
  await setControls(f.env,{expectedRevision:cfg.revision,legacyGuardSha256:TEST_GUARDS,enabled:false,modelsEnabled:false,canaryUniversityIds:canary})
  await runCloudTick(f.env);assert.equal((await control(f.env))?.enabled,0);assert.equal((await control(f.env))?.models_enabled,0);assert.equal((await control(f.env))?.revision,2);f.db.sqlite.close()
})
test('a forged streaming digest is held before any D1 seed or activation',async()=>{
  const f=makeEnv(),upload=await uploadRequest({seed:seedInput(),activation:{canaryUniversityIds:canary,modelsEnabled:true}},'0'.repeat(64))
  await registerBootstrapRequest(f.env,upload.request);await assert.rejects(preparePendingBootstrap(f.env,upload.hash),/bootstrap_upload_checksum_mismatch/);assert.equal(await control(f.env),null);f.db.sqlite.close()
})
test('hashless parent reservations cover admission-cycle children from the persisted target relationship',async()=>{
  const f=makeEnv(),sourceId=await digest('https://test.edu.cn/catalog'),input=seedInput()
  input.legacyGuards.entries.push({id:'parent-stop',universityId:'uni-000',sourceId:null,recordId:'program-parent',fields:'*',state:'unknown',artifactSha256:'e'.repeat(64),reason:'unknown complete parent request'}as never)
  await seed(f.env,{...input,recordTargets:[{recordId:'cycle-child',entityType:'admission-cycle',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:'d'.repeat(64),identity:{name:{en:'Computer Science'},programId:'program-parent'},year:'2026-2027',intake:'spring',fields:{closesOn:null},reviewAfter:'2026-10-24'}]})
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:canary})
  const response=await gateRequest(f.env,'/model/run',{reservationKey:'f'.repeat(64),sourceId,universityIds:['uni-000'],snapshotSha256:'1'.repeat(64),pass:'primary',payload:'cycle-only request',lane:'maintenance',recordIds:['cycle-child']})
  assert.equal((await response.json()).error,'legacy_scope_stop_or_reservation');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count,0);f.db.sqlite.close()
})
test('programme source text is never silently truncated into a completed extraction',async()=>{
  const f=makeEnv();await seed(f.env,seedInput());const sourceId=await digest('https://test.edu.cn/catalog'),rawSha='1'.repeat(64),text='x'.repeat(50001),textSha=await digest(text),key=`maintenance/snapshots/${sourceId}/${rawSha}.json`
  await f.bucket.put('maintenance/long.txt',text);await f.bucket.put(key,canonical({version:1,sourceId,sourceUrl:'https://test.edu.cn/catalog',finalUrl:'https://test.edu.cn/catalog',checkedAt:new Date().toISOString(),contentType:'text/html',rawSha256:rawSha,rawKey:'maintenance/raw.bin',textKey:'maintenance/long.txt',textSha256:textSha,canonicalSha256:textSha,parserCandidates:[]}))
  const row=await f.env.PIPELINE_DB.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').bind(sourceId).first();assert.ok(row)
  await assert.rejects(extractIdentities(f.env,{snapshot_key:key,snapshot_sha256:rawSha}as JobRow,row as never),/program_source_requires_explicit_partition/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count,0);f.db.sqlite.close()
})
test('export snapshot changes during artifact preparation abort the entire SQL claim',async()=>{
  const f=makeEnv();await seed(f.env,seedInput());const sourceId=await digest('https://test.edu.cn/catalog'),raw='1'.repeat(64),now=new Date().toISOString()
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run(raw,sourceId)
  const proposal={id:'race-proposal',universityId:'uni-000',entityType:'program',recordId:null,operation:'create',fields:{},source:{id:sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:raw,objectKey:'maintenance/raw.bin',checkedAt:now,contentType:'text/html',locator:'text:document',quote:'International programme'},fieldEvidence:[{sourceId,url:'https://test.edu.cn/catalog',snapshotSha256:raw,objectKey:'maintenance/raw.bin',locator:'text:document',quote:'International programme',fieldPath:'name.en'}],scope:{year:null,intake:null},status:'ready',warnings:[]}
  f.db.sqlite.prepare('INSERT INTO maintenance_proposals(proposal_id,university_id,source_id,snapshot_sha256,status,proposal_json,created_at) VALUES(?,?,?,?,?,?,?)').run(proposal.id,proposal.universityId,sourceId,raw,'ready',JSON.stringify(proposal),now)
  const put=f.bucket.put.bind(f.bucket);f.bucket.put=async(key,body,options)=>{const result=await put(key,body,options);if(key.startsWith('maintenance/exports/'))f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run('2'.repeat(64),sourceId);return result}
  await assert.rejects(prepareExport(f.env,{limit:10}),/CHECK constraint/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_exports').get()?.count,0);assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_proposals').get()?.status,'ready');f.db.sqlite.close()
})
test('seven-day evidence needs real elapsed time, complete cadence, and no quota or failure gaps',()=>{
  const start=Date.parse('2026-10-24T00:00:00Z'),make=(time:number):RuntimeTick=>({format:'studyinchina.cloud-maintenance-tick',version:1,tickId:String(time),observedAt:new Date(time).toISOString(),state:'running',code:'bounded_scheduler_completed',queued:0,seedComplete:true,targetsComplete:true,modelsEnabled:true,canarySchoolCount:0,retryAt:null})
  assert.equal(buildSoakObservation(Array.from({length:700},()=>make(start)),new Date(start).toISOString(),start+3600000).passed,false)
  const ticks=Array.from({length:7*24*4+1},(_,i)=>make(start+i*900000)),end=start+7*86400000
  assert.equal(buildSoakObservation(ticks,new Date(start).toISOString(),end).passed,true)
  assert.equal(buildSoakObservation(ticks.filter((_,i)=>i<20||i>25),new Date(start).toISOString(),end).passed,false)
  assert.equal(buildSoakObservation([...ticks,{...make(start+3600000),state:'quota_wait'}],new Date(start).toISOString(),end).passed,false)
})
test('the cloud scheduler needs explicit mode and authorization and receives no provider key',()=>{
  const yaml=readFileSync(new URL('../../../.github/workflows/catalog-maintenance-tick.yml',import.meta.url),'utf8')
  assert.match(yaml,/CATALOG_MAINTENANCE_MODE == 'cloud'/);assert.match(yaml,/CATALOG_MAINTENANCE_TICK_ENABLED == 'true'/);assert.match(yaml,/ref: main/);assert.match(yaml,/contents: read/);assert.doesNotMatch(yaml,/MINIMAX_.*(?:KEY|TOKEN)|CLOUDFLARE_API_TOKEN/)
})
