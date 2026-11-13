import type { DurableStorage } from './types'
import { canonical, digest, HASH, record } from './util'

export const MAX_TEMPORAL_MILLISECONDS = 8640000000000000
export const RECOVERY_MIN_FREEZE_MS = 120000
const MAX_ENTRIES = 4096, PAGE = 32, MAX_LEDGER_BYTES = 8 * 1024 * 1024, MAX_GATE_BYTES = 64 * 1024
const AUDIT = 'nonTemporalFetchPermitRecovery', STATES = ['send_started', 'completed', 'unknown', 'known_failed'] as const
const DECISION = 'retire_non_temporal_fetch_slots_preserve_requests'
type Json = Record<string, unknown>
type Binding = { migrationId: string; sourceAccountId: string; targetAccountId: string; role: 'source' | 'target' }
type SlotCounts = { fetch: number; model: number }
type Permit = Json & { token: string; expiresAt: number }
type Gate = Json & { fetches: Permit[]; models: Permit[] }
type Lock = Json & { frozenAt: string }
type Ledger = { sha256: string; requestCount: number; storageEntries: number; bytes: number; states: Record<typeof STATES[number], number> }
type Scan = { ledger: Ledger; gate: Gate | undefined; lock: Lock }
type Operator = { operatorId: string; decision: typeof DECISION; reason: string; reviewedAt: string }
type Input = { migrationId: string; operationId: string; expectedGateSha256: string; expectedRequestLedgerSha256: string; expectedNonTemporalSlots: SlotCounts; observedAt: string; operator: Operator }
type Removed = { kind: 'fetch' | 'model'; index: number; permit: Permit }
type Audit = { format: 'studyinchina.non-temporal-fetch-permit-recovery'; version: 1; migrationId: string; sourceAccountId: string; targetAccountId: string;
  operationId: string; originalGateSha256: string; originalGateJson: string; removedSlots: Removed[]; expectedNonTemporalSlots: SlotCounts;
  observedAt: string; operator: Operator; recoveredAt: string; frozenAt: string; beforeRequestLedgerSha256: string; afterRequestLedgerSha256: string;
  requestCount: number; requestStates: Ledger['states']; modelCallsPerformed: false; requestValuesChanged: false; sourceUnlocked: false }
export class NonTemporalPermitRecoveryError extends Error { constructor(readonly code: string) { super(code) } }
const fail = (code: string): never => { throw new NonTemporalPermitRecoveryError(`non_temporal_recovery_${code}`) }
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && !Object.is(v, -0)
const keys = (v: Json, allowed: string[], required = allowed) => Object.keys(v).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(v, key))
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const byteLength = (value: string) => new TextEncoder().encode(value).length
const zero = (): Ledger['states'] => ({ send_started: 0, completed: 0, unknown: 0, known_failed: 0 })
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** Typed JSON fingerprinting covers every value. Reject representations that
 * the existing canonical JSON migration cannot preserve exactly. */
