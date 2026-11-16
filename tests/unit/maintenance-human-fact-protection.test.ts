import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { automaticFieldPatchHoldReason, importFieldCandidates } from '../../scripts/maintenance/import-fields'
import { exportContentSha256, proposalContentSha256, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256, fieldVerificationContentSha256, type FieldVerification } from '../../src/lib/data/field-verification'
import type { DataBundle } from '../../src/lib/data/types'

const capturedAt = '2026-11-14T08:00:00.000Z', acceptedAt = '2026-11-14T09:00:00.000Z'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
let original: DataBundle, scope: MaintenanceScope
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  original = loadMaintenanceBundle(process.cwd())
  scope = await buildMaintenanceScope(original, { scopeId: 'human-field-protection', createdAt: capturedAt })
})

async function fixture(options: { existing?: string | null; field?: 'applyUrl' | 'languageRequirements'; method?: 'human' | 'independent_model' } = {}) {
  const program = structuredClone(original.programs.find(p => p.id === 'program-tsinghua-university-computer-science-bachelor')!)
  program.applyUrl = options.existing === undefined ? null : options.existing
  program.languageRequirements = []
  program.teachingLanguages = ['Chinese']
  const bundle: DataBundle = { ...original, programs: [program], admissionCycles: [], scholarships: [] }
  const fieldPath = options.field ?? 'applyUrl', value = fieldPath === 'applyUrl' ? 'https://international.join-tsinghua.edu.cn/apply/' : [{ test: 'HSK', minimum: 'Level 5' }]
  const text = 'Computer Science and Technology: official international bachelor admissions. Apply at https://international.join-tsinghua.edu.cn/apply/. HSK Level 5 is required.'
  const snapshot = sha(text), url = 'https://international.join-tsinghua.edu.cn/protection-test.txt'
  const source = { id: 'protected-field-source', url, snapshotSha256: snapshot, objectKey: 'source.txt', checkedAt: capturedAt, contentType: 'text/plain', quote: text, locator: 'text:document' }
  const evidence = { sourceId: source.id, url, snapshotSha256: snapshot, objectKey: source.objectKey, quote: text, locator: source.locator }
  const proposal: MaintenanceProposal = { id: 'protection-proposal', universityId: program.universityId, entityType: 'program', operation: 'patch', recordId: program.id,
    fields: { recordScopeSha256: fieldRecordScopeSha256('program', program), patches: [{ fieldPath, value, factStatus: 'known' }] }, source,
    fieldEvidence: [{ ...evidence, fieldPath }, { ...evidence, fieldPath: '$applicability' }], scope: { year: null, intake: null }, extractionAttemptId: 'primary-test', status: 'ready', warnings: [] }
  const artifacts = new Map<string, Uint8Array>([['source.txt', new TextEncoder().encode(text)]])
  const seal = async (method = options.method ?? 'independent_model') => {
    const candidateSha256 = await proposalContentSha256(proposal)
    const review = JSON.stringify({ candidateSha256, reviewAttemptId: 'review-test', decision: 'approved', agreedFields: proposal.fields })
    artifacts.set('review.json', new TextEncoder().encode(review))
    proposal.review = { method, decision: 'approved', reviewerId: method === 'human' ? 'human:operator' : 'independent:review-test', reviewedAt: capturedAt,
      candidateSha256, snapshotSha256: snapshot, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true },
      ...(method === 'independent_model' ? { reviewAttemptId: 'review-test', artifactKey: 'review.json', reviewArtifactSha256: sha(review) } : {}) }
  }
  await seal()
  const run = async (input = bundle, entries: FieldVerification[] = [], proposals = [proposal]) => {
    const batch = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'protection-batch', inputCatalogSha256: await catalogSha256(input),
      scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals, sha256: '0'.repeat(64) }
    batch.sha256 = await exportContentSha256(batch)
    return importFieldCandidates({ bundle: input, scope, batch, entries, acceptedAt, receiptPath: 'quality/human-protection.json', readArtifact: async key => artifacts.get(key)! })
  }
  return { bundle, proposal, run, seal, value }
}

