import nativeHead from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import type { DurableStorage, MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, record } from './util'
import { typed } from './non-temporal-permit-recovery'
import { validateLegacyAuxiliaryEntry, validateLegacyOfflineGate, validateMigratedRequest } from './legacy-offline-state'
import { offlineHandoffSchema, OFFLINE_TABLES, type OfflineHandoff } from './legacy-manifest-contract'
import { verifyLegacyModelGuardRegistration } from './legacy-model-guards'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { isPinnedScopeTransition } from './scope-config'
import { validateLegacyReconciliationArchive, validateLegacyReconciliationState, type LegacyReconciliationArchive, type LegacyReconciliationFingerprint, type LegacyReconciliationState } from './legacy-reconciliation-state'
import { canonicalLegacyRequestDescriptors, type LegacyReconciliationPackage } from './legacy-reconciliation-contracts'
import { assertLegacyReceiptMatchesPackage, readFinalReceipt, readLegacyReconciliationEvidence, readLegacyReconciliationManifest, readLegacyReconciliationPackage } from './legacy-reconciliation-evidence'

type Binding = { migrationId: string; sourceAccountId: string; targetAccountId: string; role: 'source' | 'target' }
type Fingerprint = LegacyReconciliationFingerprint
type Reservation = { state: string; attemptId: string; requestSha256: string; retryable?: boolean; notBefore?: number; attemptCount?: number;
  result?: { attemptId: string; output: unknown; artifactKey: string; artifactSha256: string; reused: false } }
type Meta = LegacyReconciliationState
type Archive = LegacyReconciliationArchive
const CHUNK = 8, MAX_ENTRIES = 4096, MAX_ARTIFACT = 10 * 1024 * 1024, MAX_MODEL = 2 * 1024 * 1024
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const size = (v: string) => new TextEncoder().encode(v).length
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const fail = (code: string): never => { throw new MaintenanceError(`legacy_reconciliation_${code}`) }
const stateKey = (sha: string) => `legacy-reconciliation:${sha}`
const archiveKey = (sha: string) => `legacy-reconciliation-archive:${sha}`
const fingerprint = async (v: unknown) => digest(canonical(typed(v)))
export const legacyAuxiliaryLedgerSha256 = async (entries: Array<{ key: string; value: unknown }>) => digest(canonical({ format: 'studyinchina.legacy-offline-auxiliary-ledger.v1',
  entries: await Promise.all([...entries].sort((a, b) => compare(a.key, b.key)).map(async e => [e.key, await fingerprint(e.value)])) }))
export const legacyAdoptedLedgerSha256 = (entries: Fingerprint[]) => digest(canonical({ format: 'studyinchina.legacy-offline-adopted-ledger.v1', entries: [...entries].sort(([a], [b]) => compare(a, b)) }))

