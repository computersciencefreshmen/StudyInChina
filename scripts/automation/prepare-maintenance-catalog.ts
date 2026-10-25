import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyCatalogSnapshotFiles, readCatalogSnapshotBaseline } from './apply-catalog-snapshot'
import { fieldVerificationLedgerSchema } from '../../src/lib/data/field-verification'
import { identityAcceptanceLedgerSchema } from '../../src/lib/data/identity-acceptance'
import { canonicalJson, maintenanceCandidateExportSchema, maintenanceScopeSchema } from '../maintenance/contracts'
import { importIdentityCandidates, localArtifactReader, type IdentityBindings } from '../maintenance/import-identities'
import { importFieldCandidates } from '../maintenance/import-fields'
import { importScholarshipIdentities } from '../maintenance/import-scholarships'
import { importAdmissionCycleCandidates } from '../maintenance/import-cycles'
import { catalogSha256 } from '../maintenance/build-scope'
import { maintenanceClientFromEnvironment } from './catalog-maintenance-client'
import { buildMaintenanceTargets } from './build-maintenance-bootstrap'

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
function optional(path: string, fallback: unknown): unknown { return existsSync(path) ? read(path) : fallback }
export type CanonicalMaintenanceReceipt = {
  format: 'studyinchina.canonical-maintenance-receipt'; formatVersion: 1; batchId: string; batchSha256: string; scopeRegistrySha256: string;
  inputCatalogSha256: string; outputCatalogSha256: string; acceptedAt: string; acceptedProposalIds: string[];
  held: Array<{ proposalId: string; reason: string }>; identityReceiptSha256: string; scholarshipReceiptSha256: string; fieldReceiptSha256: string;
  cycleReceiptSha256?: string; cycleFieldReceiptSha256?: string;
  unchangedProposalIds?: string[];
  sha256: string
}

export async function prepareMaintenanceCatalog(options: { root: string; downloadDirectory: string; outputDirectory: string; acceptedAt: string; apply?: boolean }) {
  const root = resolve(options.root), download = resolve(options.downloadDirectory), output = resolve(options.outputDirectory)
  const dataDirectory = join(root, 'content', 'data')
  // Reject lexical and symlink escapes before producing any candidate file, even in dry-run mode.
  const dataReal = realpathSync(dataDirectory)
  let ancestor = output
  while (!existsSync(ancestor)) { const parent = resolve(ancestor, '..'); if (parent === ancestor) throw new Error('maintenance_output_ancestor_missing'); ancestor = parent }
  const outputReal = resolve(realpathSync(ancestor), relative(ancestor, output)), insideData = relative(dataReal, outputReal)
  if (insideData !== '..' && !insideData.startsWith(`..${sep}`) && !isAbsolute(insideData)) throw new Error('maintenance_output_inside_canonical_data')
  const baseline = readCatalogSnapshotBaseline(dataDirectory)
  const scope = maintenanceScopeSchema.parse(read(join(root, 'content', 'maintenance', 'scope-272.v1.json')))
  const batch = maintenanceCandidateExportSchema.parse(read(join(download, 'export.json')))
  if (!/^[a-zA-Z0-9_-]{1,140}$/u.test(batch.batchId)) throw new Error('maintenance_batch_id_invalid')
  const receiptRelative = `quality/maintenance/batches/${batch.batchId}/canonical-receipt.json`
  const priorPath = resolve(root, receiptRelative)
  if (existsSync(priorPath)) {
    const previous = read(priorPath) as CanonicalMaintenanceReceipt, { sha256, ...content } = previous
    if (digest(content) !== sha256 || previous.batchSha256 !== batch.sha256 || await catalogSha256(baseline.bundle) !== previous.outputCatalogSha256) throw new Error('maintenance_consumed_batch_conflict')
    return { receipt: previous, receiptPath: priorPath, changed: false, replayed: true }
  }
  const acceptances = identityAcceptanceLedgerSchema.parse(optional(join(dataDirectory, 'identity-acceptances.json'), { schemaVersion: 1, entries: [] }))
  const bindings = optional(join(dataDirectory, 'identity-bindings.json'), { schemaVersion: 1, entries: [] }) as IdentityBindings
  const fieldLedger = fieldVerificationLedgerSchema.parse(optional(join(dataDirectory, 'field-verifications.json'), { schemaVersion: 1, entries: [] }))
  const readArtifact = localArtifactReader(join(download, 'artifacts'))
  const identities = await importIdentityCandidates({ bundle: baseline.bundle, scope, batch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'identity-receipt'), acceptances, bindings, readArtifact })
  const scholarships = await importScholarshipIdentities({ bundle: identities.bundle, inputBundle: baseline.bundle, scope, batch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'scholarship-receipt'), acceptances: identities.acceptances, bindings: identities.bindings, readArtifact })
  const cycles = await importAdmissionCycleCandidates({ bundle: scholarships.bundle, inputBundle: baseline.bundle, scope, batch, acceptedAt: options.acceptedAt,
    cycleReceiptPath: receiptRelative.replace('canonical-receipt', 'cycle-receipt'), fieldReceiptPath: receiptRelative.replace('canonical-receipt', 'cycle-field-receipt'),
    identities: scholarships.acceptances.entries, entries: fieldLedger.entries, readArtifact })
  const fields = await importFieldCandidates({ bundle: cycles.bundle, inputBundle: baseline.bundle, scope, batch, acceptedAt: options.acceptedAt,
    receiptPath: receiptRelative.replace('canonical-receipt', 'field-receipt'), entries: cycles.entries, readArtifact })
  const acceptedIds = new Set([...identities.receipt.accepted, ...scholarships.receipt.accepted, ...cycles.cycleReceipt.accepted, ...fields.receipt.accepted].map(entry => entry.proposalId))
  const unchangedIds = new Set([...(identities.receipt.unchanged ?? []), ...(scholarships.receipt.unchanged ?? [])]
    .map(entry => entry.proposalId).filter(id => !acceptedIds.has(id)))
  const reasons = new Map([...identities.receipt.held, ...scholarships.receipt.held, ...cycles.cycleReceipt.held, ...fields.receipt.held].map(entry => [entry.proposalId, entry.reason]))
  const held = batch.proposals.filter(proposal => !acceptedIds.has(proposal.id)).map(proposal => ({ proposalId: proposal.id,
    reason: unchangedIds.has(proposal.id) ? 'identity_and_official_source_unchanged' : reasons.get(proposal.id) ?? 'unsupported_proposal_type' }))
  const content: Omit<CanonicalMaintenanceReceipt, 'sha256'> = { format: 'studyinchina.canonical-maintenance-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, scopeRegistrySha256: scope.sha256, inputCatalogSha256: await catalogSha256(baseline.bundle),
    outputCatalogSha256: await catalogSha256(fields.bundle), acceptedAt: options.acceptedAt, acceptedProposalIds: [...acceptedIds].sort(), held,
    identityReceiptSha256: identities.receipt.sha256, scholarshipReceiptSha256: scholarships.receipt.sha256, fieldReceiptSha256: fields.receipt.sha256,
    cycleReceiptSha256: cycles.cycleReceipt.sha256, cycleFieldReceiptSha256: cycles.fieldReceipt.sha256,
    unchangedProposalIds: [...unchangedIds].sort() }
  const receipt: CanonicalMaintenanceReceipt = { ...content, sha256: digest(content) }
  const candidateFiles: Record<string, unknown> = { 'candidate-bundle.json': fields.bundle, 'identity-acceptances.json': scholarships.acceptances,
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
  }
  return { receipt, receiptPath: join(output, 'canonical-receipt.json'), changed: acceptedIds.size > 0, replayed: false }
}

