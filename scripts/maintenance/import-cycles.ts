import { createHash } from 'node:crypto'
import type { AdmissionCycle, DataBundle, Source } from '../../src/lib/data/types'
import { bundleSchema } from '../../src/lib/data/schema'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { getTodayDate } from '../../src/lib/data/freshness'
import type { IdentityAcceptance } from '../../src/lib/data/identity-acceptance'
import { fieldRecordScopeSha256, fieldValueSha256, fieldVerificationContentSha256, fieldVerificationLedgerSchema,
  validateFieldVerification, type FieldVerification } from '../../src/lib/data/field-verification'
import type { FieldImportReceipt } from './import-fields'
import { catalogSha256 } from './build-scope'
import { canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, maintenanceScopeSchema,
  scopeContentSha256 } from './contracts'
import { cycleDiscoveryFieldsSchema, cycleIdentityKey, cyclePatchHasQuoteSupport, explicitCycleScope, sameOfficialProgramName } from './cycle-contracts'
import { verifyReviewedProposalEvidence } from './import-identities'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = (value: unknown) => hash(canonicalJson(value))
export type CycleImportReceipt = {
  format: 'studyinchina.admission-cycle-import-receipt'; formatVersion: 1; batchId: string; batchSha256: string;
  inputCatalogSha256: string; beforeCatalogSha256: string; outputCatalogSha256: string; acceptedAt: string;
  accepted: Array<{ proposalId: string; recordId: string; programId: string; academicYear: string; intake: string }>;
  held: Array<{ proposalId: string; reason: string }>; sha256: string;
}

