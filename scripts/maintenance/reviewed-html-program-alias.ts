import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalIdentityJson, identityFingerprint, reviewedProgramAliasAuditSchema, verifiedProgramNameSchema, type ReviewedProgramAliasAudit } from '../../src/lib/data/identity-acceptance'
import { HTML_PROGRAM_ALIAS_RULE, reviewedHtmlAliasProfile } from '../../src/lib/data/reviewed-html-program-alias'
import type { Program } from '../../src/lib/data/types'
import { htmlToText } from '../../workers/ingestion/src/rules'
import { decodeMaintenanceHtml } from '../automation/capture-university-maintenance-sources'
import { proposalContentSha256, type MaintenanceProposal, type ProgramIdentityFields } from './contracts'

const sha = z.string().regex(/^[a-f0-9]{64}$/u)
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const same = (a: unknown, b: unknown) => canonicalIdentityJson(a) === canonicalIdentityJson(b)
const artifact = z.object({ artifactKey: z.string().min(1), sha256: sha }).strict()
const evidence = z.object({ field: z.enum(['name.zh', 'name.en', 'degree', 'international', 'institution', 'neighbour']),
  quote: z.string().min(1), quoteSha256: sha, locator: z.string().min(1), physicalPage: z.null(),
  rangeUnit: z.literal('UTF16_code_units'), utf16Range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(),
  sourceId: z.string().min(1), sourceUrl: z.url(), snapshotSha256: sha, canonicalTextSha256: sha }).strict()
export type HtmlAliasBinding = { canonicalKey: string; recordId: string; aliases: string[] }
export type HtmlAliasContext = { inputCatalogSha256: string; programs: Program[]; bindings: { schemaVersion: 1; entries: HtmlAliasBinding[] } }
const codes = (record: Program) => record as Program & { officialProgramCode?: string; departmentCode?: string }
export function htmlAliasSchoolAudit(context: HtmlAliasContext, universityId: string) {
  const programs = context.programs.filter(record => record.universityId === universityId)
  const ids = new Set(programs.map(record => record.id))
  return {
    inputCatalogSha256: context.inputCatalogSha256,
    bindingsSha256: hash(canonicalIdentityJson(context.bindings)),
    identities: programs.map(record => ({ recordId: record.id, identitySha256: identityFingerprint('program', record),
      officialProgramCode: codes(record).officialProgramCode ?? null, departmentCode: codes(record).departmentCode ?? null })).sort((a, b) => a.recordId.localeCompare(b.recordId)),
    bindings: context.bindings.entries.filter(binding => ids.has(binding.recordId) || binding.canonicalKey.startsWith(`${universityId}|`)
      || binding.aliases.some(alias => alias.startsWith(`${universityId}|`))).sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey)),
  }
}
const auditSchema = z.object({ inputCatalogSha256: sha, bindingsSha256: sha,
  identities: z.array(z.object({ recordId: z.string().min(1), identitySha256: sha, officialProgramCode: z.string().nullable(), departmentCode: z.string().nullable() }).strict()),
  bindings: z.array(z.object({ canonicalKey: z.string().min(1), recordId: z.string().min(1), aliases: z.array(z.string()) }).strict()) }).strict()
export const reviewedHtmlProgramAliasProofSchema = z.object({
  format: z.literal('studyinchina.reviewed-program-identity-alias'), formatVersion: z.literal(1), ruleVersion: z.literal(HTML_PROGRAM_ALIAS_RULE),
  decision: z.literal('approved_identity_alias_only'), reviewedAt: z.iso.datetime(), reviewerId: z.literal('codex-root'),
  reviewMethod: z.literal('independent_exact_record_html_metadata_review'),
  recordId: z.string().min(1), universityId: z.string().min(1), degreeLevel: z.literal('master'), programType: z.literal('degree'),
  existingIdentitySha256: sha, oldNames: z.object({ en: z.string(), zh: z.string() }).strict(), verifiedName: verifiedProgramNameSchema,
  proposalId: z.string().min(1), proposalContentSha256: sha,
  source: reviewedProgramAliasAuditSchema.shape.source.extend({ contentType: z.literal('text/html'), checkedAt: z.iso.datetime() }).strict(),
  officialEvidence: z.array(evidence).min(4),
  origin: z.object({ firstImportCommit: z.string(), programsGitBlob: z.string(), originalFile: z.string(), candidateId: z.string(),
    pack: artifact, candidate: artifact, firstRecord: artifact, interpretation: z.literal('exact_record_degree_metadata_only_not_author_intent') }).strict(),
  currentIdentityAudit: auditSchema,
  sameUrlNeighbours: z.array(z.object({ recordId: z.string(), identitySha256: sha, distinctLiteral: z.string(), evidenceIndex: z.number().int().nonnegative() }).strict()),
  rootApproval: artifact,
}).strict()
export type ReviewedHtmlProgramAliasProof = z.infer<typeof reviewedHtmlProgramAliasProofSchema>

