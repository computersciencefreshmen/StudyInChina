import type { Control, DurableStorage, MaintenanceEnv, ModelRequest } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, record } from './util'
import { loadSnapshot } from './capture'
import { normalizeEvidenceText } from '../../ingestion/src/rules'
import { EXISTING_SCHOOLS_V2_SHA256 } from './scope-config'
import { LEGACY_MODEL_NO_REPLAY_POLICY } from './legacy-model-guards'
import { TERMINAL_QUARANTINE_POLICY } from './reviewed-terminal-quarantine'

// This registry is a permanent STOP ledger, not a provider outcome correction.
const PREFIX = 'maintenance/runtime-model-guards/'
const INDEX = `${PREFIX}index.v1.json`
const KIND = 'runtime_model_guards_registered'
const MAX = 256 * 1024
const MAX_PROOFS = 32
const attemptFields = ['reservation_key','attempt_id','source_id','snapshot_sha256','pass','request_sha256','model','status','started_at','completed_at','output_key','output_sha256','usage_json','quota_json','error_code'] as const
const jobFields = ['job_id','source_id','stage','status','priority','attempt','created_at','updated_at','due_at','lease_token','lease_until','snapshot_sha256','snapshot_key','error_code','target_ids_json'] as const
type Tuple = Record<string, string | number | null>
type Ref = { key: string; sha256: string; bytes: number }
type Subject = { sourceId: string; url: string; rawSha256: string; snapshot: Ref; raw: Ref; text: Ref; textAliases: string[]; schoolIds: string[] }
type Proof = { format: 'studyinchina.runtime-model-no-replay-proof'; version: 1; operationId: string; scopeSha256: string; revision: number; inputCatalogSha256: string; observedAt: string;
  attempts: Tuple[]; jobs: Tuple[]; subjects: Subject[]; requests: Array<{ key: string; sha256: string }>; gateSha256: string; unknownOutcomesChanged: false; modelCallsPerformed: false }
