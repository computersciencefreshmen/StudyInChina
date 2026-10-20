import { createHash } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyFullScholarshipBatch, assessFullScholarshipBatch, type FullScholarshipBatch } from '../../scripts/quality/approve-full-scholarship-batch'
import { readCatalogSnapshotBaseline } from '../../scripts/automation/apply-catalog-snapshot'
import * as snapshotWriter from '../../scripts/automation/apply-catalog-snapshot'
import { bundleSchema } from '../../src/lib/data/schema'
import type { Scholarship, Source } from '../../src/lib/data/types'

const today = '2026-10-19', now = new Date('2026-10-19T01:00:00Z')
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const roots: string[] = []
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.stubGlobal('fetch', vi.fn(() => { throw Error('offline-fixtures-only') })) })
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve('.tmp') + sep)) throw Error('unsafe_fixture_cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'scholarship-approval-')); roots.push(root)
  await mkdir(join(root, 'content/data'), { recursive: true })
  const source: Source = { id: 'award-source', url: 'https://synthetic.edu/award', title: 'Synthetic scholarship fixture', publisher: 'Synthetic University', kind: 'scholarship', language: 'en', official: true, accessedAt: today }
  const audit = { sourceIds: [source.id], verifiedAt: today, reviewAfter: '2026-11-18', status: 'verified' as const }
  const scholarship: Scholarship = { ...audit, id: 'synthetic-award', slug: 'synthetic-award', name: { en: 'Synthetic entry scholarship' }, providerType: 'university', universityIds: ['synthetic-university'], programIds: [], coverage: { tuition: 'full', accommodation: 'full', insurance: true, stipendCnyPerMonth: 2500 }, deadline: '2026-10-31', applicationUrl: 'https://apply.synthetic.edu/award', summary: { en: 'Tuition, accommodation, insurance and CNY2500/month. Competitive award.' }, eligibility: [{ en: 'New international applicants only; HSK3 180.' }] }
  const catalog = bundleSchema.parse({ sources: [source], cities: [{ ...audit, id: 'synthetic-city', slug: 'synthetic-city', name: { en: 'Synthetic City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }], universities: [{ ...audit, id: 'synthetic-university', slug: 'synthetic-university', name: { en: 'Synthetic University' }, cityId: 'synthetic-city', region: null, officialUrl: 'https://synthetic.edu/', admissionsUrl: null, summary: null, featured: false }], programs: [], admissionCycles: [], scholarships: [] })
  for (const [key, filename] of Object.entries({ sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' })) await writeFile(join(root, 'content/data', filename + '.json'), JSON.stringify(catalog[key as keyof typeof catalog], null, 2) + '\n')
  const quotes = { name: 'Synthetic entry scholarship', providerType: 'Funded by Synthetic University.', universityIds: 'At Synthetic University.', programIds: 'School-wide award; no separate programme restriction.', 'coverage.tuition': 'Tuition covered in full.', 'coverage.accommodation': 'Accommodation covered in full.', 'coverage.insurance': 'Medical insurance included.', 'coverage.stipendCnyPerMonth': 'CNY2500 per month.', deadline: 'Apply by 2026-10-31.', applicationUrl: 'https://apply.synthetic.edu/award', summary: 'Tuition, accommodation, insurance and CNY2500/month. Competitive award.', eligibility: 'New international applicants only; HSK3 180.' }
  const text = Object.values(quotes).join('\n'), raw = '<html><body>' + text + '</body></html>'
  await writeFile(join(root, 'official.html'), raw); await writeFile(join(root, 'official.txt'), text)
  const batch: FullScholarshipBatch = { schemaVersion: 1, batchId: 'synthetic-scholarship-20261019', sources: [source], captures: [{ sourceId: source.id, url: source.url, rawPath: 'official.html', rawSha256: sha(raw), textPath: 'official.txt', textSha256: sha(text), retrievedAt: now.toISOString(), httpStatus: 200 }], entries: [{ scholarship, evidence: Object.entries(quotes).map(([field, quote]) => ({ field, quote, sourceId: source.id })), reviewer: 'codex', reviewedAt: now.toISOString() }] }
  const assess = () => assessFullScholarshipBatch(root, batch, catalog, today)
  const digest = sha(JSON.stringify(catalog))
  const snapshot = () => readCatalogSnapshotBaseline(join(root, 'content/data'))
  return { root, batch, catalog, scholarship, source, assess, digest, snapshot }
}

it('applies a completely reviewed official scholarship with a permanent before/after receipt', async () => {
  const f = await fixture()
  expect(f.assess()).toMatchObject({ ready: 1, held: 0 })
  expect(applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toMatchObject({ appliedScholarships: 1, newScholarships: 1 })
  expect(f.snapshot().bundle.scholarships).toEqual([f.scholarship])
  const receipt = JSON.parse(await readFile(join(f.root, 'quality/scholarship-expansion-20261019/applied-' + f.batch.batchId + '.json'), 'utf8'))
  expect(receipt).toMatchObject({ status: 'local-snapshot-applied-awaiting-publication', before: [null], after: [f.scholarship], originalCatalogSha256: f.digest })
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['raw', 'text'] as const)('holds mutated %s capture and changes no catalogue bytes', async kind => {
  const f = await fixture(), before = f.snapshot().files.map(file => file.bytes)
  await writeFile(join(f.root, kind === 'raw' ? 'official.html' : 'official.txt'), 'altered')
  expect(applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toMatchObject({ appliedScholarships: 0, assessment: { held: 1 } })
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
})

it.each(['stale', 'future', 'nonofficial'] as const)('holds %s evidence', async kind => {
  const f = await fixture()
  if (kind === 'stale') f.batch.captures[0].retrievedAt = '2026-10-17T00:00:00Z'
  if (kind === 'future') f.batch.captures[0].retrievedAt = '2026-10-20T00:00:00Z'
  if (kind === 'nonofficial') f.source.official = false
  expect(f.assess().entries[0].blockers).toContain('fresh_official_capture_missing')
})

it('holds missing monetary evidence and fabricated quotes despite valid schema', async () => {
  const f = await fixture()
  f.batch.entries[0].evidence = f.batch.entries[0].evidence.filter(p => p.field !== 'coverage.stipendCnyPerMonth')
  f.batch.entries[0].evidence.find(p => p.field === 'eligibility')!.quote = 'No language test is required.'
  expect(f.assess().entries[0].blockers).toEqual(expect.arrayContaining(['field_evidence_missing:coverage.stipendCnyPerMonth', 'quote_not_in_official_capture:eligibility']))
})

it.each(['deadline', 'review', 'parent'] as const)('holds invalid current %s', async kind => {
  const f = await fixture()
  if (kind === 'deadline') f.scholarship.deadline = '2026-10-18'
  if (kind === 'review') f.scholarship.verifiedAt = '2026-10-20'
  if (kind === 'parent') f.scholarship.universityIds = ['missing-university']
  expect(f.assess().ready).toBe(0)
})

it('requires independent review before reserving or applying any record', async () => {
  const f = await fixture(); f.batch.entries[0].reviewedAt = ''
  expect(f.assess().entries[0].blockers).toContain('independent_review_missing')
  expect(applyFullScholarshipBatch(f.root, f.batch, f.digest, today).appliedScholarships).toBe(0)
})

it('rejects stale catalogue CAS and preserves external changes', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'content/data/scholarships.json'), '[]\n\n')
  // Normalized facts are equal, but the snapshot byte checks still protect edits made after its baseline.
  expect(() => applyFullScholarshipBatch(f.root, f.batch, '0'.repeat(64), today)).toThrow('canonical_catalog_changed')
  expect(await readFile(join(f.root, 'content/data/scholarships.json'), 'utf8')).toBe('[]\n\n')
})

it('rejects an already consumed batch even with the newest valid catalogue hash', async () => {
  const f = await fixture()
  applyFullScholarshipBatch(f.root, f.batch, f.digest, today)
  const latest = f.snapshot(), before = latest.files.map(file => file.bytes)
  expect(() => applyFullScholarshipBatch(f.root, f.batch, sha(JSON.stringify(latest.bundle)), today)).toThrow('scholarship_batch_already_reserved_or_applied')
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
})

it('holds the whole batch when one entry is unreviewed, without reserving or partially applying it', async () => {
  const f = await fixture(), before = f.snapshot().files.map(file => file.bytes)
  const second = structuredClone(f.batch.entries[0])
  second.scholarship.id = 'second-award'; second.scholarship.slug = 'second-award'; second.reviewedAt = ''
  f.batch.entries.push(second)
  expect(applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toMatchObject({ appliedScholarships: 0, assessment: { ready: 1, held: 1 } })
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
  await expect(readFile(join(f.root, 'quality/scholarship-expansion-20261019/applied-' + f.batch.batchId + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('permanently reserves a failed snapshot and refuses automatic replay after the failure is removed', async () => {
  const f = await fixture(), before = f.snapshot().files.map(file => file.bytes)
  const failure = vi.spyOn(snapshotWriter, 'applyCatalogSnapshotFiles').mockImplementation(() => { throw Error('synthetic-snapshot-failure') })
  expect(() => applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toThrow('synthetic-snapshot-failure')
  failure.mockRestore()
  const receipt = JSON.parse(await readFile(join(f.root, 'quality/scholarship-expansion-20261019/applied-' + f.batch.batchId + '.json'), 'utf8'))
  expect(receipt.status).toBe('snapshot-failed-reconciliation-required')
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
  expect(() => applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toThrow('scholarship_batch_already_reserved_or_applied')
})

it('rejects changing a reused canonical source identity before making any catalogue or receipt write', async () => {
  const f = await fixture(), before = f.snapshot().files.map(file => file.bytes)
  f.batch.sources[0] = { ...f.source, publisher: 'An unrelated publisher' }
  expect(f.assess().ready).toBe(1)
  expect(() => applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toThrow('existing_scholarship_source_changed')
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
  await expect(readFile(join(f.root, 'quality/scholarship-expansion-20261019/applied-' + f.batch.batchId + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('retains a permanent reservation after bounded native sharing retries fail and earlier award writes roll back', async () => {
  const f = await fixture(), before = f.snapshot().files.map(file => file.bytes)
  const original = snapshotWriter.applyCatalogSnapshotFiles
  let failedAttempts = 0
  const waitForRetry = vi.fn()
  const injected = vi.spyOn(snapshotWriter, 'applyCatalogSnapshotFiles').mockImplementation((baseline, next) => original(baseline, next, {
    platform: 'win32', waitForRetry, replaceFile: (source, target) => {
      if (source.endsWith('.snapshot-tmp') && target.endsWith('sources.json')) { failedAttempts++; throw Object.assign(new Error('persistent-native-sharing-lock'), { code: 'EPERM' }) }
      renameSync(source, target)
    },
  }))
  expect(() => applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toThrow('persistent-native-sharing-lock')
  injected.mockRestore()
  expect(failedAttempts).toBe(5); expect(waitForRetry.mock.calls).toEqual([[25], [50], [100], [150]])
  expect(f.snapshot().files.map(file => file.bytes)).toEqual(before)
  const receipt = JSON.parse(await readFile(join(f.root, 'quality/scholarship-expansion-20261019/applied-' + f.batch.batchId + '.json'), 'utf8'))
  expect(receipt.status).toBe('snapshot-failed-reconciliation-required')
  expect(() => applyFullScholarshipBatch(f.root, f.batch, f.digest, today)).toThrow('scholarship_batch_already_reserved_or_applied')
})
