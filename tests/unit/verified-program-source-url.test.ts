import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { identityAcceptanceSchema, identityFingerprint, canonicalIdentityJson, scopedNameReceiptMatches, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { projectVerifiedProgramName } from '@/lib/data/verified-program-name'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectPublishedData } from '@/lib/data/publication'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { JsonCatalogRepository } from '@/lib/catalog/json'
import { directoryRevision } from '@/lib/catalog/directory-revision'
import * as store from '@/lib/data/identity-acceptance-store'
import * as scopeModule from '../../scripts/maintenance/build-scope'
import { importIdentityCandidates, hasAcceptedIdentityWithOfficialUrl } from '../../scripts/maintenance/import-identities'
import { proposalContentSha256, exportContentSha256, type MaintenanceProposal } from '../../scripts/maintenance/contracts'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'

const today = '2026-10-29', now = '2026-10-29T01:00:00.000Z'
const oldUrl = 'https://example.edu/old-entry-404.pdf', verifiedUrl = 'https://example.edu/verified-official-catalogue.pdf'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
vi.stubGlobal('crypto', webcrypto)
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const inside = relative(process.cwd(), resolve(root))
    if (!inside.startsWith('.tmp-verified-source-') || inside.includes('..')) throw Error('unexpected_fixture_cleanup_path')
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture(fresh = false): DataBundle {
  const audit = { sourceIds: ['old-source', 'verified-source'], verifiedAt: '2026-10-20', reviewAfter: '2027-01-01', status: 'verified' }
  return bundleSchema.parse({
    sources: [{ id: 'old-source', url: oldUrl, official: true, kind: 'program', language: 'en', title: 'Historical entry', publisher: 'Fixture University', accessedAt: '2026-10-20' },
      { id: 'verified-source', url: verifiedUrl, official: true, kind: 'program', language: 'en', title: 'Verified catalogue', publisher: 'Fixture University', accessedAt: '2026-10-29' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: Array.from({ length: 272 }, (_, n) => ({ ...audit, id: 'school-' + n, slug: 'school-' + n, name: { en: 'Fixture School ' + n }, cityId: 'city', region: null, officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false })),
    programs: [{ ...audit, reviewAfter: fresh ? '2026-11-10' : '2026-10-21', status: fresh ? 'verified' : 'stale', verificationScope: 'facts',
      id: 'program', slug: 'stable-program', name: { en: 'Literal Computing', zh: '字面计算' }, universityId: 'school-0', degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'],
      durationMonths: 24, programUrl: oldUrl, applyUrl: 'https://example.edu/apply', languageRequirements: [{ test: 'IELTS', minimum: 'OLD_CONDITION' }] }],
    admissionCycles: [], scholarships: [],
  })
}
function acceptance(raw: DataBundle): IdentityAcceptance {
  return { entityType: 'program', recordId: 'program', identitySha256: identityFingerprint('program', raw.programs[0]), sourceIds: ['old-source', 'verified-source'],
    acceptedAt: now, reviewer: 'deterministic:synthetic-source-url-fixture', receiptPath: 'quality/receipt.json', receiptSha256: 'a'.repeat(64),
    verifiedName: { en: 'Literal Computing' }, verifiedSourceUrl: verifiedUrl }
}
function receipt(entry: IdentityAcceptance) {
  const content = { format: 'studyinchina.identity-import-receipt', formatVersion: 1,
    accepted: [{ recordId: entry.recordId, verifiedName: entry.verifiedName, verifiedNameAlias: entry.verifiedNameAlias, verifiedSourceUrl: entry.verifiedSourceUrl }] }
  const result = { ...content, sha256: sha(canonicalIdentityJson(content)) }
  entry.receiptSha256 = result.sha256
  return result
}
function temp() {
  const root = mkdtempSync(join(process.cwd(), '.tmp-verified-source-')); roots.push(root)
  for (const dir of ['content/data', 'content/maintenance', 'quality']) mkdirSync(join(root, dir), { recursive: true })
  return root
}

describe('receipt-bound verified programme document URL', () => {
  it.each([false, true])('replaces the main official entry for stale/current=%s, preserves raw identity and facts', fresh => {
    const raw = fixture(fresh), before = structuredClone(raw), entry = acceptance(raw)
    const directory = selectDiscoveryData(raw, today, [entry])
    expect(directory.programs[0].programUrl).toBe(verifiedUrl)
    expect(directory.programs[0].id).toBe('program'); expect(directory.programs[0].slug).toBe('stable-program')
    expect(directory.programs[0].verifiedAt).toBe(raw.programs[0].verifiedAt)
    expect(directory.programs[0].reviewAfter).toBe(raw.programs[0].reviewAfter)
    const current = selectCatalogApiData(raw, today, [entry])
    expect(current.programs).toHaveLength(fresh ? 1 : 0)
    if (fresh) expect(current.programs[0].programUrl).toBe(verifiedUrl)
    else { expect(directory.programs[0].applyUrl).toBeNull(); expect(directory.programs[0].languageRequirements).toEqual([]) }
    const api = new CatalogApiService(directory, releaseFromBundle(directory, today), today)
    expect(api.listPrograms({ view: 'directory' }).data[0].programUrl).toBe(verifiedUrl)
    expect(raw).toEqual(before); expect(raw.programs[0].programUrl).toBe(oldUrl)
  })
  it('uses the same URL in actual JSON directory, current, compare and saved-record queries', async () => {
    const raw = fixture(true), entry = acceptance(raw)
    vi.spyOn(store, 'readIdentityAcceptances').mockReturnValue([entry])
    const repository = new JsonCatalogRepository(async () => raw)
    for (const query of [{ today }, { today, view: 'directory' as const }]) {
      const page = await repository.listPrograms(query)
      expect(JSON.stringify(page)).toContain(verifiedUrl)
    }
    const compared = JSON.stringify(await repository.comparePrograms(['program']))
    expect(compared).toContain(verifiedUrl)
    expect(selectPublishedData(raw, today, [entry]).programs.find(p => p.id === 'program')?.programUrl).toBe(verifiedUrl)
  })
  it.each(['http://example.edu/a', 'javascript:alert(1)', 'https://user:pass@example.edu/a', 'https://example.edu:444/a'])('rejects unsafe scoped URL %s', verifiedSourceUrl => {
    expect(identityAcceptanceSchema.safeParse({ ...acceptance(fixture()), verifiedSourceUrl }).success).toBe(false)
  })
  it('requires programme name scope and rejects malformed explicit URL scope even for current programmes', () => {
    const raw = fixture(true), entry = acceptance(raw), orphan = { ...entry }; delete orphan.verifiedName
    expect(identityAcceptanceSchema.safeParse(orphan).success).toBe(false)
    expect(identityAcceptanceSchema.safeParse({ ...entry, entityType: 'university' }).success).toBe(false)
    expect(projectVerifiedProgramName(raw.programs[0], raw.sources, [orphan], today)).toBeUndefined()
  })
  it.each(['not-in-entry', 'not-in-record', 'unofficial', 'different-url'])('fails closed when URL/source association is %s', kind => {
    const raw = fixture(true), entry = acceptance(raw)
    if (kind === 'not-in-entry') entry.sourceIds = ['old-source']
    if (kind === 'not-in-record') raw.programs[0].sourceIds = ['old-source']
    if (kind === 'unofficial') raw.sources[1].official = false
    if (kind === 'different-url') entry.verifiedSourceUrl = 'https://example.edu/other.pdf'
    entry.identitySha256 = identityFingerprint('program', raw.programs[0])
    expect(selectDiscoveryData(raw, today, [entry]).programs).toEqual([])
    expect(selectPublishedData(raw, today, [entry]).programs).toEqual([])
  })
  it('keeps legacy ledgers compatible and binds URL changes to the directory revision', () => {
    const raw = fixture(), entry = acceptance(raw), legacy = { ...entry }; delete legacy.verifiedSourceUrl
    expect(identityAcceptanceSchema.safeParse(legacy).success).toBe(true)
    expect(selectDiscoveryData(raw, today, [legacy]).programs[0].programUrl).toBe(oldUrl)
    expect(directoryRevision(raw, today, [entry], [])).not.toBe(directoryRevision(raw, today, [legacy], []))
  })
  it('immutable receipt rejects URL mutation or omission and strict public ledger loading throws', () => {
    const raw = fixture(), entry = acceptance(raw), proof = receipt(entry), root = temp(), data = join(root, 'content/data')
    writeFileSync(join(root, 'quality/receipt.json'), JSON.stringify(proof))
    expect(scopedNameReceiptMatches(entry, proof)).toBe(true)
    const missing = { ...entry }; delete missing.verifiedSourceUrl
    const bothMissing = { ...missing }; delete bothMissing.verifiedName
    for (const changed of [missing, bothMissing, { ...entry, verifiedSourceUrl: oldUrl }]) {
      expect(scopedNameReceiptMatches(changed, proof)).toBe(false)
      writeFileSync(join(data, 'identity-acceptances.json'), JSON.stringify({ schemaVersion: 1, entries: [changed] }))
      expect(() => store.readIdentityAcceptances(data, { strictProjection: true })).toThrow('scoped_name_receipt_invalid')
    }
    writeFileSync(join(data, 'identity-acceptances.json'), JSON.stringify({ schemaVersion: 1, entries: [bothMissing] }))
    writeFileSync(join(root, 'quality/receipt.json'), JSON.stringify({ ...proof, accepted: [{ recordId: entry.recordId }] }))
    expect(() => store.readIdentityAcceptances(data, { strictProjection: true })).toThrow('scoped_name_receipt_invalid')
  })
  it('keeps an old unscoped ledger without a deployed receipt compatible', () => {
    const raw = fixture(), legacy = acceptance(raw), root = temp(), data = join(root, 'content/data')
    delete legacy.verifiedSourceUrl; delete legacy.verifiedName
    writeFileSync(join(data, 'identity-acceptances.json'), JSON.stringify({ schemaVersion: 1, entries: [legacy] }))
    expect(store.readIdentityAcceptances(data, { strictProjection: true })).toEqual([legacy])
  })
  it('directory validation checks an official URL linked in both record and acceptance', async () => {
    const raw = fixture(), entry = acceptance(raw), root = temp(), proof = receipt(entry)
    const scope = await scopeModule.buildMaintenanceScope(raw, { scopeId: 'verified-source-url-synthetic', createdAt: now })
    vi.spyOn(scopeModule, 'loadMaintenanceBundle').mockReturnValue(raw)
    writeFileSync(join(root, 'content/maintenance/scope-272.v1.json'), JSON.stringify(scope))
    writeFileSync(join(root, 'quality/receipt.json'), JSON.stringify(proof))
    const ledger = join(root, 'content/data/identity-acceptances.json')
    writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, entries: [entry] }))
    await expect(validateDirectory(root, today)).resolves.toMatchObject({ integrityPassed: true })
    entry.sourceIds = ['old-source']
    writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, entries: [entry] }))
    await expect(validateDirectory(root, today)).rejects.toThrow('directory_scoped_source_url_binding_invalid')
    delete entry.verifiedName; delete entry.verifiedSourceUrl
    writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, entries: [entry] }))
    await expect(validateDirectory(root, today)).rejects.toThrow('directory_scoped_name_binding_invalid')
  })
})