async function allEntries(storage: DurableStorage) {
  if (!storage.list) return fail('storage_list_required')
  const entries: Array<{ key: string; value: unknown }> = []; let startAfter: string | undefined
  for (;;) {
    const page = await storage.list({ ...(startAfter === undefined ? {} : { startAfter }), limit: 32 })
    if (!(page instanceof Map) || page.size > 32) return fail('incomplete_storage_scan')
    for (const [key, value] of page) {
      if (typeof key !== 'string' || startAfter !== undefined && key <= startAfter || entries.length >= MAX_ENTRIES) return fail('incomplete_storage_scan')
      typed(value); entries.push({ key, value }); startAfter = key
    }
    if (page.size < 32) {
      if ((await storage.list({ ...(startAfter === undefined ? {} : { startAfter }), limit: 1 })).size) return fail('incomplete_storage_scan')
      return entries
    }
  }
}
function checkedMeta(value: unknown, sha: string, p: LegacyReconciliationPackage): Meta {
  validateLegacyReconciliationState(value, sha)
  const m = record(value)
  if (!m || m.format !== 'studyinchina.legacy-reconciliation-do-state' || m.version !== 1 || m.reconciliationSha256 !== sha || m.operationId !== p.operationId
    || !integer(m.historyOffset) || !integer(m.promotedOffset) || !integer(m.adoptedOffset) || !integer(m.verifiedOffset)
    || m.historyOffset > 4096 || m.promotedOffset > 10000 || m.adoptedOffset > 171 || m.verifiedOffset > 171 || m.verifiedOffset > m.adoptedOffset
    || !Array.isArray(m.fingerprints) || m.fingerprints.length !== m.adoptedOffset || typeof m.finalized !== 'boolean') return fail('state_invalid')
  for (const e of m.fingerprints) if (!Array.isArray(e) || e.length !== 2 || !/^request:[a-f0-9]{64}$/.test(String(e[0])) || !HASH.test(String(e[1]))) return fail('state_invalid')
  if (new Set(m.fingerprints.map(e => e[0])).size !== m.fingerprints.length) return fail('state_invalid')
  return m as Meta
}
async function bounded(env: MaintenanceEnv, key: string, max: number) {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > max) return fail('artifact_unavailable')
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (!bytes.length || bytes.length > max) return fail('artifact_unavailable')
  return bytes
}
async function currentControl(env: MaintenanceEnv, p: LegacyReconciliationPackage) {
  const c = await env.PIPELINE_DB.prepare('SELECT scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,revision,seed_complete,targets_complete FROM maintenance_control WHERE singleton=1')
    .first<{ scope_sha256: string; input_catalog_sha256: string; seed_sha256: string; legacy_guard_sha256: string; revision: number; seed_complete: number; targets_complete: number }>()
  if (!c || c.scope_sha256 !== p.scopeRegistrySha256 || c.input_catalog_sha256 !== p.inputCatalogSha256 || c.seed_sha256 !== p.seedSha256 || c.legacy_guard_sha256 !== p.legacyGuardSha256
    || c.revision !== p.controlRevision || c.seed_complete !== 1 || c.targets_complete !== 1
    || env.SCOPE_REGISTRY_SHA256 !== c.scope_sha256 && !isPinnedScopeTransition(env, c.scope_sha256)) return fail('control_pin_changed')
}
async function lockAndGate(storage: DurableStorage, binding: Binding, lockKey: string, p: LegacyReconciliationPackage, active: () => number) {
  const lock = record(await storage.get(lockKey))
  if (active() !== 0 || binding.role !== 'target' || !lock || lock.role !== 'target' || lock.phase !== 'finalized' || lock.migrationId !== binding.migrationId
    || lock.sourceAccountId !== binding.sourceAccountId || lock.targetAccountId !== binding.targetAccountId || lock.manifestSha256 !== p.migrationManifestSha256
    || !Array.isArray(lock.pages) || lock.pages.length < 1 || lock.importedPages !== lock.pages.length || !lock.finalizedAt) return fail('finalized_disabled_target_required')
  const gate = record(await storage.get('gate')); if (!gate) return fail('gate_missing')
  validateLegacyOfflineGate(gate)
  return { lock, gate }
}
async function verifyPending(storage: DurableStorage, binding: Binding, lockKey: string, p: LegacyReconciliationPackage, active: () => number) {
  const { lock, gate } = await lockAndGate(storage, binding, lockKey, p, active), f = record(gate.offlineFence)
  if (!f || f.batchId !== p.legacyBatchId || f.manifestSha256 !== p.legacyManifestSha256 || f.phase !== 'held_for_handoff' || f.rowsStarted !== false
    || !Array.isArray(gate.fetches) || gate.fetches.length || !Array.isArray(gate.models) || gate.models.length
    || await digest(canonical(gate)) !== p.originalGateSha256 || await digest(canonical(f)) !== p.originalFenceSha256
    || !same(await storage.get(`offline-fence:${p.legacyBatchId}`), f)) return fail('pending_intent_changed')
  return { lock, gate }
}

