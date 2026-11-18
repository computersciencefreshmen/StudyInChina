import type { Control,MaintenanceEnv,JobRow,SourceRow,ModelRequest } from './types'
import { MaintenanceError } from './types'
import type { RefillKind,RefillFence,RefillCandidate,RefillDispatchResult,RefillJobState } from './refill-contract'
import { control,source,sourceSchools,recordTargets,readSchoolRotation,saveSchoolRotation,schedulingMetadata,schedulingSchoolsSql,schedulingSchoolIdsSql } from './repository'
import { readSchedulingCoverage } from './public-coverage'
import { selectScheduledJobs } from './scheduling'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { readBackgroundBudgetGate } from '../../shared/background-budget'
import { runtimeModelNoReplayReason } from './runtime-model-guards'
import { legacyModelNoReplayReason,LEGACY_MODEL_NO_REPLAY_POLICY } from './legacy-model-guards'
import { noReplayReason,TERMINAL_QUARANTINE_POLICY } from './reviewed-terminal-quarantine'
import { loadSnapshot } from './capture'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import { maintenanceRecordTargetSchema } from '../../../scripts/maintenance/field-contracts'
import { canonical,digest,HASH,ID,nowIso,record } from './util'
import { sqlAnd } from './sql-and'
import { refillProofBudget,refillScanHint,proofDeadline } from './refill-proof-budget'
export type { RefillKind,RefillFence,RefillCandidate,RefillDispatchResult } from './refill-contract'
export {planDueCaptureJobs} from './repository'