describe('automatic field protection at the canonical importer', () => {
  it('fills a genuinely empty validated leaf and an empty array', async () => {
    for (const field of ['applyUrl', 'languageRequirements'] as const) {
      const f = await fixture({ field }), result = await f.run()
      expect(result.receipt.held).toEqual([]); expect(result.receipt.accepted).toHaveLength(1)
      expect(result.bundle.programs[0][field]).toEqual(f.value)
      expect(result.bundle.programs[0].verifiedAt).toBe(f.bundle.programs[0].verifiedAt)
    }
  })
  it.each([
    ['https://international.join-tsinghua.edu.cn/old-reviewed/', 'field_existing_value_requires_human_review:applyUrl'],
    ['https://international.join-tsinghua.edu.cn/apply/', 'field_existing_same_value_preserved:applyUrl'],
  ])('preserves legacy nonempty facts and metadata for %s', async (existing, reason) => {
    const f = await fixture({ existing }), before = structuredClone(f.bundle), result = await f.run()
    expect(result.receipt.held).toEqual([{ proposalId: f.proposal.id, reason }]); expect(result.receipt.accepted).toEqual([])
    expect(result.bundle).toEqual(before); expect(result.entries).toEqual([])
    expect(result.receipt.outputCatalogSha256).toBe(result.receipt.inputCatalogSha256)
  })
  it('never replaces a current human receipt, including equal values, hashes and timestamps', async () => {
    const manual = await fixture({ method: 'human' }), first = await manual.run(), oldEntry = structuredClone(first.entries[0])
    expect(oldEntry.review.method).toBe('independent')
    const model = await fixture(), result = await model.run(first.bundle, first.entries)
    expect(result.receipt.held[0].reason).toBe('field_human_review_requires_manual_change:applyUrl')
    expect(result.bundle).toEqual(first.bundle); expect(result.entries).toEqual(first.entries)
    expect(fieldVerificationContentSha256(result.entries[0])).toBe(fieldVerificationContentSha256(oldEntry))
    expect(result.entries[0].verifiedAt).toBe(oldEntry.verifiedAt); expect(result.entries[0].receiptSha256).toBe(oldEntry.receiptSha256)
  })
  it('preserves even an expired human receipt rather than silently replacing its provenance', async () => {
    const manual = await fixture({ method: 'human' }), first = await manual.run()
    first.entries[0].verifiedAt = '2026-10-01T00:00:00.000Z'; first.entries[0].reviewAfter = '2026-10-02'
    const model = await fixture(), result = await model.run(first.bundle, first.entries)
    expect(result.receipt.held[0].reason).toBe('field_human_review_requires_manual_change:applyUrl')
    expect(result.entries).toEqual(first.entries); expect(result.bundle).toEqual(first.bundle)
  })
  it('also protects a human fact staged earlier in the same candidate batch', async () => {
    const manual = await fixture({ method: 'human' }), model = await fixture()
    manual.proposal.id = 'first-human'; await manual.seal('human')
    model.proposal.id = 'second-model'; await model.seal()
    const result = await model.run(manual.bundle, [], [manual.proposal, model.proposal])
    expect(result.receipt.accepted.map(p => p.proposalId)).toEqual(['first-human'])
    expect(result.receipt.held).toEqual([{ proposalId: 'second-model', reason: 'field_human_review_requires_manual_change:applyUrl' }])
    expect(result.entries).toHaveLength(1); expect(result.entries[0].review.method).toBe('independent')
  })
  it('keeps the explicitly human-reviewed change path, with evidence validation intact', async () => {
    const f = await fixture({ existing: 'https://international.join-tsinghua.edu.cn/old/', method: 'human' }), result = await f.run()
    expect(result.receipt.held).toEqual([]); expect(result.receipt.accepted).toHaveLength(1)
    expect(result.bundle.programs[0].applyUrl).toBe(f.value); expect(result.entries[0].review.method).toBe('independent')
  })
  it('does not treat deterministic or unknown review methods as a manual authorization', async () => {
    const f = await fixture({ existing: 'https://international.join-tsinghua.edu.cn/old/' })
    f.proposal.review!.method = 'deterministic'
    expect((await f.run()).receipt.held[0].reason).toBe('independent_field_review_required')
    Object.assign(f.proposal.review!, { method: 'unknown-review-method' })
    await expect(f.run()).rejects.toThrow()
  })
})

describe('empty means missing, not a falsy or structured existing fact', () => {
  it.each([0, false, ['existing'], { en: 'Human-reviewed' }, { en: null }])('protects %j', value => {
    expect(automaticFieldPatchHoldReason(value, 'different', false)).toBe('field_existing_value_requires_human_review')
  })
  it.each([undefined, null, '', '  ', [], {}])('permits filling %j', value => {
    expect(automaticFieldPatchHoldReason(value, 'new value', false)).toBeNull()
    expect(automaticFieldPatchHoldReason(value, 'new value', true)).toBe('field_human_review_requires_manual_change')
  })
})
