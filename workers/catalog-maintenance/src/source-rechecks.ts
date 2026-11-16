import { z } from 'zod'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import { readBackgroundBudgetGate } from '../../shared/background-budget'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { control } from './repository'
import type { MaintenanceEnv,SourceRow } from './types'
import { MaintenanceError } from './types'
import { canonical,digest,HASH,nowIso,record } from './util'
import { putCandidateImmutable } from './source-candidate-authority'

const PREFIX='maintenance/source-rechecks/',KIND='official_source_rechecks_registered'
const hash=z.string().regex(/^[a-f0-9]{64}$/u),nullable=z.string().nullable()
const jobSchema=z.object({job_id:z.string(),source_id:hash,stage:z.literal('capture'),status:z.literal('held'),priority:z.number().int(),due_at:z.string(),created_at:z.string(),updated_at:z.string(),attempt:z.number().int().min(1),lease_token:z.null(),lease_until:z.null(),snapshot_sha256:nullable,snapshot_key:nullable,error_code:z.string(),enqueued_at:nullable,target_ids_json:nullable}).strict()
const sourceColumns=['source_id','url','allowed_hosts_json','category','categories_json','enabled','interval_hours','due_at','last_attempt_at','last_success_at','raw_sha256','canonical_sha256','snapshot_key','etag','failures','error_code','discovery_depth']as const
const jobColumns=Object.keys(jobSchema.shape)
const retryableHeldCodes=new Set(['execution_failed','source_fetch_failed','source_read_failed','robots_fetch_failed','robots_read_failed','source_http_429','source_http_500','source_http_502','source_http_503','source_http_504'])
const schema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,80}$/u),expectedRevision:z.number().int().nonnegative(),scopeRegistrySha256:hash,inputCatalogSha256:hash,sources:z.array(z.object({sourceId:hash,originalJobId:hash,originalJobSha256:hash}).strict()).min(1).max(5)}).strict()
type Input=z.infer<typeof schema>
type Entry={sourceId:string;originalJobId:string;originalJobSha256:string;captureJobId:string;sourceSha256:string;schoolProofs:Array<{universityId:string;seedSha256:string}>}
type Proof={entry:Entry;source:Record<string,unknown>;job:z.infer<typeof jobSchema>;schools:Array<{university_id:string;scope_sha256:string;name_json:string;seed_json:string}>}
const fail=(code:string):never=>{throw new MaintenanceError(`source_recheck_${code}`)}

/** Hash all actual job columns, including enqueued_at. Callers must SELECT *;
 * unknown columns/schemas are held instead of silently omitted from the proof. */
export async function sourceRecheckOriginalJobSha256(value:unknown):Promise<string>{
  const parsed=jobSchema.safeParse(value);if(!parsed.success)return fail('original_job_invalid')
  return digest(canonical(parsed.data))
}
async function prior(env:MaintenanceEnv,input:Input,requestSha256:string){
  const row=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(`source-rechecks:${input.operationId}`).first<{kind:string;details_json:string}>()
  if(!row)return null
  let ref:Record<string,unknown>|null;try{ref=record(JSON.parse(row.details_json))}catch{return fail('registration_invalid')}
  if(row.kind!==KIND||ref?.requestSha256!==requestSha256||!HASH.test(String(ref.sha256))||ref.objectKey!==`${PREFIX}${ref.sha256}.json`||canonical(ref)!==row.details_json)return fail('registration_conflict')
  const object=await env.SNAPSHOTS_BUCKET.get(String(ref.objectKey));if(!object||object.size!==undefined&&object.size>65536)return fail('receipt_unavailable')
  const bytes=await object.text();if(new TextEncoder().encode(bytes).length>65536||await digest(bytes)!==ref.sha256)return fail('receipt_invalid')
  let receipt:Record<string,unknown>|null;try{receipt=record(JSON.parse(bytes))}catch{return fail('receipt_invalid')}
  if(!receipt||canonical(receipt)!==bytes||receipt.format!=='studyinchina.official-source-rechecks'||receipt.version!==1||receipt.operationId!==input.operationId||receipt.requestSha256!==requestSha256||receipt.modelCallsPerformed!==false||receipt.existingHistoryReset!==false||receipt.firstInspectionClaimed!==false||!Array.isArray(receipt.entries)||receipt.entries.length!==input.sources.length)return fail('receipt_invalid')
  return{ok:true,registered:true,reused:true,operationId:input.operationId,requestSha256,receiptKey:String(ref.objectKey),receiptSha256:String(ref.sha256),entries:receipt.entries as Entry[],modelCallsPerformed:false,factsChanged:false,existingHistoryReset:false,firstInspectionClaimed:false}
}
function deploymentReady(env:MaintenanceEnv){
  if(env.MODEL_STATE_MIGRATION_ROLE==='source')throw new MaintenanceError('account_migration_frozen')
  if(env.MAINTENANCE_ENABLED!=='true')return fail('deployment_disabled')
}