async function context(env: MaintenanceEnv, binding: Binding, sha: string, now: number) {
  if (binding.role !== 'target' || env.MAINTENANCE_ENABLED !== 'false') return fail('disabled_target_required')
  const p = await readLegacyReconciliationPackage(env, sha)
  if (p.migrationId !== binding.migrationId || p.sourceAccountId !== binding.sourceAccountId || p.targetAccountId !== binding.targetAccountId
    || Date.parse(p.review.reviewedAt) > now || p.historyChainSha256 !== p.historyProof.sha256) return fail('package_binding_mismatch')
  await currentControl(env, p)
  const m = await readLegacyReconciliationManifest(env, p)
  const proof = record(await readLegacyReconciliationEvidence(env, p.nativeHeadReceipt))
  const event = await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(`${nativeHead.operationId}:resume`).first<{ kind: string; details_json: string }>()
  const stored = event ? record(JSON.parse(event.details_json)) : null
  if (event?.kind !== 'native_git_head_resume' || stored?.sha256 !== p.nativeHeadReceipt.sha256 || !same(stored.proof, proof)
    || m.inputCatalogSha256 !== nativeHead.oldInputCatalogSha256 || p.inputCatalogSha256 !== nativeHead.newInputCatalogSha256
    || !(await nativeReconciliationGate(env)).ready) return fail('native_head_proof_invalid')
  const migration = record(await readLegacyReconciliationEvidence(env, p.migrationReceipt))
  if (!migration || migration.format !== 'studyinchina.model-state-migration-report' || migration.migrationId !== p.migrationId || migration.state !== 'finalized'
    || migration.sourceFrozen !== true || migration.targetFinalized !== true || migration.manifestSha256 !== p.migrationManifestSha256 || migration.modelCallsPerformed !== false) return fail('migration_receipt_invalid')
  // The authoritative import writer verifies the physical checkpoints and
  // reviewed classification. Hash these original evidence bytes, not a boolean
  // supplied on this HTTP request; raw gate/storage are never R2 evidence.
  for (const ref of [p.d1Receipt, p.r2Receipt, p.historyProof, p.jobDriftReview]) await readLegacyReconciliationEvidence(env, ref)
  return { p, m }
}

