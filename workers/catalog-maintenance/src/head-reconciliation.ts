import manifest from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { readExport } from './exports'
import { control } from './repository'
import type { Control, MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, nowIso, record } from './util'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { scopeUpgradeLineage } from './scope-config'

/** One reviewed Git transition, not a general catalogue-head write API. */
export const PINNED_HEAD_RECONCILIATION = manifest
type Phase = 'pause' | 'advance' | 'resume'
type Proof = { phase: Phase; manifestSha256: string; createdAt: string; originalControl: Control; pausedRevision: number; reconciledRevision?: number; restoredRevision?: number }
type StoredProof = { proof: Proof; sha256: string; objectKey: string }
type Operation = Partial<Record<Phase, StoredProof>>
const eventId = (phase: Phase) => `${manifest.operationId}:${phase}`
const immutableScope = (cfg: Control) => cfg.scope_sha256 === manifest.scopeRegistrySha256 && cfg.seed_sha256 === manifest.seedSha256 && cfg.legacy_guard_sha256 === manifest.legacyGuardSha256 && cfg.seed_complete === 1
const fence = `NOT EXISTS(SELECT 1 FROM maintenance_exports WHERE status IN('prepared','applied'))
 AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE status IN('running','unknown') OR lease_token IS NOT NULL OR lease_until IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status IN('reserved','send_started','unknown'))
 AND NOT EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE status='staged')
 AND (SELECT COUNT(*) FROM maintenance_legacy_guards)=${manifest.preservedHistory.legacyGuards}
 AND NOT EXISTS(SELECT 1 FROM maintenance_legacy_guards WHERE state<>'stop')
 AND (SELECT COUNT(*) FROM maintenance_model_attempts WHERE status='completed')=${manifest.preservedHistory.completedModelAttempts}`

