/* eslint-disable @typescript-eslint/no-explicit-any -- Adversarial evidence deliberately violates typed contracts. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROGRAM_CORRESPONDENCE_RULE, reviewedProgramCorrespondenceProfiles } from '../../src/lib/data/reviewed-program-correspondence'
import { correspondenceApprovalSubjectSha256, correspondenceSchoolAudit } from '../../scripts/maintenance/reviewed-program-correspondence'
import { loadReviewedProgramAliases, resolveReviewedProgramAlias } from '../../scripts/maintenance/reviewed-program-alias'
import { canonicalJson, exportContentSha256, proposalContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { importIdentityCandidates } from '../../scripts/maintenance/import-identities'
import { hasRequiredProgramNameScope, identityFingerprint, verifiedNameMatchesRecord } from '../../src/lib/data/identity-acceptance'

const root = resolve('tests/fixtures/official-program-correspondence')
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const time = '2026-11-01T00:00:00.000Z'
async function fixture(recordId: string) {
  const profile = reviewedProgramCorrespondenceProfiles.find(p => p.recordId === recordId)!, files = index.find((r: any) => r.recordId === recordId)
  const artifacts = new Map<string, Buffer>()
  const save = (key: string, bytes: Buffer) => { artifacts.set(key, bytes); return { artifactKey: key, sha256: hash(bytes) } }
  const put = (label: string, value: unknown) => save('maintenance/test-correspondence/' + label + '.json', Buffer.from(JSON.stringify(value) + '\n'))
  const file = (item: any, label: string) => {
    const bytes = readFileSync(join(root, item.file)); if (hash(bytes) !== item.sha256) throw Error('genuine_fixture_changed')
    return save('maintenance/test-correspondence/' + label, bytes)
  }
  const raw = file(files.raw, 'original'), textRef = file(files.text, 'canonical'), text = artifacts.get(textRef.artifactKey)!.toString('utf8')
  const peers = JSON.parse(readFileSync(join(root, files.peers.file), 'utf8'))
  const context: any = { inputCatalogSha256: 'c'.repeat(64), programs: peers, bindings: { schemaVersion: 1, entries: [] } }
  const evidence = (Object.entries(profile.quotes) as Array<[string, string]>).map(([field, quote]) => {
    const start = text.indexOf(quote); if (start < 0) throw Error('genuine_source_quote_missing')
    const page = profile.parser === 'poppler' ? field === 'institution' ? 1 : 2 : null
    return { field, quote, quoteSha256: hash(quote), utf16Range: { start, end: start + quote.length }, physicalPage: page,
      locator: page === null ? `text:offset:${start}:${start + quote.length}` : `page ${page}` }
  })
  const e = (kind: string) => { const x = evidence.find(x => x.field === kind)!; return { sourceId: profile.sourceId, url: profile.sourceUrl,
    snapshotSha256: profile.rawSha256, objectKey: raw.artifactKey, locator: x.locator, quote: x.quote } }
  const proposal: MaintenanceProposal = { id: 'test-only-correspondence-' + recordId, universityId: profile.universityId, entityType: 'program',
    recordId, operation: 'patch', status: 'ready', warnings: [], fields: { name: structuredClone(profile.verifiedName), degreeLevel: 'master', programType: 'degree',
      programUrl: profile.sourceUrl, internationalAdmissionsEvidence: e('international') }, scope: { year: null, intake: null },
    source: { id: profile.sourceId, url: profile.sourceUrl, snapshotSha256: profile.rawSha256, objectKey: raw.artifactKey,
      locator: e('degree').locator, quote: e('degree').quote, checkedAt: files.sourceCheckedAt,
      contentType: profile.parser === 'html' ? 'text/html' : 'application/pdf',
      ...(profile.parser === 'poppler' ? { textArtifact: { objectKey: textRef.artifactKey, sha256: textRef.sha256, parser: 'poppler' as const, rawSnapshotSha256: profile.rawSha256 } } : {}) },
    fieldEvidence: [{ ...e('name'), fieldPath: 'name.zh' }, { ...e('degree'), fieldPath: 'degreeLevel' }, { ...e('degree'), fieldPath: 'programType' }] }
  const nationalText = files.national ? file(files.national.text, 'national-canonical') : null
  const nationalBody = nationalText ? artifacts.get(nationalText.artifactKey)!.toString('utf8') : ''
  const authorityStart = profile.authority ? nationalBody.indexOf(profile.authority.quote) : -1
  const proof: any = { format: 'studyinchina.reviewed-official-program-correspondence', version: 1, ruleVersion: PROGRAM_CORRESPONDENCE_RULE,
    decision: 'approved_existing_identity_only', reviewerId: 'codex-root', reviewedAt: time, reviewMethod: 'independent_exact_record_source_correspondence',
    recordId, universityId: profile.universityId, existingIdentitySha256: profile.identitySha256, verifiedName: structuredClone(profile.verifiedName),
    degreeLevel: 'master', programType: 'degree', proposalId: proposal.id, proposalContentSha256: await proposalContentSha256(proposal),
    source: { sourceId: profile.sourceId, url: profile.sourceUrl, snapshotSha256: profile.rawSha256, objectKey: raw.artifactKey,
      canonicalTextSha256: profile.textSha256, textArtifactKey: textRef.artifactKey, contentType: proposal.source.contentType,
      parser: profile.parser, physicalPages: profile.physicalPages, checkedAt: files.sourceCheckedAt },
    officialEvidence: evidence, currentIdentityAudit: correspondenceSchoolAudit(context, profile.universityId),
    nativeProof: files.nativeProof ? file(files.nativeProof, 'native-provenance') : null, sourceResearch: file(files.sourceResearch, 'independent-reading'),
    renameAuthority: profile.authority ? { url: profile.authority.url, raw: file(files.national.raw, 'national-original'), canonicalText: nationalText,
      quote: profile.authority.quote, utf16Range: { start: authorityStart, end: authorityStart + profile.authority.quote.length }, categoryCodeIsNotInstitutionProgrammeCode: true } : null,
    originalModelEvidence: files.originalModel ? { proposal: file(files.originalModel.proposal, 'original-model-proposal'), attempts: file(files.originalModel.attempts, 'original-model-attempts'),
      review: file(files.originalModel.review, 'original-model-review'), originalModelCandidateUnchanged: true, normalizedCandidateReviewedByRootOnly: true } : null,
    codeReview: put('code', { format: 'studyinchina.official-correspondence-code-review', version: 1, ruleVersion: PROGRAM_CORRESPONDENCE_RULE,
      reviewerId: 'codex-root', decision: 'approved', reviewedAt: time, allowedRecords: reviewedProgramCorrespondenceProfiles.map(p => p.recordId),
      dependencyPins: ['source-profile', 'verifier', 'importer'].map(file => ({ file: 'test-only/' + file, sha256: hash(file) })) }), rootApproval: null }
  const read = async (key: string) => { const value = artifacts.get(key); if (!value) throw Error('missing_test_artifact'); return value }
  let proofRef: any
  const seal = async () => {
    proof.proposalId = proposal.id; proof.proposalContentSha256 = await proposalContentSha256(proposal)
    proof.rootApproval = put('root', { format: 'studyinchina.official-correspondence-root-approval', version: 1, ruleVersion: PROGRAM_CORRESPONDENCE_RULE,
      reviewerId: 'codex-root', decision: 'approved_existing_identity_only', reviewedAt: proof.reviewedAt,
      subjectSha256: correspondenceApprovalSubjectSha256(proof) })
    proofRef = put('proof', proof)
    proposal.review = { decision: 'approved', method: 'deterministic', reviewerId: 'deterministic:test-only-correspondence', reviewedAt: time,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: proposal.source.snapshotSha256,
      checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  }
  const verify = async (afterSeal?: () => void) => {
    await seal(); afterSeal?.()
    const loaded = (await loadReviewedProgramAliases([proofRef], [proposal], read))[0]
    return resolveReviewedProgramAlias(loaded, proposal, proposal.fields as any, context.programs, time, read, context)
  }
  const run = async (authorized = true) => {
    const bundle = loadMaintenanceBundle(process.cwd()); bundle.programs = bundle.programs.filter(p => p.universityId !== profile.universityId).concat(peers)
    context.programs = bundle.programs; context.inputCatalogSha256 = await catalogSha256(bundle)
    proof.currentIdentityAudit = correspondenceSchoolAudit(context, profile.universityId); await seal()
    const scope = JSON.parse(readFileSync('content/maintenance/scope-272.v1.json', 'utf8'))
    const body = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'test-only-correspondence',
      inputCatalogSha256: context.inputCatalogSha256, scopeRegistrySha256: scope.sha256, createdAt: time, proposals: [proposal] }
    return importIdentityCandidates({ bundle, scope, batch: { ...body, sha256: await exportContentSha256(body) }, acceptedAt: time,
      receiptPath: 'quality/test-only-correspondence/receipt.json', acceptances: { schemaVersion: 1, entries: [] }, bindings: context.bindings,
      reviewedProgramAliases: authorized ? [proofRef] : [], readArtifact: read })
  }
  return { profile, proposal, proof, artifacts, context, verify, run, put }
}

for (const profile of reviewedProgramCorrespondenceProfiles) describe(profile.recordId, () => {
  it('accepts the exact source-backed correspondence and preserves its existing record', async () => {
    const f = await fixture(profile.recordId), result = await f.verify()
    expect(result?.record.id).toBe(profile.recordId); expect(result?.audit.ruleVersion).toBe(PROGRAM_CORRESPONDENCE_RULE)
    expect(result?.record.name).toMatchObject(profile.oldNames)
  })
  it('formal import reuses one ID and stores only the reviewed Chinese name', async () => {
    const f = await fixture(profile.recordId), result = await f.run()
    expect(result.receipt.held).toEqual([]); expect(result.receipt.accepted).toHaveLength(1)
    expect(result.receipt.accepted[0]).toMatchObject({ action: 'identity_accepted', recordId: profile.recordId, verifiedName: profile.verifiedName, verifiedSourceUrl: profile.sourceUrl })
    const original = f.context.programs.find((p: any) => p.id === profile.recordId), after = result.bundle.programs.find(p => p.id === profile.recordId)!
    expect({ ...after, sourceIds: original.sourceIds }).toEqual(original)
  })
  it('formal import cannot infer the alias without external proof registration', async () => {
    const f = await fixture(profile.recordId), result = await f.run(false)
    expect(result.receipt.accepted).toHaveLength(0); expect(result.receipt.held).toHaveLength(1)
  })
  it.each(['record', 'university', 'create', 'degree', 'locale', 'programme-code', 'department-code', 'fee', 'deadline', 'year', 'intake'])(
    'rejects rehashed unapproved %s', async attack => {
      const f = await fixture(profile.recordId), p: any = f.proposal
      if (attack === 'record') p.recordId = 'unrelated-record'
      if (attack === 'university') p.universityId = 'uni-other'
      if (attack === 'create') { p.operation = 'create'; p.recordId = null }
      if (attack === 'degree') p.fields.degreeLevel = 'doctorate'
      if (attack === 'locale') p.fields.name.en = 'Unreviewed English'
      if (attack === 'programme-code') p.fields.officialProgramCode = '0453'
      if (attack === 'department-code') p.fields.departmentCode = '001'
      if (attack === 'fee') p.fields.tuition = 20000
      if (attack === 'deadline') p.fields.deadline = '2027-06-30'
      if (attack === 'year') p.scope.year = 2026
      if (attack === 'intake') p.scope.intake = 'fall'
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['old-name', 'old-url', 'duplicate-name', 'other-programme-code', 'binding-code', 'audit', 'wrong-subject'])(
    'rejects %s identity context after the test root reseals it', async attack => {
      const f = await fixture(profile.recordId), existing = f.context.programs.find((p: any) => p.id === profile.recordId)
      if (attack === 'old-name') existing.name.zh += '研究方向'
      if (attack === 'old-url') existing.programUrl = 'https://example.edu/other'
      if (attack === 'duplicate-name') f.context.programs.push({ ...structuredClone(existing), id: 'duplicate-real-identity', name: { zh: profile.verifiedName.zh } })
      if (attack === 'other-programme-code') {
        const peer = f.context.programs.find((p: any) => p.id !== profile.recordId && p.degreeLevel === 'master')
        if (peer) peer.officialProgramCode = 'unknown'
        else f.context.programs.push({ ...structuredClone(existing), id: 'other-master', name: { zh: '另一个硕士专业' }, officialProgramCode: 'unknown' })
      }
      if (attack === 'binding-code') f.context.bindings.entries.push({ recordId: profile.recordId, canonicalKey: profile.universityId + '|master|degree|code:001', aliases: [] })
      if (attack !== 'audit') f.proof.currentIdentityAudit = correspondenceSchoolAudit(f.context, profile.universityId)
      else f.proof.currentIdentityAudit.bindingsSha256 = 'a'.repeat(64)
      if (attack === 'wrong-subject') { f.proposal.fields.name = { zh: '另一个专业' }; f.proof.verifiedName = { zh: '另一个专业' } }
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['raw', 'text', 'field-quote', 'field-locator', 'source-url', 'source-time', 'source-research', 'evidence-page', 'evidence-range', 'duplicate-evidence', 'missing-root', 'changed-code'])(
    'rejects %s evidence or authority', async attack => {
      const f = await fixture(profile.recordId)
      if (attack === 'raw') f.artifacts.set(f.proposal.source.objectKey, Buffer.from('replacement source'))
      if (attack === 'text') f.artifacts.set(f.proof.source.textArtifactKey, Buffer.from('replacement text'))
      if (attack === 'field-quote') f.proposal.fieldEvidence[0].quote = 'not in original'
      if (attack === 'field-locator') f.proposal.fieldEvidence[0].locator = 'page 99'
      if (attack === 'source-url') f.proposal.source.url = 'https://example.edu/other'
      if (attack === 'source-time') f.proposal.source.checkedAt = '2027-01-01T00:00:00.000Z'
      if (attack === 'source-research') f.proof.sourceResearch = f.put('wrong-source-reading', { format: 'wrong', recordId: 'other' })
      if (attack === 'evidence-page') f.proof.officialEvidence[0].physicalPage = 99
      if (attack === 'evidence-range') f.proof.officialEvidence[0].utf16Range.start++
      if (attack === 'duplicate-evidence') f.proof.officialEvidence[1] = structuredClone(f.proof.officialEvidence[0])
      if (attack === 'changed-code') f.artifacts.set(f.proof.codeReview.artifactKey, Buffer.from('{}'))
      await expect(f.verify(attack === 'missing-root' ? () => f.artifacts.delete(f.proof.rootApproval.artifactKey) : undefined)).rejects.toThrow()
    })
  it('missing scoped name or alias never restores raw sibling locales', async () => {
    const f = await fixture(profile.recordId), result = await f.verify(), record = result!.record
    const entry: any = { entityType: 'program', recordId: record.id, identitySha256: identityFingerprint('program', record), verifiedName: profile.verifiedName, verifiedNameAlias: result!.audit }
    expect(verifiedNameMatchesRecord(entry, record)).toBe(true)
    expect(hasRequiredProgramNameScope({ ...entry, verifiedName: undefined })).toBe(false)
    expect(hasRequiredProgramNameScope({ ...entry, verifiedNameAlias: undefined })).toBe(false)
    expect(verifiedNameMatchesRecord({ ...entry, verifiedName: { ...entry.verifiedName, en: 'Unreviewed' } }, record)).toBe(false)
  })
})

describe('source-specific correspondence boundaries', () => {
  const ccnu = reviewedProgramCorrespondenceProfiles[0].recordId, jnmc = reviewedProgramCorrespondenceProfiles[1].recordId
  it.each(['missing-authority', 'wrong-authority-url', 'authority-quote', 'authority-range', 'authority-raw', 'missing-model', 'model-proposal', 'model-attempts', 'model-review'])(
    'CCNU rejects %s even after test-root rehashing', async attack => {
      const f = await fixture(ccnu)
      if (attack === 'missing-authority') f.proof.renameAuthority = null
      if (attack === 'wrong-authority-url') f.proof.renameAuthority.url = 'https://example.edu/rename'
      if (attack === 'authority-quote') f.proof.renameAuthority.quote = 'another name'
      if (attack === 'authority-range') f.proof.renameAuthority.utf16Range.start++
      if (attack === 'authority-raw') f.artifacts.set(f.proof.renameAuthority.raw.artifactKey, Buffer.from('replacement authority'))
      if (attack === 'missing-model') f.proof.originalModelEvidence = null
      if (attack === 'model-proposal') f.artifacts.set(f.proof.originalModelEvidence.proposal.artifactKey, Buffer.from('{}'))
      if (attack === 'model-attempts') f.artifacts.set(f.proof.originalModelEvidence.attempts.artifactKey, Buffer.from('[]'))
      if (attack === 'model-review') f.artifacts.set(f.proof.originalModelEvidence.review.artifactKey, Buffer.from('{}'))
      await expect(f.verify()).rejects.toThrow()
    })
  it.each(['missing-native', 'native-proof', 'parser', 'missing-pages', 'borrowed-rename-authority'])(
    'Jining rejects %s', async attack => {
      const f = await fixture(jnmc)
      if (attack === 'missing-native') f.proof.nativeProof = null
      if (attack === 'native-proof') f.artifacts.set(f.proof.nativeProof.artifactKey, Buffer.from('{}'))
      if (attack === 'parser') f.proposal.source.textArtifact!.parser = 'tesseract'
      if (attack === 'missing-pages') f.proof.source.physicalPages = 6
      if (attack === 'borrowed-rename-authority') f.proof.renameAuthority = { url: 'https://icle.chinese.cn/news/detail/33' }
      await expect(f.verify()).rejects.toThrow()
    })
  it('does not register a generalized suffix-removal or master-renaming profile', () => {
    expect(reviewedProgramCorrespondenceProfiles.map(p => p.recordId)).toEqual([ccnu, jnmc])
    expect(canonicalJson(reviewedProgramCorrespondenceProfiles)).not.toContain('Clinical Medicine (Professional Master)')
  })
})
