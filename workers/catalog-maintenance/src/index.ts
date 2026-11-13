import { ModelAdmission } from './admission'
import { holdBudgetQueueMessage } from './budget-queue-hold'
import { readPlanQuotaReport } from './quota-report'
import { budgetStatus, configureBudget, checkBudget, resumeBudget } from './budget'
import { readBackgroundBudgetGate, BACKGROUND_BUDGET_RETRY_SECONDS, BUDGET_POLICY_KEY, BUDGET_OBSERVATION_KEY } from '../../shared/background-budget'
import { submitCoverageSnapshot } from './coverage'
import { registerScopeUpgradeRequest, processScopeUpgrade, scopeUpgradeStatus } from './scope-upgrade'
import { captureSource } from './capture'
import { extractIdentities } from './extraction'
import { extractScholarshipIdentities } from './scholarship-identities'
import { maintainFields } from './field-updates'
import { discoverAdmissionCycles } from './cycle-discovery'
import { runPartitionedDocument } from './document-partitions'
import { processDiscoveryFrontier } from './discovery'
import { loadSnapshot } from './capture'
import { persistProposals } from './proposals'
import { evaluateRollout,rolloutStatus } from './rollout'
import { acceptDocumentDerivative,listPendingDocuments } from './documents'
import { listSchoolProgress,submitSchoolReconciliation } from './school-progress'
import { acknowledge, prepareExport, readExport } from './exports'
import { readMaintenanceControl, reconcileMaintenanceHead } from './head-reconciliation'
import { prepareReconciliationTargets, registerReconciliationTargets } from './reconciliation-targets'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { claimJob, continueSeed,continueTargetRefresh,control, event, finishJob, recordTargets, refreshTargets, seed, setControls, source, sourceSchools } from './repository'
import type { JobRow, MaintenanceBatch, MaintenanceEnv, MaintenanceMessage } from './types'
import { MaintenanceError } from './types'
import { preparePendingBootstrap,registerBootstrapRequest,resumeBootstrapSeed,runCloudTick,runtimeStatus,quotaWait,rememberQuotaWait,recheckBackend } from './runtime'
import { isDailyD1QuotaError } from './backend-errors'
import { after, authorized, HASH, json, nowIso, requestJson } from './util'

