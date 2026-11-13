// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { transferModelState, type ModelStateRelayOptions } from '../../scripts/cloudflare/transfer-model-state'
import { canonicalJson } from '../../scripts/maintenance/contracts'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load(value: string): unknown }
// This filesystem/HTTP suite uses native Node globals; the repository's shared
// cleanup hook only needs this single DOM capability.
vi.stubGlobal('window', { localStorage: { clear() {} } })
afterAll(() => vi.unstubAllGlobals())

const migrationId = 'relay-test-migration-2026', sourceAccountId = '1'.repeat(32), targetAccountId = '2'.repeat(32)
const sourceHost = 'studyinchina-catalog-maintenance.source-test.workers.dev', targetHost = 'studyinchina-catalog-maintenance.target-test.workers.dev'
const sourceToken = 'source-test-token-PRIVATE-never-log', targetToken = 'target-test-token-PRIVATE-never-log', rawCanary = 'RAW-PRIVATE-MODEL-OUTPUT-never-artifact'
const binding = { migrationId, sourceAccountId, targetAccountId }
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')
type Row = { key: string; value: Record<string, unknown> }
function snapshot(count = 40, large = false, extraEntries: Row[] = [], opaque = false) {
  const entries: Row[] = [...extraEntries, ...Array.from({ length: count }, (_, i) => ({ key: `request:${i.toString(16).padStart(64, '0')}`, value: {
    state: i % 2 ? 'completed' : 'unknown', attemptId: `paid-attempt-${i}`, requestSha256: 'a'.repeat(64),
    ...(opaque ? { retainedField: rawCanary } : {}),
    ...(i % 2 ? { result: { attemptId: `paid-attempt-${i}`, output: { privateResult: large ? '\\'.repeat(120000) : rawCanary },
      artifactKey: 'maintenance/models/private-test.json', artifactSha256: 'b'.repeat(64), reused: false } } : {}) } }))
  ].sort((a, b) => a.key.localeCompare(b.key))
  const pages: Array<{ pageBytes: string; pageSha256: string; pageIndex: number }> = [], refs: unknown[] = []
  for (let index = 0; index < Math.max(1, Math.ceil(entries.length / 32)); index++) {
    const pageEntries = entries.slice(index * 32, (index + 1) * 32)
    const pageBytes = canonicalJson({ format: 'studyinchina.model-state-page', version: 1, ...binding, index, entries: pageEntries })
    pages.push({ pageBytes, pageSha256: hash(pageBytes), pageIndex: index })
    refs.push({ index, sha256: hash(pageBytes), byteLength: Buffer.byteLength(pageBytes), entryCount: pageEntries.length,
      firstKey: pageEntries[0]?.key ?? null, lastKey: pageEntries.at(-1)?.key ?? null, startAfter: index ? entries[index * 32 - 1].key : null })
  }
  const states = { send_started: 0, completed: Math.floor(count / 2), unknown: Math.ceil(count / 2), known_failed: 0 }
  const auxiliaryEntryCount = extraEntries.filter(entry => entry.key !== 'gate').length
  const manifest = { format: 'studyinchina.model-state-manifest', version: 1, ...binding, frozenAt: '2026-11-13T00:00:00.000Z',
    pages: refs, entryCount: entries.length, requestCount: count, gatePresent: extraEntries.some(entry => entry.key === 'gate'), states,
    ...(auxiliaryEntryCount ? { auxiliaryEntryCount } : {}) }
  return { entries, pages, manifest, manifestSha256: hash(manifest), states }
}
type Hook = (url: string, body: Record<string, unknown>, normal: Record<string, unknown>) => Response | void | Promise<Response | void>
function peers(data = snapshot(), hook?: Hook) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
  const imported = new Map<number, string>()
  let finalized = false
  const auxiliaryImported = () => [...imported.values()].flatMap(bytes => (JSON.parse(bytes) as { entries: Row[] }).entries).filter(entry => entry.key.startsWith('offline-')).length
  const receipt = () => ({ ok: true, ...binding, role: 'target', state: finalized ? 'finalized' : 'importing',
    pageCount: data.pages.length, importedPages: imported.size, entryCount: data.manifest.entryCount, requestCount: data.manifest.requestCount,
    states: data.states, manifestSha256: data.manifestSha256, finalizedAt: finalized ? '2026-11-14T00:00:00.000Z' : null,
    ...(auxiliaryImported() ? { auxiliaryEntryCount: auxiliaryImported() } : {}) })
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url, init: init ?? {}, body })
    let normal: Record<string, unknown>
    if (url === `https://${sourceHost}/model-state-migration/freeze`) normal = { ok: true, ...binding, role: 'source', frozen: true, state: 'exported', manifestSha256: data.manifestSha256 }
    else if (url === `https://${sourceHost}/model-state-migration/export`) {
      const index = body.pageIndex as number
      normal = { ok: true, state: 'exported', ...data.pages[index], nextPageIndex: index + 1 < data.pages.length ? index + 1 : null,
        manifest: data.manifest, manifestSha256: data.manifestSha256 }
    } else if (url === `https://${targetHost}/model-state-migration/import`) {
      const page = JSON.parse(String(body.pageBytes)) as { index: number }
      const old = imported.get(page.index)
      if (old !== undefined && old !== body.pageBytes) return Response.json({ error: 'conflict' }, { status: 409 })
      imported.set(page.index, String(body.pageBytes)); normal = { ...receipt(), reused: old !== undefined }
    } else if (url === `https://${targetHost}/model-state-migration/finalize`) { finalized = true; normal = receipt() }
    else throw new Error(`FORBIDDEN-ENDPOINT ${rawCanary} ${sourceToken} ${targetToken}`)
    return await hook?.(url, body, normal) ?? Response.json(normal)
  }
  return { fetcher, calls, imported }
}
async function local(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'relay-unit-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}
function options(runnerTemp: string, fetcher: typeof fetch): ModelStateRelayOptions {
  return { ...binding, sourceHost, targetHost, sourceUrl: `https://${sourceHost}`, targetUrl: `https://${targetHost}`,
    sourceToken, targetToken, runnerTemp, fetcher }
}

describe('private frozen model-state relay', () => {
  it('validates all pages before target writes, uses separate auth and private temporary files, and reports only redacted counts/hash', async () => local(async directory => {
    const data = snapshot(), observedPrivate: string[] = []
    const peer = peers(data, async (url, _body, normal) => {
      const folders = await readdir(directory)
      if (url.endsWith('/import')) {
        expect(folders).toHaveLength(1)
        const path = join(directory, folders[0]), files = await readdir(path)
        expect(files.sort()).toEqual(['manifest.json', 'page-0000.json', 'page-0001.json'])
        observedPrivate.push(...files)
        if (process.platform !== 'win32') {
          expect((await stat(path)).mode & 0o777).toBe(0o700)
          for (const file of files) expect((await stat(join(path, file))).mode & 0o777).toBe(0o600)
        }
      }
      return Response.json(normal)
    })
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'finalized', code: null, sourceFrozen: true, targetFinalized: true, pageCount: 2, entryCount: 40,
      requestCount: 40, states: data.states, manifestSha256: data.manifestSha256, modelCallsPerformed: false, controlsChanged: false })
    expect(Object.hasOwn(report, 'auxiliaryEntryCount')).toBe(false)
    expect(peer.calls.map(c => new URL(c.url).pathname)).toEqual(['/model-state-migration/freeze', '/model-state-migration/export', '/model-state-migration/export',
      '/model-state-migration/import', '/model-state-migration/import', '/model-state-migration/finalize'])
    for (const call of peer.calls) {
      expect(call.init.redirect).toBe('manual'); expect(call.init.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${call.url.includes('.source-test.') ? sourceToken : targetToken}`)
    }
    expect(observedPrivate).not.toHaveLength(0); expect(await readdir(directory)).toEqual([])
    const serialized = JSON.stringify(report)
    for (const privateValue of [rawCanary, sourceToken, targetToken, sourceAccountId, targetAccountId, sourceHost, targetHost]) expect(serialized.includes(privateValue)).toBe(false)
  }))

  function legacyEntries(): Row[] {
    const batchId = 'offline-legacy-relay-test', fence = { batchId, phase: 'held_for_handoff', tokenSha256: 'b'.repeat(64), scopeRegistrySha256: 'c'.repeat(64),
      inputCatalogSha256: 'd'.repeat(64), acquiredAt: '2026-11-01T00:00:00.000Z', manifestSha256: 'e'.repeat(64), releaseRequestedAt: '2026-11-02T00:00:00.000Z',
      epoch: 1, retiredManifests: ['f'.repeat(64)], sourceManifestHistory: ['1'.repeat(64)], rowsStarted: false }
    const key = '0'.repeat(64)
    return [{ key: 'gate', value: { fetches: [], models: [], nextHost: {}, successes: 0, cooldownUntil: 0, modelLimit: 2, offlineFence: fence } },
      { key: `offline-adoption:${batchId}`, value: { [`request:${key}`]: { reservationKey: key, state: 'unknown', attemptId: 'paid-attempt-0', requestSha256: 'a'.repeat(64) } } },
      { key: `offline-fence:${batchId}`, value: fence }]
  }

  it('preserves known legacy fence/adoption bytes across pages and reruns without counting auxiliary state as model successes', async () => local(async directory => {
    const data = snapshot(40, false, legacyEntries()), peer = peers(data)
    const first = await transferModelState(options(directory, peer.fetcher)), second = await transferModelState(options(directory, peer.fetcher))
    for (const report of [first, second]) expect(report).toMatchObject({ state: 'finalized', code: null, entryCount: 43, requestCount: 40,
      auxiliaryEntryCount: 2, states: { completed: 20, unknown: 20, send_started: 0, known_failed: 0 }, modelCallsPerformed: false, controlsChanged: false })
    const imported = [...peer.imported.values()].flatMap(bytes => (JSON.parse(bytes) as { entries: Row[] }).entries)
    expect(imported).toEqual(data.entries)
    expect(peer.calls.every(call => /\/model-state-migration\/(?:freeze|export|import|finalize)$/.test(call.url))).toBe(true)
    for (const report of [first, second]) expect(JSON.stringify(report)).not.toContain('offline-legacy-relay-test')
    expect(await readdir(directory)).toEqual([])
  }))

  it('refuses malformed known auxiliary values, unknown storage prefixes and malformed legacy gate fields before import', async () => local(async directory => {
    const cases = [
      [{ key: 'offline-fence:offline-legacy-relay-test', value: { ...legacyEntries()[2].value, phase: 'silently-released' } }],
      [{ key: 'offline-adoption:offline-legacy-relay-test', value: { [`request:${'0'.repeat(64)}`]: { reservationKey: '0'.repeat(64), state: 'success', attemptId: 'paid-attempt-0', requestSha256: 'a'.repeat(64) } } }],
      [{ key: 'offline-unknown:offline-legacy-relay-test', value: { state: 'completed' } }],
      [{ key: 'unrecognized-history', value: { state: 'completed', attemptId: 'old', requestSha256: 'a'.repeat(64) } }],
      [{ key: 'gate', value: { fetches: [], models: [], offlineFence: { ...legacyEntries()[2].value, tokenSha256: rawCanary } } }],
    ]
    for (const extra of cases) {
      const peer = peers(snapshot(1, false, extra)), report = await transferModelState(options(directory, peer.fetcher))
      expect(report).toMatchObject({ state: 'failed', code: 'source_page_invalid', targetFinalized: false })
      expect(peer.imported.size).toBe(0); expect(JSON.stringify(report)).not.toContain(rawCanary)
    }
  }))

  it('retains ordinary opaque request fields under the existing default migration contract', async () => local(async directory => {
    const data = snapshot(2, false, [], true), peer = peers(data), report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'finalized', requestCount: 2, states: { completed: 1, unknown: 1, send_started: 0, known_failed: 0 } })
    expect([...peer.imported.values()].flatMap(bytes => (JSON.parse(bytes) as { entries: Row[] }).entries)).toEqual(data.entries)
    expect(Object.hasOwn(report, 'auxiliaryEntryCount')).toBe(false); expect(JSON.stringify(report)).not.toContain(rawCanary)
  }))

  it('reports only fixed legacy-schema refusal codes from a source and never its private state', async () => local(async directory => {
    const peer = peers(snapshot(), (url) => url.endsWith('/freeze') ? Response.json({ ok: false, error: 'model_state_migration_legacy_state_invalid', rawState: rawCanary }, { status: 409 }) : undefined)
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'failed', code: 'source_freeze_rejected', upstreamErrorCode: 'model_state_migration_legacy_state_invalid', targetFinalized: false })
    expect(peer.imported.size).toBe(0); expect(JSON.stringify(report)).not.toContain(rawCanary)
  }))

  it('requires exact auxiliary manifest counts including strict missing versus null types', async () => local(async directory => {
    for (const count of [undefined, null, '2', -1, 1, 3]) {
      const peer = peers(snapshot(40, false, legacyEntries()), (url, _body, normal) => {
        if (url.endsWith('/freeze')) return Response.json({ ...normal, manifestSha256: null })
        if (url.endsWith('/export')) {
          const manifest = { ...(normal.manifest as Record<string, unknown>), auxiliaryEntryCount: count }
          if (count === undefined) delete manifest.auxiliaryEntryCount
          return Response.json({ ...normal, manifest, manifestSha256: hash(manifest) })
        }
      })
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(report).toMatchObject({ state: 'failed', code: 'source_manifest_invalid', targetFinalized: false })
      expect(peer.imported.size).toBe(0)
    }
  }))

  it('requires target import and final receipts to acknowledge every auxiliary entry exactly', async () => local(async directory => {
    for (const phase of ['/import', '/finalize']) for (const count of [undefined, null, 0, 1, 3]) {
      const peer = peers(snapshot(40, false, legacyEntries()), (url, _body, normal) => url.endsWith(phase) ? Response.json({ ...normal, auxiliaryEntryCount: count }) : undefined)
      expect((await transferModelState(options(directory, peer.fetcher))).code).toBe('target_receipt_invalid')
    }
  }))

  it('does not mistake an inflight409 for permission to reset, import or unlock', async () => local(async directory => {
    const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/freeze') ? Response.json({ ...normal, state: 'frozen', manifestSha256: null, error: 'model_state_migration_inflight' }, { status: 409 }) : undefined)
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'waiting', code: 'source_inflight', sourceFrozen: true, targetFinalized: false, pageCount: null, requestCount: null, states: null })
    expect(peer.calls).toHaveLength(1); expect(await readdir(directory)).toEqual([])
    expect(report.sourceDiagnostics).toBeNull()
  }))

  it('retains only validated source-clock diagnostics in the redacted inflight report', async () => local(async directory => {
    const observed = { activeOperations: 0, serverTime: '2026-11-14T17:30:00.000Z', activeFetchPermitCount: 1,
      activeModelPermitCount: 0, latestPermitExpiresAt: '2026-11-15T17:30:00.000Z' }
    const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/freeze') ? Response.json({ ...normal, ...observed,
      state: 'frozen', manifestSha256: null, error: 'model_state_migration_inflight', gate: rawCanary, token: sourceToken,
      host: sourceHost, requestKey: 'request:PRIVATE-DO-KEY' }, { status: 409 }) : undefined)
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'waiting', code: 'source_inflight', sourceFrozen: true, sourceDiagnostics: observed })
    expect(Object.keys(report.sourceDiagnostics!).sort()).toEqual(Object.keys(observed).sort())
    for (const privateValue of [rawCanary, sourceToken, sourceHost, sourceAccountId, 'PRIVATE-DO-KEY']) expect(JSON.stringify(report)).not.toContain(privateValue)
    expect(peer.calls).toHaveLength(1); expect(await readdir(directory)).toEqual([])
  }))

  it('refuses partial, numeric-date or malformed diagnostics without target writes or raw output', async () => local(async directory => {
    const observed = { activeOperations: 1, serverTime: '2026-11-14T17:30:00.000Z', activeFetchPermitCount: 0,
      activeModelPermitCount: 0, latestPermitExpiresAt: null }
    for (const malformed of [{ activeOperations: 1 }, { gateSha256: 'a'.repeat(64) }, { ...observed, serverTime: 1794677400000 }, { ...observed, latestPermitExpiresAt: 1794677400000 },
      { ...observed, activeOperations: -1 }, { ...observed, activeModelPermitCount: '0' }, { ...observed, serverTime: rawCanary }, { ...observed, latestPermitExpiresAt: sourceToken }]) {
      const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/freeze') ? Response.json({ ...normal, ...malformed,
        state: 'frozen', error: 'model_state_migration_inflight' }, { status: 409 }) : undefined)
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(report).toMatchObject({ state: 'failed', code: 'source_diagnostics_invalid', sourceDiagnostics: null, targetFinalized: false })
      expect(peer.calls).toHaveLength(1); expect(JSON.stringify(report)).not.toContain(rawCanary); expect(JSON.stringify(report)).not.toContain(sourceToken)
    }
  }))

  it('preserves finite unrepresentable expiry observations without unlocking or copying private gate state', async () => local(async directory => {
    const observed = { activeOperations: 0, serverTime: '2026-11-14T17:30:00.000Z', activeFetchPermitCount: 1, activeModelPermitCount: 0,
      latestPermitExpiresAt: null, unrepresentablePermitExpiryCount: 1, maxPermitExpiryMilliseconds: Number.MAX_VALUE, gateSha256: 'a'.repeat(64) }
    const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/freeze') ? Response.json({ ...normal, ...observed,
      state: 'frozen', error: 'model_state_migration_inflight' }, { status: 409 }) : undefined)
    expect(await transferModelState(options(directory, peer.fetcher))).toMatchObject({ state: 'waiting', code: 'source_inflight',
      sourceDiagnostics: observed, upstreamErrorCode: 'model_state_migration_inflight', targetFinalized: false })
    expect(peer.calls).toHaveLength(1); expect(peer.imported.size).toBe(0)
    for (const malformed of [{ ...observed, maxPermitExpiryMilliseconds: undefined }, { ...observed, gateSha256: sourceToken },
      { ...observed, maxPermitExpiryMilliseconds: -1 }, { ...observed, maxPermitExpiryMilliseconds: Infinity },
      { ...observed, unrepresentablePermitExpiryCount: -1 }, { ...observed, unrepresentablePermitExpiryCount: 0 },
      { ...observed, latestPermitExpiresAt: '2026-11-15T17:30:00.000Z' }]) {
      const rejected = peers(snapshot(), (url, _body, normal) => url.endsWith('/freeze') ? Response.json({ ...normal, ...malformed,
        state: 'frozen', error: 'model_state_migration_inflight' }, { status: 409 }) : undefined)
      expect(await transferModelState(options(directory, rejected.fetcher))).toMatchObject({ state: 'failed', code: 'source_diagnostics_invalid', sourceDiagnostics: null })
      expect(rejected.calls).toHaveLength(1)
    }
  }))

  it('keeps only a fixed allowlisted upstream failure before binding validation and never treats that error as a freeze proof', async () => local(async directory => {
    for (const error of ['model_state_migration_gate_invalid', 'model_state_migration_lock_invalid', sourceToken, rawCanary]) {
      const peer = peers(snapshot(), url => url.endsWith('/freeze') ? Response.json({ ok: false, error, stack: rawCanary, token: sourceToken }, { status: 409 }) : undefined)
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(report).toMatchObject({ state: 'failed', code: 'source_freeze_rejected', sourceFrozen: false, targetFinalized: false, sourceDiagnostics: null,
        upstreamErrorCode: error.startsWith('model_state_migration_') ? error : null })
      expect(peer.calls).toHaveLength(1); expect(peer.imported.size).toBe(0)
      expect(JSON.stringify(report)).not.toContain(sourceToken); expect(JSON.stringify(report)).not.toContain(rawCanary)
    }
  }))

  it('accepts a fresh source whose complete manifest is first available on the last page', async () => local(async directory => {
    const peer = peers(snapshot(), (url, body, normal) => {
      if (url.endsWith('/freeze')) return Response.json({ ...normal, state: 'frozen', manifestSha256: null })
      if (url.endsWith('/export') && body.pageIndex === 0) return Response.json({ ...normal, state: 'exporting', manifest: null, manifestSha256: null })
    })
    expect((await transferModelState(options(directory, peer.fetcher))).state).toBe('finalized')
    expect(peer.imported.size).toBe(2)
  }))

  it('applies a bounded timeout to the authenticated call and emits a fixed transport failure', async () => local(async directory => {
    let calls = 0
    const fetcher: typeof fetch = async (_url, init) => {
      calls++
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error(`${sourceToken} timeout`)), { once: true }))
    }
    const report = await transferModelState({ ...options(directory, fetcher), timeoutMs: 1 })
    expect(report.code).toBe('transport_unavailable'); expect(calls).toBe(1)
    expect(JSON.stringify(report)).not.toContain(sourceToken); expect(await readdir(directory)).toEqual([])
  }))

  for (const sourceUrl of [
    `https://${sourceHost}:443`, `https://${sourceHost}:8443`, `https://user@${sourceHost}`, `https://${sourceHost}?next=x`,
    `https://${sourceHost}#x`, `https://${sourceHost}/arbitrary`, `http://${sourceHost}`, 'https://unrelated.example.com',
  ]) it(`rejects an unpinned or non-origin source URL before sending credentials: ${sourceUrl}`, async () => local(async directory => {
    const peer = peers(), report = await transferModelState({ ...options(directory, peer.fetcher), sourceUrl })
    expect(report.code).toBe('configuration_invalid'); expect(peer.calls).toHaveLength(0); expect(await readdir(directory)).toEqual([])
  }))

  it('requires exact valid host pins for both sides and distinct origins', async () => local(async directory => {
    for (const patch of [{ sourceHost: targetHost }, { targetHost: 'evil.example.com' }, { targetUrl: `https://${sourceHost}`, targetHost: sourceHost }, { targetHost: targetHost.toUpperCase() }]) {
      const peer = peers(), report = await transferModelState({ ...options(directory, peer.fetcher), ...patch })
      expect(report.code).toBe('configuration_invalid'); expect(peer.calls).toHaveLength(0)
    }
  }))

  for (const status of [301, 302, 303, 307, 308]) it(`rejects HTTP${status} without following or reading the destination`, async () => local(async directory => {
    const peer = peers(snapshot(), () => new Response(`${sourceToken} ${rawCanary}`, { status, headers: { location: 'https://credential-recipient.invalid/' } }))
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report.code).toBe('redirect_rejected'); expect(peer.calls).toHaveLength(1)
    expect(JSON.stringify(report)).not.toContain(sourceToken)
  }))

  it('rejects response URL drift and a silently followed redirect', async () => local(async directory => {
    for (const field of ['url', 'redirected']) {
      const peer = peers(snapshot(), (_url, _body, normal) => {
        const response = Response.json(normal)
        Object.defineProperty(response, field, { value: field === 'url' ? 'https://unexpected.example.com/' : true })
        return response
      })
      expect((await transferModelState(options(directory, peer.fetcher))).code).toBe('redirect_rejected')
      expect(peer.calls).toHaveLength(1)
    }
  }))

  it('rejects changed page bytes/hash, source bindings or manifest before importing any target state', async () => local(async directory => {
    const changes: Array<(normal: Record<string, unknown>) => Record<string, unknown>> = [
      normal => ({ ...normal, pageSha256: 'f'.repeat(64) }),
      normal => { const page = JSON.parse(String(normal.pageBytes)); page.targetAccountId = '3'.repeat(32); const pageBytes = canonicalJson(page); return { ...normal, pageBytes, pageSha256: hash(pageBytes) } },
      normal => { const manifest = structuredClone(normal.manifest) as { entryCount: number }; manifest.entryCount++; return { ...normal, manifest, manifestSha256: hash(manifest) } },
      normal => ({ ...normal, manifest: null, manifestSha256: null }),
    ]
    for (const change of changes) {
      const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/export') ? Response.json(change(normal)) : undefined)
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(report.state).toBe('failed'); expect(report.targetFinalized).toBe(false)
      expect(peer.calls.some(c => c.url.includes('.target-test.'))).toBe(false); expect(await readdir(directory)).toEqual([])
    }
  }))

  it('does not trust a self-consistent manifest with missing pages or false totals', async () => local(async directory => {
    for (const field of ['pages', 'requestCount', 'states']) {
      const data = snapshot(1), changed = structuredClone(data.manifest)
      if (field === 'pages') changed.pages = []
      if (field === 'requestCount') changed.requestCount++
      if (field === 'states') changed.states.unknown++
      const peer = peers({ ...data, manifest: changed, manifestSha256: hash(changed) })
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(report.code).toBe('source_manifest_invalid'); expect(peer.imported.size).toBe(0)
    }
  }))

  it('rejects missing/nonsequential continuation instead of skipping or looping', async () => local(async directory => {
    const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/export') ? Response.json({ ...normal, nextPageIndex: 0 }) : undefined)
    expect((await transferModelState(options(directory, peer.fetcher))).code).toBe('source_page_invalid')
    expect(peer.calls).toHaveLength(2); expect(peer.imported.size).toBe(0)
  }))

  it('restarts from frozen page zero after a lost import reply and finishes exact idempotent target state', async () => local(async directory => {
    let lost = true
    const peer = peers(snapshot(), url => {
      if (url.endsWith('/import') && lost) { lost = false; throw new Error(`${sourceToken} ${targetToken} ${rawCanary}`) }
    })
    const first = await transferModelState(options(directory, peer.fetcher))
    expect(first.code).toBe('transport_unavailable'); expect(peer.imported.size).toBe(1); expect(await readdir(directory)).toEqual([])
    const second = await transferModelState(options(directory, peer.fetcher))
    expect(second.state).toBe('finalized'); expect(peer.imported.size).toBe(2)
    expect(peer.calls.filter(c => c.url.endsWith('/export')).map(c => c.body.pageIndex)).toEqual([0, 1, 0, 1])
    expect(peer.calls.every(c => /\/model-state-migration\/(?:freeze|export|import|finalize)$/.test(c.url))).toBe(true)
    expect(JSON.stringify([first, second])).not.toContain(rawCanary)
  }))

  it('carries a heavily escaped legal page beyond4MiB inside the bounded12MiB target request', async () => local(async directory => {
    const peer = peers(snapshot(32, true)), report = await transferModelState(options(directory, peer.fetcher))
    expect(report.state).toBe('finalized')
    const requestBytes = Buffer.byteLength(String(peer.calls.find(c => c.url.endsWith('/import'))!.init.body))
    expect(requestBytes).toBeGreaterThan(4 * 1024 * 1024); expect(requestBytes).toBeLessThan(12 * 1024 * 1024)
    expect(await readdir(directory)).toEqual([])
  }))

  it('bounds source responses, fails authentication honestly and never logs error bodies', async () => local(async directory => {
    for (const response of [new Response(sourceToken, { status: 401 }), Response.json({ untrusted: 'x'.repeat(12 * 1024 * 1024) })]) {
      const peer = peers(snapshot(), () => response)
      const report = await transferModelState(options(directory, peer.fetcher))
      expect(['authentication_failed', 'response_too_large']).toContain(report.code)
      expect(peer.calls).toHaveLength(1); expect(JSON.stringify(report)).not.toContain(sourceToken)
    }
  }))

  it('refuses a target final receipt with false state/counts instead of declaring completion', async () => local(async directory => {
    const peer = peers(snapshot(), (url, _body, normal) => url.endsWith('/finalize') ? Response.json({ ...normal, requestCount: 0 }) : undefined)
    const report = await transferModelState(options(directory, peer.fetcher))
    expect(report).toMatchObject({ state: 'failed', code: 'target_receipt_invalid', targetFinalized: false, modelCallsPerformed: false })
  }))
})

it('manual workflow has only a migration ID input, current-main and shared writer guards, and uploads one redacted report', () => {
  type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }
  const workflow = yaml.load(readFileSync(resolve('.github/workflows/cloudflare-model-state-migration.yml'), 'utf8')) as {
    on: { workflow_dispatch: { inputs: Record<string, unknown> } }; permissions: Record<string, string>; concurrency: unknown; jobs: { transfer: { if: string; steps: Step[] } }
  }
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['migration_id'])
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(workflow.concurrency).toEqual({ group: 'autonomous-catalog-maintenance-${{ github.repository }}', 'cancel-in-progress': false })
  expect(workflow.jobs.transfer.if).toContain("github.ref == 'refs/heads/main'")
  const steps = workflow.jobs.transfer.steps, main = steps.find(s => s.name === 'Require the current main commit')!
  expect(main.run).toContain('git/ref/heads/main'); expect(main.run).toContain('"$current_main" != "$GITHUB_SHA"')
  expect(steps.find(s => s.uses?.startsWith('actions/checkout@'))?.with).toEqual({ ref: '${{ github.sha }}', 'persist-credentials': false })
  const relay = steps.find(s => s.run?.includes('transfer-model-state.ts'))!
  expect(relay.run).not.toContain('${{ inputs.'); expect(relay.env?.MIGRATION_ID).toBe('${{ inputs.migration_id }}')
  expect(relay.env?.CATALOG_MAINTENANCE_TOKEN).toBe('${{ secrets.CATALOG_MAINTENANCE_TOKEN }}')
  expect(relay.env?.CATALOG_MIGRATION_TARGET_TOKEN).toBe('${{ secrets.CATALOG_MIGRATION_TARGET_TOKEN }}')
  const uploads = steps.filter(s => s.uses?.startsWith('actions/upload-artifact@'))
  expect(uploads).toHaveLength(1); expect(uploads[0].with?.path).toBe('${{ runner.temp }}/model-state-migration-report.json')
  expect(String(uploads[0].with?.path)).not.toContain('*')
})
