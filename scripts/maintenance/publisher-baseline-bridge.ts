import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, sha256Text,
  type CandidateExport, type MaintenanceProposal } from './contracts'

const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs',
  admissionCycles: 'admission-cycles', scholarships: 'scholarships' } as const
type Collection = keyof typeof files
type Audits = Record<string, { entries: Array<Record<string, unknown>> }>
type CatalogRow = { id: string; [key: string]: unknown }
const auditFiles = ['identity-acceptances', 'identity-bindings', 'field-verifications'] as const
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const fail = (code: string): never => { throw new Error(`publisher_baseline_bridge_${code}`) }
const catalogHash = (bundle: DataBundle) => sha256Text(canonicalJson(bundle))
export type PublisherBaselineBridgeReference = { version: 1; baseCommit: string; liveCommit: string;
  proofSha256: string; validationBatchSha256: string; sourceExportFileSha256: string }

/** Check the durable attachment chain again before cloud acknowledgement,
 * recovery or public readback. Missing/changed evidence cannot become an ack. */
export function verifyPublisherBaselineBridgeReceipt(root: string, receipt: {
  batchId: string; batchSha256: string; inputCatalogSha256: string; scopeRegistrySha256: string;
  acceptedProposalIds: string[]; held: Array<{ proposalId: string }>;
  applicationBaselineCatalogSha256?: string; baselineBridge?: PublisherBaselineBridgeReference;
}) {
  const ref = receipt.baselineBridge
  if (!ref) { if (receipt.applicationBaselineCatalogSha256 !== undefined) fail('reference_missing'); return }
  if (!/^[a-zA-Z0-9_-]{1,140}$/u.test(receipt.batchId) || ref.version !== 1
    || !/^[a-f0-9]{40}$/u.test(ref.baseCommit) || !/^[a-f0-9]{40}$/u.test(ref.liveCommit)) fail('reference_invalid')
  const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
  const directory = join(root, 'quality', 'maintenance', 'batches', receipt.batchId)
  const sourceBytes = readFileSync(join(directory, 'source-export.json'))
  if (hash(sourceBytes) !== ref.sourceExportFileSha256) fail('source_bytes_changed')
  const source = maintenanceCandidateExportSchema.parse(JSON.parse(sourceBytes.toString('utf8')))
  const validation = maintenanceCandidateExportSchema.parse(JSON.parse(readFileSync(join(directory, 'validation-export.json'), 'utf8')))
  const proof = JSON.parse(readFileSync(join(directory, 'baseline-bridge.json'), 'utf8'))
  const { sha256: proofHash, ...proofContent } = proof
  const { sha256: sourceHash, ...sourceContent } = source
  const { sha256: validationHash, ...validationContent } = validation
  if (hash(canonicalJson(proofContent)) !== proofHash || proofHash !== ref.proofSha256
    || hash(canonicalJson(sourceContent)) !== sourceHash || sourceHash !== receipt.batchSha256
    || hash(canonicalJson(validationContent)) !== validationHash || validationHash !== ref.validationBatchSha256
    || source.batchId !== receipt.batchId || validation.batchId !== receipt.batchId || validation.createdAt !== source.createdAt
    || source.scopeRegistrySha256 !== receipt.scopeRegistrySha256 || validation.scopeRegistrySha256 !== receipt.scopeRegistrySha256
    || source.inputCatalogSha256 !== receipt.inputCatalogSha256 || validation.inputCatalogSha256 !== receipt.applicationBaselineCatalogSha256
    || proof.format !== 'studyinchina.publisher-baseline-bridge' || proof.version !== 1
    || proof.gitBindingVerified !== true || proof.canApply !== true || proof.acceptanceAuthorized !== false || proof.originalExportModified !== false
    || proof.baseCommit !== ref.baseCommit || proof.liveCommit !== ref.liveCommit
    || proof.baseCatalogSha256 !== source.inputCatalogSha256 || proof.liveCatalogSha256 !== validation.inputCatalogSha256
    || proof.sourceBatchId !== source.batchId || proof.sourceBatchSha256 !== sourceHash || proof.validationBatchSha256 !== validationHash
    || proof.scopeRegistrySha256 !== source.scopeRegistrySha256 || !Array.isArray(proof.held) || !Array.isArray(proof.eligible)) fail('receipt_binding_invalid')
  const originals = new Map(source.proposals.map(row => [row.id, row]))
  const eligibleIds = validation.proposals.map(row => row.id)
  const heldIds = proof.held.map((row: { proposalId: string }) => row.proposalId) as string[]
  const partition = [...eligibleIds, ...heldIds]
  if (!same(eligibleIds, proof.eligible.map((row: { proposalId: string }) => row.proposalId))
    || partition.length !== originals.size || new Set(partition).size !== originals.size || partition.some(id => !originals.has(id))
    || validation.proposals.some(row => !same(row, originals.get(row.id))) || !receipt.acceptedProposalIds.length
    || receipt.acceptedProposalIds.some(id => !eligibleIds.includes(id))) fail('proposal_partition_invalid')
  const acknowledged = [...receipt.acceptedProposalIds, ...receipt.held.map(row => row.proposalId)]
  if (acknowledged.length !== originals.size || new Set(acknowledged).size !== originals.size || acknowledged.some(id => !originals.has(id))) fail('acknowledgement_partition_invalid')
}

