import manifest from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import type { MaintenanceEnv } from './types'
import { canonical, digest, HASH, record } from './util'

export type NativeReconciliationGate = { required: boolean; ready: boolean; reason: 'not_required' | 'resume_verified' | 'resume_missing' | 'resume_invalid' }
const closed = (reason: 'resume_missing' | 'resume_invalid'): NativeReconciliationGate => ({ required: true, ready: false, reason })

/** A deployment opt-in barrier. No repository/head/export imports, and no cached
 * success: an unavailable authoritative store must never authorize a provider call. */
export async function nativeReconciliationGate(env: MaintenanceEnv): Promise<NativeReconciliationGate> {
  if (env.NATIVE_HEAD_RECONCILIATION_REQUIRED !== 'true') return { required: false, ready: true, reason: 'not_required' }
  const { sha256, ...content } = manifest
  if (env.SCOPE_REGISTRY_SHA256 !== manifest.scopeRegistrySha256 || await digest(canonical(content)) !== sha256) return closed('resume_invalid')
  // Database failures intentionally propagate to existing quota/backend handling.
  const row = await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(`${manifest.operationId}:resume`).first<{ kind: string; details_json: string }>()
  if (!row) return closed('resume_missing')
  let saved: Record<string, unknown> | null
  try { saved = record(JSON.parse(row.details_json)) } catch { return closed('resume_invalid') }
  const proof = record(saved?.proof), original = record(proof?.originalControl)
  if (row.kind !== 'native_git_head_resume' || !saved || !proof || !original || proof.phase !== 'resume' || proof.manifestSha256 !== sha256 || typeof saved.sha256 !== 'string' || !HASH.test(saved.sha256)
    || original.scope_sha256 !== manifest.scopeRegistrySha256 || original.seed_sha256 !== manifest.seedSha256 || original.legacy_guard_sha256 !== manifest.legacyGuardSha256 || original.input_catalog_sha256 !== manifest.oldInputCatalogSha256 || original.seed_complete !== 1 || original.targets_complete !== 1
    || !Number.isSafeInteger(original.revision) || Number(original.revision) < 0 || proof.pausedRevision !== Number(original.revision) + 1 || proof.reconciledRevision !== Number(proof.pausedRevision) + 2 || proof.restoredRevision !== Number(proof.reconciledRevision) + 2
    || original.enabled !== 0 && original.enabled !== 1 || original.models_enabled !== 0 && original.models_enabled !== 1 || typeof original.canary_json !== 'string' || typeof proof.createdAt !== 'string' || !Number.isFinite(Date.parse(proof.createdAt))) return closed('resume_invalid')
  try { const canary: unknown = JSON.parse(original.canary_json); if (!Array.isArray(canary) || canary.length > 272 || new Set(canary).size !== canary.length || canary.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/u.test(id))) return closed('resume_invalid') } catch { return closed('resume_invalid') }
  const bytes = canonical(proof)
  if (await digest(bytes) !== saved.sha256 || saved.objectKey !== `maintenance/reconciliation/${manifest.operationId}/resume/${saved.sha256}.json`) return closed('resume_invalid')
  // The event and control update commit atomically; the exact immutable archive
  // must also exist. Subsequent catalogue heads and operator pauses are allowed.
  const object = await env.SNAPSHOTS_BUCKET.get(saved.objectKey as string)
  if (!object || object.size !== undefined && object.size > 32 * 1024 || await object.text() !== bytes) return closed('resume_invalid')
  return { required: true, ready: true, reason: 'resume_verified' }
}
