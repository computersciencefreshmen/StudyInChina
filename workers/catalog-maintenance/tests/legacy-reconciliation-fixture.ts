import native from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { canonical, digest } from '../src/util'
import { OFFLINE_TABLES, offlineHandoffSchema, type OfflineHandoff } from '../src/legacy-manifest-contract'
import { canonicalLegacyArtifactDescriptors, canonicalLegacyRequestDescriptors, canonicalLegacyReservations, legacyReconciliationEventId, legacyReconciliationPackageKey,
  legacyReconciliationReceiptKey, type LegacyReconciliationPackage } from '../src/legacy-reconciliation-contracts'
import { legacyAuxiliaryLedgerSha256 } from '../src/legacy-reconciliation-do'
import { MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'

export const FIXTURE_NOW = Date.parse('2026-11-13T12:00:00.000Z')
export const fixtureBinding = { migrationId: 'test-legacy-reconciliation-20261114', role: 'target' as const, sourceAccountId: '1'.repeat(32), targetAccountId: '2'.repeat(32) }
export const fixtureEnv = { MAINTENANCE_ENABLED: 'false', SCOPE_REGISTRY_SHA256: EXISTING_SCHOOLS_V2_SHA256, SCOPE_SCHOOL_COUNT: '295', NATIVE_HEAD_RECONCILIATION_REQUIRED: 'true',
  MODEL_STATE_MIGRATION_ID: fixtureBinding.migrationId, MODEL_STATE_MIGRATION_ROLE: 'target', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: fixtureBinding.sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: fixtureBinding.targetAccountId }
export const fixtureGuard = { policySha256: 'a'.repeat(64), guardSetSha256: 'b'.repeat(64), registrationSha256: 'c'.repeat(64), exactUnknownCount: 3 as const }

/** Generated evidence, never historical/provider data. The trusted verifier is
 * substituted only in positive protocol tests; production default rejection is
 * tested separately and the actual permanent guard has its own native suite. */
export async function buildLegacyReconciliationFixture() {
  const iso = new Date(FIXTURE_NOW - 1000).toISOString(), objects: Array<[string, string]> = [], sql: Array<{ sql: string; values: unknown[] }> = []
  const evidence = async (value: unknown) => { const text = canonical(value), sha256 = await digest(text), objectKey = `maintenance/legacy-reconciliation/evidence/${sha256}.json`; objects.push([objectKey, text]); return { objectKey, sha256, byteLength: new TextEncoder().encode(text).length } }
  const sourceId = await digest('generated-source'), snapshot = await digest('generated-snapshot')
  const rows: OfflineHandoff['tableRows']['maintenance_model_attempts'] = [], reservations: OfflineHandoff['requestReservations'] = [], artifacts: OfflineHandoff['artifacts'] = []
  for (let i = 0; i < 171; i++) {
    const reservationKey = await digest(`generated-reservation-${i}`), requestSha256 = await digest(`generated-payload-${i}`), attemptId = `test-attempt-${i}`
    const status = i < 165 ? 'completed' as const : i < 168 ? 'unknown' as const : 'known_failed' as const
    let output_key: string | null = null, output_sha256: string | null = null
    if (status === 'completed') {
      // Both basic historical envelopes and extended envelopes are accepted;
      // none may cause a new provider request during adoption.
      const body = canonical({ attemptId, reservationKey, requestSha256, sourceId, snapshotSha256: snapshot, pass: 'primary', model: 'MiniMax-M3', output: { generated: i },
        ...(i < 9 ? {} : { providerResponse: { status: 200, fixtureOnly: true } }) })
      output_sha256 = await digest(body); output_key = `maintenance/models/${reservationKey}/${output_sha256}.json`
      const artifact = { objectKey: output_key, sha256: output_sha256, byteLength: new TextEncoder().encode(body).length }
      const stagingKey = `maintenance/offline-handoffs/test-legacy-batch/blobs/${output_sha256}.bin`
      artifacts.push(artifact); objects.push([stagingKey, body], [`maintenance/offline-handoffs/test-legacy-batch/uploads/${await digest(output_key)}.json`, canonical({ ...artifact, stagingKey })])
    }
    rows.push({ reservation_key: reservationKey, attempt_id: attemptId, source_id: sourceId, snapshot_sha256: snapshot, pass: 'primary', request_sha256: requestSha256, model: 'MiniMax-M3', status,
      started_at: iso, completed_at: status === 'unknown' ? null : iso, output_key, output_sha256, usage_json: status === 'known_failed' ? '{"providerStatus":200}' : null, quota_json: '{}', error_code: status === 'known_failed' ? 'model_output_invalid' : null })
    reservations.push({ reservationKey, state: status, attemptId, requestSha256, ...(status === 'known_failed' ? { retryable: false, attemptCount: 1, notBefore: 0 } : {}) })
  }
  const source: OfflineHandoff['tableRows']['maintenance_sources'][number] = { source_id: sourceId, url: 'https://fixture.edu.cn/catalog', allowed_hosts_json: '["fixture.edu.cn"]', category: 'undergraduate_catalog', categories_json: '["undergraduate_catalog"]', enabled: 1,
    interval_hours: 24, due_at: iso, last_attempt_at: null, last_success_at: null, raw_sha256: null, canonical_sha256: null, snapshot_key: null, etag: null, failures: 0, error_code: null, discovery_depth: 0 }
  const manifest = offlineHandoffSchema.parse({ format: 'studyinchina.offline-maintenance-handoff', version: 1, batchId: 'test-legacy-batch', scopeRegistrySha256: native.scopeRegistrySha256,
    inputCatalogSha256: native.oldInputCatalogSha256, seedSha256: native.seedSha256, legacyGuardSha256: native.legacyGuardSha256, artifacts, requestReservations: reservations,
    tableRows: { maintenance_sources: [source], maintenance_source_schools: [], maintenance_jobs: [], maintenance_observations: [], maintenance_model_attempts: rows, maintenance_proposals: [], maintenance_exports: [], maintenance_document_derivatives: [], maintenance_document_failures: [] } })
  const manifestText = canonical(manifest), manifestSha = await digest(manifestText)
  objects.push([`maintenance/offline-handoffs/${manifest.batchId}/manifests/${manifestSha}.json`, manifestText])
  const fence = { batchId: manifest.batchId, phase: 'held_for_handoff', tokenSha256: 'f'.repeat(64), scopeRegistrySha256: native.scopeRegistrySha256, inputCatalogSha256: native.oldInputCatalogSha256,
    acquiredAt: iso, manifestSha256: manifestSha, releaseRequestedAt: iso, seedSha256: native.seedSha256, legacyGuardSha256: native.legacyGuardSha256, rowsStarted: false, epoch: 0, retiredManifests: [], sourceManifestHistory: [] }
  const gate = { fetches: [], models: [], nextHost: { 'fixture.edu.cn': 10 }, successes: 7, cooldownUntil: 11, modelLimit: 2, offlineFence: fence }
  const auxiliary = [{ key: `offline-fence:${manifest.batchId}`, value: fence }]
  const migrationManifestSha256 = 'd'.repeat(64), lock = { version: 1, ...fixtureBinding, phase: 'finalized', frozenAt: iso, pages: [{ index: 0 }], importedPages: 1, finalizedAt: iso,
    manifestSha256: migrationManifestSha256, entryCount: 2, requestCount: 0, gatePresent: true, auxiliaryEntryCount: 1, states: { completed: 0, unknown: 0, known_failed: 0, send_started: 0 } }
  const proof = { phase: 'resume', manifestSha256: native.sha256, originalControl: { scope_sha256: native.scopeRegistrySha256, seed_sha256: native.seedSha256, legacy_guard_sha256: native.legacyGuardSha256,
    input_catalog_sha256: native.oldInputCatalogSha256, revision: 0, enabled: 1, models_enabled: 1, seed_complete: 1, targets_complete: 1, canary_json: '[]' }, pausedRevision: 1, reconciledRevision: 3, restoredRevision: 5, createdAt: iso }
  const proofText = canonical(proof), proofSha = await digest(proofText), proofKey = `maintenance/reconciliation/${native.operationId}/resume/${proofSha}.json`
  objects.push([proofKey, proofText]); sql.push({ sql: 'INSERT INTO maintenance_events VALUES(?,?,?,?)', values: [`${native.operationId}:resume`, 'native_git_head_resume', iso, canonical({ sha256: proofSha, objectKey: proofKey, proof })] })
  const migrationReceipt = await evidence({ format: 'studyinchina.model-state-migration-report', version: 1, ...fixtureBinding, state: 'finalized', sourceFrozen: true, targetFinalized: true, manifestSha256: migrationManifestSha256, modelCallsPerformed: false })
  const other = await evidence({ format: 'generated-test-proof', version: 1 }), history = await evidence({ format: 'generated-history-proof', version: 1, manifests: [manifestSha] })
  const p: LegacyReconciliationPackage = { format: 'studyinchina.legacy-offline-reconciliation-package', version: 1, operationId: 'test-legacy-reconciliation-operation', ...fixtureBinding,
    pipelineDatabaseId: '43e2d4a5-54a4-4932-97f3-755be12ef8bb', legacyBatchId: manifest.batchId, legacyManifestSha256: manifestSha,
    artifactDescriptorsSha256: await digest(canonicalLegacyArtifactDescriptors(artifacts)), historyChainSha256: history.sha256, historyProof: history, jobDriftReview: other,
    inputCatalogSha256: native.newInputCatalogSha256, nativeHeadReceipt: { objectKey: proofKey, sha256: proofSha, byteLength: new TextEncoder().encode(proofText).length }, scopeRegistrySha256: native.scopeRegistrySha256,
    seedSha256: native.seedSha256, legacyGuardSha256: native.legacyGuardSha256, controlRevision: 8, migrationManifestSha256, migrationReceipt, d1Receipt: other, r2Receipt: other, requestDescriptors: rows,
    requestReservationsSha256: await digest(canonicalLegacyReservations(reservations)), unknownGuardPolicySha256: fixtureGuard.policySha256, unknownGuardSetSha256: fixtureGuard.guardSetSha256, registrationIntentSha256: 'e'.repeat(64),
    classificationSha256: 'e'.repeat(64), importPlanSha256: 'f'.repeat(64), originalGateSha256: await digest(canonical(gate)), originalFenceSha256: await digest(canonical(fence)), originalAuxiliarySha256: await legacyAuxiliaryLedgerSha256(auxiliary), originalAuxiliaryEntryCount: 1,
    review: { operatorId: 'test-only-reviewer', decision: 'reconcile_preserve_unknown_reuse_completed', reviewedAt: iso } }
  // Remove test role: the public contract has only the two pinned accounts.
  delete (p as unknown as Record<string, unknown>).role
  const sha = await digest(canonical(p)); objects.push([legacyReconciliationPackageKey(sha), canonical(p)])
  sql.push({ sql: `INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,revision,enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,?,?,?,?,8,1,1,1,1,'[]',?)`, values: [p.scopeRegistrySha256, p.inputCatalogSha256, p.seedSha256, p.legacyGuardSha256, iso] })
  const add = (table: 'maintenance_sources' | 'maintenance_model_attempts', row: Record<string, unknown>) => { const columns = OFFLINE_TABLES[table].columns; sql.push({ sql: `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, values: columns.map(c => row[c]) }) }
  add('maintenance_sources', source); for (const row of rows) add('maintenance_model_attempts', row)
  return { p, sha, manifest, objects, sql, gate, auxiliary, entries: [{ key: MODEL_STATE_MIGRATION_KEY, value: lock }, { key: 'gate', value: gate }, ...auxiliary] as Array<{ key: string; value: unknown }> }
}
export async function buildFixtureFinalReceipt(p: LegacyReconciliationPackage, sha: string, ledgerSha: string) {
  const receipt = { format: 'studyinchina.legacy-offline-reconciliation-receipt', version: 1, operationId: p.operationId, reconciliationSha256: sha, migrationId: p.migrationId,
    sourceAccountId: p.sourceAccountId, targetAccountId: p.targetAccountId, pipelineDatabaseId: p.pipelineDatabaseId, legacyBatchId: p.legacyBatchId, legacyManifestSha256: p.legacyManifestSha256,
    inputCatalogSha256: p.inputCatalogSha256, scopeRegistrySha256: p.scopeRegistrySha256, seedSha256: p.seedSha256, legacyGuardSha256: p.legacyGuardSha256, controlRevision: p.controlRevision,
    migrationManifestSha256: p.migrationManifestSha256, artifactDescriptorsSha256: p.artifactDescriptorsSha256, historyChainSha256: p.historyChainSha256, classificationSha256: p.classificationSha256, importPlanSha256: p.importPlanSha256,
    requestDescriptorsSha256: await digest(canonicalLegacyRequestDescriptors(p.requestDescriptors)), adoptedLedgerSha256: ledgerSha, requestCount: 171, requestStates: { completed: 165, unknown: 3, known_failed: 3, send_started: 0 },
    unknownGuardPolicySha256: p.unknownGuardPolicySha256, unknownGuardSetSha256: p.unknownGuardSetSha256, unknownGuardRegistrationSha256: fixtureGuard.registrationSha256,
    createdAt: new Date(FIXTURE_NOW).toISOString(), modelCallsPerformed: false, oldManifestAcknowledged: false }
  const text = canonical(receipt), receiptSha = await digest(text)
  return { receipt, text, receiptSha, objectKey: legacyReconciliationReceiptKey(receiptSha), eventId: legacyReconciliationEventId(p.operationId) }
}
