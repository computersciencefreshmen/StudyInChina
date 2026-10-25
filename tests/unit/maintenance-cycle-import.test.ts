import { createHash, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { importAdmissionCycleCandidates } from '../../scripts/maintenance/import-cycles'
import { canonicalJson, exportContentSha256, proposalContentSha256, type CandidateExport, type MaintenanceProposal, type MaintenanceScope } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256, fieldVerificationContentSha256 } from '../../src/lib/data/field-verification'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { selectPublishedData } from '../../src/lib/data/publication'
import { identityFingerprint, type IdentityAcceptance } from '../../src/lib/data/identity-acceptance'
import type { DataBundle } from '../../src/lib/data/types'
import { CatalogApiService, releaseFromBundle } from '../../src/lib/catalog-api/service'

const now = '2026-10-24T02:00:00.000Z', capturedAt = '2026-10-24T00:00:00.000Z'
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
let original: DataBundle, scope: MaintenanceScope
beforeAll(async () => { vi.stubGlobal('crypto', webcrypto); original = loadMaintenanceBundle(process.cwd()); scope = await buildMaintenanceScope(original, { scopeId: 'new-intake-test', createdAt: capturedAt }) })

async function fixture(year = '2028-2029') {
  const selected = selectPublishedData(original, '2026-10-24').programs.find(program => program.degreeLevel === 'master' && program.name.en)!
  // This suite tests one parent's year/scope isolation, not full-catalogue throughput.
  // Keep the fixed 272-school registry while avoiding repeated parsing of 2,057 rich programmes.
  const bundle = structuredClone({ ...original, programs: [selected],
    admissionCycles: original.admissionCycles.filter(cycle => cycle.programId === selected.id), scholarships: [] })
  const program = bundle.programs[0]
  const school = scope.schools.find(school => school.universityId === program.universityId)!
  const intakeYear = year.slice(0, 4), opensOn = `${Number(intakeYear) - 1}-11-01`, closesOn = `${intakeYear}-04-30`
  const text = `International students: Master ${program.name.en}. Autumn ${intakeYear} admissions for Master ${program.name.en}. Application opens ${opensOn}; application deadline ${closesOn}.`
  const bytes = new TextEncoder().encode(text), snapshotSha256 = hash(bytes), url = `https://${school.officialHosts[0]}/new-intake-proof.txt`
  const evidence = { sourceId: 'cycle-source', url, snapshotSha256, objectKey: 'raw/new-intake.txt', locator: 'text:1', quote: text }
  const proposal: MaintenanceProposal = { id: 'new-cycle-one', universityId: program.universityId, entityType: 'admission-cycle', recordId: null, operation: 'create',
    fields: { programId: program.id, programScopeSha256: fieldRecordScopeSha256('program', program), academicYear: year, intake: 'autumn',
      patches: [{ fieldPath: 'opensOn', value: opensOn, factStatus: 'known' }, { fieldPath: 'closesOn', value: closesOn, factStatus: 'known' }, { fieldPath: 'dateStatus', value: 'published', factStatus: 'known' }],
      programEvidence: evidence, internationalAdmissionsEvidence: evidence, cycleScopeEvidence: evidence },
    source: { id: evidence.sourceId, url, snapshotSha256, objectKey: evidence.objectKey, checkedAt: capturedAt, contentType: 'text/plain', locator: 'text:1', quote: text },
    fieldEvidence: ['opensOn', 'closesOn', 'dateStatus', '$program', '$scope', '$international'].map(fieldPath => ({ ...evidence, fieldPath })),
    scope: { year, intake: 'autumn' }, status: 'ready', warnings: [], extractionAttemptId: 'intake-primary' }
  const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'cycle-batch',
    inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: capturedAt, proposals: [proposal] }
  const batch: CandidateExport = { ...content, sha256: '0'.repeat(64) }
  const artifacts = new Map<string, Uint8Array>([[evidence.objectKey, bytes]])
  const seal = async (reviewedFields: unknown = proposal.fields, reviewedAt = capturedAt) => {
    for (const item of batch.proposals) {
      const candidateSha256 = await proposalContentSha256(item), key = `reviews/${item.id}.json`
      const receipt = new TextEncoder().encode(JSON.stringify({ candidateSha256, reviewAttemptId: 'intake-independent', decision: 'approved', agreedCycleFields: item === proposal ? reviewedFields : item.fields }))
      artifacts.set(key, receipt)
      item.review = { decision: 'approved', reviewerId: 'independent:intake-review', method: 'independent_model', reviewedAt,
        candidateSha256, snapshotSha256, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true },
        reviewAttemptId: 'intake-independent', artifactKey: key, reviewArtifactSha256: hash(receipt) }
    }
    batch.inputCatalogSha256 = await catalogSha256(bundle); batch.sha256 = await exportContentSha256(batch)
  }
  await seal()
  const run = (identities: IdentityAcceptance[] = [], acceptedAt = now) => importAdmissionCycleCandidates({ bundle, scope, batch, identities, acceptedAt,
    cycleReceiptPath: 'quality/cycle-receipt.json', fieldReceiptPath: 'quality/cycle-field-receipt.json', readArtifact: async key => {
      const bytes = artifacts.get(key); if (!bytes) throw Error('Artifact missing'); return bytes
    } })
  return { bundle, program, proposal, batch, seal, run, artifacts }
}

