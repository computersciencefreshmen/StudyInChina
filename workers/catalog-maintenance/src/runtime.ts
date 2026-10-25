import { control,enqueueDue,seed,setControls,status,validateSeed,type Seed } from './repository'
import type { BucketObject,MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { backendState as backendCode,backendErrorKind } from './backend-errors'
import { enqueuePendingOfflineHandoff } from './offline-handoff'
import { canonical,digest,HASH,nowIso,record } from './util'

const POINTER='maintenance/bootstrap-pending/initial.v1.json'
const UPLOAD_POINTER='maintenance/bootstrap-pending/upload.v1.json'
const LATEST='maintenance/runtime/latest.v1.json'
const FIRST_ELIGIBLE='maintenance/runtime/first-eligible.v1.json'
const DAY=86400000
function getTodayDate(date:Date){const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return`${values.year}-${values.month}-${values.day}`}
type Activation={canaryUniversityIds:string[];modelsEnabled:true}
type BootstrapPointer={format:'studyinchina.pending-bootstrap';version:1;envelopeKey:string;envelopeSha256:string;seedSha256:string;scopeRegistrySha256:string;activation:Activation}
type UploadPointer={format:'studyinchina.pending-bootstrap-upload';version:1;rawKey:string;rawSha256:string;scopeRegistrySha256:string;activation:Activation}
type TickState='running'|'disabled'|'waiting_for_bootstrap'|'waiting_for_seed'|'waiting_for_activation'|'quota_wait'|'error'
export type RuntimeTick={format:'studyinchina.cloud-maintenance-tick';version:1;tickId:string;observedAt:string;state:TickState;code:string;queued:number|null;seedComplete:boolean|null;targetsComplete:boolean|null;modelsEnabled:boolean|null;canarySchoolCount:number|null;retryAt:string|null}
type DailyHistory={date:string;ticks:RuntimeTick[];truncated:boolean}
const jsonOptions={httpMetadata:{contentType:'application/json'}}
async function readObject(env:MaintenanceEnv,key:string,max=512*1024):Promise<{object:BucketObject;text:string}|null>{const object=await env.SNAPSHOTS_BUCKET.get(key);if(!object)return null;if(object.size!==undefined&&object.size>max)throw new MaintenanceError('runtime_artifact_too_large');const text=await object.text();if(new TextEncoder().encode(text).byteLength>max)throw new MaintenanceError('runtime_artifact_too_large');return{object,text}}
async function immutable(env:MaintenanceEnv,key:string,text:string):Promise<void>{const previous=await readObject(env,key,24*1024*1024);if(previous){if(previous.text!==text)throw new MaintenanceError('immutable_bootstrap_conflict');return}await env.SNAPSHOTS_BUCKET.put(key,text,{...jsonOptions,onlyIf:{etagDoesNotMatch:'*'}});const stored=await readObject(env,key,24*1024*1024);if(stored?.text!==text)throw new MaintenanceError('immutable_bootstrap_conflict')}
async function updateJson(env:MaintenanceEnv,key:string,change:(value:unknown)=>unknown):Promise<void>{for(let attempt=0;attempt<4;attempt++){const previous=await readObject(env,key);const value=change(previous?JSON.parse(previous.text):null);const options=previous?.object.etag?{etagMatches:previous.object.etag}:{etagDoesNotMatch:'*'};if(previous&&!previous.object.etag)throw new MaintenanceError('runtime_etag_unavailable');const saved=await env.SNAPSHOTS_BUCKET.put(key,canonical(value),{...jsonOptions,onlyIf:options});if(saved!==null)return}throw new MaintenanceError('runtime_receipt_conflict')}

/** HTTP uses only small metadata and a bounded native stream. Full JSON/schema
 * validation runs in the Queue consumer, whose CPU budget is appropriate for it. */
export async function registerBootstrapRequest(env:MaintenanceEnv,request:Request){
  const hash=request.headers.get('x-maintenance-bootstrap-sha256')??'',scope=request.headers.get('x-maintenance-scope-sha256')??''
  const canary=(request.headers.get('x-maintenance-canary-ids')??'').split(',').sort()
  const declared=request.headers.get('content-length')??''
  if(!HASH.test(hash)||scope!==env.SCOPE_REGISTRY_SHA256||!HASH.test(scope)||request.headers.get('x-maintenance-models-enabled')!=='true'||canary.length!==5||new Set(canary).size!==5||canary.some(id=>!/^[a-zA-Z0-9_.:-]{1,160}$/.test(id))||!request.headers.get('content-type')?.includes('application/json')||!request.body||!/^[1-9]\d*$/.test(declared)||Number(declared)>8*1024*1024)throw new MaintenanceError('bootstrap_upload_metadata_invalid')
  const rawKey=`maintenance/bootstrap-pending/raw/${hash}.json`,activation:Activation={canaryUniversityIds:canary,modelsEnabled:true}
  const pointer:UploadPointer={format:'studyinchina.pending-bootstrap-upload',version:1,rawKey,rawSha256:hash,scopeRegistrySha256:scope,activation}
  const old=await readObject(env,UPLOAD_POINTER)
  if(old&&old.text!==canonical(pointer))throw new MaintenanceError('immutable_bootstrap_conflict')
  // Preserve Cloudflare's native known-length request stream. A generic
  // TransformStream would lose that length and is rejected by R2 in production.
  // Queue validation independently verifies the stored size and exact digest.
  await env.SNAPSHOTS_BUCKET.put(rawKey,request.body,{...jsonOptions,onlyIf:{etagDoesNotMatch:'*'}})
  await immutable(env,UPLOAD_POINTER,canonical(pointer))
  await env.MAINTENANCE_QUEUE.send({version:1,jobId:hash,bootstrapUploadSha256:hash})
  return{ok:true,bootstrapUploadSha256:hash,pending:true,validation:'pending-queue',activationStored:true,activationValidated:false,scopeRegistrySha256:scope,canaryUniversityIds:canary,d1Observed:false,modelCallsPerformed:false}
}
export async function preparePendingBootstrap(env:MaintenanceEnv,hash:string){
  const saved=await readObject(env,UPLOAD_POINTER)
  if(!saved)throw new MaintenanceError('bootstrap_upload_missing')
  const pointer=JSON.parse(saved.text)as UploadPointer
  if(pointer.rawSha256!==hash||pointer.rawKey!==`maintenance/bootstrap-pending/raw/${hash}.json`||pointer.scopeRegistrySha256!==env.SCOPE_REGISTRY_SHA256)throw new MaintenanceError('bootstrap_upload_binding_mismatch')
  const object=await env.SNAPSHOTS_BUCKET.get(pointer.rawKey)
  if(!object||object.size!==undefined&&object.size>8*1024*1024)throw new MaintenanceError('bootstrap_upload_unavailable')
  const bytes=await object.arrayBuffer()
  if(bytes.byteLength>8*1024*1024||await digest(bytes)!==hash)throw new MaintenanceError('bootstrap_upload_checksum_mismatch')
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))as Record<string,unknown>
  const activation=record(value.activation)
  if(!activation||activation.modelsEnabled!==true||!Array.isArray(activation.canaryUniversityIds)||canonical([...activation.canaryUniversityIds].sort())!==canonical(pointer.activation.canaryUniversityIds))throw new MaintenanceError('bootstrap_upload_activation_mismatch')
  return registerBootstrap(env,value)
}

