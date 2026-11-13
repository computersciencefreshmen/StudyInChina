import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { copyAccountR2 } from '../../../scripts/cloudflare/copy-account-r2'
import { handleFetch, MAX_OBJECT_BYTES, receiptsPrefix } from '../src/index'
import type { MigrationBucket, MigrationEnv } from '../src/types'

const token = 'a'.repeat(64), migrationId = 'local-canary-20261113'
const sourceUrl = 'https://source-migration.invalid', targetUrl = 'https://target-migration.invalid'
const headers = { authorization: `Bearer ${token}`, 'x-migration-id': migrationId }
type NativeWorker = { fetch(request: Request): Promise<Response> }
type NativeBucket = {
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: Record<string, string | Date>; customMetadata?: Record<string, string> }): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; customMetadata?: Record<string, string>;
    httpMetadata?: { contentEncoding?: string; contentLanguage?: string; cacheExpiry?: Date } } | null>
  list(): Promise<{ objects: Array<{ key: string }> }>
}

test('real workerd and native R2 copy all pages, preserve exact metadata/bytes and resume without overwrites', { timeout: 120000 }, async context => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))], bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', write: false })
  const calls: string[] = [], mode = { redirect: false, unfrozen: false }
  const sourceOptions = { name: 'migration-source', modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-18', bindings: { MIGRATION_ROLE: 'source', MIGRATION_ID: migrationId, MIGRATION_TRANSFER_TOKEN: token, SOURCE_FROZEN: 'true' },
    r2Buckets: { SNAPSHOTS_BUCKET: 'source-snapshots', RELEASES_BUCKET: 'source-releases', BACKUPS_BUCKET: 'source-backups' } }
  const targetOptions = { name: 'migration-target', modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-18', bindings: { MIGRATION_ROLE: 'target', MIGRATION_ID: migrationId, MIGRATION_TRANSFER_TOKEN: token,
      SOURCE_URL: sourceUrl, SOURCE_HOST: 'source-migration.invalid' },
    r2Buckets: { SNAPSHOTS_BUCKET: 'target-snapshots', RELEASES_BUCKET: 'target-releases', BACKUPS_BUCKET: 'target-backups' },
    outboundService: async (request: Request) => {
      calls.push(request.url)
      assert.equal(new URL(request.url).origin, sourceUrl, 'all outbound requests remain on the configured source')
      if (mode.redirect) return new WorkerResponse(null, { status: 302, headers: { location: 'https://untrusted.invalid/never-follow' } })
      const response = await (await mf.getWorker(mode.unfrozen ? 'migration-unfrozen-source' : 'migration-source') as unknown as NativeWorker).fetch(request)
      return new WorkerResponse(await response.arrayBuffer(), { status: response.status, headers: response.headers })
    } }
  const unfrozenOptions = { ...sourceOptions, name: 'migration-unfrozen-source', bindings: { ...sourceOptions.bindings, SOURCE_FROZEN: 'false' } }
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [sourceOptions, unfrozenOptions, targetOptions], host: '127.0.0.1', port: 0,
    cf: false, telemetry: { enabled: false } }))
  mkdirSync(resolve('.tmp'), { recursive: true })
  const directory = mkdtempSync(resolve('.tmp/account-migration-test-'))
  try {
    await mf.ready
    const source = await mf.getWorker('migration-source') as unknown as NativeWorker, target = await mf.getWorker('migration-target') as unknown as NativeWorker
    const sourceSnapshots = await mf.getR2Bucket('SNAPSHOTS_BUCKET', 'migration-source') as unknown as NativeBucket
    const targetSnapshots = await mf.getR2Bucket('SNAPSHOTS_BUCKET', 'migration-target') as unknown as NativeBucket
    const sourceReleases = await mf.getR2Bucket('RELEASES_BUCKET', 'migration-source') as unknown as NativeBucket
    const sourceBackups = await mf.getR2Bucket('BACKUPS_BUCKET', 'migration-source') as unknown as NativeBucket
    const compressed = gzipSync(Buffer.from('完整原件，不得透明解压。'))
    const metadata = { sourceId: 'original-source', rawSha256: createHash('sha256').update(compressed).digest('hex'),
      canonicalSha256: 'b'.repeat(64), fetchedAt: '2026-11-12T01:02:03.000Z', '审核者': '原始机构' }
    await sourceSnapshots.put('00-original.sql.gz', compressed, { httpMetadata: { contentType: 'application/gzip', contentEncoding: 'identity',
      contentLanguage: 'zh', contentDisposition: 'attachment; filename="original.sql.gz"', cacheControl: 'private, no-store',
      cacheExpiry: new Date('2026-12-01T00:00:00Z') }, customMetadata: metadata })
    for (let i = 1; i <= 5; i++) await sourceSnapshots.put(`0${i}-evidence.bin`, new Uint8Array([i, 0, 255]))
    await sourceReleases.put('release.json', '{"original":true}', { httpMetadata: { contentType: 'application/json' } })
    await sourceBackups.put('backup.sql.gz', compressed, { httpMetadata: { contentType: 'application/gzip', contentEncoding: 'identity' } })
    await targetSnapshots.put('unrelated-object', 'never overwrite or delete')
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      return new URL(request.url).origin === sourceUrl ? source.fetch(request) : target.fetch(request)
    }
    const base = { migrationId, token, source: sourceUrl, target: targetUrl, manifestPath: resolve(directory, 'manifest.json'), fetcher }

    await context.test('all routes require the dedicated token and same migration ID', async () => {
      for (const worker of [source, target]) {
        assert.equal((await worker.fetch(new Request(`${sourceUrl}/health`))).status, 403)
        assert.equal((await worker.fetch(new Request(`${sourceUrl}/health`, { headers: { ...headers, 'x-migration-id': 'wrong-migration-id' } }))).status, 403)
      }
      const health = await source.fetch(new Request(`${sourceUrl}/health`, { headers }))
      assert.equal(health.status, 200)
      assert.equal((await health.text()).includes(token), false)
      assert.equal((await source.fetch(new Request(`${sourceUrl}/v1/copy`, { method: 'POST', headers, body: '{}' }))).status, 404)
    })
    await context.test('an unfrozen source offers authenticated inventory only, never copy admission or bytes', async () => {
      const unfrozen = await mf.getWorker('migration-unfrozen-source') as unknown as NativeWorker
      assert.equal((await unfrozen.fetch(new Request(`${sourceUrl}/v1/inventory?bucket=snapshots`))).status, 403)
      let cursor: string | null = null, count = 0, size = 0
      let first: unknown
      do {
        const url = new URL('/v1/inventory', sourceUrl); url.searchParams.set('bucket', 'snapshots')
        if (cursor) url.searchParams.set('cursor', cursor)
        const response = await unfrozen.fetch(new Request(url, { headers }))
        assert.equal(response.status, 200)
        const page = await response.json() as { sourceFrozen: boolean; cutoverReady: boolean; objects: Array<{ size: number; metadataSha256: string }>; cursor: string | null }
        assert.equal(page.sourceFrozen, false); assert.equal(page.cutoverReady, false)
        assert.ok(page.objects.length <= 4)
        first ??= page.objects[0]
        count += page.objects.length; size += page.objects.reduce((sum, item) => sum + item.size, 0)
        for (const item of page.objects) assert.match(item.metadataSha256, /^[a-f0-9]{64}$/u)
        cursor = page.cursor
      } while (cursor)
      assert.equal(count, 6); assert.equal(size, compressed.byteLength + 15)
      for (const path of ['/v1/list?bucket=snapshots', '/v1/object?bucket=snapshots&key=00-original.sql.gz']) {
        const denied = await unfrozen.fetch(new Request(`${sourceUrl}${path}`, { headers }))
        assert.equal(denied.status, 409); assert.equal((await denied.json() as { error: string }).error, 'source_not_frozen')
      }
      mode.unfrozen = true
      try {
        const attempted = await target.fetch(new Request(`${targetUrl}/v1/copy`, { method: 'POST', headers,
          body: JSON.stringify({ bucket: 'snapshots', objects: [first] }) }))
        assert.equal((await attempted.json() as { results: Array<{ code: string }> }).results[0].code, 'source_response_rejected')
        assert.equal(await targetSnapshots.get('00-original.sql.gz'), null)
      } finally { mode.unfrozen = false }
    })
    await context.test('a lost response after native R2 writes preserves the pending page for idempotent retry', async () => {
      let lose = true
      const lost: typeof fetch = async (input, init) => {
        const result = await fetcher(input, init)
        if (lose && new URL(String(input)).pathname === '/v1/copy') { lose = false; throw new Error('simulated lost response') }
        return result
      }
      await assert.rejects(copyAccountR2({ ...base, fetcher: lost, maxPages: 1 }), /simulated lost response/u)
      const checkpoint = JSON.parse(readFileSync(base.manifestPath, 'utf8')).content
      assert.equal(checkpoint.buckets.snapshots.cursor, null)
      assert.equal(checkpoint.buckets.snapshots.pending.objects.length, 4)
      const partial = await copyAccountR2({ ...base, maxPages: 1 })
      assert.equal(partial.complete, false); assert.equal(partial.copiedOrVerified, 4)
      const finished = await copyAccountR2(base)
      assert.equal(finished.complete, true); assert.equal(finished.copiedOrVerified, 8)
      const original = await targetSnapshots.get('00-original.sql.gz')
      assert.ok(original)
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), compressed)
      assert.deepEqual(original.customMetadata, metadata)
      assert.equal(original.httpMetadata?.contentEncoding, 'identity')
      assert.equal(original.httpMetadata?.contentLanguage, 'zh')
      assert.equal(original.httpMetadata?.cacheExpiry?.toISOString(), '2026-12-01T00:00:00.000Z')
      assert.equal(await (await targetSnapshots.get('unrelated-object'))!.text(), 'never overwrite or delete')
      assert.equal((await sourceSnapshots.list()).objects.length, 6, 'source objects are untouched')
    })
    await context.test('a conflicting existing target is held and never overwritten on verification', async () => {
      await targetSnapshots.put('01-evidence.bin', new Uint8Array([9, 9, 9]))
      const result = await copyAccountR2({ ...base, verify: true })
      assert.equal(result.complete, false); assert.equal(result.heldOrErrors, 1)
      assert.deepEqual(new Uint8Array(await (await targetSnapshots.get('01-evidence.bin'))!.arrayBuffer()), new Uint8Array([9, 9, 9]))
      const entry = JSON.parse(readFileSync(base.manifestPath, 'utf8')).content.buckets.snapshots.objects.find((item: { key: string }) => item.key === '01-evidence.bin')
      assert.equal(entry.code, 'target_conflict_or_readback_mismatch'); assert.match(entry.sha256, /^[a-f0-9]{64}$/u)
    })
    await context.test('bounded verification cannot claim complete while later objects remain unchecked', async () => {
      const path = resolve(directory, 'bounded-verify.json')
      await copyAccountR2({ ...base, manifestPath: path })
      const first = await copyAccountR2({ ...base, manifestPath: path, verify: true, maxPages: 1 })
      assert.equal(first.verificationComplete, false); assert.equal(first.complete, false)
      const checkpoint = JSON.parse(readFileSync(path, 'utf8')).content
      assert.equal(checkpoint.buckets.snapshots.verifyOffset, 4)
      await copyAccountR2({ ...base, manifestPath: path, maxPages: 1 })
      const resumed = JSON.parse(readFileSync(path, 'utf8')).content
      assert.equal(resumed.buckets.snapshots.verifyOffset, null, 'the next bounded invocation advances beyond the first four')
    })
    await context.test('only this migration tool receipt prefix is excluded and every exclusion is recorded', async () => {
      await sourceSnapshots.put(`${receiptsPrefix(migrationId)}old-tool-receipt.json`, '{}')
      const result = await copyAccountR2({ ...base, buckets: ['snapshots'], manifestPath: resolve(directory, 'receipt-filter.json') })
      assert.equal(result.excludedToolReceipts, 1)
      assert.equal(result.copiedOrVerified, 5)
      assert.equal(result.heldOrErrors, 1, 'the previously detected real business conflict remains visible')
    })
    await context.test('manual redirects are rejected by actual workerd global fetch with no second-host request', async () => {
      mode.redirect = true
      const listed = await (await source.fetch(new Request(`${sourceUrl}/v1/list?bucket=snapshots`, { headers }))).json() as { objects: unknown[] }
      const response = await target.fetch(new Request(`${targetUrl}/v1/copy`, { method: 'POST', headers, body: JSON.stringify({ bucket: 'snapshots', objects: [listed.objects[0]] }) }))
      const value = await response.json() as { results: Array<{ code: string }> }
      assert.equal(value.results[0].code, 'source_redirect_rejected')
      assert.equal(calls.some(url => url.startsWith('https://untrusted.invalid')), false)
      mode.redirect = false
    })
    await context.test('oversized objects are explicit held entries instead of skipped pages', async () => {
      await sourceBackups.put('oversized.bin', new Uint8Array(MAX_OBJECT_BYTES + 1))
      const unfrozen = await mf.getWorker('migration-unfrozen-source') as unknown as NativeWorker
      const inventory = await (await unfrozen.fetch(new Request(`${sourceUrl}/v1/inventory?bucket=backups`, { headers }))).json() as {
        sourceFrozen: boolean; cutoverReady: boolean; objects: Array<{ key: string; size: number }>
      }
      assert.equal(inventory.sourceFrozen, false); assert.equal(inventory.cutoverReady, false)
      assert.equal(inventory.objects.find(item => item.key === 'oversized.bin')?.size, MAX_OBJECT_BYTES + 1)
      const path = resolve(directory, 'large-manifest.json')
      const result = await copyAccountR2({ ...base, buckets: ['backups'], manifestPath: path })
      assert.equal(result.complete, false); assert.equal(result.heldOrErrors, 1)
      const held = JSON.parse(readFileSync(path, 'utf8')).content.buckets.backups.objects.find((item: { key: string }) => item.key === 'oversized.bin')
      assert.equal(held.code, 'object_requires_large_transfer'); assert.equal(held.sha256, null)
      assert.equal(await (await mf.getR2Bucket('BACKUPS_BUCKET', 'migration-target') as unknown as NativeBucket).get('oversized.bin'), null)
    })
    await context.test('batch limits, arbitrary source fields and migration manifest tampering fail closed', async () => {
      const listed = await (await source.fetch(new Request(`${sourceUrl}/v1/list?bucket=releases`, { headers }))).json() as { objects: unknown[] }
      for (const body of [{ bucket: 'releases', objects: Array(5).fill(listed.objects[0]) }, { bucket: 'releases', objects: listed.objects, sourceUrl: 'https://untrusted.invalid' }]) {
        assert.equal((await target.fetch(new Request(`${targetUrl}/v1/copy`, { method: 'POST', headers, body: JSON.stringify(body) }))).status, 400)
      }
      await assert.rejects(copyAccountR2({ ...base, migrationId: 'another-migration-id' }), /manifest_binding_invalid/u)
    })
    await context.test('source metadata changes and corrupt target receipts cannot authorize success', async () => {
      const listed = await (await source.fetch(new Request(`${sourceUrl}/v1/list?bucket=releases`, { headers }))).json() as { objects: unknown[] }
      await sourceReleases.put('release.json', '{"original":true}', { httpMetadata: { contentType: 'application/json' }, customMetadata: { changed: 'after-list' } })
      const changed = await target.fetch(new Request(`${targetUrl}/v1/copy`, { method: 'POST', headers,
        body: JSON.stringify({ bucket: 'releases', objects: listed.objects }) }))
      assert.equal((await changed.json() as { results: Array<{ code: string }> }).results[0].code, 'source_changed_since_listing')
      const entry = JSON.parse(readFileSync(base.manifestPath, 'utf8')).content.buckets.snapshots.objects.find((item: { key: string }) => item.key === '00-original.sql.gz')
      await targetSnapshots.put(entry.receiptKey, 'corrupt-private-test-receipt')
      const { key, size, metadata, metadataSha256 } = entry
      const receipt = await target.fetch(new Request(`${targetUrl}/v1/copy`, { method: 'POST', headers,
        body: JSON.stringify({ bucket: 'snapshots', objects: [{ key, size, metadata, metadataSha256 }] }) }))
      assert.equal((await receipt.json() as { results: Array<{ code: string }> }).results[0].code, 'copy_receipt_unconfirmed')
      assert.deepEqual(Buffer.from(await (await targetSnapshots.get(key))!.arrayBuffer()), compressed)
    })
    await context.test('metadata limit accepts only strict integers1..64 on list and inventory', async () => {
      for (const path of ['/v1/list', '/v1/inventory']) for (const limit of ['', '0', '65', '-1', '4.0', '1e1', '04', '+4', ' 4', '4&limit=8']) {
        const query = limit === '4&limit=8' ? limit : encodeURIComponent(limit)
        const response = await source.fetch(new Request(`${sourceUrl}${path}?bucket=snapshots&limit=${query}`, { headers }))
        assert.equal(response.status, 400, `invalid list limit ${JSON.stringify(limit)}`)
      }
    })
    await context.test('native metadata limit64 paginates all keys while the unchanged default remains4', async () => {
      for (let i = 0; i < 70; i++) await sourceSnapshots.put(`zz-pagination-${String(i).padStart(3, '0')}`, 'metadata-only')
      const expected = (await sourceSnapshots.list()).objects.filter(item => !item.key.startsWith(receiptsPrefix(migrationId))).map(item => item.key)
      for (const path of ['/v1/list', '/v1/inventory']) {
        const keys: string[] = []; let cursor: string | null = null, pages = 0
        do {
          const url = new URL(path, sourceUrl); url.searchParams.set('bucket', 'snapshots'); url.searchParams.set('limit', '64')
          if (cursor) url.searchParams.set('cursor', cursor)
          const response = await source.fetch(new Request(url, { headers })); assert.equal(response.status, 200)
          const page = await response.json() as { objects: Array<{ key: string }>; cursor: string | null; truncated: boolean }
          assert.ok(page.objects.length <= 64); keys.push(...page.objects.map(item => item.key)); cursor = page.cursor; pages++
          assert.equal(page.truncated, cursor !== null)
        } while (cursor)
        assert.equal(pages, 2); assert.deepEqual(keys, expected)
        const normal = await (await source.fetch(new Request(`${sourceUrl}${path}?bucket=snapshots`, { headers }))).json() as { objects: unknown[] }
        assert.equal(normal.objects.length, 4)
      }
    })
  } finally {
    await mf.dispose()
    const base = resolve('.tmp') + sep
    assert.equal(directory.startsWith(base), true)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('oversized metadata listing returns an explicit error instead of truncating descriptors', async () => {
  let byteReads = 0
  const bucket: MigrationBucket = {
    async list(options) { assert.equal(options.limit, 64); return { objects: [{ key: 'large-metadata', size: 1, customMetadata: { value: 'x'.repeat(1024 * 1024) } }], truncated: false } },
    async get() { byteReads++; throw new Error('unexpected_object_read') },
    async put() { throw new Error('unexpected_write') },
  }
  const env: MigrationEnv = { MIGRATION_ROLE: 'source', MIGRATION_ID: migrationId, MIGRATION_TRANSFER_TOKEN: token, SOURCE_FROZEN: 'true', SNAPSHOTS_BUCKET: bucket, RELEASES_BUCKET: bucket, BACKUPS_BUCKET: bucket }
  const response = await handleFetch(new Request(`${sourceUrl}/v1/list?bucket=snapshots&limit=64`, { headers }), env)
  assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: 'listing_metadata_too_large' }); assert.equal(byteReads, 0)
})
