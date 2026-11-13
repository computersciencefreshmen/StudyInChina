import pinned from '../../../content/maintenance/legacy-model-no-replay-policy.v1.json'
import type { Control, MaintenanceEnv, ModelRequest } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, gateRequest, HASH, nowIso, record } from './util'
import { readLegacyReconciliationPackage, readLegacyReconciliationManifest, readLegacyReconciliationEvidence, readFinalReceipt, assertLegacyReceiptMatchesPackage } from './legacy-reconciliation-evidence'
import { canonicalLegacyRequestDescriptors, type LegacyReconciliationPackage } from './legacy-reconciliation-contracts'
import { isPinnedScopeTransition, scopeUpgradeLineage } from './scope-config'
import { isDailyD1QuotaError } from './backend-errors'

export const LEGACY_UNKNOWN_POLICY_SHA256 = 'd6e47532b56a5d2d6392927d0a10b4118f1b2b2c2c77a9874693886ead68d410'
export const LEGACY_UNKNOWN_GUARD_SET_SHA256 = 'c7ad1e88e1c7bddd07dc273ed23c7bcc4d3d54d1ab646beeb7cc3321f823c958'
const fields = ['reservation_key','attempt_id','source_id','snapshot_sha256','pass','request_sha256','model','status','started_at','completed_at','output_key','output_sha256','usage_json','quota_json','error_code'] as const
const attemptsJson = canonical(pinned.subjects.map(s => s.attempt))
const sourcesJson = canonical(pinned.subjects.map(s => s.source))
const fail = (code: string): never => { throw new MaintenanceError(code) }
const PREFIX = 'maintenance/legacy-model-guards/registrations/'
const KIND = 'legacy_model_guards_registered'
const eventId = (sha256: string) => `legacy-model-guards:${sha256}`
export const LEGACY_UNKNOWN_REGISTRATION_INTENT = { format: 'studyinchina.legacy-model-guard-registration-intent', version: 1,
  policySha256: LEGACY_UNKNOWN_POLICY_SHA256, guardSetSha256: LEGACY_UNKNOWN_GUARD_SET_SHA256, legacyManifestSha256: pinned.manifestSha256,
  decision: 'preserve_unknown_permanent_no_replay' }
export const legacyUnknownRegistrationIntentSha256 = () => digest(canonical(LEGACY_UNKNOWN_REGISTRATION_INTENT))

async function policy() {
  if (await digest(canonical(pinned)) !== LEGACY_UNKNOWN_POLICY_SHA256 || await digest(canonical(pinned.subjects)) !== LEGACY_UNKNOWN_GUARD_SET_SHA256)
    fail('legacy_model_guard_policy_corrupt')
}
async function checkedBytes(env: MaintenanceEnv, key: string, max: number) {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > max) return fail('legacy_model_guard_artifact_missing')
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength > max) return fail('legacy_model_guard_artifact_oversized')
  return bytes
}

/** This denial does not depend on a scope, model, reservation key or an operator
 * disposition. The source/canonical columns come from D1, never /model/run. */
