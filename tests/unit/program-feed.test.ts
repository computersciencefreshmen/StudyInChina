import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixture = vi.hoisted(() => ({
  baseline: [1, 2].map(sourceId => ({ id: `cucas-${sourceId}`, sourceId: String(sourceId), provider: 'CUCAS',
    schoolId: 'cucas-alpha', schoolName: 'Alpha University', name: `Baseline Programme ${sourceId}`,
    sourceUrl: `https://alpha.cucas.cn/program/Baseline-${sourceId}.html`, fetchedAt: '2026-11-17T00:00:00Z',
    evidenceHash: 'a'.repeat(64), status: 'extracted', official: false, admissionYear: null,
    fields: { tuition: 'RMB 20,000 per year', requirements: 'Baseline admission requirements' } })),
}))
vi.mock('../../content/third-party/details.json', () => ({ default: { programs: fixture.baseline } }))
vi.mock('../../content/third-party/manifest.json', () => ({ default: {
  generatedAt: '2026-11-17T00:00:00Z', candidateSnapshot: { sha256: 'b'.repeat(64) },
} }))

type Descriptor = { path: string; sha256: string; bytes: number; count?: number }
type Manifest = { schemaVersion: number; revision: string; generatedAt: string; official: false;
  counts: { programCount: number; capturedCount: number; schoolCount: number; sourceCount: number }; indexShards: Descriptor[] }
type Helpers = {
  writeProgramFeed(root: string, data: { records: unknown[]; generatedAt: string }): Manifest
  sha256(body: string | Uint8Array): string
  feedRevision(counts: Manifest['counts'], shards: Descriptor[]): string
}
const builderUrl = pathToFileURL(resolve('scripts/ingestion/program-catalog-feed.mjs')).href
const builder = await import(/* @vite-ignore */ builderUrl) as Helpers
const feedBase = 'https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/catalog-program-feed/'
const roots: string[] = []
const extra = () => ({ id: 'sicas-3', sourceId: '3', provider: 'SICAS', schoolId: 'sicas-7', schoolName: 'Beta University',
  name: 'New Finance Programme', sourceUrl: 'https://www.sicas.com.cn/School/7/Beta/3/Finance',
  fetchedAt: '2026-11-17T01:00:00Z', evidenceHash: 'c'.repeat(64), status: 'extracted', official: false, admissionYear: null,
  fields: { duration: '4 Years', tuition: 'CNY 9,800 per year', requirements: 'Literal source requirements' } })
const sourceLink = () => ({ id: 'sicas-4', sourceId: '4', provider: 'SICAS', schoolId: 'sicas-7', schoolName: 'Beta University',
  name: 'Uncaptured Programme 2035', sourceUrl: 'https://www.sicas.com.cn/School/7/Beta/4/Other',
  status: 'link_only', official: false, admissionYear: null, fields: {} })

function bundle(records: unknown[] = [...fixture.baseline, extra(), sourceLink()]) {
  const root = mkdtempSync(join(tmpdir(), 'sic-program-feed-unit-')); roots.push(root)
  const manifest = builder.writeProgramFeed(root, { records, generatedAt: '2026-11-17T01:00:00Z' })
  return { root, manifest }
}
function networkFor(root: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.startsWith(feedBase)) throw new Error('Unexpected network origin')
    const bytes = readFileSync(join(root, url.slice(feedBase.length)))
    return new Response(bytes.toString('utf8'), { status: 200, headers: { 'content-length': String(bytes.length) } })
  })
}
function saveManifest(root: string, manifest: Manifest) {
  manifest.revision = builder.feedRevision(manifest.counts, manifest.indexShards)
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
}
function replaceIndex(root: string, manifest: Manifest, data: unknown) {
  const body = JSON.stringify(data), hash = builder.sha256(body)
  const prior = manifest.indexShards[0]
  const descriptor = { ...prior, path: `indexes/${hash}.json`, sha256: hash, bytes: Buffer.byteLength(body) }
  writeFileSync(join(root, descriptor.path), body)
  manifest.indexShards[0] = descriptor
  saveManifest(root, manifest)
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-11-17T02:00:00Z')
  vi.stubEnv('PROGRAM_FEED_ENABLED', 'true')
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
  for (const root of roots.splice(0)) {
    const checked = realpathSync(root)
    if (dirname(checked) !== realpathSync(tmpdir()) || !basename(checked).startsWith('sic-program-feed-unit-')) throw new Error('Unexpected cleanup path')
    rmSync(checked, { recursive: true, force: true })
  }
})

