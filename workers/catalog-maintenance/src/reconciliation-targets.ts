import { readMaintenanceControl, PINNED_HEAD_RECONCILIATION as pin } from './head-reconciliation'
import { refreshTargets } from './repository'
import type { MaintenanceEnv, ReconciliationTargetsUpload } from './types'
import { MaintenanceError } from './types'
import { digest, record } from './util'

const prefix = `maintenance/reconciliation/${pin.operationId}/target-uploads/${pin.targetUpload.sha256}/`
function validUpload(value: ReconciliationTargetsUpload) {
  return value.manifestSha256 === pin.sha256 && value.bodySha256 === pin.targetUpload.sha256 && value.byteLength === pin.targetUpload.byteLength && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && typeof value.uploadKey === 'string' && value.uploadKey.startsWith(prefix) && /^[a-f0-9-]{36}\.json$/u.test(value.uploadKey.slice(prefix.length))
}
async function uploadState(env: MaintenanceEnv, expectedRevision: number) {
  const state = await readMaintenanceControl(env), cfg = state.control, paused = state.reconciliation.paused, advanced = state.reconciliation.advanced
  if (!cfg || !paused || !advanced || cfg.input_catalog_sha256 !== pin.newInputCatalogSha256 || cfg.seed_sha256 !== pin.seedSha256 || cfg.legacy_guard_sha256 !== pin.legacyGuardSha256 || cfg.canary_json !== paused.originalControl.canary_json || cfg.enabled !== 0 || cfg.models_enabled !== 0 || advanced.reconciledRevision !== expectedRevision || cfg.revision !== expectedRevision + cfg.targets_complete || state.reconciliation.resumed) throw new MaintenanceError('reconciliation_target_upload_control_changed')
  return { complete: cfg.targets_complete === 1 }
}

/** Keep the native known-length stream intact; no bulk JSON parsing in HTTP. */
export async function registerReconciliationTargets(env: MaintenanceEnv, request: Request) {
  const length = request.headers.get('content-length') ?? '', revision = request.headers.get('x-maintenance-expected-revision') ?? ''
  if (request.headers.get('x-maintenance-reconcile-sha256') !== pin.sha256 || request.headers.get('x-maintenance-targets-sha256') !== pin.targetUpload.sha256 || !/^(?:0|[1-9]\d*)$/u.test(revision) || length !== String(pin.targetUpload.byteLength) || !request.headers.get('content-type')?.includes('application/json') || !request.body) throw new MaintenanceError('reconciliation_target_upload_metadata_invalid')
  const expectedRevision = Number(revision)
  if (!Number.isSafeInteger(expectedRevision)) throw new MaintenanceError('reconciliation_target_upload_metadata_invalid')
  if ((await uploadState(env, expectedRevision)).complete) return { ok: true, pending: false, targetsComplete: true, reused: true, bodySha256: pin.targetUpload.sha256, byteLength: pin.targetUpload.byteLength, expectedRevision, modelCallsPerformed: false }
  const upload: ReconciliationTargetsUpload = { manifestSha256: pin.sha256, bodySha256: pin.targetUpload.sha256, byteLength: pin.targetUpload.byteLength, expectedRevision, uploadKey: `${prefix}${crypto.randomUUID()}.json` }
  // A failed or incomplete retry never overwrites a previously validated upload.
  await env.SNAPSHOTS_BUCKET.put(upload.uploadKey, request.body, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  await env.MAINTENANCE_QUEUE.send({ version: 1, jobId: upload.bodySha256, reconciliationTargetsUpload: upload })
  return { ok: true, pending: true, validation: 'pending-queue', bodySha256: upload.bodySha256, byteLength: upload.byteLength, uploadKey: upload.uploadKey, expectedRevision, modelCallsPerformed: false }
}

/** Reuse the established Queue lane and strict target planner, without changing CPU limits or billing. */
export async function prepareReconciliationTargets(env: MaintenanceEnv, upload: ReconciliationTargetsUpload) {
  if (!validUpload(upload)) throw new MaintenanceError('reconciliation_target_upload_binding_invalid')
  if ((await uploadState(env, upload.expectedRevision)).complete) return { targetsComplete: true, reused: true }
  const object = await env.SNAPSHOTS_BUCKET.get(upload.uploadKey)
  if (!object || object.size !== undefined && object.size !== upload.byteLength) throw new MaintenanceError('reconciliation_target_upload_size_mismatch')
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength !== upload.byteLength || await digest(bytes) !== upload.bodySha256) throw new MaintenanceError('reconciliation_target_upload_checksum_mismatch')
  const value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (!value || Object.keys(value).some(key => !['inputCatalogSha256','recordTargets'].includes(key)) || value.inputCatalogSha256 !== pin.newInputCatalogSha256 || !Array.isArray(value.recordTargets) || value.recordTargets.length !== pin.targetUpload.targetCount) throw new MaintenanceError('reconciliation_target_upload_scope_invalid')
  if ((await uploadState(env, upload.expectedRevision)).complete) return { targetsComplete: true, reused: true }
  return refreshTargets(env, value, true, { expectedRevision: upload.expectedRevision })
}