async function assertPin(env: MaintenanceEnv) {
  const { sha256, ...content } = manifest
  if (await digest(canonical(content)) !== sha256 || env.SCOPE_REGISTRY_SHA256 !== manifest.scopeRegistrySha256) throw new MaintenanceError('reconciliation_pin_mismatch')
}
async function operation(env: MaintenanceEnv): Promise<Operation> {
  const rows = (await env.PIPELINE_DB.prepare('SELECT event_id,details_json FROM maintenance_events WHERE event_id IN(?,?,?)').bind(eventId('pause'), eventId('advance'), eventId('resume')).all<{ event_id: string; details_json: string }>()).results ?? []
  const result: Operation = {}
  for (const row of rows) {
    const saved = JSON.parse(row.details_json) as StoredProof, proof = saved?.proof
    if (!proof || !['pause','advance','resume'].includes(proof.phase) || row.event_id !== eventId(proof.phase) || proof.manifestSha256 !== manifest.sha256 || !immutableScope(proof.originalControl) || proof.originalControl.input_catalog_sha256 !== manifest.oldInputCatalogSha256 || !Number.isSafeInteger(proof.originalControl.revision) || proof.pausedRevision !== proof.originalControl.revision + 1 || await digest(canonical(proof)) !== saved.sha256 || saved.objectKey !== `maintenance/reconciliation/${manifest.operationId}/${proof.phase}/${saved.sha256}.json`) throw new MaintenanceError('reconciliation_history_invalid')
    result[proof.phase] = saved
  }
  if (result.advance && (!result.pause || result.advance.proof.pausedRevision !== result.pause.proof.pausedRevision || result.advance.proof.reconciledRevision !== result.pause.proof.pausedRevision + 2 || canonical(result.advance.proof.originalControl) !== canonical(result.pause.proof.originalControl))) throw new MaintenanceError('reconciliation_history_invalid')
  if (result.resume && (!result.advance || result.resume.proof.reconciledRevision !== result.advance.proof.reconciledRevision || result.resume.proof.restoredRevision !== result.advance.proof.reconciledRevision! + 2 || canonical(result.resume.proof.originalControl) !== canonical(result.advance.proof.originalControl))) throw new MaintenanceError('reconciliation_history_invalid')
  return result
}
async function stored(proof: Proof): Promise<StoredProof> {
  const sha256 = await digest(canonical(proof))
  return { proof, sha256, objectKey: `maintenance/reconciliation/${manifest.operationId}/${proof.phase}/${sha256}.json` }
}
async function archive(env: MaintenanceEnv, saved: StoredProof) {
  const bytes = canonical(saved.proof)
  let existing = await env.SNAPSHOTS_BUCKET.get(saved.objectKey)
  if (!existing) {
    await env.SNAPSHOTS_BUCKET.put(saved.objectKey, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
    existing = await env.SNAPSHOTS_BUCKET.get(saved.objectKey)
  }
  if (!existing || await existing.text() !== bytes) throw new MaintenanceError('reconciliation_proof_archive_unavailable')
}
export async function readMaintenanceControl(env: MaintenanceEnv) {
  // Read historical proof after a committed additive scope change; mutation
  // routes retain assertPin's original, exact scope restriction.
  const { sha256, ...manifestContent } = manifest
  if (await digest(canonical(manifestContent)) !== sha256) throw new MaintenanceError('reconciliation_pin_mismatch')
  const cfg = await control(env), saved = await operation(env), gate = await nativeReconciliationGate(env)
  const upgraded = Boolean(cfg && cfg.scope_sha256 !== manifest.scopeRegistrySha256
    && cfg.scope_sha256 === env.SCOPE_REGISTRY_SHA256 && await scopeUpgradeLineage(env, manifest.scopeRegistrySha256, cfg.scope_sha256))
  if (cfg && cfg.scope_sha256 !== manifest.scopeRegistrySha256 && !upgraded) throw new MaintenanceError('reconciliation_scope_lineage_unproven')
  return { format: 'studyinchina.maintenance-control' as const, control: cfg,
    deployment: { maintenanceEnabled: env.MAINTENANCE_ENABLED === 'true', subscriptionConfigured: Boolean(env.MINIMAX_SUBSCRIPTION_KEY && env.MINIMAX_MODEL === 'MiniMax-M3'), guardRequired: gate.required, guardReady: gate.ready,
      scopeUpgradePending: env.SCOPE_REGISTRY_SHA256 !== manifest.scopeRegistrySha256 && !upgraded && !gate.ready }, reconciliation: {
    manifestSha256: manifest.sha256,
    scopeUpgrade: upgraded ? { previousScopeSha256: manifest.scopeRegistrySha256, nextScopeSha256: cfg!.scope_sha256, verified: true as const } : null,
    paused: saved.pause ? { originalControl: saved.pause.proof.originalControl, pausedRevision: saved.pause.proof.pausedRevision, proofSha256: saved.pause.sha256 } : null,
    advanced: saved.advance ? { reconciledRevision: saved.advance.proof.reconciledRevision!, proofSha256: saved.advance.sha256 } : null,
    resumed: saved.resume ? { restoredRevision: saved.resume.proof.restoredRevision!, proofSha256: saved.resume.sha256 } : null,
  } }
}
async function writePhase(env: MaintenanceEnv, saved: StoredProof, condition: string, values: unknown[], update: string, updateValues: unknown[]) {
  const guard = crypto.randomUUID()
  try {
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END))`).bind(guard, ...values),
      env.PIPELINE_DB.prepare(update).bind(...updateValues),
      env.PIPELINE_DB.prepare('INSERT INTO maintenance_events(event_id,kind,observed_at,details_json) VALUES(?,?,?,?)').bind(eventId(saved.proof.phase), `native_git_head_${saved.proof.phase}`, saved.proof.createdAt, canonical(saved)),
      env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
    ])
  } catch {
    // An ambiguous response may follow a committed transaction. Reuse only its exact durable operation.
    const current = await operation(env)
    if (!current[saved.proof.phase]) throw new MaintenanceError('reconciliation_cas_or_fence_conflict')
  }
}
async function assertRejectedExport(env: MaintenanceEnv): Promise<string> {
  const row = await env.PIPELINE_DB.prepare('SELECT status,sha256,acknowledgement_json,acknowledgement_sha256 FROM maintenance_exports WHERE batch_id=?').bind(manifest.preparedExport.batchId).first<{ status: string; sha256: string; acknowledgement_json: string | null; acknowledgement_sha256: string | null }>()
  const ack = row?.acknowledgement_json ? record(JSON.parse(row.acknowledgement_json)) : null
  if (!row || row.status !== 'rejected' || row.sha256 !== manifest.preparedExport.sha256 || !ack || ack.batchId !== manifest.preparedExport.batchId || ack.outcome !== 'rejected' || ack.receiptSha256 !== manifest.preparedExport.rejectionReview.sha256 || ack.sourceCommit !== manifest.sourceCommit || ack.newInputCatalogSha256 !== manifest.oldInputCatalogSha256 || canonical(ack.acceptedProposalIds) !== '[]' || canonical(ack.unchangedProposalIds) !== '[]' || canonical(ack.heldProposalIds) !== canonical([...manifest.preparedExport.proposalIds].sort()) || await digest(canonical(ack)) !== row.acknowledgement_sha256) throw new MaintenanceError('reconciliation_requires_exact_rejection')
  const held = await env.PIPELINE_DB.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE export_id=? AND status='held' AND acknowledgement_sha256=? AND proposal_id IN(SELECT value FROM json_each(?))").bind(manifest.preparedExport.batchId, row.acknowledgement_sha256, JSON.stringify(manifest.preparedExport.proposalIds)).first<{ count: number }>()
  if (held?.count !== manifest.preparedExport.proposalIds.length) throw new MaintenanceError('reconciliation_rejection_partition_changed')
  return row.acknowledgement_sha256!
}
export async function reconcileMaintenanceHead(env: MaintenanceEnv, value: unknown) {
  await assertPin(env)
  const raw = record(value)
  if (!raw || Object.keys(raw).some(key => !['phase','expectedRevision','manifestSha256'].includes(key)) || !['pause','advance','resume'].includes(String(raw.phase)) || raw.manifestSha256 !== manifest.sha256 || !Number.isSafeInteger(raw.expectedRevision)) throw new MaintenanceError('invalid_pinned_reconciliation')
  const phase = raw.phase as Phase, cfg = await control(env), saved = await operation(env)
  if (!cfg || !immutableScope(cfg)) throw new MaintenanceError('reconciliation_control_scope_changed')
  if (saved[phase]) { await archive(env, saved[phase]!); return readMaintenanceControl(env) }
  if (cfg.revision !== raw.expectedRevision) throw new MaintenanceError('reconciliation_control_revision_changed')
  if (phase === 'pause') {
    if (cfg.input_catalog_sha256 !== manifest.oldInputCatalogSha256 || cfg.targets_complete !== 1 || saved.advance || saved.resume) throw new MaintenanceError('reconciliation_initial_state_changed')
    const batch = await readExport(env, manifest.preparedExport.batchId)
    if (batch.sha256 !== manifest.preparedExport.sha256 || batch.inputCatalogSha256 !== manifest.oldInputCatalogSha256 || batch.scopeRegistrySha256 !== manifest.scopeRegistrySha256 || canonical(batch.proposals.map(proposal => proposal.id).sort()) !== canonical([...manifest.preparedExport.proposalIds].sort())) throw new MaintenanceError('reconciliation_original_export_changed')
    const proof = await stored({ phase, manifestSha256: manifest.sha256, createdAt: nowIso(), originalControl: { ...cfg }, pausedRevision: cfg.revision + 1 })
    await writePhase(env, proof, `EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND input_catalog_sha256=? AND scope_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND canary_json=? AND targets_complete=1) AND EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=? AND sha256=? AND status='prepared' AND acknowledgement_sha256 IS NULL) AND NOT EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=?)`, [cfg.revision, manifest.oldInputCatalogSha256, manifest.scopeRegistrySha256, manifest.seedSha256, manifest.legacyGuardSha256, cfg.canary_json, manifest.preparedExport.batchId, manifest.preparedExport.sha256, eventId('pause')], 'UPDATE maintenance_control SET enabled=0,models_enabled=0,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?', [proof.proof.createdAt, cfg.revision])
    // The durable original-control snapshot is committed with the pause. An R2 failure leaves it paused and retryable.
    await archive(env, (await operation(env)).pause!)
  } else {
    const paused = saved.pause
    if (!paused) throw new MaintenanceError('reconciliation_pause_required')
    await archive(env, paused)
    if (cfg.enabled !== 0 || cfg.models_enabled !== 0 || cfg.canary_json !== paused.proof.originalControl.canary_json) throw new MaintenanceError('reconciliation_operator_control_changed')
    if (phase === 'advance') {
      if (cfg.input_catalog_sha256 !== manifest.oldInputCatalogSha256 || cfg.targets_complete !== 1 || cfg.revision !== paused.proof.pausedRevision + 1) throw new MaintenanceError('reconciliation_rejection_revision_changed')
      const rejectionSha256 = await assertRejectedExport(env)
      const proof = await stored({ ...paused.proof, phase, createdAt: nowIso(), reconciledRevision: cfg.revision + 1 })
      await archive(env, proof)
      await writePhase(env, proof, `EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND input_catalog_sha256=? AND targets_complete=1 AND enabled=0 AND models_enabled=0 AND scope_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND canary_json=?) AND ${fence} AND EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=? AND status='rejected' AND acknowledgement_sha256=?) AND (SELECT COUNT(*) FROM maintenance_proposals WHERE export_id=? AND status='held' AND acknowledgement_sha256=? AND proposal_id IN(SELECT value FROM json_each(?)))=?`, [cfg.revision, manifest.oldInputCatalogSha256, manifest.scopeRegistrySha256, manifest.seedSha256, manifest.legacyGuardSha256, cfg.canary_json, manifest.preparedExport.batchId, rejectionSha256, manifest.preparedExport.batchId, rejectionSha256, JSON.stringify(manifest.preparedExport.proposalIds), manifest.preparedExport.proposalIds.length], 'UPDATE maintenance_control SET input_catalog_sha256=?,targets_complete=0,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?', [manifest.newInputCatalogSha256, proof.proof.createdAt, cfg.revision])
    } else {
      const advanced = saved.advance
      if (!advanced || cfg.input_catalog_sha256 !== manifest.newInputCatalogSha256 || cfg.targets_complete !== 1 || cfg.revision !== advanced.proof.reconciledRevision! + 1) throw new MaintenanceError('reconciliation_targets_or_revision_changed')
      const original = paused.proof.originalControl
      if (original.models_enabled && (env.MAINTENANCE_ENABLED !== 'true' || !env.MINIMAX_SUBSCRIPTION_KEY || env.MINIMAX_MODEL !== 'MiniMax-M3')) throw new MaintenanceError('subscription_model_configuration_unavailable')
      const proof = await stored({ ...advanced.proof, phase, createdAt: nowIso(), restoredRevision: cfg.revision + 1 })
      await archive(env, advanced); await archive(env, proof)
      await writePhase(env, proof, `EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND input_catalog_sha256=? AND targets_complete=1 AND enabled=0 AND models_enabled=0 AND scope_sha256=? AND seed_sha256=? AND legacy_guard_sha256=? AND canary_json=?) AND ${fence} AND EXISTS(SELECT 1 FROM maintenance_target_refreshes WHERE input_catalog_sha256=? AND status='completed' AND refresh_sha256=? AND expected_count=? AND expected_count=(SELECT COUNT(*) FROM maintenance_record_targets WHERE active=1))`, [cfg.revision, manifest.newInputCatalogSha256, manifest.scopeRegistrySha256, manifest.seedSha256, manifest.legacyGuardSha256, cfg.canary_json, manifest.newInputCatalogSha256, manifest.targetUpload.sha256, manifest.targetUpload.targetCount], 'UPDATE maintenance_control SET enabled=?,models_enabled=?,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?', [original.enabled, original.models_enabled, proof.proof.createdAt, cfg.revision])
    }
  }
  return readMaintenanceControl(env)
}