export async function legacyModelNoReplayReason(env: MaintenanceEnv, input: ModelRequest,
  source: { raw_sha256: string | null; canonical_sha256?: string | null; snapshot_key?: string | null }): Promise<string | null> {
  await policy()
  if (pinned.subjects.some(s => s.attempt.source_id === input.sourceId || s.attempt.snapshot_sha256 === input.snapshotSha256
    || s.attempt.reservation_key === input.reservationKey)) return 'legacy_model_replay_protected'
  const payloadSha256 = await digest(input.payload)
  if (pinned.subjects.some(s => s.attempt.request_sha256 === payloadSha256)) return 'legacy_model_replay_protected'
  if (source.raw_sha256 !== input.snapshotSha256 || !HASH.test(String(source.canonical_sha256))) return 'legacy_model_source_text_unproven'
  let textSha256 = source.canonical_sha256!
  if (textSha256 === source.raw_sha256) {
    const derived = await env.PIPELINE_DB.prepare('SELECT text_sha256 FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?')
      .bind(input.sourceId, input.snapshotSha256).first<{ text_sha256: string }>()
    if (derived) textSha256 = derived.text_sha256
    else {
      const key = `maintenance/snapshots/${input.sourceId}/${input.snapshotSha256}.json`
      if (source.snapshot_key !== key) return 'legacy_model_source_text_unproven'
      const snapshot = record(JSON.parse(new TextDecoder().decode(await checkedBytes(env, key, 64 * 1024))))
      if (snapshot?.sourceId !== input.sourceId || snapshot.rawSha256 !== input.snapshotSha256 || !HASH.test(String(snapshot.textSha256))
        || snapshot.textKey !== `maintenance/text/${input.sourceId}/${snapshot.textSha256}.txt`) return 'legacy_model_source_text_unproven'
      const text = await checkedBytes(env, String(snapshot.textKey), 10 * 1024 * 1024)
      if (await digest(text) !== snapshot.textSha256) return 'legacy_model_source_text_unproven'
      textSha256 = String(snapshot.textSha256)
    }
  }
  if (!HASH.test(textSha256)) return 'legacy_model_source_text_unproven'
  return pinned.subjects.some(s => s.textSha256 === textSha256) ? 'legacy_model_replay_protected' : null
}

/** Full immutable SQL tuples, including nullable result/usage/quota columns. */
export function matchingLegacyUnknownAttemptsSql() {
  return `SELECT a.attempt_id FROM maintenance_model_attempts a JOIN json_each(?) p ON a.attempt_id=json_extract(p.value,'$.attempt_id') WHERE ${fields.map(f => `a.${f} IS json_extract(p.value,'$.${f}')`).join(' AND ')}`
}
export async function verifyLegacyUnknownRows(env: MaintenanceEnv) {
  await policy()
  const rows = (await env.PIPELINE_DB.prepare(matchingLegacyUnknownAttemptsSql()).bind(attemptsJson).all<{ attempt_id: string }>()).results ?? []
  if (rows.length !== 3) fail('legacy_model_guard_attempt_changed')
}

export async function verifyLegacyUnknownArtifacts(env: MaintenanceEnv) {
  await policy()
  for (const subject of pinned.subjects) {
    const source = await env.PIPELINE_DB.prepare('SELECT source_id,url,allowed_hosts_json FROM maintenance_sources WHERE source_id=?')
      .bind(subject.source.source_id).first()
    if (!source || canonical({ ...source }) !== canonical(subject.source)) fail('legacy_model_guard_source_changed')
    for (const ref of [subject.snapshot, subject.raw, subject.text]) {
      const bytes = await checkedBytes(env, ref.objectKey, 1024 * 1024)
      if (bytes.byteLength !== ref.byteLength || await digest(bytes) !== ref.sha256) fail('legacy_model_guard_artifact_corrupt')
    }
    const snapshot = record(JSON.parse(new TextDecoder().decode(await checkedBytes(env, subject.snapshot.objectKey, 64 * 1024))))
    if (snapshot?.sourceId !== subject.attempt.source_id || snapshot.rawSha256 !== subject.attempt.snapshot_sha256
      || snapshot.sourceUrl !== subject.source.url || snapshot.rawKey !== subject.raw.objectKey || snapshot.textKey !== subject.text.objectKey
      || snapshot.textSha256 !== subject.textSha256 || subject.text.sha256 !== subject.textSha256) fail('legacy_model_guard_snapshot_binding_invalid')
  }
}

