import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { identityFingerprint, scopedNameReceiptMatches, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { projectVerifiedProgramName } from '@/lib/data/verified-program-name'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import type { DataBundle } from '@/lib/data/types'

const today = '2026-10-30', now = '2026-10-30T12:00:00.000Z', bundle = loadMaintenanceBundle(process.cwd())
const roots: string[] = [], fixtureRoot = join(process.cwd(), 'tests/fixtures/reviewed-html-program-alias')
const protectedIds = ['prog-gap-wave8-gznu-tourism-management-master', 'prog-gap-wave8-shzu-energy-power-master', 'prog-gap-wave8-2-suep-international-economy-trade-bachelor']
afterEach(() => { for (const root of roots.splice(0)) {
  const inside = relative(process.cwd(), resolve(root))
  if (!inside.startsWith('.tmp-alias-scope-') || inside.includes('..') || isAbsolute(inside)) throw Error('unexpected_test_cleanup_path')
  rmSync(root, { recursive: true, force: true })
} })
function unscoped(recordId: string): IdentityAcceptance {
  const record = bundle.programs.find(record => record.id === recordId)!
  return { entityType: 'program', recordId, identitySha256: identityFingerprint('program', record), sourceIds: record.sourceIds,
    acceptedAt: now, reviewer: 'TEST_ONLY_SCOPE_ERASURE', receiptPath: 'quality/missing-receipt.json', receiptSha256: 'a'.repeat(64) }
}
function diskFixture(data: DataBundle, entry: IdentityAcceptance, receipt?: unknown) {
  const root = mkdtempSync(join(process.cwd(), '.tmp-alias-scope-')); roots.push(root)
  const dataDir = join(root, 'content/data'); mkdirSync(dataDir, { recursive: true }); mkdirSync(join(root, 'content/maintenance'))
  const json = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
  for (const [file, key] of [['sources', 'sources'], ['cities', 'cities'], ['universities', 'universities'], ['programs', 'programs'], ['admission-cycles', 'admissionCycles'], ['scholarships', 'scholarships']] as const)
    json(join(dataDir, `${file}.json`), data[key])
  writeFileSync(join(root, 'content/maintenance/scope-272.v1.json'), readFileSync(join(process.cwd(), 'content/maintenance/scope-272.v1.json')))
  json(join(dataDir, 'identity-acceptances.json'), { schemaVersion: 1, entries: [entry] })
  if (receipt) { const path = join(root, entry.receiptPath); mkdirSync(resolve(path, '..'), { recursive: true }); json(path, receipt) }
  return { root, dataDir }
}
describe('known reviewed names cannot regain raw legacy locales after scope and receipt erasure', () => {
  for (const recordId of protectedIds) {
    it(`blocks erased scope and absent receipt for ${recordId}`, async () => {
      const entry = unscoped(recordId), record = bundle.programs.find(record => record.id === recordId)!
      expect(projectVerifiedProgramName(record, bundle.sources, [entry], today)).toBeUndefined()
      expect(projectVerifiedProgramName(record, bundle.sources, [], today)).toBeUndefined()
      expect(scopedNameReceiptMatches(entry, undefined)).toBe(false)
      expect(selectDiscoveryData(bundle, today, [entry]).programs.some(record => record.id === recordId)).toBe(false)
      const disk = diskFixture(bundle, entry)
      expect(() => readIdentityAcceptances(disk.dataDir, { strictProjection: true })).toThrow('identity_scoped_name_receipt_invalid')
      await expect(validateDirectory(disk.root, today)).rejects.toThrow('directory_scoped_name_binding_invalid')
      // Fresh applicant data cannot bypass the same pure gate through the API.
      const current = structuredClone(bundle)
      for (const item of [...current.cities, ...current.universities, ...current.programs]) Object.assign(item, { status: 'verified', verifiedAt: '2026-10-29', reviewAfter: '2026-11-30' })
      current.programs.find(item => item.id === recordId)!.verificationScope = 'facts'
      expect(projectVerifiedProgramName(current.programs.find(item => item.id === recordId)!, current.sources, [entry], today)).toBeUndefined()
      const api = selectCatalogApiData(current, today, [entry])
      expect(api.programs.some(record => record.id === recordId)).toBe(false)
      const directory = selectDiscoveryData(current, today, [entry])
      const currentService = new CatalogApiService(api, releaseFromBundle(api, today), today)
      const directoryService = new CatalogApiService(directory, releaseFromBundle(directory, today), today)
      expect(currentService.listPrograms({ q: record.name.en }).data.some(record => record.id === recordId)).toBe(false)
      expect(directoryService.listPrograms({ view: 'directory', q: record.name.en }).data.some(record => record.id === recordId)).toBe(false)
    })
  }
  it('keeps unrelated unscoped legacy readers and pure/API projection compatible with a missing receipt', async () => {
    const raw = structuredClone(bundle), record = raw.programs.find(record => record.id === protectedIds[1])!
    record.id = 'unrelated-legacy-program'; record.status = 'verified'; record.verifiedAt = '2026-10-29'; record.reviewAfter = '2026-11-30'; record.verificationScope = 'facts'
    for (const item of [...raw.cities, ...raw.universities]) Object.assign(item, { status: 'verified', verifiedAt: '2026-10-29', reviewAfter: '2026-11-30' })
    const entry = { ...unscoped(protectedIds[1]), recordId: record.id, identitySha256: identityFingerprint('program', record) }
    const disk = diskFixture(raw, entry)
    expect(readIdentityAcceptances(disk.dataDir, { strictProjection: true })).toEqual([entry])
    expect(projectVerifiedProgramName(record, raw.sources, [entry], today)?.name).toEqual(record.name)
    expect(selectCatalogApiData(raw, today, [entry]).programs.find(item => item.id === record.id)?.name).toEqual(record.name)
    // Keep the validator's pre-existing requirement for all legacy receipts.
    await expect(validateDirectory(disk.root, today)).rejects.toThrow()
  })
  it('preserves SUEP actual existing scoped receipt without introducing a verifiedSourceUrl requirement', async () => {
    const entry = JSON.parse(readFileSync(join(fixtureRoot, 'suep-actual-acceptance.json'), 'utf8')) as IdentityAcceptance
    const receipt = JSON.parse(readFileSync(join(fixtureRoot, 'suep-actual-receipt.json'), 'utf8'))
    expect(entry.verifiedSourceUrl).toBeUndefined()
    const raw = structuredClone(bundle)
    const cohort = new Set(JSON.parse(readFileSync(join(process.cwd(), 'content/maintenance/scope-272.v1.json'), 'utf8')).schools.map((school: { universityId: string }) => school.universityId))
    // This isolated ledger contains SUEP only. Extra schools require their own
    // programme receipts and are outside this focused historical-receipt test.
    for (const school of raw.universities) if (!cohort.has(school.id)) school.status = 'draft'
    const disk = diskFixture(raw, entry, receipt)
    expect(readIdentityAcceptances(disk.dataDir, { strictProjection: true })).toEqual([entry])
    expect(scopedNameReceiptMatches(entry, receipt)).toBe(true)
    expect(projectVerifiedProgramName(bundle.programs.find(record => record.id === entry.recordId)!, bundle.sources, [entry], today)?.name).toEqual({ en: 'International Economy and Trade' })
    expect((await validateDirectory(disk.root, today)).integrityPassed).toBe(true)
  })
})
