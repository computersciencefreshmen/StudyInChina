/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy capture and original WinRT payloads retain their full original structure; trust is limited by exact hash references and the explicit checks below. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson, type MaintenanceProposal } from './contracts'
import { verifyDeterministicReviewProof } from './windows-ocr-deterministic-review'

export const WINDOWS_OCR_PARSER = 'windows-ocr-reviewed-v1' as const
export const WINDOWS_OCR_FORMAT = 'studyinchina.windows-ocr-reviewed-source' as const
export const WINDOWS_OCR_RULE = 'upc-one-reviewed-windows-ocr-identity-v1' as const
export const UPC_OCR_RECORD = 'prog-gap-prog-mew-ne-upc-chemical-engineering-master-en'
export const UPC_OCR_SCHOOL = 'uni-china-university-of-petroleum-east-china'
export const UPC_SCAN_RAW_SHA256 = '94b8d03a80683ee66c00e856bf37f5fc1f1c1261bc151cd2f16f6e26c80595cb'
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const sha = z.string().regex(/^[a-f0-9]{64}$/u)
const key = z.string().min(1).max(500).regex(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u)
  .refine(value => !value.split('/').some(part => part === '.' || part === '..'))
export const ocrArtifactRefSchema = z.object({ objectKey: key, sha256: sha, byteLength: z.number().int().nonnegative() }).strict()
export type OcrArtifactRef = z.infer<typeof ocrArtifactRefSchema>
export type ReviewedWindowsOcrSourceRef = { artifactKey: string; sha256: string; codeApproval: OcrArtifactRef }
const rect = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(), height: z.number().finite().positive() }).strict()
const field = z.enum(['name', 'degree', 'international', 'institution'])
const correction = z.object({ nativeWordIndex: z.number().int().nonnegative(), rawText: z.string().min(1), reviewedText: z.string().min(1),
  nativeRectIsDetectionOnly: z.literal(true), correctedGlyphBoundingBoxSupplied: z.literal(false),
  reviewContext: z.object({ kind: z.literal('complete_original_page_image'), pageImageSha256: sha }).strict() }).strict()
export const ocrReviewedSpanSchema = z.object({ field, physicalPage: z.number().int().min(1).max(10),
  nativeLineIndex: z.number().int().nonnegative(), firstWord: z.number().int().nonnegative(), lastWord: z.number().int().nonnegative(),
  pageImageSha256: sha, originalOcrSha256: sha, nativeTextAngle: z.number().finite().nullable(),
  nativeWords: z.array(z.object({ nativeWordIndex: z.number().int().nonnegative(), text: z.string().min(1), boundingRect: rect }).strict()).min(1),
  independentlyReadLiteral: z.string().min(1).max(200), corrections: z.array(correction).max(1),
}).strict()
export type OcrReviewedSpan = z.infer<typeof ocrReviewedSpanSchema>
export const ocrReviewedContentSchema = z.object({ ruleVersion: z.literal(WINDOWS_OCR_RULE),
  universityId: z.literal(UPC_OCR_SCHOOL), recordId: z.literal(UPC_OCR_RECORD), existingIdentitySha256: sha,
  sourceId: sha, sourceUrl: z.url(), rawSnapshotSha256: sha, originalByteLength: z.number().int().positive(),
  physicalPages: z.literal(10), sourceCapture: ocrArtifactRefSchema, renderManifest: ocrArtifactRefSchema,
  ocrManifest: ocrArtifactRefSchema, independentSourceReview: ocrArtifactRefSchema,
  pages: z.array(z.object({ physicalPage: z.number().int().min(1).max(10), image: ocrArtifactRefSchema,
    width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }).strict()).length(10),
  originalOcr: z.array(z.object({ physicalPage: z.number().int().min(1).max(10), language: z.enum(['zh-Hans-CN', 'en-GB']), result: ocrArtifactRefSchema }).strict()).length(20),
  spans: z.array(ocrReviewedSpanSchema).length(4),
}).strict()
export const ocrRootApprovalSchema = z.object({ format: z.literal('studyinchina.windows-ocr-root-span-approval'), version: z.literal(1),
  ruleVersion: z.literal(WINDOWS_OCR_RULE), decision: z.literal('approved'), reviewerId: z.literal('root'), reviewedAt: z.iso.datetime(),
  contentSha256: sha, independentSourceReviewSha256: sha, existingIdentitySha256: sha,
  approvedSpans: z.array(z.object({ field, spanSha256: sha, correctionsSha256: sha }).strict()).length(4),
  scope: z.literal('one_existing_upc_zh_identity_only'), codeReviewManifestSha256: sha,
}).strict()
export const ocrRootCodeApprovalSchema = z.object({ format: z.literal('studyinchina.windows-ocr-upc-code-review'), version: z.literal(2),
  privateProducerVersion: z.literal('upc-reviewed-windows-ocr-private-v2'), ruleVersion: z.literal(WINDOWS_OCR_RULE),
  decision: z.literal('approved'), reviewerId: z.literal('root'), reviewedAt: z.iso.datetime().optional(), contentSha256: sha,
  dependencyPins: z.array(z.object({ file: z.string().min(1).max(2000), sha256: sha }).strict()).min(3)
    .refine(pins => new Set(pins.map(pin => pin.file)).size === pins.length, 'Dependency pin paths must be unique'),
}).strict()
export const ocrReviewedEnvelopeSchema = z.object({ format: z.literal(WINDOWS_OCR_FORMAT), version: z.literal(1),
  content: ocrReviewedContentSchema, rootApproval: ocrArtifactRefSchema }).strict()
