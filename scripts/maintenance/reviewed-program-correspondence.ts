import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalIdentityJson, identityFingerprint, reviewedProgramAliasAuditSchema, type ReviewedProgramAliasAudit } from '../../src/lib/data/identity-acceptance'
import { PROGRAM_CORRESPONDENCE_RULE, reviewedProgramCorrespondenceProfile } from '../../src/lib/data/reviewed-program-correspondence'
import type { Program } from '../../src/lib/data/types'
import { htmlToText } from '../../workers/ingestion/src/rules'
import { decodeMaintenanceHtml } from '../automation/capture-university-maintenance-sources'
import { proposalContentSha256, type MaintenanceProposal, type ProgramIdentityFields } from './contracts'

const sha = z.string().regex(/^[a-f0-9]{64}$/u)
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const same = (a: unknown, b: unknown) => canonicalIdentityJson(a) === canonicalIdentityJson(b)
const ref = z.object({ artifactKey: z.string().min(1), sha256: sha }).strict()
const range = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()
const evidence = z.object({ field: z.enum(['name', 'degree', 'international', 'institution']), quote: z.string().min(1),
  quoteSha256: sha, utf16Range: range, physicalPage: z.number().int().positive().nullable(), locator: z.string().min(1) }).strict()
const codes = (p: Program) => p as Program & { officialProgramCode?: string; departmentCode?: string }
export type CorrespondenceContext = { inputCatalogSha256: string; programs: Program[];
  bindings: { schemaVersion: 1; entries: Array<{ canonicalKey: string; recordId: string; aliases: string[] }> } }
export function correspondenceSchoolAudit(context: CorrespondenceContext, universityId: string) {
  const peers = context.programs.filter(p => p.universityId === universityId), ids = new Set(peers.map(p => p.id))
  return { inputCatalogSha256: context.inputCatalogSha256, bindingsSha256: hash(canonicalIdentityJson(context.bindings)),
    identities: peers.map(p => ({ recordId: p.id, identitySha256: identityFingerprint('program', p),
      officialProgramCode: codes(p).officialProgramCode ?? null, departmentCode: codes(p).departmentCode ?? null })),
    bindings: context.bindings.entries.filter(b => ids.has(b.recordId) || [b.canonicalKey, ...b.aliases].some(k => k.startsWith(universityId + '|'))) }
}
const audit = z.object({ inputCatalogSha256: sha, bindingsSha256: sha,
  identities: z.array(z.object({ recordId: z.string(), identitySha256: sha, officialProgramCode: z.string().nullable(), departmentCode: z.string().nullable() }).strict()),
  bindings: z.array(z.object({ canonicalKey: z.string(), recordId: z.string(), aliases: z.array(z.string()) }).strict()) }).strict()
export const programCorrespondenceProofSchema = z.object({
  format: z.literal('studyinchina.reviewed-official-program-correspondence'), version: z.literal(1), ruleVersion: z.literal(PROGRAM_CORRESPONDENCE_RULE),
  decision: z.literal('approved_existing_identity_only'), reviewerId: z.literal('codex-root'), reviewedAt: z.iso.datetime(),
  reviewMethod: z.literal('independent_exact_record_source_correspondence'),
  recordId: z.string().min(1), universityId: z.string().min(1), existingIdentitySha256: sha,
  verifiedName: z.object({ zh: z.string().min(1) }).strict(), degreeLevel: z.literal('master'), programType: z.literal('degree'),
  proposalId: z.string().min(1), proposalContentSha256: sha,
  source: reviewedProgramAliasAuditSchema.shape.source.extend({ contentType: z.enum(['text/html', 'application/pdf']),
    parser: z.enum(['html', 'poppler']), physicalPages: z.number().int().positive().nullable(), checkedAt: z.iso.datetime() }).strict(),
  officialEvidence: z.array(evidence).length(4), currentIdentityAudit: audit,
  nativeProof: ref.nullable(), sourceResearch: ref,
  renameAuthority: z.object({ url: z.url(), raw: ref, canonicalText: ref, quote: z.string(), utf16Range: range,
    categoryCodeIsNotInstitutionProgrammeCode: z.literal(true) }).strict().nullable(),
  originalModelEvidence: z.object({ proposal: ref, attempts: ref, review: ref,
    originalModelCandidateUnchanged: z.literal(true), normalizedCandidateReviewedByRootOnly: z.literal(true) }).strict().nullable(),
  codeReview: ref, rootApproval: ref,
}).strict()
export type ProgramCorrespondenceProof = z.infer<typeof programCorrespondenceProofSchema>
export function correspondenceApprovalSubjectSha256(proof: ProgramCorrespondenceProof): string {
  const { rootApproval: ignored, ...subject } = proof; void ignored
  return hash(canonicalIdentityJson(subject))
}
const approvalSchema = z.object({ format: z.literal('studyinchina.official-correspondence-root-approval'), version: z.literal(1),
  ruleVersion: z.literal(PROGRAM_CORRESPONDENCE_RULE), reviewerId: z.literal('codex-root'), decision: z.literal('approved_existing_identity_only'),
  reviewedAt: z.iso.datetime(), subjectSha256: sha }).strict()
