import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bootstrapDirectoryIdentities } from '../../scripts/automation/bootstrap-directory-identities'
import { readCatalogSnapshotBaseline, catalogSnapshotFilenames } from '../../scripts/automation/apply-catalog-snapshot'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { selectPublishedData } from '../../src/lib/data/publication'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { prepareMaintenanceCatalog } from '../../scripts/automation/prepare-maintenance-catalog'
import { canonicalJson, exportContentSha256 } from '../../scripts/maintenance/contracts'

const roots: string[] = [], sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { for (const root of roots.splice(0)) {
  const absolute = resolve(root)
  if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('maintenance-proof-test-')) throw Error('Invalid cleanup target')
  rmSync(absolute, { recursive: true, force: true })
} })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-proof-test-')); roots.push(root)
  const directory = join(root, 'content', 'data'); mkdirSync(directory, { recursive: true })
  const data = loadMaintenanceBundle(process.cwd())
  for (const [key, filename] of Object.entries(catalogSnapshotFilenames)) writeFileSync(join(directory, `${filename}.json`), JSON.stringify(data[key as keyof typeof catalogSnapshotFilenames]))
  const baseline = readCatalogSnapshotBaseline(directory), prior = selectPublishedData(data, '2026-10-19')
  const proof = { pass: true, today: '2026-10-19', errors: [], expectedInputManifest: { files: baseline.files.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes.length })) },
    publicCounts: Object.fromEntries(Object.entries(prior).map(([name, records]) => [name, records.length])) }
  const proofPath = join(root, 'accepted-production-proof.json')
  const save = () => { const bytes = JSON.stringify(proof); writeFileSync(proofPath, bytes); return sha(bytes) }
  const proofSha256 = save()
  return { root, directory, data, proof, proofPath, proofSha256, save }
}

describe('migration from an exact accepted production identity baseline', () => {
  it('migrates only previously public identities without renewing raw audit dates or creating current awards', () => {
    const f = fixture(), bytesBefore = readFileSync(join(f.directory, 'scholarships.json'))
    const result = bootstrapDirectoryIdentities(f.root, f.proofPath, f.proofSha256, '2026-10-24T02:00:00.000Z')
    expect(result.ledger.entries.filter(entry => entry.entityType === 'scholarship')).toHaveLength(f.proof.publicCounts.scholarships)
    expect(result.ledger.entries.some(entry => entry.recordId === f.data.programs.find(program => program.status === 'draft')!.id)).toBe(false)
    expect(result.receipt.policy).toContain('No current opportunity')
    expect(readFileSync(join(f.directory, 'scholarships.json')).equals(bytesBefore)).toBe(true)
    expect(selectPublishedData(f.data, '2026-10-24').scholarships).toHaveLength(0)
  })
  it('refuses a changed source snapshot even if the same public counts could still be produced', () => {
    const f = fixture(); f.data.programs[0].name.en = 'Changed name after production approval'
    writeFileSync(join(f.directory, 'programs.json'), JSON.stringify(f.data.programs))
    expect(() => bootstrapDirectoryIdentities(f.root, f.proofPath, f.proofSha256, '2026-10-24T02:00:00.000Z')).toThrow('published_identity_snapshot_mismatch')
  })
  it('refuses an unpinned proof or a raw count substituted for the prior public count', () => {
    const f = fixture()
    expect(() => bootstrapDirectoryIdentities(f.root, f.proofPath, '0'.repeat(64), '2026-10-24T02:00:00.000Z')).toThrow('published_identity_proof_changed')
    f.proof.publicCounts.scholarships = f.data.scholarships.length
    expect(() => bootstrapDirectoryIdentities(f.root, f.proofPath, f.save(), '2026-10-24T02:00:00.000Z')).toThrow('published_identity_count_mismatch')
  })
  it('keeps integrity passing distinct from full school or current-opportunity coverage', async () => {
    const f = fixture(), scope = await buildMaintenanceScope(f.data, { scopeId: 'validation-test', createdAt: '2026-10-24T00:00:00.000Z' })
    const maintenance = join(f.root, 'content', 'maintenance'); mkdirSync(maintenance, { recursive: true })
    writeFileSync(join(maintenance, 'scope-272.v1.json'), JSON.stringify(scope))
    const report = await validateDirectory(f.root, '2026-10-24')
    expect(report.integrityPassed).toBe(true)
    expect(report.cohortSchools).toBe(272)
    expect(report.coverageComplete).toBe(false)
    expect(report.schoolCoverage.directoryWithoutPrograms).toBeGreaterThan(0)
    expect(report.currentFactsCounts.scholarships).toBe(0)
  })
  it('returns the real committed receipt path when an already consumed batch is recovered', async () => {
    const f = fixture(), scope = await buildMaintenanceScope(f.data, { scopeId: 'replay-path', createdAt: '2026-10-24T00:00:00.000Z' })
    const maintenance = join(f.root, 'content', 'maintenance'); mkdirSync(maintenance, { recursive: true })
    writeFileSync(join(maintenance, 'scope-272.v1.json'), JSON.stringify(scope))
    const download = join(f.root, 'download'); mkdirSync(download)
    const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'replayed-batch',
      inputCatalogSha256: await catalogSha256(f.data), scopeRegistrySha256: scope.sha256, createdAt: '2026-10-24T00:00:00.000Z', proposals: [] }
    const batch = { ...content, sha256: await exportContentSha256(content) }; writeFileSync(join(download, 'export.json'), JSON.stringify(batch))
    const prior = { batchId: batch.batchId, batchSha256: batch.sha256, outputCatalogSha256: content.inputCatalogSha256,
      acceptedProposalIds: ['previously-accepted'], held: [] }
    const receiptDirectory = join(f.root, 'quality', 'maintenance', 'batches', batch.batchId); mkdirSync(receiptDirectory, { recursive: true })
    const receiptPath = join(receiptDirectory, 'canonical-receipt.json')
    writeFileSync(receiptPath, JSON.stringify({ ...prior, sha256: sha(canonicalJson(prior)) }))
    const output = join(f.root, 'unused-replay-output')
    const result = await prepareMaintenanceCatalog({ root: f.root, downloadDirectory: download, outputDirectory: output, acceptedAt: '2026-10-24T02:00:00.000Z' })
    expect(result).toMatchObject({ replayed: true, changed: false, receiptPath })
    expect(existsSync(result.receiptPath)).toBe(true)
    expect(existsSync(output)).toBe(false)
  })
})
