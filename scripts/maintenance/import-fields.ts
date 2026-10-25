import { createHash } from 'node:crypto'
import type { DataBundle, Program, AdmissionCycle, Scholarship, Source } from '../../src/lib/data/types'
import { bundleSchema } from '../../src/lib/data/schema'
import { fieldRecordScopeSha256, fieldValueSha256, validateFieldVerification, fieldVerificationLedgerSchema, fieldVerificationContentSha256, type FieldVerification } from '../../src/lib/data/field-verification'
import { getTodayDate } from '../../src/lib/data/freshness'
import { canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, maintenanceScopeSchema, scopeContentSha256, type MaintenanceProposal } from './contracts'
import { catalogSha256 } from './build-scope'
import { fieldPatchFieldsSchema, maintainedFieldPaths } from './field-contracts'
import { verifyReviewedProposalEvidence } from './import-identities'

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
export type FieldImportReceipt = {
  format: 'studyinchina.field-import-receipt'; formatVersion: 1; batchId: string; batchSha256: string;
  inputCatalogSha256: string; outputCatalogSha256: string; acceptedAt: string;
  accepted: Array<{ proposalId: string; recordId: string; fieldPaths: string[] }>;
  fieldBindings: Array<{ entityType: FieldVerification['entityType']; recordId: string; fieldPath: string; verificationSha256: string }>;
  held: Array<{ proposalId: string; reason: string }>; sha256: string
}