/** This creates a validation view, never a replacement producer export. It
 * authorizes no facts: the ordinary importers must still validate every item. */
export async function buildPublisherBaselineBridge(options: {
  originalBatch: unknown; base: DataBundle; live: DataBundle; baseCommit: string; liveCommit: string;
  baseAudits: Audits; liveAudits: Audits;
}) {
  const batch = maintenanceCandidateExportSchema.parse(options.originalBatch)
  if (!/^[a-f0-9]{40}$/u.test(options.baseCommit) || !/^[a-f0-9]{40}$/u.test(options.liveCommit)) fail('commit_invalid')
  if (batch.sha256 !== await exportContentSha256(batch)) fail('export_checksum_invalid')
  const baseHash = await catalogHash(options.base), liveHash = await catalogHash(options.live)
  if (baseHash !== batch.inputCatalogSha256) fail('base_catalogue_mismatch')
  const maps = (bundle: DataBundle) => Object.fromEntries(Object.keys(files).map(key => {
    const rows = bundle[key as Collection] as unknown as CatalogRow[]
    const map = new Map(rows.map(row => [row.id, row]))
    if (map.size !== rows.length) fail('duplicate_record_id')
    return [key, map]
  })) as Record<Collection, Map<string, CatalogRow>>
  const before = maps(options.base), after = maps(options.live)
  const delta: Record<string, { added: string[]; changed: string[] }> = {}
  for (const key of Object.keys(files) as Collection[]) {
    if ([...before[key].keys()].some(id => !after[key].has(id))) fail('record_removed')
    delta[key] = {
      added: [...after[key].keys()].filter(id => !before[key].has(id)).sort(),
      changed: [...before[key]].filter(([id, row]) => !same(row, after[key].get(id))).map(([id]) => id).sort(),
    }
  }
  for (const name of auditFiles) {
    for (const ledger of [options.baseAudits[name], options.liveAudits[name]]) {
      if (!ledger || !Array.isArray(ledger.entries) || ledger.entries.some(row => !row || typeof row.recordId !== 'string')) fail('audit_invalid')
    }
  }
  const held: Array<{ proposalId: string; reason: string }> = []
  const checks: Array<{ proposalId: string; dependencies: string[]; auditSha256: string }> = []
  const eligible: MaintenanceProposal[] = []
  for (const proposal of batch.proposals) {
    try {
      if (proposal.status !== 'ready') fail('producer_held')
      const dependencies = new Set<string>(), recordIds = new Set<string>()
      const include = (collection: Collection, id: unknown) => {
        if (typeof id !== 'string' || !id) throw new Error('publisher_baseline_bridge_dependency_id_missing')
        const key = `${collection}:${id}`
        if (dependencies.has(key)) return
        const old = before[collection].get(id), current = after[collection].get(id)
        if (!old || !current || !same(old, current)) throw new Error(`publisher_baseline_bridge_dependency_changed:${key}`)
        dependencies.add(key); recordIds.add(id)
        if (collection !== 'sources') {
          for (const sourceId of (old.sourceIds ?? []) as string[]) include('sources', sourceId)
        }
        if (collection === 'programs') include('universities', old.universityId)
        if (collection === 'admissionCycles') include('programs', old.programId)
        if (collection === 'universities') include('cities', old.cityId)
        if (collection === 'scholarships') {
          for (const school of (old.universityIds ?? []) as string[]) include('universities', school)
          for (const program of (old.programIds ?? []) as string[]) include('programs', program)
        }
      }
      const inventory = (collection: Collection, belongs: (row: CatalogRow) => boolean) => {
        const old = [...before[collection].values()].filter(belongs).sort((a, b) => a.id.localeCompare(b.id))
        const current = [...after[collection].values()].filter(belongs).sort((a, b) => a.id.localeCompare(b.id))
        if (!same(old, current)) fail(`inventory_changed:${collection}`)
        for (const row of old) include(collection, row.id)
      }
      include('universities', proposal.universityId)
      if (proposal.entityType === 'program') {
        if (proposal.recordId) include('programs', proposal.recordId)
        else if (proposal.operation === 'create') inventory('programs', row => row.universityId === proposal.universityId)
        else fail('patch_record_missing')
      } else if (proposal.entityType === 'admission-cycle') {
        if (proposal.recordId) include('admissionCycles', proposal.recordId)
        else if (proposal.operation === 'create') {
          const parent = proposal.fields.programId
          include('programs', parent)
          inventory('admissionCycles', row => row.programId === parent)
        } else fail('patch_record_missing')
      } else {
        if (proposal.recordId) include('scholarships', proposal.recordId)
        else if (proposal.operation !== 'create') fail('patch_record_missing')
        // Scholarship scope may be school-wide. Keep its entire school
        // inventory stable rather than assuming a newly added program fits.
        inventory('programs', row => row.universityId === proposal.universityId)
        inventory('scholarships', row => Array.isArray(row.universityIds) && row.universityIds.includes(proposal.universityId))
      }
      const relevantAudits: Record<string, unknown[]> = {}
      for (const name of auditFiles) {
        const select = (ledger: Audits[string]) => ledger.entries.filter(row => recordIds.has(String(row.recordId)))
          .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))
        const old = select(options.baseAudits[name]), current = select(options.liveAudits[name])
        if (!same(old, current)) fail(`audit_changed:${name}`)
        relevantAudits[name] = current
      }
      checks.push({ proposalId: proposal.id, dependencies: [...dependencies].sort(), auditSha256: await sha256Text(canonicalJson(relevantAudits)) })
      eligible.push(proposal)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('publisher_baseline_bridge_')) throw error
      held.push({ proposalId: proposal.id, reason: error.message })
    }
  }
  const { sha256: originalSha256, ...content } = batch
  const derivedContent = { ...content, inputCatalogSha256: liveHash, proposals: eligible }
  const validationBatch: CandidateExport = { ...derivedContent, sha256: await exportContentSha256({ ...derivedContent, sha256: '0'.repeat(64) }) }
  const proofContent = { format: 'studyinchina.publisher-baseline-bridge', version: 1,
    baseCommit: options.baseCommit, liveCommit: options.liveCommit, baseCatalogSha256: baseHash, liveCatalogSha256: liveHash,
    sourceBatchId: batch.batchId, sourceBatchSha256: originalSha256, validationBatchSha256: validationBatch.sha256,
    scopeRegistrySha256: batch.scopeRegistrySha256, delta, eligible: checks, held,
    acceptanceAuthorized: false, originalExportModified: false, gitBindingVerified: false,
    hasEligibleProposals: eligible.length > 0, canApply: false }
  return { validationBatch, proof: { ...proofContent, sha256: await sha256Text(canonicalJson(proofContent)) } }
}

