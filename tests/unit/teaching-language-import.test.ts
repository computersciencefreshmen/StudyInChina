import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { importFieldCandidates } from '../../scripts/maintenance/import-fields'
import { exportContentSha256, proposalContentSha256, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256 } from '../../src/lib/data/field-verification'
import type { DataBundle } from '../../src/lib/data/types'

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const capturedAt = '2026-11-14T08:04:53.044Z', acceptedAt = '2026-11-14T11:00:00.000Z'
const actualTitle = 'Divisions (Chinese and English Programs)'
const actualApplicability = 'Computer Science Department of Computer Science and Technology Computer Science and Technology Physics'
let bundle: DataBundle, scope: MaintenanceScope
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  const original = loadMaintenanceBundle(process.cwd()), program = original.programs.find(p => p.id === 'program-tsinghua-university-computer-science-bachelor')!
  scope = await buildMaintenanceScope(original, { scopeId: 'teaching-language-tests', createdAt: capturedAt })
  bundle = { ...original, programs: [program], admissionCycles: [], scholarships: [] }
})
async function importQuote(quote: string, applicability = actualApplicability) {
  const program = bundle.programs[0], text = `${quote}\n${applicability}`, snapshot = sha(text)
  const source = { id: 'official-divisions-test', url: 'https://international.join-tsinghua.edu.cn/Divisions1.htm', snapshotSha256: snapshot, objectKey: 'public-source.txt', checkedAt: capturedAt, contentType: 'text/plain', quote: applicability, locator: 'text:document' }
  const evidence = { sourceId: source.id, url: source.url, snapshotSha256: snapshot, objectKey: source.objectKey, locator: source.locator }
  const proposal: MaintenanceProposal = { id: 'maintenance-field-198c9371b2e7b01658b366f9b82d6e06593ff9947e241a8d454f0e4309df5b0c', universityId: program.universityId, entityType: 'program', operation: 'patch', recordId: program.id,
    fields: { recordScopeSha256: fieldRecordScopeSha256('program', program), patches: [{ fieldPath: 'teachingLanguages', value: ['Chinese', 'English'], factStatus: 'known' }] },
    source, fieldEvidence: [{ ...evidence, fieldPath: 'teachingLanguages', quote }, { ...evidence, fieldPath: '$applicability', quote: applicability }],
    scope: { year: null, intake: null }, extractionAttemptId: 'extract-test-attempt', status: 'ready', warnings: [] }
  const candidateSha256 = await proposalContentSha256(proposal)
  const review = JSON.stringify({ candidateSha256, reviewAttemptId: 'independent-test-attempt', decision: 'approved', agreedFields: proposal.fields })
  proposal.review = { method: 'independent_model', decision: 'approved', reviewerId: 'independent:test', reviewedAt: '2026-11-14T08:25:08.929Z', candidateSha256, snapshotSha256: snapshot,
    checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true }, reviewAttemptId: 'independent-test-attempt', artifactKey: 'review.json', reviewArtifactSha256: sha(review) }
  const batch = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'teaching-language-batch', inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256,
    createdAt: capturedAt, proposals: [proposal], sha256: '0'.repeat(64) }
  batch.sha256 = await exportContentSha256(batch)
  const artifacts = new Map([['public-source.txt', new TextEncoder().encode(text)], ['review.json', new TextEncoder().encode(review)]])
  return importFieldCandidates({ bundle, scope, batch, acceptedAt, receiptPath: 'quality/test-teaching-language.json', readArtifact: async key => { const bytes = artifacts.get(key); if (!bytes) throw new Error('missing fixture'); return bytes } })
}
describe('canonical import rejects a previously ready mixed-directory language leaf', () => {
  it('holds the actual title/separate-applicability pattern without renewing an audit or accepting a field receipt', async () => {
    const before = JSON.stringify(bundle), result = await importQuote(actualTitle)
    expect(result.receipt.accepted).toEqual([])
    expect(result.receipt.held).toEqual([{ proposalId: 'maintenance-field-198c9371b2e7b01658b366f9b82d6e06593ff9947e241a8d454f0e4309df5b0c', reason: 'program_teaching_language_scope_unproven' }])
    expect(result.entries).toEqual([]); expect(JSON.stringify(result.bundle)).toBe(before)
    expect(result.receipt.outputCatalogSha256).toBe(result.receipt.inputCatalogSha256)
  })
  it.each([
    'Computer Science and Technology is taught in Chinese and English.',
    'All undergraduate programmes listed here, including Computer Science and Technology, are taught in Chinese and English.',
  ])('accepts a truly scoped, independently reviewed statement: %s', async quote => {
    const result = await importQuote(quote, quote)
    expect(result.receipt.held).toEqual([]); expect(result.receipt.accepted).toHaveLength(1)
    expect(result.entries).toHaveLength(1); expect(result.entries[0].quote).toBe(quote)
    expect(result.bundle.programs[0].reviewAfter).toBe(bundle.programs[0].reviewAfter)
  })
  it('does not borrow another programme statement or an unproved all-programmes policy', async () => {
    for (const quote of ['Physics is taught in Chinese and English.', 'All programmes are taught in Chinese and English.']) {
      const result = await importQuote(quote)
      expect(result.receipt.accepted).toEqual([]); expect(result.receipt.held[0].reason).toBe('program_teaching_language_scope_unproven')
    }
  })
})