/** Durable initial intent lives in R2, so an exhausted shared D1 daily quota
 * cannot erase it. Registration performs no D1 query and no model request. */
export async function registerBootstrap(env:MaintenanceEnv,value:unknown){
  const raw=record(value),activation=record(raw?.activation)
  if(!raw||!activation||activation.modelsEnabled!==true||!Array.isArray(activation.canaryUniversityIds)||activation.canaryUniversityIds.length!==5||new Set(activation.canaryUniversityIds).size!==5||activation.canaryUniversityIds.some(id=>typeof id!=='string'))throw new MaintenanceError('bootstrap_requires_explicit_five_school_activation')
  const input=validateSeed(raw.seed)
  if(!env.SCOPE_REGISTRY_SHA256||env.SCOPE_REGISTRY_SHA256!==input.scopeRegistrySha256)throw new MaintenanceError('bootstrap_scope_pin_mismatch')
  const canary=[...activation.canaryUniversityIds].sort()as string[]
  if(canary.some(id=>!input.schools.some(s=>s.universityId===id)))throw new MaintenanceError('bootstrap_canary_outside_fixed_scope')
  const approved:Activation={canaryUniversityIds:canary,modelsEnabled:true}
  const envelope={format:'studyinchina.pending-bootstrap-envelope',version:1,seed:input,activation:approved},text=canonical(envelope),envelopeSha256=await digest(text)
  const envelopeKey=`maintenance/bootstrap-pending/envelopes/${envelopeSha256}.json`
  const pointer:BootstrapPointer={format:'studyinchina.pending-bootstrap',version:1,envelopeKey,envelopeSha256,seedSha256:await digest(canonical(input)),scopeRegistrySha256:input.scopeRegistrySha256,activation:approved}
  await immutable(env,envelopeKey,text)
  await immutable(env,POINTER,canonical(pointer))
  await immutable(env,`maintenance/bootstrap-pending/receipts/${envelopeSha256}.json`,canonical({bootstrapSha256:envelopeSha256,registeredAt:nowIso()})).catch(error=>{if(!(error instanceof MaintenanceError&&error.code==='immutable_bootstrap_conflict'))throw error})
  return{ok:true,bootstrapSha256:envelopeSha256,seedSha256:pointer.seedSha256,pending:true,activationStored:true,canaryUniversityIds:canary,modelsEnabledRequested:true,d1Observed:false,modelCallsPerformed:false}
}
async function bootstrapPointer(env:MaintenanceEnv):Promise<BootstrapPointer|null>{const saved=await readObject(env,POINTER);if(!saved)return null;const pointer=JSON.parse(saved.text)as BootstrapPointer;if(pointer.format!=='studyinchina.pending-bootstrap'||pointer.version!==1||!HASH.test(pointer.envelopeSha256)||!HASH.test(pointer.seedSha256)||pointer.envelopeKey!==`maintenance/bootstrap-pending/envelopes/${pointer.envelopeSha256}.json`||pointer.scopeRegistrySha256!==env.SCOPE_REGISTRY_SHA256)throw new MaintenanceError('pending_bootstrap_pointer_invalid');return pointer}
async function bootstrapEnvelope(env:MaintenanceEnv,pointer:BootstrapPointer):Promise<{seed:Seed;activation:Activation}>{const saved=await readObject(env,pointer.envelopeKey,8*1024*1024);if(!saved||await digest(saved.text)!==pointer.envelopeSha256)throw new MaintenanceError('pending_bootstrap_checksum_mismatch');const value=JSON.parse(saved.text)as {seed:Seed;activation:Activation};if(await digest(canonical(value.seed))!==pointer.seedSha256||canonical(value.activation)!==canonical(pointer.activation))throw new MaintenanceError('pending_bootstrap_binding_mismatch');return value}
export async function resumeBootstrapSeed(env:MaintenanceEnv,hash:string){const pointer=await bootstrapPointer(env);if(!pointer||pointer.seedSha256!==hash)throw new MaintenanceError('bootstrap_seed_pointer_mismatch');const cfg=await control(env);if(cfg){if(cfg.seed_sha256!==hash)throw new MaintenanceError('bootstrap_existing_seed_conflict');return enqueueDue(env)}const envelope=await bootstrapEnvelope(env,pointer);return seed(env,envelope.seed,Date.now(),true)}
export function nextD1Reset(now=Date.now()):string{const date=new Date(now);return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString()}
async function saveTick(env:MaintenanceEnv,tick:RuntimeTick){
  const day=getTodayDate(new Date(tick.observedAt)),key=`maintenance/runtime/ticks/${day}/${tick.tickId}.json`
  await immutable(env,key,canonical(tick))
  await updateJson(env,`maintenance/runtime/days/${day}.json`,raw=>{const previous=record(raw),ticks=Array.isArray(previous?.ticks)?previous.ticks as RuntimeTick[]:[];const all=[...ticks.filter(t=>t.tickId!==tick.tickId),tick].sort((a,b)=>a.observedAt.localeCompare(b.observedAt));return{date:day,ticks:all.slice(-1024),truncated:previous?.truncated===true||all.length>1024}})
  await updateJson(env,LATEST,raw=>{const previous=record(raw);return typeof previous?.observedAt==='string'&&previous.observedAt>tick.observedAt?previous:tick})
  if(tick.state==='running'&&tick.seedComplete&&tick.targetsComplete&&tick.modelsEnabled&&tick.canarySchoolCount===0){const existing=await readObject(env,FIRST_ELIGIBLE);if(!existing)await immutable(env,FIRST_ELIGIBLE,canonical({tickId:tick.tickId,observedAt:tick.observedAt})).catch(()=>undefined)}
  return{...tick,receiptKey:key,receiptSha256:await digest(canonical(tick))}
}
/** The only scheduler required is an authenticated GitHub cloud tick. Existing
 * account crons and billing settings are not changed. */
