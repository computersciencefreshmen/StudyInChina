import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import manifest from '../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { bundleSchema } from '../../src/lib/data/schema'
import { canonicalIdentityJson, identityAcceptanceLedgerSchema, identityFingerprint } from '../../src/lib/data/identity-acceptance'
import { catalogSha256, loadMaintenanceBundle } from '../maintenance/build-scope'
import { canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, maintenanceScopeSchema, scopeContentSha256 } from '../maintenance/contracts'
import { buildMaintenanceTargets } from './build-maintenance-bootstrap'
import { MaintenanceHttpError, maintenanceHttpFailure, maintenanceClientFromEnvironment, type MaintenanceClient } from './catalog-maintenance-client'
import { readMaintenanceScope } from '../maintenance/scope-registry'

const OPERATION = 'native-git-head-2026-11-10'
const manifestPath = 'content/maintenance/head-reconciliation-2026-11-10.v1.json'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right)
function requireCheck(value: unknown, code: string): asserts value { if (!value) throw new Error(`maintenance_reconcile_${code}`) }
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))
const HASH = z.string().regex(/^[a-f0-9]{64}$/u)
const binaryFlag = z.union([z.literal(0), z.literal(1)])
const controlSchema = z.object({
  input_catalog_sha256: HASH, scope_sha256: HASH, seed_sha256: HASH, legacy_guard_sha256: HASH,
  enabled: binaryFlag, models_enabled: binaryFlag, seed_complete: binaryFlag, targets_complete: binaryFlag,
  canary_json: z.string(), revision: z.number().int().nonnegative(), updated_at: z.string(),
}).passthrough()
const stateSchema = z.object({
  format: z.literal('studyinchina.maintenance-control'), control: controlSchema,
  deployment: z.object({ maintenanceEnabled: z.boolean(), subscriptionConfigured: z.boolean(), guardRequired: z.boolean().optional().default(false), guardReady: z.boolean().optional().default(false), scopeUpgradePending: z.boolean().optional().default(false) }),
  reconciliation: z.object({
    manifestSha256: HASH,
    scopeUpgrade: z.object({ previousScopeSha256: HASH, nextScopeSha256: HASH, verified: z.literal(true) }).nullable().optional(),
    paused: z.object({ originalControl: controlSchema, pausedRevision: z.number().int(), proofSha256: HASH }).nullable(),
    advanced: z.object({ reconciledRevision: z.number().int(), proofSha256: HASH }).nullable(),
    resumed: z.object({ restoredRevision: z.number().int() }).nullable(),
  }),
})
type State = z.infer<typeof stateSchema>
type Control = z.infer<typeof controlSchema>

/** Preserve the native known-length request body: the HTTP Worker streams it
 * to R2 and the Queue independently validates every byte and record schema. */
