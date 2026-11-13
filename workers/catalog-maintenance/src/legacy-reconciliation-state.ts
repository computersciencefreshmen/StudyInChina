import { canonicalJson } from '../../../scripts/maintenance/contracts'

export type LegacyReconciliationFingerprint = [string, string]
export type LegacyReconciliationState = { format: 'studyinchina.legacy-reconciliation-do-state'; version: 1; reconciliationSha256: string; operationId: string;
  historyOffset: number; promotedOffset: number; adoptedOffset: number; verifiedOffset: number; fingerprints: LegacyReconciliationFingerprint[];
  finalized: boolean; receiptSha256: string | null; finalGateSha256: string | null; finalizedAt: string | null }
export type LegacyReconciliationArchive = { format: 'studyinchina.legacy-reconciliation-do-archive'; version: 1; reconciliationSha256: string;
  originalGateJson: string; originalGateSha256: string; auxiliaryEntries: Array<{ key: string; value: unknown }>; baseline: LegacyReconciliationFingerprint[] }
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k))
const invalid = (): never => { throw Error('legacy_reconciliation_state_invalid') }
function fingerprints(v: unknown): v is LegacyReconciliationFingerprint[] {
  return Array.isArray(v) && v.length <= 4096 && v.every(e => Array.isArray(e) && e.length === 2 && /^request:[a-f0-9]{64}$/.test(String(e[0])) && hash(e[1])) && new Set(v.map(e => e[0])).size === v.length
}
export function validateLegacyReconciliationState(value: unknown, sha: string): asserts value is LegacyReconciliationState {
  if (!object(value) || !exact(value, ['format', 'version', 'reconciliationSha256', 'operationId', 'historyOffset', 'promotedOffset', 'adoptedOffset', 'verifiedOffset', 'fingerprints', 'finalized', 'receiptSha256', 'finalGateSha256', 'finalizedAt'])
    || value.format !== 'studyinchina.legacy-reconciliation-do-state' || value.version !== 1 || value.reconciliationSha256 !== sha || !hash(sha)
    || typeof value.operationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(value.operationId)
    || !integer(value.historyOffset) || value.historyOffset > 4096 || !integer(value.promotedOffset) || value.promotedOffset > 10000
    || !integer(value.adoptedOffset) || value.adoptedOffset > 171 || !integer(value.verifiedOffset) || value.verifiedOffset > value.adoptedOffset
    || !fingerprints(value.fingerprints) || value.fingerprints.length !== value.adoptedOffset || typeof value.finalized !== 'boolean'
    || value.receiptSha256 !== null && !hash(value.receiptSha256) || value.finalGateSha256 !== null && !hash(value.finalGateSha256)) return invalid()
  if (value.finalized) {
    if (value.adoptedOffset !== 171 || value.verifiedOffset !== 171 || !hash(value.receiptSha256) || !hash(value.finalGateSha256)
      || typeof value.finalizedAt !== 'string' || !Number.isFinite(Date.parse(value.finalizedAt))) return invalid()
  } else if (value.finalizedAt !== null || value.finalGateSha256 !== null) return invalid()
  canonicalJson(value)
}
export function validateLegacyReconciliationArchive(value: unknown, sha: string): asserts value is LegacyReconciliationArchive {
  if (!object(value) || !exact(value, ['format', 'version', 'reconciliationSha256', 'originalGateJson', 'originalGateSha256', 'auxiliaryEntries', 'baseline'])
    || value.format !== 'studyinchina.legacy-reconciliation-do-archive' || value.version !== 1 || value.reconciliationSha256 !== sha || !hash(sha)
    || typeof value.originalGateJson !== 'string' || !hash(value.originalGateSha256) || !fingerprints(value.baseline) || !Array.isArray(value.auxiliaryEntries) || value.auxiliaryEntries.length > 4096) return invalid()
  let original: unknown
  try { original = JSON.parse(value.originalGateJson) } catch { return invalid() }
  if (!object(original) || canonicalJson(original) !== value.originalGateJson) return invalid()
  for (const e of value.auxiliaryEntries) if (!object(e) || !exact(e, ['key', 'value']) || typeof e.key !== 'string' || !/^offline-(?:fence|adoption):[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(e.key)) return invalid()
  if (new Set(value.auxiliaryEntries.map(e => e.key)).size !== value.auxiliaryEntries.length) return invalid()
  canonicalJson(value)
}
export function validateLegacyReconciliationGate(value: unknown): void {
  if (!object(value) || !exact(value, ['format', 'version', 'reconciliationSha256', 'operationId', 'receiptSha256', 'archiveKey', 'originalGateSha256', 'finalizedAt'])
    || value.format !== 'studyinchina.legacy-offline-reconciliation-gate' || value.version !== 1 || !hash(value.reconciliationSha256) || !hash(value.receiptSha256) || !hash(value.originalGateSha256)
    || value.archiveKey !== `legacy-reconciliation-archive:${value.reconciliationSha256}` || typeof value.operationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(value.operationId)
    || typeof value.finalizedAt !== 'string' || !Number.isFinite(Date.parse(value.finalizedAt))) return invalid()
}