export { ModelAdmission }
async function finishDocumentPartition(env:MaintenanceEnv,job:JobRow,progress:Awaited<ReturnType<typeof runPartitionedDocument>>){
  if(progress.pending){
    // A successful bounded continuation is not a failed model attempt.
    await env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET attempt=MAX(0,attempt-1) WHERE job_id=? AND status='running' AND lease_token=?").bind(job.job_id,job.lease_token).run()
    await finishJob(env,job,'retry','document_partition_pending',5)
    await env.MAINTENANCE_QUEUE.send({version:1,jobId:job.job_id},{delaySeconds:5})
  }else{
    const unfinished='unfinishedSections'in progress&&Number(progress.unfinishedSections)>0
    await finishJob(env,job,unfinished?'held':progress.ready?'done':progress.held?'held':'done',unfinished?'partition_capacity_requires_review':progress.held?'some_partition_scopes_require_review':null)
  }
  await event(env,'document_partition_progress',{jobId:job.job_id,...progress})
}
export async function processMessage(env:MaintenanceEnv,message:MaintenanceMessage):Promise<void> {
  if(message?.version===1&&message.scopeUpgradeSha256&&HASH.test(message.scopeUpgradeSha256)){await processScopeUpgrade(env,message.scopeUpgradeSha256);return}
  if(message?.version===1&&message.reconciliationTargetsUpload){await prepareReconciliationTargets(env,message.reconciliationTargetsUpload);return}
  if(message?.version===1&&message.bootstrapUploadSha256&&HASH.test(message.bootstrapUploadSha256)){await preparePendingBootstrap(env,message.bootstrapUploadSha256);return}
  if(message?.version===1&&message.bootstrapSeedSha256&&HASH.test(message.bootstrapSeedSha256)){await resumeBootstrapSeed(env,message.bootstrapSeedSha256);return}
  if(message?.version===1&&message.discoveryManifestSha256&&HASH.test(message.discoveryManifestSha256)&&env.NATIVE_HEAD_RECONCILIATION_REQUIRED!=='true'){await processDiscoveryFrontier(env,message.discoveryManifestSha256,message.discoveryOffset??0);return}
  if(message?.version===1&&message.seedSha256&&HASH.test(message.seedSha256)){await continueSeed(env,message.seedSha256);return}
  if(message?.version===1&&message.targetRefreshSha256&&HASH.test(message.targetRefreshSha256)){await continueTargetRefresh(env,message.targetRefreshSha256);return}
  if(message?.version!==1||!HASH.test(message.jobId))throw new MaintenanceError('invalid_queue_message')
  const cfg=await control(env)
  if(env.MAINTENANCE_ENABLED!=='true'||!cfg?.enabled||!cfg.seed_complete)return
  if(!(await nativeReconciliationGate(env)).ready)return
  if(message.discoveryManifestSha256&&HASH.test(message.discoveryManifestSha256)){await processDiscoveryFrontier(env,message.discoveryManifestSha256,message.discoveryOffset??0);return}
  const pending=await env.PIPELINE_DB.prepare('SELECT source_id,stage FROM maintenance_jobs WHERE job_id=?').bind(message.jobId).first<{source_id:string;stage:string}>()
  if(!pending||pending.stage!=='capture'&&!cfg.models_enabled||pending.stage==='maintain'&&!cfg.targets_complete)return
  const canary=JSON.parse(cfg.canary_json)as string[],schools=await sourceSchools(env,pending.source_id)
  if(!schools.length||canary.length&&!schools.some(s=>canary.includes(s.university_id)))return
  const job=await claimJob(env,message.jobId)
  if(!job)return
  try {
    const row=await source(env,job.source_id)
    if(!row?.enabled)throw new MaintenanceError('source_disabled')
    if(job.stage==='capture') {
      const outcome=await captureSource(env,job,row)
      await finishJob(env,job,outcome==='rich-document'?'held':'done',outcome==='rich-document'?'rich_document_requires_extraction':null)
      await event(env,'source_observed',{jobId:job.job_id,sourceId:job.source_id,outcome})
    } else if(job.stage==='maintain') {
      if(!job.snapshot_key||!job.snapshot_sha256||!job.target_ids_json)throw new MaintenanceError('maintenance_job_scope_missing')
      const snapshot=await loadSnapshot(env,job.snapshot_key)
      const latest=await env.PIPELINE_DB.prepare('SELECT checked_at FROM maintenance_observations WHERE source_id=? AND raw_sha256=? ORDER BY checked_at DESC LIMIT 1').bind(row.source_id,snapshot.rawSha256).first<{checked_at:string}>()
      if(latest)snapshot.checkedAt=latest.checked_at
      const scope=JSON.parse(job.target_ids_json)as Array<{id:string;sha256:string}>|{kind:string;targets:Array<{id:string;sha256:string}>}
      const cyclePurpose=!Array.isArray(scope)&&scope.kind==='cycle-discovery',pins=Array.isArray(scope)?scope:scope.targets
      if(!Array.isArray(pins))throw new MaintenanceError('maintenance_job_scope_invalid')
      const targets=(await recordTargets(env,row.source_id)).filter(target=>(!canary.length||canary.includes(target.universityId))&&pins.some(pin=>pin.id===`${target.entityType}:${target.recordId}`&&pin.sha256===target.recordScopeSha256))
      if(!targets.length)throw new MaintenanceError('maintenance_target_scope_changed')
      const partition=await runPartitionedDocument(env,job,row,snapshot,cyclePurpose?'cycles':'fields',targets,async(context,selected)=>
        cyclePurpose?discoverAdmissionCycles(env,job,row,context.snapshot,selected.filter(target=>target.entityType==='program'),undefined,context):maintainFields(env,job,row,context.snapshot,selected,undefined,context))
      if(partition.handled){await finishDocumentPartition(env,job,partition);return}
      const result=cyclePurpose?await discoverAdmissionCycles(env,job,row,snapshot,targets.filter(target=>target.entityType==='program')):await maintainFields(env,job,row,snapshot,targets)
      await persistProposals(env,result.proposals,row.source_id,snapshot.rawSha256)
      await finishJob(env,job,result.proposals.length?'done':result.held.length?'held':'done',result.held.length?'some_field_scopes_require_review':null)
      await event(env,cyclePurpose?'cycles_discovered':'fields_checked',{jobId:job.job_id,ready:result.proposals.filter(p=>p.status==='ready').length,held:result.held})
    } else {
      if(job.snapshot_key&&job.snapshot_sha256){
        const snapshot=await loadSnapshot(env,job.snapshot_key)
        const partition=await runPartitionedDocument(env,job,row,snapshot,job.stage==='award'?'scholarship':'program',[],async context=>{
          const extracted=job.stage==='award'?await extractScholarshipIdentities(env,job,row,undefined,{partition:context,persist:false}):await extractIdentities(env,job,row,{partition:context,persist:false})
          return{proposals:extracted.proposals??[],held:extracted.held?[{recordId:job.job_id,reason:`partition_identity_scopes_held:${extracted.held}`}]:[],...(extracted.partitionCapacityLimited?{capacityLimited:true}:{})}
        })
        if(partition.handled){await finishDocumentPartition(env,job,partition);return}
      }
      const result=job.stage==='award'?await extractScholarshipIdentities(env,job,row):await extractIdentities(env,job,row)
      await finishJob(env,job,'done')
      await event(env,'identities_extracted',{jobId:job.job_id,...result})
    }
  } catch(error) {
    const code=error instanceof MaintenanceError?error.code:'execution_failed'
    const retry=error instanceof MaintenanceError?error.retryAfter:null
    const unknown=/outcome_unknown|prior_model_outcome|lease_expired/.test(code)
    const admissionWait=/^(?:fetch_capacity|model_capacity|model_http_429|model_waiting_control|model_not_sent|quota_|budget_|maintenance_quota_reserved)/.test(code),willRetry=retry!==null&&(admissionWait||job.attempt<4)
    if(admissionWait)await env.PIPELINE_DB.prepare('UPDATE maintenance_jobs SET attempt=MAX(0,attempt-1) WHERE job_id=? AND lease_token=?').bind(job.job_id,job.lease_token).run()
    await finishJob(env,job,unknown?'unknown':willRetry?'retry':'held',code,retry??0)
    if(job.stage==='capture'&&!admissionWait)await env.PIPELINE_DB.batch([env.PIPELINE_DB.prepare('UPDATE maintenance_sources SET failures=failures+1,last_attempt_at=?,error_code=?,due_at=? WHERE source_id=?').bind(nowIso(),code,after((retry??(code.startsWith('robots_')?14*86400:86400))*1000),job.source_id),env.PIPELINE_DB.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id IN(SELECT university_id FROM maintenance_source_schools WHERE source_id=?)').bind(nowIso(),job.source_id)])
    if(willRetry&&retry!==null&&retry<=900)await env.MAINTENANCE_QUEUE.send({version:1,jobId:job.job_id},{delaySeconds:Math.max(5,retry)})
    await event(env,unknown?'job_unknown':'job_held_or_retry',{jobId:job.job_id,stage:job.stage,code})
  }
}
export async function handleQueue(batch:MaintenanceBatch,env:MaintenanceEnv):Promise<void> {
  const budget=await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET)
  if(!budget.allowed){
    for(const message of batch.messages){
      try{if(await holdBudgetQueueMessage(env,message.body)){message.ack();continue}}catch{/* Retain queue retry until the R2 marker is confirmed. */}
      message.retry({delaySeconds:BACKGROUND_BUDGET_RETRY_SECONDS})
    }
    return
  }
  await Promise.all(batch.messages.map(async message=>{try{
    const waiting=await quotaWait(env)
    if(waiting){message.retry({delaySeconds:Math.max(60,Math.min(43200,Math.ceil((Date.parse(waiting.retryAt)-Date.now())/1000)))});return}
    await processMessage(env,message.body);message.ack()
  }catch(error){
    if(isDailyD1QuotaError(error)){const waiting=await rememberQuotaWait(env);message.retry({delaySeconds:Math.max(60,Math.min(43200,Math.ceil((Date.parse(waiting.retryAt)-Date.now())/1000)))})}
    else message.retry({delaySeconds:60})
  }}))
}
export async function handleFetch(request:Request,env:MaintenanceEnv):Promise<Response> {
  const url=new URL(request.url)
  if(url.pathname==='/health'&&request.method==='GET')return json({ok:true,service:'studyinchina-catalog-maintenance',version:'1.0.0',publicationPerformed:false})
  if(!authorized(request,env))return json({ok:false,error:'unauthorized'},401)
  try {
    if(url.pathname==='/budget'&&request.method==='GET')return json(await budgetStatus(env))
    if(url.pathname==='/budget'&&request.method==='POST')return json(await configureBudget(env,await requestJson(request,2048)))
    if(url.pathname==='/budget/check'&&request.method==='POST')return json(await checkBudget(env))
    if(url.pathname==='/budget/resume'&&request.method==='POST')return json(await resumeBudget(env,await requestJson(request,1024)))
    if(url.pathname==='/quota'&&request.method==='GET')return json(await readPlanQuotaReport(env))
    if(url.pathname==='/backend/recheck'&&request.method==='POST')return json(await recheckBackend(env,await requestJson(request,1024)))
    if(request.method==='POST'&&['/seed','/bootstrap','/scope-upgrades','/coverage','/targets','/documents','/reconciliations','/exports','/rollout','/head-reconcile-targets'].includes(url.pathname)){
      const budget=await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET)
      if(!budget.allowed)return json({ok:false,error:'budget_wait',code:budget.code},503)
    }
    if(url.pathname==='/seed'&&request.method==='POST')return json(await seed(env,await requestJson(request,8*1024*1024),Date.now(),true))
    if(url.pathname==='/bootstrap'&&request.method==='POST')return json(await registerBootstrapRequest(env,request))
    if(url.pathname==='/scope-upgrades'&&request.method==='POST')return json(await registerScopeUpgradeRequest(env,request))
    if(url.pathname==='/scope-upgrades'&&request.method==='GET')return json(await scopeUpgradeStatus(env,url.searchParams.get('sha256')??''))
    if(url.pathname==='/coverage'&&request.method==='POST')return json(await submitCoverageSnapshot(env,await requestJson(request,2*1024*1024)))
    if(url.pathname==='/controls'&&request.method==='POST')return json(await setControls(env,await requestJson(request,32768)))
    if(url.pathname==='/control'&&request.method==='GET')return json(await readMaintenanceControl(env))
    if(url.pathname==='/head-reconcile'&&request.method==='POST')return json(await reconcileMaintenanceHead(env,await requestJson(request,4096)))
    if(url.pathname==='/head-reconcile-targets'&&request.method==='POST')return json(await registerReconciliationTargets(env,request))
    if(url.pathname==='/rollout'&&request.method==='GET')return json(await rolloutStatus(env))
    if(url.pathname==='/rollout'&&request.method==='POST')return json(await evaluateRollout(env,await requestJson(request,4096)))
    if(url.pathname==='/targets'&&request.method==='POST')return json(await refreshTargets(env,await requestJson(request,8*1024*1024),true))
    if(url.pathname==='/documents'&&request.method==='GET')return json(await listPendingDocuments(env))
    if(url.pathname==='/documents'&&request.method==='POST')return json(await acceptDocumentDerivative(env,await requestJson(request,3*1024*1024)))
    if(url.pathname==='/status'&&request.method==='GET')return json(await runtimeStatus(env))
    if(url.pathname==='/schools'&&request.method==='GET')return json(await listSchoolProgress(env))
    if(url.pathname==='/reconciliations'&&request.method==='POST')return json(await submitSchoolReconciliation(env,await requestJson(request,256*1024)))
    if(url.pathname==='/publications'&&request.method==='GET') {
      const rows=(await env.PIPELINE_DB.prepare("SELECT * FROM maintenance_exports WHERE status='applied' ORDER BY created_at LIMIT 50").all<{batch_id:string;input_catalog_sha256:string;scope_sha256:string;created_at:string;acknowledgement_json:string}>()).results??[]
      return json({publications:rows.map(row=>({batchId:row.batch_id,inputCatalogSha256:row.input_catalog_sha256,scopeRegistrySha256:row.scope_sha256,createdAt:row.created_at,status:'applied',acknowledgement:JSON.parse(row.acknowledgement_json)}))})
    }
    if(url.pathname==='/tick'&&request.method==='POST')return json(await runCloudTick(env))
    if(url.pathname==='/proposals'&&request.method==='GET') {
      const rows=(await env.PIPELINE_DB.prepare('SELECT proposal_id,status,proposal_json FROM maintenance_proposals ORDER BY created_at DESC LIMIT 100').all()).results??[]
      return json({format:'studyinchina.maintenance-proposals',rows})
    }
    if(url.pathname==='/exports'&&request.method==='POST')return json(await prepareExport(env,await requestJson(request,4096)))
    if(url.pathname.startsWith('/exports/')&&request.method==='GET')return json(await readExport(env,url.pathname.slice('/exports/'.length)))
    if(url.pathname==='/ack'&&request.method==='POST')return json(await acknowledge(env,await requestJson(request,65536)))
    if(url.pathname==='/artifacts'&&request.method==='GET') {
      const key=url.searchParams.get('key')??''
      if(key===BUDGET_POLICY_KEY||key===BUDGET_OBSERVATION_KEY||key.startsWith('maintenance/runtime/budget-observations/'))return json({ok:false,error:'budget_artifact_private'},403)
      if(!/^maintenance\/[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?$/.test(key)||key.includes('..'))throw new MaintenanceError('artifact_key_invalid')
      const object=await env.SNAPSHOTS_BUCKET.get(key)
      if(!object)return json({ok:false,error:'artifact_not_found'},404)
      if(object.size!==undefined&&object.size>10*1024*1024)throw new MaintenanceError('artifact_too_large')
      const bytes=await object.arrayBuffer()
      if(bytes.byteLength>10*1024*1024)throw new MaintenanceError('artifact_too_large')
      return new Response(bytes,{headers:{'content-type':'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'}})
    }
    return json({ok:false,error:'not_found'},404)
  } catch(error) {
    const code=error instanceof MaintenanceError?error.code:'request_invalid_or_backend_unavailable'
    if(code==='no_ready_proposals'||code==='export_cadence_wait')return new Response(null,{status:204,headers:{'cache-control':'no-store'}})
    return json({ok:false,error:code},code==='export_not_found'?404:409)
  }
}
const worker={fetch:handleFetch,queue:handleQueue,async scheduled(_controller:unknown,env:MaintenanceEnv){await runCloudTick(env)}}
export default worker
