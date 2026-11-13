// Pure validators shared by the Worker and the private Node relay. They never
// normalize stored values or interpret a held handoff as a model outcome.
import { canonicalJson } from '../../../scripts/maintenance/contracts'

const HASH = /^[a-f0-9]{64}$/, BATCH = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype)
const keys = (v: Record<string, unknown>, allowed: string[], required = allowed) => Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v, k))
const hash = (v: unknown) => typeof v === 'string' && HASH.test(v)
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const stamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const invalid = (): never => { throw Error('legacy_offline_state_invalid') }
const states = ['completed', 'known_failed', 'unknown', 'send_started']
export type LegacyOfflineFence = Record<string, unknown> & { batchId: string; phase: string; tokenSha256: string; manifestSha256: string | null; rowsStarted?: boolean }
function profile(v: unknown) {
  if (!object(v) || !keys(v, ['version', 'model', 'thinking', 'effort', 'maxTokens', 'profileSha256', 'providerRequestSha256', 'canaryId', 'canaryManifestSha256', 'responseModel'], ['version', 'model', 'thinking', 'effort', 'maxTokens', 'profileSha256', 'providerRequestSha256', 'canaryId', 'canaryManifestSha256'])
    || v.version !== 1 || v.model !== 'MiniMax-M3.1-Flash' || !object(v.thinking) || !keys(v.thinking, ['type']) || v.thinking.type !== 'adaptive' || v.effort !== 'low' || v.maxTokens !== 8192
    || !hash(v.profileSha256) || !hash(v.providerRequestSha256) || !hash(v.canaryManifestSha256) || typeof v.canaryId !== 'string'
    || v.responseModel !== undefined && v.responseModel !== 'MiniMax-M3.1-Flash') return invalid()
}
export function validateMigratedRequest(value: unknown, exact = false): void {
  if (!object(value) || exact && !keys(value, ['state', 'attemptId', 'requestSha256', 'result', 'retryable', 'notBefore', 'attemptCount', 'modelProfile'], ['state', 'attemptId', 'requestSha256'])
    || !states.includes(String(value.state)) || typeof value.attemptId !== 'string' || !value.attemptId || !hash(value.requestSha256)
    || value.retryable !== undefined && typeof value.retryable !== 'boolean' || value.notBefore !== undefined && !integer(value.notBefore)
    || value.attemptCount !== undefined && (!integer(value.attemptCount) || Number(value.attemptCount) < 1)) return invalid()
  if (value.modelProfile !== undefined) profile(value.modelProfile)
  if (value.result !== undefined) {
    const r = value.result
    if (!object(r) || exact && !keys(r, ['attemptId', 'output', 'artifactKey', 'artifactSha256', 'reused', 'modelProfile'], ['attemptId', 'output', 'artifactKey', 'artifactSha256', 'reused'])
      || r.attemptId !== value.attemptId || typeof r.artifactKey !== 'string' || !r.artifactKey || !hash(r.artifactSha256) || typeof r.reused !== 'boolean') return invalid()
    if (r.modelProfile !== undefined) profile(r.modelProfile)
  }
  canonicalJson(value)
}