type Commit = { format: 'studyinchina.runtime-model-no-replay-registration'; version: 1; operationId: string; proofSha256: string; scopeSha256: string; registeredRevision: number; operatorId: string; registeredAt: string; decision: 'preserve_unknown_permanent_no_replay' }
type Index = { format: 'studyinchina.runtime-model-no-replay-index'; version: 1; proofs: string[] }
function fail(suffix: string): never { throw new MaintenanceError(`runtime_model_guard_${suffix}`) }
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value)
const eventId = (operationId: string) => `runtime-model-guards:${operationId}`
const proofKey = (sha: string) => `${PREFIX}proofs/${sha}.json`
function tuple(value: unknown, fields: readonly string[]): Tuple {
  const row = record(value)
  if (!row || !exactKeys(row, fields) || fields.some(k => row[k] !== null && typeof row[k] !== 'string' && (typeof row[k] !== 'number' || !Number.isSafeInteger(row[k])))) return fail('tuple_invalid')
  return row as Tuple
}
function project(row: Record<string, unknown>, fields: readonly string[]) { return tuple(Object.fromEntries(fields.map(k => [k, row[k]])), fields) }
async function bytes(env: MaintenanceEnv, key: string, max = MAX) {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > max) return fail('artifact_unavailable')
  const raw = new Uint8Array(await object.arrayBuffer())
  if (raw.byteLength > max) return fail('artifact_oversized')
  return raw
}
async function ref(env: MaintenanceEnv, key: string, max = MAX): Promise<Ref> { const raw = await bytes(env,key,max); return {key,sha256:await digest(raw),bytes:raw.length} }
async function immutable(env: MaintenanceEnv, key: string, text: string) {
  const before = await env.SNAPSHOTS_BUCKET.get(key)
  if (before) { if (await before.text() !== text) fail('immutable_conflict'); return }
  await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  if (new TextDecoder().decode(await bytes(env,key)) !== text) fail('immutable_unconfirmed')
}
async function readIndex(env: MaintenanceEnv) {
  const object = await env.SNAPSHOTS_BUCKET.get(INDEX)
  if (!object) {
    const committed = await env.PIPELINE_DB.prepare('SELECT event_id FROM maintenance_events WHERE event_id=?').bind('runtime-model-guards:registry').first()
    if (committed) fail('index_missing')
    return { index:{format:'studyinchina.runtime-model-no-replay-index',version:1,proofs:[]} as Index, etag:null }
  }
  if (!object.etag || object.size !== undefined && object.size > 8192) fail('index_invalid')
  const text = await object.text(); if(new TextEncoder().encode(text).length>8192)fail('index_invalid'); const value = record(JSON.parse(text))
  if (!value || !exactKeys(value,['format','version','proofs']) || value.format !== 'studyinchina.runtime-model-no-replay-index' || value.version !== 1
    || !Array.isArray(value.proofs) || value.proofs.length > MAX_PROOFS || value.proofs.some(v => !HASH.test(String(v))) || new Set(value.proofs).size !== value.proofs.length || canonical(value) !== text) fail('index_invalid')
  return {index:value as unknown as Index,etag:object.etag}
}
async function ensureRegistryMarker(env:MaintenanceEnv){
  const key='runtime-model-guards:registry',kind='runtime_model_guard_registry_initialized',details='{"version":1,"denyMustBePresent":true}'
  await env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_events VALUES(?,?,?,?)').bind(key,kind,new Date().toISOString(),details).run()
  const row=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(key).first<{kind:string;details_json:string}>()
  if(!row||row.kind!==kind||row.details_json!==details)fail('index_marker_unconfirmed')
}
function parseProof(value: unknown): Proof {
  const p = record(value)
  if (!p || !exactKeys(p,['format','version','operationId','scopeSha256','revision','inputCatalogSha256','observedAt','attempts','jobs','subjects','requests','gateSha256','unknownOutcomesChanged','modelCallsPerformed'])
    || p.format !== 'studyinchina.runtime-model-no-replay-proof' || p.version !== 1 || !id(p.operationId) || !HASH.test(String(p.scopeSha256)) || !HASH.test(String(p.inputCatalogSha256)) || !HASH.test(String(p.gateSha256))
    || !Number.isSafeInteger(p.revision) || Number(p.revision)<0 || typeof p.observedAt !== 'string' || !Number.isFinite(Date.parse(p.observedAt)) || p.unknownOutcomesChanged !== false || p.modelCallsPerformed !== false
    || !Array.isArray(p.attempts) || !p.attempts.length || p.attempts.length>8 || !Array.isArray(p.jobs) || !p.jobs.length || p.jobs.length>16 || !Array.isArray(p.subjects) || !p.subjects.length || p.subjects.length>8 || !Array.isArray(p.requests) || p.requests.length!==p.attempts.length) fail('proof_invalid')
  for (const a of p.attempts) { const row=tuple(a,attemptFields); if(row.status!=='unknown'||!id(row.attempt_id)||!HASH.test(String(row.source_id))||!HASH.test(String(row.snapshot_sha256))||!HASH.test(String(row.reservation_key))||!HASH.test(String(row.request_sha256))) fail('proof_invalid') }
  for (const j of p.jobs) if(tuple(j,jobFields).status!=='unknown') fail('proof_invalid')
  const result=p as unknown as Proof
  if(new Set(result.attempts.map(a=>a.attempt_id)).size!==result.attempts.length||new Set(result.jobs.map(j=>j.job_id)).size!==result.jobs.length) fail('proof_invalid')
  for(const s of result.subjects){if(!s||!exactKeys(s,['sourceId','url','rawSha256','snapshot','raw','text','textAliases','schoolIds'])||!HASH.test(s.sourceId)||!HASH.test(s.rawSha256)||typeof s.url!=='string'
    ||!Array.isArray(s.textAliases)||s.textAliases.length<1||s.textAliases.length>2||s.textAliases.some(h=>!HASH.test(h))||!Array.isArray(s.schoolIds)||!s.schoolIds.length)fail('proof_invalid')
    for(const r of [s.snapshot,s.raw,s.text])if(!r||!exactKeys(r,['key','sha256','bytes'])||typeof r.key!=='string'||!HASH.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<1)fail('proof_invalid')
    if(!result.attempts.some(a=>a.source_id===s.sourceId&&a.snapshot_sha256===s.rawSha256))fail('proof_invalid')
  }
  if(result.attempts.some(a=>!result.subjects.some(s=>s.sourceId===a.source_id&&s.rawSha256===a.snapshot_sha256)||!result.jobs.some(j=>j.source_id===a.source_id&&j.snapshot_sha256===a.snapshot_sha256)))fail('proof_invalid')
  for(let i=0;i<result.requests.length;i++)if(!exactKeys(result.requests[i],['key','sha256'])||result.requests[i].key!==`request:${result.attempts[i].reservation_key}`||!HASH.test(result.requests[i].sha256))fail('proof_invalid')
  return result
}
async function readProof(env: MaintenanceEnv, sha: string) {
  if(!HASH.test(sha))fail('proof_invalid')
  const raw=await bytes(env,proofKey(sha)),text=new TextDecoder('utf-8',{fatal:true}).decode(raw)
  if(await digest(raw)!==sha)fail('proof_hash_mismatch')
  const p=parseProof(JSON.parse(text));if(canonical(p)!==text)fail('proof_invalid');return p
}
async function subject(env:MaintenanceEnv,sourceId:string,rawSha256:string,readRaw=true):Promise<Subject>{
  const s=await env.PIPELINE_DB.prepare('SELECT source_id,url FROM maintenance_sources WHERE source_id=?').bind(sourceId).first<{source_id:string;url:string}>()
  if(!s||await digest(s.url)!==sourceId)fail('source_unproven')
  const key=`maintenance/snapshots/${sourceId}/${rawSha256}.json`,snapshotRef=await ref(env,key),snapshot=await loadSnapshot(env,key)
  if(snapshot.sourceId!==sourceId||snapshot.sourceUrl!==s.url||snapshot.rawSha256!==rawSha256||!snapshot.textKey||!snapshot.textSha256||!HASH.test(snapshot.textSha256)||snapshot.rawKey!==`maintenance/snapshots/${sourceId}/${rawSha256}.bin`)fail('snapshot_unproven')
  const text=await ref(env,snapshot.textKey,2*1024*1024),textBytes=await bytes(env,text.key,2*1024*1024)
  if(text.sha256!==snapshot.textSha256)fail('text_unproven')
  const raw=readRaw?await ref(env,snapshot.rawKey,16*1024*1024):{key:snapshot.rawKey,sha256:rawSha256,bytes:1}
  if(raw.sha256!==rawSha256)fail('raw_unproven')
  const schools=(await env.PIPELINE_DB.prepare('SELECT x.university_id FROM maintenance_source_schools x JOIN maintenance_schools u ON u.university_id=x.university_id WHERE x.source_id=? AND u.scope_sha256=(SELECT scope_sha256 FROM maintenance_control WHERE singleton=1) ORDER BY x.university_id').bind(sourceId).all<{university_id:string}>()).results??[]
  if(!schools.length)fail('source_unproven')
  return{sourceId,url:s.url,rawSha256,snapshot:snapshotRef,raw,text,textAliases:[...new Set([text.sha256,await digest(normalizeEvidenceText(new TextDecoder('utf-8',{fatal:true}).decode(textBytes)))])].sort(),schoolIds:schools.map(s=>s.university_id)}
}
function sourceMatchesSql(){return `SELECT s.source_id FROM json_each(?) p JOIN maintenance_sources s ON s.source_id=json_extract(p.value,'$.sourceId') AND s.url=json_extract(p.value,'$.url') WHERE (SELECT COUNT(*) FROM maintenance_source_schools x WHERE x.source_id=s.source_id)=json_array_length(p.value,'$.schoolIds') AND NOT EXISTS(SELECT 1 FROM json_each(p.value,'$.schoolIds') chosen LEFT JOIN maintenance_source_schools x ON x.source_id=s.source_id AND x.university_id=chosen.value WHERE x.source_id IS NULL)`}
export function runtimeMatchingSql(table:'maintenance_jobs'|'maintenance_model_attempts') {
  const fields=table==='maintenance_jobs'?jobFields:attemptFields,key=table==='maintenance_jobs'?'job_id':'attempt_id'
  return `SELECT a.${key} FROM json_each(?) p JOIN ${table} a ON ${fields.map(k=>`a.${k} IS json_extract(p.value,'$.${k}')`).join(' AND ')}`
}
async function exactRows(env:MaintenanceEnv,p:Proof){
  for(const [table,rows]of [['maintenance_model_attempts',p.attempts],['maintenance_jobs',p.jobs]]as const){const found=(await env.PIPELINE_DB.prepare(runtimeMatchingSql(table)).bind(canonical(rows)).all()).results??[];if(found.length!==rows.length)fail('tuple_changed')}
}
async function exactArtifacts(env:MaintenanceEnv,p:Proof){for(const s of p.subjects)if(canonical(await subject(env,s.sourceId,s.rawSha256))!==canonical(s))fail('artifact_changed')}
async function idle(env:MaintenanceEnv,storage:DurableStorage,active:()=>number,revision:number){
  const cfg=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_control WHERE singleton=1').first<Control>()
  if(!cfg||cfg.models_enabled!==0||cfg.revision!==revision||cfg.scope_sha256!==EXISTING_SCHOOLS_V2_SHA256||env.SCOPE_REGISTRY_SHA256!==cfg.scope_sha256||env.SCOPE_SCHOOL_COUNT!=='295'||!cfg.seed_complete||!cfg.targets_complete)fail('paused_current_control_required')
  const gate=await storage.get('gate'),g=record(gate)
  if(active()!==0||g&&(!Array.isArray(g.models)||!Array.isArray(g.fetches)||Object.hasOwn(g,'offlineFence')||[...g.models,...g.fetches].some(v=>!record(v)||typeof v.expiresAt!=='number'||!Number.isFinite(v.expiresAt)||v.expiresAt<0||v.expiresAt>Date.now())))fail('admission_not_idle')
  const busy=await env.PIPELINE_DB.prepare("SELECT (SELECT COUNT(*) FROM maintenance_jobs WHERE status='running')+(SELECT COUNT(*) FROM maintenance_model_attempts WHERE status IN('reserved','send_started')) count,(SELECT COUNT(*) FROM maintenance_schools WHERE scope_sha256=?) schoolCount").bind(cfg.scope_sha256).first<{count:number;schoolCount:number}>()
  if(!busy||busy.count||busy.schoolCount!==295)fail('admission_not_idle')
  return{cfg,gateSha256:await digest(canonical(gate??null))}
}
async function verifyCommit(env:MaintenanceEnv,text:string,p:Proof,sha:string):Promise<Commit>{
  const value=record(JSON.parse(text))
  if(!value||!exactKeys(value,['format','version','operationId','proofSha256','scopeSha256','registeredRevision','operatorId','registeredAt','decision'])||value.format!=='studyinchina.runtime-model-no-replay-registration'||value.version!==1
    ||value.operationId!==p.operationId||value.proofSha256!==sha||value.scopeSha256!==p.scopeSha256||value.registeredRevision!==p.revision||!id(value.operatorId)||typeof value.registeredAt!=='string'||!Number.isFinite(Date.parse(value.registeredAt))
    ||Date.parse(value.registeredAt)<Date.parse(p.observedAt)||value.decision!=='preserve_unknown_permanent_no_replay'||canonical(value)!==text)fail('commit_invalid')
  if(new TextDecoder().decode(await bytes(env,`${PREFIX}registrations/${await digest(text)}.json`))!==text)fail('commit_artifact_invalid')
  return value as unknown as Commit
}
async function exactRequests(storage:DurableStorage,p:Proof){for(let i=0;i<p.attempts.length;i++){const a=p.attempts[i],value=await storage.get(p.requests[i].key),v=record(value);if(!v||v.state!=='unknown'||v.attemptId!==a.attempt_id||v.requestSha256!==a.request_sha256||await digest(canonical(value))!==p.requests[i].sha256)fail('durable_unknown_changed')}}
export async function prepareRuntimeModelGuards(env:MaintenanceEnv,storage:DurableStorage,value:unknown,active:()=>number){
  const v=record(value)
  if(!v||!exactKeys(v,['operationId','expectedRevision','attemptIds'])||!id(v.operationId)||!Number.isSafeInteger(v.expectedRevision)||!Array.isArray(v.attemptIds)||!v.attemptIds.length||v.attemptIds.length>8||v.attemptIds.some(a=>!id(a))||new Set(v.attemptIds).size!==v.attemptIds.length)fail('prepare_request_invalid')
  const state=await idle(env,storage,active,Number(v.expectedRevision)),index=await readIndex(env)
  for(const sha of index.index.proofs){const p=await readProof(env,sha);if(p.operationId===v.operationId){if(p.revision!==state.cfg.revision||p.scopeSha256!==state.cfg.scope_sha256||p.inputCatalogSha256!==state.cfg.input_catalog_sha256||canonical(p.attempts.map(a=>a.attempt_id).sort())!==canonical([...v.attemptIds].sort()))fail('operation_conflict');await exactRows(env,p);await exactArtifacts(env,p);await exactRequests(storage,p);await ensureRegistryMarker(env);return{ok:true,proofSha256:sha,operationId:p.operationId,permanentNoReplay:true,registered:false,modelCallsPerformed:false}}}
  const selected=(await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_model_attempts WHERE attempt_id IN(SELECT value FROM json_each(?)) ORDER BY attempt_id').bind(canonical(v.attemptIds)).all<Record<string,unknown>>()).results??[]
  if(selected.length!==v.attemptIds.length)fail('attempt_unavailable')
  const attempts=selected.map(a=>project(a,attemptFields));if(attempts.some(a=>a.status!=='unknown'||LEGACY_MODEL_NO_REPLAY_POLICY.subjects.some(s=>s.attempt.attempt_id===a.attempt_id)))fail('runtime_unknown_required')
  const subjects:Subject[]=[],jobs:Tuple[]=[]
  for(const a of attempts){if(subjects.some(s=>s.sourceId===a.source_id&&s.rawSha256===a.snapshot_sha256))continue
    const s=await subject(env,String(a.source_id),String(a.snapshot_sha256));subjects.push(s)
    const rows=(await env.PIPELINE_DB.prepare("SELECT * FROM maintenance_jobs WHERE source_id=? AND snapshot_sha256=? AND status='unknown' ORDER BY job_id LIMIT 17").bind(a.source_id,a.snapshot_sha256).all<Record<string,unknown>>()).results??[]
    if(!rows.length||rows.length>16)fail('unknown_job_unavailable')
    for(const row of rows){const j=project(row,jobFields);if(j.stage==='capture'||!['model_outcome_unknown','prior_model_outcome_requires_review','partition_original_source_outcome_unknown'].includes(String(j.error_code))||j.snapshot_key!==s.snapshot.key||TERMINAL_QUARANTINE_POLICY.jobs.some(old=>old.job.job_id===j.job_id))fail('runtime_unknown_required');jobs.push(j)}
  }
  const requests=[];for(const a of attempts){const key=`request:${a.reservation_key}`,entry=await storage.get(key),r=record(entry);if(!r||r.state!=='unknown'||r.attemptId!==a.attempt_id||r.requestSha256!==a.request_sha256)fail('durable_unknown_unproven');requests.push({key,sha256:await digest(canonical(entry))})}
  const p=parseProof({format:'studyinchina.runtime-model-no-replay-proof',version:1,operationId:v.operationId,scopeSha256:state.cfg.scope_sha256,revision:state.cfg.revision,inputCatalogSha256:state.cfg.input_catalog_sha256,observedAt:new Date().toISOString(),attempts,jobs,subjects,requests,gateSha256:state.gateSha256,unknownOutcomesChanged:false,modelCallsPerformed:false}),text=canonical(p),sha=await digest(text)
  if(new TextEncoder().encode(text).length>MAX||index.index.proofs.length>=MAX_PROOFS)fail('bounded_registry_full')
  await exactRows(env,p);await exactRequests(storage,p);const current=await idle(env,storage,active,p.revision);if(current.gateSha256!==p.gateSha256)fail('idle_changed')
  await immutable(env,proofKey(sha),text)
  const saved=await env.SNAPSHOTS_BUCKET.put(INDEX,canonical({...index.index,proofs:[...index.index.proofs,sha]}),{onlyIf:index.etag?{etagMatches:index.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  if(saved===null||!(await readIndex(env)).index.proofs.includes(sha))fail('index_cas_conflict')
  await ensureRegistryMarker(env)
  return{ok:true,operationId:p.operationId,proofSha256:sha,permanentNoReplay:true,registered:false,modelCallsPerformed:false}
}
export async function registerRuntimeModelGuards(env:MaintenanceEnv,storage:DurableStorage,value:unknown,active:()=>number){
  const v=record(value);if(!v||!exactKeys(v,['proofSha256','expectedRevision','operatorId','decision'])||!HASH.test(String(v.proofSha256))||!Number.isSafeInteger(v.expectedRevision)||!id(v.operatorId)||v.decision!=='preserve_unknown_permanent_no_replay')fail('register_request_invalid')
  const p=await readProof(env,String(v.proofSha256)),prior=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(eventId(p.operationId)).first<{kind:string;details_json:string}>()
  if(prior){const c=await verifyCommit(env,prior.details_json,p,String(v.proofSha256));if(prior.kind!==KIND||c.proofSha256!==v.proofSha256||c.operatorId!==v.operatorId||v.expectedRevision!==p.revision)fail('registration_conflict');await exactRows(env,p);await exactArtifacts(env,p);await exactRequests(storage,p);if(!(await readIndex(env)).index.proofs.includes(String(v.proofSha256)))fail('index_missing');return{ok:true,registered:true,proofSha256:v.proofSha256,reused:true,modelCallsPerformed:false}}
  const current=await idle(env,storage,active,Number(v.expectedRevision))
  if(current.cfg.scope_sha256!==p.scopeSha256||current.cfg.revision!==p.revision||current.cfg.input_catalog_sha256!==p.inputCatalogSha256||current.gateSha256!==p.gateSha256||!(await readIndex(env)).index.proofs.includes(String(v.proofSha256)))fail('registration_binding_changed')
  await exactRows(env,p);await exactArtifacts(env,p);await exactRequests(storage,p)
  const commit:Commit={format:'studyinchina.runtime-model-no-replay-registration',version:1,operationId:p.operationId,proofSha256:String(v.proofSha256),scopeSha256:p.scopeSha256,registeredRevision:p.revision,operatorId:v.operatorId,registeredAt:new Date().toISOString(),decision:'preserve_unknown_permanent_no_replay'},text=canonical(commit),guard=crypto.randomUUID()
  await immutable(env,`${PREFIX}registrations/${await digest(text)}.json`,text)
  await idle(env,storage,active,p.revision);await exactRequests(storage,p)
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND revision=? AND input_catalog_sha256=? AND models_enabled=0 AND seed_complete=1 AND targets_complete=1) AND (SELECT COUNT(*) FROM maintenance_schools WHERE scope_sha256=?)=295 AND (SELECT COUNT(*) FROM(${runtimeMatchingSql('maintenance_model_attempts')}))=? AND (SELECT COUNT(*) FROM(${runtimeMatchingSql('maintenance_jobs')}))=? AND (SELECT COUNT(*) FROM(${sourceMatchesSql()}))=? AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE status='running') AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status IN('reserved','send_started')) AND NOT EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=?) THEN 1 ELSE 0 END))`).bind(guard,p.scopeSha256,p.revision,p.inputCatalogSha256,p.scopeSha256,canonical(p.attempts),p.attempts.length,canonical(p.jobs),p.jobs.length,canonical(p.subjects),p.subjects.length,eventId(p.operationId)),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(eventId(p.operationId),KIND,commit.registeredAt,text),
    env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_events VALUES(?,?,?,?)').bind('runtime-model-guards:registry','runtime_model_guard_registry_initialized',commit.registeredAt,'{"version":1,"denyMustBePresent":true}'),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])
  return{ok:true,registered:true,proofSha256:v.proofSha256,attemptCount:p.attempts.length,jobCount:p.jobs.length,unknownOutcomesChanged:false,replayAllowed:false,modelCallsPerformed:false}
}
/** Permanent denial does not depend on scope, revision, or waiver validity. */
export async function runtimeModelNoReplayReason(env:MaintenanceEnv,input:Pick<ModelRequest,'sourceId'|'snapshotSha256'|'reservationKey'|'payload'>){
  const index=await readIndex(env);if(!index.index.proofs.length)return null
  const proofs=await Promise.all(index.index.proofs.map(sha=>readProof(env,sha))),subjects=proofs.flatMap(p=>p.subjects),attempts=proofs.flatMap(p=>p.attempts),payloadSha256=await digest(input.payload)
  if(subjects.some(s=>s.sourceId===input.sourceId||s.rawSha256===input.snapshotSha256)||attempts.some(a=>a.reservation_key===input.reservationKey||a.request_sha256===payloadSha256))return'runtime_model_replay_protected'
  const row=await env.PIPELINE_DB.prepare('SELECT raw_sha256 FROM maintenance_sources WHERE source_id=?').bind(input.sourceId).first<{raw_sha256:string|null}>()
  if(!row?.raw_sha256)return fail('incoming_text_unproven')
  const incoming=await subject(env,input.sourceId,row.raw_sha256,false)
  if(subjects.some(s=>s.textAliases.some(alias=>incoming.textAliases.includes(alias))))return'runtime_model_replay_protected'
  return null
}
export type RuntimeModelDisposition={proofs:Array<{proof:Proof;sha256:string;commit:Commit;detailsJson:string}>;attempts:Tuple[];jobs:Tuple[];state:'absent'|'verified'|'invalid'|'scope_mismatch'}
export async function readRuntimeModelDisposition(env:MaintenanceEnv,cfg:Control):Promise<RuntimeModelDisposition>{
  const result:RuntimeModelDisposition={proofs:[],attempts:[],jobs:[],state:'absent'},index=await readIndex(env)
  try{for(const sha of index.index.proofs){const p=await readProof(env,sha),row=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(eventId(p.operationId)).first<{kind:string;details_json:string}>();if(!row)continue
    const c=await verifyCommit(env,row.details_json,p,sha)
    if(row.kind!==KIND||c.format!=='studyinchina.runtime-model-no-replay-registration'||c.version!==1||c.proofSha256!==sha||c.operationId!==p.operationId||c.scopeSha256!==p.scopeSha256||c.registeredRevision!==p.revision||c.decision!=='preserve_unknown_permanent_no_replay'||canonical(c)!==row.details_json)fail('commit_invalid')
    if(p.scopeSha256!==cfg.scope_sha256){result.state='scope_mismatch';continue}
    if(cfg.revision<p.revision)fail('control_history_invalid')
    await exactRows(env,p);await exactArtifacts(env,p)
    result.proofs.push({proof:p,sha256:sha,commit:c,detailsJson:row.details_json})
    for(const a of p.attempts)if(!result.attempts.some(v=>v.attempt_id===a.attempt_id))result.attempts.push(a)
    for(const j of p.jobs)if(!result.jobs.some(v=>v.job_id===j.job_id))result.jobs.push(j)
  }if(result.proofs.length)result.state='verified';return result}catch(error){if(!(error instanceof MaintenanceError))throw error;return{proofs:[],attempts:[],jobs:[],state:'invalid'}}
}
export function runtimeDispositionFence(value:RuntimeModelDisposition){
  const clauses:string[]=[],bindings:unknown[]=[]
  for(const p of value.proofs){clauses.push(`EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=? AND kind=? AND details_json=?)`);bindings.push(eventId(p.proof.operationId),KIND,p.detailsJson);clauses.push(`(SELECT COUNT(*) FROM(${sourceMatchesSql()}))=?`);bindings.push(canonical(p.proof.subjects),p.proof.subjects.length)}
  for(const [table,rows]of [['maintenance_model_attempts',value.attempts],['maintenance_jobs',value.jobs]]as const){clauses.push(`(SELECT COUNT(*) FROM(${runtimeMatchingSql(table)}))=?`);bindings.push(canonical(rows),rows.length)}
  return{sql:clauses.join(' AND '),bindings,attempts:{sql:runtimeMatchingSql('maintenance_model_attempts'),bindings:[canonical(value.attempts)]},jobs:{sql:runtimeMatchingSql('maintenance_jobs'),bindings:[canonical(value.jobs)]}}
}

/** Compose disjoint reviewed sets by identity, retaining every unregistered unknown. */
export async function runtimeUnknownSummary(env:MaintenanceEnv,value:RuntimeModelDisposition,leaseRegistered:boolean,legacyRegistered:boolean){
  const attempts=(await env.PIPELINE_DB.prepare("SELECT attempt_id FROM maintenance_model_attempts WHERE status='unknown'").all<{attempt_id:string}>()).results??[]
  const jobs=(await env.PIPELINE_DB.prepare("SELECT job_id FROM maintenance_jobs WHERE status='unknown'").all<{job_id:string}>()).results??[]
  const legacyIds=new Set(legacyRegistered?LEGACY_MODEL_NO_REPLAY_POLICY.subjects.map(s=>s.attempt.attempt_id):[]),leaseIds=new Set(leaseRegistered?TERMINAL_QUARANTINE_POLICY.jobs.map(s=>s.job.job_id):[])
  const runtimeAttempts=new Set(value.attempts.map(a=>String(a.attempt_id))),runtimeJobs=new Set(value.jobs.map(j=>String(j.job_id)))
  return{state:value.state,totalUnknownModels:attempts.length,legacyProtectedModels:attempts.filter(a=>legacyIds.has(a.attempt_id)).length,runtimeProtectedModels:attempts.filter(a=>runtimeAttempts.has(a.attempt_id)).length,
    unresolvedModels:attempts.filter(a=>!legacyIds.has(a.attempt_id)&&!runtimeAttempts.has(a.attempt_id)).length,totalUnknownJobs:jobs.length,leaseQuarantinedJobs:jobs.filter(j=>leaseIds.has(j.job_id)).length,
    runtimeProtectedJobs:jobs.filter(j=>runtimeJobs.has(j.job_id)).length,unresolvedJobs:jobs.filter(j=>!leaseIds.has(j.job_id)&&!runtimeJobs.has(j.job_id)).length,
    unknownOutcomesChanged:false,replayAllowed:false,modelSuccessesClaimed:false}
}
