import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as catalog from '@/lib/catalog'
import { JsonCatalogRepository } from '@/lib/catalog/json'
import { directoryRevision } from '@/lib/catalog/directory-revision'
import { parseCatalogReleaseInfo } from '@/lib/catalog/release'
import * as identityStore from '@/lib/data/identity-acceptance-store'
import * as fieldStore from '@/lib/data/field-verification-store'
import { identityFingerprint, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { fieldRecordScopeSha256, fieldValueSha256, type FieldVerification } from '@/lib/data/field-verification'
import { selectPublishedData } from '@/lib/data/publication'
import { getCatalogApiService, getCatalogDirectoryService, resetCatalogApiRepositoryForTests } from '@/lib/catalog-api/runtime'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import type { DataBundle, Program } from '@/lib/data/types'

const today = '2026-10-24'
let bundle: DataBundle, programs: Program[]
beforeAll(() => {
  bundle = loadMaintenanceBundle(process.cwd())
  const universities = new Set(selectPublishedData(bundle, today).universities.map(record => record.id))
  programs = bundle.programs.filter(record => universities.has(record.universityId) && record.status !== 'draft' && record.status !== 'archived'
    && (record.status === 'stale' || record.reviewAfter < today) && record.teachingLanguages.includes('English')).slice(0, 3)
  expect(programs).toHaveLength(3)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetCatalogApiRepositoryForTests() })
function identities(records = programs.slice(0, 2)): IdentityAcceptance[] {
  return records.map(record => ({ entityType: 'program', recordId: record.id, identitySha256: identityFingerprint('program', record), sourceIds: record.sourceIds,
    acceptedAt: '2026-10-19T00:00:00.000Z', reviewer: 'fixture-reviewer', receiptPath: 'quality/fixture.json', receiptSha256: 'a'.repeat(64) }))
}
function field(record: Program): FieldVerification {
  const source = bundle.sources.find(source => record.sourceIds.includes(source.id) && source.official)!
  return { entityType: 'program', recordId: record.id, fieldPath: 'teachingLanguages', value: record.teachingLanguages,
    valueSha256: fieldValueSha256(record.teachingLanguages), recordScopeSha256: fieldRecordScopeSha256('program', record), factStatus: 'known',
    sourceId: source.id, sourceUrl: source.url, snapshotSha256: 'b'.repeat(64), objectKey: 'private/source.bin', locator: 'text:document', quote: 'official language evidence',
    verifiedAt: '2026-10-24T00:00:00.000Z', reviewAfter: '2026-10-27', review: { method: 'dual-model', reviewerId: 'fixture-reviewer' },
    receiptPath: 'private/field-receipt.json', receiptSha256: 'c'.repeat(64) }
}
function stores() {
  let accepted = identities(), verified: FieldVerification[] = []
  vi.spyOn(identityStore, 'readIdentityAcceptances').mockImplementation(() => accepted)
  vi.spyOn(fieldStore, 'readFieldVerifications').mockImplementation(() => verified)
  return { setIdentities: (value: IdentityAcceptance[]) => { accepted = value }, setFields: (value: FieldVerification[]) => { verified = value } }
}
function runtimeRepository() {
  resetCatalogApiRepositoryForTests()
  const repository = new JsonCatalogRepository(() => bundle)
  vi.spyOn(catalog, 'createCatalogRepository').mockReturnValue(repository)
  return repository
}

describe('directory cursor binding to review-ledger revisions', () => {
  it('changes only the opaque digest when a sidecar changes, without exposing evidence', () => {
    const accepted = identities(), proof = field(programs[0])
    const original = directoryRevision(bundle, today, accepted, [])
    expect(original).toMatch(/^[a-f0-9]{64}$/u)
    expect(directoryRevision(bundle, today, accepted, [])).toBe(original)
    expect(directoryRevision(bundle, today, identities(programs), [])).not.toBe(original)
    expect(directoryRevision(bundle, today, accepted, [proof])).not.toBe(original)
    expect(directoryRevision(bundle, '2026-10-25', accepted, [])).not.toBe(original)
  })

  it('rejects a JSON page cursor after identity acceptance changes without a raw catalogue change', async () => {
    const ledger = stores(), repository = new JsonCatalogRepository(() => bundle), before = JSON.stringify(bundle)
    const first = await repository.listPrograms({ view: 'directory', today, limit: 1 })
    expect(first.nextCursor).toBeTruthy()
    ledger.setIdentities(identities(programs))
    await expect(repository.listPrograms({ view: 'directory', today, limit: 1, cursor: first.nextCursor!,
      directoryRevision: first.release!.directoryRevision })).rejects.toMatchObject({ code: 'INVALID_LIST_CURSOR' })
    expect(JSON.stringify(bundle)).toBe(before)
  })

  it('rejects a JSON language-filter cursor when field-only review changes matching membership', async () => {
    const ledger = stores(), repository = new JsonCatalogRepository(() => bundle)
    ledger.setFields(programs.slice(0, 2).map(field))
    const first = await repository.listPrograms({ view: 'directory', today, language: 'English', limit: 1 })
    expect(first.total).toBeGreaterThanOrEqual(2)
    expect(first.nextCursor).toBeTruthy()
    ledger.setFields([field(programs[0])])
    const updated = await repository.listPrograms({ view: 'directory', today, language: 'English', limit: 1 })
    expect(updated.total).toBe(first.total! - 1)
    await expect(repository.listPrograms({ view: 'directory', today, language: 'English', limit: 1, cursor: first.nextCursor! }))
      .rejects.toMatchObject({ code: 'INVALID_LIST_CURSOR' })
  })

  it('binds directory API cursors server-side and refuses an old acceptance revision', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T04:00:00.000Z'))
    const ledger = stores(); runtimeRepository()
    const first = (await getCatalogDirectoryService()).listPrograms({ limit: 1 })
    expect(first.meta.nextCursor).toBeTruthy()
    expect(first.meta.release.directoryRevision).toMatch(/^[a-f0-9]{64}$/u)
    ledger.setIdentities(identities(programs))
    const second = await getCatalogDirectoryService()
    expect(() => second.listPrograms({ limit: 1, cursor: first.meta.nextCursor! })).toThrow('Invalid cursor')
    expect(JSON.stringify(first.meta.release)).not.toContain('receiptPath')
  })

  it('preserves current-only API cursors and counts when directory ledgers change', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T04:00:00.000Z'))
    const ledger = stores(); runtimeRepository()
    const first = (await getCatalogApiService()).listPrograms({ limit: 1 })
    expect(first.meta.nextCursor).toBeTruthy()
    ledger.setIdentities(identities(programs)); ledger.setFields([field(programs[0])])
    const second = (await getCatalogApiService()).listPrograms({ limit: 1, cursor: first.meta.nextCursor! })
    expect(second.data).toHaveLength(1)
    expect(second.meta.release.publicCounts).toEqual(first.meta.release.publicCounts)
  })

  it('validates and preserves optional revision metadata while accepting old releases', () => {
    const release = catalog.deriveCatalogRelease(bundle), revision = directoryRevision(bundle, today, identities(), [])
    expect(parseCatalogReleaseInfo({ ...release, directoryRevision: revision }).directoryRevision).toBe(revision)
    expect(parseCatalogReleaseInfo(release).directoryRevision).toBeUndefined()
    expect(() => parseCatalogReleaseInfo({ ...release, directoryRevision: 'private/receipt.json' })).toThrow('SHA-256')
  })
})
