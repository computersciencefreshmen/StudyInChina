/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic byte fixtures deliberately mutate untrusted payloads to exercise validation. */
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { canonicalJson, exportContentSha256, proposalContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { importIdentityCandidates, verifyReviewedProposalEvidence } from '../../scripts/maintenance/import-identities'
import { ocrContentSha256, ocrReviewedContentSchema, requireExplicitKnownWindowsOcrParser, verifyWindowsOcrReviewedSource, UPC_OCR_RECORD, UPC_OCR_SCHOOL, UPC_SCAN_RAW_SHA256, WINDOWS_OCR_FORMAT, WINDOWS_OCR_PARSER, WINDOWS_OCR_RULE } from '../../scripts/maintenance/windows-ocr-reviewed-source'
import { identityAcceptanceLedgerSchema, identityFingerprint, scopedNameReceiptMatches } from '../../src/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { projectVerifiedProgramName } from '../../src/lib/data/verified-program-name'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { makeDeterministicReviewProof, PRIVATE_REVIEWER } from '../../scripts/maintenance/windows-ocr-deterministic-review'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const encode = (value: unknown) => Buffer.from(JSON.stringify(value))
const time = '2026-10-30T06:00:00.000Z', acceptedAt = '2026-10-30T07:00:00.000Z'
let bundle: ReturnType<typeof loadMaintenanceBundle>, scope: Awaited<ReturnType<typeof buildMaintenanceScope>>
beforeAll(async () => { bundle = loadMaintenanceBundle(process.cwd()); scope = await buildMaintenanceScope(bundle, { scopeId: 'synthetic-ocr-test-272', createdAt: time }) })

/** Entirely synthetic PDF/PNG/OCR bytes. This function never reads or approves the real UPC source. */
async function fixture() {
  const artifacts = new Map<string, Uint8Array>(), put = (key: string, value: Uint8Array) => { artifacts.set(key, value); return { objectKey: key, sha256: hash(value), byteLength: value.length } }
  const putJson = (key: string, value: unknown) => put(key, encode(value))
  const raw = Buffer.from('%PDF-synthetic-test-only-not-an-official-document'), rawRef = put('maintenance/test-only/raw.pdf', raw)
  const url = 'https://cie.upc.edu.cn/test-only-never-publish.pdf', sourceId = hash(url)
  const existing = bundle.programs.find(row => row.id === UPC_OCR_RECORD)!, existingIdentitySha256 = identityFingerprint('program', existing)
  const definitions = [ ['name', 6, 57, 0, '化学工程与技术', '化学工程与技术'], ['degree', 6, 46, 0, '学术型硕士专业', '学术型硕士专业'],
    ['international', 9, 1, 2, '非中国籍公民', '非中国籍公民'], ['institution', 1, 3, 0, '中玉石油大学（华东）', '中国石油大学（华东）'] ] as const
  const pages = Array.from({ length: 10 }, (_, index) => { const png = Buffer.alloc(25); png.set([137, 80, 78, 71, 13, 10, 26, 10]); png.writeUInt32BE(4000, 16); png.writeUInt32BE(2715, 20); png[24] = index
    return { physicalPage: index + 1, image: put(`maintenance/test-only/page-${index + 1}.png`, png), width: 4000, height: 2715 } })
  const originalOcr: any[] = [], results: any[] = [], spans: any[] = []
  for (const page of pages) for (const language of ['zh-Hans-CN', 'en-GB']) {
    const lines = language === 'zh-Hans-CN' ? definitions.filter(row => row[1] === page.physicalPage).map(row => {
      const words = [...row[4]].map((text, index) => ({ nativeWordIndex: row[3] + index, text, boundingRect: { x: index * 35, y: row[2] * 30, width: 23, height: 21 } }))
      return { nativeLineIndex: row[2], text: words.map(word => word.text).join(' '), words } }) : []
    const original = { format: 'studyinchina.windows-ocr-original-page-result', parser: 'windows.media.ocr', parserVersion: 'synthetic-test-only',
      engineDllSha256: hash('test-dll-not-real'), sourceRawSha256: hash(raw), sourcePageImageSha256: page.image.sha256, physicalPage: page.physicalPage,
      requestedLanguage: language, resolvedLanguage: language, imageWidth: 4000, imageHeight: 2715, rawOcrResultText: lines.map(line => line.text).join(' '),
      nativeTextAngle: null, lines, noSilentCorrection: true, notPopplerNativeText: true }
    const resultRef = putJson(`maintenance/test-only/page-${page.physicalPage}.${language}.json`, original)
    originalOcr.push({ physicalPage: page.physicalPage, language, result: resultRef }); results.push({ physicalPage: page.physicalPage, language, sha256: resultRef.sha256 })
    if (language === 'zh-Hans-CN') for (const line of lines) {
      const def = definitions.find(row => row[1] === page.physicalPage && row[2] === line.nativeLineIndex)!
      spans.push({ field: def[0], physicalPage: page.physicalPage, nativeLineIndex: line.nativeLineIndex, firstWord: def[3], lastWord: def[3] + line.words.length - 1,
        pageImageSha256: page.image.sha256, originalOcrSha256: resultRef.sha256, nativeTextAngle: null, nativeWords: line.words,
        independentlyReadLiteral: def[5], corrections: def[0] === 'institution' ? [{ nativeWordIndex: 1, rawText: '玉', reviewedText: '国', nativeRectIsDetectionOnly: true,
          correctedGlyphBoundingBoxSupplied: false, reviewContext: { kind: 'complete_original_page_image', pageImageSha256: page.image.sha256 } }] : [] })
    }
  }
  const sourceCapture = putJson('maintenance/test-only/capture.json', { sources: [{ universityId: UPC_OCR_SCHOOL, url, capture: { rawSha256: hash(raw), httpStatus: 200, completeBody: true, byteLength: raw.length } }] })
  const renderManifest = putJson('maintenance/test-only/render.json', { format: 'studyinchina.complete-official-pdf-raster-derivative', status: 'all_ten_pages_rendered',
    originalPdf: { sha256: hash(raw) }, physicalPages: 10, allPhysicalPagesPreserved: true, pages: pages.map(page => ({ ...page, sha256: page.image.sha256, cropApplied: false, fullPagePreserved: true })) })
  const ocrManifest = putJson('maintenance/test-only/ocr.json', { format: 'studyinchina.complete-official-pdf-windows-ocr-derivative', status: 'all_ten_pages_two_languages_complete',
    sourceRawSha256: hash(raw), physicalPages: 10, allImagesFullPage: true, notPopplerNativeText: true, noSilentCorrection: true, results,
    renderManifest: { sha256: renderManifest.sha256 }, engineDll: { sha256: hash('test-dll-not-real') } })
  const independent = { format: 'studyinchina.pending-independent-assistant-visual-source-review', createdAt: time, independentAssistantVisualReading: true, rootApproved: false, sourceAccepted: false,
    proposedIdentityOnly: { reuseExistingRecordId: UPC_OCR_RECORD, identitySha256: existingIdentitySha256 }, source: { originalPdf: { sha256: hash(raw) } },
    actualTableRoleAssessment: { physicalPage: 6, actualColumns: ['学院', '专业', '研究方向'], selectedProgrammeColumn: '专业', selectedProgramme: '化学工程与技术',
      actualPageDegreeHeading: '学术型硕士专业', officialProgrammeCodeObserved: false },
    independentlyReviewedSpans: spans.map(span => ({ field: span.field, physicalPage: span.physicalPage, nativeLineIndex: span.nativeLineIndex,
      nativeWordRange: { first: span.firstWord, last: span.lastWord }, pageImage: { sha256: span.pageImageSha256 }, originalMachineOcr: { sha256: span.originalOcrSha256 },
      selectedRawMachineWords: span.nativeWords, independentAssistantVisualLiteral: span.independentlyReadLiteral,
      glyphDifferences: span.field === 'institution' ? [{ glyphSequenceIndex: 1, rawMachineGlyph: '玉', independentlySeenGlyph: '国' }] : [] })),
    institutionCorrectionRecommendation: { nativeRectCoversFullCorrectedGlyph: false, independentVisualGlyphBoxSupplied: false,
      actualNativeDetectionRect: spans.find(span => span.field === 'institution').nativeWords[1].boundingRect } }
  const independentSourceReview = putJson('maintenance/test-only/independent.json', independent)
  const content = ocrReviewedContentSchema.parse({ ruleVersion: WINDOWS_OCR_RULE, universityId: UPC_OCR_SCHOOL, recordId: UPC_OCR_RECORD, existingIdentitySha256, sourceId, sourceUrl: url,
    rawSnapshotSha256: hash(raw), originalByteLength: raw.length, physicalPages: 10 as const, sourceCapture, renderManifest, ocrManifest, independentSourceReview, pages, originalOcr, spans })
  const envelope: any = { format: WINDOWS_OCR_FORMAT, version: 1, content, rootApproval: null }
  let approvalRef: any, codeApprovalRef: any
  const codeManifest = () => ({ format: 'studyinchina.windows-ocr-upc-code-review', version: 2, privateProducerVersion: 'upc-reviewed-windows-ocr-private-v2',
    ruleVersion: WINDOWS_OCR_RULE, decision: 'approved', reviewerId: 'root', contentSha256: ocrContentSha256(content),
    dependencyPins: ['producer', 'acceptor', 'verifier'].map(file => ({ file: `synthetic-only/${file}`, sha256: hash(`synthetic-${file}`) })) })
  const testOnlyApprove = () => { const approval = { format: 'studyinchina.windows-ocr-root-span-approval', version: 1, ruleVersion: WINDOWS_OCR_RULE, decision: 'approved', reviewerId: 'root',
    reviewedAt: time, contentSha256: ocrContentSha256(content), independentSourceReviewSha256: content.independentSourceReview.sha256, existingIdentitySha256,
    approvedSpans: content.spans.map(span => ({ field: span.field, spanSha256: hash(canonicalJson(span)), correctionsSha256: hash(canonicalJson(span.corrections)) })),
    scope: 'one_existing_upc_zh_identity_only', codeReviewManifestSha256: '' }
    codeApprovalRef = putJson('maintenance/test-only/root-code-test-authority.json', codeManifest())
    approval.codeReviewManifestSha256 = codeApprovalRef.sha256
    approvalRef = putJson('maintenance/test-only/root-test-authority.json', approval); envelope.rootApproval = approvalRef }
  const replaceTestCodeManifest = (change: (code: any) => void) => {
    const code = codeManifest(); change(code); codeApprovalRef = putJson('maintenance/test-only/root-code-test-authority.json', code)
    const spanApproval = JSON.parse(new TextDecoder().decode(artifacts.get(approvalRef.objectKey)!)); spanApproval.codeReviewManifestSha256 = codeApprovalRef.sha256
    approvalRef = putJson('maintenance/test-only/root-test-authority.json', spanApproval); envelope.rootApproval = approvalRef
  }
  testOnlyApprove()
  const envelopeRef = () => putJson('maintenance/test-only/envelope.json', envelope)
  const e = (kind: string) => { const span = spans.find(span => span.field === kind); return { sourceId, url, snapshotSha256: hash(raw), objectKey: rawRef.objectKey,
    locator: `page ${span.physicalPage}`, quote: span.independentlyReadLiteral } }
  const proposal: MaintenanceProposal = { id: 'synthetic-ocr-proposal', universityId: UPC_OCR_SCHOOL, entityType: 'program', recordId: UPC_OCR_RECORD, operation: 'patch', status: 'ready', warnings: [],
    fields: { name: { zh: '化学工程与技术' }, degreeLevel: 'master', programType: 'degree', programUrl: url, internationalAdmissionsEvidence: e('international') },
    scope: { year: null, intake: null }, source: { id: sourceId, url, objectKey: rawRef.objectKey, snapshotSha256: hash(raw), checkedAt: time,
      contentType: 'application/pdf', locator: 'page 6', quote: '化学工程与技术', textArtifact: { ...envelopeRef(), rawSnapshotSha256: hash(raw), parser: WINDOWS_OCR_PARSER } },
    fieldEvidence: [{ ...e('name'), fieldPath: 'name.zh' }, { ...e('degree'), fieldPath: 'degreeLevel' }, { ...e('degree'), fieldPath: 'programType' }] }
  // objectKey/hash only belong in textArtifact; the reference byteLength is private index metadata.
  delete (proposal.source.textArtifact as any).byteLength
  const sealSyntheticProof = async () => {
    proposal.source.textArtifact!.sha256 = envelopeRef().sha256
    const proof = await makeDeterministicReviewProof(proposal, { reviewedAt: time, sourceContentSha256: ocrContentSha256(content),
      independentSourceReview: content.independentSourceReview, rootSpanApproval: approvalRef, rootCodeApproval: codeApprovalRef })
    const proofRef = putJson('maintenance/test-only/deterministic-proof.json', proof)
    proposal.review = { decision: 'approved', reviewerId: PRIVATE_REVIEWER, method: 'deterministic', reviewedAt: time,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: hash(raw), artifactKey: proofRef.objectKey, reviewArtifactSha256: proofRef.sha256,
      checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  }
  await sealSyntheticProof()
  const reader = async (key: string) => { const value = artifacts.get(key); if (!value) throw Error('missing_test_artifact'); return value }
  const approvals = () => [{ artifactKey: approvalRef.objectKey, sha256: approvalRef.sha256, codeApproval: codeApprovalRef }]
  const verify = async (authorized = true) => { await sealSyntheticProof(); return verifyWindowsOcrReviewedSource({ proposal, rawPdf: raw, envelopeBytes: encode(envelope), readArtifact: reader,
    approvals: authorized ? approvals() : [], existingIdentitySha256 }) }
  const run = async (authorized = true, registerCodeAuthority = true, mutateReview?: (proposal: MaintenanceProposal) => void) => {
    await sealSyntheticProof(); mutateReview?.(proposal)
    const data = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'synthetic-windows-ocr-test-only',
      inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: time, proposals: [proposal] }
    return importIdentityCandidates({ bundle, scope, batch: { ...data, sha256: await exportContentSha256(data) }, acceptedAt,
      receiptPath: 'quality/test-ocr/receipt.json', readArtifact: reader, reviewedWindowsOcrSources: authorized
        ? approvals().map(ref => registerCodeAuthority ? ref : ({ ...ref, codeApproval: undefined } as any)) : [] }) }
  return { artifacts, content, envelope, proposal, independent, raw, spans, verify, run, testOnlyApprove, putJson, reader, existing, existingIdentitySha256,
    replaceTestCodeManifest, codeRef: () => codeApprovalRef }
}

describe('explicit reviewed Windows OCR source contract', () => {
  it('requires independently registered authority even if proposal embeds an approved-looking root file', async () => {
    const f = await fixture(); await expect(f.verify(false)).rejects.toThrow('root_authority_not_registered')
    expect((await f.run(false)).receipt.held[0].reason).toBe('windows_ocr_root_authority_not_registered')
  })
  it('formal import refuses a span registration without explicit code approval registration', async () => {
    const f = await fixture(); const result = await f.run(true, false)
    expect(result.receipt.accepted).toHaveLength(0); expect(result.receipt.held[0].reason).toBe('windows_ocr_root_code_authority_not_registered')
  })
  it.each(['missing', 'modified'])('formal import refuses a %s code artifact', async (attack) => {
      const f = await fixture()
      if (attack === 'missing') f.artifacts.delete(f.codeRef().objectKey); else f.artifacts.set(f.codeRef().objectKey, Buffer.from('{}'))
      const result = await f.run(); expect(result.receipt.accepted).toHaveLength(0)
      expect(result.receipt.held[0].reason).toBe(attack === 'missing' ? 'missing_test_artifact' : 'windows_ocr_artifact_checksum_or_length_changed')
  })
  it.each(['pending', 'wrong-reviewer', 'cross-content', 'missing-pins', 'duplicate-pins'])(
    'formal import rejects %s code approval after the synthetic span authority rehashes it', async (attack) => {
      const f = await fixture()
      f.replaceTestCodeManifest(code => {
        if (attack === 'pending') code.decision = 'pending'
        if (attack === 'wrong-reviewer') code.reviewerId = 'another-agent'
        if (attack === 'cross-content') code.contentSha256 = hash('other-content')
        if (attack === 'missing-pins') code.dependencyPins = []
        if (attack === 'duplicate-pins') code.dependencyPins[1] = code.dependencyPins[0]
      })
      const result = await f.run(); expect(result.receipt.accepted).toHaveLength(0); expect(result.receipt.held).toHaveLength(1)
      if (attack === 'cross-content') expect(result.receipt.held[0].reason).toBe('windows_ocr_root_code_approval_content_mismatch')
  })
  it.each(['human-method', 'checksum', 'proposal-sha', 'snapshot-sha'])(
    'formal import rejects deterministic proof attack: %s', async (attack) => {
      const f = await fixture()
      const result = await f.run(true, true, proposal => {
        if (attack === 'human-method') { proposal.review!.method = 'human'; return }
        const key = proposal.review!.artifactKey!
        if (attack === 'checksum') { f.artifacts.set(key, Buffer.from('changed')); return }
        const proof = JSON.parse(new TextDecoder().decode(f.artifacts.get(key)!))
        if (attack === 'proposal-sha') proof.candidateSha256 = hash('other-proposal')
        if (attack === 'snapshot-sha') proof.snapshotSha256 = hash('other-snapshot')
        proposal.review!.reviewArtifactSha256 = f.putJson(key, proof).sha256
      })
      expect(result.receipt.accepted).toHaveLength(0); expect(result.receipt.held).toHaveLength(1)
      expect(result.receipt.held[0].reason).toContain(attack === 'human-method' ? 'ocr_private_review_method_or_reviewer_mismatch'
        : attack === 'checksum' ? 'ocr_private_review_artifact_checksum_mismatch' : attack === 'proposal-sha' ? 'ocr_private_review_proposal_sha_mismatch' : 'ocr_private_review_snapshot_sha_mismatch')
  })
  it('verifies only the four synthetic test-approved literals at their physical pages and imports only ZH identity', async () => {
    const f = await fixture(), text = await f.verify(); expect(text.split('\f')).toHaveLength(10)
    expect(text.split('\f')[0]).toBe('中国石油大学（华东）'); expect(text).not.toContain('中玉'); expect(text).not.toContain('学 术')
    const result = await f.run(); expect(result.receipt.held).toEqual([]); expect(result.receipt.accepted).toHaveLength(1)
    expect(result.acceptances.entries[0].verifiedName).toEqual({ zh: '化学工程与技术' }); expect(result.acceptances.entries[0].verifiedNameAlias).toBeUndefined()
    const raw = result.bundle.programs.find(row => row.id === UPC_OCR_RECORD)!; expect({ ...raw, sourceIds: f.existing.sourceIds }).toEqual(f.existing)
    const projected = projectVerifiedProgramName(raw, result.bundle.sources, result.acceptances.entries, '2026-10-30')!
    expect(projected.name).toEqual({ zh: '化学工程与技术' }); expect(projected.name.en).toBeUndefined(); expect(projected.name.ru).toBeUndefined()
    const parentAcceptances = identityAcceptanceLedgerSchema.parse(JSON.parse(readFileSync(join(process.cwd(), 'content/data/identity-acceptances.json'), 'utf8'))).entries
      .filter(entry => entry.entityType !== 'program' || entry.recordId !== UPC_OCR_RECORD)
    const visible = selectDiscoveryData(result.bundle, '2026-10-30', [...parentAcceptances, ...result.acceptances.entries]).programs.find(row => row.id === UPC_OCR_RECORD)!
    expect(visible).toBeDefined(); expect(visible.teachingLanguages).toEqual([]); expect(visible.durationMonths).toBeNull(); expect(visible.languageRequirements).toEqual([])
  })
  it('does not accept modified transcript characters without root reapproval', async () => {
    const f = await fixture(); f.content.spans.find(span => span.field === 'institution')!.corrections[0].reviewedText = '囯'
    await expect(f.verify()).rejects.toThrow('root_content_binding_changed')
  })
  it.each(['page-image', 'native-box', 'raw-sha', 'missing-page', 'research-direction', 'wrong-degree', 'unreviewed-en', 'conditions'])(
    'holds %s even when a synthetic test authority rehashes the edited packet', async (attack) => {
      const f = await fixture()
      if (attack === 'page-image') f.content.pages[5].image.sha256 = hash('wrong-image')
      if (attack === 'native-box') f.content.spans.find(span => span.field === 'name')!.nativeWords[0].boundingRect.x++
      if (attack === 'raw-sha') f.content.rawSnapshotSha256 = hash('wrong-raw')
      if (attack === 'missing-page') f.content.pages.pop()
      if (attack === 'research-direction') { f.content.spans.find(span => span.field === 'name')!.independentlyReadLiteral = '工业催化'; f.proposal.fields.name = { zh: '工业催化' } }
      if (attack === 'wrong-degree') f.proposal.fields.degreeLevel = 'doctorate'
      if (attack === 'unreviewed-en') f.proposal.fields.name = { zh: '化学工程与技术', en: 'Chemical Engineering and Technology' }
      if (attack === 'conditions') f.proposal.fields.languageRequirements = ['IELTS 6.0']
      const reason = attack === 'page-image' ? 'wrong_page_image_or_order' : attack === 'native-box' ? 'native_word_or_bbox_changed'
        : attack === 'raw-sha' ? 'original_pdf_binding_changed' : attack === 'missing-page' ? undefined : 'unreviewed_identity_or_dynamic_field'
      f.testOnlyApprove(); if (reason) await expect(f.verify()).rejects.toThrow(reason); else await expect(f.verify()).rejects.toThrow()
    })
  it('rejects modified original OCR bytes, a missing original page result, or a fake full corrected glyph box', async () => {
    for (const attack of ['changed-ocr', 'missing-ocr', 'fake-glyph-box']) { const f = await fixture()
      if (attack === 'changed-ocr') f.artifacts.set(f.content.originalOcr[0].result.objectKey, Buffer.from('{}'))
      if (attack === 'missing-ocr') f.artifacts.delete(f.content.originalOcr[19].result.objectKey)
      if (attack === 'fake-glyph-box') { f.independent.institutionCorrectionRecommendation.nativeRectCoversFullCorrectedGlyph = true
        f.content.independentSourceReview = f.putJson('maintenance/test-only/independent.json', f.independent); f.testOnlyApprove() }
      await expect(f.verify()).rejects.toThrow()
    }
  })
  it('rejects current raw identity drift and page locator drift', async () => {
    const f = await fixture(); await expect(verifyWindowsOcrReviewedSource({ proposal: f.proposal, rawPdf: f.raw, envelopeBytes: encode(f.envelope), readArtifact: f.reader,
      approvals: [{ artifactKey: f.envelope.rootApproval.objectKey, sha256: f.envelope.rootApproval.sha256, codeApproval: f.codeRef() }], existingIdentitySha256: hash('changed') })).rejects.toThrow('current_raw_identity_changed')
    f.proposal.fieldEvidence[0].locator = 'page 5'; await expect(f.verify()).rejects.toThrow('unreviewed_field_or_locator')
  })
  it.each(['poppler', 'tesseract', 'browser-dom'] as const)('does not let the reviewed envelope relabel itself %s', async (parser) => {
    const f = await fixture(); f.proposal.source.textArtifact!.parser = parser
    expect((await f.run()).receipt.held[0].reason).toBe('windows_ocr_cannot_downgrade_to_native_parser')
  })
  it.each(['poppler', 'tesseract', 'browser-dom'] as const)('does not let the known original scan borrow %s authority after rewriting the envelope as plain text', async parser => {
    const f = await fixture(); f.proposal.source.snapshotSha256 = UPC_SCAN_RAW_SHA256; f.proposal.source.textArtifact!.parser = parser
    expect(() => requireExplicitKnownWindowsOcrParser(f.proposal)).toThrow('known_scan_requires_explicit_windows_ocr_parser')
  })
  it.each(['poppler', 'tesseract', 'browser-dom'] as const)('preserves an existing ordinary %s text-artifact path', async (parser) => {
    const f = await fixture(), text = Buffer.from('International students. 硕士 化学工程与技术'), textKey = 'maintenance/test-only/ordinary.txt'
    f.artifacts.set(textKey, text); f.proposal.source.textArtifact = { objectKey: textKey, sha256: hash(text), rawSnapshotSha256: hash(f.raw), parser }
    f.proposal.source.locator = 'page 1'; f.proposal.source.quote = '化学工程与技术'
    f.proposal.fieldEvidence = [{ ...f.proposal.fieldEvidence[0], locator: 'page 1', quote: '化学工程与技术' }]
    f.proposal.review = { decision: 'approved', reviewerId: 'human:test', method: 'human', reviewedAt: time, candidateSha256: await proposalContentSha256(f.proposal),
      snapshotSha256: hash(f.raw), checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
    await expect(verifyReviewedProposalEvidence(f.proposal, scope.schools.find(row => row.universityId === UPC_OCR_SCHOOL)!, f.reader)).resolves.toBeUndefined()
  })
  it('keeps receipt scope immutable and fails closed when scope, URL and receipt are simultaneously deleted', async () => {
    const f = await fixture(), result = await f.run(), original = result.acceptances.entries[0], raw = result.bundle.programs.find(row => row.id === UPC_OCR_RECORD)!
    expect(scopedNameReceiptMatches(original, result.receipt)).toBe(true)
    const changed = structuredClone(result.receipt); changed.accepted[0].verifiedName = { zh: '工业催化' }
    expect(scopedNameReceiptMatches(original, changed)).toBe(false)
    const stripped = { ...original }; delete stripped.verifiedName; delete stripped.verifiedSourceUrl; delete stripped.verifiedNameAlias
    expect(scopedNameReceiptMatches(stripped, undefined)).toBe(false)
    expect(projectVerifiedProgramName(raw, result.bundle.sources, [stripped], '2026-10-30')).toBeUndefined()
    expect(projectVerifiedProgramName(raw, result.bundle.sources, [], '2026-10-30')).toBeUndefined()
    const root = mkdtempSync(join(tmpdir(), 'upc-ocr-scope-test-')), data = join(root, 'content/data')
    try { mkdirSync(data, { recursive: true }); writeFileSync(join(data, 'identity-acceptances.json'), JSON.stringify({ schemaVersion: 1, entries: [stripped] }))
      expect(() => readIdentityAcceptances(data, { strictProjection: true })).toThrow('identity_scoped_name_receipt_invalid')
      for (const [key, name] of [['cities', 'cities'], ['sources', 'sources'], ['universities', 'universities'], ['programs', 'programs'], ['admissionCycles', 'admission-cycles'], ['scholarships', 'scholarships']] as const) {
        writeFileSync(join(data, `${name}.json`), JSON.stringify(result.bundle[key]))
      }
      mkdirSync(join(root, 'content/maintenance'), { recursive: true }); writeFileSync(join(root, 'content/maintenance/scope-272.v1.json'), JSON.stringify(scope))
      await expect(validateDirectory(root, '2026-10-30')).rejects.toThrow('directory_scoped_name_binding_invalid')
      writeFileSync(join(data, 'identity-acceptances.json'), JSON.stringify({ schemaVersion: 1, entries: [original] }))
      expect(() => readIdentityAcceptances(data, { strictProjection: true })).toThrow('identity_scoped_name_receipt_invalid')
      const receipt = join(root, original.receiptPath); mkdirSync(join(root, 'quality/test-ocr'), { recursive: true }); writeFileSync(receipt, JSON.stringify(changed))
      expect(() => readIdentityAcceptances(data, { strictProjection: true })).toThrow('identity_scoped_name_receipt_invalid')
    } finally { expect(root.startsWith(join(tmpdir(), 'upc-ocr-scope-test-'))).toBe(true); rmSync(root, { recursive: true, force: true }) }
  })
})
