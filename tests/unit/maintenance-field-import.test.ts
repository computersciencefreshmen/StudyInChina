import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { loadMaintenanceBundle, buildMaintenanceScope, catalogSha256 } from '../../scripts/maintenance/build-scope'
import { importFieldCandidates } from '../../scripts/maintenance/import-fields'
import { canonicalJson, exportContentSha256, proposalContentSha256, type CandidateExport, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256 } from '../../src/lib/data/field-verification'
import type { DataBundle } from '../../src/lib/data/types'

const now = '2026-10-24T02:00:00.000Z', capturedAt = '2026-10-24T00:00:00.000Z'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
let bundle: DataBundle, scope: MaintenanceScope
beforeAll(async () => { vi.stubGlobal('crypto', webcrypto); bundle = loadMaintenanceBundle(process.cwd()); scope = await buildMaintenanceScope(bundle, { scopeId: 'field-tests', createdAt: capturedAt }) })

async function fixture(sourceText?: string | ((degree: string) => string)) {
  const cycle = bundle.admissionCycles.find(cycle => cycle.status === 'verified' && cycle.academicYear === '2027-2028' && cycle.intake === 'autumn')!
  const program = bundle.programs.find(program => program.id === cycle.programId)!
  const school = scope.schools.find(school => school.universityId === program.universityId)!
  const url = `https://${school.officialHosts[0]}/field-test.txt`
  const text = typeof sourceText === 'function' ? sourceText(program.degreeLevel) : sourceText
    ?? 'Autumn 2027 admissions for international students. The application deadline is 2027-09-30. Tuition is 20000 CNY.'
  const bytes = new TextEncoder().encode(text), snapshotSha256 = sha(bytes)
  const evidence = { sourceId: 'field-source', url, snapshotSha256, objectKey: 'source.txt', locator: 'text:1', quote: text }
  const proposal: MaintenanceProposal = { id: 'field-proposal', universityId: school.universityId, entityType: 'admission-cycle', recordId: cycle.id, operation: 'patch',
    fields: { recordScopeSha256: fieldRecordScopeSha256('admissionCycle', cycle), patches: [{ fieldPath: 'closesOn', value: '2027-09-30', factStatus: 'known' }] },
    source: { id: evidence.sourceId, url, snapshotSha256, objectKey: evidence.objectKey, checkedAt: capturedAt, contentType: 'text/plain', locator: 'text:1', quote: text },
    fieldEvidence: [{ ...evidence, fieldPath: 'closesOn' }, { ...evidence, fieldPath: '$scope' }], scope: { year: cycle.academicYear, intake: cycle.intake },
    extractionAttemptId: 'extract-attempt', status: 'ready', warnings: [] }
  const artifacts = new Map<string, Uint8Array>([['source.txt', bytes]])
  const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'field-batch',
    inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals: [proposal] }
  const batch: CandidateExport = { ...content, sha256: '0'.repeat(64) }
  const seal = async (agreedFields: unknown = proposal.fields) => {
    const candidateSha256 = await proposalContentSha256(proposal)
    const receipt = new TextEncoder().encode(JSON.stringify({ candidateSha256, reviewAttemptId: 'review-attempt', decision: 'approved', agreedFields }))
    artifacts.set('review.json', receipt)
    proposal.review = { decision: 'approved', reviewerId: 'independent:review-attempt', method: 'independent_model', reviewedAt: capturedAt,
      candidateSha256, snapshotSha256, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true },
      reviewAttemptId: 'review-attempt', artifactKey: 'review.json', reviewArtifactSha256: sha(receipt) }
    batch.sha256 = await exportContentSha256(batch)
  }
  await seal()
  const run = () => importFieldCandidates({ bundle, scope, batch, acceptedAt: now, receiptPath: 'quality/field-receipt.json', readArtifact: async key => artifacts.get(key)! })
  return { run, seal, artifacts, batch, proposal, cycle }
}