function setField(record: unknown, path: string, value: unknown) {
  let target = record as Record<string, unknown>
  const parts = path.split('.')
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}
    target = target[part] as Record<string, unknown>
  }
  target[parts.at(-1)!] = structuredClone(value)
}
function addDays(day: string, days: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) }
function reviewDate(record: Program | AdmissionCycle | Scholarship, day: string) {
  const deadline = 'closesOn' in record ? record.closesOn : 'deadline' in record ? record.deadline : null
  const days = deadline ? (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000 : Infinity
  return addDays(day, days >= 0 && days <= 7 ? 1 : days >= 0 && days <= 45 ? 3 : 7)
}
function assertAnnualScope(proposal: MaintenanceProposal, record: Program | AdmissionCycle | Scholarship, bundle: DataBundle) {
  const seasonal = (quote: string, intake: string | null) => intake === 'spring'
    ? /spring|春季|March|3月/iu.test(quote) : intake === 'autumn' ? /autumn|fall|秋季|September|9月/iu.test(quote) : true
  const program = proposal.entityType === 'program' ? record as Program : proposal.entityType === 'admission-cycle'
    ? bundle.programs.find(program => program.id === (record as AdmissionCycle).programId) : undefined
  if (program) {
    const patterns = [
      ['bachelor', /undergraduate|bachelor|本科|学士/iu], ['master', /master|硕士/iu],
      ['doctorate', /doctoral|doctorate|ph\.?d|博士/iu], ['language', /language programme?|汉语进修/iu],
      ['foundation', /foundation|pre.?university|预科/iu],
    ] as const
    // Check the cited field/applicability scope, not an unrelated heading elsewhere on the page.
    for (const evidence of proposal.fieldEvidence.filter(entry => entry.fieldPath !== '$scope')) {
      const degrees = patterns.filter(([, pattern]) => pattern.test(evidence.quote)).map(([degree]) => degree)
      if (degrees.length && !degrees.includes(program.degreeLevel as typeof degrees[number])) throw new Error('field_degree_scope_mismatch')
    }
  }
  if (proposal.entityType === 'program' && (proposal.scope.year !== null || proposal.scope.intake !== null)) throw new Error('program_field_scope_mismatch')
  if (proposal.entityType === 'admission-cycle') {
    const cycle = record as AdmissionCycle
    if (proposal.scope.year !== cycle.academicYear || proposal.scope.intake !== cycle.intake) throw new Error('cycle_scope_mismatch')
    const intakeYear = cycle.intake === 'spring' ? cycle.academicYear.slice(5) : cycle.academicYear.slice(0, 4)
    if (!proposal.fieldEvidence.some(entry => entry.fieldPath === '$scope'
      && new RegExp(`\\b${intakeYear}\\b`, 'u').test(entry.quote) && seasonal(entry.quote, cycle.intake))) throw new Error('cycle_year_or_intake_evidence_required')
  }
  if (proposal.entityType === 'scholarship') {
    const fields = fieldPatchFieldsSchema.parse(proposal.fields)
    if (fields.patches.every(patch => patch.fieldPath === 'applicationUrl')) return
    const years = [...new Set(Object.values((record as Scholarship).name).flatMap(name => name?.match(/(?<!\d)20\d{2}(?!\d)/gu) ?? []))]
    if (years.length !== 1 || proposal.scope.year !== years[0]
      || !proposal.fieldEvidence.some(entry => entry.fieldPath === '$scope' && new RegExp(`\\b${years[0]}\\b`, 'u').test(entry.quote)
        && seasonal(entry.quote, proposal.scope.intake))) throw new Error('scholarship_annual_scope_unproven')
  }
}

/** Stage only exact, independently reviewed leaves. Record-level audit dates remain unchanged. */
export async function importFieldCandidates(options: {
  bundle: DataBundle; inputBundle?: DataBundle; scope: unknown; batch: unknown; acceptedAt: string; receiptPath: string;
  entries?: FieldVerification[]; appliedReceipts?: FieldImportReceipt[]; readArtifact(key: string): Promise<Uint8Array>
}): Promise<{ bundle: DataBundle; entries: FieldVerification[]; receipt: FieldImportReceipt; replayed: boolean }> {
  const scope = maintenanceScopeSchema.parse(options.scope), batch = maintenanceCandidateExportSchema.parse(options.batch)
  if (scope.sha256 !== await scopeContentSha256(scope) || batch.sha256 !== await exportContentSha256(batch) || batch.scopeRegistrySha256 !== scope.sha256) throw new Error('field_batch_or_scope_checksum_mismatch')
  let bundle = bundleSchema.parse(options.bundle)
  const baseline = bundleSchema.parse(options.inputBundle ?? options.bundle), inputHash = await catalogSha256(baseline)
  const entries = fieldVerificationLedgerSchema.parse({ schemaVersion: 1, entries: options.entries ?? [] }).entries
  const old = options.appliedReceipts?.find(receipt => receipt.batchId === batch.batchId)
  if (old) {
    const { sha256, ...content } = old
    if (digest(content) !== sha256 || old.batchSha256 !== batch.sha256 || await catalogSha256(bundle) !== old.outputCatalogSha256) throw new Error('field_consumed_batch_conflict')
    return { bundle, entries, receipt: old, replayed: true }
  }
  if (inputHash !== batch.inputCatalogSha256) throw new Error('field_candidate_base_changed')
  const acceptedAt = new Date(options.acceptedAt)
  if (!Number.isFinite(+acceptedAt) || acceptedAt.toISOString() !== options.acceptedAt) throw new Error('invalid_field_acceptance_time')
  const today = getTodayDate(acceptedAt), accepted: FieldImportReceipt['accepted'] = [], held: FieldImportReceipt['held'] = []
  const staged: FieldVerification[] = []
  for (const proposal of batch.proposals) {
    if (proposal.operation !== 'patch') continue
    try {
      if (proposal.status !== 'ready' || !proposal.recordId) throw new Error('field_proposal_not_ready')
      const fields = fieldPatchFieldsSchema.parse(proposal.fields), school = scope.schools.find(row => row.universityId === proposal.universityId)
      if (!school) throw new Error('field_school_outside_scope')
      const entityType = proposal.entityType === 'admission-cycle' ? 'admissionCycle' : proposal.entityType
      const list = entityType === 'program' ? bundle.programs : entityType === 'admissionCycle' ? bundle.admissionCycles : bundle.scholarships
      const record = list.find(row => row.id === proposal.recordId)
      if (!record || record.status === 'draft' || record.status === 'archived') throw new Error('field_record_unaccepted')
      const owner = 'universityId' in record ? record.universityId : 'programId' in record ? bundle.programs.find(program => program.id === record.programId)?.universityId : record.universityIds.includes(school.universityId) ? school.universityId : null
      if (owner !== school.universityId || fields.recordScopeSha256 !== fieldRecordScopeSha256(entityType, record)) throw new Error('field_record_scope_changed')
      if (new Date(proposal.source.checkedAt) > acceptedAt || new Date(proposal.review?.reviewedAt ?? '') > acceptedAt) throw new Error('future_field_evidence')
      if (proposal.review?.method !== 'independent_model' && proposal.review?.method !== 'human') throw new Error('independent_field_review_required')
      await verifyReviewedProposalEvidence(proposal, school, options.readArtifact)
      assertAnnualScope(proposal, record, bundle)
      if (proposal.review?.method === 'independent_model') {
        const review = JSON.parse(new TextDecoder().decode(await options.readArtifact(proposal.review.artifactKey!))) as Record<string, unknown>
        if (canonicalJson(review.agreedFields ?? null) !== canonicalJson(fields)) throw new Error('reviewed_field_set_mismatch')
      }
      if (fields.patches.some(patch => !maintainedFieldPaths(proposal.entityType).includes(patch.fieldPath))) throw new Error('field_path_outside_entity_type')
      const next = structuredClone(bundle), nextList = entityType === 'program' ? next.programs : entityType === 'admissionCycle' ? next.admissionCycles : next.scholarships
      const target = nextList.find(row => row.id === record.id)!
      const sourceId = `src-maintenance-field-${createHash('sha256').update(proposal.source.url).digest('hex').slice(0, 24)}`
      const source: Source = { id: sourceId, url: proposal.source.url, title: `Official application information — ${school.name.en ?? school.name.zh ?? school.universityId}`,
        publisher: school.name.en ?? school.name.zh ?? school.universityId, official: true, kind: 'admissions', language: 'other', accessedAt: getTodayDate(new Date(proposal.source.checkedAt)) }
      const existingSource = next.sources.find(row => row.id === sourceId)
      if (existingSource && existingSource.url !== source.url) throw new Error('field_source_identity_conflict')
      if (!existingSource) next.sources.push(source)
      target.sourceIds = [...new Set([...target.sourceIds, sourceId])]
      for (const patch of fields.patches) {
        if (!proposal.fieldEvidence.some(entry => entry.fieldPath === patch.fieldPath)) throw new Error('field_specific_evidence_missing')
        setField(target, patch.fieldPath, patch.value)
      }
      const validBundle = bundleSchema.parse(next), proposalEntries: FieldVerification[] = []
      for (const patch of fields.patches) {
        const evidence = proposal.fieldEvidence.find(entry => entry.fieldPath === patch.fieldPath)!
        const verification: FieldVerification = { entityType, recordId: target.id, recordScopeSha256: fields.recordScopeSha256,
          fieldPath: patch.fieldPath, value: patch.value, valueSha256: fieldValueSha256(patch.value), factStatus: patch.factStatus,
          sourceId, sourceUrl: source.url, snapshotSha256: evidence.snapshotSha256, objectKey: evidence.objectKey, locator: evidence.locator, quote: evidence.quote,
          // Independent review and delivery cannot renew an older official observation.
          verifiedAt: proposal.source.checkedAt, reviewAfter: reviewDate(target, getTodayDate(new Date(proposal.source.checkedAt))),
          review: { method: proposal.review!.method === 'human' ? 'independent' : 'dual-model', reviewerId: proposal.review!.reviewerId },
          receiptPath: options.receiptPath, receiptSha256: '0'.repeat(64) }
        if (!validateFieldVerification(validBundle, verification, today)) throw new Error(`field_value_or_window_invalid:${patch.fieldPath}`)
        proposalEntries.push(verification)
      }
      bundle = validBundle; staged.push(...proposalEntries)
      accepted.push({ proposalId: proposal.id, recordId: record.id, fieldPaths: fields.patches.map(patch => patch.fieldPath) })
    } catch (error) { held.push({ proposalId: proposal.id, reason: error instanceof Error ? error.message : 'field_review_failed' }) }
  }
  const content: Omit<FieldImportReceipt, 'sha256'> = { format: 'studyinchina.field-import-receipt', formatVersion: 1, batchId: batch.batchId,
    batchSha256: batch.sha256, inputCatalogSha256: inputHash, outputCatalogSha256: await catalogSha256(bundle), acceptedAt: options.acceptedAt, accepted,
    fieldBindings: staged.map(entry => ({ entityType: entry.entityType, recordId: entry.recordId, fieldPath: entry.fieldPath, verificationSha256: fieldVerificationContentSha256(entry) })), held }
  const receipt = { ...content, sha256: digest(content) }
  for (const entry of staged) {
    entry.receiptSha256 = receipt.sha256
    const index = entries.findIndex(old => old.entityType === entry.entityType && old.recordId === entry.recordId && old.fieldPath === entry.fieldPath)
    if (index < 0) entries.push(entry); else entries[index] = entry
  }
  return { bundle, entries, receipt, replayed: false }
}
