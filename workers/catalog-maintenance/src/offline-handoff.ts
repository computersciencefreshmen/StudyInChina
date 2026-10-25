import { SOURCE_CATEGORIES } from '../../../scripts/maintenance/contracts'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import { control } from './repository'
import { offlineArtifactKeySchema,offlineHandoffSchema,OFFLINE_TABLES,type OfflineHandoff,type OfflineTableName } from './offline-handoff-contract'
import type { MaintenanceEnv,MaintenanceMessage } from './types'
import { MaintenanceError } from './types'
import { canonical,digest,gateRequest,HASH,nowIso,record } from './util'

const MAX_MANIFEST=8*1024*1024,MAX_ARTIFACT=10*1024*1024
const batchPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/
type Pointer={batchId:string;manifestSha256:string;manifestKey:string;tokenSha256:string;byteLength:number}
type Progress={phase:'artifacts'|'rows'|'guards'|'reservations'|'final'|'complete';offset:number}
const root=(id:string)=>`maintenance/offline-handoffs/${id}`
const options={httpMetadata:{contentType:'application/json'}}
async function immutable(env:MaintenanceEnv,key:string,text:string){const old=await env.SNAPSHOTS_BUCKET.get(key);if(old){if(await old.text()!==text)throw new MaintenanceError('offline_handoff_immutable_conflict');return}await env.SNAPSHOTS_BUCKET.put(key,text,{...options,onlyIf:{etagDoesNotMatch:'*'}});if(await(await env.SNAPSHOTS_BUCKET.get(key))?.text()!==text)throw new MaintenanceError('offline_handoff_immutable_conflict')}
async function gate(env:MaintenanceEnv,path:string,body:unknown){const response=await gateRequest(env,path,body),value=record(await response.json());if(!response.ok||value?.ok!==true)throw new MaintenanceError(String(value?.error??'offline_handoff_admission_failed'));return value}
async function owned(env:MaintenanceEnv,id:string,token:string){const value=await gate(env,'/offline-fence/status',{}),fence=record(value.fence);if(!fence||fence.batchId!==id||fence.tokenSha256!==await digest(token)||fence.scopeRegistrySha256!==env.SCOPE_REGISTRY_SHA256||!['active','held_for_handoff'].includes(String(fence.phase)))throw new MaintenanceError('offline_handoff_fence_mismatch');return fence}
function upload(request:Request,max:number){const url=new URL(request.url),batchId=url.searchParams.get('batchId')??'',token=request.headers.get('x-offline-token')??'',length=request.headers.get('content-length')??'';if(!batchPattern.test(batchId)||!HASH.test(token)||!/^[1-9]\d*$/.test(length)||Number(length)>max||!request.body)throw new MaintenanceError('offline_handoff_upload_invalid');return{url,batchId,token,byteLength:Number(length)}}

