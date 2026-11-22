import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyCatalogSnapshotFiles, readCatalogSnapshotBaseline } from './apply-catalog-snapshot'
import { fieldVerificationLedgerSchema } from '../../src/lib/data/field-verification'
import { identityAcceptanceLedgerSchema } from '../../src/lib/data/identity-acceptance'
import { canonicalJson, maintenanceCandidateExportSchema } from '../maintenance/contracts'
import { importIdentityCandidates, localArtifactReader, type IdentityBindings } from '../maintenance/import-identities'
import type { ReviewedProgramAliasRef } from '../maintenance/reviewed-program-alias'
import { importFieldCandidates } from '../maintenance/import-fields'
import { importScholarshipIdentities } from '../maintenance/import-scholarships'
import { importAdmissionCycleCandidates } from '../maintenance/import-cycles'
import { catalogSha256 } from '../maintenance/build-scope'
import { maintenanceClientFromEnvironment } from './catalog-maintenance-client'
import { readMaintenanceScope } from '../maintenance/scope-registry'
import { buildProgramCoverage } from '../maintenance/program-coverage'
import { getTodayDate } from '../../src/lib/data/freshness'
import { buildMaintenanceTargets } from './build-maintenance-bootstrap'
import { preparePublisherBaselineBridge, verifyPublisherBaselineBridgeReceipt, type PublisherBaselineBridgeReference } from '../maintenance/publisher-baseline-bridge'

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
function optional(path: string, fallback: unknown): unknown { return existsSync(path) ? read(path) : fallback }
export type CanonicalMaintenanceReceipt = {
  format: 'studyinchina.canonical-maintenance-receipt'; formatVersion: 1; batchId: string; batchSha256: string; scopeRegistrySha256: string;
  inputCatalogSha256: string; outputCatalogSha256: string; acceptedAt: string; acceptedProposalIds: string[];
  held: Array<{ proposalId: string; reason: string }>; identityReceiptSha256: string; scholarshipReceiptSha256: string; fieldReceiptSha256: string;
  cycleReceiptSha256?: string; cycleFieldReceiptSha256?: string;
  unchangedProposalIds?: string[];
  applicationBaselineCatalogSha256?: string;
  baselineBridge?: PublisherBaselineBridgeReference;
  sha256: string
}