const codeSchema = z.object({ format: z.literal('studyinchina.official-correspondence-code-review'), version: z.literal(1),
  ruleVersion: z.literal(PROGRAM_CORRESPONDENCE_RULE), reviewerId: z.literal('codex-root'), decision: z.literal('approved'),
  reviewedAt: z.iso.datetime(), allowedRecords: z.array(z.string()).length(2),
  dependencyPins: z.array(z.object({ file: z.string(), sha256: sha }).strict()).min(3)
    .refine(pins => new Set(pins.map(p => p.file)).size === pins.length) }).strict()
const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
const fail = (reason: string): never => { throw Error('program_correspondence_' + reason) }
const check = (ok: unknown, reason: string) => { if (!ok) fail(reason) }

/** External proof registration remains mandatory at the general importer. This
 * verifier permits these two exact records only; it never rewrites arbitrary names. */
export async function resolveProgramCorrespondence(loaded: { proof: ProgramCorrespondenceProof; ref: z.infer<typeof ref> },
  proposal: MaintenanceProposal, fields: ProgramIdentityFields, programs: Program[], acceptedAt: string,
  readArtifact: (key: string) => Promise<Uint8Array>, context?: CorrespondenceContext): Promise<{ record: Program; audit: ReviewedProgramAliasAudit }> {
  const { proof, ref: reference } = loaded, profile = reviewedProgramCorrespondenceProfile(proof.recordId)
  const record = programs.find(p => p.id === proof.recordId)
  check(profile && record && context, 'exact_profile_record_and_context_required')
  const p = profile!, r = record!, ctx = context!
  check(same(correspondenceSchoolAudit(ctx, p.universityId), proof.currentIdentityAudit)
    && same(correspondenceSchoolAudit({ ...ctx, programs }, p.universityId), proof.currentIdentityAudit), 'current_school_audit_changed')
  check(proposal.operation === 'patch' && proposal.entityType === 'program' && proposal.recordId === p.recordId
    && proposal.universityId === p.universityId && proof.universityId === p.universityId && r.universityId === p.universityId
    && r.degreeLevel === 'master' && proof.existingIdentitySha256 === p.identitySha256 && identityFingerprint('program', r) === p.identitySha256
    && r.programUrl === p.existingProgramUrl && Object.entries(p.oldNames).every(([locale, name]) => r.name[locale as 'zh' | 'en'] === name)
    && same(proof.verifiedName, p.verifiedName) && same(fields.name, p.verifiedName)
    && proof.proposalId === proposal.id && proof.proposalContentSha256 === await proposalContentSha256(proposal)
    && proposal.scope.year === null && proposal.scope.intake === null && !codes(r).officialProgramCode && !codes(r).departmentCode,
  'identity_binding_changed')
  check(same(fields, { name: p.verifiedName, degreeLevel: 'master', programType: 'degree', programUrl: p.sourceUrl,
    internationalAdmissionsEvidence: fields.internationalAdmissionsEvidence }), 'unreviewed_identity_or_dynamic_field')
  check(!proof.currentIdentityAudit.bindings.some(b => b.recordId === p.recordId
    && [b.canonicalKey, ...b.aliases].some(k => k.includes('|code:'))), 'existing_code_binding_requires_review')
  const normalize = (n: string) => n.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const targetName = normalize(p.verifiedName.zh)
  check(!programs.some(other => other.id !== r.id && other.universityId === r.universityId && other.degreeLevel === r.degreeLevel
    && (Object.values(other.name).some(n => n && normalize(n) === targetName) || codes(other).officialProgramCode || codes(other).departmentCode))
    && !proof.currentIdentityAudit.bindings.some(b => b.recordId !== r.id && [b.canonicalKey, ...b.aliases].some(k =>
      k.startsWith(p.universityId + '|master|') && (k.includes('|code:') || k.endsWith('|name:' + targetName)))), 'identity_or_code_conflict')
  const source = proposal.source
  check(source.url === p.sourceUrl && fields.programUrl === p.sourceUrl && source.id === p.sourceId && source.snapshotSha256 === p.rawSha256
    && proof.source.url === p.sourceUrl && proof.source.sourceId === p.sourceId && proof.source.snapshotSha256 === p.rawSha256
    && proof.source.objectKey === source.objectKey && proof.source.canonicalTextSha256 === p.textSha256
    && proof.source.checkedAt === source.checkedAt && proof.source.parser === p.parser && proof.source.physicalPages === p.physicalPages
    && Number.isFinite(Date.parse(proof.reviewedAt)) && new Date(source.checkedAt) <= new Date(proof.reviewedAt)
    && new Date(proof.reviewedAt) <= new Date(acceptedAt), 'source_or_time_binding_changed')
  const checked = async (item: z.infer<typeof ref>, expected = item.sha256) => {
    const bytes = await readArtifact(item.artifactKey); check(item.sha256 === expected && hash(bytes) === expected, 'artifact_checksum_changed'); return bytes
  }
  const raw = await checked({ artifactKey: source.objectKey, sha256: p.rawSha256 })
  const textBytes = await checked({ artifactKey: proof.source.textArtifactKey, sha256: p.textSha256 })
  const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
  if (p.parser === 'html') {
    check(source.contentType === 'text/html' && proof.source.contentType === 'text/html' && source.textArtifact === undefined
      && proof.nativeProof === null && htmlToText(decodeMaintenanceHtml(raw, source.contentType)) === text, 'html_provenance_changed')
  } else {
    check(source.contentType === 'application/pdf' && proof.source.contentType === 'application/pdf' && source.textArtifact?.parser === 'poppler'
      && source.textArtifact.objectKey === proof.source.textArtifactKey && source.textArtifact.sha256 === p.textSha256
      && source.textArtifact.rawSnapshotSha256 === p.rawSha256 && new TextDecoder().decode(raw.slice(0, 5)) === '%PDF-'
      && text.split('\f').length === 7 && text.split('\f').every(page => page.trim()) && proof.nativeProof, 'complete_native_pdf_required')
    const native = parse(await checked(proof.nativeProof!, p.nativeProofSha256!)) as Record<string, unknown>
    check(native.format === 'studyinchina.native-pdf-extraction-provenance' && native.rawSha256 === p.rawSha256
      && native.canonicalTextSha256 === p.textSha256 && native.physicalPages === 7 && native.allPhysicalPagesPreserved === true
      && native.ocrUsed === false && native.textRepairPerformed === false, 'native_pdf_provenance_changed')
  }
  for (const kind of ['name', 'degree', 'international', 'institution'] as const) {
    const items = proof.officialEvidence.filter(e => e.field === kind); check(items.length === 1, 'evidence_missing_or_duplicate')
    const item = items[0], { start, end } = item.utf16Range, page = p.parser === 'poppler' ? kind === 'institution' ? 1 : 2 : null
    check(item.quote === p.quotes[kind] && item.quoteSha256 === hash(item.quote) && end > start && text.slice(start, end) === item.quote
      && item.physicalPage === page && item.locator === (page === null ? `text:offset:${start}:${end}` : `page ${page}`)
      && (page === null || text.slice(0, start).split('\f').length === page), 'literal_evidence_changed')
  }
  const byField = (kind: string) => proof.officialEvidence.find(e => e.field === kind)!
  const matches = (e: unknown, kind: string) => e !== null && typeof e === 'object'
    && same(e, { sourceId: p.sourceId, url: p.sourceUrl, snapshotSha256: p.rawSha256, objectKey: source.objectKey,
      locator: byField(kind).locator, quote: byField(kind).quote })
  check(matches(fields.internationalAdmissionsEvidence, 'international') && proposal.fieldEvidence.length === 3
    && new Set(proposal.fieldEvidence.map(e => e.fieldPath)).size === 3
    && proposal.fieldEvidence.every(e => {
      const { fieldPath, ...value } = e
      return ['name.zh', 'degreeLevel', 'programType'].includes(fieldPath) && matches(value, fieldPath === 'name.zh' ? 'name' : 'degree')
    }) && source.quote === byField('degree').quote && source.locator === byField('degree').locator, 'candidate_evidence_changed')
  if (p.authority) {
    const authority = proof.renameAuthority; check(authority && authority.url === p.authority.url && authority.quote === p.authority.quote, 'rename_authority_required')
    const body = await checked(authority!.raw, p.authority.rawSha256), derived = new TextDecoder().decode(await checked(authority!.canonicalText, p.authority.textSha256))
    check(htmlToText(decodeMaintenanceHtml(body, 'text/html')) === derived
      && derived.slice(authority!.utf16Range.start, authority!.utf16Range.end) === p.authority.quote
      && derived.includes('全国汉语国际教育专业学位研究生教育指导委员会'), 'rename_authority_scope_changed')
    // The preserved M3 result is provenance, not approval of the normalized candidate.
    const model = proof.originalModelEvidence; check(model, 'original_two_pass_model_evidence_required')
    const original = parse(await checked(model!.proposal, p.originalModel.proposalSha256)) as MaintenanceProposal
    const attempts = parse(await checked(model!.attempts, p.originalModel.attemptsSha256)) as Array<Record<string, unknown>>
    await checked(model!.review, p.originalModel.reviewSha256)
    check(original.review?.method === 'independent_model' && original.review.decision === 'approved'
      && original.review.candidateSha256 === await proposalContentSha256(original) && original.review.reviewArtifactSha256 === p.originalModel.reviewSha256
      && same(original.fields.name, { zh: p.originalModel.originalName }) && original.fields.degreeLevel === 'master'
      && original.source.url === p.sourceUrl && original.source.snapshotSha256 === p.rawSha256 && attempts.length === 2
      && attempts.every(a => a.status === 'completed' && a.model === 'MiniMax-M3' && a.source_id === p.sourceId && a.snapshot_sha256 === p.rawSha256)
      && attempts.some(a => a.pass === 'primary' && a.attempt_id === original.extractionAttemptId)
      && attempts.some(a => a.pass === 'independent-review' && a.attempt_id === original.review?.reviewAttemptId), 'original_model_evidence_changed')
  } else check(proof.renameAuthority === null && proof.originalModelEvidence === null
    && r.name.zh === '药学' + '专业型硕士' && text.includes(p.quotes.degree), 'qualification_correspondence_changed')
  const research = parse(await checked(proof.sourceResearch)) as Record<string, unknown>
  check(research.format === 'studyinchina.independent-official-correspondence-source-reading'
    && research.recordId === r.id && research.universityId === p.universityId && research.existingIdentitySha256 === p.identitySha256
    && research.sourceRawSha256 === p.rawSha256 && research.sourceTextSha256 === p.textSha256
    && same(research.proposedVerifiedName, p.verifiedName) && research.independentAssistantSourceReading === true
    && research.humanReviewClaimed === false && research.modelReviewOfNormalizedCandidateClaimed === false
    && research.currentApplicationFactsApproved === false && research.officialProgrammeCodeObserved === false, 'independent_source_reading_changed')
  const code = codeSchema.parse(parse(await checked(proof.codeReview)))
  check(same([...code.allowedRecords].sort(), ['prog-gap-breadth-jnmc-m-pharmacy', 'prog-gap-mew-csw-ccnu-international-chinese-education-master'].sort())
    && new Date(code.reviewedAt) <= new Date(proof.reviewedAt), 'code_review_scope_changed')
  const approval = approvalSchema.parse(parse(await checked(proof.rootApproval)))
  check(approval.subjectSha256 === correspondenceApprovalSubjectSha256(proof) && approval.reviewedAt === proof.reviewedAt, 'root_approval_subject_changed')
  return { record: r, audit: reviewedProgramAliasAuditSchema.parse({ ruleVersion: PROGRAM_CORRESPONDENCE_RULE,
    proofArtifactKey: reference.artifactKey, proofSha256: reference.sha256, existingIdentitySha256: p.identitySha256,
    proposalId: proposal.id, proposalContentSha256: proof.proposalContentSha256,
    source: { sourceId: p.sourceId, url: p.sourceUrl, snapshotSha256: p.rawSha256, objectKey: source.objectKey,
      canonicalTextSha256: p.textSha256, textArtifactKey: proof.source.textArtifactKey } }) }
}
