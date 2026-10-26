import { control,event } from './repository'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { backendState as backend } from './backend-errors'
import { canonical,digest,HASH,nowIso,record } from './util'
import { orderSchoolExpansionCandidates } from './school-priority'

type School={university_id:string;last_attempt_at:string|null}
type Inspection={university_id:string;source_id:string;url:string;due_at:string;last_attempt_at:string;kind:'captured'|'blocked';observation_id:string|null;checked_at:string|null;raw_sha256:string|null;snapshot_key:string|null;job_id:string|null;error_code:string|null}
type Published={batch_id:string;acknowledgement_sha256:string;acknowledgement_json:string}
type Advance={scopeRegistrySha256:string;currentCanaryIds:string[];nextCanaryIds:string[];inspectedSchoolIds:string[]}
export type RolloutState={format:'studyinchina.maintenance-rollout';version:1;observedAt:string;backendState:'ready'|'quota_wait'|'backend_unavailable';expectedRevision:number|null;scopeRegistrySha256:string|null;state:'holding'|'eligible'|'full_scope';reasons:string[];currentCanaryIds:string[];currentBatchIds:string[];nextCanaryIds:string[];addedSchoolIds:string[];inspectedSchoolIds:string[];inspections:Inspection[];publication:{batchId:string;sourceCommit:string;deploymentId:string;stableProofSha256:string;acknowledgementSha256:string}|null}
const timestamp=(value:unknown,now:number)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now
// First inspection is a real successful observation OR an explicit completed
// blocking capture attempt. It is deliberately weaker than school reconciliation.
const inspectedSource=`s.last_attempt_at IS NOT NULL AND (EXISTS(SELECT 1 FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.raw_sha256 IS NOT NULL AND o.snapshot_key IS NOT NULL) OR (s.failures>0 AND (s.error_code IN('robots_disallowed','robots_fetch_failed','source_fetch_failed','empty_official_text') OR s.error_code GLOB 'robots_http_[0-9][0-9][0-9]' OR s.error_code GLOB 'source_http_[0-9][0-9][0-9]') AND EXISTS(SELECT 1 FROM maintenance_jobs j WHERE j.source_id=s.source_id AND j.stage='capture' AND j.attempt>0 AND j.status IN('held','retry') AND j.error_code=s.error_code)))`
const safetyFence=`NOT EXISTS(SELECT 1 FROM maintenance_exports WHERE status IN('prepared','applied')) AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status='unknown' OR (status IN('reserved','send_started') AND started_at<?)) AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE status='unknown' OR (status='running' AND (lease_token IS NULL OR lease_until IS NULL OR lease_until<=?))) AND NOT EXISTS(SELECT lease_token FROM maintenance_jobs WHERE status='running' GROUP BY lease_token HAVING COUNT(*)>1)`

