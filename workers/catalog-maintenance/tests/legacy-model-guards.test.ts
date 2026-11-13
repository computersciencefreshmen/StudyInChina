import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import policy from '../../../content/maintenance/legacy-model-no-replay-policy.v1.json'
import { legacyModelNoReplayReason, verifyLegacyUnknownRows, verifyLegacyUnknownArtifacts, legacyModelDispositionFence, registerLegacyModelGuards,
  readLegacyModelDisposition, LEGACY_UNKNOWN_POLICY_SHA256, LEGACY_UNKNOWN_GUARD_SET_SHA256, legacyUnknownRegistrationIntentSha256, verifyLegacyModelGuardRegistration } from '../src/legacy-model-guards'
import { canonical, digest } from '../src/util'
import { makeEnv, seedInput } from './fixture'
import { seed, control } from '../src/repository'
import { processMessage } from '../src/index'
import { evaluateRollout, rolloutStatus } from '../src/rollout'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { legacyReconciliationPackageKey, legacyReconciliationReceiptKey, legacyReconciliationEventId, canonicalLegacyRequestDescriptors,
  canonicalLegacyArtifactDescriptors, canonicalLegacyReservations, type LegacyReconciliationPackage } from '../src/legacy-reconciliation-contracts'
import { offlineHandoffSchema } from '../src/legacy-manifest-contract'
import type { ModelRequest } from '../src/types'