// Metadata only: each of three lanes keeps its full 32-row cursor page plus
// up to eight urgent heads. Proof execution remains capped at two/eight tries.
const PREFIX='maintenance/refill-dispatch/',MAX_PROOF=128*1024,POOL=3*(32+8)
const jobFields=['job_id','source_id','stage','status','priority','due_at','created_at','updated_at','attempt','lease_token','lease_until','snapshot_sha256','snapshot_key','error_code','enqueued_at','target_ids_json']as const
const sourceFields=['source_id','url','allowed_hosts_json','category','categories_json','enabled','interval_hours','due_at','last_attempt_at','last_success_at','raw_sha256','canonical_sha256','snapshot_key','etag','failures','error_code','discovery_depth']as const
type Tuple=Record<string,string|number|null>
type Fairness={revision:number;slot_offset:number;expansion_offset:number}
export type RefillDispatchFence=RefillFence&{format:'studyinchina.refill-dispatch-fence';version:1;kind:RefillKind;seedSha256:string;legacyGuardSha256:string;modelsEnabled:number;targetsComplete:number;selectedAt:string;expiresAt:string;fairness:Fairness}
type Artifact={key:string;sha256:string;byteLength:number}
type Target={target_id:string;record_scope_sha256:string;target_json:string;university_id:string}
type Proof={format:'studyinchina.refill-candidate-proof';version:1;kind:RefillKind;fence:RefillDispatchFence;job:Tuple;source:Tuple;schoolIds:string[];targets:Target[];directBindings:string[];artifacts:Artifact[];derivative:Tuple|null}
export type DispatchCandidate=RefillCandidate&{kind:RefillKind;dueAt:string;leaseUntil:string|null;snapshotSha256:string|null;snapshotKey:string|null;proofKey:string;proofSha256:string;proofBytes:number;schedulingSchoolId:string;maintenanceLane:boolean;awardLane:boolean}
type Ledger={dispatch_token:string;job_id:string;epoch_sha256:string;kind:RefillKind;stage:JobRow['stage'];scope_sha256:string;input_catalog_sha256:string;control_revision:number;candidate_json:string;candidate_sha256:string;job_json:string;fence_json:string;status:'prepared'|'sent'|'unconfirmed'|'observed'|'not_sent';claimed_at:string;sent_at:string|null;resolution:'job_progress'|'received_not_started'|null}
const fail=(suffix:string):never=>{throw new MaintenanceError(`refill_dispatch_${suffix}`)}
const tuple=(row:Record<string,unknown>,fields:readonly string[]):Tuple=>Object.fromEntries(fields.map(k=>[k,row[k]===undefined?null:row[k]]))as Tuple
const kindOf=(stage:string):RefillKind=>stage==='capture'?'capture':'model'
const award=(category:string)=>/^(?:scholarships|university_scholarship|faculty_scholarship|government_scholarship)$/.test(category)
function fenceFor(cfg:Control,kind:RefillKind,fairness:Fairness,now:number):RefillDispatchFence{return{format:'studyinchina.refill-dispatch-fence',version:1,kind,scopeSha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,revision:cfg.revision,canaryJson:cfg.canary_json,seedSha256:cfg.seed_sha256,legacyGuardSha256:cfg.legacy_guard_sha256,modelsEnabled:cfg.models_enabled,targetsComplete:cfg.targets_complete,selectedAt:nowIso(now),expiresAt:nowIso(now+120000),fairness}}
function sameFence(cfg:Control|null,f:RefillDispatchFence,now:number){return Boolean(cfg&&cfg.enabled&&cfg.seed_complete&&cfg.targets_complete&&cfg.scope_sha256===f.scopeSha256&&cfg.input_catalog_sha256===f.inputCatalogSha256&&cfg.revision===f.revision&&cfg.canary_json===f.canaryJson&&cfg.seed_sha256===f.seedSha256&&cfg.legacy_guard_sha256===f.legacyGuardSha256&&cfg.models_enabled===f.modelsEnabled&&(f.kind==='capture'||cfg.models_enabled)&&Date.parse(f.selectedAt)<=now&&now<=Date.parse(f.expiresAt))}
async function open(env:MaintenanceEnv,now:number){return env.MODEL_STATE_MIGRATION_ROLE!=='source'&&env.MAINTENANCE_ENABLED==='true'&&(await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,now)).allowed&&(await nativeReconciliationGate(env)).ready}
async function bytes(env:MaintenanceEnv,key:string,max:number){if(!/^maintenance\/[A-Za-z0-9_./-]+$/.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'))return fail('artifact_key_invalid');const object=await env.SNAPSHOTS_BUCKET.get(key);if(!object||object.size!==undefined&&object.size>max)return fail('artifact_unavailable');const body=new Uint8Array(await object.arrayBuffer());if(body.length>max)return fail('artifact_oversized');return body}
async function artifact(env:MaintenanceEnv,key:string,max:number):Promise<Artifact>{const body=await bytes(env,key,max);return{key,sha256:await digest(body),byteLength:body.length}}
async function storeProof(env:MaintenanceEnv,proof:Proof){
  const text=canonical(proof),body=new TextEncoder().encode(text);if(body.length>MAX_PROOF)return fail('candidate_proof_oversized');const sha256=await digest(body),key=`${PREFIX}candidates/${sha256}.json`;await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(await digest(await bytes(env,key,MAX_PROOF))!==sha256)return fail('candidate_proof_unconfirmed');return{proofKey:key,proofSha256:sha256,proofBytes:body.length}}
async function loadProof(env:MaintenanceEnv,c:RefillCandidate):Promise<Proof>{if(!HASH.test(String(c.proofSha256))||c.proofKey!==`${PREFIX}candidates/${c.proofSha256}.json`)return fail('candidate_reference_invalid');const body=await bytes(env,String(c.proofKey),MAX_PROOF);if(body.length!==c.proofBytes||await digest(body)!==c.proofSha256)return fail('candidate_proof_corrupt');const proof=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))as Proof;if(proof.format!=='studyinchina.refill-candidate-proof'||proof.version!==1||canonical(proof)!==new TextDecoder().decode(body)||proof.job.job_id!==c.jobId||proof.job.source_id!==c.sourceId||proof.job.stage!==c.stage||proof.job.status!==c.status||proof.job.attempt!==c.attempt||proof.job.updated_at!==c.updatedAt||proof.job.enqueued_at!==c.enqueuedAt||proof.job.lease_token!==c.leaseToken)return fail('candidate_binding_invalid');return proof}
async function stopped(env:MaintenanceEnv,job:Tuple,row:SourceRow,schools:string[],targets:Target[]){
  // A new read-only HTTP acquisition must remain possible for a source whose
  // old model outcome is unknown. Every subsequent model stage keeps its deny.
  if(job.stage==='capture')return false
  const raw=String(job.snapshot_sha256??row.raw_sha256??'0'.repeat(64))
  if(TERMINAL_QUARANTINE_POLICY.jobs.some(p=>p.job.source_id===row.source_id||p.job.snapshot_sha256===raw)||LEGACY_MODEL_NO_REPLAY_POLICY.subjects.some(p=>p.source.source_id===row.source_id||p.attempt.snapshot_sha256===raw))return true
  const guarded=await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_legacy_guards WHERE (university_id IS NULL OR university_id IN(SELECT value FROM json_each(?))) AND (snapshot_sha256 IS NULL OR snapshot_sha256=?) AND (source_id=? OR(source_id IS NULL AND(record_id IS NULL OR record_id IN(SELECT value FROM json_each(?))))) LIMIT 1").bind(JSON.stringify(schools),raw,row.source_id,JSON.stringify(targets.map(t=>JSON.parse(t.target_json).recordId))).first()
  if(guarded)return true
  const request:ModelRequest={sourceId:row.source_id,snapshotSha256:raw,reservationKey:String(job.job_id),payload:'',pass:'primary',lane:job.stage==='maintain'?'maintenance':'expansion',universityIds:schools}
  try{if(await runtimeModelNoReplayReason(env,request))return true}catch(error){if(!(job.stage==='capture'&&!row.raw_sha256&&error instanceof MaintenanceError&&error.code==='runtime_model_guard_incoming_text_unproven'))throw error}
  if(job.stage==='capture'&&!row.raw_sha256)return false
  return Boolean(await legacyModelNoReplayReason(env,request,row)||await noReplayReason(env,request,row))
}
async function prove(env:MaintenanceEnv,fence:RefillDispatchFence,job:Tuple):Promise<Proof|null>{
  if(!['queued','retry'].includes(String(job.status))||job.lease_token!==null||job.lease_until!==null||kindOf(String(job.stage))!==fence.kind)return null
  const row=await source(env,String(job.source_id));if(!row?.enabled||await digest(row.url)!==row.source_id)return null
  try{assertSafeSourceUrl(row.url,JSON.parse(row.allowed_hosts_json)as string[])}catch{return null}
  const schools=(await sourceSchools(env,row.source_id)).map(s=>s.university_id),canary=JSON.parse(fence.canaryJson)as string[]
  if(!schools.length||canary.length&&!schools.some(s=>canary.includes(s)))return null
  if(fence.kind==='model'){const uncertain=await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_model_attempts WHERE source_id=? AND status IN('unknown','reserved','send_started') UNION ALL SELECT 1 FROM maintenance_jobs WHERE source_id=? AND status='unknown' LIMIT 1").bind(row.source_id,row.source_id).first();if(uncertain)return null}
  const artifacts:Artifact[]=[],targets:Target[]=[],directBindings:string[]=[];let derivative:Tuple|null=null
  if(fence.kind==='model'){
    if(!HASH.test(String(job.snapshot_sha256))||job.snapshot_sha256!==row.raw_sha256||job.snapshot_key!==row.snapshot_key)return null
    const snapshot=await loadSnapshot(env,String(job.snapshot_key))
    if(snapshot.version!==1||snapshot.sourceId!==row.source_id||snapshot.sourceUrl!==row.url||snapshot.rawSha256!==row.raw_sha256||snapshot.rawKey!==`maintenance/snapshots/${row.source_id}/${row.raw_sha256}.bin`||!snapshot.textKey||!HASH.test(String(snapshot.textSha256)))return null
    try{assertSafeSourceUrl(snapshot.finalUrl,JSON.parse(row.allowed_hosts_json)as string[])}catch{return null}
    artifacts.push(await artifact(env,String(job.snapshot_key),2*1024*1024),await artifact(env,snapshot.rawKey,10*1024*1024),await artifact(env,snapshot.textKey,2*1024*1024))
    if(artifacts[1].sha256!==row.raw_sha256||artifacts[2].sha256!==snapshot.textSha256)return null
    const derived=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?').bind(row.source_id,row.raw_sha256).first<Tuple>();derivative=derived?{...derived}:null
    if(job.stage==='maintain'){
      if(typeof job.target_ids_json!=='string')return null
      const body=JSON.parse(job.target_ids_json),pins=Array.isArray(body)?body:record(body)?.targets
      if(!Array.isArray(pins)||!pins.length||pins.length>80||pins.some(p=>!p||typeof p.id!=='string'||!HASH.test(String(p.sha256)))||new Set(pins.map(p=>p.id)).size!==pins.length)return null
      // The common direct-source case reads only the job's pinned PKs, not a
      // whole catalogue for this source. Inherited pins retain the existing
      // bounded immutable-frontier graph verification as a fallback.
      const direct=(await env.PIPELINE_DB.prepare('SELECT t.target_id,t.record_scope_sha256,t.target_json,t.university_id FROM maintenance_record_targets t JOIN maintenance_target_sources x ON x.target_id=t.target_id AND x.source_id=? WHERE t.active=1 AND t.target_id IN(SELECT value FROM json_each(?))').bind(row.source_id,canonical(pins.map(p=>p.id))).all<Target>()).results??[]
      const available=direct.length===pins.length?null:await recordTargets(env,row.source_id)
      for(const pin of pins){const current=direct.find(t=>t.target_id===pin.id)??await env.PIPELINE_DB.prepare('SELECT target_id,record_scope_sha256,target_json,university_id FROM maintenance_record_targets WHERE target_id=? AND active=1').bind(pin.id).first<Target>();if(!current||current.record_scope_sha256!==pin.sha256||!schools.includes(current.university_id)||canary.length&&!canary.includes(current.university_id))return null;const checked=maintenanceRecordTargetSchema.safeParse(JSON.parse(current.target_json));if(!checked.success)return null;const parsed=checked.data;if(parsed.recordScopeSha256!==pin.sha256||`${parsed.entityType}:${parsed.recordId}`!==pin.id||parsed.universityId!==current.university_id)return null;if(direct.some(t=>t.target_id===pin.id)){if(!parsed.sourceIds.includes(row.source_id))return null;directBindings.push(pin.id)}else{const target=available?.find(t=>`${t.entityType}:${t.recordId}`===pin.id&&t.recordScopeSha256===pin.sha256);if(!target||canonical(parsed)!==canonical(target))return null}targets.push({...current})}
    }
  }
  if(await stopped(env,job,row,schools,targets))return null
  return{format:'studyinchina.refill-candidate-proof',version:1,kind:fence.kind,fence,job,source:tuple(row as unknown as Record<string,unknown>,sourceFields),schoolIds:schools,targets,directBindings,artifacts,derivative}
}
async function context(env:MaintenanceEnv,cfg:Control,now:number){
  const rows=(await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools WHERE scope_sha256=? LIMIT 296').bind(cfg.scope_sha256).all<{university_id:string}>()).results??[],ids=new Set(rows.map(r=>r.university_id))
  const supplied=await readSchedulingCoverage(env,cfg.input_catalog_sha256,cfg.scope_sha256,now),coverage=supplied&&[272,295].includes(ids.size)&&supplied.schools.length===ids.size&&new Set(supplied.schools.map(s=>s.universityId)).size===ids.size&&supplied.schools.every(s=>ids.has(s.universityId))?supplied:null
  const rotation=await readSchoolRotation(env,cfg.scope_sha256,ids,now),metadata=schedulingMetadata(coverage,rotation,now)
  return{ids,coverage,rotation,metadata,firstRoundComplete:Boolean(coverage?.schools.every(s=>s.currentProgramCount>=5))}
}
type SelectionOptions={kind:RefillKind;limit:number;excludeJobIds:string[];now?:number;allowExpansion?:boolean}
export async function selectRefillCandidates(env:MaintenanceEnv,options:SelectionOptions){
  const budget=refillProofBudget(env),progress={fence:null as RefillDispatchFence|null,candidates:[]as DispatchCandidate[]}
  try{return{...await budget.timed(()=>selectWithinBudget(budget.env,options,budget,progress)),selection:budget.diagnostics()}}
  catch(error){if(!proofDeadline(error))throw error;return{...progress,nextDueAt:null,scanRetryAt:new Date((options.now??Date.now())+10000).toISOString(),selection:budget.diagnostics()}}
}
async function selectWithinBudget(env:MaintenanceEnv,options:SelectionOptions,budget:ReturnType<typeof refillProofBudget>,progress:{fence:RefillDispatchFence|null;candidates:DispatchCandidate[]}):Promise<{fence:RefillDispatchFence|null;candidates:DispatchCandidate[];nextDueAt:string|null;scanRetryAt?:string|null}>{
  const now=options.now??Date.now();if(!['model','capture'].includes(options.kind)||!Number.isInteger(options.limit)||options.limit<1||options.limit>8||options.excludeJobIds.length>512||options.excludeJobIds.some(id=>!ID.test(id)))return fail('selection_options_invalid')
  if(!(await open(env,now)))return{fence:null,candidates:[],nextDueAt:null}
  const cfg=await control(env);if(!cfg?.enabled||!cfg.seed_complete||!cfg.targets_complete||options.kind==='model'&&!cfg.models_enabled)return{fence:null,candidates:[],nextDueAt:null}
  const fair={...await env.PIPELINE_DB.prepare('SELECT revision,slot_offset,expansion_offset FROM maintenance_refill_fairness WHERE scope_sha256=? AND kind=?').bind(cfg.scope_sha256,options.kind).first<Fairness>()??{revision:0,slot_offset:0,expansion_offset:0}}
  const fence=fenceFor(cfg,options.kind,fair,now),ctx=await context(env,cfg,now),excluded=JSON.stringify(options.excludeJobIds),kind=options.kind==='capture'?"j.stage='capture'":options.allowExpansion===false?"j.stage='maintain'":"j.stage IN('extract','award','maintain')"
  progress.fence=fence
  const scan=await refillScanHint(env,{scopeSha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,revision:cfg.revision,canaryJson:cfg.canary_json,seedSha256:cfg.seed_sha256,legacyGuardSha256:cfg.legacy_guard_sha256,kind:options.kind,allowExpansion:options.allowExpansion!==false},now)
  const eligibility=`${kind} AND j.status IN('queued','retry') AND j.lease_token IS NULL AND j.lease_until IS NULL
    AND j.job_id NOT IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM maintenance_refill_dispatches d WHERE d.job_id=j.job_id AND d.status IN('prepared','sent','unconfirmed'))
    AND s.enabled=1 AND (j.stage='capture' OR(j.snapshot_sha256=s.raw_sha256 AND j.snapshot_key=s.snapshot_key))
    AND (j.stage='capture' OR(NOT EXISTS(SELECT 1 FROM maintenance_model_attempts a WHERE a.source_id=s.source_id AND a.status IN('unknown','reserved','send_started'))
    AND NOT EXISTS(SELECT 1 FROM maintenance_jobs u WHERE u.source_id=s.source_id AND u.status='unknown')))`
  const rows=(await env.PIPELINE_DB.prepare(`WITH ${schedulingSchoolsSql},scan_offsets AS MATERIALIZED(SELECT ? value),associations AS MATERIALIZED(
    SELECT j.*,s.category source_category,s.last_success_at source_last_success_at,p.university_id scheduling_school_id,p.school_last_attempt_at,p.school_last_dispatched_tick,p.coverage_band,p.review_urgent,
      CASE WHEN j.stage='maintain' OR(j.stage='capture' AND s.last_success_at IS NOT NULL) THEN 1 ELSE 0 END maintenance_lane,
      CASE WHEN j.stage='award' OR s.category IN('scholarships','university_scholarship','faculty_scholarship','government_scholarship') THEN 1 ELSE 0 END award_lane
    FROM maintenance_jobs j CROSS JOIN maintenance_sources s CROSS JOIN maintenance_source_schools x CROSS JOIN school_priority p
    WHERE s.source_id=j.source_id AND x.source_id=j.source_id AND p.university_id=x.university_id AND ${eligibility} AND j.due_at<=? AND (j.enqueued_at IS NULL OR j.enqueued_at<?)
  ),anchored AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY job_id ORDER BY review_urgent DESC,coverage_band,school_last_dispatched_tick,scheduling_school_id) anchor_order FROM associations),school_ranked AS(
    SELECT *,ROW_NUMBER() OVER(PARTITION BY maintenance_lane,CASE WHEN maintenance_lane=0 THEN award_lane ELSE 0 END,scheduling_school_id ORDER BY priority,due_at,job_id) school_order FROM anchored WHERE anchor_order=1
  ),ranked AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY maintenance_lane,CASE WHEN maintenance_lane=0 THEN award_lane ELSE 0 END ORDER BY CASE WHEN priority<=0 OR review_urgent=1 THEN 0 ELSE 1 END,coverage_band,school_order,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),priority,due_at,job_id) lane_order FROM school_ranked
  ),windowed AS(SELECT ranked.*,CASE WHEN lane_order>json_extract(scan.value,CASE WHEN maintenance_lane=1 THEN '$.maintenance' WHEN award_lane=1 THEN '$.award' ELSE '$.programme' END) AND lane_order<=32+json_extract(scan.value,CASE WHEN maintenance_lane=1 THEN '$.maintenance' WHEN award_lane=1 THEN '$.award' ELSE '$.programme' END) THEN 1 ELSE 0 END scan_page FROM ranked CROSS JOIN scan_offsets scan
  ),paged AS(SELECT windowed.*,SUM(scan_page) OVER(PARTITION BY maintenance_lane,CASE WHEN maintenance_lane=0 THEN award_lane ELSE 0 END) scan_page_total FROM windowed
  ),chosen AS MATERIALIZED(SELECT paged.* FROM paged WHERE scan_page=1 OR((priority<=0 OR review_urgent=1) AND lane_order<=8) ORDER BY CASE WHEN priority<=0 OR review_urgent=1 THEN 0 ELSE 1 END,coverage_band,school_order,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),priority,due_at,job_id LIMIT ${POOL})
  SELECT chosen.*,${schedulingSchoolIdsSql} school_ids_json FROM chosen`).bind(ctx.metadata,cfg.canary_json,canonical(scan.offsets),excluded,nowIso(now),nowIso(now-900000)).all<Record<string,unknown>>()).results??[]
  const prepared=await Promise.all(rows.map(async row=>({row,stamp:await scan.fingerprint(tuple(row,jobFields)),lane:Number(row.maintenance_lane)?'maintenance'as const:Number(row.award_lane)?'award'as const:'programme'as const,stage:String(row.stage),priority:Number(row.priority),source_last_success_at:row.source_last_success_at as string|null,source_category:award(String(row.source_category))?'scholarships':String(row.source_category),coverage_count:row.coverage_band===0?0:row.coverage_band===1?1:row.coverage_band===2?2:5,scheduling_school_id:String(row.scheduling_school_id),school_last_dispatched_tick:Number(row.school_last_dispatched_tick),school_last_attempt_at:row.school_last_attempt_at as string|null,review_after:row.review_urgent?new Date(now+8*3600000).toISOString().slice(0,10):null})))
  let available=prepared.filter(p=>!scan.seen(String(p.row.job_id),p.stamp))
  const scheduling={limit:options.limit,firstRoundComplete:ctx.firstRoundComplete,now,slotOffset:fair.slot_offset,expansionOffset:fair.expansion_offset}
  let planned=selectScheduledJobs(available,scheduling)
  const triedLanes=new Set<string>(),candidates=progress.candidates
  const order=new Map<typeof available[number],number>(),completed=new Map<number,DispatchCandidate>();let nextOrder=0
  const rememberPlan=()=>{for(const value of planned)if(!order.has(value))order.set(value,nextOrder++)}
  const urgency=(value:typeof available[number])=>value.priority<=0?2:value.review_after?1:0
  rememberPlan()
  while(candidates.length<options.limit&&available.length&&budget.counts.attempts<8){
    if(!planned.length){const untried=available.filter(p=>!triedLanes.has(p.lane));planned=selectScheduledJobs(untried.length?untried:available,{...scheduling,limit:options.limit-candidates.length});rememberPlan()}
    const batch:typeof available=[]
    while(batch.length<Math.min(2,options.limit-candidates.length)&&planned.length&&budget.counts.attempts<8){
      let index=0
      if(batch.length){const first=batch[0],otherLane=planned.findIndex(value=>urgency(value)===urgency(first)&&value.lane!==first.lane);index=otherLane>=0?otherLane:planned.findIndex(value=>urgency(value)===urgency(first));if(index<0)break}
      const [value]=planned.splice(index,1)
      available=available.filter(p=>p!==value);triedLanes.add(value.lane)
      if(!budget.attempt())break
      // Hint CAS writes remain sequential, before either proof starts. A slow
      // maintenance graph cannot occupy both slots when its reserve includes
      // another lane of the same urgency. This changes no reserve membership.
      await scan.visit(String(value.row.job_id),value.stamp,value.lane);batch.push(value)
    }
    if(!batch.length)break
    const results=await Promise.allSettled(batch.map(async value=>{
      const proof=await prove(env,fence,tuple(value.row,jobFields))
      if(proof){const j=proof.job,stored=await storeProof(env,proof);budget.check();completed.set(order.get(value)!,{jobId:String(j.job_id),sourceId:String(j.source_id),stage:j.stage as JobRow['stage'],status:j.status as 'queued'|'retry',attempt:Number(j.attempt),updatedAt:String(j.updated_at),enqueuedAt:j.enqueued_at as string|null,leaseToken:j.lease_token as string|null,leaseUntil:j.lease_until as string|null,snapshotSha256:j.snapshot_sha256 as string|null,snapshotKey:j.snapshot_key as string|null,dueAt:String(j.due_at),kind:options.kind,schedulingSchoolId:value.scheduling_school_id,maintenanceLane:Boolean(value.row.maintenance_lane),awardLane:Boolean(value.row.award_lane),...stored});candidates.splice(0,candidates.length,...[...completed].sort((a,b)=>a[0]-b[0]).map(([,candidate])=>candidate))}
    }))
    // A backend failure must not remove the shared deadline while its sibling
    // proof is still reading. Drain the bounded pair or let that deadline win.
    for(const result of results)if(result.status==='rejected')throw result.reason
  }
  // The urgent prefix is a separate reservoir, not part of the cursor page.
  // A POOL truncation must not reset or advance a partially returned page.
  for(const lane of ['maintenance','programme','award']as const){const page=prepared.filter(p=>p.lane===lane&&Number(p.row.scan_page)===1),expected=Number(prepared.find(p=>p.lane===lane)?.row.scan_page_total??0);if(page.length===expected)await scan.page(lane,page.map(p=>({id:String(p.row.job_id),stamp:p.stamp})),32)}
  let nextDueAt:string|null=null
  if(!candidates.length&&budget.counts.attempts<8){const future=(await env.PIPELINE_DB.prepare(`SELECT j.* FROM maintenance_jobs j JOIN maintenance_sources s ON s.source_id=j.source_id WHERE ${eligibility} AND j.due_at>? AND EXISTS(SELECT 1 FROM maintenance_source_schools x JOIN maintenance_schools u ON u.university_id=x.university_id WHERE x.source_id=j.source_id AND u.scope_sha256=? AND (json_array_length(?)=0 OR x.university_id IN(SELECT value FROM json_each(?)))) ORDER BY j.due_at,j.job_id LIMIT 8 OFFSET ?`).bind(excluded,nowIso(now),cfg.scope_sha256,cfg.canary_json,cfg.canary_json,scan.offsets.future).all<Record<string,unknown>>()).results??[];const page=await Promise.all(future.map(async row=>({row,id:String(row.job_id),stamp:await scan.fingerprint(tuple(row,jobFields))})));for(const value of page){if(scan.seen(value.id,value.stamp))continue;if(!budget.attempt())break;await scan.visit(value.id,value.stamp,'future');if(await prove(env,fence,tuple(value.row,jobFields))){await scan.forget(value.id);nextDueAt=String(value.row.due_at);break}}await scan.page('future',page,8)}
  return{fence,candidates,nextDueAt,scanRetryAt:available.length||budget.counts.attempts===8||Object.values(scan.offsets).some(Boolean)?new Date(now+10000).toISOString():null}
}

const matches=(alias:string,jsonAlias:string,fields:readonly string[])=>sqlAnd(fields.map(field=>`${alias}.${field} IS json_extract(${jsonAlias},'$.${field}')`))
export async function dispatchRefillCandidates(env:MaintenanceEnv,inputFence:RefillFence,inputCandidates:RefillCandidate[],options:{dispatchToken:string;epochSha256:string;now?:number}):Promise<RefillDispatchResult>{
  const now=options.now??Date.now(),fence=inputFence as RefillDispatchFence,candidates=inputCandidates as DispatchCandidate[],result:RefillDispatchResult={sent:[],notSent:[],unconfirmed:[]}
  if(!/^[A-Za-z0-9_-]{8,160}$/.test(options.dispatchToken)||!HASH.test(options.epochSha256)||!candidates.length||candidates.length>8||new Set(candidates.map(c=>c.jobId)).size!==candidates.length)return fail('dispatch_options_invalid')
  if(fence.format!=='studyinchina.refill-dispatch-fence'||fence.version!==1)return fail('fence_invalid')
  const deny=(reason:string)=>{result.notSent.push(...candidates.map(c=>({jobId:c.jobId,reason})));return result}
  if(env.MODEL_STATE_MIGRATION_ROLE==='source')return deny('source_frozen')
  const prior=await readRefillDispatchStatus(env,options.dispatchToken)
  if(prior.entries.length){if(prior.entries.length!==candidates.length)return fail('dispatch_token_conflict');for(const c of candidates){const row=prior.entries.find(r=>r.jobId===c.jobId);if(!row||row.epochSha256!==options.epochSha256||row.fenceSha256!==await digest(canonical(fence))||row.candidateSha256!==await digest(canonical(c)))return fail('dispatch_token_conflict');if(row.status==='not_sent')result.notSent.push({jobId:c.jobId,reason:'previously_not_sent'});else if(row.status==='sent'||row.status==='observed')result.sent.push(c.jobId);else result.unconfirmed.push(c.jobId)}return result}
  if(!(await open(env,now))||!sameFence(await control(env),fence,now))return deny('control_or_budget_changed')
  const proofs:Proof[]=[]
  for(const c of candidates){const proof=await loadProof(env,c);if(canonical(proof.fence)!==canonical(fence)||c.kind!==fence.kind||kindOf(c.stage)!==fence.kind)return fail('fence_candidate_mismatch');const fresh=await prove(env,fence,proof.job);if(!fresh||canonical(fresh)!==canonical(proof))return deny('candidate_evidence_changed');proofs.push(proof)}
  if(!(await open(env,now)))return deny('budget_changed')
  const guards=[crypto.randomUUID(),...proofs.map(()=>crypto.randomUUID())],at=nowIso(now),token=options.dispatchToken,scope=fence.scopeSha256,candidateHashes=await Promise.all(candidates.map(c=>digest(canonical(c))))
  try{await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND enabled=1 AND seed_complete=1 AND targets_complete=1 AND scope_sha256=? AND input_catalog_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND revision=? AND canary_json=? AND models_enabled=?) AND COALESCE((SELECT revision FROM maintenance_refill_fairness WHERE scope_sha256=? AND kind=?),0)=? THEN 1 ELSE 0 END))").bind(guards[0],scope,fence.inputCatalogSha256,fence.seedSha256,fence.legacyGuardSha256,fence.revision,fence.canaryJson,fence.modelsEnabled,scope,fence.kind,fence.fairness.revision),
    ...proofs.map((p,index)=>env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_jobs j CROSS JOIN(SELECT ? value) expected WHERE ${matches('j','expected.value',jobFields)} AND j.status IN('queued','retry') AND j.lease_token IS NULL AND j.lease_until IS NULL AND j.due_at<=?)
      AND EXISTS(SELECT 1 FROM maintenance_sources s CROSS JOIN(SELECT ? value) expected WHERE ${matches('s','expected.value',sourceFields)} AND s.enabled=1)
      AND (SELECT COUNT(*) FROM maintenance_source_schools x JOIN maintenance_schools u ON u.university_id=x.university_id WHERE x.source_id=? AND u.scope_sha256=?)=json_array_length(?)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) chosen LEFT JOIN maintenance_source_schools x ON x.source_id=? AND x.university_id=chosen.value WHERE x.source_id IS NULL)
      AND (?='capture' OR(NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE source_id=? AND status IN('unknown','reserved','send_started')) AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE source_id=? AND status='unknown')))
      AND NOT EXISTS(SELECT 1 FROM maintenance_refill_dispatches WHERE job_id=? AND status IN('prepared','sent','unconfirmed'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) pin LEFT JOIN maintenance_record_targets t ON t.target_id=json_extract(pin.value,'$.target_id') WHERE t.target_id IS NULL OR t.active<>1 OR t.record_scope_sha256<>json_extract(pin.value,'$.record_scope_sha256') OR t.target_json<>json_extract(pin.value,'$.target_json') OR t.university_id<>json_extract(pin.value,'$.university_id'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) pin WHERE NOT EXISTS(SELECT 1 FROM maintenance_target_sources WHERE target_id=pin.value AND source_id=?))
      AND (?='capture' OR NOT EXISTS(SELECT 1 FROM maintenance_legacy_guards WHERE (university_id IS NULL OR university_id IN(SELECT value FROM json_each(?))) AND (snapshot_sha256 IS NULL OR snapshot_sha256=?) AND (source_id=? OR(source_id IS NULL AND(record_id IS NULL OR record_id IN(SELECT value FROM json_each(?)))))))
      AND ${p.kind==='capture'?'1=1':p.derivative?`EXISTS(SELECT 1 FROM maintenance_document_derivatives d CROSS JOIN(SELECT ? value) expected WHERE ${matches('d','expected.value',Object.keys(p.derivative))})`:'NOT EXISTS(SELECT 1 FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?)'} THEN 1 ELSE 0 END))`)
      .bind(guards[index+1],canonical(p.job),at,canonical(p.source),p.source.source_id,scope,canonical(p.schoolIds),canonical(p.schoolIds),p.source.source_id,p.kind,p.source.source_id,p.source.source_id,p.job.job_id,canonical(p.targets),canonical(p.directBindings),p.source.source_id,p.kind,canonical(p.schoolIds),p.job.snapshot_sha256??p.source.raw_sha256,p.source.source_id,canonical(p.targets.map(t=>JSON.parse(t.target_json).recordId)),...(p.kind==='capture'?[]:p.derivative?[canonical(p.derivative)]:[p.source.source_id,p.source.raw_sha256]))),
    ...candidates.flatMap((c,index)=>[
      env.PIPELINE_DB.prepare("INSERT INTO maintenance_refill_dispatches(dispatch_token,job_id,epoch_sha256,kind,stage,scope_sha256,input_catalog_sha256,control_revision,fence_json,candidate_json,candidate_sha256,job_json,status,claimed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?)").bind(token,c.jobId,options.epochSha256,fence.kind,c.stage,scope,fence.inputCatalogSha256,fence.revision,canonical(fence),canonical(c),candidateHashes[index],canonical(proofs[index].job),at),
      env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET enqueued_at=? WHERE job_id=? AND status IN('queued','retry')").bind(at,c.jobId),
    ]),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_refill_fairness(scope_sha256,kind,revision,slot_offset,expansion_offset) VALUES(?,?,1,?,?) ON CONFLICT(scope_sha256,kind) DO UPDATE SET revision=revision+1,slot_offset=slot_offset+excluded.slot_offset,expansion_offset=expansion_offset+excluded.expansion_offset').bind(scope,fence.kind,candidates.length,candidates.filter(c=>!c.maintenanceLane).length),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id IN(SELECT value FROM json_each(?))').bind(canonical(guards)),
  ])}catch(error){const committed=await readRefillDispatchStatus(env,token);if(committed.entries.length){result.unconfirmed.push(...candidates.map(c=>c.jobId));return result}if(error instanceof MaintenanceError)throw error;return deny('claim_conflict')}
  // The durable owner must have saved these IDs before calling this function.
  // A prepared row after a crash/ambiguous reply is never automatically sent.
  for(const c of candidates){
    const current=await readRefillJobState(env,c.jobId)
    if(!(await open(env,Date.now()))||!sameFence(await control(env),fence,options.now===undefined?Date.now():now)||!current?.inScope||current.protectedModel||current.status!==c.status||current.attempt!==c.attempt||current.updatedAt!==c.updatedAt||current.leaseToken!==null){
      await env.PIPELINE_DB.batch([env.PIPELINE_DB.prepare("UPDATE maintenance_refill_dispatches SET status='not_sent',observed_at=? WHERE dispatch_token=? AND job_id=? AND status='prepared'").bind(nowIso(),token,c.jobId),env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET enqueued_at=? WHERE job_id=? AND status IN('queued','retry') AND attempt=? AND updated_at=? AND enqueued_at=? AND lease_token IS NULL").bind(c.enqueuedAt,c.jobId,c.attempt,c.updatedAt,at)]);result.notSent.push({jobId:c.jobId,reason:'control_or_budget_changed_before_send'});continue
    }
    try{
      const message={version:1 as const,jobId:c.jobId,refill:{dispatchToken:token,epochSha256:options.epochSha256}}
      await env.MAINTENANCE_QUEUE.send(message)
      await env.PIPELINE_DB.prepare("UPDATE maintenance_refill_dispatches SET status='sent',sent_at=? WHERE dispatch_token=? AND job_id=? AND status='prepared'").bind(nowIso(),token,c.jobId).run()
      result.sent.push(c.jobId)
    }catch{await env.PIPELINE_DB.prepare("UPDATE maintenance_refill_dispatches SET status='unconfirmed' WHERE dispatch_token=? AND job_id=? AND status='prepared'").bind(token,c.jobId).run().catch(()=>undefined);result.unconfirmed.push(c.jobId)}
  }
  if(result.sent.length){const cfg=await control(env);if(cfg&&cfg.scope_sha256===scope){const ctx=await context(env,cfg,now);await saveSchoolRotation(env,ctx.rotation,scope,ctx.ids,candidates.filter(c=>result.sent.includes(c.jobId)).map(c=>c.schedulingSchoolId),now)}}
  return result
}
export async function readRefillJobState(env:MaintenanceEnv,jobId:string):Promise<RefillJobState|null>{
  const job=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').bind(jobId).first<Record<string,unknown>>();if(!job)return null
  const cfg=await control(env),schools=(await sourceSchools(env,String(job.source_id))).map(s=>s.university_id),canary=cfg?JSON.parse(cfg.canary_json)as string[]:[]
  const row=await source(env,String(job.source_id)),uncertain=job.stage==='capture'?null:await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_model_attempts WHERE source_id=? AND status IN('unknown','reserved','send_started') UNION ALL SELECT 1 FROM maintenance_jobs WHERE source_id=? AND status='unknown' LIMIT 1").bind(String(job.source_id),String(job.source_id)).first()
  const protectedModel=job.stage!=='capture'&&Boolean(uncertain||row&&await stopped(env,tuple(job,jobFields),row,schools,[]))
  return{jobId:String(job.job_id),sourceId:String(job.source_id),stage:job.stage as JobRow['stage'],status:String(job.status),attempt:Number(job.attempt),updatedAt:String(job.updated_at),leaseToken:job.lease_token as string|null,leaseUntil:job.lease_until as string|null,protectedModel,inScope:Boolean(cfg?.enabled&&cfg.seed_complete&&row?.enabled&&schools.length&&(!canary.length||schools.some(s=>canary.includes(s))))}
}
export async function readRefillDispatchStatus(env:MaintenanceEnv,dispatchToken:string,options:{includeJobState?:boolean}={}){
  const rows=(await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_refill_dispatches WHERE dispatch_token=? ORDER BY job_id LIMIT 9').bind(dispatchToken).all<Ledger>()).results??[];if(rows.length>8)return fail('ledger_oversized')
  return{dispatchToken,entries:await Promise.all(rows.map(async row=>{const c=JSON.parse(row.candidate_json)as RefillCandidate,f=JSON.parse(row.fence_json)as RefillDispatchFence,p=await loadProof(env,c);if(!HASH.test(row.candidate_sha256)||await digest(row.candidate_json)!==row.candidate_sha256||canonical(c)!==row.candidate_json||canonical(f)!==row.fence_json||canonical(p.job)!==row.job_json||c.jobId!==row.job_id||c.stage!==row.stage||f.kind!==row.kind||f.scopeSha256!==row.scope_sha256||f.inputCatalogSha256!==row.input_catalog_sha256||f.revision!==row.control_revision||!HASH.test(row.epoch_sha256))return fail('ledger_corrupt');const receivedNotStartedReceiptSha256=row.resolution==='received_not_started'?await refusalReceipt(env,row):null;return{jobId:row.job_id,sourceId:c.sourceId,stage:row.stage,kind:row.kind,status:row.status,resolution:row.resolution,receivedNotStartedReceiptSha256,candidateSha256:row.candidate_sha256,fenceSha256:await digest(row.fence_json),epochSha256:row.epoch_sha256,claimedAt:row.claimed_at,sentAt:row.sent_at,job:options.includeJobState===false?null:await readRefillJobState(env,row.job_id)}}))}
}
export async function observeRefillDispatch(env:MaintenanceEnv,dispatchToken:string,jobId:string){
  const row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_refill_dispatches WHERE dispatch_token=? AND job_id=?').bind(dispatchToken,jobId).first<Ledger>();if(!row)return false
  const candidate=JSON.parse(row.candidate_json)as RefillCandidate
  if(await digest(row.candidate_json)!==row.candidate_sha256||canonical((await loadProof(env,candidate)).job)!==row.job_json)return fail('ledger_corrupt')
  const result=await env.PIPELINE_DB.prepare("UPDATE maintenance_refill_dispatches SET status='observed',resolution='job_progress',observed_at=? WHERE dispatch_token=? AND job_id=? AND status IN('prepared','sent','unconfirmed') AND EXISTS(SELECT 1 FROM maintenance_jobs j WHERE j.job_id=? AND j.source_id=? AND j.stage=? AND(j.attempt>? OR j.status IN('running','done','held','unknown')))").bind(nowIso(),dispatchToken,jobId,jobId,candidate.sourceId,candidate.stage,candidate.attempt).run()
  return result.meta?.changes===1
}

const declineReasons=new Set(['operator_pause','outside_canary','outside_scope','models_disabled','targets_not_ready','source_disabled','permit_denied','claim_rejected','budget_wait','quota_wait','stale_epoch','capacity_wait','broker_attempt_limit','runtime_protected'])
async function refusalReceipt(env:MaintenanceEnv,row:Ledger){
  const saved=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(`refill-received-not-started:${row.dispatch_token}:${row.job_id}`).first<{kind:string;details_json:string}>()
  if(!saved||saved.kind!=='refill_received_not_started')return fail('refusal_receipt_missing')
  const value=record(JSON.parse(saved.details_json))
  if(!value||canonical(value)!==saved.details_json||value.format!=='studyinchina.refill-received-not-started'||value.version!==1||value.jobId!==row.job_id||value.dispatchToken!==row.dispatch_token||value.epochSha256!==row.epoch_sha256||value.candidateSha256!==row.candidate_sha256||value.jobTupleSha256!==await digest(row.job_json)||!declineReasons.has(String(value.reason))||value.modelOutcomesChanged!==false)return fail('refusal_receipt_invalid')
  return digest(saved.details_json)
}
/** Called only by the authenticated actual Queue-delivery path before claim.
 * A changed baseline/lease prevents refusal. This bounded cleanup exception is
 * allowed during budget holds: it cannot enqueue work or alter model outcomes. */
export async function declineRefillDispatch(env:MaintenanceEnv,input:{jobId:string;dispatchToken:string;epochSha256:string;reason:string;currentEpochSha256?:string}){
  if(!ID.test(input.jobId)||!/^[A-Za-z0-9_-]{8,160}$/.test(input.dispatchToken)||!declineReasons.has(input.reason)||!HASH.test(input.epochSha256)||input.currentEpochSha256!==undefined&&!HASH.test(input.currentEpochSha256))return{declined:false,reason:'invalid_refusal'}
  if(env.MODEL_STATE_MIGRATION_ROLE==='source')return{declined:false,reason:'source_frozen'}
  const row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_refill_dispatches WHERE dispatch_token=? AND job_id=? AND epoch_sha256=?').bind(input.dispatchToken,input.jobId,input.epochSha256).first<Ledger>()
  if(!row)return{declined:false,reason:'dispatch_missing'}
  if(row.status==='observed'&&row.resolution==='received_not_started'){await refusalReceipt(env,row);return{declined:true,reason:'received_not_started'}}
  if(!['prepared','sent','unconfirmed'].includes(row.status))return{declined:false,reason:'dispatch_not_active'}
  const candidate=JSON.parse(row.candidate_json)as RefillCandidate,proof=await loadProof(env,candidate),cfg=await control(env)
  if(!cfg||canonical(proof.job)!==row.job_json||await digest(row.candidate_json)!==row.candidate_sha256)return{declined:false,reason:'proof_unavailable'}
  const guard=crypto.randomUUID(),at=nowIso(),eventId=`refill-received-not-started:${input.dispatchToken}:${input.jobId}`,baselineFields=jobFields.filter(field=>field!=='enqueued_at')
  const details=canonical({format:'studyinchina.refill-received-not-started',version:1,jobId:input.jobId,dispatchToken:input.dispatchToken,epochSha256:input.epochSha256,currentEpochSha256:input.currentEpochSha256??null,candidateSha256:row.candidate_sha256,jobTupleSha256:await digest(row.job_json),reason:input.reason,observedAt:at,modelOutcomesChanged:false})
  try{await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_refill_dispatches WHERE dispatch_token=? AND job_id=? AND epoch_sha256=? AND status IN('prepared','sent','unconfirmed') AND job_json=? AND candidate_sha256=?)
      AND EXISTS(SELECT 1 FROM maintenance_jobs j CROSS JOIN(SELECT ? value) expected WHERE ${matches('j','expected.value',baselineFields)} AND j.status IN('queued','retry') AND j.lease_token IS NULL AND j.lease_until IS NULL AND j.enqueued_at=?)
      AND EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND revision=? AND canary_json=?) THEN 1 ELSE 0 END))`).bind(guard,input.dispatchToken,input.jobId,input.epochSha256,row.job_json,row.candidate_sha256,row.job_json,row.claimed_at,cfg.scope_sha256,cfg.input_catalog_sha256,cfg.revision,cfg.canary_json),
    env.PIPELINE_DB.prepare("UPDATE maintenance_refill_dispatches SET status='observed',resolution='received_not_started',observed_at=? WHERE dispatch_token=? AND job_id=? AND epoch_sha256=? AND status IN('prepared','sent','unconfirmed')").bind(at,input.dispatchToken,input.jobId,input.epochSha256),
    env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET enqueued_at=? WHERE job_id=? AND status IN('queued','retry') AND attempt=? AND lease_token IS NULL AND enqueued_at=?").bind(candidate.enqueuedAt,input.jobId,candidate.attempt,row.claimed_at),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(eventId,'refill_received_not_started',at,details),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ]);return{declined:true,reason:'received_not_started'}}catch{const saved=await env.PIPELINE_DB.prepare('SELECT details_json FROM maintenance_events WHERE event_id=? AND kind=?').bind(eventId,'refill_received_not_started').first<{details_json:string}>();return{declined:saved?.details_json===details,reason:saved?.details_json===details?'received_not_started':'refusal_unproven'}}
}
