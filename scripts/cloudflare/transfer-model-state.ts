import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson } from '../maintenance/contracts'
import type { ModelStateManifest } from '../../workers/catalog-maintenance/src/model-state-migration'

const MAX_BODY = 12 * 1024 * 1024, MAX_PAGE = 4 * 1024 * 1024, MAX_PAGES = 4096
const PRIVATE_PREFIX = 'catalog-model-state-private-'
const STATES = ['send_started', 'completed', 'unknown', 'known_failed'] as const
const HOST = /^studyinchina-catalog-maintenance\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/
const HASH = /^[a-f0-9]{64}$/
const ACCOUNT = /^[a-f0-9]{32}$/
type Counts = Record<typeof STATES[number], number>
type Binding = { migrationId: string; sourceAccountId: string; targetAccountId: string }
type Entry = { key: string; value: unknown }
type Page = Binding & { format: 'studyinchina.model-state-page'; version: 1; index: number; entries: Entry[] }
type PageInfo = { index: number; sha256: string; byteLength: number; entryCount: number; firstKey: string | null; lastKey: string | null; startAfter: string | null }
type RelayCode = 'configuration_invalid' | 'source_inflight' | 'authentication_failed' | 'transport_unavailable'
  | 'redirect_rejected' | 'response_too_large' | 'request_too_large' | 'response_invalid'
  | 'source_freeze_rejected' | 'source_diagnostics_invalid' | 'source_export_rejected' | 'source_snapshot_changed' | 'source_manifest_missing'
  | 'source_manifest_invalid' | 'source_page_invalid' | 'source_page_limit' | 'target_import_rejected'
  | 'target_finalize_rejected' | 'target_receipt_invalid' | 'private_state_unavailable' | 'private_cleanup_failed'
export type ModelStateSourceDiagnostics = {
  activeOperations: number; serverTime: string; activeFetchPermitCount: number; activeModelPermitCount: number; latestPermitExpiresAt: string | null
}
export type ModelStateRelayReport = {
  format: 'studyinchina.model-state-migration-report'; version: 1; migrationId: string | null;
  state: 'finalized' | 'waiting' | 'failed'; code: RelayCode | null; sourceFrozen: boolean; targetFinalized: boolean;
  manifestSha256: string | null; pageCount: number | null; entryCount: number | null; requestCount: number | null; states: Counts | null;
  sourceDiagnostics: ModelStateSourceDiagnostics | null;
  modelCallsPerformed: false; controlsChanged: false
}
export type ModelStateRelayOptions = {
  migrationId: string; sourceUrl: string; targetUrl: string; sourceHost: string; targetHost: string;
  sourceToken: string; targetToken: string; runnerTemp: string; fetcher?: typeof fetch; timeoutMs?: number
}
class RelayError extends Error { constructor(readonly code: RelayCode) { super(code) } }
const fail = (code: RelayCode): never => { throw new RelayError(code) }
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const same = (a: Record<string, unknown>, b: Binding) => a.migrationId === b.migrationId && a.sourceAccountId === b.sourceAccountId && a.targetAccountId === b.targetAccountId
const zero = (): Counts => ({ send_started: 0, completed: 0, unknown: 0, known_failed: 0 })