export function validateLegacyOfflineFence(value: unknown, batchId?: string): asserts value is LegacyOfflineFence {
  const base = ['batchId', 'phase', 'tokenSha256', 'scopeRegistrySha256', 'inputCatalogSha256', 'acquiredAt', 'manifestSha256', 'releaseRequestedAt']
  if (!object(value) || !keys(value, [...base, 'seedSha256', 'legacyGuardSha256', 'sourceManifestSha256', 'handoffAckSha256', 'epoch', 'retiredManifests', 'sourceManifestHistory', 'rowsStarted', 'reopenOperation'], base)
    || typeof value.batchId !== 'string' || !BATCH.test(value.batchId) || batchId !== undefined && value.batchId !== batchId
    || !['active', 'held_for_handoff', 'reopening', 'completed'].includes(String(value.phase)) || !hash(value.tokenSha256) || !hash(value.scopeRegistrySha256) || !hash(value.inputCatalogSha256)
    || !stamp(value.acquiredAt) || value.manifestSha256 !== null && !hash(value.manifestSha256) || value.releaseRequestedAt !== null && !stamp(value.releaseRequestedAt)) return invalid()
  for (const key of ['seedSha256', 'legacyGuardSha256', 'sourceManifestSha256', 'handoffAckSha256']) if (value[key] !== undefined && !hash(value[key])) return invalid()
  if (value.epoch !== undefined && !integer(value.epoch) || value.rowsStarted !== undefined && typeof value.rowsStarted !== 'boolean') return invalid()
  for (const key of ['retiredManifests', 'sourceManifestHistory']) if (value[key] !== undefined) {
    const list = value[key]
    if (!Array.isArray(list) || list.length > 4096 || list.some(v => !hash(v)) || new Set(list).size !== list.length) return invalid()
  }
  if (value.phase !== 'active' && (!hash(value.manifestSha256) || !stamp(value.releaseRequestedAt))) return invalid()
  if (value.phase === 'completed' && !hash(value.handoffAckSha256)) return invalid()
  if (value.reopenOperation !== undefined) {
    const o = value.reopenOperation
    if (value.phase !== 'reopening' || !object(o) || !keys(o, ['operationId', 'expectedManifestSha256', 'sourceManifestSha256', 'startedAt'])
      || typeof o.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(o.operationId) || !hash(o.expectedManifestSha256) || !hash(o.sourceManifestSha256) || !stamp(o.startedAt)) return invalid()
  } else if (value.phase === 'reopening') return invalid()
  canonicalJson(value)
}

export function validateLegacyAuxiliaryEntry(key: string, value: unknown): boolean {
  const match = /^(offline-fence|offline-adoption):([a-zA-Z0-9][a-zA-Z0-9_-]{0,100})$/.exec(key)
  if (!match) { if (key.startsWith('offline-')) return invalid(); return false }
  if (match[1] === 'offline-fence') { validateLegacyOfflineFence(value, match[2]); return true }
  if (!object(value) || Object.keys(value).length > 4096) return invalid()
  for (const [reservationKey, r] of Object.entries(value)) {
    if (!/^request:[a-f0-9]{64}$/.test(reservationKey) || !object(r) || !keys(r, ['reservationKey', 'state', 'attemptId', 'requestSha256', 'retryable', 'notBefore', 'attemptCount'], ['reservationKey', 'state', 'attemptId', 'requestSha256'])
      || !hash(r.reservationKey) || reservationKey !== `request:${r.reservationKey}` || !states.includes(String(r.state)) || typeof r.attemptId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(r.attemptId)
      || !hash(r.requestSha256) || r.retryable !== undefined && typeof r.retryable !== 'boolean' || r.retryable === true && r.state !== 'known_failed'
      || r.notBefore !== undefined && !integer(r.notBefore) || r.attemptCount !== undefined && (!integer(r.attemptCount) || Number(r.attemptCount) < 1)) return invalid()
  }
  canonicalJson(value); return true
}