/** Authenticated caller-only acquisition repair. Creates independent capture
 * rows; no old job/source mutation, queue send, model, acceptance or inspection. */
export async function registerSourceRechecks(env:MaintenanceEnv,value:unknown,now=Date.now()){
  deploymentReady(env)
  const result=schema.safeParse(value);if(!result.success)return fail('request_invalid')
  const input={...result.data,sources:[...result.data.sources].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))}
  if(new Set(input.sources.map(s=>s.sourceId)).size!==input.sources.length)return fail('duplicate_source')
  const requestSha256=await digest(canonical(input))
  if(!(await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,now)).allowed)return fail('budget_wait')
  const saved=await prior(env,input,requestSha256);if(saved)return saved
  const cfg=await control(env)
  if(!cfg||!cfg.enabled||!cfg.seed_complete||!cfg.targets_complete||cfg.revision!==input.expectedRevision||cfg.scope_sha256!==input.scopeRegistrySha256||cfg.input_catalog_sha256!==input.inputCatalogSha256||cfg.scope_sha256!==env.SCOPE_REGISTRY_SHA256)return fail('current_control_required')
  let canary:string[];try{canary=JSON.parse(cfg.canary_json);if(!Array.isArray(canary)||canary.some(id=>typeof id!=='string')||new Set(canary).size!==canary.length)throw Error()}catch{return fail('current_control_required')}
  if(!(await nativeReconciliationGate(env)).ready)return fail('native_reconciliation_required')
  const proofs:Proof[]=[]
  for(const requested of input.sources){
    const row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').bind(requested.sourceId).first<SourceRow>()
    if(!row||row.enabled!==1||Object.keys(row).sort().join(',')!==[...sourceColumns].sort().join(','))return fail('source_unavailable')
    let hosts:string[];try{hosts=JSON.parse(row.allowed_hosts_json);assertSafeSourceUrl(row.url,hosts);if(await digest(row.url)!==row.source_id)throw Error()}catch{return fail('source_authority_invalid')}
    const schools=((await env.PIPELINE_DB.prepare('SELECT u.university_id,u.scope_sha256,u.name_json,u.seed_json FROM maintenance_schools u JOIN maintenance_source_schools x ON x.university_id=u.university_id WHERE x.source_id=? ORDER BY u.university_id').bind(row.source_id).all<Proof['schools'][number]>()).results??[]).map(s=>({...s}))
    if(!schools.length||schools.some(s=>s.scope_sha256!==cfg.scope_sha256))return fail('source_scope_invalid')
    let authorized=false
    for(const school of schools){
      if(canary.length&&!canary.includes(school.university_id))continue
      let seed:Record<string,unknown>|null;try{seed=record(JSON.parse(school.seed_json))}catch{return fail('seed_invalid')}
      if(seed?.universityId!==school.university_id||!Array.isArray(seed.sourceSeeds))return fail('seed_invalid')
      authorized ||= seed.sourceSeeds.some(item=>{const s=record(item),allowed=s?.allowedHosts;return s?.enabled===true&&s.url===row.url&&Array.isArray(allowed)&&hosts.every(host=>allowed.includes(host))})
    }
    if(!authorized)return fail('current_canary_official_seed_required')
    const original=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').bind(requested.originalJobId).first<unknown>(),parsed=jobSchema.safeParse(original)
    if(!parsed.success||parsed.data.source_id!==row.source_id||!retryableHeldCodes.has(parsed.data.error_code)||await sourceRecheckOriginalJobSha256(original)!==requested.originalJobSha256)return fail('original_job_proof_invalid')
    if(row.failures<1||row.error_code!==parsed.data.error_code||!row.last_attempt_at||!Number.isFinite(Date.parse(row.last_attempt_at))||!Number.isFinite(Date.parse(parsed.data.updated_at))||Date.parse(row.last_attempt_at)<Date.parse(parsed.data.updated_at)||Date.parse(row.last_attempt_at)>now)return fail('current_failure_proof_required')
    if(await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_jobs WHERE source_id=? AND stage='capture' AND job_id<>? AND (created_at>? OR updated_at>?) LIMIT 1").bind(row.source_id,parsed.data.job_id,parsed.data.created_at,parsed.data.updated_at).first())return fail('newer_capture_requires_review')
    if(await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_jobs WHERE source_id=? AND stage='capture' AND status IN('queued','running','retry') LIMIT 1").bind(row.source_id).first())return fail('capture_already_active')
    const entry:Entry={sourceId:row.source_id,originalJobId:requested.originalJobId,originalJobSha256:requested.originalJobSha256,captureJobId:await digest(`source-recheck-v1:${input.operationId}:${row.source_id}:${requested.originalJobSha256}`),sourceSha256:await digest(canonical({...row})),schoolProofs:await Promise.all(schools.map(async school=>({universityId:school.university_id,seedSha256:await digest(school.seed_json)})))}
    proofs.push({entry,source:{...row},job:parsed.data,schools})
  }
  const receipt={format:'studyinchina.official-source-rechecks',version:1,operationId:input.operationId,requestSha256,observedAt:nowIso(now),expectedRevision:cfg.revision,scopeRegistrySha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,entries:proofs.map(p=>p.entry),requiresCommittedEvent:true,modelCallsPerformed:false,factsChanged:false,existingHistoryReset:false,firstInspectionClaimed:false}
  const bytes=canonical(receipt),sha256=await digest(bytes),objectKey=`${PREFIX}${sha256}.json`
  await putCandidateImmutable(env,objectKey,bytes)
  deploymentReady(env)
  if(!(await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,Date.now())).allowed)return fail('budget_wait')
  if(!(await nativeReconciliationGate(env)).ready)return fail('native_reconciliation_required')
  const guard=crypto.randomUUID(),iso=nowIso(now),eventId=`source-rechecks:${input.operationId}`
  try{
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN
        EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND revision=? AND enabled=1 AND seed_complete=1 AND targets_complete=1 AND canary_json=?)
        AND NOT EXISTS(SELECT 1 FROM json_each(?) p WHERE
          -- Fixed-column arrays preserve every NULL/value/type while avoiding
          -- a long AND expression that exceeds workerd D1's depth-100 limit.
          NOT EXISTS(SELECT 1 FROM maintenance_sources s WHERE json_array(${sourceColumns.map(column=>`s.${column}`).join(',')})=json_array(${sourceColumns.map(column=>`json_extract(p.value,'$.source.${column}')`).join(',')}))
          OR NOT EXISTS(SELECT 1 FROM maintenance_jobs j WHERE json_array(${jobColumns.map(column=>`j.${column}`).join(',')})=json_array(${jobColumns.map(column=>`json_extract(p.value,'$.job.${column}')`).join(',')}))
          OR EXISTS(SELECT 1 FROM maintenance_jobs WHERE source_id=json_extract(p.value,'$.entry.sourceId') AND stage='capture' AND job_id<>json_extract(p.value,'$.job.job_id') AND (created_at>json_extract(p.value,'$.job.created_at') OR updated_at>json_extract(p.value,'$.job.updated_at')))
          OR EXISTS(SELECT 1 FROM maintenance_jobs WHERE source_id=json_extract(p.value,'$.entry.sourceId') AND stage='capture' AND status IN('queued','running','retry'))
          OR (SELECT COUNT(*) FROM maintenance_source_schools WHERE source_id=json_extract(p.value,'$.entry.sourceId'))<>json_array_length(json_extract(p.value,'$.schools'))
          OR EXISTS(SELECT 1 FROM json_each(p.value,'$.schools') expected WHERE NOT EXISTS(SELECT 1 FROM maintenance_schools u JOIN maintenance_source_schools x ON x.university_id=u.university_id WHERE x.source_id=json_extract(p.value,'$.entry.sourceId') AND u.university_id=json_extract(expected.value,'$.university_id') AND u.scope_sha256=json_extract(expected.value,'$.scope_sha256') AND u.name_json=json_extract(expected.value,'$.name_json') AND u.seed_json=json_extract(expected.value,'$.seed_json'))))
        AND NOT EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=?) THEN 1 ELSE 0 END))`).bind(guard,cfg.scope_sha256,cfg.input_catalog_sha256,cfg.seed_sha256,cfg.legacy_guard_sha256,cfg.revision,cfg.canary_json,canonical(proofs),eventId),
      ...proofs.map(({entry})=>env.PIPELINE_DB.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,'capture','queued',10,?,?,?)").bind(entry.captureJobId,entry.sourceId,iso,iso,iso)),
      env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(eventId,KIND,iso,canonical({objectKey,sha256,requestSha256})),
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
    ])
  }catch{const committed=await prior(env,input,requestSha256);if(committed)return committed;return fail('commit_conflict')}
  const committed=await prior(env,input,requestSha256);if(!committed)return fail('commit_unconfirmed')
  return{...committed,reused:false}
}
