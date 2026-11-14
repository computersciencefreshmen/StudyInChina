import { z } from 'zod'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import { readBackgroundBudgetGate } from '../../shared/background-budget'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { EXISTING_SCHOOLS_V2_SHA256 } from './scope-config'
import { control } from './repository'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical,digest,HASH,nowIso,record } from './util'
import { officialHostFamily,putCandidateImmutable,readCandidateAuthority } from './source-candidate-authority'

const PREFIX='maintenance/source-candidates/', KIND='official_source_candidates_registered'
const hash=z.string().regex(/^[a-f0-9]{64}$/u)
const category=z.enum(['current_guide','undergraduate_catalog','masters_catalog','doctoral_catalog','university_scholarship','dates_deadlines','fees','eligibility_language','program_detail'])
const inputSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,80}$/u),expectedRevision:z.number().int().nonnegative(),scopeRegistrySha256:hash,inputCatalogSha256:hash,universityId:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u),urls:z.array(z.object({url:z.string().min(1).max(4096),categories:z.array(category).min(1).max(3)}).strict()).min(1).max(5)}).strict()
type Input=z.infer<typeof inputSchema>
type Entry={url:string;sourceId:string;categories:string[];disposition:'created'|'reused';captureJobId:string|null}
type Receipt={format:'studyinchina.official-source-candidate-proposal';version:1;operationId:string;requestSha256:string;observedAt:string;expectedRevision:number;scopeRegistrySha256:string;inputCatalogSha256:string;universityId:string;authority:{objectKey:string;sha256:string;publicationBatchId:string;acknowledgementSha256:string;sourceCommit:string;officialUrl:string;officialFamily:string;approvedHosts:string[];seedSchoolSha256:string};entries:Entry[];requiresCommittedEvent:true;modelCallsPerformed:false;factsChanged:false;targetApplicabilityClaimed:false;existingHistoryReset:false}
const fail=(suffix:string):never=>{throw new MaintenanceError(`source_candidate_${suffix}`)}
function parse(value:unknown):Input{
  const result=inputSchema.safeParse(value);if(!result.success)return fail('request_invalid')
  const urls=result.data.urls.map(entry=>{
    let url:URL;try{url=new URL(entry.url);url.hash='';assertSafeSourceUrl(url,[url.hostname])}catch{return fail('url_invalid')}
    if([...url.searchParams.keys()].some(k=>/token|session|password|secret|authorization/iu.test(k)))return fail('credential_url_rejected')
    if(new Set(entry.categories).size!==entry.categories.length)return fail('request_invalid')
    return{url:url.href,categories:[...entry.categories].sort()}
  }).sort((a,b)=>a.url.localeCompare(b.url))
  if(new Set(urls.map(e=>e.url)).size!==urls.length)return fail('duplicate_url')
  return{...result.data,urls}
}
const eventId=(operationId:string)=>`source-candidates:${operationId}`
async function registered(env:MaintenanceEnv,input:Input,requestSha256:string){
  const row=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(eventId(input.operationId)).first<{kind:string;details_json:string}>()
  if(!row)return null
  let ref:Record<string,unknown>|null;try{ref=record(JSON.parse(row.details_json))}catch{return fail('registration_invalid')}
  if(row.kind!==KIND||ref?.requestSha256!==requestSha256||!HASH.test(String(ref.sha256))||ref.objectKey!==`${PREFIX}registrations/${ref.sha256}.json`||canonical(ref)!==row.details_json)return fail('registration_conflict')
  const saved=await env.SNAPSHOTS_BUCKET.get(String(ref.objectKey));if(!saved||saved.size!==undefined&&saved.size>65536)return fail('receipt_unavailable')
  const text=await saved.text();if(new TextEncoder().encode(text).length>65536||await digest(text)!==ref.sha256)return fail('receipt_checksum_invalid')
  let receipt:Receipt;try{receipt=JSON.parse(text)}catch{return fail('receipt_invalid')}
  if(receipt.format!=='studyinchina.official-source-candidate-proposal'||receipt.version!==1||receipt.operationId!==input.operationId||receipt.requestSha256!==requestSha256||canonical(receipt)!==text||receipt.requiresCommittedEvent!==true||receipt.modelCallsPerformed!==false||receipt.factsChanged!==false||receipt.targetApplicabilityClaimed!==false||receipt.existingHistoryReset!==false)return fail('receipt_invalid')
  return{ok:true,registered:true,reused:true,operationId:input.operationId,requestSha256,receiptKey:String(ref.objectKey),receiptSha256:String(ref.sha256),eventId:eventId(input.operationId),entries:receipt.entries,modelCallsPerformed:false,factsChanged:false,targetApplicabilityClaimed:false,existingHistoryReset:false}
}

