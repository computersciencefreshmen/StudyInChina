import { describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { buildPublisherBaselineBridge, preparePublisherBaselineBridge } from '../../scripts/maintenance/publisher-baseline-bridge'
import { canonicalJson, exportContentSha256, sha256Text, type CandidateExport, type MaintenanceProposal } from '../../scripts/maintenance/contracts'

const names = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
const full = bundleSchema.parse(Object.fromEntries(Object.entries(names).map(([key, file]) => [key,
  JSON.parse(readFileSync(`content/data/${file}.json`, 'utf8'))])))
const cycle = full.admissionCycles[0]!, program = full.programs.find(row => row.id === cycle.programId)!
const university = full.universities.find(row => row.id === program.universityId)!, city = full.cities.find(row => row.id === university.cityId)!
const sources = new Set([cycle, program, university, city].flatMap(row => row.sourceIds))
const fixture: DataBundle = { sources: full.sources.filter(row => sources.has(row.id)), cities: [city], universities: [university],
  programs: [program], admissionCycles: [cycle], scholarships: [] }
const audits = () => Object.fromEntries(['identity-acceptances', 'identity-bindings', 'field-verifications'].map(name => [name, { entries: [] }]))
const proposal = (changes: Partial<MaintenanceProposal> = {}): MaintenanceProposal => ({
  id: 'proposal-one', universityId: university.id, entityType: 'program', recordId: program.id, operation: 'patch', fields: {},
  source: { id: 'source-one', url: 'https://example.edu.cn/evidence', snapshotSha256: 'a'.repeat(64), objectKey: 'source/raw',
    locator: 'paragraph', quote: 'literal', checkedAt: '2026-11-22T00:00:00Z', contentType: 'text/html' },
  fieldEvidence: [{ fieldPath: 'applicationMaterials', sourceId: 'source-one', url: 'https://example.edu.cn/evidence',
    snapshotSha256: 'a'.repeat(64), objectKey: 'source/raw', locator: 'paragraph', quote: 'literal' }],
  scope: { year: null, intake: null }, status: 'ready', warnings: [], ...changes,
})
async function batch(base = fixture, proposals = [proposal()]): Promise<CandidateExport> {
  const value = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'original-batch',
    inputCatalogSha256: await sha256Text(canonicalJson(base)), scopeRegistrySha256: 'b'.repeat(64), createdAt: '2026-11-22T00:00:00Z', proposals,
    sha256: '0'.repeat(64) }
  return { ...value, sha256: await exportContentSha256(value) }
}
const options = (originalBatch: CandidateExport, live: DataBundle) => ({ originalBatch, base: structuredClone(fixture), live,
  baseCommit: '1'.repeat(40), liveCommit: '2'.repeat(40), baseAudits: audits(), liveAudits: audits() })