export async function runCloudTick(env:MaintenanceEnv){
  const tick:RuntimeTick={format:'studyinchina.cloud-maintenance-tick',version:1,tickId:crypto.randomUUID(),observedAt:nowIso(),state:'disabled',code:'not_observed',queued:null,seedComplete:null,targetsComplete:null,modelsEnabled:null,canarySchoolCount:null,retryAt:null}
  try{
    await enqueuePendingOfflineHandoff(env)
    const pointer=await bootstrapPointer(env)
    if(!pointer){const uploaded=await readObject(env,UPLOAD_POINTER);if(uploaded){const pending=JSON.parse(uploaded.text)as UploadPointer;await env.MAINTENANCE_QUEUE.send({version:1,jobId:pending.rawSha256,bootstrapUploadSha256:pending.rawSha256})}}
    let cfg=await control(env)
    if(!cfg&&pointer){await env.MAINTENANCE_QUEUE.send({version:1,jobId:pointer.seedSha256,bootstrapSeedSha256:pointer.seedSha256});tick.state='waiting_for_seed';tick.code='pending_bootstrap_seed_queued';tick.queued=1}
    else if(!cfg){tick.state='waiting_for_bootstrap';tick.code='no_seed_or_pending_bootstrap'}
    else{
      if(pointer&&cfg.seed_sha256!==pointer.seedSha256)throw new MaintenanceError('pending_bootstrap_existing_seed_conflict')
      tick.seedComplete=Boolean(cfg.seed_complete);tick.targetsComplete=Boolean(cfg.targets_complete);tick.modelsEnabled=Boolean(cfg.models_enabled);tick.canarySchoolCount=(JSON.parse(cfg.canary_json)as string[]).length
      if(!cfg.seed_complete){const result=await enqueueDue(env);tick.state='waiting_for_seed';tick.code='durable_seed_in_progress';tick.queued=result.queued}
      else{
        if(cfg.revision===0&&pointer&&env.MAINTENANCE_ENABLED==='true'){
          cfg=await setControls(env,{expectedRevision:0,legacyGuardSha256:cfg.legacy_guard_sha256,enabled:true,modelsEnabled:pointer.activation.modelsEnabled,canaryUniversityIds:pointer.activation.canaryUniversityIds})
          if(!cfg)throw new MaintenanceError('bootstrap_control_readback_unavailable')
        }
        // Revision >0 belongs to the existing control owner. A retrying initial
        // bootstrap never overrides a manual pause or later canary decision.
        const result=await enqueueDue(env)
        tick.queued=result.queued;tick.targetsComplete=Boolean(cfg.targets_complete);tick.modelsEnabled=Boolean(cfg.models_enabled);tick.canarySchoolCount=(JSON.parse(cfg.canary_json)as string[]).length
        tick.state=result.enabled?'running':cfg.revision===0&&pointer?'waiting_for_activation':'disabled'
        tick.code=result.enabled?'bounded_scheduler_completed':env.MAINTENANCE_ENABLED!=='true'?'deployment_activation_gate_disabled':cfg.targets_complete?'existing_controls_preserved':'target_refresh_in_progress'
      }
    }
  }catch(error){const backend=backendCode(error);tick.state=backend==='quota_wait'?'quota_wait':'error';tick.code=error instanceof MaintenanceError?error.code:backend;tick.retryAt=backend==='quota_wait'?nextD1Reset():null}
  return saveTick(env,tick)
}
export function buildSoakObservation(ticks:RuntimeTick[],firstEligibleAt:string|null,now=Date.now(),historyTruncated=false){
  const windowStart=now-7*DAY,first=Date.parse(firstEligibleAt??''),valid=ticks.filter(t=>Number.isFinite(Date.parse(t.observedAt))&&Date.parse(t.observedAt)>=windowStart&&Date.parse(t.observedAt)<=now).sort((a,b)=>a.observedAt.localeCompare(b.observedAt))
  const eligible=valid.filter(t=>t.state==='running'&&t.seedComplete&&t.targetsComplete&&t.modelsEnabled&&t.canarySchoolCount===0)
  const times=eligible.map(t=>Date.parse(t.observedAt)),start=Number.isFinite(first)&&first<=now?Math.max(windowStart,first):now
  const timeline=[start,...times,now].sort((a,b)=>a-b),maxGapMinutes=Math.max(0,...timeline.slice(1).map((time,index)=>(time-timeline[index])/60000))
  const elapsedHours=Number.isFinite(first)&&first<=now?(now-first)/3600000:0
  const failures=valid.filter(t=>Date.parse(t.observedAt)>=start&&['error','quota_wait'].includes(t.state)).length
  const passed=elapsedHours>=168&&maxGapMinutes<=45&&failures===0&&!historyTruncated&&eligible.length>0
  return{requiredHours:168,firstEligibleTickAt:Number.isFinite(first)?firstEligibleAt:null,observedHours:Math.round(elapsedHours*100)/100,recordedTicksLastSevenDays:valid.length,eligibleTicksLastSevenDays:eligible.length,latestEligibleTickAt:eligible.at(-1)?.observedAt??null,maxGapMinutes:Math.round(maxGapMinutes*100)/100,waitingOrFailedTicks:failures,historyTruncated,assessment:passed?'seven_days_observed':elapsedHours>=168?'attention_required':'collecting',passed}
}
async function soak(env:MaintenanceEnv,now=Date.now()){
  const days=Array.from({length:8},(_,index)=>getTodayDate(new Date(now-index*DAY)))
  const records=await Promise.all(days.map(day=>readObject(env,`maintenance/runtime/days/${day}.json`)))
  const histories=records.filter((value):value is NonNullable<typeof value>=>Boolean(value)).map(value=>JSON.parse(value.text)as DailyHistory)
  const first=await readObject(env,FIRST_ELIGIBLE),firstAt=first?record(JSON.parse(first.text))?.observedAt:null
  return buildSoakObservation(histories.flatMap(history=>history.ticks),typeof firstAt==='string'?firstAt:null,now,histories.some(history=>history.truncated))
}
export async function runtimeStatus(env:MaintenanceEnv){
  const [latest,observation,pointer,uploaded]=await Promise.all([readObject(env,LATEST),soak(env),bootstrapPointer(env),readObject(env,UPLOAD_POINTER)])
  const runtime={lastRuntimeTick:latest?JSON.parse(latest.text)as RuntimeTick:null,soak:observation,bootstrapUploadPending:uploaded?JSON.parse(uploaded.text)as UploadPointer:null,bootstrapPending:pointer?{bootstrapSha256:pointer.envelopeSha256,seedSha256:pointer.seedSha256,scopeRegistrySha256:pointer.scopeRegistrySha256,activation:pointer.activation}:null}
  try{return{...await status(env),...runtime,backend:{state:'ready',retryAt:null,errorKind:null,diagnosticKey:null,diagnosticSha256:null}}}
  catch(error){
    const state=backendCode(error),errorKind=backendErrorKind(error),observedAt=nowIso()
    // This catch covers only our fixed static status SQL, never model payloads
    // or arbitrary client SQL. Keep raw failure text private and bounded.
    let message=error instanceof Error?error.message:String(error)
    for(const secret of [env.MAINTENANCE_ADMIN_TOKEN,env.MINIMAX_SUBSCRIPTION_KEY])if(secret)message=message.replaceAll(secret,'[redacted]')
    message=message.replace(/Bearer\s+[^\s"']+/giu,'Bearer [redacted]').slice(0,1200)
    let diagnosticKey:string|null=null,diagnosticSha256:string|null=null
    try{const text=canonical({format:'studyinchina.private-status-diagnostic',version:1,observedAt,operation:'fixed-status-sql',errorKind,message});diagnosticSha256=await digest(text);const key=`maintenance/diagnostics/status/${diagnosticSha256}.json`;await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});diagnosticKey=key}catch{diagnosticSha256=null}
    return{format:'studyinchina.cloud-maintenance-status',version:1,observedAt,enabled:false,modelEnabled:false,scopeCount:null,control:null,jobs:null,proposals:null,sources:null,modelAttempts:null,coverage:null,websiteBackendChanged:false,...runtime,backend:{state,retryAt:state==='quota_wait'?nextD1Reset():null,errorKind,diagnosticKey,diagnosticSha256},productionRunningClaim:false}
  }
}
