import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonCatalogRepository } from '@/lib/catalog/json'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { canonicalIdentityJson, identityFingerprint, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { fieldRecordScopeSha256, fieldValueSha256, type FieldVerification } from '@/lib/data/field-verification'
import { getTodayDate } from '@/lib/data/freshness'
import { localize } from '@/lib/data/format'
import { bundleSchema } from '@/lib/data/schema'
import { getCatalogData, getData, resetCatalogRepositoryForTests } from '@/lib/data/load'
import { getCatalogApiService, resetCatalogApiRepositoryForTests } from '@/lib/catalog-api/runtime'
import type { DataBundle } from '@/lib/data/types'

const workspace = process.cwd(), roots: string[] = [], today = '2026-11-03'
const filenames = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' } as const

function replaceJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.next', JSON.stringify(value))
  renameSync(file + '.next', file)
}

function fixture() {
  mkdirSync(join(workspace, '.tmp'), { recursive: true })
  const root = mkdtempSync(join(workspace, '.tmp', 'public-snapshot-')); roots.push(root)
  const directory = join(root, 'content', 'data')
  const audit = { sourceIds: ['official'], verifiedAt: today, reviewAfter: today, status: 'verified' as const }
  const bundle: DataBundle = {
    sources: [{ id: 'official', url: 'https://fixture.edu/program', title: 'Official fixture', publisher: 'Fixture University', kind: 'program', language: 'en', official: true, accessedAt: today }],
    cities: [{ ...audit, reviewAfter: '2027-01-01', id: 'city', slug: 'city', name: { en: 'City', zh: '城市' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, reviewAfter: '2027-01-01', id: 'university', slug: 'university', name: { en: 'University', zh: '大学' }, cityId: 'city', region: null, officialUrl: 'https://fixture.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'university', name: { en: 'Computer Science', zh: '计算机科学' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24, programUrl: 'https://fixture.edu/program', applyUrl: 'https://fixture.edu/apply', languageRequirements: [{ test: 'IELTS', minimum: '6.5' }] }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2026-2027', intake: 'spring', opensOn: '2026-11-01', closesOn: today, dateStatus: 'published', tuitionCny: 12000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 400, evidenceBasis: 'cycle-specific', factScope: 'complete' }],
    scholarships: [{ ...audit, id: 'scholarship', slug: 'scholarship', name: { en: 'Scholarship', zh: '奖学金' }, providerType: 'university', universityIds: ['university'], programIds: ['program'], coverage: { tuition: 'full', accommodation: 'partial', insurance: true, stipendCnyPerMonth: 1000 }, deadline: today, applicationUrl: 'https://fixture.edu/award', summary: { en: 'Current facts' } }],
  }
  const identities: IdentityAcceptance[] = ([['program', bundle.programs[0]], ['scholarship', bundle.scholarships[0]]] as const).map(([entityType, record]) => ({
    entityType, recordId: record.id, identitySha256: identityFingerprint(entityType, record), sourceIds: ['official'], acceptedAt: `${today}T00:00:00.000Z`, reviewer: 'independent-fixture', receiptPath: 'quality/receipt.json', receiptSha256: 'a'.repeat(64), ...(entityType === 'program' ? { verifiedName: { en: 'Computer Science', zh: '计算机科学' } } : {}),
  }))
  const receiptFile = join(root, 'quality', 'receipt.json')
  const writeIdentities = () => {
    const receipt = { format: 'studyinchina.identity-import-receipt', formatVersion: 1, accepted: identities.map(entry => ({ recordId: entry.recordId, ...(entry.verifiedName ? { verifiedName: entry.verifiedName } : {}) })) }
    const sha256 = createHash('sha256').update(canonicalIdentityJson(receipt)).digest('hex')
    replaceJson(receiptFile, { ...receipt, sha256 })
    identities.forEach(entry => { entry.receiptSha256 = sha256 })
    replaceJson(join(directory, 'identity-acceptances.json'), { schemaVersion: 1, entries: identities })
  }
  const writeBundle = () => { for (const [key, name] of Object.entries(filenames)) replaceJson(join(directory, `${name}.json`), bundle[key as keyof DataBundle]) }
  writeBundle(); writeIdentities()
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  const repository = new JsonCatalogRepository()
  const snapshot = async (date = today) => getPublicCatalogSnapshot(await repository.getBundle(), date)
  return { root, directory, bundle, identities, receiptFile, writeBundle, writeIdentities, repository, snapshot }
}

function durationField(bundle: DataBundle, reviewAfter = today): FieldVerification {
  const program = bundle.programs[0]
  return { entityType: 'program', recordId: program.id, recordScopeSha256: fieldRecordScopeSha256('program', program), fieldPath: 'durationMonths', value: program.durationMonths, valueSha256: fieldValueSha256(program.durationMonths), factStatus: 'known', sourceId: 'official', sourceUrl: bundle.sources[0].url, snapshotSha256: 'b'.repeat(64), objectKey: 'private/evidence', locator: 'text:duration', quote: 'Two years', verifiedAt: `${today}T00:00:00.000Z`, reviewAfter, review: { method: 'independent', reviewerId: 'fixture' }, receiptPath: 'private/field-receipt.json', receiptSha256: 'c'.repeat(64) }
}

afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs()
  resetCatalogRepositoryForTests(); resetCatalogApiRepositoryForTests()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('public snapshot correctness across independent requests', () => {
  it('isolates warm raw preview access, production public snapshots and unauthenticated admin responses', async () => {
    const f = fixture()
    f.bundle.programs.push({ ...f.bundle.programs[0], id: 'draft-program', slug: 'draft-program', status: 'draft', name: { en: 'DRAFT_PRIVATE_NAME' } })
    f.identities[0].verifiedName = { zh: '计算机科学' }; f.writeBundle(); f.writeIdentities()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${today}T04:00:00.000Z`))
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('CONTENT_PREVIEW', 'true'); vi.stubEnv('CATALOG_BACKEND', 'json')
    vi.stubEnv('VERCEL_ENV', 'preview')
    resetCatalogRepositoryForTests(); resetCatalogApiRepositoryForTests()
    const raw = getData()
    expect(await getCatalogData()).toBe(raw)
    expect(raw.programs.map(p => p.id)).toEqual(['program', 'draft-program'])
    expect(raw.programs[0].name.en).toBe('Computer Science')

    // CONTENT_PREVIEW stays true: the production trust boundary must override it.
    vi.stubEnv('VERCEL_ENV', 'production')
    const current = getData(), directory = await getCatalogData()
    for (const data of [current, directory]) {
      expect(data.programs.map(p => p.id)).toEqual(['program'])
      expect(data.programs[0].name).toEqual({ zh: '计算机科学' })
      expect(JSON.stringify(data)).not.toContain('DRAFT_PRIVATE_NAME')
      expect(JSON.stringify(data)).not.toContain('Computer Science')
    }
    const publicBefore = (await getCatalogApiService()).listPrograms()
    vi.stubEnv('ADMIN_ACCESS_TOKEN', 'synthetic-private-admin-password-'.repeat(2))
    vi.stubEnv('ADMIN_SESSION_SECRET', 'synthetic-private-admin-session-'.repeat(2))
    const { GET } = await import('@/app/api/admin/status/route')
    const denied = await GET(new Request('https://fixture.test/api/admin/status'))
    expect(denied.status).toBe(401)
    expect(denied.headers.get('cache-control')).toBe('no-store, private')
    expect(await denied.json()).toEqual({ error: 'unauthorized' })
    expect((await getCatalogApiService()).listPrograms()).toEqual(publicBefore)
    expect(getData()).toBe(current)
    expect(await getCatalogData()).toBe(directory)

    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(getData()).toBe(raw)
    expect(await getCatalogData()).toBe(raw)
    expect((await getCatalogApiService()).listPrograms()).toEqual(publicBefore)
  })

  it('initializes a concurrent request burst once and prevents nested shared-result pollution', async () => {
    const f = fixture(), parse = vi.spyOn(bundleSchema, 'parse')
    const snapshots = await Promise.all(Array.from({ length: 20 }, () => f.snapshot()))
    expect(parse).toHaveBeenCalledTimes(1)
    expect(snapshots.every(value => value === snapshots[0])).toBe(true)
    const first = snapshots[0]
    expect(() => { first.current.programs[0].name.en = 'unreviewed replacement' }).toThrow()
    expect(() => { first.directory.programs[0].discovery.currentFieldPaths.push('tuitionCny') }).toThrow()
    expect(() => { first.release.recordCounts.programs = 999 }).toThrow()
    expect((await f.snapshot()).current.programs[0].name.en).toBe('Computer Science')
    expect((await f.repository.getBundle()).programs[0].name.en).toBe('Computer Science')
  })

  it('invalidates same-size raw data updates and recovers after a corrupt generation without serving the old one', async () => {
    const f = fixture(), first = await f.snapshot()
    f.bundle.programs[0].durationMonths = 36; f.writeBundle()
    const changed = await f.snapshot()
    expect(changed).not.toBe(first)
    expect(changed.revision).not.toBe(first.revision)
    expect(changed.current.programs[0].durationMonths).toBe(36)
    const file = join(f.directory, 'programs.json')
    replaceJson(file, { invalid: true })
    await expect(f.snapshot()).rejects.toThrow()
    f.writeBundle()
    const recovered = await f.snapshot()
    expect(recovered.current.programs[0].durationMonths).toBe(36)
    expect(recovered).toBe(await f.snapshot())
  })

  it('shares failed asynchronous initialization and permits a later concurrent burst to recover', async () => {
    const f = fixture(), loader = vi.fn().mockRejectedValueOnce(Error('temporary loader failure')).mockResolvedValueOnce(f.bundle)
    const repository = new JsonCatalogRepository(loader)
    const failed = await Promise.allSettled(Array.from({ length: 20 }, () => repository.getBundle()))
    expect(failed.every(result => result.status === 'rejected')).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
    const recovered = await Promise.all(Array.from({ length: 20 }, () => repository.getBundle()))
    expect(loader).toHaveBeenCalledTimes(2)
    expect(recovered.every(bundle => bundle === recovered[0])).toBe(true)
    expect(Object.isFrozen(recovered[0].programs[0].name)).toBe(true)
  })

  it('revalidates changed receipts before using a warm projection, keeps strict/non-strict reads isolated, and retries after repair', async () => {
    const f = fixture(), first = await f.snapshot(), validReceipt = JSON.parse(readFileSync(f.receiptFile, 'utf8'))
    readIdentityAcceptances(f.directory) // A permissive read must not satisfy a strict one.
    validReceipt.accepted[0].verifiedName.en = 'Unreviewed change'
    replaceJson(f.receiptFile, validReceipt)
    expect(readIdentityAcceptances(f.directory)).toHaveLength(2)
    await expect(f.snapshot()).rejects.toThrow('identity_scoped_name_receipt_invalid')
    rmSync(f.receiptFile)
    await expect(f.snapshot()).rejects.toThrow('identity_scoped_name_receipt_invalid')
    f.writeIdentities()
    const recovered = await f.snapshot()
    expect(recovered.current.programs[0].name).toEqual(first.current.programs[0].name)
    expect(recovered).toBe(await f.snapshot())
  })

  it('invalidates ledger scope changes without raw-data edits and never restores unreviewed sibling locales', async () => {
    const f = fixture(), raw = await f.repository.getBundle(), first = await f.snapshot()
    expect(localize(first.current.programs[0].name, 'en')).toBe('Computer Science')
    expect(localize(first.current.programs[0].name, 'zh')).toBe('计算机科学')
    f.identities[0].verifiedName = { zh: '计算机科学' }; f.writeIdentities()
    const changed = await f.snapshot()
    expect(await f.repository.getBundle()).toBe(raw)
    expect(changed.revision).not.toBe(first.revision)
    expect(changed.current.programs[0].name).toEqual({ zh: '计算机科学' })
    expect(localize(changed.current.programs[0].name, 'en')).toBe('计算机科学')
    expect(changed.directory.programs[0].name).toEqual({ zh: '计算机科学' })
  })

  it('expires current records/deadlines at China midnight and independently expires scoped fields the following midnight', async () => {
    const f = fixture()
    replaceJson(join(f.directory, 'field-verifications.json'), { schemaVersion: 1, entries: [durationField(f.bundle, '2026-11-04')] })
    const before = await f.snapshot(getTodayDate(new Date('2026-11-03T15:59:59.999Z')))
    expect(before.current.programs).toHaveLength(1)
    expect(before.current.admissionCycles).toHaveLength(1)
    expect(before.current.scholarships).toHaveLength(1)
    const midnight = await f.snapshot(getTodayDate(new Date('2026-11-03T16:00:00.000Z')))
    expect(midnight.revision).not.toBe(before.revision)
    expect(midnight.current.programs).toEqual([])
    expect(midnight.current.admissionCycles).toEqual([])
    expect(midnight.current.scholarships).toEqual([])
    expect(midnight.directory.programs[0].discovery.currentFacts).toBe(false)
    expect(midnight.directory.programs[0].durationMonths).toBe(24)
    expect(midnight.directory.programs[0].applyUrl).toBeNull()
    expect(midnight.directory.scholarships[0].deadline).toBeNull()
    expect(midnight.directory.scholarships[0].coverage.tuition).toBe('unknown')
    const expiredField = await f.snapshot(getTodayDate(new Date('2026-11-04T16:00:00.000Z')))
    expect(expiredField.directory.programs[0].durationMonths).toBeNull()
    expect(expiredField.directory.programs[0].discovery.currentFieldPaths).toEqual([])
    expect(expiredField.revision).not.toBe(midnight.revision)
  })

  it('detects creation, corruption and repair of a field ledger and retains only independently current leaves', async () => {
    const f = fixture(), date = '2026-11-04', first = await f.snapshot(date)
    expect(first.directory.programs[0].durationMonths).toBeNull()
    const file = join(f.directory, 'field-verifications.json'), entry = durationField(f.bundle, date)
    replaceJson(file, { schemaVersion: 1, entries: [entry] })
    const checked = await f.snapshot(date)
    expect(checked.revision).not.toBe(first.revision)
    expect(checked.directory.programs[0].durationMonths).toBe(24)
    expect(checked.directory.programs[0].applyUrl).toBeNull()
    replaceJson(file, { schemaVersion: 1, entries: [{ invalid: true }] })
    const corrupt = await f.snapshot(date)
    expect(corrupt.directory.programs[0].durationMonths).toBeNull()
    replaceJson(file, { schemaVersion: 1, entries: [entry] })
    expect((await f.snapshot(date)).directory.programs[0].durationMonths).toBe(24)
  })
})