export type OcrReviewedContent = z.infer<typeof ocrReviewedContentSchema>
export const ocrContentSha256 = (content: OcrReviewedContent) => digest(canonicalJson(content))
const fail = (why: string): never => { throw Error(`windows_ocr_${why}`) }
const check = (ok: unknown, why: string) => { if (!ok) fail(why) }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))

/** This known scan may not acquire native-text authority by rewriting its derivative. */
export function requireExplicitKnownWindowsOcrParser(proposal: MaintenanceProposal): void {
  if (proposal.source.snapshotSha256 === UPC_SCAN_RAW_SHA256 && proposal.source.textArtifact?.parser !== WINDOWS_OCR_PARSER) {
    fail('known_scan_requires_explicit_windows_ocr_parser')
  }
}

/** An explicitly typed envelope cannot borrow a native-text parser's authority. */
export function rejectWindowsOcrEnvelopeAsNative(bytes: Uint8Array): void {
  let value: unknown
  try { value = json(bytes) } catch { return }
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).format === WINDOWS_OCR_FORMAT) fail('cannot_downgrade_to_native_parser')
}

/** This initial version deliberately accepts one existing UPC identity only.
 * Neither an OCR engine nor a producer can approve their own corrections. The
 * caller must register the exact root artifact independently of the proposal. */
