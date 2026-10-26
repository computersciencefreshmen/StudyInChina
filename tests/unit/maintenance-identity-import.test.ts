import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import {
  canonicalJson, exportContentSha256, proposalContentSha256, type CandidateExport,
  type MaintenanceProposal, type MaintenanceScope,
} from '../../scripts/maintenance/contracts'
import { canonicalProgramIdentityKey, importIdentityCandidates } from '../../scripts/maintenance/import-identities'
import type { DataBundle } from '../../src/lib/data/types'

const acceptedAt = '2026-10-24T02:00:00.000Z'
const capturedAt = '2026-10-24T00:00:00.000Z'
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
let bundle: DataBundle
let scope: MaintenanceScope

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  bundle = loadMaintenanceBundle(process.cwd())
  scope = await buildMaintenanceScope(bundle, { scopeId: 'test-fixed-272', createdAt: capturedAt })
})

async function fixture(options: { existing?: boolean; degree?: 'bachelor' | 'master'; batchId?: string; internationalQuote?: string } = {}) {
  const school = scope.schools.find(school => school.originalStatus === 'verified')!
  const existing = bundle.programs.find(program => program.universityId === school.universityId && program.status === 'stale')!
  const name = options.existing ? { en: existing.name.en!, zh: existing.name.zh! }
    : { en: 'Evidence Bound Computing', zh: '证据约束计算' }
  const degreeLevel = options.existing ? existing.degreeLevel : options.degree ?? 'master'
  const text = `${options.internationalQuote ?? 'International students are eligible for individual application.'} ${degreeLevel} ${name.en} ${name.zh} official code EBC-001.`
  const bytes = new TextEncoder().encode(text)
  const snapshotSha256 = hash(bytes)
  const url = `https://${school.officialHosts[0]}/maintenance-catalogue-test.txt`
  const evidence = { sourceId: 'fixture-source', url, snapshotSha256, objectKey: 'snapshots/catalogue.txt', locator: 'text:1', quote: text }
  const proposal: MaintenanceProposal = {
    id: 'proposal-001', universityId: school.universityId, entityType: 'program', recordId: options.existing ? existing.id : null,
    operation: options.existing ? 'patch' : 'create', status: 'ready', warnings: [],
    fields: { name, degreeLevel, programType: ['bachelor', 'master', 'doctorate'].includes(degreeLevel) ? 'degree' : degreeLevel,
      officialProgramCode: 'EBC-001', programUrl: options.existing ? existing.programUrl : url, internationalAdmissionsEvidence: evidence },
    source: { id: 'fixture-source', url, snapshotSha256, objectKey: evidence.objectKey, checkedAt: capturedAt,
      contentType: 'text/plain', locator: 'text:1', quote: text },
    fieldEvidence: ['name.en', 'name.zh', 'degreeLevel', 'officialProgramCode'].map(fieldPath => ({ ...evidence, fieldPath })),
    scope: { year: null, intake: null },
  }
  proposal.review = { decision: 'approved', reviewerId: 'human:test-reviewer', method: 'human', reviewedAt: capturedAt,
    candidateSha256: await proposalContentSha256(proposal), snapshotSha256,
    checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  const content: Omit<CandidateExport, 'sha256'> = {
    format: 'studyinchina.maintenance-candidate-export', formatVersion: 1, batchId: options.batchId ?? 'fixture-batch',
    inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals: [proposal],
  }
  const batch: CandidateExport = { ...content, sha256: await exportContentSha256(content) }
  const artifacts = new Map<string, Uint8Array>([[evidence.objectKey, bytes]])
  const run = () => importIdentityCandidates({ bundle, scope, batch, acceptedAt, receiptPath: 'receipts/fixture.json',
    readArtifact: async key => { const bytes = artifacts.get(key); if (!bytes) throw new Error('Missing artifact'); return bytes } })
  return { batch, proposal, run, artifacts, existing }
}

async function reseal(batch: CandidateExport, review = false) {
  if (review) for (const proposal of batch.proposals) if (proposal.review) proposal.review.candidateSha256 = await proposalContentSha256(proposal)
  batch.sha256 = await exportContentSha256(batch)
}

describe('fixed school scope and reviewed identity importing', () => {
  it('includes every raw school including hidden ones, and keeps untrusted hosts disabled', () => {
    expect(scope.schools).toHaveLength(272)
    expect(scope.schools.filter(school => school.originalStatus !== 'verified').length).toBeGreaterThan(0)
    const seeds = scope.schools.flatMap(school => school.sourceSeeds)
    expect(seeds.filter(seed => seed.registration === 'candidate').length).toBeGreaterThan(0)
    expect(seeds.filter(seed => seed.registration === 'candidate').every(seed => !seed.enabled)).toBe(true)
  })

  it('refuses a partial cohort instead of silently publishing a misleading 272-school scope', async () => {
    await expect(buildMaintenanceScope({ ...bundle, universities: bundle.universities.slice(1) }, { scopeId: 'bad', createdAt: capturedAt }))
      .rejects.toThrow('exactly 272')
  })

  it('adds only an identity and preserves every existing record, public ID and cycle', async () => {
    const { run } = await fixture()
    const result = await run()
    expect(result.receipt.held).toEqual([])
    expect(result.bundle.programs).toHaveLength(bundle.programs.length + 1)
    expect(result.bundle.programs.slice(0, bundle.programs.length)).toEqual(bundle.programs)
    expect(result.bundle.admissionCycles).toEqual(bundle.admissionCycles)
    expect(result.bundle.scholarships).toEqual(bundle.scholarships)
    const record = result.bundle.programs.at(-1)!
    expect(record).toMatchObject({ verificationScope: 'identity', teachingLanguages: [], durationMonths: null, applyUrl: null, languageRequirements: [] })
    expect(result.acceptances.entries[0].recordId).toBe(record.id)
    expect(result.acceptances.entries[0].receiptSha256).toBe(result.receipt.sha256)
  })

  it('uses the same exact nationality evidence scope check as programme extraction', async () => {
    const eligible = await fixture({ internationalQuote: 'Applicants must be N on-Chinese citizens with a valid passport.' })
    const result = await eligible.run()
    expect(result.receipt.accepted).toHaveLength(1)
    expect(result.receipt.held).toEqual([])
    expect(result.bundle.admissionCycles).toEqual(bundle.admissionCycles)
    const domestic = await fixture({ internationalQuote: 'Applicants must be Chinese citizens.' })
    expect((await domestic.run()).receipt.held[0].reason).toBe('international_admissions_scope_unproven')
    const internship = await fixture({ internationalQuote: 'The degree includes an international internship.' })
    expect((await internship.run()).receipt.held[0].reason).toBe('international_admissions_scope_unproven')
  })

  it('accepts an existing stale identity without renewing raw audit dates or dynamic facts', async () => {
    const { run, existing } = await fixture({ existing: true })
    const result = await run()
    expect(result.receipt.held).toEqual([])
    expect(result.bundle.programs).toHaveLength(bundle.programs.length)
    const updated = result.bundle.programs.find(program => program.id === existing.id)!
    expect({ ...updated, sourceIds: existing.sourceIds }).toEqual(existing)
    expect(updated.sourceIds).toEqual(expect.arrayContaining(existing.sourceIds))
    expect(result.acceptances.entries[0].recordId).toBe(existing.id)
  })

  it('replays an acknowledged batch without adding records or refreshing acceptance dates', async () => {
    const { batch, run, artifacts } = await fixture()
    const first = await run()
    const replay = await importIdentityCandidates({ bundle: first.bundle, scope, batch, acceptedAt,
      receiptPath: 'receipts/second.json', acceptances: first.acceptances, bindings: first.bindings, appliedReceipts: [first.receipt],
      readArtifact: async key => artifacts.get(key)! })
    expect(replay.replayed).toBe(true)
    expect(replay.bundle).toEqual(first.bundle)
    expect(replay.acceptances).toEqual(first.acceptances)
  })

  it('holds a tampered snapshot even when a model/human marked the proposal approved', async () => {
    const { run, artifacts } = await fixture()
    artifacts.set('snapshots/catalogue.txt', new TextEncoder().encode('Changed after review'))
    const result = await run()
    expect(result.receipt.held[0].reason).toBe('source_snapshot_checksum_mismatch')
    expect(result.bundle).toEqual(bundle)
  })

  it('rejects a stale review hash after candidate fields change', async () => {
    const { run, proposal, batch } = await fixture()
    proposal.fields.officialProgramCode = 'SOME-OTHER-CODE'
    await reseal(batch)
    expect((await run()).receipt.held[0].reason).toBe('review_fingerprint_mismatch')
  })

  it('requires names to occur in checked source evidence, not just model output', async () => {
    const { run, proposal, batch } = await fixture()
    proposal.fields.name = { en: 'A model invented this course' }
    await reseal(batch, true)
    expect((await run()).receipt.held[0].reason).toBe('official_name_evidence_missing:en')
  })

  it('rejects nonofficial hosts and another university outside the frozen cohort', async () => {
    const first = await fixture()
    first.proposal.source.url = 'https://untrusted.example/course'
    await reseal(first.batch, true)
    expect((await first.run()).receipt.held[0].reason).toBe('source_outside_registered_school_hosts')
    const second = await fixture()
    second.proposal.universityId = 'uni-not-in-the-272'
    await reseal(second.batch, true)
    expect((await second.run()).receipt.held[0].reason).toBe('school_outside_fixed_scope')
  })

  it('does not turn identity-only evidence into an inferred admission cycle or accept extra prices', async () => {
    const first = await fixture()
    first.proposal.scope.year = '2027-2028'
    await reseal(first.batch, true)
    expect((await first.run()).receipt.held[0].reason).toBe('identity_must_not_claim_a_cycle')
    const second = await fixture()
    second.proposal.fields.tuitionCny = 100
    await reseal(second.batch, true)
    expect((await second.run()).receipt.held).toHaveLength(1)
  })

  it('requires a distinct checksum-bound independent model review receipt', async () => {
    const { proposal, batch, run } = await fixture()
    proposal.extractionAttemptId = 'attempt-one'
    proposal.review!.method = 'independent_model'
    proposal.review!.reviewAttemptId = 'attempt-one'
    await reseal(batch, true)
    expect((await run()).receipt.held[0].reason).toBe('independent_model_receipt_required')
  })

  it('accepts an independent model review only with the exact pinned review artifact', async () => {
    const { proposal, batch, run, artifacts } = await fixture()
    proposal.extractionAttemptId = 'attempt-extract'
    proposal.review!.method = 'independent_model'
    proposal.review!.reviewAttemptId = 'attempt-review'
    proposal.review!.artifactKey = 'reviews/independent.json'
    proposal.review!.candidateSha256 = await proposalContentSha256(proposal)
    const receipt = new TextEncoder().encode(JSON.stringify({ candidateSha256: proposal.review!.candidateSha256,
      reviewAttemptId: 'attempt-review', decision: 'approved' }))
    artifacts.set(proposal.review!.artifactKey, receipt)
    proposal.review!.reviewArtifactSha256 = hash(receipt)
    await reseal(batch)
    expect((await run()).receipt.accepted).toHaveLength(1)
    artifacts.set('reviews/independent.json', new TextEncoder().encode('{}'))
    expect((await run()).receipt.held[0].reason).toBe('review_artifact_checksum_mismatch')
  })

  it('does not accept a quote from the wrong line or a wrong mapped record name', async () => {
    const first = await fixture()
    first.proposal.fieldEvidence[0].locator = 'text:999'
    await reseal(first.batch, true)
    expect((await first.run()).receipt.held[0].reason).toBe('evidence_quote_not_at_locator')
    const second = await fixture()
    second.proposal.recordId = second.existing.id
    second.proposal.fields.degreeLevel = second.existing.degreeLevel
    await reseal(second.batch, true)
    expect((await second.run()).receipt.held[0].reason).toBe('mapped_identity_name_conflict')
  })

  it('requires checksum-bound text for binary PDFs before treating model text as evidence', async () => {
    const { proposal, batch, run, artifacts } = await fixture()
    proposal.source.contentType = 'application/pdf'
    await reseal(batch, true)
    expect((await run()).receipt.held[0].reason).toBe('binary_source_requires_checksum_bound_text_artifact')
    const text = artifacts.get('snapshots/catalogue.txt')!
    artifacts.set('extracted/catalogue.txt', text)
    proposal.source.textArtifact = { objectKey: 'extracted/catalogue.txt', sha256: hash(text),
      rawSnapshotSha256: proposal.source.snapshotSha256, parser: 'poppler' }
    await reseal(batch, true)
    expect((await run()).receipt.accepted).toHaveLength(1)
    proposal.source.textArtifact.rawSnapshotSha256 = '0'.repeat(64)
    await reseal(batch, true)
    expect((await run()).receipt.held[0].reason).toBe('text_artifact_raw_binding_mismatch')
  })

  it('holds only the unsupported/invalid proposal while allowing another school proposal', async () => {
    const { proposal, batch, run } = await fixture()
    batch.proposals.push({ ...structuredClone(proposal), id: 'unsupported-cycle', entityType: 'admission-cycle' })
    await reseal(batch)
    const result = await run()
    expect(result.receipt.accepted).toHaveLength(1)
    expect(result.receipt.held).toEqual([{ proposalId: 'unsupported-cycle', reason: 'entity_type_has_no_identity_consumer' }])
  })

  it('refuses changed base content and changed immutable batch envelopes', async () => {
    const first = await fixture()
    first.batch.inputCatalogSha256 = '0'.repeat(64)
    await reseal(first.batch)
    await expect(first.run()).rejects.toThrow('base catalogue changed')
    const second = await fixture()
    second.batch.batchId = 'changed-without-rehash'
    await expect(second.run()).rejects.toThrow('export checksum mismatch')
  })

  it('keeps degree and official codes in identity keys, with cycle information excluded', async () => {
    const { proposal } = await fixture()
    const fields = proposal.fields as Parameters<typeof canonicalProgramIdentityKey>[1]
    expect(canonicalProgramIdentityKey(proposal.universityId, fields)).not.toBe(canonicalProgramIdentityKey(proposal.universityId, { ...fields, degreeLevel: 'bachelor' }))
    expect(canonicalProgramIdentityKey(proposal.universityId, fields)).toContain('code:ebc001')
    expect(() => canonicalJson({ invalid: undefined })).toThrow('finite JSON')
  })
})