describe('remote programme feed integrity and baseline preservation', () => {
  it('loads real builder manifests and serves captured cards without URL-only records or eager details', async () => {
    const { root, manifest } = bundle(), network = networkFor(root)
    vi.stubGlobal('fetch', network)
    const feed = await import('@/lib/program-feed')
    const index = await feed.getProgramFeedIndex()
    expect(index.revision).toBe(manifest.revision)
    expect(index.programs.map(row => row.id)).toEqual([...fixture.baseline.map(row => row.id), extra().id])
    expect(index.programs.every(row => row.status === 'extracted' && row.official === false && row.admissionYear === null)).toBe(true)
    expect(index.programs.some(row => row.id === sourceLink().id)).toBe(false)
    expect(network.mock.calls.every(([url]) => !String(url).includes('/details/'))).toBe(true)
    const detail = await feed.getProgramFeedRecord(extra().id)
    expect(detail?.fields.requirements).toBe(extra().fields.requirements)
    const countAfterDetail = network.mock.calls.length
    expect(await feed.getProgramFeedRecord(extra().id)).toEqual(detail)
    expect(network).toHaveBeenCalledTimes(countAfterDetail)
  })

  it('keeps the complete local baseline when an index hash is corrupted', async () => {
    const { root, manifest } = bundle()
    writeFileSync(join(root, manifest.indexShards[0].path), '{"schemaVersion":1,"programs":[]}')
    vi.stubGlobal('fetch', networkFor(root))
    const feed = await import('@/lib/program-feed')
    expect((await feed.getProgramFeedIndex()).programs.map(row => row.id)).toEqual(fixture.baseline.map(row => row.id))
    expect((await feed.getProgramFeedRecord(fixture.baseline[0].id))?.fields.requirements).toBe(fixture.baseline[0].fields.requirements)
  })

  it('retains the last complete remote revision when the next refresh is unavailable', async () => {
    const { root } = bundle(), network = networkFor(root)
    vi.stubGlobal('fetch', network)
    const feed = await import('@/lib/program-feed'), good = await feed.getProgramFeedIndex()
    vi.setSystemTime(Date.now() + 61_000)
    network.mockRejectedValue(new Error('Network unavailable'))
    const retained = await feed.getProgramFeedIndex()
    expect(retained.revision).toBe(good.revision)
    expect(retained.programs.map(row => row.id)).toEqual(good.programs.map(row => row.id))
  })

  it('rejects a same-sized remote snapshot that drops even one baseline ID', async () => {
    const { root } = bundle([fixture.baseline[0], extra()])
    vi.stubGlobal('fetch', networkFor(root))
    const feed = await import('@/lib/program-feed')
    expect((await feed.getProgramFeedIndex()).programs.map(row => row.id)).toEqual(fixture.baseline.map(row => row.id))
  })

  it.each(['../private.json', 'https://evil.test/index.json', 'indexes/not-a-hash.json'])(
    'rejects index path %s before making an out-of-contract request', async path => {
      const { root, manifest } = bundle()
      manifest.indexShards[0].path = path; saveManifest(root, manifest)
      const network = networkFor(root); vi.stubGlobal('fetch', network)
      const feed = await import('@/lib/program-feed')
      expect((await feed.getProgramFeedIndex()).programs.map(row => row.id)).toEqual(fixture.baseline.map(row => row.id))
      expect(network.mock.calls.map(([url]) => String(url))).toEqual([feedBase + 'manifest.json'])
    },
  )

  it.each([{ explicit: '', environment: '' }, { explicit: 'false', environment: 'production' }])(
    'performs no network access when the feed is disabled or local: %j', async ({ explicit, environment }) => {
      vi.stubEnv('PROGRAM_FEED_ENABLED', explicit); vi.stubEnv('VERCEL_ENV', environment)
      const network = vi.fn(); vi.stubGlobal('fetch', network)
      const feed = await import('@/lib/program-feed')
      expect((await feed.getProgramFeedIndex()).programs.map(row => row.id)).toEqual(fixture.baseline.map(row => row.id))
      expect(await feed.getProgramFeedRecord(extra().id)).toBeUndefined()
      expect(network).not.toHaveBeenCalled()
    },
  )

  it('shares an in-flight refresh with a concurrent newly captured detail request', async () => {
    const { root } = bundle(), serve = networkFor(root)
    let release: (() => void) | undefined
    const waiting = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/manifest.json')) await waiting
      return serve(input)
    }))
    const feed = await import('@/lib/program-feed')
    const refresh = feed.getProgramFeedIndex()
    const requested = feed.getProgramFeedRecord(extra().id)
    release!()
    await refresh
    expect((await requested)?.id).toBe(extra().id)
  })

  it('does not serve a same-ID detail whose school or source URL differs from the indexed programme', async () => {
    const { root, manifest } = bundle()
    const shard = JSON.parse(readFileSync(join(root, manifest.indexShards[0].path), 'utf8'))
    const row = shard.programs.find((program: { id: string }) => program.id === extra().id)
    const altered = { ...extra(), schoolId: 'sicas-999', schoolName: 'Wrong University', sourceUrl: 'https://www.sicas.com.cn/School/999/Wrong/3/Finance' }
    const body = JSON.stringify(altered), hash = builder.sha256(body), path = `details/${hash.slice(0, 2)}/${hash}.json`
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body)
    row.detail = { path, sha256: hash, bytes: Buffer.byteLength(body) }
    replaceIndex(root, manifest, shard)
    vi.stubGlobal('fetch', networkFor(root))
    const feed = await import('@/lib/program-feed')
    await feed.getProgramFeedIndex()
    expect(await feed.getProgramFeedRecord(extra().id)).toBeUndefined()
  })
})