const original = (sha: string, kind: string) => gunzipSync(readFileSync(new URL(`./fixtures/legacy-model-guards/${sha}.${kind}.gz`, import.meta.url)))
async function fixture(seedFirst=false) {
  let network = 0
  const f = makeEnv(async () => { network++; throw Error('provider access forbidden') })
  if(seedFirst)await seed(f.env,seedInput())
  for (const s of policy.subjects) {
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,?,?,'undergraduate_catalog',1,24,'2026-11-01T00:00:00.000Z')")
      .run(s.source.source_id,s.source.url,s.source.allowed_hosts_json)
    const columns = Object.keys(s.attempt)
    f.db.sqlite.prepare(`INSERT INTO maintenance_model_attempts(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(s.attempt))
    for (const [kind, ref] of [['snapshot',s.snapshot],['raw',s.raw],['text',s.text]] as const) await f.bucket.put(ref.objectKey, original(ref.sha256,kind))
  }
  return { ...f, network: () => network }
}
const input = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({ reservationKey: 'a'.repeat(64), sourceId: 'b'.repeat(64), snapshotSha256: 'c'.repeat(64),
  universityIds: ['new-school'], pass: 'primary', payload: 'a genuinely different request', lane: 'expansion', ...overrides })

async function registrationFixture() {
  const f=await fixture(true),now=Date.now()-1000,iso=new Date(now).toISOString(),manifestBytes=gunzipSync(readFileSync(new URL('./fixtures/legacy-model-guards/original-manifest.json.gz',import.meta.url))),manifest=offlineHandoffSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  assert.equal(await digest(manifestBytes),policy.manifestSha256)
  const migrationId='studyinchina-gmail-20261114-b75f28d5',sourceAccountId='78969c65bfdd892bb12c116869ea91cf',targetAccountId='b75f28d574289c29e9bda60a2fca27ed',migrationManifestSha256='f'.repeat(64)
  Object.assign(f.env,{MAINTENANCE_ENABLED:'false',SCOPE_REGISTRY_SHA256:manifest.scopeRegistrySha256,MODEL_STATE_MIGRATION_ROLE:'target',MODEL_STATE_MIGRATION_ID:migrationId,
    MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID:sourceAccountId,MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID:targetAccountId})
  f.db.sqlite.prepare('UPDATE maintenance_control SET scope_sha256=?,seed_sha256=?,legacy_guard_sha256=?').run(manifest.scopeRegistrySha256,manifest.seedSha256,manifest.legacyGuardSha256)
  f.db.sqlite.prepare('UPDATE maintenance_schools SET scope_sha256=?').run(manifest.scopeRegistrySha256)
  const states={completed:18,unknown:0,known_failed:0,send_started:0},counts={requestCount:18,entryCount:21,auxiliaryEntryCount:2,pageCount:1,states}
  await f.storage.put(MODEL_STATE_MIGRATION_KEY,{version:1,migrationId,sourceAccountId,targetAccountId,role:'target',phase:'finalized',frozenAt:iso,
    pages:[{index:0}],importedPages:1,manifestSha256:migrationManifestSha256,finalizedAt:iso,...counts})
  const evidence=async(value:unknown)=>{const text=canonical(value),sha256=await digest(text),objectKey=`maintenance/legacy-reconciliation/evidence/${sha256}.json`;await f.bucket.put(objectKey,text);return{objectKey,sha256,byteLength:new TextEncoder().encode(text).length}}
  const relay=await evidence({format:'studyinchina.model-state-migration-report',version:1,migrationId,sourceAccountId,targetAccountId,state:'finalized',sourceFrozen:true,targetFinalized:true,
    manifestSha256:migrationManifestSha256,...counts,modelCallsPerformed:false,controlsChanged:false})
  const other=await evidence({format:'test-only-other-proof',version:1})
  const cfg=(await control(f.env))!
  const p:LegacyReconciliationPackage={format:'studyinchina.legacy-offline-reconciliation-package',version:1,operationId:'test-legacy-guard-registration',migrationId,sourceAccountId,targetAccountId,
    pipelineDatabaseId:'43e2d4a5-54a4-4932-97f3-755be12ef8bb',legacyBatchId:manifest.batchId,legacyManifestSha256:policy.manifestSha256,
    artifactDescriptorsSha256:await digest(canonicalLegacyArtifactDescriptors(manifest.artifacts)),historyChainSha256:'1'.repeat(64),historyProof:other,jobDriftReview:other,
    inputCatalogSha256:cfg.input_catalog_sha256,nativeHeadReceipt:other,scopeRegistrySha256:cfg.scope_sha256,seedSha256:cfg.seed_sha256,legacyGuardSha256:cfg.legacy_guard_sha256,controlRevision:cfg.revision,
    migrationManifestSha256,migrationReceipt:relay,d1Receipt:other,r2Receipt:other,requestDescriptors:manifest.tableRows.maintenance_model_attempts,
    requestReservationsSha256:await digest(canonicalLegacyReservations(manifest.requestReservations)),unknownGuardPolicySha256:LEGACY_UNKNOWN_POLICY_SHA256,
    unknownGuardSetSha256:LEGACY_UNKNOWN_GUARD_SET_SHA256,registrationIntentSha256:await legacyUnknownRegistrationIntentSha256(),classificationSha256:'2'.repeat(64),importPlanSha256:'3'.repeat(64),
    originalGateSha256:'4'.repeat(64),originalFenceSha256:'5'.repeat(64),originalAuxiliarySha256:'6'.repeat(64),originalAuxiliaryEntryCount:2,
    review:{operatorId:'test-reviewer',decision:'reconcile_preserve_unknown_reuse_completed',reviewedAt:iso}}
  await f.bucket.put(`maintenance/offline-handoffs/${manifest.batchId}/manifests/${policy.manifestSha256}.json`,manifestBytes)
  const text=canonical(p),sha=await digest(text);await f.bucket.put(legacyReconciliationPackageKey(sha),text)
  const register=()=>registerLegacyModelGuards(f.env,{expectedRevision:cfg.revision,reconciliationSha256:sha},now)
  const finalize=async(registrationSha256:string)=>{
    const receipt={format:'studyinchina.legacy-offline-reconciliation-receipt',version:1,operationId:p.operationId,reconciliationSha256:sha,migrationId,sourceAccountId,targetAccountId,pipelineDatabaseId:p.pipelineDatabaseId,
      legacyBatchId:p.legacyBatchId,legacyManifestSha256:p.legacyManifestSha256,inputCatalogSha256:p.inputCatalogSha256,scopeRegistrySha256:p.scopeRegistrySha256,seedSha256:p.seedSha256,legacyGuardSha256:p.legacyGuardSha256,controlRevision:p.controlRevision,
      migrationManifestSha256,artifactDescriptorsSha256:p.artifactDescriptorsSha256,historyChainSha256:p.historyChainSha256,classificationSha256:p.classificationSha256,importPlanSha256:p.importPlanSha256,
      requestDescriptorsSha256:await digest(canonicalLegacyRequestDescriptors(p.requestDescriptors)),adoptedLedgerSha256:'7'.repeat(64),requestCount:171,requestStates:{completed:165,unknown:3,known_failed:3,send_started:0},
      unknownGuardPolicySha256:p.unknownGuardPolicySha256,unknownGuardSetSha256:p.unknownGuardSetSha256,unknownGuardRegistrationSha256:registrationSha256,createdAt:iso,modelCallsPerformed:false,oldManifestAcknowledged:false}
    const body=canonical(receipt),receiptSha=await digest(body);await f.bucket.put(legacyReconciliationReceiptKey(receiptSha),body)
    f.db.sqlite.prepare("INSERT INTO maintenance_events VALUES(?,'legacy_offline_reconciliation',?,?)").run(legacyReconciliationEventId(p.operationId),iso,body)
    return{receipt,receiptSha}
  }
  return{...f,now,p,sha,register,finalize}
}

test('real original tuples and all nine public official evidence objects verify, with no provider calls or status mutation',async () => {
  const f = await fixture()
  try {
    await verifyLegacyUnknownRows(f.env); await verifyLegacyUnknownArtifacts(f.env)
    assert.equal(f.network(),0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,3)
    for (const s of policy.subjects) assert.equal(await digest(original(s.raw.sha256,'raw')),s.attempt.snapshot_sha256)
  } finally { f.db.sqlite.close() }
})

test('permanent source, reservation, raw and trusted complete-text aliases deny across changed caller scopes and keys',async () => {
  const f = await fixture(), source = { raw_sha256: 'c'.repeat(64), canonical_sha256: 'd'.repeat(64) }
  try {
    for (const s of policy.subjects) {
      assert.equal(await legacyModelNoReplayReason(f.env,input({sourceId:s.attempt.source_id}),source),'legacy_model_replay_protected')
      assert.equal(await legacyModelNoReplayReason(f.env,input({snapshotSha256:s.attempt.snapshot_sha256}),source),'legacy_model_replay_protected')
      assert.equal(await legacyModelNoReplayReason(f.env,input({reservationKey:s.attempt.reservation_key}),source),'legacy_model_replay_protected')
      assert.equal(await legacyModelNoReplayReason(f.env,input(),{...source,canonical_sha256:s.textSha256}),'legacy_model_replay_protected')
    }
    assert.equal(await legacyModelNoReplayReason(f.env,input(),source),null)
    assert.equal(f.network(),0); assert.equal(f.storage.values.size,0)
  } finally { f.db.sqlite.close() }
})

test('PDF/HTML fallback only trusts exact source-bound snapshot and actual hashed full text, not caller-supplied aliases',async () => {
  const f = await fixture(), id='b'.repeat(64), raw='c'.repeat(64), s=policy.subjects[0]
  const key=`maintenance/snapshots/${id}/${raw}.json`, textKey=`maintenance/text/${id}/${s.textSha256}.txt`
  try {
    await f.bucket.put(key,JSON.stringify({sourceId:id,rawSha256:raw,textSha256:s.textSha256,textKey}))
    await f.bucket.put(textKey,original(s.text.sha256,'text'))
    assert.equal(await legacyModelNoReplayReason(f.env,input(),{raw_sha256:raw,canonical_sha256:raw,snapshot_key:key}),'legacy_model_replay_protected')
    await f.bucket.put(textKey,'corrupted official text')
    assert.equal(await legacyModelNoReplayReason(f.env,input(),{raw_sha256:raw,canonical_sha256:raw,snapshot_key:key}),'legacy_model_source_text_unproven')
    assert.equal(await legacyModelNoReplayReason(f.env,{...input(),textSha256:s.textSha256} as ModelRequest,{raw_sha256:raw,canonical_sha256:'d'.repeat(64)}),null)
  } finally { f.db.sqlite.close() }
})

test('full tuple verification rejects edited quota, request hash, SQL status, deletion and official byte corruption',async () => {
  for (const change of ['quota_json','request_sha256','status','deleted','artifact']) {
    const f=await fixture(),s=policy.subjects[2]
    try {
      if(change==='deleted')f.db.sqlite.prepare('DELETE FROM maintenance_model_attempts WHERE attempt_id=?').run(s.attempt.attempt_id)
      else if(change==='artifact')await f.bucket.put(s.text.objectKey,'corrupt')
      else f.db.sqlite.prepare(`UPDATE maintenance_model_attempts SET ${change}=? WHERE attempt_id=?`).run(change==='status'?'known_failed':'changed',s.attempt.attempt_id)
      await assert.rejects(change==='artifact'?verifyLegacyUnknownArtifacts(f.env):verifyLegacyUnknownRows(f.env),/legacy_model_guard_/)
      assert.equal(f.network(),0)
    } finally { f.db.sqlite.close() }
  }
})

test('without a genuine registration the model fence never waives unknowns, independently of the lease-job quarantine',async () => {
  const f=await fixture(),fence=legacyModelDispositionFence({summary:{totalUnknown:3,protectedLegacyUnknown:0,unresolvedUnknown:3,staleActive:0,protectionState:'absent',policySha256:'a'.repeat(64),registrationSha256:null},commit:null},new Date().toISOString())
  try {
    assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END n`).get(...fence.bindings)?.n,0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='unknown'").get()?.n,0)
  } finally { f.db.sqlite.close() }
})