export function typed(value: unknown, depth = 0): unknown {
  if (depth > 64) return fail('value_too_deep')
  if (value === null) return ['null']
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value]
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return ['number', String(value)]
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) return fail('non_json_value')
    return ['array', value.map(item => typed(item, depth + 1))]
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(value).length !== Object.keys(value).length || Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, 'value'))) return fail('non_json_value')
    return ['object', Object.keys(value).sort().map(key => [key, typed((value as Json)[key], depth + 1)])]
  }
  return fail('non_json_value')
}
function reservation(value: unknown) {
  const r = record(value)
  if (!r || !keys(r, ['state', 'attemptId', 'requestSha256', 'result', 'retryable', 'notBefore', 'attemptCount'], ['state', 'attemptId', 'requestSha256'])
    || !STATES.includes(r.state as typeof STATES[number]) || typeof r.attemptId !== 'string' || !r.attemptId || r.attemptId.length > 512 || !HASH.test(String(r.requestSha256))
    || r.retryable !== undefined && typeof r.retryable !== 'boolean' || r.notBefore !== undefined && !finite(r.notBefore)
    || r.attemptCount !== undefined && (!integer(r.attemptCount) || r.attemptCount < 1)) return fail('request_schema_unknown')
  if (r.result !== undefined) {
    const result = record(r.result)
    if (!result || !keys(result, ['attemptId', 'output', 'artifactKey', 'artifactSha256', 'reused']) || result.attemptId !== r.attemptId
      || typeof result.artifactKey !== 'string' || !result.artifactKey || !HASH.test(String(result.artifactSha256)) || typeof result.reused !== 'boolean') return fail('request_schema_unknown')
  }
  typed(value); return r
}
function gate(value: unknown, allowAudit = true): Gate {
  const g = record(value)
  if (!g || !keys(g, ['fetches', 'models', 'nextHost', 'successes', 'cooldownUntil', 'modelLimit', ...(allowAudit ? [AUDIT] : [])], ['fetches', 'models', 'nextHost', 'successes', 'cooldownUntil'])
    || !Array.isArray(g.fetches) || !Array.isArray(g.models) || g.fetches.length > 64 || g.models.length > 64
    || !finite(g.successes) || !finite(g.cooldownUntil) || g.modelLimit !== undefined && (!finite(g.modelLimit) || g.modelLimit < 1)) return fail('gate_schema_unknown')
  const hosts = record(g.nextHost), tokens = new Set<string>()
  if (!hosts || Object.entries(hosts).some(([host, until]) => !/^[a-z0-9.-]{3,253}$/.test(host) || !finite(until))) return fail('gate_schema_unknown')
  for (const permit of [...g.fetches, ...g.models]) {
    const p = record(permit)
    if (!p || !keys(p, ['token', 'expiresAt', 'host', 'lane'], ['token', 'expiresAt']) || typeof p.token !== 'string' || !p.token || p.token.length > 512 || tokens.has(p.token)
      || !finite(p.expiresAt) || p.host !== undefined && (typeof p.host !== 'string' || !/^[a-z0-9.-]{3,253}$/.test(p.host))
      || p.lane !== undefined && !['maintenance', 'expansion'].includes(String(p.lane))) return fail('permit_schema_unknown')
    tokens.add(p.token)
  }
  typed(g)
  if (byteLength(canonical(g)) > MAX_GATE_BYTES) return fail('gate_audit_too_large')
  return g as Gate
}
export function sourceLock(value: unknown, binding: Binding): Lock {
  const l = record(value), allowed = ['version', 'migrationId', 'sourceAccountId', 'targetAccountId', 'role', 'phase', 'frozenAt', 'pages', 'states', 'entryCount', 'requestCount', 'gatePresent']
  if (binding.role !== 'source' || !l || !keys(l, allowed) || l.version !== 1 || l.role !== 'source' || l.phase !== 'frozen'
    || l.migrationId !== binding.migrationId || l.sourceAccountId !== binding.sourceAccountId || l.targetAccountId !== binding.targetAccountId
    || !iso(l.frozenAt) || !Array.isArray(l.pages) || l.pages.length || l.entryCount !== 0 || l.requestCount !== 0 || l.gatePresent !== false || !same(l.states, zero())) return fail('unsealed_source_freeze_required')
  typed(l); return l as Lock
}
async function scan(storage: DurableStorage, binding: Binding, lockKey: string): Promise<Scan> {
  if (!storage.list) return fail('storage_list_unavailable')
  const entries: unknown[] = [], states = zero(); let startAfter: string | undefined, storageEntries = 0, totalBytes = 0
  let actualGate: Gate | undefined, actualLock: Lock | undefined
  for (;;) {
    const page = await storage.list<unknown>({ ...(startAfter === undefined ? {} : { startAfter }), limit: PAGE })
    if (!(page instanceof Map) || page.size > PAGE) return fail('incomplete_or_unordered_scan')
    for (const [key, value] of page) {
      if (typeof key !== 'string' || startAfter !== undefined && key <= startAfter) return fail('incomplete_or_unordered_scan')
      startAfter = key
      if (++storageEntries > MAX_ENTRIES) return fail('ledger_entry_limit')
      if (key === lockKey) { if (actualLock) return fail('incomplete_or_unordered_scan'); actualLock = sourceLock(value, binding) }
      else if (key === 'gate') { if (actualGate) return fail('incomplete_or_unordered_scan'); actualGate = gate(value) }
      else if (/^request:[a-f0-9]{64}$/.test(key)) {
        const r = reservation(value), entry = [key, typed(value)], encoded = canonical(entry)
        totalBytes += byteLength(encoded) + 1
        if (totalBytes > MAX_LEDGER_BYTES) return fail('ledger_byte_limit')
        entries.push(entry); states[r.state as typeof STATES[number]]++
      } else return fail('unknown_storage_key_category')
    }
    if (page.size < PAGE) {
      const tail = await storage.list<unknown>({ ...(startAfter === undefined ? {} : { startAfter }), limit: 1 })
      if (tail.size) return fail('incomplete_or_unordered_scan')
      break
    }
  }
  if (!actualLock || !same(actualLock, await storage.get(lockKey)) || !same(actualGate ?? null, await storage.get('gate') ?? null)) return fail('incomplete_or_changed_scan')
  return { gate: actualGate, lock: actualLock, ledger: { sha256: await digest(canonical({ format: 'studyinchina.complete-request-ledger', version: 1, entries })),
    requestCount: entries.length, storageEntries, bytes: totalBytes, states } }
}
function slots(g: Gate, now: number) {
  const removed: Removed[] = [], nonTemporal: SlotCounts = { fetch: 0, model: 0 }, normalActive: SlotCounts = { fetch: 0, model: 0 }
  for (const [field, kind] of [['fetches', 'fetch'], ['models', 'model']] as const) g[field].forEach((permit, index) => {
    if (permit.expiresAt > MAX_TEMPORAL_MILLISECONDS) { nonTemporal[kind]++; removed.push({ kind, index, permit }) }
    else if (permit.expiresAt > now) normalActive[kind]++
  })
  return { removed, nonTemporal, normalActive }
}
function clock(now: number, active: () => number) {
  if (!finite(now) || !Number.isFinite(new Date(now).getTime()) || !integer(active())) return fail('invalid_observation')
}
function input(value: unknown, binding: Binding, now: number): Input {
  const r = record(value), o = record(r?.operator), c = record(r?.expectedNonTemporalSlots)
  if (!r || !keys(r, ['migrationId', 'operationId', 'expectedGateSha256', 'expectedRequestLedgerSha256', 'expectedNonTemporalSlots', 'observedAt', 'operator'])
    || r.migrationId !== binding.migrationId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(String(r.operationId))
    || !HASH.test(String(r.expectedGateSha256)) || !HASH.test(String(r.expectedRequestLedgerSha256)) || !iso(r.observedAt) || Date.parse(r.observedAt) > now
    || !c || !keys(c, ['fetch', 'model']) || !integer(c.fetch) || c.fetch < 1 || c.model !== 0
    || !o || !keys(o, ['operatorId', 'decision', 'reason', 'reviewedAt']) || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(String(o.operatorId)) || o.decision !== DECISION
    || typeof o.reason !== 'string' || !o.reason.trim() || o.reason.length > 400 || !iso(o.reviewedAt) || Date.parse(o.reviewedAt) < Date.parse(r.observedAt) || Date.parse(o.reviewedAt) > now) return fail('explicit_fresh_operator_decision_required')
  return r as Input
}
function reconstructAudit(value: unknown, binding: Binding): { audit: Audit; expected: Gate } {
  const a = record(value)
  if (!a || !keys(a, ['format', 'version', 'migrationId', 'sourceAccountId', 'targetAccountId', 'operationId', 'originalGateSha256', 'originalGateJson', 'removedSlots', 'expectedNonTemporalSlots', 'observedAt', 'operator', 'recoveredAt', 'frozenAt', 'beforeRequestLedgerSha256', 'afterRequestLedgerSha256', 'requestCount', 'requestStates', 'modelCallsPerformed', 'requestValuesChanged', 'sourceUnlocked'])
    || a.format !== 'studyinchina.non-temporal-fetch-permit-recovery' || a.version !== 1 || a.migrationId !== binding.migrationId || a.sourceAccountId !== binding.sourceAccountId || a.targetAccountId !== binding.targetAccountId
    || typeof a.originalGateJson !== 'string' || !HASH.test(String(a.originalGateSha256)) || !HASH.test(String(a.beforeRequestLedgerSha256)) || a.beforeRequestLedgerSha256 !== a.afterRequestLedgerSha256
    || !iso(a.recoveredAt) || !iso(a.frozenAt) || !integer(a.requestCount) || a.modelCallsPerformed !== false || a.requestValuesChanged !== false || a.sourceUnlocked !== false) return fail('existing_audit_invalid')
  const original = gate(JSON.parse(a.originalGateJson), false), selected = slots(original, Date.parse(a.recoveredAt))
  if (canonical(original) !== a.originalGateJson || !same(selected.removed, a.removedSlots) || !same(selected.nonTemporal, a.expectedNonTemporalSlots) || !selected.removed.length || selected.nonTemporal.model !== 0) return fail('existing_audit_invalid')
  return { audit: a as Audit, expected: { ...original, fetches: original.fetches.filter(p => p.expiresAt <= MAX_TEMPORAL_MILLISECONDS), [AUDIT]: a } }
}
function receipt(gateSha: string, audit: Audit, ledger: Ledger, reused: boolean) {
  return { ok: true, operationId: audit.operationId, migrationId: audit.migrationId, reused, originalGateSha256: audit.originalGateSha256, gateSha256: gateSha,
    complete: true, requestLedgerSha256: ledger.sha256, requestCount: ledger.requestCount, requestStates: ledger.states, retiredSlots: audit.expectedNonTemporalSlots,
    recoveredAt: audit.recoveredAt, modelCallsPerformed: false, requestValuesChanged: false, sourceUnlocked: false }
}
/** Private operator inspection only. Deliberately does not call gate()/scan():
 * the purpose is to inspect an otherwise rejected gate without admitting it. */