function matchingSourcesSql() {
  return "SELECT s.source_id FROM maintenance_sources s JOIN json_each(?) p ON s.source_id=json_extract(p.value,'$.source_id') WHERE s.url IS json_extract(p.value,'$.url') AND s.allowed_hosts_json IS json_extract(p.value,'$.allowed_hosts_json')"
}
async function packageBinding(p: LegacyReconciliationPackage) {
  await policy()
  if (p.legacyBatchId !== pinned.batchId || p.legacyManifestSha256 !== pinned.manifestSha256
    || p.unknownGuardPolicySha256 !== LEGACY_UNKNOWN_POLICY_SHA256 || p.unknownGuardSetSha256 !== LEGACY_UNKNOWN_GUARD_SET_SHA256
    || p.registrationIntentSha256 !== await legacyUnknownRegistrationIntentSha256()
    || p.sourceAccountId !== '78969c65bfdd892bb12c116869ea91cf' || p.targetAccountId !== 'b75f28d574289c29e9bda60a2fca27ed'
    || p.pipelineDatabaseId !== '43e2d4a5-54a4-4932-97f3-755be12ef8bb'
    || canonical(p.requestDescriptors.filter(r => r.status === 'unknown').sort((a,b) => a.attempt_id.localeCompare(b.attempt_id))) !== attemptsJson)
    fail('legacy_model_guard_package_mismatch')
}
async function migrationProof(env: MaintenanceEnv, p: LegacyReconciliationPackage, now: number) {
  const relay = record(await readLegacyReconciliationEvidence(env,p.migrationReceipt))
  const response = await gateRequest(env,'/model-state-migration/status',{})
  if(!response.ok)return fail('legacy_model_guard_finalized_migration_required')
  const actual=record(await response.json())
  if(!relay||!actual||actual.ok!==true||actual.role!=='target'||actual.state!=='finalized'
    ||relay.format!=='studyinchina.model-state-migration-report'||relay.version!==1||relay.state!=='finalized'
    ||relay.sourceFrozen!==true||relay.targetFinalized!==true||relay.modelCallsPerformed!==false||relay.controlsChanged!==false
    ||actual.manifestSha256!==p.migrationManifestSha256||relay.manifestSha256!==actual.manifestSha256
    ||typeof actual.finalizedAt!=='string'||!Number.isFinite(Date.parse(actual.finalizedAt))||Date.parse(actual.finalizedAt)>now
    ||['migrationId','sourceAccountId','targetAccountId'].some(k=>actual[k]!==p[k as 'migrationId'|'sourceAccountId'|'targetAccountId']||relay[k]!==undefined&&relay[k]!==actual[k]))
    return fail('legacy_model_guard_finalized_migration_required')
  for(const k of ['entryCount','requestCount','pageCount'] as const)if(!Number.isSafeInteger(actual[k])||Number(actual[k])<0||relay[k]!==actual[k])fail('legacy_model_guard_migration_counts_invalid')
  const aux=actual.auxiliaryEntryCount??0,relayAux=relay.auxiliaryEntryCount??0,states=record(actual.states)
  if(!Number.isSafeInteger(aux)||Number(aux)<0||relayAux!==aux||actual.importedPages!==actual.pageCount||Number(actual.pageCount)<1
    ||!states||canonical(states)!==canonical(relay.states)||Object.keys(states).sort().join(',')!=='completed,known_failed,send_started,unknown'
    ||Object.values(states).some(v=>!Number.isSafeInteger(v)||Number(v)<0)||Object.values(states).reduce<number>((sum,v)=>sum+Number(v),0)!==actual.requestCount
    ||![0,1].includes(Number(actual.entryCount)-Number(actual.requestCount)-Number(aux)))fail('legacy_model_guard_migration_counts_invalid')
}

type Registration = { format: 'studyinchina.legacy-model-guard-registration'; version: 1; reconciliationSha256: string; operationId: string;
  policySha256: string; guardSetSha256: string; registrationIntentSha256: string; legacyManifestSha256: string;
  scopeRegistrySha256: string; inputCatalogSha256: string; seedSha256: string; legacyGuardSha256: string; registeredAgainstRevision: number;
  migrationManifestSha256: string; registeredAt: string; replayAllowed: false; modelCallsPerformed: false }