/** HTTP keeps native known-length streams. Hashing/parsing happens in Queue CPU. */
export async function uploadOfflineArtifact(env:MaintenanceEnv,request:Request){
  const value=upload(request,MAX_ARTIFACT),key=offlineArtifactKeySchema.parse(value.url.searchParams.get('key')),sha256=request.headers.get('x-artifact-sha256')??''
  if(!HASH.test(sha256)||[...value.url.searchParams.keys()].some(key=>!['batchId','key'].includes(key)))throw new MaintenanceError('offline_handoff_upload_invalid')
  await owned(env,value.batchId,value.token)
  const stagingKey=`${root(value.batchId)}/blobs/${sha256}.bin`
  await env.SNAPSHOTS_BUCKET.put(stagingKey,request.body!,{onlyIf:{etagDoesNotMatch:'*'}})
  await immutable(env,`${root(value.batchId)}/uploads/${await digest(key)}.json`,canonical({objectKey:key,sha256,byteLength:value.byteLength,stagingKey}))
  return{ok:true,staged:true,verified:false,objectKey:key,sha256}
}
export async function uploadOfflineManifest(env:MaintenanceEnv,request:Request){
  const value=upload(request,MAX_MANIFEST),sha256=request.headers.get('x-manifest-sha256')??''
  if(!HASH.test(sha256)||[...value.url.searchParams.keys()].some(key=>key!=='batchId'))throw new MaintenanceError('offline_handoff_upload_invalid')
  await owned(env,value.batchId,value.token)
  await gate(env,'/offline-fence/release',{batchId:value.batchId,token:value.token,manifestSha256:sha256,acknowledgedManifestSha256:sha256})
  const pointer:Pointer={batchId:value.batchId,manifestSha256:sha256,manifestKey:`${root(value.batchId)}/manifests/${sha256}.json`,tokenSha256:await digest(value.token),byteLength:value.byteLength}
  await env.SNAPSHOTS_BUCKET.put(pointer.manifestKey,request.body!,{...options,onlyIf:{etagDoesNotMatch:'*'}})
  await immutable(env,`${root(value.batchId)}/pointer.json`,canonical(pointer))
  await queue(env,pointer)
  return{ok:true,staged:true,validation:'pending-queue',released:false,batchId:value.batchId,manifestSha256:sha256}
}
async function queue(env:MaintenanceEnv,pointer:Pointer){await env.MAINTENANCE_QUEUE.send({version:1,jobId:pointer.manifestSha256,offlineHandoffBatchId:pointer.batchId,offlineHandoffSha256:pointer.manifestSha256})}
export async function enqueuePendingOfflineHandoff(env:MaintenanceEnv){
  const status=await gate(env,'/offline-fence/status',{}),fence=record(status.fence)
  if(!fence||fence.phase!=='held_for_handoff'||typeof fence.batchId!=='string'||!batchPattern.test(fence.batchId))return false
  const object=await env.SNAPSHOTS_BUCKET.get(`${root(fence.batchId)}/pointer.json`)
  if(!object)return false
  const pointer=JSON.parse(await object.text())as Pointer
  if(pointer.batchId!==fence.batchId||pointer.manifestSha256!==fence.manifestSha256||pointer.tokenSha256!==fence.tokenSha256)throw new MaintenanceError('offline_handoff_pointer_mismatch')
  await queue(env,pointer);return true
}
async function saveProgress(env:MaintenanceEnv,key:string,previous:{etag?:string}|null,value:Progress){const result=await env.SNAPSHOTS_BUCKET.put(key,canonical(value),{...options,onlyIf:previous?{etagMatches:previous.etag??''}:{etagDoesNotMatch:'*'}});if(result===null)throw new MaintenanceError('offline_handoff_progress_conflict')}
function flatRows(manifest:OfflineHandoff){const order:OfflineTableName[]=['maintenance_sources','maintenance_source_schools','maintenance_observations','maintenance_jobs','maintenance_model_attempts','maintenance_document_derivatives','maintenance_document_failures','maintenance_proposals','maintenance_exports'];return order.flatMap(table=>manifest.tableRows[table].map(value=>({table,row:value as Record<string,unknown>})))}
function pins(manifest:OfflineHandoff){return[manifest.scopeRegistrySha256,manifest.inputCatalogSha256,manifest.seedSha256,manifest.legacyGuardSha256]}
const pinSql='EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND seed_complete=1 AND targets_complete=1 AND scope_sha256=? AND input_catalog_sha256=? AND seed_sha256=? AND legacy_guard_sha256=?)'
async function scope(env:MaintenanceEnv,manifest:OfflineHandoff){
  const cfg=await control(env)
  if(!cfg||!cfg.seed_complete||!cfg.targets_complete)throw new MaintenanceError('offline_handoff_cloud_seed_incomplete')
  if(cfg.scope_sha256!==manifest.scopeRegistrySha256||cfg.input_catalog_sha256!==manifest.inputCatalogSha256||cfg.seed_sha256!==manifest.seedSha256||cfg.legacy_guard_sha256!==manifest.legacyGuardSha256||manifest.scopeRegistrySha256!==env.SCOPE_REGISTRY_SHA256)throw new MaintenanceError('offline_handoff_catalogue_pin_mismatch')
  return cfg
}
async function validateScope(env:MaintenanceEnv,manifest:OfflineHandoff){
  const cfg=await scope(env,manifest),counts=await env.PIPELINE_DB.prepare('SELECT (SELECT COUNT(*) FROM maintenance_schools WHERE scope_sha256=?) schools,(SELECT COUNT(*) FROM maintenance_legacy_guards) guards').bind(manifest.scopeRegistrySha256).first<{schools:number;guards:number}>()
  const planObject=await env.SNAPSHOTS_BUCKET.get(`maintenance/bootstrap/${manifest.seedSha256}.json`)
  if(!planObject||planObject.size!==undefined&&planObject.size>24*1024*1024)throw new MaintenanceError('offline_handoff_seed_plan_unavailable')
  const planText=await planObject.text(),plan=record(JSON.parse(planText))
  const operations=Array.isArray(plan?.operations)?plan.operations:[],originalGuardIds=operations.flatMap(value=>{const operation=record(value);return typeof operation?.sql==='string'&&operation.sql.startsWith('INSERT OR IGNORE INTO maintenance_legacy_guards VALUES')&&Array.isArray(operation.values)?operation.values.filter((_,index)=>index%9===0):[]}),originals=await env.PIPELINE_DB.prepare('SELECT COUNT(*) count FROM maintenance_legacy_guards WHERE guard_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(originalGuardIds)).first<{count:number}>()
  if(await digest(planText)!==cfg.seed_plan_sha256||counts?.schools!==272||record(plan?.counts)?.guards!==originalGuardIds.length||originals?.count!==originalGuardIds.length||cfg.seed_offset!==cfg.seed_total)throw new MaintenanceError('offline_handoff_guard_ledger_incomplete')
  const schoolIds=[...new Set(manifest.tableRows.maintenance_source_schools.map(row=>row.university_id))]
  const schools=(await env.PIPELINE_DB.prepare('SELECT university_id,seed_json FROM maintenance_schools WHERE university_id IN(SELECT value FROM json_each(?)) AND scope_sha256=?').bind(JSON.stringify(schoolIds),manifest.scopeRegistrySha256).all<{university_id:string;seed_json:string}>()).results??[]
  if(schools.length!==schoolIds.length)throw new MaintenanceError('offline_handoff_school_scope_invalid')
  for(const source of manifest.tableRows.maintenance_sources){
    if(await digest(source.url)!==source.source_id||!SOURCE_CATEGORIES.includes(source.category as typeof SOURCE_CATEGORIES[number])||(JSON.parse(source.categories_json)as unknown[]).some(category=>typeof category!=='string'||!SOURCE_CATEGORIES.includes(category as typeof SOURCE_CATEGORIES[number])))throw new MaintenanceError('offline_handoff_source_identity_invalid')
    const host=new URL(source.url).hostname,declared=JSON.parse(source.allowed_hosts_json)as string[];assertSafeSourceUrl(source.url,declared)
    const owners=manifest.tableRows.maintenance_source_schools.filter(row=>row.source_id===source.source_id)
    if(!owners.length)throw new MaintenanceError('offline_handoff_source_owner_missing')
    for(const owner of owners){const school=record(JSON.parse(schools.find(row=>row.university_id===owner.university_id)!.seed_json)),seeds=Array.isArray(school?.sourceSeeds)?school.sourceSeeds:[],families=seeds.flatMap(value=>{const seed=record(value);return seed?.enabled===true&&seed.registration==='catalogue_official'&&Array.isArray(seed.allowedHosts)?seed.allowedHosts.filter((value):value is string=>typeof value==='string'):[]});if(!families.some(family=>host===family||host.endsWith(`.${family}`))||declared.some(value=>!families.some(family=>value===family||value.endsWith(`.${family}`))))throw new MaintenanceError('offline_handoff_source_host_not_registered')}
  }
}
async function promoteArtifact(env:MaintenanceEnv,pointer:Pointer,artifact:OfflineHandoff['artifacts'][number]){
  const receipt=await env.SNAPSHOTS_BUCKET.get(`${root(pointer.batchId)}/uploads/${await digest(artifact.objectKey)}.json`),stagingKey=`${root(pointer.batchId)}/blobs/${artifact.sha256}.bin`
  if(!receipt||canonical(JSON.parse(await receipt.text()))!==canonical({...artifact,stagingKey}))throw new MaintenanceError('offline_handoff_artifact_not_staged')
  const staged=await env.SNAPSHOTS_BUCKET.get(stagingKey)
  if(!staged||staged.size!==artifact.byteLength||artifact.byteLength>MAX_ARTIFACT)throw new MaintenanceError('offline_handoff_artifact_size_invalid')
  const bytes=await staged.arrayBuffer();if(bytes.byteLength!==artifact.byteLength||await digest(bytes)!==artifact.sha256)throw new MaintenanceError('offline_handoff_artifact_checksum_invalid')
  const existing=await env.SNAPSHOTS_BUCKET.get(artifact.objectKey)
  if(existing){if(existing.size!==artifact.byteLength||await digest(await existing.arrayBuffer())!==artifact.sha256)throw new MaintenanceError('offline_handoff_artifact_conflict');return}
  const saved=await env.SNAPSHOTS_BUCKET.put(artifact.objectKey,bytes,{onlyIf:{etagDoesNotMatch:'*'}})
  if(saved===null)throw new MaintenanceError('offline_handoff_artifact_conflict')
}
/** Every D1 mutation uses fixed table/column identifiers plus bound values. */
function rowStatements(env:MaintenanceEnv,table:OfflineTableName,row:Record<string,unknown>,guardId:string){
  const shape=OFFLINE_TABLES[table],columns=[...shape.columns]as string[],values=columns.map(column=>row[column]),names=columns.join(','),placeholders=columns.map(()=>'?').join(',')
  let sql=`INSERT OR IGNORE INTO ${table}(${names}) VALUES(${placeholders})`
  if(table==='maintenance_sources'){
    const dynamic=['due_at','last_attempt_at','last_success_at','raw_sha256','canonical_sha256','snapshot_key','etag','failures','error_code'],identity=columns.filter(column=>!dynamic.includes(column))
    sql=`INSERT INTO ${table}(${names}) VALUES(${placeholders}) ON CONFLICT(source_id) DO UPDATE SET ${dynamic.map(column=>`${column}=excluded.${column}`).join(',')} WHERE ${identity.map(column=>`${table}.${column} IS excluded.${column}`).join(' AND ')} AND (${table}.last_attempt_at IS NULL OR (excluded.last_attempt_at IS NOT NULL AND excluded.last_attempt_at>=${table}.last_attempt_at)) AND (${table}.raw_sha256 IS NULL OR excluded.raw_sha256 IS NOT NULL)`
  }
  return[env.PIPELINE_DB.prepare(sql).bind(...values),env.PIPELINE_DB.prepare(`UPDATE maintenance_transaction_guards SET check_passed=(SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column=>`${column} IS ?`).join(' AND ')}) THEN 1 ELSE 0 END) WHERE guard_id=?`).bind(...values,guardId)]
}
async function unknownGuards(manifest:OfflineHandoff,manifestSha256:string){
  const rows:Array<unknown[]>=[]
  for(const attempt of manifest.tableRows.maintenance_model_attempts.filter(row=>['unknown','send_started','reserved'].includes(row.status)))for(const school of manifest.tableRows.maintenance_source_schools.filter(row=>row.source_id===attempt.source_id)){
    const id=`offline-unknown-${await digest(canonical({batchId:manifest.batchId,reservationKey:attempt.reservation_key,sourceId:attempt.source_id,snapshotSha256:attempt.snapshot_sha256,universityId:school.university_id}))}`
    rows.push([id,school.university_id,attempt.source_id,null,'"*"','unknown',manifestSha256,'Offline model outcome unknown; exact source evidence remains reserved',attempt.snapshot_sha256])
  }
  return rows
}
export async function processOfflineHandoff(env:MaintenanceEnv,batchId:string,manifestSha256:string){
  if(!batchPattern.test(batchId)||!HASH.test(manifestSha256))throw new MaintenanceError('offline_handoff_identity_invalid')
  const pointerObject=await env.SNAPSHOTS_BUCKET.get(`${root(batchId)}/pointer.json`)
  if(!pointerObject)throw new MaintenanceError('offline_handoff_pointer_missing')
  const pointer=JSON.parse(await pointerObject.text())as Pointer
  if(pointer.batchId!==batchId||pointer.manifestSha256!==manifestSha256||pointer.manifestKey!==`${root(batchId)}/manifests/${manifestSha256}.json`)throw new MaintenanceError('offline_handoff_pointer_mismatch')
  const object=await env.SNAPSHOTS_BUCKET.get(pointer.manifestKey)
  if(!object||object.size!==pointer.byteLength||object.size>MAX_MANIFEST)throw new MaintenanceError('offline_handoff_manifest_unavailable')
  const bytes=await object.arrayBuffer();if(await digest(bytes)!==manifestSha256)throw new MaintenanceError('offline_handoff_manifest_checksum_invalid')
  const manifest=offlineHandoffSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  if(manifest.batchId!==batchId)throw new MaintenanceError('offline_handoff_manifest_batch_invalid')
  const key=`${root(batchId)}/progress.json`,previous=await env.SNAPSHOTS_BUCKET.get(key),progress:Progress=previous?JSON.parse(await previous.text())as Progress:{phase:'artifacts',offset:0}
  if(!['artifacts','rows','guards','reservations','final','complete'].includes(progress.phase)||!Number.isSafeInteger(progress.offset)||progress.offset<0||progress.phase==='artifacts'&&progress.offset>manifest.artifacts.length||progress.phase==='rows'&&progress.offset>flatRows(manifest).length||progress.phase==='reservations'&&progress.offset>manifest.requestReservations.length)throw new MaintenanceError('offline_handoff_progress_invalid')
  if(progress.phase==='complete')return{complete:true,reused:true}
  if(progress.phase!=='final')await scope(env,manifest)
  const state=await gate(env,'/offline-fence/status',{}),fence=record(state.fence)
  if(progress.phase!=='final'&&(!fence||fence.batchId!==batchId||fence.manifestSha256!==manifestSha256||fence.tokenSha256!==pointer.tokenSha256||fence.inputCatalogSha256!==manifest.inputCatalogSha256||fence.scopeRegistrySha256!==manifest.scopeRegistrySha256||fence.phase!=='held_for_handoff'))throw new MaintenanceError('offline_handoff_fence_mismatch')
  if(fence&&['seedSha256','legacyGuardSha256'].some(field=>fence[field]!==undefined&&fence[field]!==manifest[field as 'seedSha256'|'legacyGuardSha256']))throw new MaintenanceError('offline_handoff_fence_pin_mismatch')
  if(!previous)await validateScope(env,manifest)
  let next:Progress
  if(progress.phase==='artifacts'){
    for(const artifact of manifest.artifacts.slice(progress.offset,progress.offset+8))await promoteArtifact(env,pointer,artifact)
    const offset=Math.min(progress.offset+8,manifest.artifacts.length);next=offset===manifest.artifacts.length?{phase:'rows',offset:0}:{phase:'artifacts',offset}
  }else if(progress.phase==='rows'){
    const rows=flatRows(manifest),chunk=rows.slice(progress.offset,progress.offset+12),guardId=crypto.randomUUID()
    await env.PIPELINE_DB.batch([env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${pinSql} THEN 1 ELSE 0 END))`).bind(guardId,...pins(manifest)),...chunk.flatMap(value=>rowStatements(env,value.table,value.row,guardId)),env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId)])
    const offset=progress.offset+chunk.length;next=offset===rows.length?{phase:'guards',offset:0}:{phase:'rows',offset}
  }else if(progress.phase==='guards'){
    const rows=await unknownGuards(manifest,manifestSha256),guardId=crypto.randomUUID(),chunk=rows.slice(progress.offset,progress.offset+12)
    if(progress.offset>rows.length)throw new MaintenanceError('offline_handoff_progress_invalid')
    await env.PIPELINE_DB.batch([env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${pinSql} THEN 1 ELSE 0 END))`).bind(guardId,...pins(manifest)),...chunk.flatMap(values=>[env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_legacy_guards VALUES(?,?,?,?,?,?,?,?,?)').bind(...values),env.PIPELINE_DB.prepare('UPDATE maintenance_transaction_guards SET check_passed=(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_legacy_guards WHERE guard_id IS ? AND university_id IS ? AND source_id IS ? AND record_id IS ? AND scope_json IS ? AND state IS ? AND artifact_sha256 IS ? AND reason IS ? AND snapshot_sha256 IS ?) THEN 1 ELSE 0 END) WHERE guard_id=?').bind(...values,guardId)]),env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId)])
    const offset=progress.offset+chunk.length;next=offset===rows.length?{phase:'reservations',offset:0}:{phase:'guards',offset}
  }else if(progress.phase==='reservations'){
    const chunk=manifest.requestReservations.slice(progress.offset,progress.offset+8)
    await gate(env,'/offline-fence/adopt',{batchId,tokenSha256:pointer.tokenSha256,manifestSha256,requests:chunk})
    const offset=progress.offset+chunk.length;next=offset===manifest.requestReservations.length?{phase:'final',offset:0}:{phase:'reservations',offset}
  }else{
    const requests=[...manifest.requestReservations].sort((a,b)=>a.reservationKey.localeCompare(b.reservationKey)),ack={format:'studyinchina.offline-handoff-ack',version:1,batchId,manifestSha256,tokenSha256:pointer.tokenSha256,scopeRegistrySha256:manifest.scopeRegistrySha256,inputCatalogSha256:manifest.inputCatalogSha256,seedSha256:manifest.seedSha256,legacyGuardSha256:manifest.legacyGuardSha256,requestReservationsSha256:await digest(canonical(requests)),requestReservationCount:requests.length,rowCount:flatRows(manifest).length,artifactCount:manifest.artifacts.length},text=canonical(ack),acknowledgementSha256=await digest(text),guardId=crypto.randomUUID(),eventId=`offline-handoff-${batchId}`
    await immutable(env,`${root(batchId)}/applied/${acknowledgementSha256}.json`,text)
    const existingAck=await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE event_id=? AND kind='offline_handoff_applied'").bind(eventId).first<{details_json:string}>()
    if(existingAck&&existingAck.details_json!==text)throw new MaintenanceError('offline_handoff_ack_conflict')
    const observedSchoolSql="(SELECT MAX(s.last_attempt_at) FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id WHERE x.university_id=maintenance_schools.university_id AND s.source_id IN(SELECT value FROM json_each(?)) AND (s.last_success_at IS NOT NULL OR s.error_code IN('robots_disallowed','robots_fetch_failed','source_fetch_failed','empty_official_text') OR s.error_code GLOB 'robots_http_[0-9][0-9][0-9]' OR s.error_code GLOB 'source_http_[0-9][0-9][0-9]'))",sourceIds=JSON.stringify(manifest.tableRows.maintenance_sources.map(row=>row.source_id))
    if(!existingAck){await scope(env,manifest);await env.PIPELINE_DB.batch([env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${pinSql} THEN 1 ELSE 0 END))`).bind(guardId,...pins(manifest)),env.PIPELINE_DB.prepare(`UPDATE maintenance_schools SET last_attempt_at=${observedSchoolSql} WHERE scope_sha256=? AND ${observedSchoolSql} IS NOT NULL AND (last_attempt_at IS NULL OR last_attempt_at<${observedSchoolSql})`).bind(sourceIds,manifest.scopeRegistrySha256,sourceIds,sourceIds),env.PIPELINE_DB.prepare("INSERT OR IGNORE INTO maintenance_events VALUES(?,'offline_handoff_applied',?,?)").bind(eventId,nowIso(),text),env.PIPELINE_DB.prepare("UPDATE maintenance_transaction_guards SET check_passed=(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=? AND kind='offline_handoff_applied' AND details_json=?) THEN 1 ELSE 0 END) WHERE guard_id=?").bind(eventId,text,guardId),env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId)])}
    await gate(env,'/offline-fence/complete-handoff',{batchId,tokenSha256:pointer.tokenSha256,manifestSha256,acknowledgementSha256})
    next={phase:'complete',offset:0}
  }
  await saveProgress(env,key,previous,next)
  if(next.phase!=='complete')await queue(env,pointer)
  return{complete:next.phase==='complete',phase:next.phase,offset:next.offset}
}
export function offlineHandoffMessage(message:MaintenanceMessage){return message.version===1&&typeof message.offlineHandoffBatchId==='string'&&HASH.test(String(message.offlineHandoffSha256))}
export async function offlineHandoffStatus(env:MaintenanceEnv,batchId:string){if(!batchPattern.test(batchId))throw new MaintenanceError('offline_handoff_identity_invalid');const pointer=await env.SNAPSHOTS_BUCKET.get(`${root(batchId)}/pointer.json`),progress=await env.SNAPSHOTS_BUCKET.get(`${root(batchId)}/progress.json`);return{ok:true,batchId,pointer:pointer?JSON.parse(await pointer.text()):null,progress:progress?JSON.parse(await progress.text()):null}}