function pinnedOrigin(value: string, pin: string) {
  // The textual check also rejects an explicit :443, which URL.port normalizes away.
  if (!HOST.test(pin) || value !== `https://${pin}` && value !== `https://${pin}/`) return fail('configuration_invalid')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== pin || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return fail('configuration_invalid')
  return url.origin
}
function peerBinding(raw: Record<string, unknown>, migrationId: string): Binding {
  if (raw.migrationId !== migrationId || typeof raw.sourceAccountId !== 'string' || !ACCOUNT.test(raw.sourceAccountId)
    || typeof raw.targetAccountId !== 'string' || !ACCOUNT.test(raw.targetAccountId) || raw.sourceAccountId === raw.targetAccountId) return fail('response_invalid')
  return { migrationId, sourceAccountId: raw.sourceAccountId, targetAccountId: raw.targetAccountId }
}
function sourceDiagnostics(raw: Record<string, unknown>): ModelStateSourceDiagnostics | null {
  const fields = ['activeOperations', 'serverTime', 'activeFetchPermitCount', 'activeModelPermitCount', 'latestPermitExpiresAt'] as const
  // Old source versions have no diagnostics. Partial or malformed observations
  // must never be presented as trustworthy zero counts or runner-local dates.
  if (fields.every(field => raw[field] === undefined)) return null
  const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  if (!integer(raw.activeOperations) || !integer(raw.activeFetchPermitCount) || !integer(raw.activeModelPermitCount) || !iso(raw.serverTime)
    || raw.latestPermitExpiresAt !== null && !iso(raw.latestPermitExpiresAt)) return fail('source_diagnostics_invalid')
  return { activeOperations: raw.activeOperations, serverTime: raw.serverTime, activeFetchPermitCount: raw.activeFetchPermitCount,
    activeModelPermitCount: raw.activeModelPermitCount, latestPermitExpiresAt: raw.latestPermitExpiresAt as string | null }
}
async function boundedJson(response: Response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return fail('response_invalid')
  const reader = response.body?.getReader()
  if (!reader) return fail('response_invalid')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break
      length += part.value.byteLength
      if (length > MAX_BODY) { await reader.cancel(); return fail('response_too_large') }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const value = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!value) return fail('response_invalid')
  return value
}
function validatePage(raw: Record<string, unknown>, expected: Binding, index: number, previous: string | null) {
  if (raw.ok !== true || raw.pageIndex !== index || !['exporting', 'exported'].includes(String(raw.state)) || typeof raw.pageBytes !== 'string'
    || bytes(raw.pageBytes) > MAX_PAGE || !HASH.test(String(raw.pageSha256)) || hash(raw.pageBytes) !== raw.pageSha256
    || raw.nextPageIndex !== null && raw.nextPageIndex !== index + 1) return fail('source_page_invalid')
  let page: Record<string, unknown> | null
  try { page = record(JSON.parse(raw.pageBytes)) } catch { return fail('source_page_invalid') }
  if (!page || canonicalJson(page) !== raw.pageBytes || !same(page, expected) || page.format !== 'studyinchina.model-state-page' || page.version !== 1 || page.index !== index
    || !Array.isArray(page.entries) || page.entries.length > 32 || page.entries.length === 0 && raw.nextPageIndex !== null) return fail('source_page_invalid')
  const states = zero(); let gatePresent = false, requestCount = 0, lastKey = previous
  for (const value of page.entries) {
    const entry = record(value), state = record(entry?.value)
    if (!entry || Object.keys(entry).length !== 2 || typeof entry.key !== 'string' || lastKey !== null && entry.key <= lastKey || !state) return fail('source_page_invalid')
    if (entry.key === 'gate') gatePresent = true
    else {
      if (!/^request:[a-f0-9]{64}$/.test(entry.key) || !STATES.includes(state.state as typeof STATES[number])
        || typeof state.attemptId !== 'string' || !state.attemptId || !HASH.test(String(state.requestSha256))) return fail('source_page_invalid')
      states[state.state as typeof STATES[number]]++; requestCount++
    }
    lastKey = entry.key
  }
  const typed = page as unknown as Page
  const info: PageInfo = { index, sha256: raw.pageSha256 as string, byteLength: bytes(raw.pageBytes), entryCount: typed.entries.length,
    firstKey: typed.entries[0]?.key ?? null, lastKey: typed.entries.at(-1)?.key ?? null, startAfter: previous }
  return { info, pageBytes: raw.pageBytes, states, requestCount, gatePresent, lastKey }
}
function validateManifest(value: unknown, sha256: unknown, expected: Binding, pages: PageInfo[], counts: { entryCount: number; requestCount: number; gatePresent: boolean; states: Counts }) {
  const raw = record(value)
  if (!raw || !HASH.test(String(sha256)) || hash(canonicalJson(raw)) !== sha256 || !same(raw, expected) || raw.format !== 'studyinchina.model-state-manifest' || raw.version !== 1
    || typeof raw.frozenAt !== 'string' || !Number.isFinite(Date.parse(raw.frozenAt)) || !Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > MAX_PAGES
    || raw.entryCount !== counts.entryCount || raw.requestCount !== counts.requestCount || raw.gatePresent !== counts.gatePresent || !record(raw.states)
    || canonicalJson(raw.states) !== canonicalJson(counts.states) || canonicalJson(raw.pages) !== canonicalJson(pages)) return fail('source_manifest_invalid')
  return raw as unknown as ModelStateManifest
}

/** No provider or business endpoint is reachable here. Each rerun re-reads the
 * source's frozen pages and lets the target verify exact idempotent imports. */
