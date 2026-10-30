import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { identityFingerprint, scopedNameReceiptMatches, verifiedNameMatchesRecord, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { HTML_PROGRAM_ALIAS_RULE, reviewedHtmlProgramAliasProfiles } from '@/lib/data/reviewed-html-program-alias'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { loadMaintenanceBundle, buildMaintenanceScope, catalogSha256 } from '../../scripts/maintenance/build-scope'
import { htmlAliasApprovalSubjectSha256, htmlAliasSchoolAudit, type ReviewedHtmlProgramAliasProof } from '../../scripts/maintenance/reviewed-html-program-alias'
import { loadReviewedProgramAliases, resolveReviewedProgramAlias } from '../../scripts/maintenance/reviewed-program-alias'
import { importIdentityCandidates } from '../../scripts/maintenance/import-identities'
import { exportContentSha256, maintenanceProposalSchema, programIdentityFieldsSchema, proposalContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'

vi.stubGlobal('crypto', webcrypto)
const now = '2026-10-30T12:00:00.000Z', today = '2026-10-30'
const fixtureRoot = join(process.cwd(), 'tests/fixtures/reviewed-html-program-alias')
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const bundle = loadMaintenanceBundle(process.cwd())
const bindings = JSON.parse(readFileSync(join(process.cwd(), 'content/data/identity-bindings.json'), 'utf8'))

/** TEST_ONLY: fake approval files live only in this in-memory map. They are
 * never persisted as source authority, imported, or offered for root approval. */
async function fixture(index = 0) {
  const profile = reviewedHtmlProgramAliasProfiles[index], key = index === 0 ? 'gznu' : 'shzu'
  const record = bundle.programs.find(item => item.id === profile.recordId)!
  const name = { ...profile.allowedNames }
  const context = { inputCatalogSha256: await catalogSha256(bundle), programs: structuredClone(bundle.programs), bindings: structuredClone(bindings) }
  const artifacts = new Map<string, Uint8Array>()
  for (const [field, extension] of [['raw', 'html'], ['text', 'txt'], ['pack', 'json'], ['candidate', 'json'], ['firstRecord', 'json']])
    artifacts.set(`TEST_ONLY/${key}/${field}`, readFileSync(join(fixtureRoot, `${key}-${field}.${extension}`)))
  const text = new TextDecoder().decode(artifacts.get(`TEST_ONLY/${key}/text`))
  const rawKey = `TEST_ONLY/${key}/raw`, textKey = `TEST_ONLY/${key}/text`
  const metadata = JSON.parse(readFileSync(join(fixtureRoot, 'capture-metadata.json'), 'utf8')).find((item: { key: string }) => item.key === key)
  const evidence = (field: 'name.zh' | 'name.en' | 'degree' | 'international' | 'institution' | 'neighbour', quote: string) => {
    const start = text.indexOf(quote)
    if (start < 0) throw Error('Real source fixture quote missing')
    return { field, quote, quoteSha256: sha(quote), locator: `text:offset:${start}:${start + quote.length}`, physicalPage: null,
      rangeUnit: 'UTF16_code_units' as const, utf16Range: { start, end: start + quote.length }, sourceId: profile.sourceId,
      sourceUrl: profile.sourceUrl, snapshotSha256: profile.rawSha256, canonicalTextSha256: profile.textSha256 }
  }
  const officialEvidence = Object.keys(name).map(locale => evidence(`name.${locale}` as 'name.zh' | 'name.en', (profile.quotes as Record<string, string>)[locale]))
  officialEvidence.push(evidence('degree', profile.quotes.degree), evidence('international', profile.quotes.international), evidence('institution', profile.quotes.institution))
  const sourceEvidence = (item: typeof officialEvidence[number]) => ({ sourceId: profile.sourceId, url: profile.sourceUrl,
    snapshotSha256: profile.rawSha256, objectKey: rawKey, locator: item.locator, quote: item.quote })
  const international = sourceEvidence(evidence('international', index === 1 ? profile.quotes.degree : profile.quotes.international))
  const proposal: MaintenanceProposal = { id: `TEST_ONLY-${key}`, universityId: profile.universityId, entityType: 'program', recordId: null,
    operation: 'create', status: 'ready', warnings: [], fields: { name, degreeLevel: 'master', programType: 'degree', programUrl: profile.sourceUrl, internationalAdmissionsEvidence: international },
    source: { ...sourceEvidence(officialEvidence[0]), id: profile.sourceId, checkedAt: metadata.checkedAt, contentType: 'text/html' },
    fieldEvidence: officialEvidence.filter(item => item.field.startsWith('name.') || item.field === 'degree').map(item => ({ ...sourceEvidence(item), fieldPath: item.field === 'degree' ? 'degreeLevel' : item.field })),
    scope: { year: null, intake: null }, extractionAttemptId: null }
  // Remove evidence-only sourceId; candidateSourceSchema uses id instead.
  delete (proposal.source as unknown as { sourceId?: string }).sourceId
  proposal.review = { decision: 'approved', reviewerId: 'deterministic:TEST_ONLY-root-fixture', method: 'deterministic', reviewedAt: now,
    candidateSha256: await proposalContentSha256(proposal), snapshotSha256: profile.rawSha256,
    checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
  const proof: ReviewedHtmlProgramAliasProof = { format: 'studyinchina.reviewed-program-identity-alias', formatVersion: 1,
    ruleVersion: HTML_PROGRAM_ALIAS_RULE, decision: 'approved_identity_alias_only', reviewedAt: now, reviewerId: 'codex-root',
    reviewMethod: 'independent_exact_record_html_metadata_review', recordId: profile.recordId, universityId: profile.universityId,
    degreeLevel: 'master', programType: 'degree', existingIdentitySha256: profile.identitySha256, oldNames: { ...profile.oldNames }, verifiedName: name,
    proposalId: proposal.id, proposalContentSha256: await proposalContentSha256(proposal),
    source: { sourceId: profile.sourceId, url: profile.sourceUrl, snapshotSha256: profile.rawSha256, objectKey: rawKey,
      canonicalTextSha256: profile.textSha256, textArtifactKey: textKey, contentType: 'text/html', checkedAt: metadata.checkedAt },
    officialEvidence,
    origin: { firstImportCommit: profile.origin.firstImportCommit, programsGitBlob: profile.origin.programsGitBlob,
      originalFile: profile.origin.originalFile, candidateId: profile.origin.candidateId,
      pack: { artifactKey: `TEST_ONLY/${key}/pack`, sha256: profile.origin.packSha256 },
      candidate: { artifactKey: `TEST_ONLY/${key}/candidate`, sha256: profile.origin.candidateSha256 },
      firstRecord: { artifactKey: `TEST_ONLY/${key}/firstRecord`, sha256: profile.origin.firstRecordSha256 },
      interpretation: 'exact_record_degree_metadata_only_not_author_intent' },
    currentIdentityAudit: htmlAliasSchoolAudit(context, profile.universityId),
    sameUrlNeighbours: profile.sameUrlNeighbours.map(neighbour => {
      const evidenceIndex = officialEvidence.length
      officialEvidence.push(evidence('neighbour', neighbour.quote))
      return { recordId: neighbour.recordId, identitySha256: neighbour.identitySha256, distinctLiteral: neighbour.distinctLiteral, evidenceIndex }
    }), rootApproval: { artifactKey: `TEST_ONLY/${key}/root-approval`, sha256: '0'.repeat(64) } }
  const seal = () => {
    const approval = encode({ format: 'studyinchina.reviewed-html-alias-root-approval', formatVersion: 1, ruleVersion: HTML_PROGRAM_ALIAS_RULE,
      decision: 'approved_identity_alias_only', reviewerId: 'codex-root', reviewedAt: proof.reviewedAt, subjectSha256: htmlAliasApprovalSubjectSha256(proof) })
    artifacts.set(proof.rootApproval.artifactKey, approval); proof.rootApproval.sha256 = sha(approval)
    const bytes = encode(proof), ref = { artifactKey: `TEST_ONLY/${key}/proof`, sha256: sha(bytes) }
    artifacts.set(ref.artifactKey, bytes)
    return ref
  }
  const reader = async (key: string) => { const value = artifacts.get(key); if (!value) throw Error('artifact missing: ' + key); return value }
  const ref = seal()
  const resolve = async (reference = ref) => {
    const loaded = await loadReviewedProgramAliases([reference], [proposal], reader)
    return resolveReviewedProgramAlias(loaded[0], proposal, programIdentityFieldsSchema.parse(proposal.fields), context.programs, now, reader, context)
  }
  return { profile, record, context, proof, proposal, artifacts, seal, reader, resolve, ref }
}

describe('exact two-school HTML correspondence, no suffix generalization', () => {
  for (const index of [0, 1]) it(`accepts fixed school ${index + 1} with raw identity/source/origin preserved`, async () => {
    const f = await fixture(index), before = JSON.stringify({ bundle, bindings, proposal: f.proposal })
    const resolved = (await f.resolve())!
    expect(resolved.record.id).toBe(f.profile.recordId)
    const acceptance: IdentityAcceptance = { entityType: 'program', recordId: f.record.id, identitySha256: identityFingerprint('program', f.record),
      sourceIds: f.record.sourceIds, acceptedAt: now, reviewer: 'TEST_ONLY', receiptPath: 'TEST_ONLY.json', receiptSha256: 'a'.repeat(64),
      verifiedName: f.proof.verifiedName, verifiedNameAlias: resolved.audit }
    expect(verifiedNameMatchesRecord(acceptance, f.record)).toBe(true)
    const projected = selectDiscoveryData(bundle, today, [acceptance]).programs.find(item => item.id === f.record.id)!
    expect(projected.name).toEqual(f.proof.verifiedName)
    expect(projected.languageRequirements).toEqual([])
    expect(projected.applyUrl).toBeNull()
    expect(projected.name.ru).toBeUndefined()
    if (index === 1) expect(projected.name.en).toBeUndefined()
    expect(JSON.stringify({ bundle, bindings, proposal: f.proposal })).toBe(before)
  })
  it('formal importer applies both in one batch using initial context and receipt-bound names, preserving original IDs/facts', async () => {
    const fs = await Promise.all([fixture(0), fixture(1)]), scope = await buildMaintenanceScope(bundle, { scopeId: 'TEST_ONLY-HTML-ALIASES', createdAt: now })
    const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'TEST_ONLY-2-ALIASES',
      inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: now, proposals: fs.map(f => f.proposal) }
    const batch = { ...content, sha256: await exportContentSha256(content) }
    const reader = async (key: string) => { for (const f of fs) if (f.artifacts.has(key)) return f.reader(key); throw Error('unexpected artifact: ' + key) }
    const result = await importIdentityCandidates({ bundle, scope, batch, acceptedAt: now, receiptPath: 'TEST_ONLY-receipt.json', bindings,
      readArtifact: reader, reviewedProgramAliases: fs.map(f => f.ref) })
    expect(result.receipt.held).toEqual([])
    expect(result.receipt.accepted).toHaveLength(2)
    expect(result.bundle.programs).toEqual(bundle.programs)
    expect(result.bundle.admissionCycles).toEqual(bundle.admissionCycles)
    expect(result.bundle.scholarships).toEqual(bundle.scholarships)
    for (const f of fs) {
      const accepted = result.acceptances.entries.find(entry => entry.recordId === f.record.id)!
      expect(scopedNameReceiptMatches(accepted, result.receipt)).toBe(true)
      expect(verifiedNameMatchesRecord(accepted, f.record)).toBe(true)
      expect(scopedNameReceiptMatches({ ...accepted, verifiedName: { zh: '伪造专业' } }, result.receipt)).toBe(false)
      const changed = structuredClone(accepted); changed.verifiedNameAlias!.source.snapshotSha256 = 'a'.repeat(64)
      expect(scopedNameReceiptMatches(changed, result.receipt)).toBe(false)
      expect(verifiedNameMatchesRecord(changed, f.record)).toBe(false)
    }
  })
  for (const [label, mutate, reason] of [
    ['different ID', (f: Awaited<ReturnType<typeof fixture>>) => { f.proof.recordId = 'unreviewed-record' }, 'context_mismatch'],
    ['wrong degree', (f: Awaited<ReturnType<typeof fixture>>) => { f.proposal.fields.degreeLevel = 'doctorate' }, 'identity_binding_mismatch'],
    ['old raw metadata changed', (f: Awaited<ReturnType<typeof fixture>>) => { f.context.programs.find(p => p.id === f.record.id)!.name.zh += '（方向）' }, 'context_mismatch'],
    ['wrong URL', (f: Awaited<ReturnType<typeof fixture>>) => { f.proposal.source.url += '?different' }, 'identity_binding_mismatch'],
    ['wrong UTF16', (f: Awaited<ReturnType<typeof fixture>>) => { f.proof.officialEvidence[0].utf16Range.start++ }, 'quote_binding_mismatch'],
    ['missing owner', (f: Awaited<ReturnType<typeof fixture>>) => { f.proof.officialEvidence = f.proof.officialEvidence.filter(e => e.field !== 'institution') }, 'literal_scope_unproven'],
    ['origin different commit', (f: Awaited<ReturnType<typeof fixture>>) => { f.proof.origin.firstImportCommit = 'f'.repeat(40) }, 'origin_metadata_mismatch'],
    ['origin candidate changed', (f: Awaited<ReturnType<typeof fixture>>) => { f.artifacts.set(f.proof.origin.candidate.artifactKey, encode({ tampered: true })) }, 'artifact_checksum_mismatch'],
    ['text tampered', (f: Awaited<ReturnType<typeof fixture>>) => { f.artifacts.set(f.proof.source.textArtifactKey, encode('changed source')) }, 'artifact_checksum_mismatch'],
    ['raw tampered', (f: Awaited<ReturnType<typeof fixture>>) => { f.artifacts.set(f.proposal.source.objectKey, encode('changed source')) }, 'artifact_checksum_mismatch'],
    ['code binding introduced', (f: Awaited<ReturnType<typeof fixture>>) => { f.context.bindings.entries.push({ recordId: f.record.id, canonicalKey: `${f.record.universityId}|master|degree|code:125400`, aliases: [] }); f.proof.currentIdentityAudit = htmlAliasSchoolAudit(f.context, f.profile.universityId) }, 'identity_binding_mismatch'],
  ] as const) it(`rejects ${label} even with a rehashed TEST_ONLY approval`, async () => {
    const f = await fixture(); mutate(f)
    await expect(f.resolve(f.seal())).rejects.toThrow(reason)
  })
  it('rejects missing root approval, mismatched sealed subject, unknown rule and mismatched proof hash', async () => {
    const f = await fixture(); f.artifacts.delete(f.proof.rootApproval.artifactKey)
    await expect(f.resolve()).rejects.toThrow('artifact missing')
    const g = await fixture(); g.proof.officialEvidence.reverse()
    const bytes = encode(g.proof); g.artifacts.set(g.ref.artifactKey, bytes)
    await expect(g.resolve({ ...g.ref, sha256: sha(bytes) })).rejects.toThrow('root_approval_subject_mismatch')
    await expect(g.resolve({ ...g.ref, sha256: 'a'.repeat(64) })).rejects.toThrow('artifact_checksum_mismatch')
    const other = JSON.parse(new TextDecoder().decode(bytes)); other.ruleVersion = 'generic-suffix-strip'
    const changed = encode(other); g.artifacts.set(g.ref.artifactKey, changed)
    await expect(g.resolve({ ...g.ref, sha256: sha(changed) })).rejects.toThrow()
  })
  it('rejects unaudited SHZU English, omitted neighbour, changed neighbour and a new same-name record', async () => {
    const f = await fixture(1); f.proof.verifiedName = { zh: '能源动力', en: 'Energy and Power' }; f.proposal.fields.name = f.proof.verifiedName
    f.proof.proposalContentSha256 = await proposalContentSha256(f.proposal)
    await expect(f.resolve(f.seal())).rejects.toThrow('identity_binding_mismatch')
    const g = await fixture(1); g.proof.sameUrlNeighbours = []
    await expect(g.resolve(g.seal())).rejects.toThrow('neighbour_mismatch')
    const h = await fixture(1); h.context.programs.find(p => p.id.includes('shzu-energy-storage'))!.name.zh = '能源动力'
    h.proof.currentIdentityAudit = htmlAliasSchoolAudit(h.context, h.profile.universityId)
    await expect(h.resolve(h.seal())).rejects.toThrow('neighbour_mismatch')
    const j = await fixture(); j.context.programs.push({ ...j.record, id: 'another-id', programUrl: 'https://sie.gznu.edu.cn/another.htm', name: { en: 'Tourism-Management' } })
    j.proof.currentIdentityAudit = htmlAliasSchoolAudit(j.context, j.profile.universityId)
    await expect(j.resolve(j.seal())).rejects.toThrow('identity_or_code_conflict')
  })
})

describe('unchanged SUEP v1 contract with frozen actual source artifacts', () => {
  it('resolves original SUEP proof and rejects changed quotes/raw/duplicate identity exactly as before', async () => {
    const proofBytes = readFileSync(join(fixtureRoot, 'suep-proof.json')), proof = JSON.parse(proofBytes.toString('utf8'))
    const proposal = maintenanceProposalSchema.parse(JSON.parse(readFileSync(join(fixtureRoot, 'suep-proposal.json'), 'utf8')))
    const record = bundle.programs.find(record => record.id === proof.recordId)!
    const artifacts = new Map<string, Uint8Array>([['SUEP-proof', proofBytes], [proof.source.objectKey, readFileSync(join(fixtureRoot, 'suep-raw.pdf'))], [proof.source.textArtifactKey, readFileSync(join(fixtureRoot, 'suep-text.txt'))]])
    const reader = async (key: string) => artifacts.get(key)!
    const ref = { artifactKey: 'SUEP-proof', sha256: sha(proofBytes) }
    const loaded = (await loadReviewedProgramAliases([ref], [proposal], reader))[0]
    const resolved = await resolveReviewedProgramAlias(loaded, proposal, programIdentityFieldsSchema.parse(proposal.fields), [record], now, reader)
    expect(resolved!.audit.ruleVersion).toBe('suep-explicit-metadata-suffix-v1')
    await expect(resolveReviewedProgramAlias(loaded, proposal, programIdentityFieldsSchema.parse(proposal.fields), [record, { ...record, id: 'duplicate' }], now, reader)).rejects.toThrow('ambiguous')
    artifacts.set(proof.source.objectKey, encode('tampered'))
    await expect(resolveReviewedProgramAlias(loaded, proposal, programIdentityFieldsSchema.parse(proposal.fields), [record], now, reader)).rejects.toThrow('source_checksum_mismatch')
  })
})