async function previousAdvance(env:MaintenanceEnv,scope:string,current:string[]):Promise<Advance|null>{
  const rows=(await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='rollout_advanced' ORDER BY observed_at DESC,event_id DESC LIMIT 10").all<{details_json:string}>()).results??[]
  for(const row of rows){
    const ref=record(JSON.parse(row.details_json));if(!ref||!HASH.test(String(ref.sha256))||ref.objectKey!==`maintenance/rollout/decisions/${ref.sha256}.json`)continue
    const object=await env.SNAPSHOTS_BUCKET.get(String(ref.objectKey));if(!object||object.size!==undefined&&object.size>256*1024)continue
    const text=await object.text();if(await digest(text)!==ref.sha256)continue
    const receipt=record(JSON.parse(text)),decision=record(receipt?.decision)
    if(decision?.scopeRegistrySha256===scope&&Array.isArray(decision.nextCanaryIds)&&canonical(decision.nextCanaryIds)===canonical(current)&&Array.isArray(decision.inspectedSchoolIds)&&Array.isArray(decision.currentCanaryIds))return decision as Advance
  }
  return null
}
async function verifyCapturedReference(env:MaintenanceEnv,proof:Inspection,now:number){
  if(!proof.raw_sha256||!HASH.test(proof.raw_sha256)||proof.snapshot_key!==`maintenance/snapshots/${proof.source_id}/${proof.raw_sha256}.json`||!timestamp(proof.checked_at,now))return false
  const object=await env.SNAPSHOTS_BUCKET.get(proof.snapshot_key)
  if(!object||object.size!==undefined&&object.size>2*1024*1024)return false
  const snapshot=record(JSON.parse(await object.text()))
  if(snapshot?.sourceId!==proof.source_id||snapshot.rawSha256!==proof.raw_sha256||snapshot.sourceUrl!==proof.url||snapshot.rawKey!==`maintenance/snapshots/${proof.source_id}/${proof.raw_sha256}.bin`)return false
  // Capturer computed the raw checksum before saving the immutable observation.
  // Re-reading 10 MiB PDFs here would exceed Free HTTP CPU; existence and the
  // checksum-bound metadata are checked, while canonical import rehashes bytes.
  const raw=await env.SNAPSHOTS_BUCKET.get(String(snapshot.rawKey))
  return Boolean(raw&&(raw.size===undefined||raw.size>0))
}
export async function rolloutStatus(env:MaintenanceEnv,now=Date.now()):Promise<RolloutState>{
  const result:RolloutState={format:'studyinchina.maintenance-rollout',version:1,observedAt:nowIso(now),backendState:'ready',expectedRevision:null,scopeRegistrySha256:null,state:'holding',reasons:[],currentCanaryIds:[],currentBatchIds:[],nextCanaryIds:[],addedSchoolIds:[],inspectedSchoolIds:[],inspections:[],publication:null}
  try{
    const cfg=await control(env)
    if(!cfg){result.reasons.push('seed_not_ready');return result}
    result.expectedRevision=cfg.revision;result.scopeRegistrySha256=cfg.scope_sha256
    const current=JSON.parse(cfg.canary_json)as string[];result.currentCanaryIds=current
    if(env.MAINTENANCE_ENABLED!=='true')result.reasons.push('deployment_activation_gate_disabled')
    if(!cfg.enabled)result.reasons.push('operator_pause_preserved')
    if(!cfg.models_enabled)result.reasons.push('model_lane_disabled')
    if(!cfg.seed_complete||!cfg.targets_complete)result.reasons.push('seed_or_targets_incomplete')
    if(cfg.scope_sha256!==env.SCOPE_REGISTRY_SHA256||!HASH.test(cfg.scope_sha256))result.reasons.push('scope_pin_mismatch')
    if(result.reasons.length)return result
    const schools=orderSchoolExpansionCandidates((await env.PIPELINE_DB.prepare('SELECT university_id,last_attempt_at FROM maintenance_schools WHERE scope_sha256=? ORDER BY COALESCE(last_attempt_at,\'\'),university_id').bind(cfg.scope_sha256).all<School>()).results??[],cfg.scope_sha256)
    const ids=new Set(schools.map(school=>school.university_id))
    if(schools.length!==272||ids.size!==272||!Array.isArray(current)||new Set(current).size!==current.length||current.some(id=>!ids.has(id))){result.reasons.push('seeded_scope_unproven');return result}
    if(!current.length){result.state='full_scope';return result}
    if(current.length!==272&&(current.length<5||(current.length-5)%20!==0)){result.reasons.push('rollout_stage_unrecognized');return result}
    const previous=current.length>5?await previousAdvance(env,cfg.scope_sha256,current):null
    if(current.length>5&&(!previous||previous.inspectedSchoolIds.some(id=>!ids.has(id))||previous.currentCanaryIds.some(id=>!previous.inspectedSchoolIds.includes(id)))){result.reasons.push('previous_rollout_evidence_unproven');return result}
    const already=previous?.inspectedSchoolIds??[],batch=current.filter(id=>!already.includes(id));result.currentBatchIds=batch
    if(!batch.length||batch.length>(current.length===5?5:20)){result.reasons.push('current_rollout_batch_unproven');return result}
    const health=await env.PIPELINE_DB.prepare(`SELECT (SELECT COUNT(*) FROM maintenance_exports WHERE status IN('prepared','applied')) publications,(SELECT COUNT(*) FROM maintenance_model_attempts WHERE status='unknown' OR (status IN('reserved','send_started') AND started_at<?)) models,(SELECT COUNT(*) FROM maintenance_jobs WHERE status='unknown') unknown_jobs,(SELECT COUNT(*) FROM maintenance_jobs WHERE status='running' AND (lease_token IS NULL OR lease_until IS NULL OR lease_until<=?)) expired_leases,(SELECT COUNT(*) FROM(SELECT lease_token FROM maintenance_jobs WHERE status='running' GROUP BY lease_token HAVING COUNT(*)>1)) conflicting_leases`).bind(nowIso(now-120000),nowIso(now)).first<Record<string,number>>()
    if(!health){result.reasons.push('runtime_safety_unproven');return result}
    for(const [key,reason]of [['publications','publication_pending'],['models','model_outcome_unresolved'],['unknown_jobs','job_outcome_unknown'],['expired_leases','expired_execution_lease'],['conflicting_leases','execution_lease_conflict']])if(health[key])result.reasons.push(reason)
    const published=(await env.PIPELINE_DB.prepare("SELECT batch_id,acknowledgement_sha256,acknowledgement_json FROM maintenance_exports WHERE status='published' AND scope_sha256=? ORDER BY created_at DESC LIMIT 10").bind(cfg.scope_sha256).all<Published>()).results??[]
    for(const row of published){const ack=record(JSON.parse(row.acknowledgement_json));if(ack?.outcome==='published'&&ack.batchId===row.batch_id&&HASH.test(row.acknowledgement_sha256)&&await digest(canonical(ack))===row.acknowledgement_sha256&&/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(String(ack.sourceCommit))&&/^dpl_[a-zA-Z0-9]{1,100}$/.test(String(ack.deploymentId))&&HASH.test(String(ack.stableProofSha256))&&Array.isArray(ack.acceptedProposalIds)&&ack.acceptedProposalIds.length){result.publication={batchId:row.batch_id,sourceCommit:String(ack.sourceCommit),deploymentId:String(ack.deploymentId),stableProofSha256:String(ack.stableProofSha256),acknowledgementSha256:row.acknowledgement_sha256};break}}
    if(!result.publication)result.reasons.push('maintenance_publication_not_proven')
    if(result.reasons.length)return result
    const candidates=(await env.PIPELINE_DB.prepare(`SELECT x.university_id,s.source_id,s.url,s.due_at,s.last_attempt_at,CASE WHEN EXISTS(SELECT 1 FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.raw_sha256 IS NOT NULL AND o.snapshot_key IS NOT NULL) THEN 'captured' ELSE 'blocked' END kind,(SELECT observation_id FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.raw_sha256 IS NOT NULL AND o.snapshot_key IS NOT NULL ORDER BY checked_at DESC LIMIT 1) observation_id,(SELECT checked_at FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.snapshot_key IS NOT NULL ORDER BY checked_at DESC LIMIT 1) checked_at,(SELECT raw_sha256 FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.snapshot_key IS NOT NULL ORDER BY checked_at DESC LIMIT 1) raw_sha256,(SELECT snapshot_key FROM maintenance_observations o WHERE o.source_id=s.source_id AND o.http_status BETWEEN 200 AND 299 AND o.snapshot_key IS NOT NULL ORDER BY checked_at DESC LIMIT 1) snapshot_key,(SELECT job_id FROM maintenance_jobs j WHERE j.source_id=s.source_id AND j.stage='capture' AND j.attempt>0 AND j.status IN('held','retry') AND j.error_code=s.error_code ORDER BY updated_at DESC LIMIT 1) job_id,s.error_code FROM maintenance_source_schools x JOIN maintenance_sources s ON s.source_id=x.source_id JOIN json_each(?) chosen ON chosen.value=x.university_id WHERE s.enabled=1 AND ${inspectedSource} ORDER BY s.last_attempt_at DESC,s.source_id`).bind(JSON.stringify(batch)).all<Inspection>()).results??[]
    for(const id of batch){let proof:Inspection|undefined;for(const candidate of candidates.filter(row=>row.university_id===id)){if(!timestamp(candidate.last_attempt_at,now)||!Number.isFinite(Date.parse(candidate.due_at)))continue;if(candidate.kind==='blocked'&&candidate.job_id&&candidate.error_code){proof=candidate;break}if(candidate.kind==='captured'&&await verifyCapturedReference(env,candidate,now)){proof=candidate;break}}if(proof)result.inspections.push({...proof});else result.reasons.push(`school_first_inspection_unproven:${id}`)}
    result.inspectedSchoolIds=[...new Set([...already,...result.inspections.map(proof=>proof.university_id)])].sort()
    if(result.reasons.length)return result
    if(current.length===272){if(result.inspectedSchoolIds.length!==272){result.reasons.push('all_school_first_inspections_unproven');return result}result.nextCanaryIds=[]}
    else{result.addedSchoolIds=schools.filter(school=>!current.includes(school.university_id)).slice(0,20).map(school=>school.university_id);result.nextCanaryIds=[...current,...result.addedSchoolIds]}
    result.state='eligible';return result
  }catch(error){result.backendState=backend(error);result.reasons=[...new Set([...result.reasons,result.backendState==='quota_wait'?'quota_wait':'rollout_evidence_unavailable'])];return result}
}

async function saveDecision(env:MaintenanceEnv,decision:RolloutState,outcome:'holding'|'advance_proposed'|'full_scope',now:number){
  const receipt={format:'studyinchina.maintenance-rollout-decision',version:1,decisionId:crypto.randomUUID(),observedAt:nowIso(now),outcome,decision},text=canonical(receipt),sha256=await digest(text),objectKey=`maintenance/rollout/decisions/${sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(objectKey,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  return{receipt,sha256,objectKey}
}
export async function evaluateRollout(env:MaintenanceEnv,value:unknown,now=Date.now()){
  const raw=record(value),decision=await rolloutStatus(env,now)
  if(decision.expectedRevision!==null&&(!Number.isSafeInteger(raw?.expectedRevision)||raw?.expectedRevision!==decision.expectedRevision)){decision.state='holding';decision.reasons.push('control_revision_conflict')}
  if(decision.state!=='eligible'){
    const saved=await saveDecision(env,decision,decision.state==='full_scope'?'full_scope':'holding',now)
    await event(env,'rollout_held',{objectKey:saved.objectKey,sha256:saved.sha256,reasons:decision.reasons},now).catch(()=>undefined)
    return{...decision,advanced:false,receiptKey:saved.objectKey,receiptSha256:saved.sha256}
  }
  // The R2 file records proposed evidence. Only the atomic rollout_advanced D1
  // event attests that its controls mutation actually committed.
  const saved=await saveDecision(env,decision,'advance_proposed',now),guardId=crypto.randomUUID(),inspectedIds=JSON.stringify(decision.inspectedSchoolIds),current=JSON.stringify(decision.currentCanaryIds),next=JSON.stringify(decision.nextCanaryIds),cfg=await control(env)
  if(!cfg)throw new MaintenanceError('rollout_control_unavailable')
  try{
    // CHECK fences the entire transaction. Safety changes between evidence read
    // and commit abort the scope update; checking changes after commit is unsafe.
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND enabled=1 AND models_enabled=1 AND seed_complete=1 AND targets_complete=1 AND scope_sha256=? AND revision=? AND canary_json=?) AND ${safetyFence} AND EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=? AND status='published' AND acknowledgement_sha256=?) AND (SELECT COUNT(DISTINCT x.university_id) FROM maintenance_source_schools x JOIN maintenance_sources s ON s.source_id=x.source_id JOIN json_each(?) chosen ON chosen.value=x.university_id WHERE s.enabled=1 AND ${inspectedSource})=? THEN 1 ELSE 0 END))`).bind(guardId,decision.scopeRegistrySha256,decision.expectedRevision,current,nowIso(now-120000),nowIso(now),decision.publication!.batchId,decision.publication!.acknowledgementSha256,inspectedIds,decision.inspectedSchoolIds.length),
      env.PIPELINE_DB.prepare('UPDATE maintenance_control SET canary_json=?,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=? AND enabled=1 AND models_enabled=1').bind(next,nowIso(now),decision.expectedRevision),
      env.PIPELINE_DB.prepare("INSERT INTO maintenance_events VALUES(?,'rollout_advanced',?,?)").bind(crypto.randomUUID(),nowIso(now),canonical({objectKey:saved.objectKey,sha256:saved.sha256,fromRevision:decision.expectedRevision,toRevision:decision.expectedRevision!+1})),
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId),
    ])
    return{...decision,state:decision.nextCanaryIds.length?'advanced':'full_scope',advanced:true,newRevision:decision.expectedRevision!+1,receiptKey:saved.objectKey,receiptSha256:saved.sha256}
  }catch(error){decision.state='holding';decision.reasons=[backend(error)==='quota_wait'?'quota_wait':'rollout_commit_conflict'];decision.backendState=backend(error)==='quota_wait'?'quota_wait':'ready';const held=await saveDecision(env,decision,'holding',now);await event(env,'rollout_held',{objectKey:held.objectKey,sha256:held.sha256,reasons:decision.reasons},now).catch(()=>undefined);return{...decision,advanced:false,receiptKey:held.objectKey,receiptSha256:held.sha256}}
}
