import type { DurableStorage } from './types'
import { canonical, digest, HASH, record } from './util'
import { sourceLock, typed } from './non-temporal-permit-recovery'
import { validateLegacyAuxiliaryEntry, validateLegacyOfflineFence, validateLegacyOfflineGate, validateMigratedRequest } from './legacy-offline-state'

type Binding = { migrationId: string; sourceAccountId: string; targetAccountId: string; role: 'source' | 'target' }
type Entry = { key: string; value: unknown }
const MAX_ENTRIES = 4096, PAGE_ENTRIES = 32, PAGE_BYTES = 4 * 1024 * 1024, AUDIT = 'offlineHandoffOperationRecovery'
const DECISION = 'release_quiescent_handoff_operation_preserve_intent'
const STATES = ['send_started', 'completed', 'unknown', 'known_failed'] as const
const bytes = (s: string) => new TextEncoder().encode(s).length
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0
const iso = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s
export class LegacyHandoffRecoveryError extends Error { constructor(readonly code: string) { super(code) } }
const fail = (s: string): never => { throw new LegacyHandoffRecoveryError(`legacy_handoff_${s}`) }
const exactKeys = (o: Record<string, unknown>, names: string[]) => Object.keys(o).length === names.length && names.every(k => Object.hasOwn(o, k))
const pageValue = (binding: Binding, pageIndex: number, entries: Entry[]) => ({ format: 'studyinchina.private-storage-page', version: 1,
  migrationId: binding.migrationId, sourceAccountId: binding.sourceAccountId, targetAccountId: binding.targetAccountId, pageIndex, entries })

async function scan(storage: DurableStorage, binding: Binding, lockKey: string, active: () => number, pageIndex: number, strict: boolean) {
  if (active() !== 0 || !storage.list) return fail('frozen_idle_storage_required')
  const lock = sourceLock(await storage.get(lockKey), binding), fingerprints: Array<[string, string]> = [], ledger: Array<[string, string]> = []
  const auxiliary = new Map<string, unknown>(), states = { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }
  let gate: Record<string, unknown> | undefined, startAfter: string | undefined, count = 0, requests = 0, auxCount = 0, unsupported = 0, page = 0
  let selected: Entry[] = [], current: Entry[] = [], sawLock = false
  for (;;) {
    const rows = await storage.list<unknown>({ ...(startAfter ? { startAfter } : {}), limit: PAGE_ENTRIES })
    if (!(rows instanceof Map) || rows.size > PAGE_ENTRIES) return fail('incomplete_scan')
    for (const [key, value] of rows) {
      if (typeof key !== 'string' || startAfter !== undefined && key <= startAfter || ++count > MAX_ENTRIES) return fail('incomplete_or_oversized_scan')
      startAfter = key
      const fingerprint = await digest(canonical(typed(value)))
      fingerprints.push([key, fingerprint])
      if (key === lockKey) { sawLock = true; if (!equal(lock, value)) return fail('changed_lock') }
      else if (key === 'gate') {
        gate = record(value) ?? undefined
        if (strict) { validateLegacyOfflineGate(value); if (!gate) return fail('gate_invalid') }
      } else {
        ledger.push([key, fingerprint])
        if (/^request:[a-f0-9]{64}$/.test(key)) {
          const r = record(value)
          if (strict && (!r || !STATES.includes(r.state as typeof STATES[number]) || typeof r.attemptId !== 'string' || !r.attemptId || !HASH.test(String(r.requestSha256)))) return fail('request_schema_unknown')
          if (strict) validateMigratedRequest(value, true)
          requests++; if (r && STATES.includes(r.state as typeof STATES[number])) states[r.state as typeof STATES[number]]++
        } else {
          let recognized = false
          try { recognized = validateLegacyAuxiliaryEntry(key, value) } catch (error) { if (strict) throw error }
          if (strict && !recognized) return fail('unknown_storage_key')
          auxiliary.set(key, value); if (recognized) auxCount++; else unsupported++
        }
      }
      const entry = { key, value }, oneSize = bytes(canonical(pageValue(binding, page, [entry])))
      if (oneSize > PAGE_BYTES) return fail('inspection_entry_too_large')
      const candidateSize = bytes(canonical(pageValue(binding, page, [...current, entry])))
      if (current.length === PAGE_ENTRIES || candidateSize > PAGE_BYTES) {
        if (page === pageIndex) selected = current
        page++; current = []
      }
      if (bytes(canonical(pageValue(binding, page, [entry]))) > PAGE_BYTES) return fail('inspection_entry_too_large')
      current.push(entry)
    }
    if (rows.size < PAGE_ENTRIES) {
      const tail = await storage.list({ ...(startAfter ? { startAfter } : {}), limit: 1 })
      if (tail.size) return fail('incomplete_scan')
      break
    }
  }
  if (!sawLock || !equal(lock, await storage.get(lockKey)) || active() !== 0) return fail('changed_or_active_storage')
  if (page === pageIndex) selected = current
  const pages = count ? page + 1 : 0
  if (pageIndex >= pages) return fail('inspection_page_out_of_range')
  const storageSha256 = await digest(canonical({ format: 'studyinchina.complete-typed-storage.v1', entries: fingerprints }))
  const ledgerSha256 = await digest(canonical({ format: 'studyinchina.complete-request-auxiliary-ledger.v1', entries: ledger }))
  if (active() !== 0) return fail('changed_or_active_storage')
  return { lock, gate, auxiliary, storageSha256, ledgerSha256, requestCount: requests, auxiliaryEntryCount: auxCount,
    entryCount: count, states, unsupportedEntryCount: unsupported, pageCount: pages, selected }
}

