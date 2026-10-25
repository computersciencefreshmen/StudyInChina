import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { importIdentityCandidates, type IdentityBindings } from '../../scripts/maintenance/import-identities'
import { importScholarshipIdentities } from '../../scripts/maintenance/import-scholarships'
import { exportContentSha256, proposalContentSha256, type CandidateExport, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import type { IdentityAcceptanceLedger } from '../../src/lib/data/identity-acceptance'
import type { DataBundle } from '../../src/lib/data/types'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const firstTime = '2026-10-24T02:00:00.000Z', laterTime = '2026-10-25T02:00:00.000Z'
let base: DataBundle, scope: MaintenanceScope
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  const raw = loadMaintenanceBundle(process.cwd())
  scope = await buildMaintenanceScope(raw, { scopeId: 'identity-noop-272', createdAt: '2026-10-24T00:00:00.000Z' })
  base = { ...raw, programs: [], admissionCycles: [], scholarships: [] }
})

async function setup(kind: 'program' | 'scholarship') {
  const school = scope.schools.find(school => school.originalStatus === 'verified')!
  const url = `https://${school.officialHosts[0]}/${kind}-identity.html`
  const name = kind === 'program' ? { en: 'Evidence Bound Computing', zh: '证据计算' }
    : { en: 'Evidence Bound University Scholarship', zh: '证据大学奖学金' }
  const text = `${school.name.en ?? school.name.zh} university: ${name.en} ${name.zh}. Master EBC001. International students may apply individually.`
  const raw = `<main>${text}</main>`, bytes = new TextEncoder().encode(raw)
  const evidence = { sourceId: 'fixture-source', url, snapshotSha256: hash(bytes), objectKey: 'snapshots/first.html', locator: 'text:document', quote: text }
  const fields = kind === 'program' ? { name, degreeLevel: 'master', programType: 'degree', programUrl: url, officialProgramCode: 'EBC001', internationalAdmissionsEvidence: evidence }
    : { name, providerType: 'university', scholarshipUrl: url, internationalAdmissionsEvidence: evidence, institutionEvidence: evidence }
  const paths = kind === 'program' ? ['name.en', 'name.zh', 'degreeLevel', 'officialProgramCode'] : ['name.en', 'name.zh', 'providerType']
  const proposal: MaintenanceProposal = { id: 'identity-first', universityId: school.universityId, entityType: kind, recordId: null, operation: 'create', fields,
    source: { id: evidence.sourceId, url, snapshotSha256: evidence.snapshotSha256, objectKey: evidence.objectKey, checkedAt: '2026-10-24T00:00:00.000Z',
      contentType: 'text/html', locator: evidence.locator, quote: text }, fieldEvidence: paths.map(fieldPath => ({ ...evidence, fieldPath })),
    scope: { year: null, intake: null }, status: 'ready', warnings: [] }
  const artifacts = new Map<string, Uint8Array>([[evidence.objectKey, bytes]])
  const batch: CandidateExport = { format: 'studyinchina.maintenance-candidate-export', formatVersion: 1, batchId: 'first-batch',
    inputCatalogSha256: await catalogSha256(base), scopeRegistrySha256: scope.sha256, createdAt: firstTime, proposals: [proposal], sha256: '0'.repeat(64) }
  const seal = async (working: DataBundle) => {
    proposal.review = { decision: 'approved', method: 'human', reviewerId: 'independent:fixture-human', reviewedAt: proposal.source.checkedAt,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: proposal.source.snapshotSha256,
      checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
    batch.inputCatalogSha256 = await catalogSha256(working); batch.sha256 = await exportContentSha256(batch)
  }
  const run = (working: DataBundle, acceptances?: IdentityAcceptanceLedger, bindings?: IdentityBindings, acceptedAt = firstTime) => {
    const options = { bundle: working, scope, batch, acceptedAt, receiptPath: `quality/${batch.batchId}.json`, acceptances, bindings,
      readArtifact: async (key: string) => { const value = artifacts.get(key); if (!value) throw Error('Artifact missing'); return value } }
    return kind === 'program' ? importIdentityCandidates(options) : importScholarshipIdentities(options)
  }
  await seal(base)
  const first = await run(base)
  expect(first.receipt.accepted).toHaveLength(1)
  const next = async (working: DataBundle, newUrl = url) => {
    batch.batchId = 'different-later-batch'; batch.createdAt = laterTime; proposal.id = 'identity-later'
    proposal.recordId = first.receipt.accepted[0].recordId; proposal.operation = 'patch'
    const nextBytes = new TextEncoder().encode(`<nav>Updated navigation and footer</nav><main>${text}</main>`)
    const key = 'snapshots/new-navigation.html', snapshotSha256 = hash(nextBytes)
    artifacts.set(key, nextBytes)
    Object.assign(proposal.source, { url: newUrl, objectKey: key, snapshotSha256, checkedAt: '2026-10-25T00:00:00.000Z' })
    for (const proof of proposal.fieldEvidence) Object.assign(proof, { url: newUrl, objectKey: key, snapshotSha256 })
    for (const name of ['internationalAdmissionsEvidence', 'institutionEvidence']) {
      const proof = proposal.fields[name]
      if (proof && typeof proof === 'object') Object.assign(proof, { url: newUrl, objectKey: key, snapshotSha256 })
    }
    if (kind === 'program') proposal.fields.programUrl = newUrl
    else proposal.fields.scholarshipUrl = newUrl
    await seal(working)
  }
  return { first, next, run, proposal, batch, artifacts, url }
}

describe('identity observation without a semantic catalogue change', () => {
  it.each(['program', 'scholarship'] as const)('does not renew %s metadata for a different batch and new navigation bytes at the same official URL', async kind => {
    const f = await setup(kind); await f.next(f.first.bundle)
    const result = await f.run(f.first.bundle, f.first.acceptances, f.first.bindings, laterTime)
    expect(result.receipt.accepted).toEqual([]); expect(result.receipt.held).toEqual([])
    expect(result.receipt.unchanged).toEqual([{ proposalId: 'identity-later', recordId: f.first.receipt.accepted[0].recordId, reason: 'identity_and_official_source_unchanged' }])
    expect(result.bundle).toEqual(f.first.bundle)
    expect(result.acceptances).toEqual(f.first.acceptances)
    expect(result.bindings).toEqual(f.first.bindings)
    f.artifacts.set(f.proposal.source.objectKey, new TextEncoder().encode('tampered after review'))
    const tampered = await f.run(f.first.bundle, f.first.acceptances, f.first.bindings, laterTime)
    expect(tampered.receipt.unchanged).toEqual([])
    expect(tampered.receipt.held[0].reason).toBe('source_snapshot_checksum_mismatch')
  })
  it.each(['program', 'scholarship'] as const)('accepts a new official %s evidence URL once, exposes the source link, then treats its next repeat as unchanged', async kind => {
    const f = await setup(kind), newUrl = f.url.replace('.html', '-new-official-entry.html')
    await f.next(f.first.bundle, newUrl)
    const result = await f.run(f.first.bundle, f.first.acceptances, f.first.bindings, laterTime)
    expect(result.receipt.accepted).toHaveLength(1); expect(result.receipt.unchanged).toEqual([])
    const before = kind === 'program' ? f.first.bundle.programs[0] : f.first.bundle.scholarships[0]
    const after = kind === 'program' ? result.bundle.programs[0] : result.bundle.scholarships[0]
    expect({ ...after, sourceIds: before.sourceIds }).toEqual(before)
    expect(after.sourceIds.some(id => result.bundle.sources.some(source => source.id === id && source.url === newUrl && source.official))).toBe(true)
    f.batch.batchId = 'third-repeat-batch'; f.proposal.id = 'identity-third'; f.batch.inputCatalogSha256 = await catalogSha256(result.bundle)
    f.proposal.review!.candidateSha256 = await proposalContentSha256(f.proposal); f.batch.sha256 = await exportContentSha256(f.batch)
    const repeated = await f.run(result.bundle, result.acceptances, result.bindings, laterTime)
    expect(repeated.receipt.unchanged).toHaveLength(1)
    expect(repeated.acceptances).toEqual(result.acceptances)
  })
  it('requires an actually valid prior identity fingerprint before suppressing a new acceptance', async () => {
    const f = await setup('program'); await f.next(f.first.bundle)
    const invalid = structuredClone(f.first.acceptances); invalid.entries[0].identitySha256 = '0'.repeat(64)
    const result = await f.run(f.first.bundle, invalid, f.first.bindings, laterTime)
    expect(result.receipt.accepted).toHaveLength(1)
    expect(result.receipt.unchanged).toEqual([])
    expect(result.acceptances.entries[0].identitySha256).toBe(f.first.acceptances.entries[0].identitySha256)
  })
})
