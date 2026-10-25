import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCatalogSnapshotBaseline } from './apply-catalog-snapshot'
import { selectPublishedData } from '../../src/lib/data/publication'
import { identityAcceptanceLedgerSchema, identityFingerprint, canonicalIdentityJson, type IdentityAcceptance, type IdentityEntityType } from '../../src/lib/data/identity-acceptance'

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Migrate trust from an exact, previously accepted production snapshot, never from a stale flag. */
export function bootstrapDirectoryIdentities(root: string, proofPath: string, proofSha256: string, acceptedAt: string) {
  const proofBytes = readFileSync(proofPath)
  if (!/^[a-f0-9]{64}$/u.test(proofSha256) || sha(proofBytes) !== proofSha256) throw new Error('published_identity_proof_changed')
  const proof = JSON.parse(proofBytes.toString('utf8'))
  if (proof.pass !== true || !/^\d{4}-\d{2}-\d{2}$/u.test(proof.today) || !Array.isArray(proof.errors) || proof.errors.length
    || !Array.isArray(proof.expectedInputManifest?.files) || proof.expectedInputManifest.files.length !== 6) throw new Error('published_identity_proof_incomplete')
  const baseline = readCatalogSnapshotBaseline(join(root, 'content', 'data'))
  for (const file of baseline.files) {
    const pin = proof.expectedInputManifest.files.find((entry: { path: string }) => basename(entry.path) === basename(file.path))
    // Git's Windows checkout can add CRLF. Permit exactly that transformation,
    // while requiring every other byte to match the frozen production pin.
    const sourceBytes = Buffer.from(file.bytes.toString('utf8').replaceAll('\r\n', '\n'))
    if (!pin || !((pin.sha256 === file.sha256 && pin.bytes === file.bytes.length)
      || (pin.sha256 === sha(sourceBytes) && pin.bytes === sourceBytes.length))) throw new Error('published_identity_snapshot_mismatch')
  }
  const prior = selectPublishedData(baseline.bundle, proof.today)
  for (const [name, rows] of Object.entries(prior)) if (proof.publicCounts?.[name] !== rows.length) throw new Error('published_identity_count_mismatch')
  const identityRows = [ ['city', prior.cities], ['university', prior.universities], ['program', prior.programs], ['scholarship', prior.scholarships] ] as const
  const receiptContent = { format: 'studyinchina.published-identity-bootstrap', formatVersion: 1,
    acceptedAt, proofSha256, baselineDate: proof.today, inputFiles: baseline.files.map(file => ({ name: basename(file.path), sha256: file.sha256,
      productionSourceSha256: sha(Buffer.from(file.bytes.toString('utf8').replaceAll('\r\n', '\n'))) })),
    policy: 'Only identities in the exact previously accepted public snapshot. No current opportunity, audit-date renewal, funding or eligibility certification.',
    identities: identityRows.flatMap(([kind, rows]) => rows.map(record => ({ entityType: kind, recordId: record.id, identitySha256: identityFingerprint(kind, record) }))) }
  const receipt = { ...receiptContent, sha256: sha(canonicalIdentityJson(receiptContent)) }, receiptPath = 'quality/maintenance/published-identity-bootstrap.json'
  const entries: IdentityAcceptance[] = identityRows.flatMap(([kind, rows]) => rows.map(record => ({ entityType: kind as IdentityEntityType, recordId: record.id,
    identitySha256: identityFingerprint(kind, record), sourceIds: [...record.sourceIds], acceptedAt,
    reviewer: 'accepted-production-baseline-migration', receiptPath, receiptSha256: receipt.sha256 })))
  return { ledger: identityAcceptanceLedgerSchema.parse({ schemaVersion: 1, entries }), receipt }
}
function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1]
  if (!args.includes('--proof') || !args.includes('--proof-sha')) throw new Error('Usage: bootstrap-directory-identities.ts --proof <accepted-proof.json> --proof-sha <sha256> [--apply]')
  const root = process.cwd(), result = bootstrapDirectoryIdentities(root, resolve(value('--proof')), value('--proof-sha'), new Date().toISOString())
  if (args.includes('--apply')) {
    const path = resolve(root, 'content/data/identity-acceptances.json'), receipt = resolve(root, 'quality/maintenance/published-identity-bootstrap.json')
    mkdirSync(dirname(receipt), { recursive: true })
    writeFileSync(path, `${JSON.stringify(result.ledger, null, 2)}\n`, { flag: 'wx' })
    writeFileSync(receipt, `${JSON.stringify(result.receipt, null, 2)}\n`, { flag: 'wx' })
  }
  console.log(JSON.stringify({ identities: result.ledger.entries.length, receiptSha256: result.receipt.sha256, applied: args.includes('--apply') }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  try { main() } catch (error) { console.error(error instanceof Error ? error.message : 'identity_bootstrap_failed'); process.exitCode = 1 }