export async function verifyWindowsOcrReviewedSource(options: {
  proposal: MaintenanceProposal; rawPdf: Uint8Array; envelopeBytes: Uint8Array;
  readArtifact: (key: string) => Promise<Uint8Array>; approvals: ReviewedWindowsOcrSourceRef[];
  existingIdentitySha256?: string;
}): Promise<string> {
  const { proposal, rawPdf, readArtifact } = options
  const envelope = ocrReviewedEnvelopeSchema.parse(json(options.envelopeBytes)), content = envelope.content
  check(options.existingIdentitySha256 === content.existingIdentitySha256, 'current_raw_identity_changed_or_missing')
  const registered = options.approvals.find(ref => ref.artifactKey === envelope.rootApproval.objectKey
    && ref.sha256 === envelope.rootApproval.sha256)
  check(registered, 'root_authority_not_registered')
  check(registered?.codeApproval, 'root_code_authority_not_registered')
  const codeRef = ocrArtifactRefSchema.parse(registered!.codeApproval)
  const cache = new Map<string, Uint8Array>()
  const artifact = async (ref: OcrArtifactRef) => {
    const bytes = cache.get(ref.objectKey) ?? await readArtifact(ref.objectKey)
    check(bytes.length === ref.byteLength && digest(bytes) === ref.sha256, 'artifact_checksum_or_length_changed')
    cache.set(ref.objectKey, bytes); return bytes
  }
  const approval = ocrRootApprovalSchema.parse(json(await artifact(envelope.rootApproval)))
  check(approval.contentSha256 === ocrContentSha256(content)
    && approval.independentSourceReviewSha256 === content.independentSourceReview.sha256
    && approval.existingIdentitySha256 === content.existingIdentitySha256, 'root_content_binding_changed')
  check(codeRef.sha256 === approval.codeReviewManifestSha256, 'root_code_approval_hash_not_bound_to_spans')
  const codeApproval = ocrRootCodeApprovalSchema.parse(json(await artifact(codeRef)))
  check(codeApproval.contentSha256 === ocrContentSha256(content), 'root_code_approval_content_mismatch')
  await verifyDeterministicReviewProof(proposal, { reviewedAt: approval.reviewedAt, sourceContentSha256: ocrContentSha256(content),
    independentSourceReview: content.independentSourceReview, rootSpanApproval: envelope.rootApproval, rootCodeApproval: codeRef }, readArtifact)
  check(new Date(approval.reviewedAt) <= new Date(proposal.review?.reviewedAt ?? ''), 'root_review_is_future_or_missing')
  check(proposal.source.textArtifact?.parser === WINDOWS_OCR_PARSER && proposal.source.contentType === 'application/pdf', 'explicit_parser_and_pdf_required')
  check(proposal.universityId === content.universityId && proposal.recordId === content.recordId && proposal.operation === 'patch'
    && proposal.entityType === 'program' && proposal.scope.year === null && proposal.scope.intake === null, 'identity_scope_changed')
  check(content.sourceUrl === proposal.source.url && content.sourceId === proposal.source.id
    && content.sourceId === digest(content.sourceUrl) && content.rawSnapshotSha256 === proposal.source.snapshotSha256
    && rawPdf.length === content.originalByteLength && digest(rawPdf) === content.rawSnapshotSha256
    && new TextDecoder().decode(rawPdf.slice(0, 5)) === '%PDF-', 'original_pdf_binding_changed')
  const expectedFields = { name: { zh: '化学工程与技术' }, degreeLevel: 'master', programType: 'degree', programUrl: content.sourceUrl,
    internationalAdmissionsEvidence: proposal.fields.internationalAdmissionsEvidence }
  check(same(proposal.fields, expectedFields), 'unreviewed_identity_or_dynamic_field')
  const capture: any = json(await artifact(content.sourceCapture))
  const captured = capture.sources?.filter((source: any) => source.universityId === content.universityId
    && source.url === content.sourceUrl && source.capture?.rawSha256 === content.rawSnapshotSha256) ?? []
  check(captured.length === 1 && captured[0].capture.httpStatus === 200 && captured[0].capture.completeBody === true
    && captured[0].capture.byteLength === content.originalByteLength, 'original_capture_not_complete')
  const render: any = json(await artifact(content.renderManifest)), ocr: any = json(await artifact(content.ocrManifest))
  check(render.format === 'studyinchina.complete-official-pdf-raster-derivative' && render.status === 'all_ten_pages_rendered'
    && render.originalPdf?.sha256 === content.rawSnapshotSha256 && render.physicalPages === 10 && render.allPhysicalPagesPreserved === true
    && render.pages?.length === 10, 'missing_or_incomplete_rendered_pages')
  check(ocr.format === 'studyinchina.complete-official-pdf-windows-ocr-derivative' && ocr.status === 'all_ten_pages_two_languages_complete'
    && ocr.sourceRawSha256 === content.rawSnapshotSha256 && ocr.physicalPages === 10 && ocr.allImagesFullPage === true
    && ocr.notPopplerNativeText === true && ocr.noSilentCorrection === true && ocr.results?.length === 20
    && ocr.renderManifest?.sha256 === content.renderManifest.sha256, 'missing_or_relabelled_original_ocr')
  const results = new Map<string, any>()
  for (let page = 1; page <= 10; page++) {
    const declared = content.pages[page - 1], actual = render.pages[page - 1]
    check(declared.physicalPage === page && actual.physicalPage === page && actual.fullPagePreserved === true
      && actual.cropApplied === false && actual.sha256 === declared.image.sha256 && actual.width === declared.width
      && actual.height === declared.height, 'wrong_page_image_or_order')
    const png = await artifact(declared.image)
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    check(png.length >= 24 && new TextDecoder().decode(png.slice(1, 4)) === 'PNG'
      && view.getUint32(16) === declared.width && view.getUint32(20) === declared.height, 'page_png_dimensions_changed')
    for (const language of ['zh-Hans-CN', 'en-GB']) {
      const refs = content.originalOcr.filter(ref => ref.physicalPage === page && ref.language === language)
      check(refs.length === 1, 'missing_or_duplicate_original_ocr')
      const ref = refs[0], actualRefs = ocr.results.filter((result: any) => result.physicalPage === page && result.language === language)
      check(actualRefs.length === 1 && actualRefs[0].sha256 === ref.result.sha256, 'original_ocr_manifest_changed')
      const result: any = json(await artifact(ref.result))
      check(result.format === 'studyinchina.windows-ocr-original-page-result' && result.parser === 'windows.media.ocr'
        && result.sourceRawSha256 === content.rawSnapshotSha256 && result.sourcePageImageSha256 === declared.image.sha256
        && result.physicalPage === page && result.requestedLanguage === language && result.resolvedLanguage === language
        && result.imageWidth === declared.width && result.imageHeight === declared.height && result.noSilentCorrection === true
        && result.notPopplerNativeText === true && typeof result.parserVersion === 'string'
        && result.engineDllSha256 === ocr.engineDll?.sha256 && typeof result.rawOcrResultText === 'string' && Array.isArray(result.lines), 'original_ocr_provenance_changed')
      results.set(`${page}|${language}`, result)
    }
  }
  const independent: any = json(await artifact(content.independentSourceReview))
  check(Number.isFinite(Date.parse(independent.createdAt))
    && new Date(approval.reviewedAt) >= new Date(independent.createdAt)
    && new Date(approval.reviewedAt) >= new Date(proposal.source.checkedAt), 'root_review_predates_source_or_independent_reading')
  check(independent.format === 'studyinchina.pending-independent-assistant-visual-source-review'
    && independent.independentAssistantVisualReading === true && independent.rootApproved === false
    && independent.sourceAccepted === false && independent.proposedIdentityOnly?.reuseExistingRecordId === content.recordId
    && independent.proposedIdentityOnly?.identitySha256 === content.existingIdentitySha256
    && independent.source?.originalPdf?.sha256 === content.rawSnapshotSha256
    && independent.independentlyReviewedSpans?.length === 4, 'independent_source_review_missing_or_changed')
  const table = independent.actualTableRoleAssessment
  check(table?.physicalPage === 6 && same(table.actualColumns, ['学院', '专业', '研究方向'])
    && table.selectedProgrammeColumn === '专业' && table.selectedProgramme === '化学工程与技术'
    && table.actualPageDegreeHeading === '学术型硕士专业' && table.officialProgrammeCodeObserved === false, 'programme_degree_or_direction_association_changed')
  const expected = { name: [6, 57, 0, 6, '化学工程与技术'], degree: [6, 46, 0, 6, '学术型硕士专业'],
    international: [9, 1, 2, 7, '非中国籍公民'], institution: [1, 3, 0, 9, '中国石油大学（华东）'] } as const
  const texts = Array.from({ length: 10 }, () => [] as string[])
  for (const kind of ['name', 'degree', 'international', 'institution'] as const) {
    const spans = content.spans.filter(span => span.field === kind), allowed = approval.approvedSpans.filter(span => span.field === kind)
    check(spans.length === 1 && allowed.length === 1, 'span_missing_or_duplicate')
    const span = spans[0], wanted = expected[kind]
    check(span.physicalPage === wanted[0] && span.nativeLineIndex === wanted[1] && span.firstWord === wanted[2]
      && span.lastWord === wanted[3] && span.independentlyReadLiteral === wanted[4], 'unreviewed_programme_or_degree_span')
    check(allowed[0].spanSha256 === digest(canonicalJson(span))
      && allowed[0].correctionsSha256 === digest(canonicalJson(span.corrections)), 'span_or_correction_not_approved')
    const result = results.get(`${span.physicalPage}|zh-Hans-CN`)
    const sourceRef = content.originalOcr.find(ref => ref.physicalPage === span.physicalPage && ref.language === 'zh-Hans-CN')!
    check(span.pageImageSha256 === content.pages[span.physicalPage - 1].image.sha256 && span.originalOcrSha256 === sourceRef.result.sha256
      && span.nativeTextAngle === result.nativeTextAngle, 'span_wrong_page_or_ocr')
    const lines = result.lines.filter((line: any) => line.nativeLineIndex === span.nativeLineIndex)
    check(lines.length === 1 && Array.isArray(lines[0].words) && result.rawOcrResultText.includes(lines[0].text), 'native_line_not_located')
    const nativeWords = lines[0].words.filter((word: any) => word.nativeWordIndex >= span.firstWord && word.nativeWordIndex <= span.lastWord)
      .map((word: any) => ({ nativeWordIndex: word.nativeWordIndex, text: word.text, boundingRect: word.boundingRect }))
    check(nativeWords.length === span.lastWord - span.firstWord + 1 && same(nativeWords, span.nativeWords), 'native_word_or_bbox_changed')
    check(nativeWords.every((word: any) => word.boundingRect.x + word.boundingRect.width <= result.imageWidth
      && word.boundingRect.y + word.boundingRect.height <= result.imageHeight), 'native_word_bbox_outside_page')
    const sourceSpans = independent.independentlyReviewedSpans.filter((item: any) => item.field === kind)
    check(sourceSpans.length === 1, 'independent_span_missing')
    const reviewed = sourceSpans[0]
    check(reviewed.physicalPage === span.physicalPage && reviewed.nativeLineIndex === span.nativeLineIndex
      && reviewed.nativeWordRange?.first === span.firstWord && reviewed.nativeWordRange?.last === span.lastWord
      && reviewed.pageImage?.sha256 === span.pageImageSha256 && reviewed.originalMachineOcr?.sha256 === span.originalOcrSha256
      && reviewed.independentAssistantVisualLiteral === span.independentlyReadLiteral, 'independent_span_binding_changed')
    check(same(reviewed.selectedRawMachineWords?.map((word: any) => ({ nativeWordIndex: word.nativeWordIndex,
      text: word.text, boundingRect: word.boundingRect })), nativeWords), 'independent_native_word_or_bbox_changed')
    const changes = span.corrections
    if (kind !== 'institution') check(changes.length === 0 && reviewed.glyphDifferences?.length === 0, 'unapproved_non_owner_correction')
    else {
      check(changes.length === 1 && changes[0].nativeWordIndex === 1 && changes[0].rawText === '玉' && changes[0].reviewedText === '国'
        && changes[0].reviewContext.pageImageSha256 === span.pageImageSha256
        && same(reviewed.glyphDifferences, [{ glyphSequenceIndex: 1, rawMachineGlyph: '玉', independentlySeenGlyph: '国' }]), 'owner_correction_scope_changed')
      const recommendation = independent.institutionCorrectionRecommendation
      check(recommendation?.nativeRectCoversFullCorrectedGlyph === false && recommendation.independentVisualGlyphBoxSupplied === false
        && same(recommendation.actualNativeDetectionRect, nativeWords[1].boundingRect), 'synthetic_corrected_glyph_box_forbidden')
    }
    const transcribed = nativeWords.map((word: any, index: number) => {
      check(word.nativeWordIndex === span.firstWord + index && word.text.length === 1, 'pilot_requires_actual_single_glyph_words')
      const change = changes.find(value => value.nativeWordIndex === word.nativeWordIndex)
      if (change) check(change.rawText === word.text, 'correction_raw_glyph_changed')
      return change?.reviewedText ?? word.text
    }).join('')
    check(transcribed === span.independentlyReadLiteral, 'unapproved_transcript_character')
    texts[span.physicalPage - 1].push(transcribed)
  }
  const byField = (kind: string) => content.spans.find(span => span.field === kind)!
  const evidenceMatches = (item: any, kind: string) => item && item.sourceId === content.sourceId && item.url === content.sourceUrl
    && item.snapshotSha256 === content.rawSnapshotSha256 && item.objectKey === proposal.source.objectKey
    && item.locator === `page ${byField(kind).physicalPage}` && item.quote === byField(kind).independentlyReadLiteral
  check(proposal.source.locator === 'page 6' && proposal.source.quote === '化学工程与技术', 'source_quote_scope_changed')
  check(proposal.fieldEvidence.length === 3 && proposal.fieldEvidence.every(item => ['name.zh', 'degreeLevel', 'programType'].includes(item.fieldPath)
    && evidenceMatches(item, item.fieldPath === 'name.zh' ? 'name' : 'degree'))
    && new Set(proposal.fieldEvidence.map(item => item.fieldPath)).size === 3
    && evidenceMatches(proposal.fields.internationalAdmissionsEvidence, 'international'), 'unreviewed_field_or_locator')
  // Only individually root-approved literals enter the normal evidence locator.
  // Original full OCR remains immutable provenance, never trusted entire text.
  return texts.map(page => page.join('\n')).join('\f')
}