const registrationContent = (p: LegacyReconciliationPackage, reconciliationSha256: string, registeredAt: string): Registration => ({
  format:'studyinchina.legacy-model-guard-registration',version:1,reconciliationSha256,operationId:p.operationId,
  policySha256:LEGACY_UNKNOWN_POLICY_SHA256,guardSetSha256:LEGACY_UNKNOWN_GUARD_SET_SHA256,registrationIntentSha256:p.registrationIntentSha256,
  legacyManifestSha256:p.legacyManifestSha256,scopeRegistrySha256:p.scopeRegistrySha256,inputCatalogSha256:p.inputCatalogSha256,
  seedSha256:p.seedSha256,legacyGuardSha256:p.legacyGuardSha256,registeredAgainstRevision:p.controlRevision,
  migrationManifestSha256:p.migrationManifestSha256,registeredAt,replayAllowed:false,modelCallsPerformed:false,
})
const publicRegistration = (r: Awaited<ReturnType<typeof verifyLegacyModelGuardRegistration>>) => ({registered:true,policySha256:r.policySha256,
  registrationSha256:r.registrationSha256,guardSetSha256:r.guardSetSha256,exactUnknownCount:r.exactUnknownCount,modelCallsPerformed:false,replayAllowed:false})

/** Shared with DO reconciliation: this is a fresh reader, never a caller bool. */
export async function verifyLegacyModelGuardRegistration(env: MaintenanceEnv, reconciliationSha256: string) {
  if(!HASH.test(reconciliationSha256))return fail('legacy_model_guard_package_invalid')
  const p=await readLegacyReconciliationPackage(env,reconciliationSha256);await packageBinding(p)
  const row=await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(eventId(reconciliationSha256)).first<{kind:string;details_json:string}>()
  if(row?.kind!==KIND)return fail('legacy_model_guard_registration_required')
  const c=record(JSON.parse(row.details_json))
  if(!c||!HASH.test(String(c.sha256))||c.objectKey!==`${PREFIX}${c.sha256}.json`
    ||canonical(c)!==row.details_json||canonical(c)!==canonical({objectKey:c.objectKey,sha256:c.sha256,reconciliationSha256,policySha256:LEGACY_UNKNOWN_POLICY_SHA256,guardSetSha256:LEGACY_UNKNOWN_GUARD_SET_SHA256}))return fail('legacy_model_guard_registration_invalid')
  const bytes=await checkedBytes(env,String(c.objectKey),8192),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),r=record(JSON.parse(text))
  if(await digest(bytes)!==c.sha256||!r||typeof r.registeredAt!=='string'||!Number.isFinite(Date.parse(r.registeredAt))||Date.parse(r.registeredAt)>Date.now()
    ||canonical(r)!==text||text!==canonical(registrationContent(p,reconciliationSha256,r.registeredAt)))return fail('legacy_model_guard_registration_corrupt')
  await verifyLegacyUnknownRows(env);await verifyLegacyUnknownArtifacts(env)
  return{policySha256:LEGACY_UNKNOWN_POLICY_SHA256,registrationSha256:String(c.sha256),guardSetSha256:LEGACY_UNKNOWN_GUARD_SET_SHA256,exactUnknownCount:3 as const,
    registrationEventId:eventId(reconciliationSha256),registrationDetails:row.details_json,package:p}
}

/** Authenticated target-only registration. All facts come from the immutable
 * reviewed package and fresh D1/R2/DO reads, never supplied hash aliases. */