export async function inspectFrozenSourceGate(storage: DurableStorage, binding: Binding, lockKey: string, active: () => number, now: number) {
  clock(now, active)
  return storage.transaction(async txn => {
    if (active() !== 0) return fail('active_operations')
    const lock = sourceLock(await txn.get(lockKey), binding), value = await txn.get('gate')
    if (value === undefined) return fail('gate_required')
    const gateJson = canonical(value), gateByteLength = byteLength(gateJson)
    if (gateByteLength > MAX_GATE_BYTES) return fail('gate_inspection_too_large')
    const gateSha256 = await digest(gateJson)
    if (active() !== 0) return fail('active_operations')
    // Canonical JSON normalizes -0 to 0. Count that representation separately
    // so inspection can explain its strict rejection without changing it.
    const negativeZeros = (v: unknown): number => typeof v === 'number' ? Number(Object.is(v, -0))
      : Array.isArray(v) ? v.reduce((n, item) => n + negativeZeros(item), 0)
        : v && typeof v === 'object' ? Object.values(v).reduce<number>((n, item) => n + negativeZeros(item), 0) : 0
    return { ok: true, format: 'studyinchina.private-source-gate-inspection', version: 1, ...binding,
      state: 'frozen', frozenAt: lock.frozenAt, pageCount: 0, activeOperations: 0,
      canonicalGateJson: gateJson, gateSha256, gateByteLength, negativeZeroValueCount: negativeZeros(value),
      observedAt: new Date(now).toISOString(), cutoverReady: false, modelCalls: false, mutation: false, sourceUnlocked: false }
  })
}
export async function requestLedgerSummary(storage: DurableStorage, binding: Binding, lockKey: string, active: () => number, now: number) {
  clock(now, active)
  return storage.transaction(async txn => {
    const s = await scan(txn, binding, lockKey), selected = s.gate ? slots(s.gate, now) : null
    const freezeAgeMilliseconds = now - Date.parse(s.lock.frozenAt), activeOperations = active()
    if (!integer(activeOperations) || freezeAgeMilliseconds < 0) return fail('invalid_observation')
    return { ok: true, migrationId: binding.migrationId, role: 'source', complete: true, ledgerFormat: 'studyinchina.complete-request-ledger.v1',
      requestLedgerSha256: s.ledger.sha256, requestCount: s.ledger.requestCount, requestStates: s.ledger.states, storageEntries: s.ledger.storageEntries,
      gateSha256: s.gate ? await digest(canonical(s.gate)) : null, activeOperations, frozenAt: s.lock.frozenAt, freezeAgeMilliseconds,
      nonTemporalSlots: selected?.nonTemporal ?? { fetch: 0, model: 0 }, normalActiveSlots: selected?.normalActive ?? { fetch: 0, model: 0 }, recoveryRecorded: Boolean(s.gate?.[AUDIT]),
      eligible: Boolean(s.gate && !s.gate[AUDIT] && selected?.nonTemporal.fetch && !selected.nonTemporal.model && !activeOperations && freezeAgeMilliseconds >= RECOVERY_MIN_FREEZE_MS && !selected.normalActive.fetch && !selected.normalActive.model),
      observedAt: new Date(now).toISOString(), modelCallsPerformed: false, mutationPerformed: false }
  })
}
export async function recoverNonTemporalPermits(storage: DurableStorage, binding: Binding, lockKey: string, value: unknown, active: () => number, now: number) {
  clock(now, active)
  const r = input(value, binding, now)
  return storage.transaction(async txn => {
    if (active() !== 0) return fail('active_operations')
    const before = await scan(txn, binding, lockKey)
    if (now - Date.parse(before.lock.frozenAt) < RECOVERY_MIN_FREEZE_MS) return fail('freeze_too_young')
    if (!before.gate) return fail('gate_required')
    if (before.ledger.sha256 !== r.expectedRequestLedgerSha256) return fail('request_ledger_conflict')
    if (before.gate[AUDIT] !== undefined) {
      const { audit, expected } = reconstructAudit(before.gate[AUDIT], binding)
      if (audit.operationId !== r.operationId || audit.originalGateSha256 !== r.expectedGateSha256 || audit.beforeRequestLedgerSha256 !== r.expectedRequestLedgerSha256
        || !same(audit.operator, r.operator) || audit.observedAt !== r.observedAt || !same(audit.expectedNonTemporalSlots, r.expectedNonTemporalSlots)) return fail('operation_conflict')
      if (await digest(audit.originalGateJson) !== audit.originalGateSha256 || !same(expected, before.gate) || !same(audit.requestStates, before.ledger.states)
        || audit.requestCount !== before.ledger.requestCount || active() !== 0) return fail('existing_audit_changed')
      return receipt(await digest(canonical(before.gate)), audit, before.ledger, true)
    }
    if (now - Date.parse(r.observedAt) > 300000) return fail('fresh_operator_observation_required')
    if (await digest(canonical(before.gate)) !== r.expectedGateSha256) return fail('gate_conflict')
    const selected = slots(before.gate, now)
    if (selected.nonTemporal.model) return fail('model_permit_requires_separate_review')
    if (selected.normalActive.fetch || selected.normalActive.model) return fail('normal_permits_active')
    if (!selected.removed.length || !same(selected.nonTemporal, r.expectedNonTemporalSlots)) return fail('non_temporal_counts_conflict')
    const audit: Audit = { format: 'studyinchina.non-temporal-fetch-permit-recovery', version: 1, migrationId: binding.migrationId, sourceAccountId: binding.sourceAccountId, targetAccountId: binding.targetAccountId,
      operationId: r.operationId, originalGateSha256: r.expectedGateSha256, originalGateJson: canonical(before.gate), removedSlots: selected.removed,
      expectedNonTemporalSlots: selected.nonTemporal, observedAt: r.observedAt, operator: r.operator, recoveredAt: new Date(now).toISOString(), frozenAt: before.lock.frozenAt,
      beforeRequestLedgerSha256: before.ledger.sha256, afterRequestLedgerSha256: before.ledger.sha256, requestCount: before.ledger.requestCount, requestStates: before.ledger.states,
      modelCallsPerformed: false, requestValuesChanged: false, sourceUnlocked: false }
    const after = gate({ ...before.gate, fetches: before.gate.fetches.filter(p => p.expiresAt <= MAX_TEMPORAL_MILLISECONDS), [AUDIT]: audit })
    if (active() !== 0) return fail('active_operations')
    await txn.put('gate', after)
    const verified = await scan(txn, binding, lockKey)
    if (verified.ledger.sha256 !== before.ledger.sha256 || !same(verified.gate, after) || active() !== 0) return fail('atomic_readback_conflict')
    return receipt(await digest(canonical(after)), audit, verified.ledger, false)
  })
}
