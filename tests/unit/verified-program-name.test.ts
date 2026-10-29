import { createHash, webcrypto } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityAcceptanceSchema, identityFingerprint, canonicalIdentityJson, scopedNameReceiptMatches, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectPublishedData } from '@/lib/data/publication'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { JsonCatalogRepository } from '@/lib/catalog/json'
import * as store from '@/lib/data/identity-acceptance-store'
import { directoryRevision } from '@/lib/catalog/directory-revision'
import { localize } from '@/lib/data/format'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { isIndexableProgram } from '@/lib/seo/indexability'
import { buildMaintenanceScope, catalogSha256 } from '../../scripts/maintenance/build-scope'
import { importIdentityCandidates } from '../../scripts/maintenance/import-identities'
import { exportContentSha256, proposalContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import type { DataBundle } from '@/lib/data/types'
import { bundleSchema } from '@/lib/data/schema'
import { observePublishedCatalog } from '@/lib/notifications/catalog'
import { selectPublicMiniMaxLabels } from '@/lib/verification/publication'
import { minimaxRecordFingerprint } from '@/lib/verification/record-fingerprint'
import type { MiniMaxPublicSnapshot } from '@/lib/verification/minimax-contract'

const today = '2026-10-29', now = '2026-10-29T01:00:00.000Z', sentinel = 'UNVERIFIED_RU_SENTINEL'
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex')
vi.stubGlobal('crypto', webcrypto)
afterEach(() => vi.restoreAllMocks())
function fixture(fresh = false): DataBundle {
  const audit = { sourceIds: ['official'], verifiedAt: '2026-10-20', reviewAfter: '2027-01-01', status: 'verified' as const }
  return bundleSchema.parse({ sources: [{ id: 'official', url: 'https://example.edu/program', title: 'Official programme', publisher: 'Fixture University', official: true, kind: 'program', language: 'en', accessedAt: '2026-10-20' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: Array.from({ length: 272 }, (_, index) => ({ ...audit, id: 'school-' + index, slug: 'school-' + index, name: { en: 'Fixture School ' + index }, cityId: 'city', region: null, officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false })),
    programs: [{ ...audit, reviewAfter: fresh ? '2026-11-10' : '2026-10-22', status: fresh ? 'verified' : 'stale', verificationScope: 'facts',
      id: 'program', slug: 'stable-program', name: { en: 'Literal Computing', zh: '字面计算', ru: sentinel }, universityId: 'school-0', degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24,
      programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/apply', languageRequirements: [{ test: 'IELTS', minimum: 'OLD_DYNAMIC_SENTINEL' }] }],
    admissionCycles: [{ ...audit, reviewAfter: '2026-11-10', id: 'cycle', programId: 'program', academicYear: '2026-2027', intake: 'autumn', opensOn: '2026-10-01', closesOn: '2026-12-31', dateStatus: 'published', tuitionCny: 88888, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', evidenceBasis: 'cycle-specific', applicationFeeCny: 100 }], scholarships: [] })
}
function entry(bundle: DataBundle): IdentityAcceptance {
  return { entityType: 'program', recordId: 'program', identitySha256: identityFingerprint('program', bundle.programs[0]), sourceIds: ['official'],
    acceptedAt: now, reviewer: 'deterministic:synthetic-unit-rule', receiptPath: 'receipt.json', receiptSha256: 'a'.repeat(64), verifiedName: { en: 'Literal Computing' } }
}

describe('scoped official names across directory and current applicant paths', () => {
  for (const fresh of [false, true]) it(`masks raw Russian in ${fresh ? 'current' : 'stale'} records without mutating raw data`, () => {
    const raw = fixture(fresh), before = JSON.stringify(raw), accepted = entry(raw)
    const directory = selectDiscoveryData(raw, today, [accepted])
    expect(directory.programs[0].name).toEqual({ en: 'Literal Computing' })
    expect(JSON.stringify(directory)).not.toContain(sentinel)
    expect(directory.programs[0].id).toBe(raw.programs[0].id)
    expect(directory.programs[0].slug).toBe(raw.programs[0].slug)
    if (!fresh) {
      expect(directory.programs[0].languageRequirements).toEqual([])
      expect(directory.programs[0].applyUrl).toBeNull()
      expect(isIndexableProgram(directory.programs[0], directory.admissionCycles, today)).toBe(false)
    }
    const current = selectCatalogApiData(raw, today, [accepted])
    expect(JSON.stringify(current)).not.toContain(sentinel)
    expect(current.programs).toHaveLength(fresh ? 1 : 0)
    const service = new CatalogApiService(current, releaseFromBundle(current, today), today)
    expect(JSON.stringify(service.comparePrograms(['program']))).not.toContain(sentinel)
    expect(service.listPrograms({ q: sentinel }).data).toHaveLength(0)
    const directoryService = new CatalogApiService(directory, releaseFromBundle(directory, today), today)
    expect(directoryService.listPrograms({ q: sentinel, view: 'directory' }).data).toHaveLength(0)
    const renderedName = localize(directory.programs[0].name, 'ru')
    expect(renderedName).toBe('Literal Computing')
    expect(serializeJsonLd({ name: renderedName })).not.toContain(sentinel)
    expect(JSON.stringify(raw)).toBe(before)
    expect(accepted.identitySha256).toBe(identityFingerprint('program', raw.programs[0]))
  })
  it('covers the real JSON repository current list, compare and favourites data path', async () => {
    const raw = fixture(true), accepted = entry(raw)
    vi.spyOn(store, 'readIdentityAcceptances').mockReturnValue([accepted])
    const repo = new JsonCatalogRepository(async () => raw)
    expect(JSON.stringify(await repo.listPrograms({ today }))).not.toContain(sentinel)
    expect(JSON.stringify(await repo.listPrograms({ today, view: 'directory' }))).not.toContain(sentinel)
    expect(JSON.stringify(await repo.comparePrograms(['program']))).not.toContain(sentinel)
  })
  it('rejects empty, wrong-locale, wrong-value and malformed name restrictions, including current records', () => {
    const raw = fixture(true), accepted = entry(raw)
    expect(identityAcceptanceSchema.safeParse({ ...accepted, verifiedName: {} }).success).toBe(false)
    expect(identityAcceptanceSchema.safeParse({ ...accepted, verifiedName: { ru: sentinel } }).success).toBe(false)
    expect(identityAcceptanceSchema.safeParse({ ...accepted, entityType: 'university' }).success).toBe(false)
    for (const verifiedName of [{ zh: 'Literal Computing' }, { en: 'Not the raw name' }, {}]) {
      const invalid = { ...accepted, verifiedName }
      expect(selectDiscoveryData(raw, today, [invalid]).programs).toEqual([])
      expect(selectPublishedData(raw, today, [invalid]).programs).toEqual([])
    }
  })
  it('preserves old ledgers without a name scope and changes revision when scope changes', () => {
    const raw = fixture(true), accepted = entry(raw), legacy = { ...accepted }
    delete legacy.verifiedName
    expect(selectDiscoveryData(raw, today, [legacy]).programs[0].name.ru).toBe(sentinel)
    expect(directoryRevision(raw, today, [accepted], [])).not.toBe(directoryRevision(raw, today, [legacy], []))
  })
  it('notification titles use the scoped name instead of an old unsupported English sibling', () => {
    const raw = fixture(true), accepted = entry(raw)
    raw.programs[0].name.en = 'UNVERIFIED_EN_SENTINEL'
    accepted.identitySha256 = identityFingerprint('program', raw.programs[0]); accepted.verifiedName = { zh: '字面计算' }
    const observed = observePublishedCatalog(raw, Date.parse(now), [accepted])
    expect(observed['program:program'].title).toContain('字面计算')
    expect(JSON.stringify(observed)).not.toContain('UNVERIFIED_EN_SENTINEL')
  })
  it('does not retain a whole raw-record MiniMax badge after the shown official name scope changes', () => {
    const raw = fixture(true), accepted = entry(raw)
    const snapshot: MiniMaxPublicSnapshot = { schemaVersion: 1, generatedAt: now, methodology: 'machine-comparison',
      summary: { attemptedRecords: 1, checkedRecords: 1, partialRecords: 0, differenceRecords: 0, unconfirmedRecords: 0, supportedFields: 1, totalFields: 1 },
      records: { 'programs:program': { taskId: 'programs:program', collection: 'programs', recordId: 'program',
        recordSha256: minimaxRecordFingerprint(raw.programs[0] as unknown as Record<string, unknown>, raw.sources as unknown as Record<string, unknown>[]),
        runId: 'synthetic-unit-fixture', checkedAt: now, model: 'MiniMax-fixture', status: 'checked', totalFields: 1, supportedFields: 1,
        contradictedFields: 0, unconfirmedFields: 0, sourceIds: ['official'], identityMatched: true } } }
    expect(Object.keys(selectPublicMiniMaxLabels(snapshot, raw, today).records)).toHaveLength(1)
    expect(selectPublicMiniMaxLabels(snapshot, raw, today, [accepted]).records).toEqual({})
  })
  it('a future or mismatched scoped acceptance cannot use current freshness as a bypass', () => {
    const raw = fixture(true), accepted = entry(raw)
    for (const invalid of [{ ...accepted, acceptedAt: '2026-10-30T00:00:00.000Z' }, { ...accepted, identitySha256: 'c'.repeat(64) }]) {
      expect(selectDiscoveryData(raw, today, [invalid]).programs).toEqual([])
      expect(selectCatalogApiData(raw, today, [invalid]).programs).toEqual([])
    }
  })
  it('strict public ledger reads reject a tampered scope instead of restoring current raw names', () => {
    const raw = fixture(true), accepted = entry(raw)
    const content = { format: 'studyinchina.identity-import-receipt', formatVersion: 1,
      accepted: [{ recordId: 'program', verifiedName: accepted.verifiedName }] }
    const receipt = { ...content, sha256: sha(canonicalIdentityJson(content)) }; accepted.receiptSha256 = receipt.sha256
    expect(scopedNameReceiptMatches(accepted, receipt)).toBe(true)
    expect(scopedNameReceiptMatches({ ...accepted, verifiedName: { zh: '字面计算' } }, receipt)).toBe(false)
    const temp = mkdtempSync(join(process.cwd(), '.tmp-name-review-')), data = join(temp, 'content/data')
    mkdirSync(data, { recursive: true })
    const ledgerPath = join(data, 'identity-acceptances.json'), receiptPath = join(temp, 'receipt.json')
    try {
      writeFileSync(receiptPath, JSON.stringify(receipt))
      writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, entries: [accepted] }))
      expect(store.readIdentityAcceptances(data, { strictProjection: true })[0].verifiedName).toEqual({ en: 'Literal Computing' })
      writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, entries: [{ ...accepted, verifiedName: { zh: '字面计算' } }] }))
      expect(() => store.readIdentityAcceptances(data, { strictProjection: true })).toThrow('scoped_name_receipt_invalid')
      writeFileSync(ledgerPath, '{ malformed')
      expect(() => store.readIdentityAcceptances(data, { strictProjection: true })).toThrow()
    } finally {
      unlinkSync(ledgerPath); unlinkSync(receiptPath); rmdirSync(data); rmdirSync(join(temp, 'content')); rmdirSync(temp)
    }
  })
})

async function importerFixture() {
  const raw = fixture(false), scope = await buildMaintenanceScope(raw, { scopeId: 'synthetic-name-test', createdAt: now })
  const text = 'Literal Computing 字面计算 Master degree programme. International students may apply.'
  const bytes = new TextEncoder().encode('<main><h1>Literal Computing 字面计算</h1><p>Master degree programme. International students may apply.</p></main>')
  const evidence = { sourceId: 'fixture-official', url: 'https://example.edu/program', snapshotSha256: sha(bytes), objectKey: 'fixture/source.html', locator: 'text:document', quote: text }
  const make = async (bundle: DataBundle, name: { en?: string; zh?: string }, batchId: string) => {
    const proposal: MaintenanceProposal = { id: 'fixture-proposal', universityId: 'school-0', entityType: 'program', recordId: 'program', operation: 'patch', status: 'ready', warnings: [],
      fields: { name, degreeLevel: 'master', programType: 'degree', programUrl: evidence.url, internationalAdmissionsEvidence: evidence },
      source: { id: evidence.sourceId, url: evidence.url, snapshotSha256: evidence.snapshotSha256, objectKey: evidence.objectKey, checkedAt: now, contentType: 'text/html', locator: evidence.locator, quote: text },
      fieldEvidence: [...Object.keys(name).map(locale => ({ ...evidence, fieldPath: 'name.' + locale })), { ...evidence, fieldPath: 'degreeLevel' }], scope: { year: null, intake: null }, extractionAttemptId: null }
    proposal.review = { decision: 'approved', method: 'deterministic', reviewerId: 'deterministic:synthetic-unit-rule-only', reviewedAt: now,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: evidence.snapshotSha256,
      checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
    const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId,
      inputCatalogSha256: await catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: now, proposals: [proposal] }
    return { ...content, sha256: await exportContentSha256(content) }
  }
  return { raw, scope, make, readArtifact: async () => bytes }
}
describe('official locale receipt generation on existing stable IDs', () => {
  it('keeps the raw record and audit/dynamic fields intact, binds actual official name into receipt', async () => {
    const f = await importerFixture(), before = JSON.stringify(f.raw.programs[0]), batch = await f.make(f.raw, { en: 'Literal Computing' }, 'name-first')
    const result = await importIdentityCandidates({ bundle: f.raw, scope: f.scope, batch, acceptedAt: now, receiptPath: 'receipt.json', readArtifact: f.readArtifact })
    expect(result.receipt.held).toEqual([])
    expect(result.receipt.accepted[0]).toMatchObject({ recordId: 'program', verifiedName: { en: 'Literal Computing' } })
    expect(result.acceptances.entries[0].verifiedName).toEqual({ en: 'Literal Computing' })
    expect(JSON.stringify(result.bundle.programs[0])).toBe(before)
    expect(scopedNameReceiptMatches(result.acceptances.entries[0], result.receipt)).toBe(true)
  })
  it('rejects cross-locale identity matching even if another raw locale equals the proposed text', async () => {
    const f = await importerFixture(), batch = await f.make(f.raw, { zh: 'Literal Computing' }, 'wrong-locale')
    const result = await importIdentityCandidates({ bundle: f.raw, scope: f.scope, batch, acceptedAt: now, receiptPath: 'receipt.json', readArtifact: f.readArtifact })
    expect(result.receipt.accepted).toEqual([])
    expect(result.receipt.held[0].reason).toBe('verified_name_locale_value_conflict')
  })
  it('a changed verified name scope creates a new receipt despite identical identity/source and raw catalogue hash', async () => {
    const f = await importerFixture(), firstBatch = await f.make(f.raw, { en: 'Literal Computing' }, 'scope-one')
    const first = await importIdentityCandidates({ bundle: f.raw, scope: f.scope, batch: firstBatch, acceptedAt: now, receiptPath: 'first.json', readArtifact: f.readArtifact })
    const nextBatch = await f.make(first.bundle, { en: 'Literal Computing', zh: '字面计算' }, 'scope-two')
    const next = await importIdentityCandidates({ bundle: first.bundle, scope: f.scope, batch: nextBatch, acceptedAt: now, receiptPath: 'next.json', readArtifact: f.readArtifact, acceptances: first.acceptances, bindings: first.bindings })
    expect(next.receipt.accepted).toHaveLength(1)
    expect(next.receipt.unchanged).toEqual([])
    expect(next.acceptances.entries[0].verifiedName).toEqual({ en: 'Literal Computing', zh: '字面计算' })
    expect(next.receipt.sha256).not.toBe(first.receipt.sha256)
    expect(next.receipt.inputCatalogSha256).toBe(next.receipt.outputCatalogSha256)
    const sameBatch = await f.make(next.bundle, { en: 'Literal Computing', zh: '字面计算' }, 'scope-identical')
    const same = await importIdentityCandidates({ bundle: next.bundle, scope: f.scope, batch: sameBatch, acceptedAt: now, receiptPath: 'same.json', readArtifact: f.readArtifact, acceptances: next.acceptances, bindings: next.bindings })
    expect(same.receipt.accepted).toEqual([]); expect(same.receipt.unchanged).toHaveLength(1)
  })
})