test('a real queue extraction rejected by the permanent guard becomes held, never a fourth unknown or new reservation',async () => {
  const f=await fixture(true),s=policy.subjects[0],jobId='e'.repeat(64),iso=new Date(Date.now()-1000).toISOString()
  try {
    f.db.sqlite.prepare("INSERT INTO maintenance_source_schools VALUES(?,'uni-000')").run(s.source.source_id)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=? WHERE source_id=?')
      .run(s.attempt.snapshot_sha256,s.textSha256,s.snapshot.objectKey,s.source.source_id)
    f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1').run()
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key) VALUES(?,?,'extract','queued',?,?,?,?,?)")
      .run(jobId,s.source.source_id,iso,iso,iso,s.attempt.snapshot_sha256,s.snapshot.objectKey)
    await processMessage(f.env,{version:1,jobId})
    const job=f.db.sqlite.prepare('SELECT status,error_code FROM maintenance_jobs WHERE job_id=?').get(jobId)
    assert.equal(job?.status,'held'); assert.equal(job?.error_code,'legacy_model_replay_protected')
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,3)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,3)
    assert.equal(f.storage.values.size,0); assert.equal(f.network(),0)
  } finally { f.db.sqlite.close() }
})

test('registration requires real finalized migration and final reconciliation, preserves outcomes and is idempotent',async () => {
  const f=await registrationFixture()
  try {
    const registered=await f.register(),again=await f.register()
    assert.equal(registered.registrationSha256,again.registrationSha256)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='legacy_model_guards_registered'").get()?.n,1)
    assert.equal((await readLegacyModelDisposition(f.env,await control(f.env))).summary.protectedLegacyUnknown,0)
    await f.finalize(registered.registrationSha256)
    const disposition=await readLegacyModelDisposition(f.env,await control(f.env))
    assert.deepEqual([disposition.summary.totalUnknown,disposition.summary.protectedLegacyUnknown,disposition.summary.unresolvedUnknown],[3,3,0])
    const fence=legacyModelDispositionFence(disposition,new Date().toISOString())
    assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END n`).get(...fence.bindings)?.n,1)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,3)
    assert.equal(f.network(),0)
    assert.equal((await control(f.env))?.revision,f.p.controlRevision)
  } finally { f.db.sqlite.close() }
})

test('a fourth model unknown and stale active send still block, without consuming the independent lease-job disposition',async () => {
  const f=await registrationFixture()
  try {
    const r=await f.register();await f.finalize(r.registrationSha256)
    const extra={...policy.subjects[0].attempt,attempt_id:'fourth-unresolved-model',reservation_key:'8'.repeat(64)}
    const columns=Object.keys(extra)
    f.db.sqlite.prepare(`INSERT INTO maintenance_model_attempts(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(extra))
    const d=await readLegacyModelDisposition(f.env,await control(f.env)),fence=legacyModelDispositionFence(d,new Date().toISOString())
    assert.deepEqual([d.summary.totalUnknown,d.summary.protectedLegacyUnknown,d.summary.unresolvedUnknown],[4,3,1])
    assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END n`).get(...fence.bindings)?.n,0)
    f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET status='send_started' WHERE attempt_id=?").run(extra.attempt_id)
    const active=await readLegacyModelDisposition(f.env,await control(f.env)),activeFence=legacyModelDispositionFence(active,new Date().toISOString())
    assert.equal(active.summary.staleActive,1);assert.equal(active.summary.unresolvedUnknown,0)
    assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${activeFence.sql} THEN 1 ELSE 0 END n`).get(...activeFence.bindings)?.n,0)
  } finally { f.db.sqlite.close() }
})