export async function inspectFrozenStorage(storage: DurableStorage, binding: Binding, lockKey: string, body: Record<string, unknown>, active: () => number, now: number) {
  if (!integer(body.pageIndex) || body.pageIndex >= MAX_ENTRIES || body.pageIndex > 0 && !HASH.test(String(body.expectedStorageSha256))
    || body.expectedStorageSha256 !== undefined && !HASH.test(String(body.expectedStorageSha256))) return fail('inspection_request_invalid')
  return storage.transaction(async txn => {
    const s = await scan(txn, binding, lockKey, active, Number(body.pageIndex), false)
    if (body.expectedStorageSha256 !== undefined && body.expectedStorageSha256 !== s.storageSha256) return fail('storage_hash_conflict')
    const pageBytes = canonical(pageValue(binding, Number(body.pageIndex), s.selected))
    return { ok: true, format: 'studyinchina.private-storage-inspection', version: 1, ...binding,
      state: 'frozen', frozenAt: s.lock.frozenAt, activeOperations: 0, exportStarted: false, complete: true,
      storageSha256: s.storageSha256, ledgerSha256: s.ledgerSha256, ledgerFormat: 'studyinchina.complete-request-auxiliary-ledger.v1',
      entryCount: s.entryCount, requestCount: s.requestCount, auxiliaryEntryCount: s.auxiliaryEntryCount, unsupportedEntryCount: s.unsupportedEntryCount, states: s.states,
      pageIndex: body.pageIndex, pageBytes, pageSha256: await digest(pageBytes), pageByteLength: bytes(pageBytes),
      nextPageIndex: Number(body.pageIndex) + 1 < s.pageCount ? Number(body.pageIndex) + 1 : null, pageCount: s.pageCount,
      observedAt: new Date(now).toISOString(), cutoverReady: false, modelCalls: false, mutation: false }
  })
}

