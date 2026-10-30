/* eslint-disable @typescript-eslint/no-explicit-any -- Adversarial fixtures intentionally violate the typed source contract. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { canonicalJson, proposalContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { verifyWindowsOcrReviewedSource, requireExplicitKnownWindowsOcrParser, rejectWindowsOcrEnvelopeAsNative } from '../../scripts/maintenance/windows-ocr-reviewed-source'
import { ocrContentSha256, STU_OCR_RECORD, STU_SCAN_RAW_SHA256 } from '../../scripts/maintenance/windows-ocr-stu-reviewed-source'
import { makeDeterministicReviewProof, PRIVATE_REVIEWER } from '../../scripts/maintenance/windows-ocr-stu-deterministic-review'
import { hasRequiredProgramNameScope, identityAcceptanceLedgerSchema } from '../../src/lib/data/identity-acceptance'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
// CI uses committed, original official evidence. The local override permits the
// same negative tests BEFORE a dry-run or acceptance; it is test-only authority.
const directory = resolve(process.env.STUDYINCHINA_STU_OCR_TEST_EVIDENCE_DIR ?? 'quality/minimum-one/2026-10-27/batch047')
const archived = existsSync(join(directory, 'evidence-index.json'))
const index = JSON.parse(readFileSync(join(directory, archived ? 'evidence-index.json' : 'artifact-index.json'), 'utf8'))
const rows: any[] = archived ? index : index.artifacts
const original = new Map<string, Buffer>(rows.map(row => {
  const bytes = archived ? gunzipSync(readFileSync(join(directory, row.artifactPath))) : readFileSync(row.file)
  if (hash(bytes) !== row.sha256) throw Error('test_original_artifact_changed')
  return [row.objectKey, bytes]
}))
const batch = JSON.parse(readFileSync(join(directory, archived ? 'export.json' : 'candidate-export.json'), 'utf8'))
const envelopeOriginal = JSON.parse(original.get(batch.proposals[0].source.textArtifact.objectKey)!.toString('utf8'))

async function fixture() {
  const artifacts = new Map(original), proposal: MaintenanceProposal = structuredClone(batch.proposals[0])
  const envelope: any = structuredClone(envelopeOriginal), content = envelope.content
  const put = (key: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value) + '\n'); artifacts.set(key, bytes)
    return { objectKey: key, sha256: hash(bytes), byteLength: bytes.length }
  }
  const read = async (key: string) => { const bytes = artifacts.get(key); if (!bytes) throw Error('missing_test_artifact'); return bytes }
  let registration: any
  const seal = async () => {
    // This approval exists only inside each test. Rehashing tests the semantic
    // guards even when a self-consistent producer supplies new authority bytes.
    const reviewedAt = new Date().toISOString(), contentSha256 = ocrContentSha256(content)
    const code = put('maintenance/test-stu/code.json', { format: 'studyinchina.windows-ocr-stu-code-review', version: 2,
      privateProducerVersion: 'stu-reviewed-windows-ocr-private-v1', ruleVersion: content.ruleVersion,
      decision: 'approved', reviewerId: 'root', contentSha256,
      dependencyPins: ['producer', 'acceptor', 'verifier'].map(file => ({ file: `test-only/${file}`, sha256: hash(file) })) })
    envelope.rootApproval = put('maintenance/test-stu/spans.json', { format: 'studyinchina.windows-ocr-root-span-approval', version: 1,
      ruleVersion: content.ruleVersion, decision: 'approved', reviewerId: 'root', reviewedAt, contentSha256,
      independentSourceReviewSha256: content.independentSourceReview.sha256, existingIdentitySha256: content.existingIdentitySha256,
      approvedSpans: content.spans.map((s: any) => ({ field: s.field, spanSha256: hash(canonicalJson(s)), correctionsSha256: hash(canonicalJson(s.corrections)) })),
      scope: 'one_existing_stu_en_identity_only', codeReviewManifestSha256: code.sha256 })
    const envelopeRef = put('maintenance/test-stu/envelope.json', envelope)
    proposal.status = 'ready'
    proposal.source.textArtifact = { ...proposal.source.textArtifact!, objectKey: envelopeRef.objectKey, sha256: envelopeRef.sha256 }
    const proof = await makeDeterministicReviewProof(proposal, { reviewedAt, sourceContentSha256: contentSha256,
      independentSourceReview: content.independentSourceReview, rootSpanApproval: envelope.rootApproval, rootCodeApproval: code })
    const proofRef = put('maintenance/test-stu/proof.json', proof)
    proposal.review = { method: 'deterministic', reviewerId: PRIVATE_REVIEWER, decision: 'approved', reviewedAt,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: proposal.source.snapshotSha256,
      artifactKey: proofRef.objectKey, reviewArtifactSha256: proofRef.sha256,
      checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
    registration = { artifactKey: envelope.rootApproval.objectKey, sha256: envelope.rootApproval.sha256, codeApproval: code }
  }
  const verify = async (authorized = true, afterSeal?: (registration: any) => void) => {
    await seal()
    afterSeal?.(registration)
    return verifyWindowsOcrReviewedSource({ proposal, envelopeBytes: await read(proposal.source.textArtifact!.objectKey),
      rawPdf: await read(proposal.source.objectKey), readArtifact: read, approvals: authorized ? [registration] : [],
      existingIdentitySha256: '0c86b84612b9ad65d00e7c7ad3188472516d8f94591934939217af8db503de09' })
  }
  return { artifacts, proposal, content, envelope, verify }
}

describe('Shantou original scanned international undergraduate catalogue', () => {
  it('accepts only four independently read literals, with two-line unmodified English words', async () => {
    const f = await fixture(), text = await f.verify()
    expect(text.split('\f')).toHaveLength(4)
    expect(text).toContain('COMPUTER SCIENCE AND TECHNOLOGY')
    expect(text).toContain('UNDERGRADUATE PROGRAMS')
    expect(text).not.toContain('—ZJPROGRAMS')
    expect(text).not.toContain('ARTIFICIAL INTELLIGENCE')
  })
  it('cannot approve itself by embedding a root-looking file', async () => {
    await expect((await fixture()).verify(false)).rejects.toThrow('root_authority_not_registered')
  })
  it.each(['missing-code', 'changed-code', 'missing-span', 'human-review', 'proof-checksum', 'proof-candidate'])(
    'refuses %s authority even for the genuine source', async attack => {
      const f = await fixture()
      await expect(f.verify(true, registration => {
        if (attack === 'missing-code') delete registration.codeApproval
        if (attack === 'changed-code') f.artifacts.set(registration.codeApproval.objectKey, Buffer.from('{}'))
        if (attack === 'missing-span') f.artifacts.delete(registration.artifactKey)
        if (attack === 'human-review') f.proposal.review!.method = 'human'
        if (attack === 'proof-checksum') f.artifacts.set(f.proposal.review!.artifactKey!, Buffer.from('{}'))
        if (attack === 'proof-candidate') {
          const key = f.proposal.review!.artifactKey!, proof = JSON.parse(f.artifacts.get(key)!.toString('utf8'))
          proof.candidateSha256 = hash('another-candidate')
          const bytes = Buffer.from(JSON.stringify(proof)); f.artifacts.set(key, bytes); f.proposal.review!.reviewArtifactSha256 = hash(bytes)
        }
      })).rejects.toThrow()
    })
  it.each(['university', 'record', 'degree', 'locale', 'url', 'year', 'intake', 'fee', 'deadline', 'code'])(
    'rejects an independently rehashed candidate with unreviewed %s', async attack => {
      const f = await fixture(), p: any = f.proposal
      if (attack === 'university') p.universityId = 'uni-other'
      if (attack === 'record') p.recordId = 'other-programme'
      if (attack === 'degree') p.fields.degreeLevel = 'master'
      if (attack === 'locale') p.fields.name.zh = '计算机科学与技术'
      if (attack === 'url') p.fields.programUrl = 'https://sie.stu.edu.cn/other.pdf'
      if (attack === 'year') p.scope.year = 2026
      if (attack === 'intake') p.scope.intake = 'fall'
      if (attack === 'fee') p.fields.tuition = 20000
      if (attack === 'deadline') p.fields.deadline = '2026-06-30'
      if (attack === 'code') p.fields.officialProgramCode = '10560'
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['college-column', 'reverse-lines', 'word', 'bbox', 'angle', 'page', 'language', 'correction', 'duplicate-span', 'degree-title'])(
    'rejects rehashed %s evidence rather than repairing it', async attack => {
      const f = await fixture(), s = f.content.spans.find((x: any) => x.field === 'name')
      if (attack === 'college-column') s.segments[0].nativeLineIndex = 81
      if (attack === 'reverse-lines') s.segments.reverse()
      if (attack === 'word') s.segments[0].nativeWords[0].text = 'COMPUTING'
      if (attack === 'bbox') s.segments[0].nativeWords[0].boundingRect.x += 1
      if (attack === 'angle') s.nativeTextAngle = 1
      if (attack === 'page') s.physicalPage = 3
      if (attack === 'language') s.language = 'zh-Hans-CN'
      if (attack === 'correction') s.corrections = [{ rawText: 'bad', reviewedText: 'good' }]
      if (attack === 'duplicate-span') f.content.spans[1] = structuredClone(s)
      if (attack === 'degree-title') f.content.spans.find((x: any) => x.field === 'degree').segments = [{ nativeLineIndex: 26, firstWord: 0, lastWord: 0, nativeWords: [] }]
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['missing-page', 'reordered-pages', 'duplicate-ocr', 'wrong-image', 'image-size', 'missing-ocr', 'raw', 'profile', 'source-review'])(
    'rejects %s despite self-consistent approval hashes', async attack => {
      const f = await fixture(), c = f.content
      if (attack === 'missing-page') c.pages.pop()
      if (attack === 'reordered-pages') c.pages.reverse()
      if (attack === 'duplicate-ocr') c.originalOcr[1] = structuredClone(c.originalOcr[0])
      if (attack === 'wrong-image') c.pages[1].image = structuredClone(c.pages[0].image)
      if (attack === 'image-size') c.pages[1].width -= 1
      if (attack === 'missing-ocr') f.artifacts.delete(c.originalOcr[7].result.objectKey)
      if (attack === 'raw') f.artifacts.set(f.proposal.source.objectKey, Buffer.from('%PDF-synthetic replacement'))
      if (attack === 'profile') c.rawSnapshotSha256 = hash('different scan')
      if (attack === 'source-review') c.independentSourceReview.sha256 = hash('different review')
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['poppler-pdftotext', 'browser-dom', 'pdf-native-text'])(
    'known scanned PDF cannot acquire %s authority', async parser => {
      const f = await fixture(), p: any = f.proposal
      p.source.snapshotSha256 = STU_SCAN_RAW_SHA256; p.source.textArtifact.parser = parser
      expect(() => requireExplicitKnownWindowsOcrParser(p)).toThrow('known_scan_requires_explicit_windows_ocr_parser')
      expect(() => rejectWindowsOcrEnvelopeAsNative(Buffer.from(JSON.stringify(f.envelope)))).toThrow('cannot_downgrade_to_native_parser')
    })
  it('removing scoped names cannot restore unreviewed Chinese or Russian names', () => {
    const ledger = identityAcceptanceLedgerSchema.parse(JSON.parse(readFileSync('content/data/identity-acceptances.json', 'utf8')))
    const entry = ledger.entries.find(x => x.recordId === STU_OCR_RECORD)
    if (!entry) {
      // The local pre-acceptance run still checks the identical scope guard.
      const example = { ...ledger.entries.find(x => x.entityType === 'program')!, recordId: STU_OCR_RECORD, verifiedName: undefined, verifiedNameAlias: undefined }
      expect(hasRequiredProgramNameScope(example)).toBe(false)
    } else {
      expect(entry.verifiedName).toEqual({ en: 'COMPUTER SCIENCE AND TECHNOLOGY' })
      expect(hasRequiredProgramNameScope({ ...entry, verifiedName: undefined })).toBe(false)
    }
  })
})