export function validateLegacyOfflineGate(value: unknown): void {
  if (!object(value)) return invalid()
  const legacy = value.offlineFence !== undefined || value.offlineHandoffOperationRecovery !== undefined
  if (legacy && !keys(value, ['fetches', 'models', 'nextHost', 'successes', 'cooldownUntil', 'modelLimit', 'offlineFence', 'offlineHandoffOperationRecovery'], ['fetches', 'models', 'nextHost', 'successes', 'cooldownUntil'])) return invalid()
  if (value.offlineFence !== undefined) validateLegacyOfflineFence(value.offlineFence)
  for (const field of ['fetches', 'models']) {
    if (!Array.isArray(value[field])) return invalid()
    for (const raw of value[field]) {
      if (!object(raw)) return invalid()
      if (raw.kind === undefined) {
        if (legacy && !keys(raw, ['token', 'expiresAt', 'host', 'lane'], ['token', 'expiresAt']) || typeof raw.token !== 'string' || !raw.token
          || typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt) || raw.expiresAt < 0 || raw.host !== undefined && typeof raw.host !== 'string'
          || raw.lane !== undefined && !['maintenance', 'expansion'].includes(String(raw.lane))) return invalid()
        continue
      }
      if (!keys(raw, ['token', 'expiresAt', 'kind', 'batchId', 'manifestSha256'], ['token', 'expiresAt', 'kind']) || typeof raw.token !== 'string' || !raw.token || raw.expiresAt !== Number.MAX_SAFE_INTEGER) return invalid()
      if (field !== 'fetches' || !['handoff', 'export'].includes(String(raw.kind))) return invalid()
      if (raw.kind === 'handoff') {
        if (typeof raw.batchId !== 'string' || !BATCH.test(raw.batchId) || !hash(raw.manifestSha256) || !object(value.offlineFence)
          || raw.batchId !== value.offlineFence.batchId || raw.manifestSha256 !== value.offlineFence.manifestSha256) return invalid()
      } else if (raw.batchId !== undefined || raw.manifestSha256 !== undefined) return invalid()
    }
  }
  if (value.offlineHandoffOperationRecovery !== undefined) {
    const a = value.offlineHandoffOperationRecovery
    const names = ['format', 'version', 'migrationId', 'sourceAccountId', 'targetAccountId', 'role', 'operationId', 'originalGateJson', 'originalGateSha256', 'originalPermit', 'fenceSha256', 'historySha256', 'ledgerSha256', 'beforeLedgerSha256', 'afterLedgerSha256', 'requestCount', 'auxiliaryEntryCount', 'requestStates', 'operator', 'observedAt', 'recoveredAt', 'intentCompleted', 'sourceUnlocked', 'modelCalls', 'requestValuesChanged', 'auditSha256']
    if (!object(a) || !keys(a, names) || a.format !== 'studyinchina.offline-handoff-operation-recovery' || a.version !== 1 || a.role !== 'source'
      || typeof a.migrationId !== 'string' || typeof a.operationId !== 'string' || typeof a.originalGateJson !== 'string'
      || ['originalGateSha256', 'fenceSha256', 'historySha256', 'ledgerSha256', 'auditSha256'].some(k => !hash(a[k]))
      || a.beforeLedgerSha256 !== a.ledgerSha256 || a.afterLedgerSha256 !== a.ledgerSha256 || !integer(a.requestCount) || !integer(a.auxiliaryEntryCount)
      || !stamp(a.observedAt) || !stamp(a.recoveredAt) || a.intentCompleted !== false || a.sourceUnlocked !== false || a.modelCalls !== false || a.requestValuesChanged !== false
      || !object(a.requestStates) || !keys(a.requestStates, ['send_started', 'completed', 'unknown', 'known_failed']) || Object.values(a.requestStates).some(n => !integer(n))
      || Object.values(a.requestStates).reduce<number>((n, v) => n + Number(v), 0) !== a.requestCount
      || !object(a.operator) || !keys(a.operator, ['operatorId', 'decision', 'reason', 'reviewedAt']) || a.operator.decision !== 'release_quiescent_handoff_operation_preserve_intent' || !stamp(a.operator.reviewedAt)) return invalid()
    let original: unknown
    try { original = JSON.parse(a.originalGateJson) } catch { return invalid() }
    if (!object(original) || original.offlineHandoffOperationRecovery !== undefined || canonicalJson(original) !== a.originalGateJson) return invalid()
    validateLegacyOfflineGate(original)
    if (!Array.isArray(original.fetches) || original.fetches.length !== 1 || canonicalJson(original.fetches[0]) !== canonicalJson(a.originalPermit)
      || canonicalJson({ ...original, fetches: [], offlineHandoffOperationRecovery: a }) !== canonicalJson(value)) return invalid()
  }
}