export async function recoverHandoffOperation(storage: DurableStorage, binding: Binding, lockKey: string, body: Record<string, unknown>, active: () => number, now: number) {
  const operator = record(body.operator)
  if (!exactKeys(body, ['migrationId', 'operationId', 'expectedGateSha256', 'expectedLedgerSha256', 'expectedFenceSha256', 'expectedHistorySha256', 'expectedTokenSha256', 'batchId', 'manifestSha256', 'observedAt', 'operator'])
    || body.migrationId !== binding.migrationId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(String(body.operationId))
    || ['expectedGateSha256', 'expectedLedgerSha256', 'expectedFenceSha256', 'expectedHistorySha256', 'expectedTokenSha256', 'manifestSha256'].some(k => !HASH.test(String(body[k])))
    || !iso(body.observedAt) || Date.parse(body.observedAt) > now || !operator || !exactKeys(operator, ['operatorId', 'decision', 'reason', 'reviewedAt'])
    || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(String(operator.operatorId)) || operator.decision !== DECISION || typeof operator.reason !== 'string' || !operator.reason.trim() || operator.reason.length > 400
    || !iso(operator.reviewedAt) || Date.parse(operator.reviewedAt) < Date.parse(body.observedAt) || Date.parse(operator.reviewedAt) > now) return fail('explicit_operator_decision_required')
  return storage.transaction(async txn => {
    const s = await scan(txn, binding, lockKey, active, 0, true), gate = s.gate
    if (now - Date.parse(s.lock.frozenAt) < 120000 || !gate || s.ledgerSha256 !== body.expectedLedgerSha256) return fail('freeze_or_ledger_conflict')
    validateLegacyOfflineFence(gate.offlineFence, String(body.batchId))
    const fence = gate.offlineFence, history = s.auxiliary.get(`offline-fence:${body.batchId}`)
    if (fence.phase !== 'held_for_handoff' || fence.rowsStarted !== false || fence.reopenOperation !== undefined || fence.manifestSha256 !== body.manifestSha256
      || Date.parse(String(fence.acquiredAt)) > Date.parse(String(fence.releaseRequestedAt)) || Date.parse(String(fence.releaseRequestedAt)) > Date.parse(s.lock.frozenAt)
      || Array.isArray(fence.retiredManifests) && fence.retiredManifests.includes(fence.manifestSha256)
      || fence.tokenSha256 !== body.expectedTokenSha256 || !equal(fence, history) || await digest(canonical(fence)) !== body.expectedFenceSha256 || await digest(canonical(history)) !== body.expectedHistorySha256) return fail('exact_held_history_required')
    const oldAudit = record(gate[AUDIT])
    if (oldAudit) {
      const original = record(JSON.parse(String(oldAudit.originalGateJson)))
      if (!original || oldAudit.operationId !== body.operationId || oldAudit.originalGateSha256 !== body.expectedGateSha256 || oldAudit.ledgerSha256 !== s.ledgerSha256
        || !equal(oldAudit.operator, operator) || oldAudit.observedAt !== body.observedAt || await digest(canonical(original)) !== body.expectedGateSha256
        || await digest(canonical(Object.fromEntries(Object.entries(oldAudit).filter(([key]) => key !== 'auditSha256')))) !== oldAudit.auditSha256
        || oldAudit.requestCount !== s.requestCount || oldAudit.auxiliaryEntryCount !== s.auxiliaryEntryCount || !equal(oldAudit.requestStates, s.states)
        || !equal({ ...original, fetches: [], [AUDIT]: oldAudit }, gate)) return fail('recovery_audit_conflict')
      return { ok: true, reused: true, operationId: body.operationId, gateSha256: await digest(canonical(gate)), ledgerSha256: s.ledgerSha256,
        intentCompleted: false, sourceUnlocked: false, modelCalls: false, requestValuesChanged: false }
    }
    if (gate[AUDIT] !== undefined || now - Date.parse(String(body.observedAt)) > 300000 || await digest(canonical(gate)) !== body.expectedGateSha256) return fail('fresh_gate_conflict')
    if (!Array.isArray(gate.fetches) || gate.fetches.length !== 1 || !Array.isArray(gate.models) || gate.models.length) return fail('exclusive_handoff_permit_required')
    const permit = record(gate.fetches[0])
    if (!permit || permit.kind !== 'handoff' || permit.expiresAt !== Number.MAX_SAFE_INTEGER || permit.batchId !== body.batchId || permit.manifestSha256 !== body.manifestSha256) return fail('exclusive_handoff_permit_required')
    const auditContent = { format: 'studyinchina.offline-handoff-operation-recovery', version: 1, ...binding, operationId: body.operationId,
      originalGateJson: canonical(gate), originalGateSha256: body.expectedGateSha256, originalPermit: permit, fenceSha256: body.expectedFenceSha256,
      historySha256: body.expectedHistorySha256, ledgerSha256: s.ledgerSha256, beforeLedgerSha256: s.ledgerSha256, afterLedgerSha256: s.ledgerSha256,
      requestCount: s.requestCount, auxiliaryEntryCount: s.auxiliaryEntryCount, requestStates: s.states, operator, observedAt: body.observedAt,
      recoveredAt: new Date(now).toISOString(), intentCompleted: false, sourceUnlocked: false, modelCalls: false, requestValuesChanged: false }
    const audit = { ...auditContent, auditSha256: await digest(canonical(auditContent)) }
    const updated = { ...gate, fetches: [], [AUDIT]: audit }
    if (bytes(canonical(updated)) > 64 * 1024 || active() !== 0) return fail('active_or_oversized_audit')
    await txn.put('gate', updated)
    const after = await scan(txn, binding, lockKey, active, 0, true)
    if (after.ledgerSha256 !== s.ledgerSha256 || !equal(after.gate, updated)) return fail('atomic_readback_conflict')
    return { ok: true, reused: false, operationId: body.operationId, gateSha256: await digest(canonical(updated)), ledgerSha256: s.ledgerSha256,
      intentCompleted: false, sourceUnlocked: false, modelCalls: false, requestValuesChanged: false }
  })
}
