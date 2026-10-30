import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson, proposalContentSha256, type MaintenanceProposal } from './contracts'
import type { OcrArtifactRef } from './windows-ocr-reviewed-source'

export const PRIVATE_REVIEW_VERSION = 'upc-reviewed-windows-ocr-private-v2' as const
export const PRIVATE_REVIEWER = `deterministic:${PRIVATE_REVIEW_VERSION}:assistant-independent-source-reading` as const
const sha = z.string().regex(/^[a-f0-9]{64}$/u)
// Keep this type-only dependency acyclic: the source verifier calls this helper.
const ocrArtifactRefSchema = z.object({ objectKey: z.string().min(1).max(500).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u)
  .refine(value => !value.split('/').some(part => part === '.' || part === '..')),
  sha256: sha, byteLength: z.number().int().nonnegative() }).strict()
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const deterministicReviewProofSchema = z.object({
  format: z.literal('studyinchina.upc-windows-ocr-deterministic-review-proof'), version: z.literal(2),
  ruleVersion: z.literal(PRIVATE_REVIEW_VERSION), method: z.literal('deterministic'), decision: z.literal('approved'), reviewerId: z.literal(PRIVATE_REVIEWER),
  reviewerRole: z.literal('assistant_independent_visual_source_reading'), humanReviewClaimed: z.literal(false), minimaxReviewClaimed: z.literal(false),
  reviewedAt: z.iso.datetime(), proposalId: z.string().min(1), recordId: z.string().min(1), candidateSha256: sha, snapshotSha256: sha, sourceId: sha,
  sourceContentSha256: sha, independentSourceReview: ocrArtifactRefSchema, rootSpanApproval: ocrArtifactRefSchema, rootCodeApproval: ocrArtifactRefSchema,
  authority: z.literal('external_root_code_and_exact_four_span_approvals'),
}).strict()
export type ReviewProofContext = {
  reviewedAt: string; sourceContentSha256: string; independentSourceReview: OcrArtifactRef;
  rootSpanApproval: OcrArtifactRef; rootCodeApproval: OcrArtifactRef;
}

/** The private producer calls this only after verifying BOTH separately supplied
 * root approvals. A proof records that deterministic decision; it cannot create
 * root authority, assert human review, or replace the independent source report. */
export async function makeDeterministicReviewProof(proposal: MaintenanceProposal, context: ReviewProofContext) {
  assert.equal(proposal.status, 'ready', 'ocr_private_review_requires_ready_external_approvals')
  return deterministicReviewProofSchema.parse({
    format: 'studyinchina.upc-windows-ocr-deterministic-review-proof', version: 2, ruleVersion: PRIVATE_REVIEW_VERSION,
    method: 'deterministic', decision: 'approved', reviewerId: PRIVATE_REVIEWER, reviewerRole: 'assistant_independent_visual_source_reading',
    humanReviewClaimed: false, minimaxReviewClaimed: false,
    proposalId: proposal.id, recordId: proposal.recordId, candidateSha256: await proposalContentSha256(proposal),
    snapshotSha256: proposal.source.snapshotSha256, sourceId: proposal.source.id, ...context,
    authority: 'external_root_code_and_exact_four_span_approvals',
  })
}

/** The general importer checks generic artifacts for independent_model only.
 * Both the OCR source verifier and private acceptor add this deterministic gate.
 * It hashes the artifact then binds candidate, snapshot, method and both external
 * approvals. The unchanged importer still validates the proposal and OCR source. */
export async function verifyDeterministicReviewProof(proposal: MaintenanceProposal, context: ReviewProofContext,
  readArtifact: (key: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const review = proposal.review
  assert(review && review.decision === 'approved' && review.method === 'deterministic' && review.reviewerId === PRIVATE_REVIEWER,
    'ocr_private_review_method_or_reviewer_mismatch')
  assert(review.artifactKey && review.reviewArtifactSha256, 'ocr_private_review_artifact_required')
  const bytes = await readArtifact(review.artifactKey)
  assert.equal(hash(bytes), review.reviewArtifactSha256, 'ocr_private_review_artifact_checksum_mismatch')
  const proof = deterministicReviewProofSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  assert.equal(proof.proposalId, proposal.id, 'ocr_private_review_proposal_id_mismatch')
  assert.equal(proof.recordId, proposal.recordId, 'ocr_private_review_record_id_mismatch')
  const candidateSha256 = await proposalContentSha256(proposal)
  assert.equal(review.candidateSha256, candidateSha256, 'ocr_private_review_candidate_fingerprint_mismatch')
  assert.equal(proof.candidateSha256, candidateSha256, 'ocr_private_review_proposal_sha_mismatch')
  assert.equal(review.snapshotSha256, proposal.source.snapshotSha256, 'ocr_private_review_snapshot_fingerprint_mismatch')
  assert.equal(proof.snapshotSha256, proposal.source.snapshotSha256, 'ocr_private_review_snapshot_sha_mismatch')
  assert.equal(proof.sourceId, proposal.source.id, 'ocr_private_review_source_id_mismatch')
  assert.equal(review.reviewedAt, context.reviewedAt, 'ocr_private_review_time_mismatch')
  for (const key of ['reviewedAt', 'sourceContentSha256', 'independentSourceReview', 'rootSpanApproval', 'rootCodeApproval'] as const) {
    assert.equal(canonicalJson(proof[key]), canonicalJson(context[key]), `ocr_private_review_context_mismatch:${key}`)
  }
  return bytes
}
