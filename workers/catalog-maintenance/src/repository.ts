import { normalizeAllowedHost, assertSafeSourceUrl } from '../../ingestion/src/security'
import { maintenanceRecordTargetSchema } from '../../../scripts/maintenance/field-contracts'
import type { Control, JobRow, LegacyGuard, MaintenanceEnv, RecordTarget, SchoolRow, SourceRow } from './types'
import { MaintenanceError } from './types'
import { after, canonical, digest, HASH, ID, nowIso, record } from './util'
import { coalesceOperations,type SqlOperation } from './sql-plan'
import { schedulingCoverageBand, selectScheduledJobs } from './scheduling'
import { captureCadence } from './cadence'
import { expectedScopeSchoolCount } from './scope-config'
import { getTodayDate } from '../../../src/lib/data/freshness'
import { readCoverageSnapshot, validateCoverageSnapshot, storeCoverageSnapshot, publishCoverageSnapshot, coverageEvent, type CoverageSnapshot } from './coverage'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { readUnknownJobDisposition } from './reviewed-terminal-quarantine'
import { readLegacyModelDisposition } from './legacy-model-guards'

export async function control(env: MaintenanceEnv): Promise<Control | null> {
  return env.PIPELINE_DB.prepare('SELECT * FROM maintenance_control WHERE singleton=1').first<Control>()
}
export async function event(env: MaintenanceEnv, kind: string, details: unknown, now = Date.now()): Promise<void> {
  await env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(),kind,nowIso(now),JSON.stringify(details)).run()
}
export type SeedSchool = { universityId: string; name: unknown; sourceSeeds: Array<{ id: string; url: string; allowedHosts: string[]; sourceCategory: string; enabled: boolean; registration?: string }> }
export type Seed = { scopeRegistrySha256: string; inputCatalogSha256: string; schools: SeedSchool[]; legacyGuards: { artifactSha256: string; entries: LegacyGuard[] };recordTargets:RecordTarget[] }
export function validateSeed(value: unknown, expectedCount?: number): Seed {
  const raw = record(value), legacy = record(raw?.legacyGuards)
  if (!raw || !HASH.test(String(raw.scopeRegistrySha256)) || !HASH.test(String(raw.inputCatalogSha256)) || !legacy || !HASH.test(String(legacy.artifactSha256)) || !Array.isArray(legacy.entries) || legacy.entries.length > 20000 || !Array.isArray(raw.schools) || ![272,295].includes(raw.schools.length) || expectedCount !== undefined && raw.schools.length !== expectedCount) throw new MaintenanceError('invalid_fixed_scope_seed')
  const schools: SeedSchool[] = [], ids = new Set<string>()
  for (const item of raw.schools) {
    const school = record(item), id = String(school?.universityId ?? '')
    if (!ID.test(id) || ids.has(id) || !record(school?.name) || !Array.isArray(school?.sourceSeeds) || school.sourceSeeds.length > 100) throw new MaintenanceError('invalid_school_seed')
    ids.add(id)
    const sources: SeedSchool['sourceSeeds'] = []
    for (const entry of school.sourceSeeds) {
      const source = record(entry)
      if (!source || !ID.test(String(source.id)) || !Array.isArray(source.allowedHosts) || source.allowedHosts.length < 1 || source.allowedHosts.length > 12 || typeof source.enabled !== 'boolean' || typeof source.url !== 'string' || typeof source.sourceCategory !== 'string' || !/^[a-z_]{1,80}$/.test(source.sourceCategory)) throw new MaintenanceError('invalid_source_seed')
      const hosts = [...new Set(source.allowedHosts.map(host => normalizeAllowedHost(String(host))))]
      // The fixed scope names registered university host families. Admit only
      // the exact already-listed URL's subdomain, never an arbitrary new sibling.
      const hostname=new URL(source.url).hostname
      if(!hosts.includes(hostname)&&hosts.some(host=>hostname.endsWith(`.${host}`)))hosts.push(hostname)
      assertSafeSourceUrl(source.url,hosts)
      if (source.enabled && source.registration !== 'catalogue_official') throw new MaintenanceError('unapproved_source_seed')
      sources.push({ id: String(source.id), url: source.url, allowedHosts: hosts, sourceCategory: source.sourceCategory, enabled: source.enabled, registration: String(source.registration ?? 'candidate') })
    }
    schools.push({ universityId:id,name:school.name,sourceSeeds:sources })
  }
  const guards: LegacyGuard[] = [], guardIds = new Set<string>()
  for (const item of legacy.entries) {
    const guard = record(item)
    if (!guard || !ID.test(String(guard.id)) || guardIds.has(String(guard.id)) || !['stop','unknown','consumed'].includes(String(guard.state)) || !HASH.test(String(guard.artifactSha256)) || typeof guard.reason !== 'string' || guard.reason.length > 240) throw new MaintenanceError('invalid_legacy_guard')
    for (const key of ['universityId','sourceId']) if (guard[key] !== null && (typeof guard[key] !== 'string' || !ID.test(guard[key]))) throw new MaintenanceError('invalid_legacy_guard_scope')
    if(guard.recordId!==null&&(typeof guard.recordId!=='string'||!guard.recordId.trim()||guard.recordId.length>512||/[\u0000-\u001f]/u.test(guard.recordId)))throw new MaintenanceError('invalid_legacy_guard_record')
    if (guard.universityId !== null && !ids.has(String(guard.universityId))) throw new MaintenanceError('legacy_guard_outside_scope')
    if (guard.fields !== '*' && (!Array.isArray(guard.fields) || guard.fields.length > 100 || guard.fields.some(field => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,159}$/.test(field)))) throw new MaintenanceError('invalid_legacy_guard_fields')
    if(guard.snapshotSha256!==undefined&&guard.snapshotSha256!==null&&!HASH.test(String(guard.snapshotSha256)))throw new MaintenanceError('invalid_legacy_snapshot_hash')
    guardIds.add(String(guard.id)); guards.push(guard as unknown as LegacyGuard)
  }
  if(raw.recordTargets!==undefined&&(!Array.isArray(raw.recordTargets)||raw.recordTargets.length>10000))throw new MaintenanceError('invalid_record_targets')
  const targets:RecordTarget[]=[],targetIds=new Set<string>()
  for(const entry of (raw.recordTargets??[])as unknown[]) {
    const parsed=maintenanceRecordTargetSchema.safeParse(entry)
    if(!parsed.success)throw new MaintenanceError('invalid_record_target')
    const target=parsed.data,id=`${target.entityType}:${target.recordId}`
    if(!target.recordId.trim()||target.recordId.length>512||/[\u0000-\u001f]/u.test(target.recordId)||!ids.has(target.universityId)||targetIds.has(id)||target.sourceIds.length>100||Object.keys(target.fields).length>32)throw new MaintenanceError('invalid_record_target_scope')
    targetIds.add(id);targets.push(target)
  }
  return {scopeRegistrySha256:String(raw.scopeRegistrySha256),inputCatalogSha256:String(raw.inputCatalogSha256),schools,legacyGuards:{artifactSha256:String(legacy.artifactSha256),entries:guards},recordTargets:targets}
}
export async function seed(env: MaintenanceEnv, value: unknown, now = Date.now(),staged=false) {
  const input = validateSeed(value, expectedScopeSchoolCount(env)), hash = await digest(canonical(input)), old = await control(env)
  if (env.SCOPE_REGISTRY_SHA256 && input.scopeRegistrySha256 !== env.SCOPE_REGISTRY_SHA256) throw new MaintenanceError('scope_registry_mismatch')
  if (old) {
    if (old.seed_sha256 !== hash) throw new MaintenanceError('seed_already_exists')
    if (old.seed_complete) return {seedSha256:hash,reused:true,enabled:Boolean(old.enabled),seedComplete:true}
    if(old.seed_plan_sha256){if(staged){await env.MAINTENANCE_QUEUE.send({version:1,jobId:hash,seedSha256:hash});return{seedSha256:hash,reused:true,enabled:false,seedComplete:false}}while(!(await control(env))?.seed_complete)await continueSeed(env,hash,false);return{seedSha256:hash,reused:true,enabled:false,seedComplete:true}}
  }
  const operations:SqlOperation[]=[]
  const add=(sql:string,...values:unknown[])=>operations.push({sql,values})
  const sources = new Map<string,{url:string;hosts:string[];category:string;categories:string[];enabled:boolean}>()
  const associations: Array<[string,string]> = []
  for (const school of input.schools) {
    add('INSERT OR IGNORE INTO maintenance_schools VALUES(?,?,?,?,NULL)',school.universityId,JSON.stringify(school.name),JSON.stringify(school),input.scopeRegistrySha256)
    for (const source of school.sourceSeeds) {
      const sourceId = await digest(source.url), existing = sources.get(sourceId)
      sources.set(sourceId,{url:source.url,hosts:[...new Set([...(existing?.hosts ?? []),...source.allowedHosts])],category:existing?.category ?? source.sourceCategory,categories:[...new Set([...(existing?.categories??[]),source.sourceCategory])],enabled:Boolean(existing?.enabled || source.enabled)})
      associations.push([sourceId,school.universityId])
    }
  }
  for (const [id,source] of sources) add('INSERT OR IGNORE INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at) VALUES(?,?,?,?,?,?,168,?)',id,source.url,JSON.stringify(source.hosts),source.category,JSON.stringify(source.categories),source.enabled?1:0,nowIso(now))
  for (const [sourceId,schoolId] of new Map(associations.map(pair => [pair.join('|'),pair])).values()) add('INSERT OR IGNORE INTO maintenance_source_schools VALUES(?,?)',sourceId,schoolId)
  for (const guard of input.legacyGuards.entries) add('INSERT OR IGNORE INTO maintenance_legacy_guards VALUES(?,?,?,?,?,?,?,?,?)',guard.id,guard.universityId,guard.sourceId,guard.recordId,JSON.stringify(guard.fields),guard.state,guard.artifactSha256,guard.reason,guard.snapshotSha256??null)
  for(const target of input.recordTargets) {
    const id=`${target.entityType}:${target.recordId}`
    add('INSERT OR IGNORE INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json) VALUES(?,?,?,?,?,?,?,?,?)',id,target.recordId,target.entityType,target.universityId,target.recordScopeSha256,target.year,target.intake,JSON.stringify(target.fields),JSON.stringify(target))
    for(const sourceId of new Set(target.sourceIds))if(sources.has(sourceId))add('INSERT OR IGNORE INTO maintenance_target_sources VALUES(?,?)',id,sourceId)
  }
  const plan={version:1,seedSha256:hash,counts:{schools:input.schools.length,sources:sources.size,guards:input.legacyGuards.entries.length,targets:input.recordTargets.length},operations:coalesceOperations(operations)}
  const planBytes=canonical(plan),planSha256=await digest(planBytes)
  await env.SNAPSHOTS_BUCKET.put(`maintenance/bootstrap/${hash}.json`,planBytes,{httpMetadata:{contentType:'application/json'}})
  await env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,updated_at,seed_total,seed_plan_sha256) VALUES(1,?,?,?,?,?,?,?)').bind(input.scopeRegistrySha256,input.inputCatalogSha256,hash,input.legacyGuards.artifactSha256,nowIso(now),plan.operations.length,planSha256).run()
  if(staged){await env.MAINTENANCE_QUEUE.send({version:1,jobId:hash,seedSha256:hash});return{seedSha256:hash,reused:false,enabled:false,seedComplete:false,operations:plan.operations.length}}
  while(!(await control(env))?.seed_complete)await continueSeed(env,hash,false)
  return {seedSha256:hash,reused:false,enabled:false,seedComplete:true,schools:input.schools.length,sources:sources.size}
}
export async function continueSeed(env:MaintenanceEnv,hash:string,enqueue=true) {
  const cfg=await control(env)
  if(!cfg||cfg.seed_sha256!==hash||!cfg.seed_plan_sha256||cfg.enabled)throw new MaintenanceError('seed_continuation_mismatch')
  if(cfg.seed_complete)return{seedComplete:true,completedOperations:cfg.seed_offset,totalOperations:cfg.seed_total}
  const artifact=await env.SNAPSHOTS_BUCKET.get(`maintenance/bootstrap/${hash}.json`)
  if(!artifact||artifact.size!==undefined&&artifact.size>24*1024*1024)throw new MaintenanceError('seed_plan_unavailable')
  const bytes=await artifact.text()
  if(await digest(bytes)!==cfg.seed_plan_sha256)throw new MaintenanceError('seed_plan_checksum_mismatch')
  const plan=JSON.parse(bytes)as {seedSha256:string;counts:{schools:number;sources:number;guards:number;targets:number};operations:SqlOperation[]}
  if(plan.seedSha256!==hash||plan.operations.length!==cfg.seed_total)throw new MaintenanceError('seed_plan_manifest_mismatch')
  const chunk=plan.operations.slice(cfg.seed_offset,cfg.seed_offset+32),guardId=crypto.randomUUID(),offset=cfg.seed_offset+chunk.length
  if(chunk.length)await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND seed_sha256=? AND seed_offset=? AND seed_complete=0 AND enabled=0) THEN 1 ELSE 0 END))').bind(guardId,hash,cfg.seed_offset),
    ...chunk.map(operation=>env.PIPELINE_DB.prepare(operation.sql).bind(...operation.values)),
    env.PIPELINE_DB.prepare('UPDATE maintenance_control SET seed_offset=? WHERE singleton=1 AND seed_sha256=? AND seed_offset=?').bind(offset,hash,cfg.seed_offset),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId),
  ])
  if(offset===plan.operations.length){
    const counts=await env.PIPELINE_DB.prepare('SELECT (SELECT COUNT(*) FROM maintenance_schools) schools,(SELECT COUNT(*) FROM maintenance_sources) sources,(SELECT COUNT(*) FROM maintenance_legacy_guards) guards,(SELECT COUNT(*) FROM maintenance_record_targets) targets').first<{schools:number;sources:number;guards:number;targets:number}>()
    if(!counts||canonical({...counts})!==canonical(plan.counts))throw new MaintenanceError('seed_readback_mismatch')
    await env.PIPELINE_DB.prepare('UPDATE maintenance_control SET seed_complete=1,targets_complete=1 WHERE singleton=1 AND seed_sha256=? AND seed_offset=? AND enabled=0').bind(hash,offset).run()
    await event(env,'seeded',{seedSha256:hash,...counts})
    return{seedComplete:true,completedOperations:offset,totalOperations:plan.operations.length}
  }
  if(enqueue)await env.MAINTENANCE_QUEUE.send({version:1,jobId:hash,seedSha256:hash})
  return{seedComplete:false,completedOperations:offset,totalOperations:plan.operations.length}
}
export async function setControls(env: MaintenanceEnv, value: unknown, now = Date.now()) {
  const raw = record(value), old = await control(env)
  if (!old?.seed_complete || !raw || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision !== old.revision || typeof raw.enabled !== 'boolean' || typeof raw.modelsEnabled !== 'boolean' || raw.legacyGuardSha256 !== old.legacy_guard_sha256) throw new MaintenanceError('control_revision_or_guard_mismatch')
  if (raw.modelsEnabled && (env.MAINTENANCE_ENABLED !== 'true' || !env.MINIMAX_SUBSCRIPTION_KEY || env.MINIMAX_MODEL !== 'MiniMax-M3')) throw new MaintenanceError('subscription_model_configuration_unavailable')
  if(raw.enabled&&env.SCOPE_REGISTRY_SHA256!==old.scope_sha256)throw new MaintenanceError('activation_requires_exact_scope_pin')
  const canary=raw.canaryUniversityIds===undefined?JSON.parse(old.canary_json) as string[]:raw.canaryUniversityIds===null?[]:raw.canaryUniversityIds
  if(!Array.isArray(canary)||canary.length>expectedScopeSchoolCount(env)||new Set(canary).size!==canary.length||canary.some(id=>typeof id!=='string'||!ID.test(id)))throw new MaintenanceError('invalid_canary_scope')
  const known=await env.PIPELINE_DB.prepare('SELECT COUNT(*) count FROM maintenance_schools s JOIN json_each(?) chosen ON chosen.value=s.university_id WHERE s.scope_sha256=?').bind(JSON.stringify(canary),old.scope_sha256).first<{count:number}>()
  if(known?.count!==canary.length)throw new MaintenanceError('canary_school_not_seeded')
  if(raw.enabled&&old.revision===0&&!canary.length)throw new MaintenanceError('initial_canary_required')
  const result = await env.PIPELINE_DB.prepare('UPDATE maintenance_control SET enabled=?,models_enabled=?,canary_json=?,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?').bind(raw.enabled?1:0,raw.modelsEnabled?1:0,JSON.stringify(canary),nowIso(now),old.revision).run()
  if (result.meta?.changes !== 1) throw new MaintenanceError('control_revision_conflict')
  await event(env,'controls_changed',{enabled:raw.enabled,modelsEnabled:raw.modelsEnabled,canaryUniversityIds:canary,revision:old.revision+1},now)
  return control(env)
}
export async function source(env: MaintenanceEnv,id: string) { return env.PIPELINE_DB.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').bind(id).first<SourceRow>() }
export async function sourceSchools(env: MaintenanceEnv,id: string): Promise<SchoolRow[]> { return (await env.PIPELINE_DB.prepare('SELECT s.university_id,s.name_json,s.seed_json FROM maintenance_schools s JOIN maintenance_source_schools x ON x.university_id=s.university_id WHERE x.source_id=? AND s.scope_sha256=(SELECT scope_sha256 FROM maintenance_control WHERE singleton=1) ORDER BY s.university_id').bind(id).all<SchoolRow>()).results ?? [] }
/** Only sparse acquisition priorities cross the SQL boundary, never programme
 * IDs or factual payloads. Missing/unknown schools receive expansion priority. */
type SchoolRotation = {key:string;etag?:string;lastScheduled:Record<string,number>;canWrite:boolean}
async function readSchoolRotation(env:MaintenanceEnv,scope:string,schoolIds:Set<string>,now:number):Promise<SchoolRotation> {
  // A scope-stable hint survives catalogue updates. It is never a source attempt
  // or evidence of processing/completeness, and needs no job-history SQL scan.
  const key=`maintenance/scheduling/school-rotation/${scope}.json`,object=await env.SNAPSHOTS_BUCKET.get(key)
  const lastScheduled:Record<string,number>={},result={key,etag:object?.etag,lastScheduled,canWrite:true}
  if(!object||object.size!==undefined&&object.size>24*1024)return result
  try{
    const text=await object.text()
    if(new TextEncoder().encode(text).length>24*1024)return result
    const value=record(JSON.parse(text)),entries=record(value?.lastScheduled),tick=Math.floor(now/900000)
    if(value?.format!=='studyinchina.school-scheduling-rotation'||value.version!==1||value.scopeRegistrySha256!==scope||!entries)return result
    for(const [id,at]of Object.entries(entries))if(schoolIds.has(id)&&Number.isSafeInteger(at)&&Number(at)>=0){
      if(Number(at)>tick)result.canWrite=false // An older concurrent tick cannot erase newer scheduling ages.
      else lastScheduled[id]=Number(at)
    }
  }catch{/* An invalid scheduling hint restarts fairness, never factual evidence. */}
  return result
}
async function saveSchoolRotation(env:MaintenanceEnv,rotation:SchoolRotation,scope:string,scopeIds:Set<string>,schoolIds:string[],now:number) {
  let current=rotation
  // Normally one read/write. A lost ETag gets at most one merge/retry, never a
  // history scan or an unbounded loop; dispatch ownership stays in the job ledger.
  for(let attempt=0;attempt<2;attempt++){
    if(!current.canWrite)return false
    const lastScheduled={...rotation.lastScheduled}
    for(const [id,tick]of Object.entries(current.lastScheduled))lastScheduled[id]=Math.max(lastScheduled[id]??0,tick)
    for(const id of schoolIds)lastScheduled[id]=Math.max(lastScheduled[id]??0,Math.floor(now/900000))
    const content=canonical({format:'studyinchina.school-scheduling-rotation',version:1,scopeRegistrySha256:scope,lastScheduled})
    if(new TextEncoder().encode(content).length>24*1024)throw new MaintenanceError('scheduling_rotation_too_large')
    const saved=await env.SNAPSHOTS_BUCKET.put(current.key,content,{onlyIf:current.etag?{etagMatches:current.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
    if(saved)return true
    if(attempt===0)current=await readSchoolRotation(env,scope,scopeIds,now)
  }
  return false
}
function schedulingMetadata(coverage: CoverageSnapshot | null, rotation:SchoolRotation, now: number) {
  const today = getTodayDate(new Date(now)), reviewLimit = getTodayDate(new Date(now + 7 * 86400000))
  const metadata:Record<string,number[]> = Object.fromEntries(Object.entries(rotation.lastScheduled).map(([id,tick])=>[id,[0,0,tick]]))
  for(const school of coverage?.schools ?? []){
    const band=schedulingCoverageBand(school.currentProgramCount)
    const urgent=Boolean(school.reviewAfter&&school.reviewAfter>=today&&school.reviewAfter<=reviewLimit)
    if(band||urgent||metadata[school.universityId])metadata[school.universityId]=[band,urgent?1:0,rotation.lastScheduled[school.universityId]??0]
  }
  const bytes = JSON.stringify(metadata)
  if (new TextEncoder().encode(bytes).length > 24 * 1024) throw new MaintenanceError('scheduling_metadata_too_large')
  return bytes
}

// Materialize the tiny metadata once. Start from the bounded committed school
// set, then use the reverse school/source index instead of scanning fact tables.
const schedulingSchoolsSql = `school_meta AS MATERIALIZED (
  SELECT key university_id,json_extract(value,'$[0]') coverage_band,json_extract(value,'$[1]') review_urgent,json_extract(value,'$[2]') last_dispatched_tick FROM json_each(?)
),canary AS MATERIALIZED (SELECT value university_id FROM json_each(?)),school_priority AS MATERIALIZED (
  SELECT u.university_id,u.last_attempt_at school_last_attempt_at,COALESCE(m.last_dispatched_tick,0) school_last_dispatched_tick,COALESCE(m.coverage_band,0) coverage_band,COALESCE(m.review_urgent,0) review_urgent
  FROM maintenance_schools u LEFT JOIN school_meta m ON m.university_id=u.university_id
  WHERE u.scope_sha256=(SELECT scope_sha256 FROM maintenance_control WHERE singleton=1)
    AND (NOT EXISTS(SELECT 1 FROM canary) OR u.university_id IN(SELECT university_id FROM canary))
)`
const schedulingSchoolIdsSql = `(SELECT json_group_array(xu.university_id) FROM maintenance_source_schools xu JOIN maintenance_schools su ON su.university_id=xu.university_id WHERE xu.source_id=chosen.source_id AND su.scope_sha256=(SELECT scope_sha256 FROM maintenance_control WHERE singleton=1))`

export async function enqueueDue(env: MaintenanceEnv, now = Date.now()) {
  const cfg = await control(env)
  if(cfg&&!cfg.seed_complete&&cfg.seed_plan_sha256){await env.MAINTENANCE_QUEUE.send({version:1,jobId:cfg.seed_sha256,seedSha256:cfg.seed_sha256});return{enabled:false,queued:1}}
  if(cfg&&!cfg.targets_complete){const refresh=await env.PIPELINE_DB.prepare("SELECT refresh_sha256 FROM maintenance_target_refreshes WHERE status='staged' AND input_catalog_sha256=? ORDER BY created_at DESC LIMIT 1").bind(cfg.input_catalog_sha256).first<{refresh_sha256:string}>();if(refresh){await env.MAINTENANCE_QUEUE.send({version:1,jobId:refresh.refresh_sha256,targetRefreshSha256:refresh.refresh_sha256});return{enabled:false,queued:1}}}
  if (env.MAINTENANCE_ENABLED !== 'true' || !cfg?.enabled || !cfg.seed_complete) return {enabled:false,queued:0}
  if(!(await nativeReconciliationGate(env)).ready)return{enabled:false,queued:0,nativeHeadReconciliationRequired:true}
  const suppliedCoverage = await readCoverageSnapshot(env,cfg.input_catalog_sha256,cfg.scope_sha256,now)
  // Verify the complete identity set as well as the date/catalog/scope hashes.
  // This bounded registry lookup replaces the old first-attempt aggregate, and
  // does not count or scan programme/fact records. Historical scopes stay valid.
  const scopeSchools = (await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools WHERE scope_sha256=? LIMIT 296')
    .bind(cfg.scope_sha256).all<{university_id:string}>()).results ?? []
  const scopeIds = new Set(scopeSchools.map(school => school.university_id))
  const coverage = suppliedCoverage && [272,295].includes(scopeIds.size) && suppliedCoverage.schools.length === scopeIds.size
    && new Set(suppliedCoverage.schools.map(school => school.universityId)).size === scopeIds.size
    && suppliedCoverage.schools.every(school => scopeIds.has(school.universityId)) ? suppliedCoverage : null
  const coverageBySchool = new Map(coverage?.schools.map(row => [row.universityId,row]) ?? [])
  const rotation=await readSchoolRotation(env,cfg.scope_sha256,scopeIds,now)
  const metadata = schedulingMetadata(coverage,rotation,now)
  const firstRoundComplete = Boolean(coverage?.schools.every(school => school.currentProgramCount >= 5))
  const canaryIds=new Set(JSON.parse(cfg.canary_json) as string[])
  const withSchoolPriority = <T extends {school_ids_json:string}>(row:T) => {
    const ids = (JSON.parse(row.school_ids_json) as string[]).filter(id=>!canaryIds.size||canaryIds.has(id))
    const schools = ids.map(id => coverageBySchool.get(id))
    const dates = schools.flatMap(school => school?.reviewAfter ? [school.reviewAfter] : []).sort()
    return Object.assign(row, {
      coverage_count: schools.length && schools.every(school => school !== undefined) ? Math.min(...schools.map(school => school!.currentProgramCount)) : undefined,
      review_after: dates.find(date => date >= getTodayDate(new Date(now)) && date <= getTodayDate(new Date(now + 7 * 86400000))) ?? null,
    })
  }
  const candidates = (await env.PIPELINE_DB.prepare(`WITH ${schedulingSchoolsSql},associations AS MATERIALIZED (
    SELECT s.*,p.university_id scheduling_school_id,p.school_last_attempt_at,p.school_last_dispatched_tick,p.coverage_band,p.review_urgent
    FROM school_priority p CROSS JOIN maintenance_source_schools x CROSS JOIN maintenance_sources s
    WHERE x.university_id=p.university_id AND s.source_id=x.source_id AND s.enabled=1
      AND (s.due_at<=? OR ((s.last_success_at IS NULL OR s.last_success_at<=?) AND p.review_urgent=1))
      -- The redundant stage list proves the complete partial-index predicate.
      AND NOT EXISTS(SELECT 1 FROM maintenance_jobs j INDEXED BY maintenance_jobs_active_source_stage WHERE j.source_id=s.source_id
        AND j.stage='capture' AND j.stage IN('capture','extract','award') AND j.status IN('queued','running','retry'))
  ),anchored AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY source_id ORDER BY review_urgent DESC,coverage_band,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),scheduling_school_id) anchor_order FROM associations
  ),source_priority AS MATERIALIZED (
    SELECT anchored.*,CASE WHEN review_urgent=1 OR EXISTS(
      SELECT 1 FROM maintenance_target_sources x JOIN maintenance_record_targets t ON t.target_id=x.target_id
      WHERE x.source_id=anchored.source_id AND t.active=1 AND (
        julianday(json_extract(t.fields_json,'$.closesOn')||'T23:59:59+08:00') BETWEEN julianday(?) AND julianday(?)
        OR julianday(json_extract(t.fields_json,'$.deadline')||'T23:59:59+08:00') BETWEEN julianday(?) AND julianday(?))) THEN 1 ELSE 0 END scheduling_urgent
    FROM anchored WHERE anchor_order=1
  ),ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY scheduling_school_id ORDER BY scheduling_urgent DESC,COALESCE(last_attempt_at,''),due_at,source_id) school_order FROM source_priority
  ),chosen AS MATERIALIZED (
    SELECT * FROM ranked ORDER BY scheduling_urgent DESC,coverage_band,school_order,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),COALESCE(last_attempt_at,''),due_at,source_id LIMIT 40
  ) SELECT chosen.*,${schedulingSchoolIdsSql} school_ids_json,
    (SELECT json_group_array(json_object('closesOn',json_extract(t.fields_json,'$.closesOn'),'deadline',json_extract(t.fields_json,'$.deadline')))
      FROM maintenance_target_sources x JOIN maintenance_record_targets t ON t.target_id=x.target_id WHERE x.source_id=chosen.source_id AND t.active=1) scheduling_fields_json FROM chosen`)
    .bind(metadata,cfg.canary_json,nowIso(now),after(-86400000,now),nowIso(now),after(7*86400000,now),nowIso(now),after(7*86400000,now))
    .all<SourceRow&{school_ids_json:string;scheduling_fields_json:string;scheduling_school_id:string;school_last_attempt_at:string|null;school_last_dispatched_tick:number;scheduling_urgent:number}>()).results ?? []
  const due = selectScheduledJobs(candidates.map(row => Object.assign(withSchoolPriority(row), {
    stage:'capture',priority:row.scheduling_urgent ? 0 : 10,source_last_success_at:row.last_success_at,source_category:row.category,
  })), {limit:8,firstRoundComplete,now})
  for (const row of due) {
    const id = await digest(`capture:${row.source_id}:${row.due_at}`)
    const fields=JSON.parse((row as SourceRow&{scheduling_fields_json:string}).scheduling_fields_json)as Array<Record<string,unknown>>
    const reviewUrgent=Boolean(row.review_after)
    const priority=reviewUrgent||captureCadence(row,fields,now).priority===0?0:10
    await env.PIPELINE_DB.prepare("INSERT OR IGNORE INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,'capture','queued',?,?,?,?)").bind(id,row.source_id,priority,nowIso(now),nowIso(now),nowIso(now)).run()
  }
  // A crash after persist/before send leaves a due job for the next tick.
  // Read the due-job index once before school joins. Reversing these outer loops
  // would repeat the whole due range for every source (maintain has no source index).
  const pool = (await env.PIPELINE_DB.prepare(`WITH ${schedulingSchoolsSql},associations AS MATERIALIZED (
    SELECT j.*,s.category source_category,s.last_success_at source_last_success_at,p.university_id scheduling_school_id,p.school_last_attempt_at,p.school_last_dispatched_tick,p.coverage_band,
      CASE WHEN j.priority<=0 OR p.review_urgent=1 THEN 1 ELSE 0 END scheduling_urgent,
      CASE WHEN j.stage='award' OR s.category='scholarships' THEN 1 ELSE 0 END award_lane,
      CASE WHEN j.stage='maintain' OR(j.stage='capture' AND s.last_success_at IS NOT NULL) THEN 1 ELSE 0 END maintenance_lane
    FROM maintenance_jobs j CROSS JOIN maintenance_sources s CROSS JOIN maintenance_source_schools x CROSS JOIN school_priority p
    WHERE s.source_id=j.source_id AND s.enabled=1 AND x.source_id=j.source_id AND p.university_id=x.university_id
      AND j.status IN('queued','retry') AND j.due_at<=? AND (j.enqueued_at IS NULL OR j.enqueued_at<?)
      AND (j.stage='capture' OR ?=1) AND (j.stage<>'maintain' OR ?=1)
  ),anchored AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY job_id ORDER BY scheduling_urgent DESC,coverage_band,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),scheduling_school_id) anchor_order FROM associations
  ),school_ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY maintenance_lane,CASE WHEN maintenance_lane=0 THEN award_lane ELSE 0 END,scheduling_school_id ORDER BY scheduling_urgent DESC,priority,due_at,job_id) school_order FROM anchored WHERE anchor_order=1
  ),ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY maintenance_lane,CASE WHEN maintenance_lane=0 THEN award_lane ELSE 0 END ORDER BY scheduling_urgent DESC,coverage_band,school_order,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),priority,due_at,job_id) lane_order FROM school_ranked
  ),chosen AS MATERIALIZED (
    SELECT * FROM ranked WHERE lane_order<=40 ORDER BY scheduling_urgent DESC,coverage_band,school_order,school_last_dispatched_tick,COALESCE(school_last_attempt_at,''),priority,due_at,job_id LIMIT 120
  ) SELECT chosen.*,${schedulingSchoolIdsSql} school_ids_json FROM chosen`)
    .bind(metadata,cfg.canary_json,nowIso(now),after(-900000,now),cfg.models_enabled,cfg.targets_complete)
    .all<JobRow&{source_last_success_at:string|null;school_ids_json:string;source_category:string;scheduling_school_id:string;school_last_attempt_at:string|null;school_last_dispatched_tick:number}>()).results ?? []
  const jobs=selectScheduledJobs(pool.map(withSchoolPriority),{limit:8,firstRoundComplete,now})
  let queued = 0
  for (const job of jobs) {
    await env.MAINTENANCE_QUEUE.send({version:1,jobId:job.job_id})
    await env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET enqueued_at=? WHERE job_id=? AND status IN('queued','retry')").bind(nowIso(now),job.job_id).run(); queued++
  }
  const schoolRotationSaved=queued?await saveSchoolRotation(env,rotation,cfg.scope_sha256,scopeIds,[...new Set(jobs.map(job=>job.scheduling_school_id))],now):false
  // Read-only fetches may be retried after a lost lease. A model send cannot.
  await env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET status=CASE WHEN stage='capture' THEN 'retry' ELSE 'unknown' END,error_code='execution_lease_expired',lease_token=NULL,lease_until=NULL,due_at=?,enqueued_at=NULL,updated_at=? WHERE status='running' AND lease_until<?").bind(after(60000,now),nowIso(now),nowIso(now)).run()
  await event(env,'scheduler_tick',{queued,discoveredDueSources:due.length,firstRoundComplete,coverageSnapshotSha256:coverage?.sha256 ?? null,maintenanceShare:firstRoundComplete?0.7:0.3,schoolRotationSaved},now)
  return {enabled:true,queued}
}
export async function claimJob(env: MaintenanceEnv,id:string,now=Date.now()):Promise<JobRow|null> {
  const token=crypto.randomUUID()
  return env.PIPELINE_DB.prepare("UPDATE maintenance_jobs SET status='running',lease_token=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE job_id=? AND status IN('queued','retry') AND due_at<=? RETURNING *").bind(token,after(600000,now),nowIso(now),id,nowIso(now)).first<JobRow>()
}
export async function finishJob(env:MaintenanceEnv,job:JobRow,status:JobRow['status'],code:string|null=null,retrySeconds=0,now=Date.now()) {
  const result=await env.PIPELINE_DB.prepare('UPDATE maintenance_jobs SET status=?,error_code=?,due_at=?,updated_at=?,lease_token=NULL,lease_until=NULL,enqueued_at=NULL WHERE job_id=? AND status=\'running\' AND lease_token=?').bind(status,code,after(retrySeconds*1000,now),nowIso(now),job.job_id,job.lease_token).run()
  if(result.meta?.changes!==1) throw new MaintenanceError('job_lease_lost')
}
export async function queueExtraction(env:MaintenanceEnv,row:SourceRow,snapshotSha256:string,key:string,now=Date.now()) {
  const categories=row.categories_json?JSON.parse(row.categories_json)as string[]:[row.category]
  const hasAward=categories.some(category=>['university_scholarship','faculty_scholarship','government_scholarship'].includes(category))
  const stages=hasAward&&categories.every(category=>category.includes('scholarship'))?['award']:hasAward?['extract','award']:['extract']
  for(const stage of stages){const id=await digest(`${stage}:${row.source_id}:${snapshotSha256}:identity-v1`);await env.PIPELINE_DB.prepare("INSERT OR IGNORE INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key) VALUES(?,?,?,'queued',?,?,?,?,?)").bind(id,row.source_id,stage,nowIso(now),nowIso(now),nowIso(now),snapshotSha256,key).run()}
  const cfg=await control(env),targets=cfg?.targets_complete?await recordTargets(env,row.source_id):[],operations:SqlOperation[]=[],priority=captureCadence(row,targets.map(target=>target.fields),now).priority===0?0:1
  for(let index=0;index<targets.length;index+=20) {
    const chunk=targets.slice(index,index+20),pins=chunk.map(t=>({id:`${t.entityType}:${t.recordId}`,sha256:t.recordScopeSha256}))
    const maintenanceId=await digest(`maintain:${row.source_id}:${snapshotSha256}:${nowIso(now).slice(0,10)}:${canonical(pins)}:fields-v1`)
    operations.push({sql:"INSERT OR IGNORE INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json) VALUES(?,?,'maintain','queued',?,?,?,?,?,?,?)",values:[maintenanceId,row.source_id,priority,nowIso(now),nowIso(now),nowIso(now),snapshotSha256,key,canonical(pins)]})
  }
  const programs=targets.filter(target=>target.entityType==='program')
  for(let index=0;index<programs.length;index+=10){const chunk=programs.slice(index,index+10),pins=chunk.map(target=>({id:`program:${target.recordId}`,sha256:target.recordScopeSha256})),id=await digest(`cycle-discovery:${row.source_id}:${snapshotSha256}:${canonical(pins)}:v1`);operations.push({sql:"INSERT OR IGNORE INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json) VALUES(?,?,'maintain','queued',2,?,?,?,?,?,?)",values:[id,row.source_id,nowIso(now),nowIso(now),nowIso(now),snapshotSha256,key,canonical({kind:'cycle-discovery',targets:pins})]})}
  const grouped=coalesceOperations(operations)
  if(grouped.length>32)throw new MaintenanceError('source_target_partition_limit')
  if(grouped.length)await env.PIPELINE_DB.batch(grouped.map(operation=>env.PIPELINE_DB.prepare(operation.sql).bind(...operation.values)))
}
export async function recordTargets(env:MaintenanceEnv,sourceId:string,depth=0,seen=new Set<string>()):Promise<RecordTarget[]> {
  if(seen.has(sourceId))return[]
  if(seen.size>=8)throw new MaintenanceError('source_parent_partition_required')
  seen.add(sourceId)
  const rows=(await env.PIPELINE_DB.prepare('SELECT t.target_json FROM maintenance_record_targets t JOIN maintenance_target_sources x ON x.target_id=t.target_id WHERE x.source_id=? AND t.active=1 ORDER BY t.target_id').bind(sourceId).all<{target_json:string}>()).results??[]
  const targets=rows.map(row=>maintenanceRecordTargetSchema.parse(JSON.parse(row.target_json)))
  if(depth<2){const lineage=await env.SNAPSHOTS_BUCKET.get(`maintenance/discovery-lineage/${sourceId}.json`);if(lineage){const value=record(JSON.parse(await lineage.text()));if(value?.sourceId!==sourceId||!Array.isArray(value.parents)||value.parents.some(id=>typeof id!=='string'||!HASH.test(id)))throw new MaintenanceError('source_lineage_invalid');for(const parent of value.parents as string[]){for(const target of await recordTargets(env,parent,depth+1,seen))if(target.entityType==='program'&&!targets.some(current=>current.entityType===target.entityType&&current.recordId===target.recordId))targets.push({...target,sourceIds:[...new Set([...target.sourceIds,sourceId])]})}}}
  return targets
}
/** Bound UTF-8 JSON, including row-string escaping and array punctuation. */
function targetRevalidationManifests(rows:Array<{target_id:string;record_scope_sha256:string;target_json:string}>):string[] {
  const limit=64*1024,encoder=new TextEncoder(),chunks:string[]=[]
  let entries:string[]=[],bytes=2
  for(const row of rows){
    const entry=JSON.stringify(row),size=encoder.encode(entry).byteLength
    if(size+2>limit)throw new MaintenanceError('target_refresh_reuse_row_too_large')
    if(entries.length&&bytes+1+size>limit){chunks.push(`[${entries.join(',')}]`);entries=[];bytes=2}
    bytes+=size+(entries.length?1:0);entries.push(entry)
  }
  if(entries.length)chunks.push(`[${entries.join(',')}]`)
  return chunks
}
/** An identity/field-only ACK may leave the six-file catalog digest unchanged.
 * Reuse the immutable completed plan only after exact active-set readback. This
 * runs on the ACK path, never once per scheduler tick. */
async function restoreCompletedTargets(env:MaintenanceEnv,cfg:Control,refreshSha256:string,targets:RecordTarget[]) {
  const row=await env.PIPELINE_DB.prepare("SELECT plan_sha256,input_catalog_sha256 FROM maintenance_target_refreshes WHERE refresh_sha256=? AND status='completed'").bind(refreshSha256).first<{plan_sha256:string;input_catalog_sha256:string}>()
  const artifact=await env.SNAPSHOTS_BUCKET.get(`maintenance/target-refresh/${refreshSha256}.json`)
  if(!row||row.input_catalog_sha256!==cfg.input_catalog_sha256||!artifact||artifact.size!==undefined&&artifact.size>24*1024*1024)throw new MaintenanceError('target_refresh_reuse_artifact_unavailable')
  const bytes=await artifact.text(),plan=JSON.parse(bytes)as {refreshSha256:string;inputCatalogSha256:string;expectedCount:number}
  if(await digest(bytes)!==row.plan_sha256||plan.refreshSha256!==refreshSha256||plan.inputCatalogSha256!==cfg.input_catalog_sha256||plan.expectedCount!==targets.length)throw new MaintenanceError('target_refresh_reuse_plan_mismatch')
  const active=(await env.PIPELINE_DB.prepare('SELECT target_id,record_scope_sha256,target_json FROM maintenance_record_targets WHERE active=1 ORDER BY target_id').all<{target_id:string;record_scope_sha256:string;target_json:string}>()).results??[]
  const sorted=(values:RecordTarget[])=>[...values].sort((a,b)=>`${a.entityType}:${a.recordId}`.localeCompare(`${b.entityType}:${b.recordId}`))
  if(active.length!==targets.length||canonical(sorted(active.map(row=>maintenanceRecordTargetSchema.parse(JSON.parse(row.target_json)))))!==canonical(sorted(targets))
    ||active.some(row=>row.record_scope_sha256!==JSON.parse(row.target_json).recordScopeSha256))throw new MaintenanceError('target_refresh_reuse_active_set_mismatch')
  const registered=new Set(((await env.PIPELINE_DB.prepare('SELECT source_id FROM maintenance_sources').all<{source_id:string}>()).results??[]).map(row=>row.source_id))
  const expectedBindings=targets.flatMap(target=>[...new Set(target.sourceIds)].filter(id=>registered.has(id)).map(sourceId=>[`${target.entityType}:${target.recordId}`,sourceId]))
  const actualBindings=(await env.PIPELINE_DB.prepare('SELECT x.target_id,x.source_id FROM maintenance_target_sources x JOIN maintenance_record_targets t ON t.target_id=x.target_id WHERE t.active=1').all<{target_id:string;source_id:string}>()).results??[]
  const bindingKey=(pair:string[])=>pair.join('\u0000')
  if(canonical(actualBindings.map(row=>bindingKey([row.target_id,row.source_id])).sort())!==canonical(expectedBindings.map(bindingKey).sort()))throw new MaintenanceError('target_refresh_reuse_source_set_mismatch')
  const manifests=targetRevalidationManifests(active),guard=crypto.randomUUID(),rowGuards=manifests.map(()=>crypto.randomUUID()),at=nowIso()
  // D1 strings are bounded. Every full-row comparison still runs in the same
  // atomic transaction as the control CAS; a late chunk failure rolls it all back.
  try{await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND revision=? AND targets_complete=0) AND EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE refresh_sha256=? AND status='completed' AND plan_sha256=?) AND NOT EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE status='staged' AND input_catalog_sha256=?) AND (SELECT COUNT(*) FROM maintenance_record_targets WHERE active=1)=? THEN 1 ELSE 0 END))")
      .bind(guard,cfg.scope_sha256,cfg.input_catalog_sha256,cfg.revision,refreshSha256,row.plan_sha256,cfg.input_catalog_sha256,active.length),
    ...manifests.map((manifest,index)=>env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?) m LEFT JOIN maintenance_record_targets t ON t.target_id=json_extract(m.value,'$.target_id') WHERE t.target_id IS NULL OR t.active<>1 OR t.target_json<>json_extract(m.value,'$.target_json') OR t.record_scope_sha256<>json_extract(m.value,'$.record_scope_sha256')) THEN 1 ELSE 0 END))").bind(rowGuards[index],manifest)),
    env.PIPELINE_DB.prepare('UPDATE maintenance_control SET targets_complete=1,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=? AND input_catalog_sha256=? AND targets_complete=0').bind(at,cfg.revision,cfg.input_catalog_sha256),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(),'targets_revalidated',at,canonical({refreshSha256,inputCatalogSha256:cfg.input_catalog_sha256,recordTargets:targets.length,fromRevision:cfg.revision,toRevision:cfg.revision+1})),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id IN(SELECT value FROM json_each(?))').bind(JSON.stringify([guard,...rowGuards])),
  ])}catch{throw new MaintenanceError('target_refresh_reuse_control_changed')}
}
export async function refreshTargets(env:MaintenanceEnv,value:unknown,staged=false,repairFence?:{expectedRevision:number}) {
  const raw=record(value),cfg=await control(env)
  if(!cfg?.seed_complete||!raw||raw.inputCatalogSha256!==cfg.input_catalog_sha256||!Array.isArray(raw.recordTargets)||raw.recordTargets.length>10000)throw new MaintenanceError('target_refresh_catalogue_mismatch')
  if(repairFence&&(cfg.revision!==repairFence.expectedRevision||cfg.enabled!==0||cfg.models_enabled!==0||cfg.targets_complete!==0))throw new MaintenanceError('target_refresh_repair_control_changed')
  const targets=raw.recordTargets.map(target=>maintenanceRecordTargetSchema.parse(target)),ids=new Set<string>()
  const schools=new Set(((await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools').all<{university_id:string}>()).results??[]).map(row=>row.university_id))
  const coverage = raw.coverageSnapshot === undefined ? null : await validateCoverageSnapshot(raw.coverageSnapshot,{scopeRegistrySha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,schoolIds:schools,today:getTodayDate()})
  if(coverage)await storeCoverageSnapshot(env,coverage)
  const sources=new Set(((await env.PIPELINE_DB.prepare('SELECT source_id FROM maintenance_sources').all<{source_id:string}>()).results??[]).map(row=>row.source_id))
  for(const target of targets){const id=`${target.entityType}:${target.recordId}`;if(ids.has(id)||!schools.has(target.universityId)||!target.recordId.trim()||target.recordId.length>512||/[\u0000-\u001f]/u.test(target.recordId))throw new MaintenanceError('invalid_target_refresh_scope');ids.add(id)}
  const refreshSha256=await digest(canonical({inputCatalogSha256:raw.inputCatalogSha256,recordTargets:targets}))
  const prior=await env.PIPELINE_DB.prepare('SELECT status FROM maintenance_target_refreshes WHERE refresh_sha256=?').bind(refreshSha256).first<{status:string}>()
  if(prior?.status==='completed'){
    if(!cfg.targets_complete&&staged){
      await env.SNAPSHOTS_BUCKET.put(`maintenance/target-refresh/revalidate/${refreshSha256}.json`,canonical({scopeRegistrySha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,recordTargets:targets,...(coverage?{coverageSnapshot:coverage}:{})}),{httpMetadata:{contentType:'application/json'}})
      await env.MAINTENANCE_QUEUE.send({version:1,jobId:refreshSha256,targetRefreshSha256:refreshSha256})
      return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:false,reused:true,revalidationQueued:true}
    }
    if(!cfg.targets_complete)await restoreCompletedTargets(env,cfg,refreshSha256,targets)
    if(coverage)await publishCoverageSnapshot(env,coverage)
    return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:true,reused:true,coverageSnapshotSha256:coverage?.sha256 ?? null}
  }
  if(prior?.status==='staged'){if(staged){await env.MAINTENANCE_QUEUE.send({version:1,jobId:refreshSha256,targetRefreshSha256:refreshSha256});return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:false,reused:true}}while(!(await control(env))?.targets_complete)await continueTargetRefresh(env,refreshSha256,false);return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:true,reused:true}}
  if(!repairFence)await env.PIPELINE_DB.prepare('UPDATE maintenance_control SET targets_complete=0 WHERE singleton=1 AND input_catalog_sha256=?').bind(cfg.input_catalog_sha256).run()
  const operations:SqlOperation[]=[{sql:'UPDATE maintenance_record_targets SET active=0',values:[]}]
  const add=(sql:string,...values:unknown[])=>operations.push({sql,values})
  for(const target of targets) {
    const id=`${target.entityType}:${target.recordId}`
    add('INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json,active) VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(target_id) DO UPDATE SET record_scope_sha256=excluded.record_scope_sha256,academic_year=excluded.academic_year,intake=excluded.intake,fields_json=excluded.fields_json,target_json=excluded.target_json,active=1',id,target.recordId,target.entityType,target.universityId,target.recordScopeSha256,target.year,target.intake,JSON.stringify(target.fields),JSON.stringify(target))
    add('DELETE FROM maintenance_target_sources WHERE target_id=?',id)
    for(const sourceId of new Set(target.sourceIds))if(sources.has(sourceId))add('INSERT OR IGNORE INTO maintenance_target_sources VALUES(?,?)',id,sourceId)
  }
  const plan={refreshSha256,inputCatalogSha256:cfg.input_catalog_sha256,expectedCount:targets.length,...(coverage?{coverageSnapshot:coverage}:{}),operations:coalesceOperations(operations)},bytes=canonical(plan),planSha256=await digest(bytes)
  await env.SNAPSHOTS_BUCKET.put(`maintenance/target-refresh/${refreshSha256}.json`,bytes,{httpMetadata:{contentType:'application/json'}})
  const insert=env.PIPELINE_DB.prepare("INSERT INTO maintenance_target_refreshes(refresh_sha256,input_catalog_sha256,plan_sha256,total_operations,expected_count,status,created_at) VALUES(?,?,?,?,?,'staged',?)").bind(refreshSha256,cfg.input_catalog_sha256,planSha256,plan.operations.length,targets.length,nowIso())
  if(repairFence){
    const repairGuard=crypto.randomUUID()
    try{await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND input_catalog_sha256=? AND revision=? AND enabled=0 AND models_enabled=0 AND targets_complete=0) AND NOT EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE refresh_sha256=?) THEN 1 ELSE 0 END))").bind(repairGuard,cfg.input_catalog_sha256,repairFence.expectedRevision,refreshSha256),insert,
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(repairGuard),
    ])}catch{
      const current=await control(env),existing=await env.PIPELINE_DB.prepare('SELECT status FROM maintenance_target_refreshes WHERE refresh_sha256=? AND input_catalog_sha256=?').bind(refreshSha256,cfg.input_catalog_sha256).first<{status:string}>()
      if(current?.revision!==repairFence.expectedRevision||current.enabled!==0||current.models_enabled!==0||current.targets_complete!==0||existing?.status!=='staged')throw new MaintenanceError('target_refresh_repair_control_changed')
    }
  }else await insert.run()
  if(staged){await env.MAINTENANCE_QUEUE.send({version:1,jobId:refreshSha256,targetRefreshSha256:refreshSha256});return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:false,reused:false}}
  while(!(await control(env))?.targets_complete)await continueTargetRefresh(env,refreshSha256,false)
  return{ok:true,recordTargets:targets.length,refreshSha256,targetsComplete:true,reused:false}
}
export async function continueTargetRefresh(env:MaintenanceEnv,refreshSha256:string,enqueue=true) {
  const cfg=await control(env),row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_target_refreshes WHERE refresh_sha256=?').bind(refreshSha256).first<{status:string;input_catalog_sha256:string;plan_sha256:string;total_operations:number;completed_operations:number;expected_count:number}>()
  if(!cfg||!row)throw new MaintenanceError('target_refresh_unavailable')
  if(row.status==='completed'){
    if(!cfg.targets_complete){
      const request=await env.SNAPSHOTS_BUCKET.get(`maintenance/target-refresh/revalidate/${refreshSha256}.json`)
      if(!request||request.size!==undefined&&request.size>24*1024*1024)throw new MaintenanceError('target_refresh_reuse_request_unavailable')
      const input=JSON.parse(await request.text())as {scopeRegistrySha256:string;inputCatalogSha256:string;recordTargets:unknown[];coverageSnapshot?:CoverageSnapshot}
      if(input.scopeRegistrySha256!==cfg.scope_sha256||input.inputCatalogSha256!==cfg.input_catalog_sha256||!Array.isArray(input.recordTargets)||input.recordTargets.length>10000)throw new MaintenanceError('target_refresh_reuse_request_mismatch')
      const targets=input.recordTargets.map(value=>maintenanceRecordTargetSchema.parse(value))
      if(await digest(canonical({inputCatalogSha256:input.inputCatalogSha256,recordTargets:targets}))!==refreshSha256)throw new MaintenanceError('target_refresh_reuse_request_mismatch')
      await restoreCompletedTargets(env,cfg,refreshSha256,targets)
      if(input.coverageSnapshot&&input.coverageSnapshot.evaluatedOn===getTodayDate())await publishCoverageSnapshot(env,input.coverageSnapshot)
    }
    return{targetsComplete:true}
  }
  if(row.status==='superseded')return{targetsComplete:false,superseded:true}
  if(cfg.input_catalog_sha256!==row.input_catalog_sha256){await env.PIPELINE_DB.prepare("UPDATE maintenance_target_refreshes SET status='superseded' WHERE refresh_sha256=?").bind(refreshSha256).run();return{targetsComplete:false,superseded:true}}
  const artifact=await env.SNAPSHOTS_BUCKET.get(`maintenance/target-refresh/${refreshSha256}.json`)
  if(!artifact||artifact.size!==undefined&&artifact.size>24*1024*1024)throw new MaintenanceError('target_refresh_plan_unavailable')
  const bytes=await artifact.text()
  if(await digest(bytes)!==row.plan_sha256)throw new MaintenanceError('target_refresh_plan_checksum_mismatch')
  const plan=JSON.parse(bytes)as {refreshSha256:string;inputCatalogSha256:string;expectedCount:number;coverageSnapshot?:CoverageSnapshot;operations:SqlOperation[]}
  if(plan.refreshSha256!==refreshSha256||plan.inputCatalogSha256!==cfg.input_catalog_sha256||plan.operations.length!==row.total_operations)throw new MaintenanceError('target_refresh_plan_manifest_mismatch')
  const chunk=plan.operations.slice(row.completed_operations,row.completed_operations+32),offset=row.completed_operations+chunk.length,guardId=crypto.randomUUID()
  if(chunk.length)await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND input_catalog_sha256=? AND targets_complete=0) AND EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE refresh_sha256=? AND completed_operations=? AND status='staged') THEN 1 ELSE 0 END))").bind(guardId,cfg.input_catalog_sha256,refreshSha256,row.completed_operations),
    ...chunk.map(operation=>env.PIPELINE_DB.prepare(operation.sql).bind(...operation.values)),
    env.PIPELINE_DB.prepare('UPDATE maintenance_target_refreshes SET completed_operations=? WHERE refresh_sha256=?').bind(offset,refreshSha256),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId),
  ])
  if(offset<row.total_operations){if(enqueue)await env.MAINTENANCE_QUEUE.send({version:1,jobId:refreshSha256,targetRefreshSha256:refreshSha256});return{targetsComplete:false,completedOperations:offset,totalOperations:row.total_operations}}
  const count=await env.PIPELINE_DB.prepare('SELECT COUNT(*) count FROM maintenance_record_targets WHERE active=1').first<{count:number}>()
  if(count?.count!==row.expected_count)throw new MaintenanceError('target_refresh_readback_mismatch')
  const completionGuard=crypto.randomUUID(),completedAt=nowIso()
  try {
    // Publish the completed target set, its revision and audit event together.
    // A duplicate finishing delivery must never increment the revision twice.
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND input_catalog_sha256=? AND revision=? AND targets_complete=0) AND EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE refresh_sha256=? AND input_catalog_sha256=? AND status='staged' AND completed_operations=total_operations AND expected_count=(SELECT COUNT(*) FROM maintenance_record_targets WHERE active=1)) THEN 1 ELSE 0 END))").bind(completionGuard,cfg.input_catalog_sha256,cfg.revision,refreshSha256,cfg.input_catalog_sha256),
      env.PIPELINE_DB.prepare('UPDATE maintenance_control SET targets_complete=1,revision=revision+1,updated_at=? WHERE singleton=1 AND input_catalog_sha256=? AND revision=? AND targets_complete=0').bind(completedAt,cfg.input_catalog_sha256,cfg.revision),
      env.PIPELINE_DB.prepare("UPDATE maintenance_target_refreshes SET status='completed' WHERE refresh_sha256=? AND status='staged' AND completed_operations=total_operations").bind(refreshSha256),
      env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(),'targets_refreshed',completedAt,JSON.stringify({inputCatalogSha256:cfg.input_catalog_sha256,recordTargets:row.expected_count,refreshSha256,fromRevision:cfg.revision,toRevision:cfg.revision+1})),
      ...(plan.coverageSnapshot ? [env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(),'coverage_snapshot',completedAt,canonical(coverageEvent(plan.coverageSnapshot)))] : []),
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(completionGuard),
    ])
  } catch {
    const finished=await env.PIPELINE_DB.prepare('SELECT status,input_catalog_sha256 FROM maintenance_target_refreshes WHERE refresh_sha256=?').bind(refreshSha256).first<{status:string;input_catalog_sha256:string}>(),current=await control(env)
    if(finished?.status!=='completed'||finished.input_catalog_sha256!==cfg.input_catalog_sha256||current?.input_catalog_sha256!==cfg.input_catalog_sha256||current.targets_complete!==1)throw new MaintenanceError('target_refresh_completion_conflict')
  }
  return{targetsComplete:true,completedOperations:offset,totalOperations:row.total_operations}
}
export async function status(env:MaintenanceEnv) {
  const cfg=await control(env)
  const unknownJobDisposition=(await readUnknownJobDisposition(env,cfg)).summary
  const unknownModelDisposition=(await readLegacyModelDisposition(env,cfg)).summary
  const reconciliationGate=await nativeReconciliationGate(env)
  const [jobs,proposals,sources,attempts,latest,coverage]=await Promise.all([
    env.PIPELINE_DB.prepare('SELECT stage,status,COUNT(*) count,MIN(created_at) oldest_at FROM maintenance_jobs GROUP BY stage,status').all(),
    env.PIPELINE_DB.prepare('SELECT status,COUNT(*) count FROM maintenance_proposals GROUP BY status').all(),
    env.PIPELINE_DB.prepare('SELECT COUNT(*) total,SUM(enabled) enabled,MIN(last_success_at) oldest_success,MAX(last_success_at) newest_success FROM maintenance_sources').first(),
    env.PIPELINE_DB.prepare('SELECT status,COUNT(*) count FROM maintenance_model_attempts GROUP BY status').all(),
    env.PIPELINE_DB.prepare('SELECT kind,observed_at FROM maintenance_events ORDER BY observed_at DESC LIMIT 1').first(),
    env.PIPELINE_DB.prepare("SELECT (SELECT COUNT(*) FROM maintenance_record_targets WHERE active=1) record_targets,(SELECT COUNT(DISTINCT x.university_id) FROM maintenance_source_schools x JOIN maintenance_observations o ON o.source_id=x.source_id) schools_with_actual_source_observation,(SELECT COUNT(*) FROM maintenance_schools WHERE last_attempt_at IS NOT NULL) schools_with_actual_source_attempt,(SELECT COUNT(*) FROM maintenance_legacy_guards) legacy_guards").first(),
  ])
  const programCoverage=cfg?.seed_complete&&cfg.targets_complete?await readCoverageSnapshot(env,cfg.input_catalog_sha256,cfg.scope_sha256):null
  return {format:'studyinchina.cloud-maintenance-status',version:1,observedAt:nowIso(),enabled:env.MAINTENANCE_ENABLED==='true'&&Boolean(cfg?.enabled)&&reconciliationGate.ready,modelEnabled:Boolean(cfg?.models_enabled)&&reconciliationGate.ready,reconciliationGate,scopeCount:cfg?expectedScopeSchoolCount(env):0,control:cfg,unknownJobDisposition,unknownModelDisposition,jobs:jobs.results??[],proposals:proposals.results??[],sources,modelAttempts:attempts.results??[],coverage:{...coverage,...(programCoverage?{snapshotSha256:programCoverage.sha256,evaluatedOn:programCoverage.evaluatedOn,inputCatalogSha256:programCoverage.inputCatalogSha256,scopeRegistrySha256:programCoverage.scopeRegistrySha256}:{})},lastEvent:latest,websiteBackendChanged:false}
}