export async function uploadReconciliationTargets(environment: Record<string, string | undefined>, bytes: Uint8Array<ArrayBuffer>, expectedRevision: number, fetcher: typeof fetch = fetch) {
  // Reuse the established HTTPS workers.dev origin and token validation. The
  // existing JSON client deliberately has no bulk-upload method.
  maintenanceClientFromEnvironment(environment, fetcher)
  requireCheck(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && bytes.byteLength === manifest.targetUpload.byteLength
    && sha(bytes) === manifest.targetUpload.sha256, 'target_upload_pin')
  const url = new URL('/head-reconcile-targets', environment.CATALOG_MAINTENANCE_URL)
  let response: Response
  try {
    response = await fetcher(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60_000), body: bytes,
      headers: { Authorization: `Bearer ${environment.CATALOG_MAINTENANCE_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': String(bytes.byteLength),
        'x-maintenance-reconcile-sha256': manifest.sha256, 'x-maintenance-targets-sha256': manifest.targetUpload.sha256,
        'x-maintenance-expected-revision': String(expectedRevision) } })
  } catch { throw new Error('maintenance_reconcile_target_upload_failed') }
  if (!response.ok) throw await maintenanceHttpFailure(response)
  requireCheck(response.ok && !response.redirected && (!response.url || response.url === url.href), 'target_upload_response')
  requireCheck(response.body && Number(response.headers.get('content-length') ?? 0) <= 16 * 1024, 'target_upload_response_size')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 16 * 1024) { await reader.cancel(); throw new Error('maintenance_reconcile_target_upload_response_size') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const receipt = z.object({ ok: z.literal(true), bodySha256: HASH, byteLength: z.number().int(), expectedRevision: z.number().int(), modelCallsPerformed: z.literal(false) })
  const result = z.discriminatedUnion('pending', [
    receipt.extend({ pending: z.literal(true), validation: z.literal('pending-queue'), uploadKey: z.string().min(1) }),
    receipt.extend({ pending: z.literal(false), targetsComplete: z.literal(true), reused: z.literal(true) }),
  ]).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  requireCheck(result.bodySha256 === manifest.targetUpload.sha256 && result.byteLength === bytes.byteLength && result.expectedRevision === expectedRevision, 'target_upload_receipt')
  return result
}

/** The repair accepts one reviewed history. It never signs an arbitrary new catalogue head. */
export async function verifyReconciliationHistory(root: string, options: { requireCommitted?: boolean } = {}) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  const jsonAt = (commit: string, path: string): unknown => JSON.parse(git('cat-file', 'blob', `${commit}:${path}`).toString('utf8'))
  const at = (commit: string) => {
    const names = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
    return bundleSchema.parse(Object.fromEntries(Object.entries(names).map(([key, name]) => [key, jsonAt(commit, `content/data/${name}.json`)])))
  }
  const { sha256, ...content } = manifest
  requireCheck(manifest.operationId === OPERATION && sha(canonicalJson(content)) === sha256, 'manifest_checksum')
  if (options.requireCommitted) requireCheck(same(jsonAt('HEAD', manifestPath), manifest), 'manifest_uncommitted')
  for (const document of [manifest.bridgeAudit, manifest.preparedExport.rejectionReview]) {
    const proof = await readJson(resolve(root, document.path)) as Record<string, unknown>
    const { sha256: proofSha, ...proofContent } = proof
    requireCheck(proofSha === document.sha256 && sha(canonicalJson(proofContent)) === proofSha, 'reviewed_document_checksum')
    if (options.requireCommitted) requireCheck(same(jsonAt('HEAD', document.path), proof), 'reviewed_document_uncommitted')
  }
  for (const [ancestor, descendant] of [[manifest.oldCommit, manifest.bridgeCommit], [manifest.bridgeCommit, manifest.sourceCommit], [manifest.sourceCommit, 'HEAD']]) {
    try { git('merge-base', '--is-ancestor', ancestor, descendant) } catch { throw new Error('maintenance_reconcile_git_ancestry') }
  }
  const before = at(manifest.oldCommit), bridge = at(manifest.bridgeCommit)
  requireCheck(await catalogSha256(before) === manifest.oldInputCatalogSha256, 'old_catalogue')
  requireCheck(await catalogSha256(bridge) === manifest.bridgeCatalogSha256, 'bridge_catalogue')
  requireCheck(await catalogSha256(at(manifest.sourceCommit)) === manifest.newInputCatalogSha256, 'source_catalogue')
  const current = loadMaintenanceBundle(root)
  requireCheck(await catalogSha256(current) === manifest.newInputCatalogSha256 && await catalogSha256(at('HEAD')) === manifest.newInputCatalogSha256, 'current_catalogue')
  const scope = maintenanceScopeSchema.parse(jsonAt('HEAD', 'content/maintenance/scope-272.v1.json'))
  requireCheck(scope.sha256 === manifest.scopeRegistrySha256 && await scopeContentSha256(scope) === scope.sha256, 'fixed_scope')
  requireCheck(same(scope, jsonAt(manifest.oldCommit, 'content/maintenance/scope-272.v1.json')) && same(scope, jsonAt(manifest.bridgeCommit, 'content/maintenance/scope-272.v1.json')), 'scope_changed')
  const targets = buildMaintenanceTargets(current, scope)
  const targetBytes = new TextEncoder().encode(canonicalJson({ inputCatalogSha256: manifest.newInputCatalogSha256, recordTargets: targets }))
  requireCheck(targets.length === manifest.targetUpload.targetCount && targetBytes.byteLength === manifest.targetUpload.byteLength && sha(targetBytes) === manifest.targetUpload.sha256, 'target_upload_pin')
  for (const key of ['sources', 'cities', 'universities', 'programs', 'admissionCycles', 'scholarships'] as const) {
    const rows = new Map<string, unknown>(bridge[key].map(row => [row.id, row] as const))
    requireCheck(before[key].every(row => same(row, rows.get(row.id))), 'bridge_changed_existing_record')
  }
  requireCheck(bridge.sources.length - before.sources.length === 88 && bridge.universities.length - before.universities.length === 23 && bridge.programs.length - before.programs.length === 23, 'bridge_additions')
  requireCheck(bridge.cities.length === before.cities.length && bridge.admissionCycles.length === before.admissionCycles.length && bridge.scholarships.length === before.scholarships.length, 'bridge_dynamic_data')
  const oldLedger = identityAcceptanceLedgerSchema.parse(jsonAt(manifest.oldCommit, 'content/data/identity-acceptances.json'))
  const ledger = identityAcceptanceLedgerSchema.parse(jsonAt(manifest.bridgeCommit, 'content/data/identity-acceptances.json'))
  const key = (entry: { entityType: string; recordId: string }) => `${entry.entityType}:${entry.recordId}`
  const ledgerMap = new Map(ledger.entries.map(entry => [key(entry), entry]))
  requireCheck(ledger.entries.length - oldLedger.entries.length === 46 && oldLedger.entries.every(entry => same(entry, ledgerMap.get(key(entry)))), 'bridge_ledger')
  let archivedPaths = 0
  const archives = new Map<string, Buffer>()
  const archived = (path: string) => {
    requireCheck(/^quality\/schools\/2026-10-(?:26|27)\/[a-zA-Z0-9/_.-]+$/u.test(path) && !path.split('/').includes('..'), 'bridge_artifact_path')
    let value = archives.get(path)
    if (!value) { value = gunzipSync(git('cat-file', 'blob', `${manifest.bridgeCommit}:${path}`)); archives.set(path, value); archivedPaths++ }
    return value
  }
  for (const proof of manifest.bridgeReceipts) {
    const receipt = jsonAt(manifest.bridgeCommit, proof.path) as { sha256: string; identities?: Array<{ recordId: string; identitySha256: string; sources: Array<{ evidencePath: string; byteLength: number; rawSha256: string }> }>; accepted?: Array<{ recordId: string; identitySha256: string; sources: Array<{ evidencePath: string; byteLength: number; rawSha256: string; textEvidencePath?: string; textByteLength?: number; textSha256?: string }> }>; artifacts?: Array<{ evidencePath: string; byteLength: number; sha256: string }> }
    const { sha256: receiptSha, ...receiptContent } = receipt
    requireCheck(receiptSha === proof.sha256 && sha(canonicalIdentityJson(receiptContent)) === receiptSha, 'bridge_receipt_checksum')
    const entityType = receipt.identities ? 'university' : 'program'
    const accepted = receipt.identities ?? receipt.accepted
    requireCheck(accepted?.length === 23, 'bridge_receipt_count')
    for (const item of accepted) {
      const record = entityType === 'university' ? bridge.universities.find(row => row.id === item.recordId) : bridge.programs.find(row => row.id === item.recordId)
      const entry = ledgerMap.get(`${entityType}:${item.recordId}`)
      requireCheck(record && identityFingerprint(entityType, record) === item.identitySha256 && entry?.identitySha256 === item.identitySha256 && entry.receiptPath === proof.path && entry.receiptSha256 === proof.sha256, 'bridge_identity_binding')
      for (const source of item.sources) { const bytes = archived(source.evidencePath); requireCheck(bytes.length === source.byteLength && sha(bytes) === source.rawSha256, 'bridge_archived_bytes') }
    }
    for (const artifact of receipt.artifacts ?? []) { const bytes = archived(artifact.evidencePath); requireCheck(bytes.length === artifact.byteLength && sha(bytes) === artifact.sha256, 'bridge_artifact_checksum') }
  }
  let head = manifest.bridgeCatalogSha256, acceptedCount = 0
  requireCheck(manifest.nativeReceipts.length === 61, 'native_chain_length')
  for (const edge of manifest.nativeReceipts) {
    const receipt = jsonAt('HEAD', edge.path) as { sha256: string; batchId: string; batchSha256: string; scopeRegistrySha256: string; inputCatalogSha256: string; outputCatalogSha256: string; accepted: Array<{ proposalId: string }> }
    const { sha256: receiptSha, ...receiptContent } = receipt
    requireCheck(receiptSha === edge.sha256 && sha(canonicalJson(receiptContent)) === receiptSha && receipt.batchId === edge.batchId && receipt.batchSha256 === edge.batchSha256 && receipt.scopeRegistrySha256 === manifest.scopeRegistrySha256, 'native_receipt_checksum')
    requireCheck(edge.inputCatalogSha256 === head && receipt.inputCatalogSha256 === head && receipt.outputCatalogSha256 === edge.outputCatalogSha256, 'native_chain_discontinuity')
    const batch = maintenanceCandidateExportSchema.parse(jsonAt('HEAD', `${dirname(edge.path).replaceAll('\\', '/')}/export.json`))
    requireCheck(batch.batchId === receipt.batchId && batch.inputCatalogSha256 === head && batch.scopeRegistrySha256 === manifest.scopeRegistrySha256 && batch.sha256 === receipt.batchSha256 && await exportContentSha256(batch) === batch.sha256, 'native_export_binding')
    const ids = receipt.accepted.map(item => item.proposalId)
    requireCheck(new Set(ids).size === ids.length && ids.every(id => batch.proposals.some(proposal => proposal.id === id)), 'native_proposal_membership')
    acceptedCount += ids.length; head = edge.outputCatalogSha256
  }
  requireCheck(head === manifest.newInputCatalogSha256, 'native_chain_target')
  return { operationId: OPERATION, manifestSha256: manifest.sha256, oldCommit: manifest.oldCommit, bridgeCommit: manifest.bridgeCommit, sourceCommit: manifest.sourceCommit, currentCommit: git('rev-parse', 'HEAD').toString().trim(), nativeReceiptCount: manifest.nativeReceipts.length, acceptedCount, archivedPaths, currentCatalogSha256: head,
    reviewedFilesCommitted: options.requireCommitted === true,
    limitation: 'Verifies the reviewed Git bridge, archived bytes and receipt/export chain integrity; does not claim current application eligibility or a public publication. Verify-only permits uncommitted review files; the live workflow requires committed main.' }
}

function validatedState(value: unknown): State {
  const state = stateSchema.parse(value)
  requireCheck(state.reconciliation.manifestSha256 === manifest.sha256, 'worker_pin')
  if (state.control.scope_sha256 !== manifest.scopeRegistrySha256) {
    const lineage = state.reconciliation.scopeUpgrade
    requireCheck(lineage?.verified && lineage.previousScopeSha256 === manifest.scopeRegistrySha256
      && lineage.nextScopeSha256 === state.control.scope_sha256 && state.deployment.guardReady, 'worker_scope_upgrade_lineage')
    const scope = readMaintenanceScope(process.cwd(), lineage.nextScopeSha256), { sha256, ...content } = scope
    requireCheck(scope.parentScopeSha256 === manifest.scopeRegistrySha256 && sha(canonicalJson(content)) === sha256, 'worker_scope_upgrade_registry')
  }
  return state
}
function assertPaused(state: State): asserts state is State & { reconciliation: State['reconciliation'] & { paused: NonNullable<State['reconciliation']['paused']> } } {
  const paused = state.reconciliation.paused
  requireCheck(paused && state.control.enabled === 0 && state.control.models_enabled === 0, 'not_paused')
  requireCheck(state.control.seed_sha256 === paused.originalControl.seed_sha256 && state.control.legacy_guard_sha256 === paused.originalControl.legacy_guard_sha256 && state.control.canary_json === paused.originalControl.canary_json, 'operator_control_changed')
}
export function requireTrustedReconciliationRunner(environment: Record<string, string | undefined>, commit: string) {
  requireCheck(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_EVENT_NAME === 'workflow_dispatch' && environment.GITHUB_REF === 'refs/heads/main'
    && environment.GITHUB_REPOSITORY === 'computersciencefreshmen/StudyInChina' && environment.GITHUB_ACTOR === 'computersciencefreshmen'
    && environment.GITHUB_TRIGGERING_ACTOR === 'computersciencefreshmen' && environment.GITHUB_SHA === commit && environment.RECONCILIATION_OPERATION === OPERATION
    && ['prepare', 'resume'].includes(environment.RECONCILIATION_ACTION ?? ''), 'trusted_main_owner_required')
}

/** No cleanup path resumes the lane. Every resume needs the persisted operation and an exact CAS. */
type ReconciliationOptions = { root: string; output: string; client: MaintenanceClient; uploadTargets: (bytes: Uint8Array<ArrayBuffer>, expectedRevision: number) => Promise<unknown>; action: 'prepare' | 'resume'; wait?: (milliseconds: number) => Promise<void>; maxPolls?: number; verifyHistory?: typeof verifyReconciliationHistory }
export async function reconcileMaintenanceHead(options: ReconciliationOptions) {
  const { root, output, client } = options
  await mkdir(output, { recursive: true })
  const save = (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n')
  const history = await (options.verifyHistory ?? verifyReconciliationHistory)(root, { requireCommitted: true })
  await save('history-verification.json', history)
  const readState = async () => validatedState(await client.json('/control'))
  const phase = async (phase: 'pause' | 'advance' | 'resume', expectedRevision: number) => validatedState(await client.json('/head-reconcile', 'POST', { phase, expectedRevision, manifestSha256: manifest.sha256 }))
  let state = await readState()
  await save('initial-control.json', state)
  if (state.reconciliation.resumed) {
    requireCheck(state.control.input_catalog_sha256 === manifest.newInputCatalogSha256 && state.control.targets_complete === 1, 'completed_operation_head_changed')
    await save('completed-control.json', state); return { alreadyCompleted: true, prepared: false, state }
  }
  if (options.action === 'resume') {
    assertPaused(state)
    requireCheck(state.deployment.maintenanceEnabled && state.deployment.subscriptionConfigured, 'resume_configuration_unavailable')
    const reconciledRevision = state.reconciliation.advanced?.reconciledRevision
    requireCheck(reconciledRevision === state.reconciliation.paused.pausedRevision + 2 && state.control.input_catalog_sha256 === manifest.newInputCatalogSha256
      && state.control.targets_complete === 1 && state.control.revision === reconciledRevision + 1, 'resume_requires_exact_completed_targets')
    const original: Control = state.reconciliation.paused.originalControl
    state = await phase('resume', state.control.revision)
    requireCheck(state.reconciliation.resumed?.restoredRevision === reconciledRevision + 2 && state.control.revision === reconciledRevision + 2
      && state.control.enabled === original.enabled && state.control.models_enabled === original.models_enabled && state.control.canary_json === original.canary_json
      && state.control.targets_complete === 1 && state.control.input_catalog_sha256 === manifest.newInputCatalogSha256, 'restore_binding')
    await save('completed-control.json', state)
    return { alreadyCompleted: false, prepared: false, state }
  }
  if (!state.reconciliation.paused) state = await phase('pause', state.control.revision)
  await save('paused-control.json', state)
  assertPaused(state)
  const pausedRevision = state.reconciliation.paused.pausedRevision
  if (!state.reconciliation.advanced) {
    requireCheck(state.control.input_catalog_sha256 === manifest.oldInputCatalogSha256 && [pausedRevision, pausedRevision + 1].includes(state.control.revision), 'pause_revision_changed')
    const batch = maintenanceCandidateExportSchema.parse(await client.json(`/exports/${manifest.preparedExport.batchId}`))
    requireCheck(batch.batchId === manifest.preparedExport.batchId && batch.sha256 === manifest.preparedExport.sha256 && await exportContentSha256(batch) === batch.sha256
      && batch.inputCatalogSha256 === manifest.oldInputCatalogSha256 && batch.scopeRegistrySha256 === manifest.scopeRegistrySha256
      && same(batch.proposals.map(proposal => proposal.id).sort(), [...manifest.preparedExport.proposalIds].sort()), 'prepared_export_changed')
    await save('prepared-export.json', batch)
    const review = z.object({ sha256: HASH, batchId: z.string(), exportSha256: HASH, acceptedProposalIds: z.array(z.string()), heldProposalIds: z.array(z.string()), unchangedProposalIds: z.array(z.string()) }).passthrough()
      .parse(await readJson(resolve(root, manifest.preparedExport.rejectionReview.path)))
    const { sha256: reviewSha, ...reviewContent } = review
    requireCheck(reviewSha === manifest.preparedExport.rejectionReview.sha256 && sha(canonicalJson(reviewContent)) === reviewSha
      && review.batchId === batch.batchId && review.exportSha256 === batch.sha256 && !review.acceptedProposalIds.length && !review.unchangedProposalIds.length
      && same([...review.heldProposalIds].sort(), [...manifest.preparedExport.proposalIds].sort()), 'rejection_review_changed')
    await save('rejected-export-review.json', review)
    const acknowledgement = { batchId: batch.batchId, outcome: 'rejected', receiptSha256: review.sha256, sourceCommit: manifest.sourceCommit,
      newInputCatalogSha256: manifest.oldInputCatalogSha256, acceptedProposalIds: [] as string[], heldProposalIds: review.heldProposalIds, unchangedProposalIds: [] as string[] }
    await save('rejected-export-acknowledgement-request.json', acknowledgement)
    await save('rejected-export-acknowledgement.json', await client.json('/ack', 'POST', acknowledgement))
    state = await readState(); assertPaused(state)
    requireCheck(state.control.revision === pausedRevision + 1 && state.control.input_catalog_sha256 === manifest.oldInputCatalogSha256, 'rejection_revision_changed')
    state = await phase('advance', state.control.revision)
    await save('advanced-control.json', state)
  }
  assertPaused(state)
  const reconciledRevision = state.reconciliation.advanced?.reconciledRevision
  requireCheck(reconciledRevision === pausedRevision + 2 && state.control.input_catalog_sha256 === manifest.newInputCatalogSha256, 'advance_binding')
  if (!state.control.targets_complete) {
    requireCheck(state.control.revision === reconciledRevision, 'target_revision_changed')
    const scope = maintenanceScopeSchema.parse(await readJson(resolve(root, 'content/maintenance/scope-272.v1.json')))
    const targets = buildMaintenanceTargets(loadMaintenanceBundle(root), scope)
    const bytes = new TextEncoder().encode(canonicalJson({ inputCatalogSha256: manifest.newInputCatalogSha256, recordTargets: targets }))
    requireCheck(targets.length === manifest.targetUpload.targetCount && bytes.byteLength === manifest.targetUpload.byteLength && sha(bytes) === manifest.targetUpload.sha256, 'target_upload_pin')
    await save('target-refresh.json', { inputCatalogSha256: manifest.newInputCatalogSha256, targetCount: targets.length, byteLength: bytes.byteLength, bodySha256: manifest.targetUpload.sha256 })
    await save('target-refresh-response.json', await options.uploadTargets(bytes, reconciledRevision))
  }
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  for (let polls = 0; ; polls++) {
    state = await readState(); assertPaused(state)
    requireCheck(state.control.input_catalog_sha256 === manifest.newInputCatalogSha256, 'target_head_changed')
    if (state.control.targets_complete) { requireCheck(state.control.revision === reconciledRevision + 1, 'completion_revision_changed'); break }
    requireCheck(state.control.revision === reconciledRevision, 'operator_revision_changed')
    requireCheck(polls < (options.maxPolls ?? 60), 'targets_waiting_keep_paused')
    await wait(10_000)
  }
  await save('targets-completed-control.json', state)
  await save('prepared-waiting-for-explicit-resume.json', { operationId: OPERATION, expectedResumeRevision: state.control.revision,
    inputCatalogSha256: state.control.input_catalog_sha256, instruction: 'Keep controls disabled. Review the deployed Worker environment gate and subscription configuration before a separate owner-dispatched resume action.' })
  return { alreadyCompleted: false, prepared: true, state }
}

export function requireTrustedAutomaticReconciliationRunner(environment: Record<string, string | undefined>, commit: string) {
  requireCheck(environment.GITHUB_ACTIONS === 'true' && ['schedule', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME ?? '')
    && environment.GITHUB_REF === 'refs/heads/main' && environment.GITHUB_REPOSITORY === 'computersciencefreshmen/StudyInChina'
    && environment.GITHUB_ACTOR === 'computersciencefreshmen' && environment.GITHUB_TRIGGERING_ACTOR === 'computersciencefreshmen'
    && environment.GITHUB_SHA === commit && environment.GITHUB_WORKFLOW_REF === 'computersciencefreshmen/StudyInChina/.github/workflows/catalog-maintenance-publish.yml@refs/heads/main', 'trusted_publisher_main_required')
}
function completedOperation(state: State) {
  const { paused, advanced, resumed } = state.reconciliation
  if (!resumed) return false
  requireCheck(paused && advanced && advanced.reconciledRevision === paused.pausedRevision + 2
    && resumed.restoredRevision === advanced.reconciledRevision + 2 && state.control.revision >= resumed.restoredRevision
    && (!state.deployment.guardRequired || state.deployment.guardReady), 'completed_operation_invalid')
  // A completed repair is immutable history. Later legitimate catalogue heads,
  // target refreshes and operator pauses belong to the normal runtime gate.
  return true
}
export async function automaticallyReconcileMaintenanceHead(options: Omit<ReconciliationOptions, 'action'> & { environment: Record<string, string | undefined>; commit: string }) {
  requireTrustedAutomaticReconciliationRunner(options.environment, options.commit)
  await mkdir(options.output, { recursive: true })
  const save = (value: unknown) => writeFile(resolve(options.output, 'automatic-recovery.json'), JSON.stringify(value, null, 2) + '\n')
  const result = async (ready: boolean, reason: string, state?: State, quota?: { retryAt: string | null; httpStatus: number }) => {
    const proof = { operationId: OPERATION, ready, reason, publicPublicationClaimed: false, coverageSuccess: false,
      ...(state ? { revision: state.control.revision, inputCatalogSha256: state.control.input_catalog_sha256,
        enabled: state.control.enabled === 1, modelsEnabled: state.control.models_enabled === 1 } : {}), ...quota }
    await save(proof); return proof
  }
  try {
    const state = validatedState(await options.client.json('/control'))
    if (state.deployment.scopeUpgradePending) return result(false, 'scope_upgrade_pending', state)
    if (completedOperation(state)) return result(true, 'already_reconciled', state)
    if (!state.deployment.guardRequired) return result(false, 'guard_not_armed', state)
    if (!state.deployment.maintenanceEnabled) return result(false, 'deployment_gate_disabled', state)
    requireCheck(!state.deployment.guardReady, 'pending_guard_inconsistent')
    // The same checked main checkout is used for prepare and resume. Verify its
    // full historical chain once; neither phase can alter these local files.
    let verified: ReturnType<typeof verifyReconciliationHistory> | undefined
    const verifyHistory: typeof verifyReconciliationHistory = (root, settings) => verified ??= (options.verifyHistory ?? verifyReconciliationHistory)(root, settings)
    await reconcileMaintenanceHead({ ...options, action: 'prepare', verifyHistory })
    await reconcileMaintenanceHead({ ...options, action: 'resume', verifyHistory })
    const completed = validatedState(await options.client.json('/control'))
    requireCheck(completedOperation(completed), 'automatic_resume_unconfirmed')
    return result(true, 'reconciled', completed)
  } catch (error) {
    // A numeric HTTP status alone is insufficient: only the fixed generic
    // backend response plus an independent daily-quota status permits waiting.
    if (error instanceof MaintenanceHttpError && error.backendUnavailable
      && ([409, 429].includes(error.httpStatus) || error.httpStatus >= 500)) {
      const quotaStatus = z.object({ format: z.literal('studyinchina.cloud-maintenance-status'), backend: z.object({
        state: z.string(), errorKind: z.string().nullable(), retryAt: z.string().datetime({ offset: true }).nullable(),
      }) })
      let status: z.infer<typeof quotaStatus> | undefined
      try { status = quotaStatus.parse(await options.client.json('/status')) } catch { /* A failed confirmation never turns an error into a wait. */ }
      if (status?.backend.state === 'quota_wait' && status.backend.errorKind === 'daily_quota')
        return result(false, 'quota_wait', undefined, { retryAt: status.backend.retryAt, httpStatus: error.httpStatus })
    }
    await save({ operationId: OPERATION, ready: false, reason: 'failed', coverageSuccess: false, publicPublicationClaimed: false,
      httpStatus: error instanceof MaintenanceHttpError ? error.httpStatus : null, automaticCleanupResumeAttempted: false })
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2), outputAt = args.indexOf('--output')
  requireCheck(outputAt >= 0 && args[outputAt + 1], 'output_required')
  const root = process.cwd(), output = resolve(args[outputAt + 1])
  await mkdir(output, { recursive: true })
  if (args.includes('--verify-only')) { const report = await verifyReconciliationHistory(root); await writeFile(resolve(output, 'history-verification.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); return }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (args.includes('--auto')) {
    const result = await automaticallyReconcileMaintenanceHead({ root, output, commit, environment: process.env, client: maintenanceClientFromEnvironment(process.env),
      uploadTargets: (bytes, revision) => uploadReconciliationTargets(process.env, bytes, revision) })
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${result.ready}\nreason=${result.reason}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `Cloud recovery: **${result.reason}**; publisher ready: **${result.ready}**. This is not a coverage or public publication success.\n`)
    console.log(JSON.stringify(result)); return
  }
  requireTrustedReconciliationRunner(process.env, commit)
  try {
    const result = await reconcileMaintenanceHead({ root, output, action: process.env.RECONCILIATION_ACTION as 'prepare' | 'resume', client: maintenanceClientFromEnvironment(process.env),
      uploadTargets: (bytes, revision) => uploadReconciliationTargets(process.env, bytes, revision) })
    console.log(JSON.stringify({ operationId: OPERATION, action: process.env.RECONCILIATION_ACTION, alreadyCompleted: result.alreadyCompleted, prepared: result.prepared,
      revision: result.state.control.revision, inputCatalogSha256: result.state.control.input_catalog_sha256, targetsComplete: result.state.control.targets_complete === 1,
      enabled: result.state.control.enabled === 1, modelsEnabled: result.state.control.models_enabled === 1, publicPublicationClaimed: false }))
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('maintenance_') ? error.message : 'maintenance_reconcile_failed_keep_paused'
    await writeFile(resolve(output, 'waiting.json'), JSON.stringify({ operationId: OPERATION, observedAt: new Date().toISOString(), code, automaticCleanupResumeAttempted: false, instruction: 'Keep the operator pause. Inspect the persisted operation and exact revision before retrying.' }, null, 2) + '\n')
    throw new Error(code)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error && error.message.startsWith('maintenance_') ? error.message : 'maintenance_reconcile_failed_keep_paused'); process.exitCode = 1 })
