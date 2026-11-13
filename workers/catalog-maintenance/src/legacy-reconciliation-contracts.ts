import { z } from 'zod'
import { canonicalJson, sha256Schema as hash, timestampSchema as stamp } from '../../../scripts/maintenance/contracts'
import { rowSchemas, type OfflineHandoff } from './legacy-manifest-contract'

const PREFIX = 'maintenance/legacy-reconciliation/'
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/), account = z.string().regex(/^[a-f0-9]{32}$/)
const uuid = z.string().uuid(), integer = z.number().int().nonnegative().safe()
export const legacyReconciliationEvidenceRefSchema = z.object({ objectKey: z.string().min(1).max(1024)
  .regex(/^maintenance\/[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)+$/).refine(s => !s.includes('..')),
  sha256: hash, byteLength: integer.min(1).max(8 * 1024 * 1024) }).strict()
export const legacyRequestStatesSchema = z.object({ completed: integer, unknown: integer, known_failed: integer, send_started: integer }).strict()
export const legacyReconciliationPackageSchema = z.object({
  format: z.literal('studyinchina.legacy-offline-reconciliation-package'), version: z.literal(1), operationId: id, migrationId: id,
  sourceAccountId: account, targetAccountId: account, pipelineDatabaseId: uuid,
  legacyBatchId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/), legacyManifestSha256: hash,
  artifactDescriptorsSha256: hash, historyChainSha256: hash, historyProof: legacyReconciliationEvidenceRefSchema, jobDriftReview: legacyReconciliationEvidenceRefSchema,
  inputCatalogSha256: hash, nativeHeadReceipt: legacyReconciliationEvidenceRefSchema,
  scopeRegistrySha256: hash, seedSha256: hash, legacyGuardSha256: hash, controlRevision: integer,
  migrationManifestSha256: hash, migrationReceipt: legacyReconciliationEvidenceRefSchema, d1Receipt: legacyReconciliationEvidenceRefSchema, r2Receipt: legacyReconciliationEvidenceRefSchema,
  requestDescriptors: z.array(rowSchemas.maintenance_model_attempts).length(171), requestReservationsSha256: hash,
  unknownGuardPolicySha256: hash, unknownGuardSetSha256: hash, registrationIntentSha256: hash,
  classificationSha256: hash, importPlanSha256: hash,
  originalGateSha256: hash, originalFenceSha256: hash, originalAuxiliarySha256: hash, originalAuxiliaryEntryCount: integer.min(1).max(4096),
  review: z.object({ operatorId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/), decision: z.literal('reconcile_preserve_unknown_reuse_completed'), reviewedAt: stamp }).strict(),
}).strict().superRefine((p, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (p.sourceAccountId === p.targetAccountId) fail('Distinct accounts required')
  if (new Set(p.requestDescriptors.map(r => r.attempt_id)).size !== 171 || new Set(p.requestDescriptors.map(r => r.reservation_key)).size !== 171) fail('Every original request must be unique')
  for (const [state, expected] of [['completed', 165], ['unknown', 3], ['known_failed', 3]] as const) if (p.requestDescriptors.filter(r => r.status === state).length !== expected) fail('Exact original states required')
})
export type LegacyReconciliationPackage = z.infer<typeof legacyReconciliationPackageSchema>
export type LegacyReconciliationEvidenceRef = z.infer<typeof legacyReconciliationEvidenceRefSchema>

export const legacyReconciliationReceiptSchema = z.object({
  format: z.literal('studyinchina.legacy-offline-reconciliation-receipt'), version: z.literal(1), operationId: id, reconciliationSha256: hash,
  migrationId: id, sourceAccountId: account, targetAccountId: account, pipelineDatabaseId: uuid,
  legacyBatchId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/), legacyManifestSha256: hash,
  inputCatalogSha256: hash, scopeRegistrySha256: hash, seedSha256: hash, legacyGuardSha256: hash, controlRevision: integer,
  migrationManifestSha256: hash, artifactDescriptorsSha256: hash, historyChainSha256: hash, classificationSha256: hash, importPlanSha256: hash,
  requestDescriptorsSha256: hash, adoptedLedgerSha256: hash, requestCount: z.literal(171), requestStates: legacyRequestStatesSchema,
  unknownGuardPolicySha256: hash, unknownGuardSetSha256: hash, unknownGuardRegistrationSha256: hash,
  createdAt: stamp, modelCallsPerformed: z.literal(false), oldManifestAcknowledged: z.literal(false),
}).strict().superRefine((r, ctx) => {
  if (r.requestStates.completed !== 165 || r.requestStates.unknown !== 3 || r.requestStates.known_failed !== 3 || r.requestStates.send_started !== 0 || r.sourceAccountId === r.targetAccountId)
    ctx.addIssue({ code: 'custom', message: 'Exact preserved request outcomes required' })
})
export type LegacyReconciliationReceipt = z.infer<typeof legacyReconciliationReceiptSchema>

function validHash(value: string) { return hash.parse(value) }
export const legacyReconciliationPackageKey = (sha256: string) => `${PREFIX}packages/${validHash(sha256)}.json`
export const legacyReconciliationReceiptKey = (sha256: string) => `${PREFIX}receipts/${validHash(sha256)}.json`
export const legacyReconciliationEvidenceKey = (sha256: string) => `${PREFIX}evidence/${validHash(sha256)}.json`
export const legacyReconciliationEventId = (operationId: string) => `legacy-offline-reconciliation:${id.parse(operationId)}`
export const LEGACY_RECONCILIATION_EVENT_KIND = 'legacy_offline_reconciliation'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export const canonicalLegacyRequestDescriptors = (rows: LegacyReconciliationPackage['requestDescriptors']) => canonicalJson([...rows].sort((a, b) => compare(a.attempt_id, b.attempt_id)))
export const canonicalLegacyArtifactDescriptors = (artifacts: OfflineHandoff['artifacts']) => canonicalJson([...artifacts].sort((a, b) => compare(a.objectKey, b.objectKey)))
export const canonicalLegacyReservations = (reservations: OfflineHandoff['requestReservations']) => canonicalJson([...reservations].sort((a, b) => compare(a.reservationKey, b.reservationKey)))