export async function transferModelState(options: ModelStateRelayOptions): Promise<ModelStateRelayReport> {
  const report: ModelStateRelayReport = { format: 'studyinchina.model-state-migration-report', version: 1, migrationId: null,
    state: 'failed', code: null, sourceFrozen: false, targetFinalized: false, manifestSha256: null, pageCount: null,
    entryCount: null, requestCount: null, states: null, sourceDiagnostics: null, modelCallsPerformed: false, controlsChanged: false }
  let privateDirectory: string | undefined, tempRoot: string | undefined
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(options.migrationId) || !isAbsolute(options.runnerTemp)
      || [options.sourceToken, options.targetToken].some(token => token.length < 24 || token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token))) return fail('configuration_invalid')
    report.migrationId = options.migrationId
    const source = pinnedOrigin(options.sourceUrl, options.sourceHost), target = pinnedOrigin(options.targetUrl, options.targetHost)
    if (source === target) return fail('configuration_invalid')
    const timeout = options.timeoutMs ?? 120000
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) return fail('configuration_invalid')
    tempRoot = resolve(options.runnerTemp)
    privateDirectory = await mkdtemp(join(tempRoot, PRIVATE_PREFIX)); await chmod(privateDirectory, 0o700)
    const fetcher = options.fetcher ?? fetch
    const request = async (base: string, path: '/freeze' | '/export' | '/import' | '/finalize', body: unknown, rejected: RelayCode) => {
      const url = `${base}/model-state-migration${path}`, text = canonicalJson(body)
      if (bytes(text) > MAX_BODY) return fail('request_too_large')
      let response: Response
      try { response = await fetcher(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeout),
        headers: { authorization: `Bearer ${base === source ? options.sourceToken : options.targetToken}`, 'content-type': 'application/json' }, body: text }) }
      catch { return fail('transport_unavailable') }
      if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== url) {
        await response.body?.cancel(); return fail('redirect_rejected')
      }
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return fail('authentication_failed') }
      if (!response.ok && !(path === '/freeze' && response.status === 409)) { await response.body?.cancel(); return fail(rejected) }
      let raw: Record<string, unknown>
      try { raw = await boundedJson(response) } catch (error) { if (error instanceof RelayError) throw error; return fail('response_invalid') }
      return { raw, status: response.status }
    }
    const freeze = await request(source, '/freeze', { migrationId: options.migrationId }, 'source_freeze_rejected')
    const binding = peerBinding(freeze.raw, options.migrationId)
    if (freeze.raw.ok !== true || freeze.raw.role !== 'source' || freeze.raw.frozen !== true || !['frozen', 'exporting', 'exported'].includes(String(freeze.raw.state))) return fail('source_freeze_rejected')
    report.sourceFrozen = true
    report.sourceDiagnostics = sourceDiagnostics(freeze.raw)
    if (freeze.status === 409) {
      if (freeze.raw.error !== 'model_state_migration_inflight') return fail('source_freeze_rejected')
      report.state = 'waiting'; return fail('source_inflight')
    }
    if (freeze.raw.error !== undefined) return fail('source_freeze_rejected')
    const pinnedManifestSha256 = freeze.raw.manifestSha256
    if (pinnedManifestSha256 !== null && !HASH.test(String(pinnedManifestSha256))) return fail('source_manifest_invalid')
    const pages: PageInfo[] = [], totals = { entryCount: 0, requestCount: 0, gatePresent: false, states: zero() }
    let lastKey: string | null = null, manifest: ModelStateManifest | undefined, manifestSha256: string | undefined
    for (let index = 0; index < MAX_PAGES; index++) {
      const response = await request(source, '/export', { migrationId: options.migrationId, pageIndex: index }, 'source_export_rejected')
      const page = validatePage(response.raw, binding, index, lastKey)
      await writeFile(join(privateDirectory, `page-${String(index).padStart(4, '0')}.json`), page.pageBytes, { mode: 0o600, flag: 'wx' })
      pages.push(page.info); totals.entryCount += page.info.entryCount; totals.requestCount += page.requestCount
      if (page.gatePresent && totals.gatePresent) return fail('source_page_invalid')
      totals.gatePresent ||= page.gatePresent
      for (const state of STATES) totals.states[state] += page.states[state]
      lastKey = page.lastKey
      if (response.raw.manifest !== null || response.raw.manifestSha256 !== null) {
        const candidate = record(response.raw.manifest), candidateHash = response.raw.manifestSha256
        if (!candidate || !HASH.test(String(candidateHash)) || hash(canonicalJson(candidate)) !== candidateHash || !same(candidate, binding)
          || pinnedManifestSha256 !== null && candidateHash !== pinnedManifestSha256 || manifestSha256 && candidateHash !== manifestSha256) return fail('source_snapshot_changed')
        manifestSha256 = candidateHash as string; manifest = candidate as unknown as ModelStateManifest
      }
      if (response.raw.nextPageIndex === null) {
        if (response.raw.state !== 'exported' || !manifest || !manifestSha256) return fail('source_manifest_missing')
        manifest = validateManifest(manifest, manifestSha256, binding, pages, totals)
        break
      }
      if (index === MAX_PAGES - 1) return fail('source_page_limit')
    }
    if (!manifest || !manifestSha256) return fail('source_manifest_missing')
    await writeFile(join(privateDirectory, 'manifest.json'), canonicalJson({ manifest, manifestSha256 }), { mode: 0o600, flag: 'wx' })
    report.manifestSha256 = manifestSha256; report.pageCount = pages.length; report.entryCount = totals.entryCount; report.requestCount = totals.requestCount; report.states = totals.states
    for (const page of pages) {
      const pageBytes = await readFile(join(privateDirectory, `page-${String(page.index).padStart(4, '0')}.json`), 'utf8')
      if (hash(pageBytes) !== page.sha256 || bytes(pageBytes) !== page.byteLength) return fail('private_state_unavailable')
      const imported = await request(target, '/import', { migrationId: options.migrationId, manifest, manifestSha256, pageBytes }, 'target_import_rejected')
      if (imported.raw.ok !== true || !same(imported.raw, binding) || imported.raw.role !== 'target' || !['importing', 'finalized'].includes(String(imported.raw.state))
        || imported.raw.manifestSha256 !== manifestSha256 || imported.raw.pageCount !== pages.length || !integer(imported.raw.importedPages) || imported.raw.importedPages < page.index + 1
        || imported.raw.importedPages > pages.length) return fail('target_receipt_invalid')
    }
    const finalized = await request(target, '/finalize', { migrationId: options.migrationId, manifestSha256 }, 'target_finalize_rejected')
    if (finalized.raw.ok !== true || !same(finalized.raw, binding) || finalized.raw.role !== 'target' || finalized.raw.state !== 'finalized'
      || finalized.raw.manifestSha256 !== manifestSha256 || finalized.raw.pageCount !== pages.length || finalized.raw.importedPages !== pages.length
      || finalized.raw.entryCount !== totals.entryCount || finalized.raw.requestCount !== totals.requestCount || canonicalJson(finalized.raw.states) !== canonicalJson(totals.states)
      || typeof finalized.raw.finalizedAt !== 'string' || !Number.isFinite(Date.parse(finalized.raw.finalizedAt))) return fail('target_receipt_invalid')
    report.targetFinalized = true; report.state = 'finalized'
  } catch (error) {
    report.code = error instanceof RelayError ? error.code : 'private_state_unavailable'
  } finally {
    if (privateDirectory) {
      try {
        // Only remove the exact directory this invocation created under RUNNER_TEMP.
        if (!tempRoot || dirname(resolve(privateDirectory)) !== tempRoot || !basename(privateDirectory).startsWith(PRIVATE_PREFIX)) fail('private_cleanup_failed')
        await rm(privateDirectory, { recursive: true, force: true })
      } catch { report.state = 'failed'; report.code = 'private_cleanup_failed' }
    }
  }
  return report
}