describe('new annual admission-cycle import', () => {
  it('holds a new intake whose source is ten days old even when independent review happened today', async () => {
    const f = await fixture(); f.proposal.source.checkedAt = '2026-10-14T00:00:00.000Z'; await f.seal(undefined, now)
    const result = await f.run()
    expect(result.cycleReceipt.held).toEqual([{ proposalId: f.proposal.id, reason: 'new_cycle_invalid_leaf:opensOn' }])
    expect(result.cycleReceipt.accepted).toEqual([])
    expect(result.fieldReceipt.accepted).toEqual([])
    expect(result.fieldReceipt.fieldBindings).toEqual([])
    expect(result.entries).toEqual([])
    expect(result.bundle).toEqual(f.bundle)
    expect(result.cycleReceipt.outputCatalogSha256).toBe(result.cycleReceipt.beforeCatalogSha256)
  })
  it('keeps the source-day as-of time on new-cycle leaves when independently reviewed the following day', async () => {
    const f = await fixture(); f.proposal.source.checkedAt = '2026-10-25T00:00:00.000Z'; await f.seal(undefined, '2026-10-26T00:00:00.000Z')
    const result = await f.run([], '2026-10-26T02:00:00.000Z')
    expect(result.cycleReceipt.held).toEqual([])
    expect(result.entries).toHaveLength(3)
    expect(result.entries.every(entry => entry.verifiedAt === f.proposal.source.checkedAt && entry.reviewAfter === '2026-11-01')).toBe(true)
    expect(result.bundle.admissionCycles.at(-1)).toMatchObject({ status: 'stale', verifiedAt: '2026-10-25', reviewAfter: '2026-10-25' })
    expect(result.bundle.programs).toEqual(f.bundle.programs)
    expect(result.bundle.admissionCycles.slice(0, -1)).toEqual(f.bundle.admissionCycles)
    expect(f.proposal.review!.reviewedAt).toBe('2026-10-26T00:00:00.000Z')
  })
  it('still holds future source observations and future independent reviews', async () => {
    const f = await fixture(); f.proposal.source.checkedAt = '2026-10-25T00:00:00.000Z'; await f.seal()
    expect((await f.run()).cycleReceipt.held[0].reason).toBe('new_cycle_future_evidence')
    f.proposal.source.checkedAt = capturedAt; await f.seal(undefined, '2026-10-25T00:00:00.000Z')
    expect((await f.run()).cycleReceipt.held[0].reason).toBe('new_cycle_future_evidence')
  })
  it('creates a new scoped cycle and only proven fields, preserving every older record and audit date', async () => {
    const f = await fixture(), result = await f.run()
    expect(result.cycleReceipt.held).toEqual([])
    expect(result.bundle.admissionCycles).toHaveLength(f.bundle.admissionCycles.length + 1)
    expect(result.bundle.admissionCycles.slice(0, -1)).toEqual(f.bundle.admissionCycles)
    expect(result.bundle.programs).toEqual(f.bundle.programs)
    const added = result.bundle.admissionCycles.at(-1)!
    expect(added).toMatchObject({ programId: f.program.id, academicYear: '2028-2029', intake: 'autumn', status: 'stale', tuitionCny: null, applicationFeeCny: null })
    expect(result.entries.map(entry => entry.fieldPath)).toEqual(['opensOn', 'closesOn', 'dateStatus'])
    expect(result.entries.every(entry => entry.receiptSha256 === result.fieldReceipt.sha256)).toBe(true)
    expect(result.fieldReceipt.fieldBindings[0].verificationSha256).toBe(fieldVerificationContentSha256(result.entries[0]))
    const publicCycle = selectDiscoveryData(result.bundle, '2026-10-24', [], result.entries).admissionCycles.find(cycle => cycle.id === added.id)
    expect(publicCycle).toMatchObject({ opensOn: '2027-11-01', closesOn: '2028-04-30', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null })
    const directory = selectDiscoveryData(result.bundle, '2026-10-24', [], result.entries)
    const api = new CatalogApiService(directory, releaseFromBundle(directory, '2026-10-24'), '2026-10-24')
    expect(api.getProgramCycles(f.program.slug)?.data.find(cycle => cycle.id === added.id)).toMatchObject({
      academicYear: '2028-2029', opensOn: '2027-11-01', closesOn: '2028-04-30', tuitionCny: null, applicationFeeCny: null,
    })
    expect(selectDiscoveryData(result.bundle, '2026-11-01', [], result.entries).admissionCycles.some(cycle => cycle.id === added.id)).toBe(false)
  })
  it('does not resurrect an unaccepted stale programme identity', async () => {
    const f = await fixture(); f.bundle.programs.find(program => program.id === f.program.id)!.status = 'stale'; await f.seal()
    expect((await f.run()).cycleReceipt.held[0].reason).toBe('new_cycle_parent_identity_not_accepted')
    const parent = f.bundle.programs.find(program => program.id === f.program.id)!
    const identity: IdentityAcceptance = { entityType: 'program', recordId: parent.id, identitySha256: identityFingerprint('program', parent), sourceIds: parent.sourceIds,
      acceptedAt: capturedAt, reviewer: 'accepted-parent-fixture', receiptPath: 'quality/parent.json', receiptSha256: 'a'.repeat(64) }
    expect((await f.run([identity])).cycleReceipt.accepted).toHaveLength(1)
    expect(parent.status).toBe('stale')
  })
  it('holds school-wide season wording, a wrong year, and missing degree context', async () => {
    const first = await fixture(); (first.proposal.fields.cycleScopeEvidence as { quote: string }).quote = 'Autumn 2028 admissions'; await first.seal()
    expect((await first.run()).cycleReceipt.held[0].reason).toBe('new_cycle_explicit_program_year_or_intake_unproven')
    const second = await fixture(); second.proposal.fields.academicYear = '2029-2030'; second.proposal.scope.year = '2029-2030'; await second.seal()
    expect((await second.run()).cycleReceipt.held[0].reason).toBe('new_cycle_explicit_program_year_or_intake_unproven')
    const third = await fixture(); (third.proposal.fields.programEvidence as { quote: string }).quote = third.program.name.en!; await third.seal()
    expect((await third.run()).cycleReceipt.held[0].reason).toBe('new_cycle_explicit_program_year_or_intake_unproven')
  })
  it('requires unchanged parent identity and the exact independently approved create fields', async () => {
    const first = await fixture(); first.proposal.fields.programScopeSha256 = '0'.repeat(64); await first.seal()
    expect((await first.run()).cycleReceipt.held[0].reason).toBe('new_cycle_program_identity_changed')
    const second = await fixture(); await second.seal({ ...second.proposal.fields, intake: 'spring' })
    expect((await second.run()).cycleReceipt.held[0].reason).toBe('new_cycle_reviewed_fields_mismatch')
  })
  it('does not accept a fabricated date merely because both output hashes agree', async () => {
    const f = await fixture(); (f.proposal.fields.patches as Array<{ fieldPath: string; value: unknown }>).find(patch => patch.fieldPath === 'closesOn')!.value = '2030-04-30'; await f.seal()
    expect((await f.run()).cycleReceipt.held[0].reason).toBe('new_cycle_leaf_value_not_in_evidence:closesOn')
  })
  it('deduplicates programme/year/intake without replacing an existing cycle', async () => {
    const f = await fixture(); f.batch.proposals.push({ ...structuredClone(f.proposal), id: 'same-cycle-second-source' }); await f.seal()
    const result = await f.run()
    expect(result.cycleReceipt.accepted).toHaveLength(1)
    expect(result.cycleReceipt.held).toEqual([{ proposalId: 'same-cycle-second-source', reason: 'annual_cycle_already_exists_use_field_maintenance' }])
    expect(result.entries).toHaveLength(3)
  })
  it('retains a historically explicit intake without exposing it as a current opportunity', async () => {
    const f = await fixture('2020-2021'), result = await f.run()
    expect(result.cycleReceipt.accepted).toHaveLength(1)
    expect(selectDiscoveryData(result.bundle, '2026-10-24', [], result.entries).admissionCycles.some(cycle => cycle.id === result.bundle.admissionCycles.at(-1)!.id)).toBe(false)
  })
  it('rejects altered bytes and an altered base rather than partially applying a new intake', async () => {
    const first = await fixture(); first.artifacts.set('raw/new-intake.txt', new TextEncoder().encode('Changed source'))
    const result = await first.run()
    expect(result.cycleReceipt.held[0].reason).toBe('source_snapshot_checksum_mismatch')
    expect(result.bundle).toEqual(first.bundle)
    const second = await fixture(); second.batch.inputCatalogSha256 = '0'.repeat(64); second.batch.sha256 = await exportContentSha256(second.batch)
    await expect(second.run()).rejects.toThrow('cycle_candidate_base_changed')
    expect(hash(canonicalJson({ safety: true }))).toHaveLength(64)
  })
})