export async function acknowledgeCanonicalMaintenance(root: string, receiptPath: string, sourceCommit: string) {
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('maintenance_source_commit_invalid')
  const receipt = read(receiptPath) as CanonicalMaintenanceReceipt, { sha256, ...content } = receipt
  if (digest(content) !== sha256) throw new Error('maintenance_receipt_changed')
  const current = readCatalogSnapshotBaseline(join(root, 'content', 'data')).bundle
  if (await catalogSha256(current) !== receipt.outputCatalogSha256) throw new Error('maintenance_canonical_ack_hash_changed')
  const client = maintenanceClientFromEnvironment(process.env)
  const result = await client.json('/ack', 'POST', { batchId: receipt.batchId, outcome: receipt.acceptedProposalIds.length ? 'applied' : 'rejected', receiptSha256: receipt.sha256, sourceCommit,
    newInputCatalogSha256: receipt.outputCatalogSha256, acceptedProposalIds: receipt.acceptedProposalIds, heldProposalIds: receipt.held.map(entry => entry.proposalId),
    ...(receipt.unchangedProposalIds?.length ? { unchangedProposalIds: receipt.unchangedProposalIds } : {}) })
  const scope = maintenanceScopeSchema.parse(read(join(root, 'content/maintenance/scope-272.v1.json')))
  if (receipt.acceptedProposalIds.length) await client.json('/targets', 'POST', { inputCatalogSha256: receipt.outputCatalogSha256, recordTargets: buildMaintenanceTargets(current, scope) })
  return result
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1]
  if (args[0] === 'ack' && args.includes('--receipt') && args.includes('--commit')) {
    console.log(JSON.stringify(await acknowledgeCanonicalMaintenance(process.cwd(), resolve(value('--receipt')), value('--commit')))); return
  }
  if (!args.includes('--download') || !args.includes('--output')) throw new Error('Usage: prepare-maintenance-catalog.ts --download <directory> --output <candidate-directory> [--apply] | ack --receipt <file> --commit <sha>')
  const result = await prepareMaintenanceCatalog({ root: process.cwd(), downloadDirectory: value('--download'), outputDirectory: value('--output'), acceptedAt: new Date().toISOString(), apply: args.includes('--apply') })
  console.log(JSON.stringify({ batchId: result.receipt.batchId, accepted: result.receipt.acceptedProposalIds.length, held: result.receipt.held.length,
    unchanged: result.receipt.unchangedProposalIds?.length ?? 0,
    changed: result.changed, replayed: result.replayed, receiptSha256: result.receipt.sha256 }))
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,
    `changed=${result.changed}\nreplayed=${result.replayed}\naccepted_count=${result.receipt.acceptedProposalIds.length}\nreceipt=${result.receiptPath}\n`, { flag: 'a' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'maintenance_candidate_failed'); process.exitCode = 1 })
