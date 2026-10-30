/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy capture and original WinRT payloads retain their full original structure; trust is limited by exact hash references and the explicit checks below. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson, type MaintenanceProposal } from './contracts'
import { verifyDeterministicReviewProof } from './windows-ocr-stu-deterministic-review'

export const WINDOWS_OCR_PARSER = 'windows-ocr-reviewed-v1' as const
export const WINDOWS_OCR_FORMAT = 'studyinchina.windows-ocr-reviewed-source' as const
export const WINDOWS_OCR_RULE = 'stu-one-reviewed-windows-ocr-identity-v1' as const
export const STU_OCR_RECORD = 'program-shantou-university-computer-science-and-technology-bachelor'
export const STU_OCR_SCHOOL = 'uni-shantou-university'
export const STU_SCAN_RAW_SHA256 = 'e2f84fa6e0ab52abcc02fe2c59676bf52ed3678fc3caff8dd579f3cbc41ce29c'
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
const segment = z.object({ nativeLineIndex: z.number().int().nonnegative(),
  firstWord: z.number().int().nonnegative(), lastWord: z.number().int().nonnegative(),
  nativeWords: z.array(z.object({ nativeWordIndex: z.number().int().nonnegative(), text: z.string().min(1), boundingRect: rect }).strict()).min(1),
}).strict()
export const ocrReviewedSpanSchema = z.object({ field, physicalPage: z.number().int().min(1).max(4), language: z.literal('en-GB'),
  pageImageSha256: sha, originalOcrSha256: sha, nativeTextAngle: z.number().finite().nullable(),
  segments: z.array(segment).min(1).max(2), independentlyReadLiteral: z.string().min(1).max(200),
  joinRule: z.literal('one_space_between_unmodified_native_words_in_reviewed_reading_order'), corrections: z.array(z.never()).length(0),
}).strict()
export type OcrReviewedSpan = z.infer<typeof ocrReviewedSpanSchema>
export const ocrReviewedContentSchema = z.object({ ruleVersion: z.literal(WINDOWS_OCR_RULE),
  universityId: z.literal(STU_OCR_SCHOOL), recordId: z.literal(STU_OCR_RECORD), existingIdentitySha256: sha,
  sourceId: sha, sourceUrl: z.url(), rawSnapshotSha256: sha, originalByteLength: z.number().int().positive(),
  physicalPages: z.literal(4), sourceCapture: ocrArtifactRefSchema, renderManifest: ocrArtifactRefSchema,
  ocrManifest: ocrArtifactRefSchema, independentSourceReview: ocrArtifactRefSchema,
  pages: z.array(z.object({ physicalPage: z.number().int().min(1).max(4), image: ocrArtifactRefSchema,
    width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }).strict()).length(4),
  originalOcr: z.array(z.object({ physicalPage: z.number().int().min(1).max(4), language: z.enum(['zh-Hans-CN', 'en-GB']), result: ocrArtifactRefSchema }).strict()).length(8),
  spans: z.array(ocrReviewedSpanSchema).length(4),
}).strict()
export const ocrRootApprovalSchema = z.object({ format: z.literal('studyinchina.windows-ocr-root-span-approval'), version: z.literal(1),
  ruleVersion: z.literal(WINDOWS_OCR_RULE), decision: z.literal('approved'), reviewerId: z.literal('root'), reviewedAt: z.iso.datetime(),
  contentSha256: sha, independentSourceReviewSha256: sha, existingIdentitySha256: sha,
  approvedSpans: z.array(z.object({ field, spanSha256: sha, correctionsSha256: sha }).strict()).length(4),
  scope: z.literal('one_existing_stu_en_identity_only'), codeReviewManifestSha256: sha,
}).strict()
export const ocrRootCodeApprovalSchema = z.object({ format: z.literal('studyinchina.windows-ocr-stu-code-review'), version: z.literal(2),
  privateProducerVersion: z.literal('stu-reviewed-windows-ocr-private-v1'), ruleVersion: z.literal(WINDOWS_OCR_RULE),
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

/** This initial version deliberately accepts one existing STU identity only.
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
  check(content.sourceUrl === 'https://sie.stu.edu.cn/upload/file/20260413/6391167738893235215371326.pdf'
    && content.rawSnapshotSha256 === STU_SCAN_RAW_SHA256 && content.originalByteLength === 4416241
    && content.existingIdentitySha256 === '0c86b84612b9ad65d00e7c7ad3188472516d8f94591934939217af8db503de09'
    && content.sourceUrl === proposal.source.url && content.sourceId === proposal.source.id
    && content.sourceId === digest(content.sourceUrl) && content.rawSnapshotSha256 === proposal.source.snapshotSha256
    && rawPdf.length === content.originalByteLength && digest(rawPdf) === content.rawSnapshotSha256
    && new TextDecoder().decode(rawPdf.slice(0, 5)) === '%PDF-', 'original_pdf_binding_changed')
  const expectedFields = { name: { en: 'COMPUTER SCIENCE AND TECHNOLOGY' }, degreeLevel: 'bachelor', programType: 'degree', programUrl: content.sourceUrl,
    internationalAdmissionsEvidence: proposal.fields.internationalAdmissionsEvidence }
  check(same(proposal.fields, expectedFields), 'unreviewed_identity_or_dynamic_field')
  const capture: any = json(await artifact(content.sourceCapture))
  const captured = capture.sources?.filter((source: any) => source.universityId === content.universityId
    && source.url === content.sourceUrl && source.capture?.rawSha256 === content.rawSnapshotSha256) ?? []
  check(captured.length === 1 && captured[0].capture.httpStatus === 200 && captured[0].capture.completeBody === true
    && captured[0].capture.byteLength === content.originalByteLength, 'original_capture_not_complete')
  const render: any = json(await artifact(content.renderManifest)), ocr: any = json(await artifact(content.ocrManifest))
  check(render.format === 'studyinchina.complete-official-pdf-raster-derivative' && render.status === 'all_four_pages_rendered'
    && render.originalPdf?.sha256 === content.rawSnapshotSha256 && render.physicalPages === 4 && render.allPhysicalPagesPreserved === true
    && render.pages?.length === 4, 'missing_or_incomplete_rendered_pages')
  check(ocr.format === 'studyinchina.complete-official-pdf-windows-ocr-derivative' && ocr.status === 'all_four_pages_two_languages_complete'
    && ocr.sourceRawSha256 === content.rawSnapshotSha256 && ocr.physicalPages === 4 && ocr.allImagesFullPage === true
    && ocr.notPopplerNativeText === true && ocr.noSilentCorrection === true && ocr.results?.length === 8
    && ocr.renderManifest?.sha256 === content.renderManifest.sha256, 'missing_or_relabelled_original_ocr')
  const results = new Map<string, any>()
  for (let page = 1; page <= 4; page++) {
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
  check(content.sourceCapture.sha256 === 'e87907b32b8fc4248ad327c60d33f30c6411ed25c01531eee6c39aba3f152dad'
    && content.renderManifest.sha256 === '6b9ced0af09d6c7b7b489e1762870d454a0a61c300d264ab3abd4e9a24dddfea'
    && content.ocrManifest.sha256 === '067a44ee486a3355453c360774fb50b606b71b90fc44630ca7ecea8b52ed56d3'
    && content.independentSourceReview.sha256 === '7f9ec458df9d74b5313c8c8eb8bc5db6212614ad6864768d8bc5d42b52fe9375', 'reviewed_artifact_profile_changed')
  const table = independent.actualTableRoleAssessment
  check(table?.physicalPage === 2 && same(table.actualColumns, ['SCHOOL/COLLEGE', 'PROGRAM', 'SCHOOL/COLLEGE', 'PROGRAM'])
    && table.selectedProgrammeColumn === 2 && table.selectedProgramme === 'COMPUTER SCIENCE AND TECHNOLOGY'
    && table.selectedSchool === 'COLLEGE OF MATHEMATICS & COMPUTER SCIENCE'
    && table.actualPageDegreeHeading === 'UNDERGRADUATE PROGRAMS' && table.officialProgrammeCodeObserved === false
    && table.fieldNameIsNotSchoolColumn === true, 'programme_degree_or_direction_association_changed')
  // Degree and international scope use the clean cover OCR. The table heading
  // was also visually read, but its misrecognized OCR is never silently repaired.
  const expected = {
    name: { page: 2, segments: [[85, 0, 2], [86, 0, 0]], literal: 'COMPUTER SCIENCE AND TECHNOLOGY' },
    degree: { page: 1, segments: [[20, 0, 0], [21, 0, 0]], literal: 'UNDERGRADUATE PROGRAMS' },
    international: { page: 1, segments: [[22, 0, 1], [23, 0, 0]], literal: 'FOR INTERNATIONAL STUDENTS' },
    institution: { page: 2, segments: [[19, 0, 1]], literal: 'Shantou University' },
  } as const
  const texts = Array.from({ length: 4 }, () => [] as string[])
  for (const kind of ['name', 'degree', 'international', 'institution'] as const) {
    const spans = content.spans.filter(span => span.field === kind), allowed = approval.approvedSpans.filter(span => span.field === kind)
    check(spans.length === 1 && allowed.length === 1, 'span_missing_or_duplicate')
    const span = spans[0], wanted = expected[kind]
    check(span.physicalPage === wanted.page && span.independentlyReadLiteral === wanted.literal
      && same(span.segments.map(s => [s.nativeLineIndex, s.firstWord, s.lastWord]), wanted.segments), 'unreviewed_programme_or_degree_span')
    check(allowed[0].spanSha256 === digest(canonicalJson(span))
      && allowed[0].correctionsSha256 === digest(canonicalJson([])), 'span_or_correction_not_approved')
    const result = results.get(span.physicalPage + '|en-GB')
    const sourceRef = content.originalOcr.find(ref => ref.physicalPage === span.physicalPage && ref.language === 'en-GB')!
    check(span.pageImageSha256 === content.pages[span.physicalPage - 1].image.sha256 && span.originalOcrSha256 === sourceRef.result.sha256
      && span.nativeTextAngle === result.nativeTextAngle, 'span_wrong_page_or_ocr')
    const words: string[] = []
    for (const s of span.segments) {
      const lines = result.lines.filter((line: any) => line.nativeLineIndex === s.nativeLineIndex)
      check(lines.length === 1 && Array.isArray(lines[0].words) && result.rawOcrResultText.includes(lines[0].text), 'native_line_not_located')
      const actual = lines[0].words.filter((w: any) => w.nativeWordIndex >= s.firstWord && w.nativeWordIndex <= s.lastWord)
        .map((w: any) => ({ nativeWordIndex: w.nativeWordIndex, text: w.text, boundingRect: w.boundingRect }))
      check(actual.length === s.lastWord - s.firstWord + 1 && same(actual, s.nativeWords), 'native_word_or_bbox_changed')
      check(actual.every((w: any, i: number) => w.nativeWordIndex === s.firstWord + i && w.boundingRect.x >= 0 && w.boundingRect.y >= 0
        && w.boundingRect.width > 0 && w.boundingRect.height > 0 && w.boundingRect.x + w.boundingRect.width <= result.imageWidth
        && w.boundingRect.y + w.boundingRect.height <= result.imageHeight), 'native_word_bbox_outside_page')
      words.push(...actual.map((w: any) => w.text))
    }
    const sourceSpans = independent.independentlyReviewedSpans.filter((item: any) => item.field === kind)
    check(sourceSpans.length === 1, 'independent_span_missing')
    const reviewed = sourceSpans[0]
    check(reviewed.physicalPage === span.physicalPage && reviewed.language === 'en-GB' && reviewed.nativeTextAngle === span.nativeTextAngle
      && reviewed.pageImage?.sha256 === span.pageImageSha256 && reviewed.originalMachineOcr?.sha256 === span.originalOcrSha256
      && reviewed.independentAssistantVisualLiteral === span.independentlyReadLiteral
      && same(reviewed.segments, span.segments) && same(reviewed.corrections, [])
      && reviewed.joinRule === span.joinRule, 'independent_span_binding_changed')
    check(words.join(' ') === span.independentlyReadLiteral, 'unapproved_transcript_character')
    texts[span.physicalPage - 1].push(words.join(' '))
  }
  const byField = (kind: string) => content.spans.find(span => span.field === kind)!
  const evidenceMatches = (item: any, kind: string) => item && item.sourceId === content.sourceId && item.url === content.sourceUrl
    && item.snapshotSha256 === content.rawSnapshotSha256 && item.objectKey === proposal.source.objectKey
    && item.locator === `page ${byField(kind).physicalPage}` && item.quote === byField(kind).independentlyReadLiteral
  check(proposal.source.locator === 'page 2' && proposal.source.quote === 'COMPUTER SCIENCE AND TECHNOLOGY', 'source_quote_scope_changed')
  check(proposal.fieldEvidence.length === 3 && proposal.fieldEvidence.every(item => ['name.en', 'degreeLevel', 'programType'].includes(item.fieldPath)
    && evidenceMatches(item, item.fieldPath === 'name.en' ? 'name' : 'degree'))
    && new Set(proposal.fieldEvidence.map(item => item.fieldPath)).size === 3
    && evidenceMatches(proposal.fields.internationalAdmissionsEvidence, 'international'), 'unreviewed_field_or_locator')
  // Only individually root-approved literals enter the normal evidence locator.
  // Original full OCR remains immutable provenance, never trusted entire text.
  return texts.map(page => page.join('\n')).join('\f')
}
