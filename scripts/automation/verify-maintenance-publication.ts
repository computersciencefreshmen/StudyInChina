import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadMaintenanceBundle } from '../maintenance/build-scope'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { getTodayDate } from '../../src/lib/data/freshness'
import { maintenanceClientFromEnvironment } from './catalog-maintenance-client'
import type { CanonicalMaintenanceReceipt } from './prepare-maintenance-catalog'
import { canonicalJson } from '../maintenance/contracts'
import { directoryRevision } from '../../src/lib/catalog/directory-revision'

const PROJECT = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg', OWNER = 'team_o5qghzfTOk24QwoYANzJ8hNH'
const ORIGIN = 'https://studyinchina.vercel.app', sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
async function boundedJson(response: Response) {
  if (!response.ok || response.redirected || !response.body) throw new Error('publication_readback_unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength
    if (total > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('publication_readback_too_large') }; chunks.push(chunk.value) } }
  finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function verifyMaintenancePublication(options: { root: string; sourceCommit: string; receipt: CanonicalMaintenanceReceipt; vercelToken: string; fetcher?: typeof fetch }) {
  if (!/^[a-f0-9]{40}$/u.test(options.sourceCommit) || !options.vercelToken || /[\r\n]/u.test(options.vercelToken)) throw new Error('publication_configuration_invalid')
  const fetcher = options.fetcher ?? fetch
  const provider = async (path: string) => boundedJson(await fetcher(`https://api.vercel.com${path}?teamId=${OWNER}`, {
    headers: { Authorization: `Bearer ${options.vercelToken}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) }))
  const alias = await provider('/v4/aliases/studyinchina.vercel.app')
  if (alias.projectId !== PROJECT || !/^dpl_[a-zA-Z0-9]+$/u.test(alias.deploymentId ?? '')) throw new Error('publication_owner_mismatch')
  const deployment = await provider(`/v13/deployments/${alias.deploymentId}`)
  if (deployment.projectId !== PROJECT || deployment.ownerId !== OWNER || deployment.readyState !== 'READY' || deployment.target !== 'production'
    || deployment.meta?.githubCommitSha !== options.sourceCommit || deployment.id !== alias.deploymentId) throw new Error('publication_exact_commit_not_stable')
  const publicRead = async (path: string) => boundedJson(await fetcher(`${ORIGIN}${path}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) }))
  const today = getTodayDate(), raw = loadMaintenanceBundle(options.root), dataDirectory = resolve(options.root, 'content', 'data')
  const identities = readIdentityAcceptances(dataDirectory), fields = readFieldVerifications(dataDirectory)
  const data = selectDiscoveryData(raw, today, identities, fields), revision = directoryRevision(raw, today, identities, fields)
  const checked: Record<string, number> = {}
  for (const [entity, expected] of [['institutions', data.universities], ['programs', data.programs], ['scholarships', data.scholarships]] as const) {
    const ids = new Set<string>(), cursors = new Set<string>(); let cursor: string | null = null
    do {
      const result = await publicRead(`/api/v1/directory/${entity}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      if (!Array.isArray(result.data) || result.meta?.release?.evaluatedForDate !== today) throw new Error('publication_directory_contract_mismatch')
      if (result.meta?.release?.directoryRevision !== revision) throw new Error('publication_projection_revision_mismatch')
      for (const record of result.data) { if (typeof record.id !== 'string' || ids.has(record.id)) throw new Error('publication_duplicate_or_missing_id'); ids.add(record.id) }
      cursor = result.meta?.nextCursor ?? null
      if (cursor !== null && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 100)) throw new Error('publication_pagination_invalid')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    if (ids.size !== expected.length) throw new Error(`publication_directory_parity_failed:${entity}`)
    for (const record of expected) if (!ids.has(record.id)) throw new Error(`publication_directory_parity_failed:${entity}`)
    checked[entity] = ids.size
  }
  const release = await publicRead('/api/v1/releases/current')
  if (release.data?.evaluatedForDate !== today || release.data?.catalogBackend !== 'json'
    || release.data?.directoryRevision !== revision) throw new Error('publication_release_contract_mismatch')
  // Each changed identity must have a real rendered detail route in every public locale.
  const changedIds = new Set<string>()
  const batchDirectory = resolve(options.root, 'quality', 'maintenance', 'batches', options.receipt.batchId)
  for (const file of ['identity-receipt.json', 'scholarship-receipt.json', 'field-receipt.json', 'cycle-field-receipt.json']) {
    try {
      const receipt = JSON.parse(readFileSync(resolve(batchDirectory, file), 'utf8'))
      for (const item of receipt.accepted ?? []) {
        if (typeof item.recordId !== 'string') throw new Error('publication_changed_record_invalid')
        const parent = raw.admissionCycles.find(cycle => cycle.id === item.recordId)?.programId
        changedIds.add(parent ?? item.recordId)
      }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  let detailsChecked = 0
  for (const [kind, records] of [['programs', data.programs], ['scholarships', data.scholarships]] as const)
    for (const record of records) {
      if (!changedIds.has(record.id)) continue
      for (const locale of ['en', 'zh', 'ru', 'de', 'fr', 'es']) {
        const response = await fetcher(`${ORIGIN}/${locale}/${kind}/${encodeURIComponent(record.slug)}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
        if (!response.ok || response.redirected) throw new Error('publication_detail_unavailable')
        const html = await response.text()
        if (!/<h1[\s>]/u.test(html) || !html.includes('data-discovery-notice') || /application error: a client-side exception/iu.test(html)) throw new Error('publication_detail_content_invalid')
        detailsChecked++
      }
    }
  const proof = { format: 'studyinchina.maintenance-stable-proof', formatVersion: 1, pass: true, checkedAt: new Date().toISOString(),
    today, sourceCommit: options.sourceCommit, deploymentId: deployment.id, batchId: options.receipt.batchId, canonicalReceiptSha256: options.receipt.sha256,
    directoryCounts: checked, directoryRevision: revision, detailsChecked, checks: ['native-owner-project-exact-commit', 'all-directory-identities', 'unique-complete-pagination', 'projection-revision', 'current-date-json-backend', 'changed-six-language-details'] }
  return { ...proof, sha256: sha(proof) }
}

type PublicationProof = Awaited<ReturnType<typeof verifyMaintenancePublication>>
function readSavedProof(path: string, receipt: CanonicalMaintenanceReceipt, sourceCommit: string): PublicationProof {
  const proof = JSON.parse(readFileSync(path, 'utf8')) as PublicationProof
  const { sha256, ...content } = proof
  if (sha(content) !== sha256 || proof.pass !== true || proof.batchId !== receipt.batchId || proof.sourceCommit !== sourceCommit
    || proof.canonicalReceiptSha256 !== receipt.sha256 || !/^dpl_[a-zA-Z0-9]+$/u.test(proof.deploymentId)
    || !/^[a-f0-9]{64}$/u.test(proof.directoryRevision ?? '')
    || !Array.isArray(proof.checks) || !proof.checks.includes('native-owner-project-exact-commit')
    || !proof.checks.includes('projection-revision')) throw new Error('publication_saved_proof_changed')
  return proof
}

/** Preserve one successful proof before acknowledgement so a lost reply can retry identical bytes. */
export async function publishMaintenanceProof(options: {
  root: string; sourceCommit: string; receipt: CanonicalMaintenanceReceipt; vercelToken: string; output: string;
  fetcher?: typeof fetch; acknowledge?: (body: unknown) => Promise<unknown>;
}): Promise<PublicationProof> {
  const output = resolve(options.output)
  let proof: PublicationProof
  if (existsSync(output)) proof = readSavedProof(output, options.receipt, options.sourceCommit)
  else {
    proof = await verifyMaintenancePublication(options)
    mkdirSync(dirname(output), { recursive: true })
    try { writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; proof = readSavedProof(output, options.receipt, options.sourceCommit) }
  }
  if (options.acknowledge) await options.acknowledge({ batchId: options.receipt.batchId, outcome: 'published', receiptSha256: options.receipt.sha256,
    sourceCommit: proof.sourceCommit, newInputCatalogSha256: options.receipt.outputCatalogSha256, acceptedProposalIds: options.receipt.acceptedProposalIds,
    heldProposalIds: options.receipt.held.map(entry => entry.proposalId), deploymentId: proof.deploymentId, stableProofSha256: proof.sha256 })
  return proof
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1]
  if (!['--receipt', '--commit', '--output'].every(name => args.includes(name))) throw new Error('Usage: verify-maintenance-publication.ts --receipt <file> --commit <sha> --output <proof.json> [--ack]')
  const receipt = JSON.parse(readFileSync(resolve(value('--receipt')), 'utf8')) as CanonicalMaintenanceReceipt, { sha256, ...content } = receipt
  if (sha(content) !== sha256) throw new Error('publication_canonical_receipt_changed')
  const proof = await publishMaintenanceProof({ root: process.cwd(), sourceCommit: value('--commit'), receipt,
    vercelToken: process.env.VERCEL_TOKEN ?? '', output: value('--output'),
    ...(args.includes('--ack') ? { acknowledge: (body: unknown) => maintenanceClientFromEnvironment(process.env).json('/ack', 'POST', body) } : {}) })
  console.log(JSON.stringify({ pass: true, deploymentId: proof.deploymentId, proofSha256: proof.sha256 }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error('publication_exact_commit_or_content_readback_failed'); process.exitCode = 1 })