export async function prepareMaintenanceCatalog(options: { root: string; downloadDirectory: string; outputDirectory: string; acceptedAt: string; apply?: boolean; reviewedProgramAliases?: ReviewedProgramAliasRef[];
  baselineBridge?: { baseCommit: string; liveCommit: string } }) {
  const root = resolve(options.root), download = resolve(options.downloadDirectory), output = resolve(options.outputDirectory)
  const dataDirectory = join(root, 'content', 'data')
  // Reject lexical and symlink escapes before producing any candidate file, even in dry-run mode.
  const dataReal = realpathSync(dataDirectory)
  let ancestor = output
  while (!existsSync(ancestor)) { const parent = resolve(ancestor, '..'); if (parent === ancestor) throw new Error('maintenance_output_ancestor_missing'); ancestor = parent }
  const outputReal = resolve(realpathSync(ancestor), relative(ancestor, output)), insideData = relative(dataReal, outputReal)
  if (insideData !== '..' && !insideData.startsWith(`..${sep}`) && !isAbsolute(insideData)) throw new Error('maintenance_output_inside_canonical_data')
  const baseline = readCatalogSnapshotBaseline(dataDirectory)
  const batch = maintenanceCandidateExportSchema.parse(read(join(download, 'export.json')))
  const scope = readMaintenanceScope(root, batch.scopeRegistrySha256)
  if (!/^[a-zA-Z0-9_-]{1,140}$/u.test(batch.batchId)) throw new Error('maintenance_batch_id_invalid')
  const receiptRelative = `quality/maintenance/batches/${batch.batchId}/canonical-receipt.json`
  const priorPath = resolve(root, receiptRelative)
  if (existsSync(priorPath)) {
    const previous = read(priorPath) as CanonicalMaintenanceReceipt, { sha256, ...content } = previous
    if (digest(content) !== sha256 || previous.batchSha256 !== batch.sha256 || await catalogSha256(baseline.bundle) !== previous.outputCatalogSha256) throw new Error('maintenance_consumed_batch_conflict')
    verifyPublisherBaselineBridgeReceipt(root, previous)
    return { receipt: previous, receiptPath: priorPath, changed: false, replayed: true }
  }
  let validationBatch = batch
  let bridge: Awaited<ReturnType<typeof preparePublisherBaselineBridge>> | undefined
  let bridgeReference: PublisherBaselineBridgeReference | undefined
  const bridgeFiles: Record<string, Uint8Array> = {}
  const liveBaseline = await catalogSha256(baseline.bundle)
  if (liveBaseline !== batch.inputCatalogSha256 && options.baselineBridge) {
    bridge = await preparePublisherBaselineBridge({ root, originalBatch: batch, ...options.baselineBridge })
    validationBatch = bridge.validationBatch
    bridgeFiles['source-export.json'] = readFileSync(join(download, 'export.json'))
    bridgeFiles['validation-export.json'] = Buffer.from(JSON.stringify(validationBatch, null, 2) + '\n')
    bridgeFiles['baseline-bridge.json'] = Buffer.from(JSON.stringify(bridge.proof, null, 2) + '\n')
    bridgeReference = { version: 1, baseCommit: options.baselineBridge.baseCommit, liveCommit: options.baselineBridge.liveCommit,
      proofSha256: bridge.proof.sha256, validationBatchSha256: validationBatch.sha256,
      sourceExportFileSha256: createHash('sha256').update(bridgeFiles['source-export.json']).digest('hex') }
    mkdirSync(output, { recursive: true })
    if (realpathSync(output) !== outputReal) throw new Error('maintenance_output_changed_during_preparation')
    for (const [name, bytes] of Object.entries(bridgeFiles)) writeFileSync(join(output, name), bytes, { flag: 'wx' })
    if (!bridge.proof.canApply) {
      writeFileSync(join(output, 'baseline-bridge-blocked.json'), JSON.stringify({ batchId: batch.batchId, accepted: [], held: bridge.proof.held,
        reason: 'no_eligible_proposals_no_acknowledgement' }, null, 2) + '\n', { flag: 'wx' })
      throw new Error('maintenance_baseline_bridge_no_eligible_proposals')
    }
  }
  const acceptances = identityAcceptanceLedgerSchema.parse(optional(join(dataDirectory, 'identity-acceptances.json'), { schemaVersion: 1, entries: [] }))
  const bindings = optional(join(dataDirectory, 'identity-bindings.json'), { schemaVersion: 1, entries: [] }) as IdentityBindings
  const fieldLedger = fieldVerificationLedgerSchema.parse(optional(join(dataDirectory, 'field-verifications.json'), { schemaVersion: 1, entries: [] }))
  const readArtifact = localArtifactReader(join(download, 'artifacts'))
  const identities = await importIdentityCandidates({ bundle: baseline.bundle, scope, batch: validationBatch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'identity-receipt'), acceptances, bindings, readArtifact,
    reviewedProgramAliases: options.reviewedProgramAliases })
  const scholarships = await importScholarshipIdentities({ bundle: identities.bundle, inputBundle: baseline.bundle, scope, batch: validationBatch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'scholarship-receipt'), acceptances: identities.acceptances, bindings: identities.bindings, readArtifact })
  const cycles = await importAdmissionCycleCandidates({ bundle: scholarships.bundle, inputBundle: baseline.bundle, scope, batch: validationBatch, acceptedAt: options.acceptedAt,
    cycleReceiptPath: receiptRelative.replace('canonical-receipt', 'cycle-receipt'), fieldReceiptPath: receiptRelative.replace('canonical-receipt', 'cycle-field-receipt'),
    identities: scholarships.acceptances.entries, entries: fieldLedger.entries, readArtifact })
  const fields = await importFieldCandidates({ bundle: cycles.bundle, inputBundle: baseline.bundle, scope, batch: validationBatch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'field-receipt'), entries: cycles.entries, readArtifact })
  const acceptedIds = new Set([...identities.receipt.accepted, ...scholarships.receipt.accepted, ...cycles.cycleReceipt.accepted, ...fields.receipt.accepted].map(entry => entry.proposalId))
  const unchangedIds = new Set([...(identities.receipt.unchanged ?? []), ...(scholarships.receipt.unchanged ?? [])]
    .map(entry => entry.proposalId).filter(id => !acceptedIds.has(id)))
  const reasons = new Map([...identities.receipt.held, ...scholarships.receipt.held, ...cycles.cycleReceipt.held, ...fields.receipt.held].map(entry => [entry.proposalId, entry.reason]))
  for (const held of bridge?.proof.held ?? []) reasons.set(held.proposalId, held.reason)
  const held = batch.proposals.filter(proposal => !acceptedIds.has(proposal.id)).map(proposal => ({ proposalId: proposal.id,
    reason: unchangedIds.has(proposal.id) ? 'identity_and_official_source_unchanged' : reasons.get(proposal.id) ?? 'unsupported_proposal_type' }))
  if (bridge && acceptedIds.size === 0) {
    writeFileSync(join(output, 'baseline-bridge-blocked.json'), JSON.stringify({ batchId: batch.batchId, accepted: [], held,
      reason: 'no_accepted_changes_no_acknowledgement' }, null, 2) + '\n', { flag: 'wx' })
    throw new Error('maintenance_baseline_bridge_no_accepted_changes')
  }
  const content: Omit<CanonicalMaintenanceReceipt, 'sha256'> = { format: 'studyinchina.canonical-maintenance-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, scopeRegistrySha256: scope.sha256, inputCatalogSha256: batch.inputCatalogSha256,
    outputCatalogSha256: await catalogSha256(fields.bundle), acceptedAt: options.acceptedAt, acceptedProposalIds: [...acceptedIds].sort(), held,
    identityReceiptSha256: identities.receipt.sha256, scholarshipReceiptSha256: scholarships.receipt.sha256, fieldReceiptSha256: fields.receipt.sha256,
    cycleReceiptSha256: cycles.cycleReceipt.sha256, cycleFieldReceiptSha256: cycles.fieldReceipt.sha256,
    unchangedProposalIds: [...unchangedIds].sort(),
    ...(bridgeReference ? { applicationBaselineCatalogSha256: liveBaseline, baselineBridge: bridgeReference } : {}) }
  const receipt: CanonicalMaintenanceReceipt = { ...content, sha256: digest(content) }
  const coverageSnapshot = await buildProgramCoverage(fields.bundle, scope, getTodayDate(new Date(options.acceptedAt)), scholarships.acceptances.entries, fields.entries)
  const candidateFiles: Record<string, unknown> = { 'coverage-snapshot.json': coverageSnapshot, 'candidate-bundle.json': fields.bundle, 'identity-acceptances.json': scholarships.acceptances,
    'identity-bindings.json': scholarships.bindings, 'field-verifications.json': { schemaVersion: 1, entries: fields.entries },
    'canonical-receipt.json': receipt, 'identity-receipt.json': identities.receipt, 'scholarship-receipt.json': scholarships.receipt,
    'cycle-receipt.json': cycles.cycleReceipt, 'cycle-field-receipt.json': cycles.fieldReceipt, 'field-receipt.json': fields.receipt }
  mkdirSync(output, { recursive: true })
  if (realpathSync(output) !== outputReal) throw new Error('maintenance_output_changed_during_preparation')
  for (const [name, value] of Object.entries(candidateFiles)) writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  if (options.apply && acceptedIds.size > 0) {
    const inside = relative(dataDirectory, output)
    if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) throw new Error('maintenance_output_inside_canonical_data')
    // Git publishes one complete commit. An interrupted local staging area is never a public release.
    applyCatalogSnapshotFiles(baseline, fields.bundle)
    for (const name of ['identity-acceptances.json', 'identity-bindings.json', 'field-verifications.json'])
      writeFileSync(join(dataDirectory, name), readFileSync(join(output, name)))
    const receiptDirectory = join(root, 'quality', 'maintenance', 'batches', batch.batchId)
    mkdirSync(receiptDirectory, { recursive: true })
    for (const name of ['canonical-receipt.json', 'identity-receipt.json', 'scholarship-receipt.json', 'cycle-receipt.json', 'cycle-field-receipt.json', 'field-receipt.json'])
      writeFileSync(join(receiptDirectory, name), readFileSync(join(output, name)), { flag: 'wx' })
    for (const [name, bytes] of Object.entries(bridgeFiles)) writeFileSync(join(receiptDirectory, name), bytes, { flag: 'wx' })
  }
  return { receipt, receiptPath: join(output, 'canonical-receipt.json'), changed: acceptedIds.size > 0, replayed: false }
}

