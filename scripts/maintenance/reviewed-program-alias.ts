import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalIdentityJson, identityFingerprint, reviewedProgramAliasAuditSchema, type ReviewedProgramAliasAudit } from '../../src/lib/data/identity-acceptance'
import type { Program } from '../../src/lib/data/types'
import { proposalContentSha256, type MaintenanceProposal, type ProgramIdentityFields } from './contracts'
import { HTML_PROGRAM_ALIAS_RULE } from '../../src/lib/data/reviewed-html-program-alias'
import { reviewedHtmlProgramAliasProofSchema, resolveReviewedHtmlProgramAlias, type HtmlAliasContext, type ReviewedHtmlProgramAliasProof } from './reviewed-html-program-alias'

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const sha = z.string().regex(/^[a-f0-9]{64}$/u)
const sourceSchema = reviewedProgramAliasAuditSchema.shape.source
const evidenceSchema = z.object({ field: z.enum(['name', 'degree', 'teachingLanguage', 'international', 'institution']),
  quote: z.string().min(1), quoteSha256: sha, locator: z.string(), physicalPage: z.number().int().positive(), canonicalTextSha256: sha,
  utf16Range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }),
  sourceId: z.string(), sourceUrl: z.url(), snapshotSha256: sha })
const proofSchema = z.object({
  format: z.literal('studyinchina.reviewed-program-identity-alias'), formatVersion: z.literal(1),
  ruleVersion: z.literal('suep-explicit-metadata-suffix-v1'), decision: z.literal('approved_identity_alias_only'),
  reviewedAt: z.iso.datetime(), reviewMethod: z.literal('assistant_independent_official_source_review'), reviewerId: z.string().min(1),
  universityId: z.literal('uni-shanghai-university-of-electric-power'),
  recordId: z.literal('prog-gap-wave8-2-suep-international-economy-trade-bachelor'), existingIdentitySha256: sha,
  proposalId: z.string().min(1), proposalContentSha256: sha, degreeLevel: z.literal('bachelor'), programType: z.literal('degree'),
  oldName: z.object({ locale: z.literal('en'), value: z.literal("International Economy and Trade (English-taught Bachelor's Program)") }),
  verifiedName: z.object({ en: z.literal('International Economy and Trade') }).strict(),
  allowedRemovalLiteral: z.literal(" (English-taught Bachelor's Program)"), newNameLiteral: z.literal('International Economy and Trade'),
  source: sourceSchema.extend({ contentType: z.literal('application/pdf'), parser: z.literal('poppler'), physicalPages: z.number().int().positive(), checkedAt: z.iso.datetime().optional() }),
  officialEvidence: z.array(evidenceSchema).min(5),
  metadataMapping: z.object({ removedSuffixHasOnlyMetadata: z.literal(true), realDirectionRemoved: z.literal(false),
    exactDecomposition: z.object({ officialNameLiteral: z.literal('International Economy and Trade'), metadataSuffixLiteral: z.literal(" (English-taught Bachelor's Program)") }),
    degree: z.object({ existingAndCandidate: z.literal('bachelor'), evidenceIndexes: z.array(z.number().int().nonnegative()).min(1) }),
    teachingLanguage: z.object({ literal: z.literal('English-taught'), evidenceIndexes: z.array(z.number().int().nonnegative()).min(1) }) }),
  officialProgramCode: z.object({ existing: z.null(), candidate: z.null(), conflict: z.literal(false) }),
  departmentCode: z.object({ existing: z.null(), candidate: z.null(), conflict: z.literal(false) }),
})
export type ReviewedProgramAliasRef = { artifactKey: string; sha256: string }
export type LoadedProgramAlias = { proof: z.infer<typeof proofSchema> | ReviewedHtmlProgramAliasProof; ref: ReviewedProgramAliasRef }

/** An opt-in artifact is additional authority, never a mutation of the original
 * extraction/review. All source artifacts remain subject to formal import checks. */
export async function loadReviewedProgramAliases(refs: ReviewedProgramAliasRef[], proposals: MaintenanceProposal[],
  readArtifact: (key: string) => Promise<Uint8Array>): Promise<LoadedProgramAlias[]> {
  const result: LoadedProgramAlias[] = [], seen = new Set<string>()
  for (const ref of refs) {
    if (!ref.artifactKey || !/^[a-f0-9]{64}$/u.test(ref.sha256)) throw Error('reviewed_alias_reference_invalid')
    const bytes = await readArtifact(ref.artifactKey)
    if (hash(bytes) !== ref.sha256) throw Error('reviewed_alias_artifact_checksum_mismatch')
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const proof = input.ruleVersion === HTML_PROGRAM_ALIAS_RULE ? reviewedHtmlProgramAliasProofSchema.parse(input) : proofSchema.parse(input)
    if (seen.has(proof.proposalId)) throw Error('reviewed_alias_duplicate_proposal')
    if (!proposals.some(proposal => proposal.id === proof.proposalId)) throw Error('reviewed_alias_proposal_missing')
    seen.add(proof.proposalId); result.push({ proof, ref })
  }
  return result
}