export async function registerLegacyModelGuards(env: MaintenanceEnv,value: unknown,now=Date.now()) {
  const raw=record(value)
  if(!raw||Object.keys(raw).sort().join(',')!=='expectedRevision,reconciliationSha256'||!Number.isSafeInteger(raw.expectedRevision)||!HASH.test(String(raw.reconciliationSha256)))return fail('legacy_model_guard_registration_request_invalid')
  const sha=String(raw.reconciliationSha256),p=await readLegacyReconciliationPackage(env,sha);await packageBinding(p)
  if(env.MAINTENANCE_ENABLED!=='false'||env.MODEL_STATE_MIGRATION_ROLE!=='target'||env.MODEL_STATE_MIGRATION_ID!==p.migrationId
    ||env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID!==p.sourceAccountId||env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID!==p.targetAccountId)return fail('legacy_model_guard_target_freeze_required')
  const cfg=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_control WHERE singleton=1').first<Control>()
  if(!cfg||cfg.revision!==raw.expectedRevision||cfg.revision!==p.controlRevision||cfg.scope_sha256!==p.scopeRegistrySha256||cfg.input_catalog_sha256!==p.inputCatalogSha256
    ||cfg.seed_sha256!==p.seedSha256||cfg.legacy_guard_sha256!==p.legacyGuardSha256||!cfg.seed_complete
    ||env.SCOPE_REGISTRY_SHA256!==cfg.scope_sha256&&!isPinnedScopeTransition(env,cfg.scope_sha256)||Date.parse(p.review.reviewedAt)>now)return fail('legacy_model_guard_control_conflict')
  await readLegacyReconciliationManifest(env,p);await migrationProof(env,p,now);await verifyLegacyUnknownRows(env);await verifyLegacyUnknownArtifacts(env)
  const prior=await env.PIPELINE_DB.prepare('SELECT event_id FROM maintenance_events WHERE event_id=?').bind(eventId(sha)).first()
  if(prior)return{...publicRegistration(await verifyLegacyModelGuardRegistration(env,sha)),reused:true}
  const content=canonical(registrationContent(p,sha,nowIso(now))),hash=await digest(content),key=`${PREFIX}${hash}.json`
  await env.SNAPSHOTS_BUCKET.put(key,content,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  if(await digest(await checkedBytes(env,key,8192))!==hash)return fail('legacy_model_guard_registration_corrupt')
  const details=canonical({objectKey:key,sha256:hash,reconciliationSha256:sha,policySha256:LEGACY_UNKNOWN_POLICY_SHA256,guardSetSha256:LEGACY_UNKNOWN_GUARD_SET_SHA256}),guard=crypto.randomUUID()
  try{await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND scope_sha256=? AND input_catalog_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND seed_complete=1) AND (SELECT COUNT(*) FROM (${matchingLegacyUnknownAttemptsSql()}))=3 AND (SELECT COUNT(*) FROM (${matchingSourcesSql()}))=3 THEN 1 ELSE 0 END))`).bind(guard,cfg.revision,cfg.scope_sha256,cfg.input_catalog_sha256,cfg.seed_sha256,cfg.legacy_guard_sha256,attemptsJson,sourcesJson),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(eventId(sha),KIND,nowIso(now),details),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])}catch(error){
    const committed=await env.PIPELINE_DB.prepare('SELECT event_id FROM maintenance_events WHERE event_id=?').bind(eventId(sha)).first()
    if(!committed)throw error
  }
  return publicRegistration(await verifyLegacyModelGuardRegistration(env,sha))
}

export type LegacyModelDisposition = { totalUnknown: number; protectedLegacyUnknown: number; unresolvedUnknown: number; staleActive: number; protectionState: 'absent'|'verified'|'invalid'; policySha256: string; registrationSha256: string | null }
export type VerifiedLegacyModelDisposition = { summary: LegacyModelDisposition; commit: null | { registrationEventId: string; registrationDetails: string; reconciliationEventId: string; reconciliationDetails: string; lineage?: { previous: string; next: string; key: string; sha256: string } } }

/** Operational disposition only. Neither the old attempts nor a historical
 * head/scope proof is rewritten or labelled successful by this reader. */
export async function readLegacyModelDisposition(env: MaintenanceEnv,cfg: Control|null,now=Date.now()):Promise<VerifiedLegacyModelDisposition> {
  await policy()
  const counts=await env.PIPELINE_DB.prepare("SELECT SUM(status='unknown') total,SUM(status IN('reserved','send_started') AND started_at<?) stale FROM maintenance_model_attempts")
    .bind(nowIso(now-120000)).first<{total:number|null;stale:number|null}>()
  const summary:LegacyModelDisposition={totalUnknown:counts?.total??0,protectedLegacyUnknown:0,unresolvedUnknown:counts?.total??0,staleActive:counts?.stale??0,
    protectionState:'absent',policySha256:LEGACY_UNKNOWN_POLICY_SHA256,registrationSha256:null}
  const empty=()=>({summary,commit:null})
  if(!cfg||summary.totalUnknown<3||env.SCOPE_REGISTRY_SHA256!==cfg.scope_sha256)return empty()
  const row=await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='legacy_offline_reconciliation' ORDER BY observed_at DESC,event_id DESC LIMIT 1").first<{details_json:string}>()
  if(!row)return empty()
  try{
    const final=await readFinalReceipt(env,await digest(row.details_json)),receipt=final.receipt
    const verified=await verifyLegacyModelGuardRegistration(env,receipt.reconciliationSha256),p=verified.package
    assertLegacyReceiptMatchesPackage(receipt,p,receipt.reconciliationSha256)
    if(receipt.unknownGuardRegistrationSha256!==verified.registrationSha256||await digest(canonicalLegacyRequestDescriptors(p.requestDescriptors))!==receipt.requestDescriptorsSha256)
      return fail('legacy_model_guard_final_receipt_mismatch')
    let lineage:NonNullable<VerifiedLegacyModelDisposition['commit']>['lineage']
    if(cfg.scope_sha256!==p.scopeRegistrySha256){
      if(!await scopeUpgradeLineage(env,p.scopeRegistrySha256,cfg.scope_sha256))return fail('legacy_model_guard_scope_lineage_required')
      const upgrade=await env.PIPELINE_DB.prepare("SELECT receipt_key,receipt_sha256 FROM maintenance_scope_upgrades WHERE previous_scope_sha256=? AND next_scope_sha256=? AND status='completed'")
        .bind(p.scopeRegistrySha256,cfg.scope_sha256).first<{receipt_key:string;receipt_sha256:string}>()
      if(!upgrade)return fail('legacy_model_guard_scope_lineage_required')
      lineage={previous:p.scopeRegistrySha256,next:cfg.scope_sha256,key:upgrade.receipt_key,sha256:upgrade.receipt_sha256}
    }
    if(cfg.revision<p.controlRevision)return fail('legacy_model_guard_control_history_invalid')
    summary.protectionState='verified';summary.protectedLegacyUnknown=3;summary.unresolvedUnknown=summary.totalUnknown-3;summary.registrationSha256=verified.registrationSha256
    return{summary,commit:{registrationEventId:verified.registrationEventId,registrationDetails:verified.registrationDetails,reconciliationEventId:final.eventId,reconciliationDetails:final.detailsJson,...(lineage?{lineage}:{})}}
  }catch(error){if(isDailyD1QuotaError(error))throw error;summary.protectionState='invalid';return empty()}
}

// The registration and final reconciliation readers are defined below. Keeping
// their SQL fence next to this exact tuple predicate avoids ID-only waivers.
export function legacyModelDispositionFence(disposition: VerifiedLegacyModelDisposition, staleBefore: string) {
  const stale = "NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status IN('reserved','send_started') AND started_at<?)"
  if (!disposition.commit) return { sql: `NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status='unknown') AND ${stale}`, bindings: [staleBefore] }
  const c = disposition.commit, matches = matchingLegacyUnknownAttemptsSql()
  return { sql: `(${stale}) AND (SELECT COUNT(*) FROM (${matches}))=3 AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status='unknown' AND attempt_id NOT IN(${matches})) AND (SELECT COUNT(*) FROM (${matchingSourcesSql()}))=3 AND EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=? AND kind='legacy_model_guards_registered' AND details_json=?) AND EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=? AND kind='legacy_offline_reconciliation' AND details_json=?)${c.lineage ? " AND EXISTS(SELECT 1 FROM maintenance_scope_upgrades WHERE previous_scope_sha256=? AND next_scope_sha256=? AND status='completed' AND receipt_key=? AND receipt_sha256=?)" : ''}`,
    bindings: [staleBefore, attemptsJson, attemptsJson, sourcesJson, c.registrationEventId, c.registrationDetails, c.reconciliationEventId, c.reconciliationDetails, ...(c.lineage ? [c.lineage.previous,c.lineage.next,c.lineage.key,c.lineage.sha256] : [])] }
}

// Referenced by the registration reader; ordinary control revisions do not
// invalidate an immutable same-scope proof. Scope changes require real lineage.
export function legacyGuardControlBinding(cfg: Control) { return { scopeRegistrySha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256, legacyGuardSha256: cfg.legacy_guard_sha256 } }

export const LEGACY_MODEL_NO_REPLAY_POLICY=pinned