async function prepare(storage: DurableStorage, binding: Binding, lockKey: string, p: LegacyReconciliationPackage, sha: string, active: () => number) {
  return storage.transaction(async txn => {
    const existing = await txn.get(stateKey(sha))
    if (existing !== undefined) {
      const meta = checkedMeta(existing, sha, p), a = record(await txn.get(archiveKey(sha)))
      validateLegacyReconciliationArchive(a, sha)
      if (!a || a.format !== 'studyinchina.legacy-reconciliation-do-archive' || a.version !== 1 || a.reconciliationSha256 !== sha || a.originalGateSha256 !== p.originalGateSha256
        || typeof a.originalGateJson !== 'string' || await digest(a.originalGateJson) !== p.originalGateSha256 || !Array.isArray(a.auxiliaryEntries) || !Array.isArray(a.baseline)) return fail('archive_invalid')
      await lockAndGate(txn, binding, lockKey, p, active)
      if (!meta.finalized) await verifyPending(txn, binding, lockKey, p, active)
      else if (await digest(canonical(await txn.get('gate'))) !== meta.finalGateSha256) return fail('finalized_gate_changed')
      return { meta, archive: a as unknown as Archive }
    }
    const { lock, gate } = await verifyPending(txn, binding, lockKey, p, active), all = await allEntries(txn)
    const auxiliaryEntries: Archive['auxiliaryEntries'] = [], baseline: Fingerprint[] = []
    const states: Record<string, number> = { completed: 0, unknown: 0, known_failed: 0, send_started: 0 }
    for (const entry of all) {
      if (entry.key === lockKey || entry.key === 'gate') continue
      if (entry.key.startsWith('legacy-reconciliation:') || entry.key.startsWith('legacy-reconciliation-archive:')) return fail('competing_reconciliation_state')
      if (/^request:[a-f0-9]{64}$/.test(entry.key)) { validateMigratedRequest(entry.value); baseline.push([entry.key, await fingerprint(entry.value)]); states[String(record(entry.value)!.state)]++ }
      else if (validateLegacyAuxiliaryEntry(entry.key, entry.value)) auxiliaryEntries.push(entry)
      else return fail('unknown_or_competing_state')
    }
    if (baseline.length !== lock.requestCount || !same(states, lock.states) || states.unknown || states.send_started
      || auxiliaryEntries.length !== p.originalAuxiliaryEntryCount || await legacyAuxiliaryLedgerSha256(auxiliaryEntries) !== p.originalAuxiliarySha256) return fail('baseline_snapshot_changed')
    const archive: Archive = { format: 'studyinchina.legacy-reconciliation-do-archive', version: 1, reconciliationSha256: sha, originalGateJson: canonical(gate), originalGateSha256: p.originalGateSha256, auxiliaryEntries, baseline }
    const meta: Meta = { format: 'studyinchina.legacy-reconciliation-do-state', version: 1, reconciliationSha256: sha, operationId: p.operationId,
      historyOffset: 0, promotedOffset: 0, adoptedOffset: 0, verifiedOffset: 0, fingerprints: [], finalized: false, receiptSha256: null, finalGateSha256: null, finalizedAt: null }
    if (size(canonical(archive)) > 64 * 1024 || active() !== 0) return fail('archive_too_large_or_active')
    await txn.put(archiveKey(sha), archive); await txn.put(stateKey(sha), meta)
    return { meta, archive }
  })
}
async function archiveUnchanged(storage: DurableStorage, p: LegacyReconciliationPackage, archive: Archive) {
  if (await legacyAuxiliaryLedgerSha256(archive.auxiliaryEntries) !== p.originalAuxiliarySha256 || archive.auxiliaryEntries.length !== p.originalAuxiliaryEntryCount) return fail('archive_auxiliary_changed')
  for (const entry of archive.auxiliaryEntries) if (!same(await storage.get(entry.key), entry.value)) return fail('original_auxiliary_changed')
  for (const [key, sha] of archive.baseline) if (await fingerprint(await storage.get(key)) !== sha) return fail('original_request_changed')
}
async function update(storage: DurableStorage, binding: Binding, lockKey: string, p: LegacyReconciliationPackage, sha: string, before: Meta,
  active: () => number, apply: (txn: DurableStorage, current: Meta) => Promise<void>) {
  return storage.transaction(async txn => {
    await verifyPending(txn, binding, lockKey, p, active)
    const current = checkedMeta(await txn.get(stateKey(sha)), sha, p)
    if (!same(current, before)) return fail('concurrent_progress_changed')
    await apply(txn, current)
    if (active() !== 0 || size(canonical(current)) > 64 * 1024) return fail('active_or_oversized_progress')
    await txn.put(stateKey(sha), current)
    if (!same(await txn.get(stateKey(sha)), current)) return fail('progress_readback_failed')
    return current
  })
}
function receipt(meta: Meta, phase: string, nextOffset: number | null, reused = false) {
  return { ok: true, reconciliationSha256: meta.reconciliationSha256, operationId: meta.operationId, phase, nextOffset, reused,
    promotedCount: meta.promotedOffset, adoptedCount: meta.adoptedOffset, verifiedCount: meta.verifiedOffset, finalized: meta.finalized,
    intentHeld: !meta.finalized, modelCallsPerformed: false, oldManifestAcknowledged: false, adoptedLedgerSha256: null as string | null }
}
async function historicalManifest(env: MaintenanceEnv, p: LegacyReconciliationPackage, sha: string) {
  const bytes = await bounded(env, `maintenance/offline-handoffs/${p.legacyBatchId}/manifests/${sha}.json`, 8 * 1024 * 1024)
  if (await digest(bytes) !== sha) return fail('history_hash_invalid')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), parsed = offlineHandoffSchema.safeParse(JSON.parse(text))
  if (!parsed.success || canonical(parsed.data) !== text || parsed.data.batchId !== p.legacyBatchId) return fail('history_invalid')
  return parsed.data
}
function financialIndex(current: OfflineHandoff) {
  return { attempts: new Map(current.tableRows.maintenance_model_attempts.map(v => [v.attempt_id, canonical(v)])),
    reservations: new Map(current.requestReservations.map(v => [v.reservationKey, canonical(v)])), artifacts: new Map(current.artifacts.map(v => [v.objectKey, canonical(v)])) }
}
function financialSubset(old: OfflineHandoff, current: OfflineHandoff, index: ReturnType<typeof financialIndex>) {
  for (const row of old.tableRows.maintenance_model_attempts) if (index.attempts.get(row.attempt_id) !== canonical(row)) return fail('historical_model_history_changed')
  for (const row of old.requestReservations) if (index.reservations.get(row.reservationKey) !== canonical(row)) return fail('historical_reservation_changed')
  for (const row of old.artifacts) if (index.artifacts.get(row.objectKey) !== canonical(row)) return fail('historical_artifact_changed')
  for (const key of ['scopeRegistrySha256', 'inputCatalogSha256', 'seedSha256', 'legacyGuardSha256'] as const) if (old[key] !== current[key]) return fail('historical_scope_changed')
}
async function promoteArtifact(env: MaintenanceEnv, p: LegacyReconciliationPackage, artifact: OfflineHandoff['artifacts'][number]) {
  const prefix = `maintenance/offline-handoffs/${p.legacyBatchId}`, stagedKey = `${prefix}/blobs/${artifact.sha256}.bin`
  const expected = canonical({ ...artifact, stagingKey: stagedKey }), uploadKey = `${prefix}/uploads/${await digest(artifact.objectKey)}.json`
  const upload = await bounded(env, uploadKey, 64 * 1024)
  if (upload.length !== size(expected) || await digest(upload) !== await digest(expected)) return fail('upload_receipt_invalid')
  const bytes = await bounded(env, stagedKey, MAX_ARTIFACT)
  if (bytes.length !== artifact.byteLength || await digest(bytes) !== artifact.sha256) return fail('staged_artifact_invalid')
  const old = await env.SNAPSHOTS_BUCKET.get(artifact.objectKey)
  if (old) {
    if (old.size !== undefined && old.size !== artifact.byteLength || await digest(await old.arrayBuffer()) !== artifact.sha256) return fail('canonical_artifact_conflict')
    return
  }
  await env.SNAPSHOTS_BUCKET.put(artifact.objectKey, bytes, { onlyIf: { etagDoesNotMatch: '*' } })
  const after = await bounded(env, artifact.objectKey, MAX_ARTIFACT)
  if (after.length !== artifact.byteLength || await digest(after) !== artifact.sha256) return fail('canonical_artifact_conflict')
}