function fieldReviewDate(cycle: AdmissionCycle, day: string): string {
  const days = cycle.closesOn ? (Date.parse(`${cycle.closesOn}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000 : Infinity
  return new Date(Date.parse(`${day}T00:00:00Z`) + (days >= 0 && days <= 7 ? 1 : days >= 0 && days <= 45 ? 3 : 7) * 86_400_000).toISOString().slice(0, 10)
}

/** A new intake has its own identity and leaf proofs; existing programmes/cycles are never renewed. */
export async function importAdmissionCycleCandidates(options: {
  bundle: DataBundle; inputBundle?: DataBundle; scope: unknown; batch: unknown; acceptedAt: string;
  cycleReceiptPath: string; fieldReceiptPath: string; identities: IdentityAcceptance[]; entries?: FieldVerification[];
  appliedReceipts?: CycleImportReceipt[]; readArtifact(key: string): Promise<Uint8Array>;
}): Promise<{ bundle: DataBundle; entries: FieldVerification[]; cycleReceipt: CycleImportReceipt; fieldReceipt: FieldImportReceipt; replayed: boolean }> {
  const scope = maintenanceScopeSchema.parse(options.scope), batch = maintenanceCandidateExportSchema.parse(options.batch)
  if (scope.sha256 !== await scopeContentSha256(scope) || batch.sha256 !== await exportContentSha256(batch)
    || batch.scopeRegistrySha256 !== scope.sha256) throw new Error('cycle_batch_or_scope_checksum_mismatch')
  let bundle = bundleSchema.parse(options.bundle)
  const baseline = bundleSchema.parse(options.inputBundle ?? options.bundle), inputHash = await catalogSha256(baseline)
  const beforeHash = await catalogSha256(bundle)
  const acceptedAt = new Date(options.acceptedAt)
  if (!Number.isFinite(+acceptedAt) || acceptedAt.toISOString() !== options.acceptedAt) throw new Error('cycle_acceptance_time_invalid')
  const day = getTodayDate(acceptedAt)
  const entries = fieldVerificationLedgerSchema.parse({ schemaVersion: 1, entries: options.entries ?? [] }).entries
  // Composition writes one canonical consumed receipt. Replaying that receipt must use its exact output.
  const prior = options.appliedReceipts?.find(receipt => receipt.batchId === batch.batchId)
  if (prior) throw new Error('cycle_batch_already_consumed_use_canonical_receipt')
  if (inputHash !== batch.inputCatalogSha256) throw new Error('cycle_candidate_base_changed')
  const acceptedParents = new Set(selectDiscoveryData(bundle, day, options.identities, entries).programs.map(program => program.id))
  const accepted: CycleImportReceipt['accepted'] = [], fieldAccepted: FieldImportReceipt['accepted'] = [], held: CycleImportReceipt['held'] = []
  const staged: FieldVerification[] = []
  for (const proposal of batch.proposals) {
    if (proposal.entityType !== 'admission-cycle' || proposal.operation !== 'create') continue
    try {
      if (proposal.status !== 'ready' || proposal.recordId !== null) throw new Error('new_cycle_proposal_not_ready')
      const fields = cycleDiscoveryFieldsSchema.parse(proposal.fields)
      const school = scope.schools.find(school => school.universityId === proposal.universityId)
      const program = bundle.programs.find(program => program.id === fields.programId)
      if (!school || !program || program.universityId !== school.universityId) throw new Error('new_cycle_program_or_school_mismatch')
      if (!acceptedParents.has(program.id)) throw new Error('new_cycle_parent_identity_not_accepted')
      if (bundle.programs.some(other => other.id !== program.id && acceptedParents.has(other.id) && other.universityId === program.universityId
        && other.degreeLevel === program.degreeLevel && sameOfficialProgramName(other.name, program.name))) throw new Error('new_cycle_parent_program_name_ambiguous')
      if (fields.programScopeSha256 !== fieldRecordScopeSha256('program', program)) throw new Error('new_cycle_program_identity_changed')
      if (proposal.scope.year !== fields.academicYear || proposal.scope.intake !== fields.intake || !explicitCycleScope(fields, program)) throw new Error('new_cycle_explicit_program_year_or_intake_unproven')
      if (proposal.review?.method !== 'independent_model' && proposal.review?.method !== 'human') throw new Error('new_cycle_independent_review_required')
      if (new Date(proposal.source.checkedAt) > acceptedAt || new Date(proposal.review.reviewedAt) > acceptedAt) throw new Error('new_cycle_future_evidence')
      const proof = [fields.programEvidence, fields.internationalAdmissionsEvidence, fields.cycleScopeEvidence]
      if (proof.some(evidence => evidence.snapshotSha256 !== proposal.source.snapshotSha256
        || evidence.objectKey !== proposal.source.objectKey || evidence.url !== proposal.source.url)) throw new Error('new_cycle_scope_must_use_same_captured_document')
      await verifyReviewedProposalEvidence(proposal, school, options.readArtifact, proof)
      if (proposal.review.method === 'independent_model') {
        const review = JSON.parse(new TextDecoder().decode(await options.readArtifact(proposal.review.artifactKey!))) as Record<string, unknown>
        if (canonicalJson(review.agreedCycleFields ?? null) !== canonicalJson(fields)) throw new Error('new_cycle_reviewed_fields_mismatch')
      }
      const key = cycleIdentityKey(program.id, fields.academicYear, fields.intake)
      if (bundle.admissionCycles.some(cycle => cycleIdentityKey(cycle.programId, cycle.academicYear, cycle.intake) === key)) throw new Error('annual_cycle_already_exists_use_field_maintenance')
      const id = `cycle-${hash(key).slice(0, 32)}`
      if (bundle.admissionCycles.some(cycle => cycle.id === id)) throw new Error('new_cycle_id_collision')
      const sourceId = `src-maintenance-cycle-${hash(proposal.source.url).slice(0, 24)}`, checkedDay = getTodayDate(new Date(proposal.source.checkedAt))
      const source: Source = { id: sourceId, url: proposal.source.url, title: `Official ${fields.academicYear} ${fields.intake} admission notice`,
        publisher: school.name.en ?? school.name.zh ?? school.universityId, kind: 'admissions', language: 'other', official: true, accessedAt: checkedDay }
      const cycle: AdmissionCycle = { id, programId: program.id, academicYear: fields.academicYear, intake: fields.intake,
        opensOn: null, closesOn: null, dateStatus: 'not-announced', tuitionCny: null, tuitionPeriod: null, tuitionStatus: null,
        applicationFeeCny: null, evidenceBasis: 'cycle-specific', factScope: 'partial', status: 'stale',
        sourceIds: [sourceId], verifiedAt: checkedDay, reviewAfter: checkedDay }
      for (const patch of fields.patches) {
        const evidence = proposal.fieldEvidence.find(evidence => evidence.fieldPath === patch.fieldPath)
        if (!evidence) throw new Error('new_cycle_leaf_evidence_missing')
        if (!cyclePatchHasQuoteSupport(patch, evidence.quote)) throw new Error(`new_cycle_leaf_value_not_in_evidence:${patch.fieldPath}`)
        Object.assign(cycle, { [patch.fieldPath]: structuredClone(patch.value) })
      }
      const next = structuredClone(bundle)
      if (!next.sources.some(item => item.id === sourceId)) next.sources.push(source)
      next.admissionCycles.push(cycle)
      const valid = bundleSchema.parse(next), cycleScopeSha256 = fieldRecordScopeSha256('admissionCycle', cycle)
      const newEntries = fields.patches.map(patch => {
        const evidence = proposal.fieldEvidence.find(evidence => evidence.fieldPath === patch.fieldPath)!
        const entry: FieldVerification = { entityType: 'admissionCycle', recordId: id, recordScopeSha256: cycleScopeSha256,
          fieldPath: patch.fieldPath, value: patch.value, valueSha256: fieldValueSha256(patch.value), factStatus: patch.factStatus,
          sourceId, sourceUrl: source.url, snapshotSha256: evidence.snapshotSha256, objectKey: evidence.objectKey,
          locator: evidence.locator, quote: evidence.quote, verifiedAt: proposal.review!.reviewedAt, reviewAfter: fieldReviewDate(cycle, day),
          review: { method: proposal.review!.method === 'human' ? 'independent' : 'dual-model', reviewerId: proposal.review!.reviewerId },
          receiptPath: options.fieldReceiptPath, receiptSha256: '0'.repeat(64) }
        if (!validateFieldVerification(valid, entry, day)) throw new Error(`new_cycle_invalid_leaf:${patch.fieldPath}`)
        return entry
      })
      bundle = valid; staged.push(...newEntries)
      accepted.push({ proposalId: proposal.id, recordId: id, programId: program.id, academicYear: fields.academicYear, intake: fields.intake })
      fieldAccepted.push({ proposalId: proposal.id, recordId: id, fieldPaths: fields.patches.map(patch => patch.fieldPath) })
    } catch (error) { held.push({ proposalId: proposal.id, reason: error instanceof Error ? error.message : 'new_cycle_review_failed' }) }
  }
  const outputHash = await catalogSha256(bundle)
  const cycleContent: Omit<CycleImportReceipt, 'sha256'> = { format: 'studyinchina.admission-cycle-import-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, inputCatalogSha256: inputHash, beforeCatalogSha256: beforeHash,
    outputCatalogSha256: outputHash, acceptedAt: options.acceptedAt, accepted, held }
  const cycleReceipt = { ...cycleContent, sha256: digest(cycleContent) }
  const fieldContent: Omit<FieldImportReceipt, 'sha256'> = { format: 'studyinchina.field-import-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, inputCatalogSha256: inputHash, outputCatalogSha256: outputHash,
    acceptedAt: options.acceptedAt, accepted: fieldAccepted, held,
    fieldBindings: staged.map(entry => ({ entityType: entry.entityType, recordId: entry.recordId, fieldPath: entry.fieldPath,
      verificationSha256: fieldVerificationContentSha256(entry) })) }
  const fieldReceipt = { ...fieldContent, sha256: digest(fieldContent) }
  for (const entry of staged) { entry.receiptSha256 = fieldReceipt.sha256; entries.push(entry) }
  return { bundle, entries, cycleReceipt, fieldReceipt, replayed: false }
}