export async function resolveReviewedProgramAlias(loaded: LoadedProgramAlias | undefined, proposal: MaintenanceProposal,
  fields: ProgramIdentityFields, programs: Program[], acceptedAt: string,
  readArtifact: (key: string) => Promise<Uint8Array>, context?: HtmlAliasContext): Promise<{ record: Program; audit: ReviewedProgramAliasAudit } | undefined> {
  if (!loaded) return undefined
  if (loaded.proof.ruleVersion === HTML_PROGRAM_ALIAS_RULE)
    return resolveReviewedHtmlProgramAlias({ proof: loaded.proof, ref: loaded.ref }, proposal, fields, programs, acceptedAt, readArtifact, context)
  const { proof, ref } = loaded, source = proposal.source, record = programs.find(program => program.id === proof.recordId)
  if (!record || proof.proposalId !== proposal.id || proof.proposalContentSha256 !== await proposalContentSha256(proposal)
    || proof.existingIdentitySha256 !== identityFingerprint('program', record)
    || record.universityId !== proof.universityId || proposal.universityId !== proof.universityId
    || record.degreeLevel !== proof.degreeLevel || fields.degreeLevel !== proof.degreeLevel || fields.programType !== proof.programType
    || record.name.en !== proof.oldName.value || canonicalIdentityJson(fields.name) !== canonicalIdentityJson(proof.verifiedName)
    || record.programUrl !== proof.source.url || fields.programUrl !== proof.source.url || source.url !== proof.source.url
    || (proposal.recordId !== null && proposal.recordId !== record.id) || new Date(proof.reviewedAt) > new Date(acceptedAt)
    || fields.officialProgramCode || fields.departmentCode) throw Error('reviewed_alias_identity_binding_mismatch')
  if (programs.filter(program => program.universityId === record.universityId && program.degreeLevel === record.degreeLevel
    && program.programUrl === record.programUrl).length !== 1) throw Error('reviewed_alias_existing_identity_ambiguous')
  if (programs.some(program => program.id !== record.id && program.universityId === record.universityId && program.degreeLevel === record.degreeLevel
    && Object.values(program.name).includes(proof.newNameLiteral))) throw Error('reviewed_alias_candidate_name_already_exists')
  if (source.id !== proof.source.sourceId || source.snapshotSha256 !== proof.source.snapshotSha256 || source.objectKey !== proof.source.objectKey
    || !source.textArtifact || source.textArtifact.objectKey !== proof.source.textArtifactKey
    || source.textArtifact.sha256 !== proof.source.canonicalTextSha256 || source.textArtifact.rawSnapshotSha256 !== proof.source.snapshotSha256
    || source.contentType !== 'application/pdf') throw Error('reviewed_alias_source_binding_mismatch')
  const raw = await readArtifact(source.objectKey), textBytes = await readArtifact(source.textArtifact.objectKey)
  if (hash(raw) !== proof.source.snapshotSha256 || hash(textBytes) !== proof.source.canonicalTextSha256) throw Error('reviewed_alias_source_checksum_mismatch')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes)
  if (text.split('\f').filter(page => page.trim()).length !== proof.source.physicalPages) throw Error('reviewed_alias_pdf_pages_missing')
  for (const evidence of proof.officialEvidence) {
    const { start, end } = evidence.utf16Range
    if (evidence.sourceId !== source.id || evidence.sourceUrl !== source.url || evidence.snapshotSha256 !== source.snapshotSha256
      || evidence.canonicalTextSha256 !== proof.source.canonicalTextSha256 || hash(evidence.quote) !== evidence.quoteSha256
      || evidence.locator !== `page ${evidence.physicalPage}` || end <= start || end > text.length
      || text.slice(start, end) !== evidence.quote || text.slice(0, start).split('\f').length !== evidence.physicalPage
      || !(text.split('\f')[evidence.physicalPage - 1] ?? '').includes(evidence.quote)) throw Error('reviewed_alias_quote_binding_mismatch')
  }
  for (const field of ['name', 'degree', 'teachingLanguage', 'international', 'institution'])
    if (!proof.officialEvidence.some(evidence => evidence.field === field)) throw Error('reviewed_alias_evidence_field_missing')
  if (!proof.officialEvidence.some(evidence => evidence.field === 'name' && evidence.quote.includes(proof.newNameLiteral)
    && evidence.quote.includes('Catalog of Undergraduate Programs (English-taught)'))
    || !proof.officialEvidence.some(evidence => evidence.field === 'international' && evidence.quote.includes('non-Chinese citizens'))
    || !proof.officialEvidence.some(evidence => evidence.field === 'institution' && evidence.quote.includes('Shanghai University of Electric Power'))) throw Error('reviewed_alias_literal_scope_unproven')
  for (const [mapping, allowedFields] of [[proof.metadataMapping.degree, ['name', 'degree']], [proof.metadataMapping.teachingLanguage, ['name', 'teachingLanguage']]] as const)
    if (!mapping.evidenceIndexes.every(index => proof.officialEvidence[index] && (allowedFields as readonly string[]).includes(proof.officialEvidence[index].field))) throw Error('reviewed_alias_metadata_evidence_invalid')
  return { record, audit: reviewedProgramAliasAuditSchema.parse({ ruleVersion: proof.ruleVersion, proofArtifactKey: ref.artifactKey,
    proofSha256: ref.sha256, existingIdentitySha256: proof.existingIdentitySha256, proposalId: proof.proposalId,
    proposalContentSha256: proof.proposalContentSha256, source: { sourceId: proof.source.sourceId, url: source.url,
      snapshotSha256: source.snapshotSha256, objectKey: source.objectKey, canonicalTextSha256: proof.source.canonicalTextSha256, textArtifactKey: source.textArtifact.objectKey } }) }
}