export async function acknowledgeCanonicalMaintenance(root: string, receiptPath: string, sourceCommit: string) {
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('maintenance_source_commit_invalid')
  const receipt = read(receiptPath) as CanonicalMaintenanceReceipt, { sha256, ...content } = receipt
  if (digest(content) !== sha256) throw new Error('maintenance_receipt_changed')
  verifyPublisherBaselineBridgeReceipt(root, receipt)
  const current = readCatalogSnapshotBaseline(join(root, 'content', 'data')).bundle
  if (await catalogSha256(current) !== receipt.outputCatalogSha256) throw new Error('maintenance_canonical_ack_hash_changed')
  const client = maintenanceClientFromEnvironment(process.env)
  const result = await client.json('/ack', 'POST', { batchId: receipt.batchId, outcome: receipt.acceptedProposalIds.length ? 'applied' : 'rejected', receiptSha256: receipt.sha256, sourceCommit,
    newInputCatalogSha256: receipt.outputCatalogSha256, acceptedProposalIds: receipt.acceptedProposalIds, heldProposalIds: receipt.held.map(entry => entry.proposalId),
    ...(receipt.unchangedProposalIds?.length ? { unchangedProposalIds: receipt.unchangedProposalIds } : {}) })
  const scope = readMaintenanceScope(root, receipt.scopeRegistrySha256)
  const coverageSnapshot = await buildProgramCoverage(current, scope, getTodayDate(), identityAcceptanceLedgerSchema.parse(optional(join(root,'content/data/identity-acceptances.json'),{schemaVersion:1,entries:[]})).entries, fieldVerificationLedgerSchema.parse(optional(join(root,'content/data/field-verifications.json'),{schemaVersion:1,entries:[]})).entries)
  if (receipt.acceptedProposalIds.length) await client.json('/targets', 'POST', { inputCatalogSha256: receipt.outputCatalogSha256, recordTargets: buildMaintenanceTargets(current, scope), coverageSnapshot })
  else await client.json('/coverage', 'POST', coverageSnapshot)
  return result
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1]
  const bridgeBaseCommit = args.includes('--baseline-base-commit') ? value('--baseline-base-commit') : undefined
  if (args[0] === 'ack' && args.includes('--receipt') && args.includes('--commit')) {
    console.log(JSON.stringify(await acknowledgeCanonicalMaintenance(process.cwd(), resolve(value('--receipt')), value('--commit')))); return
  }
  if (!args.includes('--download') || !args.includes('--output')) throw new Error('Usage: prepare-maintenance-catalog.ts --download <directory> --output <candidate-directory> [--apply] | ack --receipt <file> --commit <sha>')
  const result = await prepareMaintenanceCatalog({ root: process.cwd(), downloadDirectory: value('--download'), outputDirectory: value('--output'), acceptedAt: new Date().toISOString(), apply: args.includes('--apply'),
    ...(bridgeBaseCommit ? { baselineBridge: { baseCommit: bridgeBaseCommit,
      liveCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } } : {}),
    ...(args.includes('--reviewed-program-aliases') ? { reviewedProgramAliases: read(value('--reviewed-program-aliases')) as ReviewedProgramAliasRef[] } : {}) })
  console.log(JSON.stringify({ batchId: result.receipt.batchId, accepted: result.receipt.acceptedProposalIds.length, held: result.receipt.held.length,
    unchanged: result.receipt.unchangedProposalIds?.length ?? 0,
    changed: result.changed, replayed: result.replayed, receiptSha256: result.receipt.sha256 }))
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,
    `changed=${result.changed}\nreplayed=${result.replayed}\naccepted_count=${result.receipt.acceptedProposalIds.length}\nreceipt=${result.receiptPath}\n`, { flag: 'a' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'maintenance_candidate_failed'); process.exitCode = 1 })