async function verifyRows(env: MaintenanceEnv, rows: LegacyReconciliationPackage['requestDescriptors']) {
  if (!rows.length || rows.length > 171) return fail('request_slice_invalid')
  const columns = OFFLINE_TABLES.maintenance_model_attempts.columns
  const actual = (await env.PIPELINE_DB.prepare(`SELECT ${columns.join(',')} FROM maintenance_model_attempts WHERE attempt_id IN(SELECT value FROM json_each(?)) ORDER BY attempt_id`)
    .bind(JSON.stringify(rows.map(r => r.attempt_id))).all()).results ?? []
  // node:sqlite uses null-prototype rows; project the fixed columns into plain
  // JSON objects before the same strict canonical comparison used with D1.
  const projected = actual.map(row => Object.fromEntries(columns.map(column => [column, (row as Record<string, unknown>)[column]])))
  if (actual.length !== rows.length || canonicalLegacyRequestDescriptors(projected as typeof rows) !== canonicalLegacyRequestDescriptors(rows)) return fail('request_sql_changed')
}
async function reservation(env: MaintenanceEnv, m: OfflineHandoff, metadata: OfflineHandoff['requestReservations'][number]): Promise<Reservation> {
  const row = m.tableRows.maintenance_model_attempts.find(r => r.attempt_id === metadata.attemptId)
  if (!row || row.reservation_key !== metadata.reservationKey || row.request_sha256 !== metadata.requestSha256 || row.status !== metadata.state) return fail('reservation_attempt_mismatch')
  const { reservationKey: _key, ...original } = metadata
  void _key
  const result: Reservation = { ...original }
  if (metadata.state === 'completed') {
    if (!row.output_key || !row.output_sha256 || row.output_key !== `maintenance/models/${row.reservation_key}/${row.output_sha256}.json`) return fail('canonical_model_key_invalid')
    const bytes = await bounded(env, row.output_key, MAX_MODEL)
    if (await digest(bytes) !== row.output_sha256) return fail('canonical_model_hash_invalid')
    let artifact: Record<string, unknown> | null
    try { artifact = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) } catch { return fail('canonical_model_invalid') }
    // Nine historical completions legitimately have only this canonical output;
    // a raw HTTP body is not required and is never reconstructed or re-sent.
    if (!artifact || artifact.attemptId !== row.attempt_id || artifact.reservationKey !== row.reservation_key || artifact.requestSha256 !== row.request_sha256
      || artifact.sourceId !== row.source_id || artifact.snapshotSha256 !== row.snapshot_sha256 || artifact.pass !== row.pass || artifact.model !== row.model || !Object.hasOwn(artifact, 'output')) return fail('canonical_model_binding_invalid')
    result.result = { attemptId: row.attempt_id, output: artifact.output, artifactKey: row.output_key, artifactSha256: row.output_sha256, reused: false }
  }
  // In particular known_failed is not defaulted to retryable: these failures
  // can have HTTP 200 with invalid/truncated output, and metadata says false.
  validateMigratedRequest(result, true)
  return result
}
async function verifyNamespace(storage: DurableStorage, lockKey: string, sha: string, archive: Archive, meta: Meta) {
  const expected = new Map([...archive.baseline, ...meta.fingerprints]), auxiliary = new Map(archive.auxiliaryEntries.map(e => [e.key, e.value]))
  let requests = 0, auxiliaries = 0
  for (const entry of await allEntries(storage)) {
    if ([lockKey, 'gate', stateKey(sha), archiveKey(sha)].includes(entry.key)) continue
    if (expected.has(entry.key)) { if (await fingerprint(entry.value) !== expected.get(entry.key)) return fail('adopted_request_changed'); requests++ }
    else if (auxiliary.has(entry.key)) { if (!same(entry.value, auxiliary.get(entry.key))) return fail('original_auxiliary_changed'); auxiliaries++ }
    else return fail('unexpected_target_state')
  }
  if (requests !== expected.size || auxiliaries !== auxiliary.size) return fail('target_state_missing')
}