/** Register acquisition candidates only. No fetch of a submitted URL, lineage,
 * target applicability, model call, queue send or old-row mutation occurs here. */
export async function registerOfficialSourceCandidates(env:MaintenanceEnv,value:unknown,fetcher:typeof fetch=fetch,now=Date.now()){
  if(env.MODEL_STATE_MIGRATION_ROLE==='source')throw new MaintenanceError('account_migration_frozen')
  const input=parse(value),requestSha256=await digest(canonical(input))
  if(env.MAINTENANCE_ENABLED!=='true')return fail('deployment_disabled')
  if(!(await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,now)).allowed)return fail('budget_wait')
  const prior=await registered(env,input,requestSha256);if(prior)return prior
  const cfg=await control(env)
  if(!cfg||!cfg.enabled||!cfg.seed_complete||!cfg.targets_complete||cfg.revision!==input.expectedRevision||cfg.scope_sha256!==input.scopeRegistrySha256||cfg.input_catalog_sha256!==input.inputCatalogSha256
    ||cfg.scope_sha256!==EXISTING_SCHOOLS_V2_SHA256||env.SCOPE_REGISTRY_SHA256!==cfg.scope_sha256||env.SCOPE_SCHOOL_COUNT!=='295')return fail('current_control_required')
  const canary=JSON.parse(cfg.canary_json)as string[];if(canary.length&&!canary.includes(input.universityId))return fail('outside_canary')
  if(!(await nativeReconciliationGate(env)).ready)return fail('native_reconciliation_required')
  const authority=await readCandidateAuthority(env,cfg,input.universityId,fetcher,now),entries:Entry[]=[]
  for(const entry of input.urls){
    const url=new URL(entry.url)
    if(officialHostFamily(url.hostname)!==authority.officialFamily||!authority.approvedHosts.includes(url.hostname))return fail('school_host_not_approved')
    assertSafeSourceUrl(url,authority.approvedHosts)
    const sourceId=await digest(url.href),existing=await env.PIPELINE_DB.prepare('SELECT url FROM maintenance_sources WHERE source_id=?').bind(sourceId).first<{url:string}>()
    if(existing&&existing.url!==url.href)return fail('existing_source_conflict')
    if(!existing&&await env.PIPELINE_DB.prepare('SELECT 1 found FROM maintenance_model_attempts WHERE source_id=? UNION ALL SELECT 1 FROM maintenance_jobs WHERE source_id=? UNION ALL SELECT 1 FROM maintenance_observations WHERE source_id=? LIMIT 1').bind(sourceId,sourceId,sourceId).first())return fail('orphan_history_requires_review')
    entries.push({url:url.href,sourceId,categories:entry.categories,disposition:existing?'reused':'created',captureJobId:existing?null:await digest(`capture:${sourceId}:${nowIso(now)}`)})
  }
  const receipt:Receipt={format:'studyinchina.official-source-candidate-proposal',version:1,operationId:input.operationId,requestSha256,observedAt:nowIso(now),expectedRevision:cfg.revision,scopeRegistrySha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,universityId:input.universityId,
    authority:{objectKey:authority.manifestKey,sha256:authority.manifestSha256,publicationBatchId:authority.publication.batchId,acknowledgementSha256:authority.publication.acknowledgementSha256,sourceCommit:authority.publication.sourceCommit,officialUrl:authority.university.officialUrl,officialFamily:authority.officialFamily,approvedHosts:authority.approvedHosts,seedSchoolSha256:await digest(authority.seedJson)},entries,requiresCommittedEvent:true,modelCallsPerformed:false,factsChanged:false,targetApplicabilityClaimed:false,existingHistoryReset:false}
  const text=canonical(receipt),sha256=await digest(text),objectKey=`${PREFIX}registrations/${sha256}.json`
  await putCandidateImmutable(env,objectKey,text)
  if(!(await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,Date.now())).allowed)return fail('budget_wait')
  const created=entries.filter(e=>e.disposition==='created'),guard=crypto.randomUUID(),ref=canonical({objectKey,sha256,requestSha256}),iso=nowIso(now)
  try{
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN
        EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND revision=? AND enabled=1 AND seed_complete=1 AND targets_complete=1 AND canary_json=?)
        AND EXISTS(SELECT 1 FROM maintenance_schools WHERE university_id=? AND scope_sha256=? AND name_json=? AND seed_json=?)
        AND EXISTS(SELECT 1 FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id WHERE s.source_id=? AND s.url=? AND s.enabled=1 AND x.university_id=?)
        AND EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=? AND status='published' AND acknowledgement_sha256=? AND acknowledgement_json=?)
        AND (SELECT COUNT(*) FROM maintenance_sources)+?<=20000
        AND NOT EXISTS(SELECT 1 FROM json_each(?) p LEFT JOIN maintenance_sources s ON s.source_id=json_extract(p.value,'$.sourceId')
          WHERE (json_extract(p.value,'$.disposition')='created' AND (s.source_id IS NOT NULL OR EXISTS(SELECT 1 FROM maintenance_jobs WHERE job_id=json_extract(p.value,'$.captureJobId') OR source_id=json_extract(p.value,'$.sourceId')) OR EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE source_id=json_extract(p.value,'$.sourceId')) OR EXISTS(SELECT 1 FROM maintenance_observations WHERE source_id=json_extract(p.value,'$.sourceId'))))
             OR (json_extract(p.value,'$.disposition')='reused' AND (s.source_id IS NULL OR s.url<>json_extract(p.value,'$.url'))))
        AND NOT EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=?) THEN 1 ELSE 0 END))`)
        .bind(guard,cfg.scope_sha256,cfg.input_catalog_sha256,cfg.seed_sha256,cfg.legacy_guard_sha256,cfg.revision,cfg.canary_json,input.universityId,cfg.scope_sha256,authority.schoolNameJson,authority.seedJson,authority.anchorSourceId,authority.anchorUrl,input.universityId,authority.publication.batchId,authority.publication.acknowledgementSha256,authority.publication.acknowledgementJson,created.length,canonical(entries),eventId(input.operationId)),
      ...created.flatMap(entry=>[
        env.PIPELINE_DB.prepare('INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at,discovery_depth) VALUES(?,?,?,?,?,1,168,?,0)').bind(entry.sourceId,entry.url,canonical([new URL(entry.url).hostname]),entry.categories[0],canonical(entry.categories),iso),
        env.PIPELINE_DB.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').bind(entry.sourceId,input.universityId),
        env.PIPELINE_DB.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,'capture','queued',10,?,?,?)").bind(entry.captureJobId,entry.sourceId,iso,iso,iso),
      ]),
      env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(eventId(input.operationId),KIND,iso,ref),
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
    ])
  }catch{
    // A lost reply may have committed. Only the exact immutable event proves
    // it; never blindly resend or turn an existing source into a fresh capture.
    const committed=await registered(env,input,requestSha256);if(committed)return committed
    return fail('commit_conflict')
  }
  const saved=await registered(env,input,requestSha256);if(!saved)return fail('commit_unconfirmed')
  return{...saved,reused:false}
}
