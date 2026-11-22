import { createHash, webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareMaintenanceCatalog, acknowledgeCanonicalMaintenance } from '../../scripts/automation/prepare-maintenance-catalog'
import { recoverPendingMaintenancePublication } from '../../scripts/automation/catalog-maintenance-client'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { canonicalJson, exportContentSha256, proposalContentSha256, type CandidateExport, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256 } from '../../src/lib/data/field-verification'
import { verifyPublisherBaselineBridgeReceipt } from '../../scripts/maintenance/publisher-baseline-bridge'
import { acknowledge } from '../../workers/catalog-maintenance/src/exports'
import { MemoryBucket, TestD1 } from '../../workers/catalog-maintenance/tests/fixture'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'

const capturedAt = '2026-10-24T00:00:00.000Z', acceptedAt = '2026-10-24T02:00:00.000Z'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
beforeAll(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function fixture(changedParent = false) {
  const root = mkdtempSync(join(tmpdir(), 'sic-bridge-integration-'))
  const data = join(root, 'content/data'), maintenance = join(root, 'content/maintenance')
  mkdirSync(data, { recursive: true }); mkdirSync(maintenance, { recursive: true })
  const original = loadMaintenanceBundle(process.cwd())
  const scope = await buildMaintenanceScope(original, { scopeId: 'bridge-integration', createdAt: capturedAt })
  writeFileSync(join(maintenance, 'scope-272.v1.json'), JSON.stringify(scope))
  const chosen = original.admissionCycles.find(row => row.status === 'verified' && row.academicYear === '2027-2028' && row.intake === 'autumn')!
  const parent = original.programs.find(row => row.id === chosen.programId)!
  const base = { ...original, programs: [structuredClone(parent)],
    admissionCycles: [{ ...structuredClone(chosen), closesOn: null, dateStatus: 'rolling' as const }], scholarships: [] }
  const secondProgram = { ...structuredClone(parent), id: 'program-bridge-conflicted', slug: 'bridge-conflicted' }
  const secondCycle = { ...structuredClone(base.admissionCycles[0]!), id: 'cycle-bridge-conflicted', programId: secondProgram.id }
  base.programs.push(secondProgram); base.admissionCycles.push(secondCycle)
  const names = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
  const save = (bundle: typeof base) => { for (const [key, file] of Object.entries(names)) writeFileSync(join(data, file + '.json'), JSON.stringify(bundle[key as keyof typeof names])) }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
  git('init', '-q'); save(base); const baseCommit = commit()
  const live = structuredClone(base)
  live.sources.push({ ...structuredClone(live.sources[0]!), id: 'src-disjoint-editorial-addition' })
  live.programs[1]!.durationMonths = (live.programs[1]!.durationMonths ?? 0) + 1
  if (changedParent) live.programs[0]!.durationMonths = (live.programs[0]!.durationMonths ?? 0) + 1
  save(live); const liveCommit = commit()
  const download = join(root, 'download'), output = join(root, 'output')
  mkdirSync(join(download, 'artifacts'), { recursive: true })
  const school = scope.schools.find(row => row.universityId === parent.universityId)!
  const text = 'Autumn 2027 admissions for international students. Application deadline is 2027-09-30.'
  const bytes = new TextEncoder().encode(text), snapshotSha256 = sha(bytes), url = `https://${school.officialHosts[0]}/bridge.txt`
  writeFileSync(join(download, 'artifacts/source.txt'), bytes)
  const proposals: MaintenanceProposal[] = []
  for (const [index, cycle] of base.admissionCycles.entries()) {
    const evidence = { sourceId: 'bridge-source', url, snapshotSha256, objectKey: 'source.txt', locator: 'text:1', quote: text }
    const proposal: MaintenanceProposal = { id: index ? 'conflicted' : 'safe', universityId: school.universityId,
      entityType: 'admission-cycle', recordId: cycle.id, operation: 'patch', status: 'ready', warnings: [], extractionAttemptId: `extract-${index}`,
      fields: { recordScopeSha256: fieldRecordScopeSha256('admissionCycle', cycle), patches: [{ fieldPath: 'closesOn', value: '2027-09-30', factStatus: 'known' }] },
      source: { id: evidence.sourceId, url, snapshotSha256, objectKey: 'source.txt', checkedAt: capturedAt, contentType: 'text/plain', locator: 'text:1', quote: text },
      fieldEvidence: [{ ...evidence, fieldPath: 'closesOn' }, { ...evidence, fieldPath: '$scope' }], scope: { year: cycle.academicYear, intake: cycle.intake } }
    const candidateSha256 = await proposalContentSha256(proposal), reviewAttemptId = `review-${index}`
    const review = Buffer.from(JSON.stringify({ candidateSha256, reviewAttemptId, decision: 'approved', agreedFields: proposal.fields }))
    writeFileSync(join(download, `artifacts/review-${index}.json`), review)
    proposal.review = { decision: 'approved', reviewerId: `independent:${reviewAttemptId}`, method: 'independent_model', reviewedAt: capturedAt,
      candidateSha256, snapshotSha256, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true },
      reviewAttemptId, artifactKey: `review-${index}.json`, reviewArtifactSha256: sha(review) }
    proposals.push(proposal)
  }
  const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'bridge-export',
    inputCatalogSha256: await catalogSha256(base), scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals }
  const batch: CandidateExport = { ...content, sha256: await exportContentSha256(content) }
  const originalBytes = JSON.stringify(batch); writeFileSync(join(download, 'export.json'), originalBytes)
  const run = async () => {
    try { return await prepareMaintenanceCatalog({ root, downloadDirectory: download, outputDirectory: output, acceptedAt, apply: true,
      baselineBridge: { baseCommit, liveCommit } }) }
    catch (error) { if (error instanceof Error && existsSync(join(output, 'baseline-bridge-blocked.json')))
      error.message += ': ' + readFileSync(join(output, 'baseline-bridge-blocked.json'), 'utf8'); throw error }
  }
  return { root, data, output, download, baseCommit, liveCommit, batch, base, live, originalBytes, run, git, commit }
}