/** A separate approval artifact seals the entire proposed correspondence,
 * including locators, origin metadata and current identity/binding context. */
export function htmlAliasApprovalSubjectSha256(proof: ReviewedHtmlProgramAliasProof): string {
  const { rootApproval: _rootApproval, ...subject } = proof
  void _rootApproval
  return hash(canonicalIdentityJson(subject))
}
const approvalSchema = z.object({ format: z.literal('studyinchina.reviewed-html-alias-root-approval'), formatVersion: z.literal(1),
  ruleVersion: z.literal(HTML_PROGRAM_ALIAS_RULE), decision: z.literal('approved_identity_alias_only'), reviewerId: z.literal('codex-root'),
  reviewedAt: z.iso.datetime(), subjectSha256: sha }).strict()

export async function resolveReviewedHtmlProgramAlias(loaded: { proof: ReviewedHtmlProgramAliasProof; ref: z.infer<typeof artifact> },
  proposal: MaintenanceProposal, fields: ProgramIdentityFields, programs: Program[], acceptedAt: string,
  readArtifact: (key: string) => Promise<Uint8Array>, context?: HtmlAliasContext): Promise<{ record: Program; audit: ReviewedProgramAliasAudit }> {
  const { proof, ref } = loaded, profile = reviewedHtmlAliasProfile(proof.recordId)
  const record = programs.find(item => item.id === proof.recordId), source = proposal.source
  if (!profile || !record || !context || context.inputCatalogSha256 !== proof.currentIdentityAudit.inputCatalogSha256
    || !same(htmlAliasSchoolAudit(context, profile.universityId), proof.currentIdentityAudit)
    || !same(htmlAliasSchoolAudit({ ...context, programs }, profile.universityId).identities, proof.currentIdentityAudit.identities)) throw Error('html_alias_current_identity_context_mismatch')
  if (proof.universityId !== profile.universityId || record.universityId !== profile.universityId || proposal.universityId !== profile.universityId
    || proof.existingIdentitySha256 !== profile.identitySha256 || identityFingerprint('program', record) !== profile.identitySha256
    || record.degreeLevel !== profile.degreeLevel || fields.degreeLevel !== profile.degreeLevel || fields.programType !== profile.programType
    || !same(proof.oldNames, profile.oldNames) || Object.entries(profile.oldNames).some(([locale, name]) => record.name[locale as 'en' | 'zh'] !== name)
    || !same(proof.verifiedName, fields.name) || !Object.entries(proof.verifiedName).length
    || Object.entries(proof.verifiedName).some(([locale, name]) => (profile.allowedNames as Record<string, string>)[locale] !== name)
    || proof.proposalId !== proposal.id || proof.proposalContentSha256 !== await proposalContentSha256(proposal)
    || (proposal.recordId !== null && proposal.recordId !== record.id) || new Date(proof.reviewedAt) > new Date(acceptedAt)
    || fields.officialProgramCode || fields.departmentCode || codes(record).officialProgramCode || codes(record).departmentCode
    || proof.currentIdentityAudit.bindings.some(binding => binding.recordId === record.id && (binding.canonicalKey.includes('|code:') || binding.aliases.some(alias => alias.includes('|code:'))))) throw Error('html_alias_exact_identity_binding_mismatch')
  if (source.url !== profile.sourceUrl || fields.programUrl !== profile.sourceUrl || record.programUrl !== profile.sourceUrl
    || proof.source.url !== profile.sourceUrl || source.id !== profile.sourceId || proof.source.sourceId !== profile.sourceId
    || source.snapshotSha256 !== profile.rawSha256 || proof.source.snapshotSha256 !== profile.rawSha256
    || proof.source.canonicalTextSha256 !== profile.textSha256 || source.objectKey !== proof.source.objectKey
    || source.contentType !== 'text/html' || source.textArtifact !== undefined || source.checkedAt !== proof.source.checkedAt
    || new Date(source.checkedAt) > new Date(acceptedAt) || new Date(source.checkedAt) > new Date(proof.reviewedAt)) throw Error('html_alias_source_binding_mismatch')
  const checkedArtifact = async (reference: z.infer<typeof artifact>, expectedSha = reference.sha256) => {
    const bytes = await readArtifact(reference.artifactKey)
    if (reference.sha256 !== expectedSha || hash(bytes) !== expectedSha) throw Error('html_alias_artifact_checksum_mismatch')
    return bytes
  }
  const raw = await checkedArtifact({ artifactKey: source.objectKey, sha256: source.snapshotSha256 })
  const textBytes = await checkedArtifact({ artifactKey: proof.source.textArtifactKey, sha256: profile.textSha256 })
  const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
  if (htmlToText(decodeMaintenanceHtml(raw, source.contentType)) !== text) throw Error('html_alias_raw_text_projection_mismatch')
  for (const item of proof.officialEvidence) {
    const { start, end } = item.utf16Range
    if (item.sourceId !== profile.sourceId || item.sourceUrl !== profile.sourceUrl || item.snapshotSha256 !== profile.rawSha256
      || item.canonicalTextSha256 !== profile.textSha256 || item.quoteSha256 !== hash(item.quote) || end <= start
      || end > text.length || text.slice(start, end) !== item.quote || item.locator !== `text:offset:${start}:${end}`) throw Error('html_alias_quote_binding_mismatch')
  }
  for (const field of [...Object.keys(proof.verifiedName).map(locale => `name.${locale}`), 'degree', 'international', 'institution']) {
    const key = field.startsWith('name.') ? field.slice(5) : field
    const quote = (profile.quotes as Record<string, string>)[key]
    if (!quote || !proof.officialEvidence.some(item => item.field === field && item.quote === quote)) throw Error('html_alias_literal_scope_unproven')
  }
  const neighbours = programs.filter(item => item.id !== record.id && item.universityId === record.universityId
    && item.degreeLevel === record.degreeLevel && item.programUrl === record.programUrl)
  if (!same(neighbours.map(item => ({ recordId: item.id, identitySha256: identityFingerprint('program', item) })).sort((a, b) => a.recordId.localeCompare(b.recordId)),
    profile.sameUrlNeighbours.map(item => ({ recordId: item.recordId, identitySha256: item.identitySha256 })))
    || proof.sameUrlNeighbours.length !== profile.sameUrlNeighbours.length) throw Error('html_alias_same_url_neighbour_mismatch')
  for (const neighbour of profile.sameUrlNeighbours) {
    const item = proof.sameUrlNeighbours.find(item => item.recordId === neighbour.recordId)
    const quote = item && proof.officialEvidence[item.evidenceIndex]
    if (!item || item.identitySha256 !== neighbour.identitySha256 || item.distinctLiteral !== neighbour.distinctLiteral
      || quote?.field !== 'neighbour' || quote.quote !== neighbour.quote || !quote.quote.includes(neighbour.distinctLiteral)
      || neighbour.distinctLiteral === (profile.allowedNames as Record<string, string>).zh) throw Error('html_alias_neighbour_distinction_unproven')
  }
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
  const names = new Set(Object.values(proof.verifiedName).map(normalize))
  if (programs.some(item => item.id !== record.id && item.universityId === record.universityId && item.degreeLevel === record.degreeLevel
    && (Object.values(item.name).some(name => name && names.has(normalize(name))) || codes(item).officialProgramCode || codes(item).departmentCode))
    || proof.currentIdentityAudit.bindings.some(binding => binding.recordId !== record.id
      && [binding.canonicalKey, ...binding.aliases].some(key => key.startsWith(`${record.universityId}|${record.degreeLevel}|`)
        && (key.includes('|code:') || [...names].some(name => key.endsWith(`|name:${name}`)))))) throw Error('html_alias_identity_or_code_conflict')
  if (proof.origin.firstImportCommit !== profile.origin.firstImportCommit || proof.origin.programsGitBlob !== profile.origin.programsGitBlob
    || proof.origin.originalFile !== profile.origin.originalFile || proof.origin.candidateId !== profile.origin.candidateId) throw Error('html_alias_origin_metadata_mismatch')
  const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  await checkedArtifact(proof.origin.pack, profile.origin.packSha256)
  const candidate = parse(await checkedArtifact(proof.origin.candidate, profile.origin.candidateSha256))
  const firstRecord = parse(await checkedArtifact(proof.origin.firstRecord, profile.origin.firstRecordSha256))
  if (candidate.candidateId !== profile.origin.candidateId || candidate.level !== 'master' || candidate.programType !== 'degree'
    || candidate.evidence?.officialUrl !== profile.sourceUrl || !same(candidate.name, firstRecord.name)
    || firstRecord.id !== record.id || firstRecord.universityId !== record.universityId || firstRecord.degreeLevel !== 'master'
    || firstRecord.programUrl !== profile.sourceUrl || identityFingerprint('program', firstRecord) !== profile.identitySha256) throw Error('html_alias_origin_record_mismatch')
  const approval = approvalSchema.parse(parse(await checkedArtifact(proof.rootApproval)))
  if (approval.subjectSha256 !== htmlAliasApprovalSubjectSha256(proof) || approval.reviewedAt !== proof.reviewedAt
    || new Date(approval.reviewedAt) > new Date(acceptedAt)) throw Error('html_alias_root_approval_subject_mismatch')
  return { record, audit: reviewedProgramAliasAuditSchema.parse({ ruleVersion: HTML_PROGRAM_ALIAS_RULE,
    proofArtifactKey: ref.artifactKey, proofSha256: ref.sha256, existingIdentitySha256: profile.identitySha256,
    proposalId: proposal.id, proposalContentSha256: proof.proposalContentSha256,
    source: { sourceId: profile.sourceId, url: profile.sourceUrl, snapshotSha256: profile.rawSha256,
      objectKey: source.objectKey, canonicalTextSha256: profile.textSha256, textArtifactKey: proof.source.textArtifactKey } }) }
}
