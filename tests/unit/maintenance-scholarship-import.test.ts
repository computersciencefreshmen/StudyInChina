import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { exportContentSha256, proposalContentSha256, type CandidateExport, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { importScholarshipIdentities } from '../../scripts/maintenance/import-scholarships'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectPublishedData } from '@/lib/data/publication'
import type { DataBundle } from '@/lib/data/types'

const acceptedAt = '2026-10-24T02:00:00.000Z', capturedAt = '2026-10-24T00:00:00.000Z'
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
let bundle: DataBundle, scope: MaintenanceScope
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  bundle = loadMaintenanceBundle(process.cwd())
  scope = await buildMaintenanceScope(bundle, { scopeId: 'scholarship-fixed-272', createdAt: capturedAt })
})
async function fixture(existingAward = false) {
  const existing = bundle.scholarships.find(record => record.status === 'stale' && record.providerType === 'university' && record.universityIds.length)!
  const school = scope.schools.find(school => school.universityId === existing.universityIds[0])!
  const name = existingAward ? Object.fromEntries(Object.entries(existing.name).filter(([locale, value]) => ['en', 'zh'].includes(locale) && value))
    : { en: 'Evidence Bound International Scholarship', zh: '证据约束国际生奖学金' }
  const text = `${school.name.en ?? school.name.zh} university provides ${Object.values(name).join(' ')} for international students applying to this institution.`
  const bytes = new TextEncoder().encode(text), snapshotSha256 = hash(bytes), url = `https://${school.officialHosts[0]}/scholarship-proof.txt`
  const proof = { sourceId: 'scholarship-fixture-source', url, snapshotSha256, objectKey: 'snapshots/scholarship.txt', locator: 'text:1', quote: text }
  const proposal: MaintenanceProposal = { id: 'award-proposal', universityId: school.universityId, entityType: 'scholarship', recordId: existingAward ? existing.id : null,
    operation: existingAward ? 'patch' : 'create', fields: { name, providerType: 'university', scholarshipUrl: url,
      internationalAdmissionsEvidence: proof, institutionEvidence: proof },
    source: { id: proof.sourceId, url, snapshotSha256, objectKey: proof.objectKey, checkedAt: capturedAt, contentType: 'text/plain', locator: proof.locator, quote: text },
    fieldEvidence: [...Object.keys(name).map(locale => `name.${locale}`), 'providerType'].map(fieldPath => ({ ...proof, fieldPath })),
    scope: { year: null, intake: null }, status: 'ready', warnings: [] }
  proposal.review = { decision: 'approved', reviewerId: 'human:independent-scholarship-review', method: 'human', reviewedAt: capturedAt,
    candidateSha256: await proposalContentSha256(proposal), snapshotSha256, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  const content: Omit<CandidateExport, 'sha256'> = { format: 'studyinchina.maintenance-candidate-export', formatVersion: 1, batchId: 'award-batch',
    inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals: [proposal] }
  const batch = { ...content, sha256: await exportContentSha256(content) }
  const artifacts = new Map<string, Uint8Array>([[proof.objectKey, bytes]])
  const run = (working = bundle, inputBundle?: DataBundle) => importScholarshipIdentities({ bundle: working, ...(inputBundle ? { inputBundle } : {}), scope, batch, acceptedAt,
    receiptPath: 'quality/award-receipt.json', readArtifact: async key => { const value = artifacts.get(key); if (!value) throw Error('Missing artifact'); return value } })
  return { batch, proposal, artifacts, run, existing, school }
}
async function reseal(batch: CandidateExport) {
  for (const proposal of batch.proposals) if (proposal.review) proposal.review.candidateSha256 = await proposalContentSha256(proposal)
  batch.sha256 = await exportContentSha256(batch)
}

describe('reviewed scholarship identity importing', () => {
  it('adds a discovery identity without inventing current funding, dates, qualification or a cycle', async () => {
    const f = await fixture(), before = JSON.stringify(bundle), result = await f.run()
    expect(result.receipt.held).toEqual([])
    expect(result.receipt.accepted).toHaveLength(1)
    expect(result.bundle.scholarships).toHaveLength(bundle.scholarships.length + 1)
    expect(result.bundle.scholarships.slice(0, bundle.scholarships.length)).toEqual(bundle.scholarships)
    expect(result.bundle.programs).toEqual(bundle.programs)
    expect(result.bundle.admissionCycles).toEqual(bundle.admissionCycles)
    const added = result.bundle.scholarships.at(-1)!
    expect(added).toMatchObject({ status: 'stale', deadline: null, applicationUrl: null, summary: null, programIds: [],
      coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null } })
    expect(selectPublishedData(result.bundle, '2026-10-24').scholarships.some(record => record.id === added.id)).toBe(false)
    expect(selectDiscoveryData(result.bundle, '2026-10-24', result.acceptances.entries).scholarships.some(record => record.id === added.id)).toBe(true)
    expect(JSON.stringify(bundle)).toBe(before)
  })

  it('preserves an existing award ID, slug, raw audit dates and historic values', async () => {
    const f = await fixture(true), result = await f.run()
    expect(result.receipt.held).toEqual([])
    expect(result.bundle.scholarships).toHaveLength(bundle.scholarships.length)
    const updated = result.bundle.scholarships.find(record => record.id === f.existing.id)!
    expect({ ...updated, sourceIds: f.existing.sourceIds }).toEqual(f.existing)
    expect(updated.sourceIds).toEqual(expect.arrayContaining(f.existing.sourceIds))
    expect(result.acceptances.entries[0].recordId).toBe(f.existing.id)
    expect(result.acceptances.entries[0].receiptSha256).toBe(result.receipt.sha256)
  })

  it('deduplicates a second reviewed proposal to the same stable identity', async () => {
    const f = await fixture(), second = structuredClone(f.proposal)
    second.id = 'same-award-different-proposal'
    f.batch.proposals.push(second)
    await reseal(f.batch)
    const result = await f.run()
    expect(result.receipt.accepted.map(row => row.action)).toEqual(['created', 'identity_accepted'])
    expect(result.bundle.scholarships).toHaveLength(bundle.scholarships.length + 1)
    expect(result.bindings.entries).toHaveLength(1)
  })

  it('binds a composed writer stage to the original input snapshot', async () => {
    const f = await fixture(), working = structuredClone(bundle)
    working.sources.push({ ...working.sources[0], id: 'intermediate-stage-source' })
    await expect(f.run(working)).rejects.toThrow('base catalogue changed')
    const result = await f.run(working, bundle)
    expect(result.receipt.accepted).toHaveLength(1)
    expect(result.bundle.sources.some(record => record.id === 'intermediate-stage-source')).toBe(true)
    expect(result.receipt.inputCatalogSha256).toBe(f.batch.inputCatalogSha256)
    expect(result.receipt.beforeCatalogSha256).not.toBe(result.receipt.inputCatalogSha256)
  })

  it.each(['missing-snapshot', 'missing-name', 'missing-institution', 'domestic', 'year', 'deterministic', 'wrong-url'])(
    'holds %s evidence without changing award facts', async kind => {
      const f = await fixture()
      if (kind === 'missing-snapshot') f.artifacts.clear()
      if (kind === 'missing-name') f.proposal.fieldEvidence = f.proposal.fieldEvidence.filter(field => !field.fieldPath.startsWith('name.'))
      if (kind === 'missing-institution') (f.proposal.fields.institutionEvidence as { quote: string }).quote = 'Unrelated University'
      if (kind === 'domestic') (f.proposal.fields.internationalAdmissionsEvidence as { quote: string }).quote = f.school.name.en ?? f.school.name.zh
      if (kind === 'year') f.proposal.scope.year = '2027'
      if (kind === 'deterministic') f.proposal.review!.method = 'deterministic'
      if (kind === 'wrong-url') f.proposal.fields.scholarshipUrl = 'https://outside.invalid/scholarship'
      await reseal(f.batch)
      const result = await f.run()
      expect(result.receipt.accepted).toEqual([])
      expect(result.receipt.held).toHaveLength(1)
      expect(result.bundle.scholarships).toEqual(bundle.scholarships)
      expect(result.acceptances.entries).toEqual([])
    })

  it('never promotes a draft identity or attaches a global award to an unproven school', async () => {
    const f = await fixture(true), original = structuredClone(bundle)
    original.scholarships.find(record => record.id === f.existing.id)!.status = 'draft'
    f.batch.inputCatalogSha256 = await catalogSha256(original)
    await reseal(f.batch)
    const result = await f.run(original)
    expect(result.receipt.held[0].reason).toBe('draft_or_archived_identity_requires_separate_promotion')
    expect(result.bundle.scholarships.find(record => record.id === f.existing.id)?.status).toBe('draft')
  })
})
