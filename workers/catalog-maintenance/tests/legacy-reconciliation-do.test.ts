import assert from 'node:assert/strict'
import test from 'node:test'
import { handleLegacyReconciliation } from '../src/legacy-reconciliation-do'
import { validateLegacyAuxiliaryEntry, validateLegacyOfflineGate } from '../src/legacy-offline-state'
import { MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { verifyLegacyModelGuardRegistration } from '../src/legacy-model-guards'
import { canonical, digest } from '../src/util'
import { makeEnv } from './fixture'
import { buildFixtureFinalReceipt, buildLegacyReconciliationFixture, FIXTURE_NOW, fixtureBinding, fixtureEnv, fixtureGuard } from './legacy-reconciliation-fixture'

async function setup() {
  const data = await buildLegacyReconciliationFixture(), f = makeEnv()
  Object.assign(f.env, fixtureEnv)
  for (const item of data.sql) f.db.sqlite.prepare(item.sql).run(...item.values as never[])
  for (const [key, value] of data.objects) await f.bucket.put(key, value)
  for (const { key, value } of data.entries) await f.storage.put(key, value)
  const storage = Object.assign(f.storage, { async list<T>(options: { startAfter?: string; limit?: number } = {}): Promise<Map<string, T>> {
    return new Map([...f.storage.values].filter(([key]) => !options.startAfter || key > options.startAfter).sort(([a], [b]) => a < b ? -1 : 1).slice(0, options.limit ?? 32).map(([key, value]) => [key, structuredClone(value) as T]))
  } })
  const verifier = (async () => fixtureGuard) as unknown as typeof verifyLegacyModelGuardRegistration
  const call = (phase: string, offset = 0, extra: Record<string, unknown> = {}, verify = verifier) => handleLegacyReconciliation(storage, f.env, fixtureBinding, MODEL_STATE_MIGRATION_KEY,
    `/model-state-migration/reconciliation-${phase}`, { migrationId: fixtureBinding.migrationId, reconciliationSha256: data.sha, offset, ...extra }, () => 0, FIXTURE_NOW, verify)
  const promote = async () => { let result = await call('promote'); while (result.nextOffset !== null) result = await call('promote', result.nextOffset); return result }
  const adopt = async () => { let result = await call('adopt'); while (result.nextOffset !== null) result = await call('adopt', result.nextOffset); return result }
  const finalReceipt = async (ledger: string) => { const final = await buildFixtureFinalReceipt(data.p, data.sha, ledger); await f.bucket.put(final.objectKey, final.text); f.db.sqlite.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').run(final.eventId, 'legacy_offline_reconciliation', new Date(FIXTURE_NOW).toISOString(), final.text); return final }
  return { ...f, ...data, storage, call, promote, adopt, finalReceipt }
}

test('full target reconciliation: exact 272->295 pin, finalized relay, <=8 writes, basic outputs and paid failures survive without calls or old ACK', async () => {
  const f = await setup()
  try {
    const originalGate = canonical(f.gate), originalAux = canonical(f.auxiliary), sqlBefore = f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts ORDER BY attempt_id').all()
    const history = await f.call('promote'); assert.equal(history.phase, 'history'); assert.equal(history.promotedCount, 0)
    const first = await f.call('promote'); assert.equal(first.promotedCount, 8)
    const duplicate = await f.call('promote'); assert.equal(duplicate.reused, true); assert.equal(duplicate.nextOffset, 8)
    await assert.rejects(f.call('adopt'), /all_artifacts_required/)
    await f.promote()
    const firstAdopt = await f.call('adopt'); assert.equal(firstAdopt.adoptedCount, 8)
    assert.equal((await f.storage.get<Record<string, unknown>>('gate'))?.offlineFence !== undefined, true)
    const adopted = await f.adopt(); assert.equal(adopted.adoptedCount, 171); assert.ok(adopted.adoptedLedgerSha256)
    const failed = f.manifest.requestReservations.filter(r => r.state === 'known_failed')
    for (const reservation of failed) assert.deepEqual(await f.storage.get(`request:${reservation.reservationKey}`), { state: reservation.state, attemptId: reservation.attemptId, requestSha256: reservation.requestSha256, retryable: false, attemptCount: 1, notBefore: 0 })
    for (const reservation of f.manifest.requestReservations.filter(r => r.state === 'unknown')) assert.deepEqual(await f.storage.get(`request:${reservation.reservationKey}`), { state: 'unknown', attemptId: reservation.attemptId, requestSha256: reservation.requestSha256 })
    const final = await f.finalReceipt(adopted.adoptedLedgerSha256!)
    let result = await f.call('finalize', 0, { receiptSha256: final.receiptSha })
    assert.equal(result.finalized, false); assert.equal((await f.storage.get<Record<string, unknown>>('gate'))?.offlineFence !== undefined, true)
    while (result.nextOffset !== null) result = await f.call('finalize', result.nextOffset, { receiptSha256: final.receiptSha })
    assert.equal(result.finalized, true); assert.equal(result.modelCallsPerformed, false); assert.equal(result.oldManifestAcknowledged, false)
    const gate = (await f.storage.get<Record<string, unknown>>('gate'))!, archive = (await f.storage.get<Record<string, unknown>>(`legacy-reconciliation-archive:${f.sha}`))!
    assert.equal(gate.offlineFence, undefined); assert.equal(gate.offlineHandoffOperationRecovery, undefined); assert.equal(archive.originalGateJson, originalGate)
    assert.equal(canonical(archive.auxiliaryEntries), originalAux)
    const afterControls = { ...gate }, beforeControls = { ...f.gate } as Record<string, unknown>
    delete afterControls.legacyOfflineReconciliation; delete beforeControls.offlineFence
    assert.deepEqual(afterControls, beforeControls)
    for (const e of f.auxiliary) assert.deepEqual(await f.storage.get(e.key), e.value)
    validateLegacyOfflineGate(gate)
    assert.equal(validateLegacyAuxiliaryEntry(`legacy-reconciliation-archive:${f.sha}`, archive), true)
    assert.equal(validateLegacyAuxiliaryEntry(`legacy-reconciliation:${f.sha}`, await f.storage.get(`legacy-reconciliation:${f.sha}`)), true)
    assert.equal((await f.call('finalize', 0, { receiptSha256: final.receiptSha })).reused, true)
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts ORDER BY attempt_id').all(), sqlBefore)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='offline_handoff_applied'").get()?.n, 0)
    assert.equal(f.messages.length, 0)
  } finally { f.db.sqlite.close() }
})

test('canonical promote conflict and bad staged/upload receipt never overwrite existing object or advance cursor', async () => {
  for (const kind of ['conflict', 'staged', 'receipt'] as const) {
    const f = await setup()
    try {
      await f.call('promote'); const artifact = f.manifest.artifacts[0]
      if (kind === 'conflict') await f.bucket.put(artifact.objectKey, 'existing-conflicting-private-object')
      else if (kind === 'staged') await f.bucket.put(`maintenance/offline-handoffs/${f.p.legacyBatchId}/blobs/${artifact.sha256}.bin`, 'changed')
      else await f.bucket.put(`maintenance/offline-handoffs/${f.p.legacyBatchId}/uploads/${await digest(artifact.objectKey)}.json`, '{}')
      await assert.rejects(f.call('promote'), /canonical_artifact_conflict|staged_artifact_invalid|upload_receipt_invalid/)
      assert.equal((await f.storage.get<Record<string, unknown>>(`legacy-reconciliation:${f.sha}`))?.promotedOffset, 0)
      if (kind === 'conflict') assert.equal(await (await f.bucket.get(artifact.objectKey))!.text(), 'existing-conflicting-private-object')
      assert.deepEqual(await f.storage.get('gate'), f.gate)
    } finally { f.db.sqlite.close() }
  }
})

test('real default guard is mandatory; callers cannot replace it and fresh SQL/output/cache conflicts hold intent', async () => {
  for (const kind of ['guard', 'sql', 'output', 'cache'] as const) {
    const f = await setup()
    try {
      await f.promote()
      if (kind === 'sql') f.db.sqlite.prepare("UPDATE maintenance_model_attempts SET error_code='changed' WHERE attempt_id=?").run(f.p.requestDescriptors[0].attempt_id)
      if (kind === 'output') { const row = f.p.requestDescriptors[0]; await f.bucket.put(row.output_key!, '{}') }
      if (kind === 'cache') await f.storage.put(`request:${f.manifest.requestReservations[0].reservationKey}`, { state: 'unknown', attemptId: 'different', requestSha256: '1'.repeat(64) })
      await assert.rejects(kind === 'guard' ? f.call('adopt', 0, {}, verifyLegacyModelGuardRegistration) : f.call('adopt'), /legacy_|reservation_conflict/)
      assert.deepEqual(await f.storage.get('gate'), f.gate)
      assert.equal((await f.storage.get<Record<string, unknown>>(`legacy-reconciliation:${f.sha}`))?.adoptedOffset, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('missing exact D1 event, extra unknown and late original auxiliary mutation cannot release intent', async () => {
  for (const kind of ['event', 'unknown', 'auxiliary'] as const) {
    const f = await setup()
    try {
      await f.promote(); const adopted = await f.adopt(), final = await f.finalReceipt(adopted.adoptedLedgerSha256!)
      if (kind === 'event') f.db.sqlite.prepare('DELETE FROM maintenance_events WHERE event_id=?').run(final.eventId)
      if (kind === 'unknown') {
        const row = { ...f.p.requestDescriptors[165], attempt_id: 'extra-unknown', reservation_key: '0'.repeat(64) }, columns = Object.keys(row)
        f.db.sqlite.prepare(`INSERT INTO maintenance_model_attempts(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row))
      }
      if (kind === 'auxiliary') await f.storage.put(f.auxiliary[0].key, { ...f.auxiliary[0].value, rowsStarted: true })
      await assert.rejects(async () => { let result = await f.call('finalize', 0, { receiptSha256: final.receiptSha }); while (result.nextOffset !== null) result = await f.call('finalize', result.nextOffset, { receiptSha256: final.receiptSha }) }, /receipt_event_mismatch|extra_or_active_unknown|original_auxiliary_changed|pending_intent_changed/)
      assert.equal((await f.storage.get<Record<string, unknown>>('gate'))?.offlineFence !== undefined, true)
    } finally { f.db.sqlite.close() }
  }
})

test('unknown deployment scope, enabled target, wrong revision and legacy complete alias are rejected', async () => {
  for (const kind of ['scope', 'enabled', 'revision', 'complete'] as const) {
    const f = await setup()
    try {
      if (kind === 'scope') f.env.SCOPE_REGISTRY_SHA256 = '0'.repeat(64)
      if (kind === 'enabled') f.env.MAINTENANCE_ENABLED = 'true'
      if (kind === 'revision') f.db.sqlite.prepare('UPDATE maintenance_control SET revision=9').run()
      if (kind === 'complete') { const old = JSON.parse(await (await f.bucket.get(f.p.migrationReceipt.objectKey))!.text()); old.state = 'complete'; await f.bucket.put(f.p.migrationReceipt.objectKey, canonical(old)) }
      await assert.rejects(f.call('promote'), /control_pin_changed|disabled_target_required|evidence_hash_mismatch/)
      assert.equal(f.storage.values.size, f.entries.length)
    } finally { f.db.sqlite.close() }
  }
})