async function importFixture() {
  const raw = fixture(), scope = await scopeModule.buildMaintenanceScope(raw, { scopeId: 'verified-source-import-synthetic', createdAt: now })
  const text = 'Literal Computing Master degree. International students may apply.', bytes = new TextEncoder().encode('<main>' + text + '</main>')
  const make = async (bundle: DataBundle, url = verifiedUrl, batchId = 'source-first') => {
    const evidence = { sourceId: 'synthetic-official', url, snapshotSha256: sha(bytes), objectKey: 'source.html', locator: 'text:document', quote: text }
    const proposal: MaintenanceProposal = { id: 'source-proposal', universityId: 'school-0', entityType: 'program', recordId: 'program', operation: 'patch', status: 'ready', warnings: [],
      fields: { name: { en: 'Literal Computing' }, degreeLevel: 'master', programType: 'degree', programUrl: oldUrl, internationalAdmissionsEvidence: evidence },
      source: { id: evidence.sourceId, url, snapshotSha256: evidence.snapshotSha256, objectKey: evidence.objectKey, checkedAt: now, contentType: 'text/html', locator: evidence.locator, quote: text },
      fieldEvidence: ['name.en', 'degreeLevel'].map(fieldPath => ({ ...evidence, fieldPath })), scope: { year: null, intake: null }, extractionAttemptId: null }
    proposal.review = { decision: 'approved', method: 'deterministic', reviewerId: 'deterministic:synthetic-source-fixture', reviewedAt: now,
      candidateSha256: await proposalContentSha256(proposal), snapshotSha256: evidence.snapshotSha256, checks: { internationalScope: true, concreteProgram: true, evidenceLocated: true } }
    const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId,
      inputCatalogSha256: await scopeModule.catalogSha256(bundle), scopeRegistrySha256: scope.sha256, createdAt: now, proposals: [proposal] }
    return { ...content, sha256: await exportContentSha256(content) }
  }
  return { raw, scope, make, readArtifact: async () => bytes }
}
describe('verified source URL import scope and no-op binding', () => {
  it('uses proposal.source.url, preserves raw programUrl, and emits the same URL in acceptance and receipt', async () => {
    const f = await importFixture(), before = structuredClone(f.raw), batch = await f.make(f.raw)
    const result = await importIdentityCandidates({ ...f, bundle: f.raw, batch, acceptedAt: now, receiptPath: 'quality/receipt.json' })
    expect(result.receipt.held).toEqual([])
    expect(result.receipt.accepted[0].verifiedSourceUrl).toBe(verifiedUrl)
    expect(result.acceptances.entries[0].verifiedSourceUrl).toBe(verifiedUrl)
    expect(scopedNameReceiptMatches(result.acceptances.entries[0], result.receipt)).toBe(true)
    expect(result.bundle.programs[0]).toEqual(before.programs[0]); expect(f.raw).toEqual(before)
  })
  it('adding a URL to a legacy name receipt is accepted once; identical URL then becomes a no-op', async () => {
    const f = await importFixture(), legacy = acceptance(f.raw); delete legacy.verifiedSourceUrl
    const ledger = { schemaVersion: 1 as const, entries: [legacy] }, batch = await f.make(f.raw)
    const first = await importIdentityCandidates({ ...f, bundle: f.raw, batch, acceptances: ledger, acceptedAt: now, receiptPath: 'quality/receipt.json' })
    expect(first.receipt.accepted).toHaveLength(1); expect(first.receipt.unchanged).toEqual([])
    const repeated = await importIdentityCandidates({ ...f, bundle: first.bundle, batch: await f.make(first.bundle, verifiedUrl, 'source-repeat'), acceptances: first.acceptances, bindings: first.bindings, acceptedAt: now, receiptPath: 'quality/repeat.json' })
    expect(repeated.receipt.accepted).toEqual([]); expect(repeated.receipt.unchanged).toHaveLength(1)
    expect(repeated.acceptances).toEqual(first.acceptances)
  })
  it('a changed verified document URL creates a new receipt even if the raw identity is unchanged', async () => {
    const f = await importFixture(), first = await importIdentityCandidates({ ...f, bundle: f.raw, batch: await f.make(f.raw), acceptedAt: now, receiptPath: 'quality/first.json' })
    const nextUrl = 'https://example.edu/next-verified-catalogue.pdf'
    const next = await importIdentityCandidates({ ...f, bundle: first.bundle, batch: await f.make(first.bundle, nextUrl, 'source-next'), acceptances: first.acceptances, bindings: first.bindings, acceptedAt: now, receiptPath: 'quality/next.json' })
    expect(next.receipt.accepted[0].verifiedSourceUrl).toBe(nextUrl); expect(next.receipt.unchanged).toEqual([])
    expect(next.acceptances.entries[0].verifiedSourceUrl).toBe(nextUrl)
    expect({ ...next.bundle.programs[0], sourceIds: f.raw.programs[0].sourceIds }).toEqual(f.raw.programs[0])
    expect(identityFingerprint('program', next.bundle.programs[0])).toBe(identityFingerprint('program', f.raw.programs[0]))
  })
  it('no-op source matching cannot borrow an official URL from outside the same acceptance', () => {
    const raw = fixture(), entry = acceptance(raw); entry.sourceIds = ['old-source']
    expect(hasAcceptedIdentityWithOfficialUrl(raw, { schemaVersion: 1, entries: [entry] }, 'program', raw.programs[0], verifiedUrl, now, entry.verifiedName, undefined, verifiedUrl)).toBe(false)
  })
})