describe('offline independently reviewed field consumer', () => {
  it('updates one exact field and records only that leaf without renewing the whole record', async () => {
    const f = await fixture(), result = await f.run()
    expect(result.receipt.held).toEqual([])
    expect(result.receipt.accepted[0].fieldPaths).toEqual(['closesOn'])
    const changed = result.bundle.admissionCycles.find(cycle => cycle.id === f.cycle.id)!
    expect(changed).toMatchObject({ closesOn: '2027-09-30', verifiedAt: f.cycle.verifiedAt, reviewAfter: f.cycle.reviewAfter, status: f.cycle.status, tuitionCny: f.cycle.tuitionCny })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ fieldPath: 'closesOn', receiptSha256: result.receipt.sha256 })
    expect(bundle.admissionCycles.find(cycle => cycle.id === f.cycle.id)).toEqual(f.cycle)
  })
  it('rejects an independently signed review that approved a different field set', async () => {
    const f = await fixture(); await f.seal({ recordScopeSha256: (f.proposal.fields as { recordScopeSha256: string }).recordScopeSha256,
      patches: [{ fieldPath: 'tuitionCny', value: 20000, factStatus: 'known' }] })
    const result = await f.run()
    expect(result.receipt.held[0].reason).toBe('reviewed_field_set_mismatch')
    expect(result.bundle).toEqual(bundle)
  })
  it('refuses another intake/year and missing per-field source evidence', async () => {
    const first = await fixture(); first.proposal.scope.intake = 'spring'; await first.seal()
    expect((await first.run()).receipt.held[0].reason).toBe('cycle_scope_mismatch')
    const second = await fixture(); second.proposal.fieldEvidence = second.proposal.fieldEvidence.filter(evidence => evidence.fieldPath !== 'closesOn'); await second.seal()
    expect((await second.run()).receipt.held[0].reason).toBe('field_specific_evidence_missing')
  })
  it('rejects tampered source bytes even when proposal and review hashes still match', async () => {
    const f = await fixture(); f.artifacts.set('source.txt', new TextEncoder().encode('Changed'))
    const result = await f.run()
    expect(result.receipt.held[0].reason).toBe('source_snapshot_checksum_mismatch')
    expect(result.entries).toEqual([])
    expect(result.bundle).toEqual(bundle)
  })
  it('independently rejects a same-year spring notice for an autumn cycle', async () => {
    const f = await fixture('Spring 2027 admissions for international students. The application deadline is 2027-09-30.')
    expect((await f.run()).receipt.held[0].reason).toBe('cycle_year_or_intake_evidence_required')
  })
  it('independently rejects a degree-specific fee rule for another degree', async () => {
    const f = await fixture(degree => `Autumn 2027 admissions. All ${degree === 'doctorate' ? 'undergraduate' : 'doctoral'} international applicants pay 20000 CNY. Application deadline 2027-09-30.`)
    expect((await f.run()).receipt.held[0].reason).toBe('field_degree_scope_mismatch')
  })
  it('does not replay an applied batch and verifies its original receipt binding', async () => {
    const f = await fixture(), first = await f.run()
    const result = await importFieldCandidates({ bundle: first.bundle, scope, batch: f.batch, acceptedAt: now, entries: first.entries,
      appliedReceipts: [first.receipt], receiptPath: 'unchanged.json', readArtifact: async () => { throw new Error('Replay must not reread or spend') } })
    expect(result.replayed).toBe(true)
    expect(result.entries).toEqual(first.entries)
    const altered = { ...first.receipt, acceptedAt: '2026-10-25T02:00:00.000Z' }
    await expect(importFieldCandidates({ bundle: first.bundle, scope, batch: f.batch, acceptedAt: now,
      appliedReceipts: [altered], receiptPath: 'bad.json', readArtifact: async () => new Uint8Array() })).rejects.toThrow('field_consumed_batch_conflict')
    expect(sha(canonicalJson({ example: true }))).toHaveLength(64)
  })
})