describe('explicit publisher baseline bridge validation view', () => {
  it('preserves the immutable original and independently hashes a disjoint live validation view', async () => {
    const original = await batch(), bytes = canonicalJson(original), live = structuredClone(fixture)
    live.programs.push({ ...structuredClone(program), id: 'program-disjoint-addition', slug: 'disjoint-addition' })
    const result = await buildPublisherBaselineBridge(options(original, live))
    expect(canonicalJson(original)).toBe(bytes)
    expect(result.validationBatch.batchId).toBe(original.batchId)
    expect(result.validationBatch.proposals).toEqual(original.proposals)
    expect(result.validationBatch.inputCatalogSha256).toBe(await sha256Text(canonicalJson(live)))
    expect(result.validationBatch.sha256).toBe(await exportContentSha256(result.validationBatch))
    expect(result.proof.sourceBatchSha256).toBe(original.sha256)
    expect(result.proof.validationBatchSha256).not.toBe(original.sha256)
    expect(result.proof.acceptanceAuthorized).toBe(false)
    expect(result.proof.hasEligibleProposals).toBe(true)
    expect(result.proof.canApply).toBe(false)
    expect(result.proof.gitBindingVerified).toBe(false)
  })

  it('holds changed records and child cycles instead of overwriting a later editorial update', async () => {
    const original = await batch(fixture, [proposal(), proposal({ id: 'child-cycle', entityType: 'admission-cycle', recordId: cycle.id })])
    const live = structuredClone(fixture)
    live.programs[0]!.durationMonths = (live.programs[0]!.durationMonths ?? 0) + 1
    const result = await buildPublisherBaselineBridge(options(original, live))
    expect(result.proof.held).toHaveLength(2)
    expect(result.validationBatch.proposals).toEqual([])
    expect(result.proof.canApply).toBe(false)
  })

  it('holds changed parent source authority even when the program row is unchanged', async () => {
    const original = await batch(), live = structuredClone(fixture)
    const source = live.sources.find(row => program.sourceIds.includes(row.id))!
    source.url = 'https://other.edu.cn/revised-authority'
    const result = await buildPublisherBaselineBridge(options(original, live))
    expect(result.proof.held[0]?.reason).toContain('dependency_changed:sources:')
  })

  it('holds a newly human-reviewed target ledger rather than treating the same identity as unchanged', async () => {
    const original = await batch(), input = options(original, structuredClone(fixture))
    input.liveAudits['field-verifications']!.entries.push({ recordId: program.id, fieldPath: 'applicationMaterials', review: { method: 'independent' } } as never)
    const result = await buildPublisherBaselineBridge(input)
    expect(result.proof.held[0]?.reason).toContain('audit_changed:field-verifications')
  })

  it('blocks identity creates whose live school inventory changed and allows unrelated school additions', async () => {
    const original = await batch(fixture, [proposal({ operation: 'create', recordId: null })])
    const unchanged = await buildPublisherBaselineBridge(options(original, structuredClone(fixture)))
    expect(unchanged.proof.hasEligibleProposals).toBe(true)
    const live = structuredClone(fixture)
    live.programs.push({ ...structuredClone(program), id: 'program-new-peer', slug: 'new-peer' })
    expect((await buildPublisherBaselineBridge(options(original, live))).proof.held[0]?.reason).toContain('inventory_changed:programs')
  })

  it('blocks cycle creates if a live cycle was added for its parent', async () => {
    const original = await batch(fixture, [proposal({ operation: 'create', recordId: null, entityType: 'admission-cycle', fields: { programId: program.id } })])
    const live = structuredClone(fixture)
    live.admissionCycles.push({ ...structuredClone(cycle), id: 'cycle-new-round' })
    expect((await buildPublisherBaselineBridge(options(original, live))).proof.held[0]?.reason).toContain('inventory_changed:admissionCycles')
  })

  it('rejects deletions, duplicate IDs, forged original hashes and incorrect old baselines', async () => {
    const original = await batch(), removed = structuredClone(fixture), duplicate = structuredClone(fixture)
    removed.programs = []; duplicate.programs.push(structuredClone(program))
    await expect(buildPublisherBaselineBridge(options(original, removed))).rejects.toThrow('record_removed')
    await expect(buildPublisherBaselineBridge(options(original, duplicate))).rejects.toThrow('duplicate_record_id')
    await expect(buildPublisherBaselineBridge(options({ ...original, sha256: 'f'.repeat(64) }, fixture))).rejects.toThrow('export_checksum_invalid')
    const changedBase = structuredClone(fixture); changedBase.programs[0]!.durationMonths = 17
    await expect(buildPublisherBaselineBridge({ ...options(original, fixture), base: changedBase })).rejects.toThrow('base_catalogue_mismatch')
  })

  it('keeps safe and conflicted proposals separately, with the exact original partition', async () => {
    const original = await batch(fixture, [proposal(), proposal({ id: 'already-held', status: 'held' })])
    const result = await buildPublisherBaselineBridge(options(original, structuredClone(fixture)))
    expect(result.validationBatch.proposals.map(row => row.id)).toEqual(['proposal-one'])
    expect(result.proof.held.map(row => row.proposalId)).toEqual(['already-held'])
    expect([...result.proof.eligible.map(row => row.proposalId), ...result.proof.held.map(row => row.proposalId)].sort())
      .toEqual(original.proposals.map(row => row.id).sort())
  })

  it('requires committed ancestry and exact working data and audit bytes before making a usable proof', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sic-baseline-bridge-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
    const data = join(root, 'content', 'data'); mkdirSync(data, { recursive: true })
    const save = (bundle: DataBundle) => {
      for (const [key, file] of Object.entries(names)) writeFileSync(join(data, file + '.json'), JSON.stringify(bundle[key as keyof DataBundle]))
    }
    const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
    git('init', '-q'); save(fixture)
    for (const name of Object.keys(audits())) writeFileSync(join(data, name + '.json'), JSON.stringify({ schemaVersion: 1, entries: [] }))
    const baseCommit = commit(), original = await batch(), live = structuredClone(fixture)
    live.programs.push({ ...structuredClone(program), id: 'program-committed-addition', slug: 'committed-addition' })
    save(live); const liveCommit = commit()
    const input = { root, originalBatch: original, baseCommit, liveCommit }
    const clean = await preparePublisherBaselineBridge(input)
    expect(clean.proof.gitBindingVerified).toBe(true)
    expect(clean.proof.canApply).toBe(true)
    const { sha256, ...proof } = clean.proof
    expect(sha256).toBe(await sha256Text(canonicalJson(proof)))
    await expect(preparePublisherBaselineBridge({ ...input, liveCommit: baseCommit })).rejects.toThrow('live_commit_changed')
    live.programs[0]!.durationMonths = 17; save(live)
    await expect(preparePublisherBaselineBridge(input)).rejects.toThrow('working_catalogue_changed')
    git('checkout', '--', 'content/data/programs.json')
    writeFileSync(join(data, 'field-verifications.json'), JSON.stringify({ schemaVersion: 1, entries: [{ recordId: program.id }] }))
    await expect(preparePublisherBaselineBridge(input)).rejects.toThrow('working_audit_changed')
    git('checkout', '--', 'content/data/field-verifications.json')
    git('checkout', '--orphan', 'unrelated'); const unrelated = commit()
    await expect(preparePublisherBaselineBridge({ ...input, liveCommit: unrelated })).rejects.toThrow('ancestry_invalid')
  })

  it('retains literal source-export bytes through a Git checkout configured for CRLF', () => {
    const root = mkdtempSync(join(tmpdir(), 'sic-bridge-line-endings-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init', '-q')
    writeFileSync(join(root, '.gitattributes'), readFileSync('.gitattributes'))
    const file = 'quality/maintenance/batches/example/source-export.json'
    mkdirSync(join(root, 'quality/maintenance/batches/example'), { recursive: true })
    const bytes = Buffer.from('{"literal":"original source export"}\n')
    writeFileSync(join(root, file), bytes)
    git('-c', 'core.autocrlf=true', 'add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
    expect(git('-c', 'core.autocrlf=true', 'cat-file', '--filters', `HEAD:${file}`)).toEqual(bytes)
  })
})