/** Production entrypoint: obtain both baselines from exact Git objects and
 * reject working-copy data or ledger drift. The base commit must be a reviewed
 * pin matching the immutable producer export, never a user-supplied new hash. */
export async function preparePublisherBaselineBridge(options: { root: string; originalBatch: unknown; baseCommit: string; liveCommit: string }) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: options.root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
  if (!/^[a-f0-9]{40}$/u.test(options.baseCommit) || !/^[a-f0-9]{40}$/u.test(options.liveCommit)) fail('commit_invalid')
  if (git('rev-parse', 'HEAD').trim() !== options.liveCommit) fail('live_commit_changed')
  try { git('merge-base', '--is-ancestor', options.baseCommit, options.liveCommit) } catch { fail('ancestry_invalid') }
  const at = (commit: string, file: string) => JSON.parse(git('cat-file', 'blob', `${commit}:content/data/${file}.json`)) as unknown
  const bundleAt = (commit: string) => bundleSchema.parse(Object.fromEntries(Object.entries(files).map(([key, file]) => [key, at(commit, file)])))
  const base = bundleAt(options.baseCommit), live = bundleAt(options.liveCommit)
  const working = bundleSchema.parse(Object.fromEntries(Object.entries(files).map(([key, file]) => [key,
    JSON.parse(readFileSync(join(options.root, 'content', 'data', `${file}.json`), 'utf8'))])))
  if (!same(live, working)) fail('working_catalogue_changed')
  const auditAt = (commit: string, file: string) => {
    try { git('cat-file', '-e', `${commit}:content/data/${file}.json`) } catch { return { entries: [] } }
    return at(commit, file) as Audits[string]
  }
  const baseAudits: Audits = {}, liveAudits: Audits = {}
  for (const name of auditFiles) {
    baseAudits[name] = auditAt(options.baseCommit, name); liveAudits[name] = auditAt(options.liveCommit, name)
    const path = join(options.root, 'content', 'data', `${name}.json`)
    const workingAudit = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { entries: [] }
    if (!same(liveAudits[name], workingAudit)) fail('working_audit_changed')
  }
  const result = await buildPublisherBaselineBridge({ ...options, base, live, baseAudits, liveAudits })
  const { sha256: _unboundProofHash, ...proof } = result.proof
  void _unboundProofHash
  const boundProof = { ...proof, gitBindingVerified: true, canApply: proof.hasEligibleProposals }
  return { validationBatch: result.validationBatch, proof: { ...boundProof, sha256: await sha256Text(canonicalJson(boundProof)) } }
}