test('the atomic fence rejects pinned row deletion/status/tuple and registration/reconciliation/source races',async () => {
  for(const change of ['deleted','status','quota_json','registration','final','source']) {
    const f=await registrationFixture()
    try {
      const r=await f.register();await f.finalize(r.registrationSha256)
      const d=await readLegacyModelDisposition(f.env,await control(f.env)),fence=legacyModelDispositionFence(d,new Date().toISOString()),a=policy.subjects[2].attempt
      if(change==='deleted')f.db.sqlite.prepare('DELETE FROM maintenance_model_attempts WHERE attempt_id=?').run(a.attempt_id)
      else if(change==='status')f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET status='known_failed' WHERE attempt_id=?").run(a.attempt_id)
      else if(change==='quota_json')f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET quota_json='{}' WHERE attempt_id=?").run(a.attempt_id)
      else if(change==='source')f.db.sqlite.prepare("UPDATE maintenance_sources SET url='https://test.edu.cn/changed' WHERE source_id=?").run(a.source_id)
      else f.db.sqlite.prepare('DELETE FROM maintenance_events WHERE kind=?').run(change==='registration'?'legacy_model_guards_registered':'legacy_offline_reconciliation')
      assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END n`).get(...fence.bindings)?.n,0,change)
    } finally { f.db.sqlite.close() }
  }
})

test('registration CAS, package and proof corruption fail closed without any SQL outcome edits',async () => {
  for(const change of ['revision','row','migration','package','proof']) {
    const f=await registrationFixture()
    try {
      if(change==='revision'||change==='row'){
        const put=f.bucket.put.bind(f.bucket)
        f.bucket.put=async(key,value,options)=>{if(key.startsWith('maintenance/legacy-model-guards/registrations/')){
          if(change==='revision')f.db.sqlite.exec('UPDATE maintenance_control SET revision=revision+1')
          else f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET quota_json='{}' WHERE attempt_id=?").run(policy.subjects[0].attempt.attempt_id)
        }return put(key,value,options)}
      }else if(change==='migration'){
        const lock=(await f.storage.get<Record<string,unknown>>(MODEL_STATE_MIGRATION_KEY))!;await f.storage.put(MODEL_STATE_MIGRATION_KEY,{...lock,phase:'importing'})
      }else if(change==='package')await f.bucket.put(legacyReconciliationPackageKey(f.sha),'{}')
      else{
        const r=await f.register();await f.bucket.put(`maintenance/legacy-model-guards/registrations/${r.registrationSha256}.json`,'{}')
        await assert.rejects(verifyLegacyModelGuardRegistration(f.env,f.sha),/legacy_model_guard_registration_corrupt/);continue
      }
      await assert.rejects(f.register())
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='legacy_model_guards_registered'").get()?.n,0)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()?.n,3)
      assert.equal(f.network(),0)
    } finally { f.db.sqlite.close() }
  }
})

test('ordinary revisions preserve protection; a changed scope needs completed immutable lineage and deny stays permanent',async () => {
  const f=await registrationFixture()
  try {
    const r=await f.register();await f.finalize(r.registrationSha256)
    f.db.sqlite.exec('UPDATE maintenance_control SET revision=revision+5')
    assert.equal((await readLegacyModelDisposition(f.env,await control(f.env))).summary.protectedLegacyUnknown,3)
    f.env.SCOPE_REGISTRY_SHA256=EXISTING_SCHOOLS_V2_SHA256;f.env.SCOPE_SCHOOL_COUNT='295'
    f.db.sqlite.prepare('UPDATE maintenance_control SET scope_sha256=?').run(EXISTING_SCHOOLS_V2_SHA256)
    assert.equal((await readLegacyModelDisposition(f.env,await control(f.env))).summary.protectedLegacyUnknown,0)
    const receipt=canonical({format:'studyinchina.maintenance-scope-upgrade-receipt',version:1,previousScopeSha256:f.p.scopeRegistrySha256,nextScopeSha256:EXISTING_SCHOOLS_V2_SHA256,outcome:'completed',legacyGuardsPreserved:true}),sha=await digest(receipt),key=`maintenance/scope-upgrades/receipts/${sha}.json`
    await f.bucket.put(key,receipt)
    f.db.sqlite.prepare("INSERT INTO maintenance_scope_upgrades(upgrade_sha256,previous_scope_sha256,next_scope_sha256,expected_revision,paused_revision,input_catalog_sha256,legacy_guard_sha256,original_canary_json,original_enabled,original_models_enabled,plan_key,plan_sha256,total_operations,completed_operations,status,receipt_key,receipt_sha256,created_at) VALUES(?,?,?,0,1,?,?,'[]',1,1,?,?,0,0,'completed',?,?,?)")
      .run('e'.repeat(64),f.p.scopeRegistrySha256,EXISTING_SCHOOLS_V2_SHA256,f.p.inputCatalogSha256,f.p.legacyGuardSha256,'maintenance/test-plan.json','e'.repeat(64),key,sha,new Date(f.now).toISOString())
    const d=await readLegacyModelDisposition(f.env,await control(f.env)),fence=legacyModelDispositionFence(d,new Date().toISOString())
    assert.equal(d.summary.protectedLegacyUnknown,3)
    f.db.sqlite.prepare("UPDATE maintenance_scope_upgrades SET status='staged'").run()
    assert.equal(f.db.sqlite.prepare(`SELECT CASE WHEN ${fence.sql} THEN 1 ELSE 0 END n`).get(...fence.bindings)?.n,0)
    assert.equal(await legacyModelNoReplayReason(f.env,input({sourceId:policy.subjects[0].source.source_id}),{raw_sha256:null}),'legacy_model_replay_protected')
  } finally { f.db.sqlite.close() }
})

async function rolloutFixture(){
  const f=await registrationFixture(),r=await f.register();await f.finalize(r.registrationSha256)
  f.env.MAINTENANCE_ENABLED='true';delete f.env.MODEL_STATE_MIGRATION_ROLE
  const ids=Array.from({length:5},(_,i)=>`uni-${String(i).padStart(3,'0')}`),iso=new Date(f.now-1000).toISOString()
  f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1,targets_complete=1,canary_json=?').run(canonical(ids))
  for(const[index,id]of ids.entries()){
    const url=index===0?'https://test.edu.cn/catalog':`https://test.edu.cn/rollout-${index}`,sourceId=await digest(url)
    if(index){f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES(?,?,'[\"test.edu.cn\"]','undergraduate_catalog',1,24,?)").run(sourceId,url,iso);f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(sourceId,id)}
    f.db.sqlite.prepare("UPDATE maintenance_sources SET last_attempt_at=?,failures=1,error_code='robots_disallowed' WHERE source_id=?").run(iso,sourceId)
    f.db.sqlite.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id=?').run(iso,id)
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,attempt,error_code) VALUES(?,?,'capture','held',?,?,?,1,'robots_disallowed')").run(`blocked-${id}`,sourceId,iso,iso,iso)
  }
  const ack={batchId:'actual-published-test-batch',outcome:'published',acceptedProposalIds:['previously-verified-proposal'],sourceCommit:'d'.repeat(40),deploymentId:'dpl_verifiedTestDeployment',stableProofSha256:'e'.repeat(64)},text=canonical(ack)
  f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES(?,?,?,?,?,?,'published',?,?)").run(ack.batchId,f.p.inputCatalogSha256,f.p.scopeRegistrySha256,'maintenance/test-export.json','a'.repeat(64),iso,await digest(text),text)
  return f
}

test('actual rollout accepts protected legacy unknowns but an atomic late row change aborts the canary update',async()=>{
  for(const race of [false,true]){
    const f=await rolloutFixture()
    try{
      const ready=await rolloutStatus(f.env)
      assert.equal(ready.state,'eligible',canonical(ready.reasons));assert.equal(ready.unknownModelDisposition?.protectedLegacyUnknown,3)
      if(race){const batch=f.db.batch.bind(f.db);f.db.batch=async(statements)=>{
        f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET status='known_failed' WHERE attempt_id=?").run(policy.subjects[2].attempt.attempt_id)
        f.db.batch=batch;return batch(statements)
      }}
      const result=await evaluateRollout(f.env,{expectedRevision:f.p.controlRevision})
      assert.equal(result.advanced,!race)
      assert.equal(JSON.parse((await control(f.env))!.canary_json).length,race?5:25)
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='rollout_advanced'").get()?.n,race?0:1)
      assert.equal(f.network(),0)
    }finally{f.db.sqlite.close()}
  }
})