/** Target-only controlled operator protocol. The real verifier is the default;
 * the optional function is a trusted in-process test dependency, never HTTP data. */
export async function handleLegacyReconciliation(storage: DurableStorage, env: MaintenanceEnv, binding: Binding, lockKey: string,
  path: string, body: Record<string, unknown>, active: () => number, now = Date.now(), verifyRegistration: typeof verifyLegacyModelGuardRegistration = verifyLegacyModelGuardRegistration) {
  const phase = path.split('/').at(-1), offset = body.offset, sha = String(body.reconciliationSha256)
  const allowed = phase === 'reconciliation-finalize' ? ['migrationId', 'reconciliationSha256', 'receiptSha256', 'offset'] : ['migrationId', 'reconciliationSha256', 'offset']
  if (!['reconciliation-promote', 'reconciliation-adopt', 'reconciliation-finalize'].includes(String(phase)) || Object.keys(body).length !== allowed.length || allowed.some(k => !Object.hasOwn(body, k))
    || body.migrationId !== binding.migrationId || !HASH.test(sha) || !integer(offset) || phase === 'reconciliation-finalize' && !HASH.test(String(body.receiptSha256))) return fail('operator_request_invalid')
  const { p, m } = await context(env, binding, sha, now), prepared = await prepare(storage, binding, lockKey, p, sha, active)
  const { meta, archive } = prepared
  const originalFence = record(JSON.parse(archive.originalGateJson).offlineFence)!
  const historyCount = (Array.isArray(originalFence.retiredManifests) ? originalFence.retiredManifests.length : 0) + 1
  if (meta.historyOffset > historyCount || meta.promotedOffset > m.artifacts.length || meta.adoptedOffset > m.requestReservations.length || meta.verifiedOffset > m.requestReservations.length) return fail('state_invalid')
  await archiveUnchanged(storage, p, archive)
  if (meta.finalized) {
    if (phase !== 'reconciliation-finalize' || meta.receiptSha256 !== body.receiptSha256) return fail('already_finalized')
    const final = await readFinalReceipt(env, String(body.receiptSha256)); assertLegacyReceiptMatchesPackage(final.receipt, p, sha)
    const g = await verifyRegistration(env, sha)
    if (g.registrationSha256 !== final.receipt.unknownGuardRegistrationSha256 || g.policySha256 !== p.unknownGuardPolicySha256 || g.guardSetSha256 !== p.unknownGuardSetSha256 || g.exactUnknownCount !== 3) return fail('unknown_guards_mismatch')
    return { ...receipt(meta, 'complete', null, true), adoptedLedgerSha256: await legacyAdoptedLedgerSha256(meta.fingerprints), receiptSha256: meta.receiptSha256 }
  }
  if (phase === 'reconciliation-promote') {
    const fence = record(JSON.parse(archive.originalGateJson).offlineFence)!, retired = Array.isArray(fence.retiredManifests) ? fence.retiredManifests as string[] : []
    const history = [...retired, p.legacyManifestSha256]
    if (meta.historyOffset < history.length) {
      if (offset !== 0 || meta.promotedOffset) return fail('history_not_verified')
      const end = Math.min(meta.historyOffset + CHUNK, history.length)
      const index = financialIndex(m)
      for (const prior of history.slice(meta.historyOffset, end)) financialSubset(await historicalManifest(env, p, prior), m, index)
      await currentControl(env, p)
      const saved = await update(storage, binding, lockKey, p, sha, meta, active, async (_txn, current) => { current.historyOffset = end })
      return { ...receipt(saved, 'history', 0), verifiedHistoryCount: saved.historyOffset, historyCount: history.length }
    }
    if (offset > meta.promotedOffset || offset % CHUNK !== 0 && offset !== m.artifacts.length) return fail('promote_offset_invalid')
    const end = Math.min(offset + CHUNK, m.artifacts.length)
    if (offset >= m.artifacts.length) return receipt(meta, 'artifacts', null, true)
    for (const artifact of m.artifacts.slice(offset, end)) await promoteArtifact(env, p, artifact)
    await currentControl(env, p)
    if (offset < meta.promotedOffset) {
      if (end > meta.promotedOffset) return fail('promote_offset_invalid')
      return receipt(meta, 'artifacts', meta.promotedOffset === m.artifacts.length ? null : meta.promotedOffset, true)
    }
    const saved = await update(storage, binding, lockKey, p, sha, meta, active, async (_txn, current) => { current.promotedOffset = end })
    return receipt(saved, 'artifacts', end === m.artifacts.length ? null : end)
  }
  if (meta.promotedOffset !== m.artifacts.length) return fail('all_artifacts_required')
  const g = await verifyRegistration(env, sha)
  if (g.exactUnknownCount !== 3 || g.policySha256 !== p.unknownGuardPolicySha256 || g.guardSetSha256 !== p.unknownGuardSetSha256) return fail('unknown_guards_mismatch')
  const reservations = m.requestReservations, cursor = phase === 'reconciliation-adopt' ? meta.adoptedOffset : meta.verifiedOffset
  if (offset > cursor || offset % CHUNK !== 0 && offset !== reservations.length) return fail('adoption_offset_invalid')
  if (phase === 'reconciliation-finalize' && meta.adoptedOffset !== reservations.length) return fail('all_adoptions_required')
  const final = phase === 'reconciliation-finalize' ? await readFinalReceipt(env, String(body.receiptSha256)) : null
  if (final) {
    if (meta.receiptSha256 && meta.receiptSha256 !== body.receiptSha256) return fail('final_receipt_changed')
    assertLegacyReceiptMatchesPackage(final.receipt, p, sha)
    if (final.receipt.unknownGuardRegistrationSha256 !== g.registrationSha256 || final.receipt.adoptedLedgerSha256 !== await legacyAdoptedLedgerSha256(meta.fingerprints)) return fail('final_receipt_binding_mismatch')
  }
  const end = Math.min(offset + CHUNK, reservations.length), selected = reservations.slice(offset, end)
  if (!selected.length) return fail('adoption_offset_invalid')
  await verifyRows(env, selected.map(r => m.tableRows.maintenance_model_attempts.find(v => v.attempt_id === r.attemptId)!))
  const values = await Promise.all(selected.map(async r => ({ key: `request:${r.reservationKey}`, value: await reservation(env, m, r) })))
  const fingerprints: Fingerprint[] = await Promise.all(values.map(async e => [e.key, await fingerprint(e.value)] as Fingerprint))
  await currentControl(env, p)
  if (offset < cursor) {
    if (end > cursor) return fail('adoption_offset_invalid')
    for (const e of values) if (!same(await storage.get(e.key), e.value)) return fail('adopted_request_changed')
    return { ...receipt(meta, phase === 'reconciliation-adopt' ? 'adoptions' : 'verification', cursor === reservations.length ? null : cursor, true),
      adoptedLedgerSha256: meta.adoptedOffset === reservations.length ? await legacyAdoptedLedgerSha256(meta.fingerprints) : null }
  }
  const closing = final !== null && end === reservations.length
  if (closing) {
    await verifyRows(env, p.requestDescriptors)
    const unresolved = await env.PIPELINE_DB.prepare("SELECT COUNT(*) count FROM maintenance_model_attempts WHERE status IN('reserved','send_started','unknown')").first<{ count: number }>()
    if (unresolved?.count !== 3) return fail('extra_or_active_unknown')
    const fresh = await readFinalReceipt(env, String(body.receiptSha256)), registered = await verifyRegistration(env, sha)
    if (fresh.detailsJson !== final.detailsJson || registered.registrationSha256 !== g.registrationSha256 || registered.policySha256 !== p.unknownGuardPolicySha256
      || registered.guardSetSha256 !== p.unknownGuardSetSha256 || registered.exactUnknownCount !== 3) return fail('final_proof_changed')
    await currentControl(env, p)
  }
  const saved = await update(storage, binding, lockKey, p, sha, meta, active, async (txn, current) => {
    await archiveUnchanged(txn, p, archive)
    for (const e of values) {
      const prior = await txn.get(e.key)
      if (prior !== undefined && !same(prior, e.value) || phase === 'reconciliation-finalize' && prior === undefined) return fail('reservation_conflict')
      if (phase === 'reconciliation-adopt' && prior === undefined) await txn.put(e.key, e.value)
      if (!same(await txn.get(e.key), e.value)) return fail('reservation_readback_failed')
    }
    if (phase === 'reconciliation-adopt') { current.adoptedOffset = end; current.fingerprints.push(...fingerprints) }
    else { current.verifiedOffset = end; if (current.receiptSha256 && current.receiptSha256 !== body.receiptSha256) return fail('final_receipt_changed'); current.receiptSha256 = String(body.receiptSha256) }
    if (closing) {
      await verifyNamespace(txn, lockKey, sha, archive, current)
      if (await legacyAdoptedLedgerSha256(current.fingerprints) !== final!.receipt.adoptedLedgerSha256) return fail('adopted_ledger_changed')
      const original = record(JSON.parse(archive.originalGateJson))!, gate = { ...original }
      delete gate.offlineFence; delete gate.offlineHandoffOperationRecovery
      gate.legacyOfflineReconciliation = { format: 'studyinchina.legacy-offline-reconciliation-gate', version: 1, reconciliationSha256: sha,
        operationId: p.operationId, receiptSha256: body.receiptSha256, archiveKey: archiveKey(sha), originalGateSha256: p.originalGateSha256, finalizedAt: new Date(now).toISOString() }
      await txn.put('gate', gate)
      if (!same(await txn.get('gate'), gate)) return fail('gate_readback_failed')
      current.finalized = true; current.finalizedAt = new Date(now).toISOString(); current.finalGateSha256 = await digest(canonical(gate))
    }
  })
  return { ...receipt(saved, closing ? 'complete' : phase === 'reconciliation-adopt' ? 'adoptions' : 'verification', end === reservations.length ? null : end),
    adoptedLedgerSha256: saved.adoptedOffset === reservations.length ? await legacyAdoptedLedgerSha256(saved.fingerprints) : null,
    ...(closing ? { receiptSha256: body.receiptSha256 } : {}) }
}
