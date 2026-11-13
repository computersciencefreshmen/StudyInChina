import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest } from './util'
import { offlineHandoffSchema, type OfflineHandoff } from './legacy-manifest-contract'
import { legacyReconciliationPackageKey, legacyReconciliationPackageSchema, legacyReconciliationReceiptKey, legacyReconciliationReceiptSchema,
  legacyReconciliationEventId, LEGACY_RECONCILIATION_EVENT_KIND, canonicalLegacyRequestDescriptors, canonicalLegacyArtifactDescriptors, canonicalLegacyReservations,
  type LegacyReconciliationPackage, type LegacyReconciliationEvidenceRef, type LegacyReconciliationReceipt } from './legacy-reconciliation-contracts'

export const MAX_LEGACY_RECONCILIATION_BYTES = 8 * 1024 * 1024
const fail = (code: string): never => { throw new MaintenanceError(`legacy_reconciliation_${code}`) }
async function checkedBytes(env: MaintenanceEnv, key: string, sha256: string, byteLength?: number) {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > MAX_LEGACY_RECONCILIATION_BYTES) return fail('evidence_unavailable')
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_LEGACY_RECONCILIATION_BYTES || byteLength !== undefined && bytes.length !== byteLength || await digest(bytes) !== sha256) return fail('evidence_hash_mismatch')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export async function readLegacyReconciliationEvidence(env: MaintenanceEnv, ref: LegacyReconciliationEvidenceRef): Promise<unknown> {
  try { return JSON.parse(await checkedBytes(env, ref.objectKey, ref.sha256, ref.byteLength)) } catch (error) {
    if (error instanceof MaintenanceError) throw error
    return fail('evidence_invalid')
  }
}
export async function readLegacyReconciliationPackage(env: MaintenanceEnv, sha256: string): Promise<LegacyReconciliationPackage> {
  const text = await checkedBytes(env, legacyReconciliationPackageKey(sha256), sha256)
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail('package_invalid') }
  const parsed = legacyReconciliationPackageSchema.safeParse(value)
  if (!parsed.success || canonical(parsed.data) !== text) return fail('package_invalid')
  return parsed.data
}
export async function readLegacyReconciliationManifest(env: MaintenanceEnv, p: LegacyReconciliationPackage): Promise<OfflineHandoff> {
  const key = `maintenance/offline-handoffs/${p.legacyBatchId}/manifests/${p.legacyManifestSha256}.json`
  const text = await checkedBytes(env, key, p.legacyManifestSha256)
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail('manifest_invalid') }
  const parsed = offlineHandoffSchema.safeParse(value)
  if (!parsed.success || canonical(parsed.data) !== text) return fail('manifest_invalid')
  const m = parsed.data
  if (m.batchId !== p.legacyBatchId || m.scopeRegistrySha256 !== p.scopeRegistrySha256 || m.seedSha256 !== p.seedSha256 || m.legacyGuardSha256 !== p.legacyGuardSha256
    || canonicalLegacyRequestDescriptors(m.tableRows.maintenance_model_attempts) !== canonicalLegacyRequestDescriptors(p.requestDescriptors)
    || await digest(canonicalLegacyArtifactDescriptors(m.artifacts)) !== p.artifactDescriptorsSha256
    || await digest(canonicalLegacyReservations(m.requestReservations)) !== p.requestReservationsSha256) return fail('manifest_binding_mismatch')
  return m
}
export function assertLegacyReceiptMatchesPackage(r: LegacyReconciliationReceipt, p: LegacyReconciliationPackage, reconciliationSha256: string) {
  const names = ['operationId', 'migrationId', 'sourceAccountId', 'targetAccountId', 'pipelineDatabaseId', 'legacyBatchId', 'legacyManifestSha256', 'inputCatalogSha256',
    'scopeRegistrySha256', 'seedSha256', 'legacyGuardSha256', 'controlRevision', 'migrationManifestSha256', 'artifactDescriptorsSha256', 'historyChainSha256', 'classificationSha256', 'importPlanSha256', 'unknownGuardPolicySha256', 'unknownGuardSetSha256'] as const
  if (r.reconciliationSha256 !== reconciliationSha256 || names.some(k => r[k] !== p[k])) return fail('receipt_package_mismatch')
}
export async function readFinalReceipt(env: MaintenanceEnv, sha256: string): Promise<{ receipt: LegacyReconciliationReceipt; eventId: string; detailsJson: string }> {
  const text = await checkedBytes(env, legacyReconciliationReceiptKey(sha256), sha256)
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail('receipt_invalid') }
  const parsed = legacyReconciliationReceiptSchema.safeParse(value)
  if (!parsed.success || canonical(parsed.data) !== text) return fail('receipt_invalid')
  const receipt = parsed.data, eventId = legacyReconciliationEventId(receipt.operationId)
  const p = await readLegacyReconciliationPackage(env, receipt.reconciliationSha256)
  assertLegacyReceiptMatchesPackage(receipt, p, receipt.reconciliationSha256)
  if (await digest(canonicalLegacyRequestDescriptors(p.requestDescriptors)) !== receipt.requestDescriptorsSha256) return fail('receipt_request_binding_mismatch')
  const row = await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(eventId).first<{ kind: string; details_json: string }>()
  if (row?.kind !== LEGACY_RECONCILIATION_EVENT_KIND || row.details_json !== text) return fail('receipt_event_mismatch')
  return { receipt, eventId, detailsJson: text }
}