describe('publisher baseline bridge through ordinary consumers and recovery', () => {
  it('retains the original strict global input guard when no explicit Git bridge was requested', async () => {
    const f = await fixture()
    await expect(prepareMaintenanceCatalog({ root: f.root, downloadDirectory: f.download,
      outputDirectory: f.output, acceptedAt, apply: true })).rejects.toThrow('Candidate base catalogue changed')
    expect(existsSync(f.output)).toBe(false)
    expect(await catalogSha256(loadMaintenanceBundle(f.root))).toBe(await catalogSha256(f.live))
  }, 30_000)

  it('keeps the original export and uses the same original-ID partition through apply, ack, lost reply and replay', async () => {
    const f = await fixture(), result = await f.run(), receipt = result.receipt
    expect(receipt.acceptedProposalIds).toEqual(['safe'])
    expect(receipt.held).toEqual([{ proposalId: 'conflicted', reason: expect.stringContaining('dependency_changed:programs:') }])
    expect(receipt.inputCatalogSha256).toBe(f.batch.inputCatalogSha256)
    expect(receipt.applicationBaselineCatalogSha256).toBe(await catalogSha256(f.live))
    expect(receipt.batchSha256).toBe(f.batch.sha256)
    expect(readFileSync(join(f.download, 'export.json'), 'utf8')).toBe(f.originalBytes)
    expect(readFileSync(join(f.root, 'quality/maintenance/batches/bridge-export/source-export.json'), 'utf8')).toBe(f.originalBytes)
    verifyPublisherBaselineBridgeReceipt(f.root, receipt)
    const sourceCommit = f.commit(), calls: Array<{ path: string; body: Record<string, unknown> }> = []
    vi.stubEnv('CATALOG_MAINTENANCE_URL', 'https://fixture.example.workers.dev')
    vi.stubEnv('CATALOG_MAINTENANCE_TOKEN', 'fixture-token-with-more-than-thirty-two-characters')
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
      if (calls.length === 1) throw new Error('reply lost after durable server acknowledgement')
      return Response.json({ ok: true })
    }))
    await expect(acknowledgeCanonicalMaintenance(f.root, result.receiptPath, sourceCommit)).rejects.toThrow('maintenance_request_failed')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toMatchObject({ outcome: 'applied', acceptedProposalIds: ['safe'], heldProposalIds: ['conflicted'], newInputCatalogSha256: receipt.outputCatalogSha256 })
    const pending = { status: 'applied', batchId: f.batch.batchId, inputCatalogSha256: f.batch.inputCatalogSha256,
      scopeRegistrySha256: f.batch.scopeRegistrySha256, acknowledgement: calls[0]!.body }
    const recovery = await recoverPendingMaintenancePublication({ json: async () => ({ publications: [pending] }), artifact: async () => new Uint8Array() }, f.root)
    expect(recovery).toMatchObject({ batchId: f.batch.batchId, sourceCommit })
    await acknowledgeCanonicalMaintenance(f.root, result.receiptPath, sourceCommit)
    expect(calls.map(call => call.path)).toEqual(['/ack', '/ack', '/targets'])
    expect(calls[1]!.body).toEqual(calls[0]!.body)
    const replay = await prepareMaintenanceCatalog({ root: f.root, downloadDirectory: f.download, outputDirectory: join(f.root, 'replay-output'), acceptedAt, apply: true })
    expect(replay).toMatchObject({ replayed: true, changed: false })
    expect(existsSync(join(f.root, 'replay-output'))).toBe(false)
  }, 30_000)

  it('retains an all-conflicted proof without applying data, emitting a canonical receipt or acknowledging', async () => {
    const f = await fixture(true), before = await catalogSha256(loadMaintenanceBundle(f.root))
    await expect(f.run()).rejects.toThrow('maintenance_baseline_bridge_no_eligible_proposals')
    expect(await catalogSha256(loadMaintenanceBundle(f.root))).toBe(before)
    expect(existsSync(join(f.output, 'baseline-bridge.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(f.output, 'baseline-bridge-blocked.json'), 'utf8')).reason).toBe('no_eligible_proposals_no_acknowledgement')
    expect(existsSync(join(f.root, 'quality/maintenance/batches/bridge-export/canonical-receipt.json'))).toBe(false)
  }, 30_000)

  it('retains a blocked note when unchanged scope passes but the ordinary evidence consumer holds every eligible proposal', async () => {
    const f = await fixture(), before = await catalogSha256(loadMaintenanceBundle(f.root))
    writeFileSync(join(f.download, 'artifacts/source.txt'), 'tampered raw evidence')
    await expect(f.run()).rejects.toThrow('maintenance_baseline_bridge_no_accepted_changes')
    expect(await catalogSha256(loadMaintenanceBundle(f.root))).toBe(before)
    expect(JSON.parse(readFileSync(join(f.output, 'baseline-bridge-blocked.json'), 'utf8')).reason).toBe('no_accepted_changes_no_acknowledgement')
    expect(existsSync(join(f.root, 'quality/maintenance/batches/bridge-export/canonical-receipt.json'))).toBe(false)
  }, 30_000)

  it('blocks missing or tampered attachment bytes before an acknowledgement or lost-ack recovery', async () => {
    const f = await fixture(), result = await f.run(), sourceCommit = f.commit()
    const directory = join(f.root, 'quality/maintenance/batches/bridge-export')
    writeFileSync(join(directory, 'source-export.json'), f.originalBytes + '\n')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(acknowledgeCanonicalMaintenance(f.root, result.receiptPath, sourceCommit)).rejects.toThrow('source_bytes_changed')
    expect(fetcher).not.toHaveBeenCalled()
  }, 30_000)

  it('uses the unchanged Worker CAS acknowledgement to advance the original base exactly once', async () => {
    const f = await fixture(), result = await f.run(), sourceCommit = f.commit()
    // Keep the existing transactional D1 adapter. Load migrations by filesystem
    // path because Vite rewrites the fixture constructor's import.meta URLs.
    const nativeDb = Object.assign(Object.create(TestD1.prototype) as TestD1, { sqlite: new DatabaseSync(':memory:') })
    for (const file of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql'])
      nativeDb.sqlite.exec(readFileSync(join(process.cwd(), 'infra/d1/pipeline/migrations', file), 'utf8'))
    const bucket = new MemoryBucket()
    const env: MaintenanceEnv = { PIPELINE_DB: nativeDb, SNAPSHOTS_BUCKET: bucket,
      MAINTENANCE_QUEUE: { async send() { throw new Error('unexpected_queue_in_ack') } },
      MODEL_ADMISSION: { idFromName: name => name, get: () => ({ async fetch() { throw new Error('unexpected_model_in_ack') } }) } }
    const native = { db: nativeDb, bucket, env }
    try {
      const db = native.db.sqlite, batch = f.batch, receipt = result.receipt
      db.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
        enabled,models_enabled,seed_complete,targets_complete,revision,updated_at) VALUES(1,?,?,?, ?,1,1,1,1,90,?)`)
        .run(batch.scopeRegistrySha256, batch.inputCatalogSha256, 'b'.repeat(64), 'c'.repeat(64), capturedAt)
      db.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?,?,?,?)')
        .run(batch.proposals[0]!.universityId, '{}', '[]', batch.scopeRegistrySha256)
      for (const proposal of batch.proposals) db.prepare(`INSERT INTO maintenance_proposals(proposal_id,university_id,source_id,snapshot_sha256,status,proposal_json,created_at,export_id)
        VALUES(?,?,?,?,'exported',?,?,?)`).run(proposal.id, proposal.universityId, proposal.source.id, proposal.source.snapshotSha256, JSON.stringify(proposal), capturedAt, batch.batchId)
      const key = 'maintenance/exports/original.json'
      await native.bucket.put(key, canonicalJson(batch))
      db.prepare(`INSERT INTO maintenance_exports(batch_id,input_catalog_sha256,scope_sha256,object_key,sha256,created_at,status)
        VALUES(?,?,?,?,?,?,'prepared')`).run(batch.batchId, batch.inputCatalogSha256, batch.scopeRegistrySha256, key, batch.sha256, capturedAt)
      const body = { batchId: batch.batchId, outcome: 'applied', receiptSha256: receipt.sha256, sourceCommit,
        newInputCatalogSha256: receipt.outputCatalogSha256, acceptedProposalIds: receipt.acceptedProposalIds,
        heldProposalIds: receipt.held.map(row => row.proposalId), unchangedProposalIds: receipt.unchangedProposalIds }
      await expect(acknowledge(native.env, { ...body, outcome: 'rejected', acceptedProposalIds: [], heldProposalIds: batch.proposals.map(row => row.id) }))
        .rejects.toThrow('rejected_export_cannot_change_catalogue')
      expect(db.prepare('SELECT input_catalog_sha256 FROM maintenance_control').get()?.input_catalog_sha256).toBe(batch.inputCatalogSha256)
      await acknowledge(native.env, body)
      expect(db.prepare('SELECT input_catalog_sha256,revision,targets_complete,models_enabled FROM maintenance_control').get())
        .toMatchObject({ input_catalog_sha256: receipt.outputCatalogSha256, revision: 91, targets_complete: 0, models_enabled: 1 })
      expect(db.prepare('SELECT proposal_id,status FROM maintenance_proposals ORDER BY proposal_id').all())
        .toEqual([{ proposal_id: 'conflicted', status: 'held' }, { proposal_id: 'safe', status: 'consumed' }])
      expect((await acknowledge(native.env, body)).reused).toBe(true)
      expect(db.prepare('SELECT revision FROM maintenance_control').get()?.revision).toBe(91)
    } finally { native.db.sqlite.close() }
  }, 30_000)
})