async function main() {
  if (process.argv.length > 2) return fail('configuration_invalid')
  const options: ModelStateRelayOptions = { migrationId: process.env.MIGRATION_ID ?? '',
    sourceUrl: process.env.CATALOG_MIGRATION_SOURCE_URL ?? '', targetUrl: process.env.CATALOG_MIGRATION_TARGET_URL ?? '',
    sourceHost: process.env.CATALOG_MIGRATION_SOURCE_HOST ?? '', targetHost: process.env.CATALOG_MIGRATION_TARGET_HOST ?? '',
    sourceToken: process.env.CATALOG_MAINTENANCE_TOKEN ?? '', targetToken: process.env.CATALOG_MIGRATION_TARGET_TOKEN ?? '', runnerTemp: process.env.RUNNER_TEMP ?? '' }
  const report = await transferModelState(options)
  if (isAbsolute(options.runnerTemp)) await writeFile(join(resolve(options.runnerTemp), 'model-state-migration-report.json'), `${canonicalJson(report)}\n`, { mode: 0o600 })
  console.log(canonicalJson(report))
  process.exitCode = report.state === 'finalized' ? 0 : report.state === 'waiting' ? 2 : 1
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  console.error('model_state_migration_failed; inspect the redacted report; no model or control operation was requested')
  process.exitCode = 1
})
