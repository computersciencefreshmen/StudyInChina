import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALIASES, canonical, MAX_BATCH, sha256, validateDescriptor } from '../../workers/account-migration/src/index'
import type { BucketAlias, CopyResult, Descriptor } from '../../workers/account-migration/src/types'

type Page = { objects: Descriptor[]; cursor: string | null; truncated: boolean; excludedReceiptKeys: string[] }
type BucketProgress = { cursor: string | null; done: boolean; pending: Page | null; excludedReceiptKeys: string[]; objects: CopyResult[]; verifyOffset?: number | null }
type Manifest = { format: 'studyinchina.account-r2-manifest'; version: 1; migrationId: string; source: string; target: string;
  buckets: Partial<Record<BucketAlias, BucketProgress>> }
export type CopyOptions = { migrationId: string; token: string; source: string; target: string; manifestPath: string;
  buckets?: BucketAlias[]; maxPages?: number; verify?: boolean; fetcher?: typeof fetch }

function origin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) throw new Error('migration_origin_invalid')
  return url.origin
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('migration_response_invalid')
  return value as Record<string, unknown>
}
async function save(path: string, value: Manifest) {
  const text = `${canonical({ sha256: await sha256(canonical(value)), content: value })}\n`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}
async function responseJson(response: Response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`migration_http_${response.status}`) }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('migration_response_too_large')
  try { return record(JSON.parse(text)) } catch { throw new Error('migration_response_invalid') }
}

/** The local checkpoint records a listed page before sending it. The cursor
 * advances only after every per-object result is durably saved. Re-running may
 * repeat a request, but the target only creates absent objects and verifies
 * existing bytes/metadata; it never overwrites a conflict. */
export async function copyAccountR2(options: CopyOptions) {
  const source = origin(options.source), target = origin(options.target)
  if (source === target || !/^[a-zA-Z0-9_-]{8,96}$/u.test(options.migrationId) || !/^[a-f0-9]{64}$/u.test(options.token)) throw new Error('migration_configuration_invalid')
  const selected = options.buckets ?? ALIASES
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(name => !ALIASES.includes(name))) throw new Error('migration_bucket_selection_invalid')
  const maximum = options.maxPages ?? 1000
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100000) throw new Error('migration_page_limit_invalid')
  const path = resolve(options.manifestPath), fetcher = options.fetcher ?? fetch
  let state: Manifest = { format: 'studyinchina.account-r2-manifest', version: 1, migrationId: options.migrationId, source, target, buckets: {} }
  if (existsSync(path)) {
    const envelope = record(JSON.parse(readFileSync(path, 'utf8'))), content = record(envelope.content)
    if (await sha256(canonical(content)) !== envelope.sha256 || content.format !== state.format || content.version !== 1
      || content.migrationId !== state.migrationId || content.source !== source || content.target !== target || !content.buckets) throw new Error('migration_manifest_binding_invalid')
    state = content as Manifest
  }
  const request = async (base: string, path: string, body?: unknown) => {
    const url = new URL(path, base)
    const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(240000),
      headers: { authorization: `Bearer ${options.token}`, 'x-migration-id': options.migrationId, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: canonical(body) }) })
    if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== url.href) {
      await response.body?.cancel(); throw new Error('migration_redirect_rejected')
    }
    const value = await responseJson(response)
    if (value.migrationId !== options.migrationId || value.role !== (base === source ? 'source' : 'target')) throw new Error('migration_peer_binding_invalid')
    return value
  }
  let batches = 0
  let verificationComplete = true
  const transfer = async (name: BucketAlias, progress: BucketProgress, objects: Descriptor[]) => {
    const result = await request(target, '/v1/copy', { bucket: name, objects })
    if (result.bucket !== name || !Array.isArray(result.results) || result.results.length !== objects.length) throw new Error('migration_copy_response_invalid')
    for (let i = 0; i < objects.length; i++) {
      const item = record(result.results[i]), expected = objects[i]
      if (item.key !== expected.key || item.size !== expected.size || item.metadataSha256 !== expected.metadataSha256
        || canonical(item.metadata) !== canonical(expected.metadata) || !['copied', 'reused', 'held', 'error'].includes(String(item.state))
        || typeof item.code !== 'string' || !/^[a-z_]{1,80}$/u.test(item.code)
        || item.sha256 !== null && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256))) throw new Error('migration_copy_response_invalid')
      if ((item.state === 'copied' || item.state === 'reused') && (typeof item.sha256 !== 'string'
        || typeof item.receiptKey !== 'string' || typeof item.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.receiptSha256))) throw new Error('migration_copy_receipt_missing')
      const old = progress.objects.findIndex(row => row.key === expected.key)
      if (old < 0) progress.objects.push(item as CopyResult)
      else progress.objects[old] = item as CopyResult
    }
    batches++
    await save(path, state)
  }
  for (const name of selected) {
    const progress = state.buckets[name] ??= { cursor: null, done: false, pending: null, excludedReceiptKeys: [], objects: [] }
    // Retry recorded holds/errors on resume; --verify also rechecks all copied
    // objects against the frozen source and target instead of trusting a cache.
    const verifying = Boolean(options.verify || typeof progress.verifyOffset === 'number')
    // Finish inventory first. Retrying the same oversized first page must not
    // consume every bounded run and starve later source pages.
    const offset = verifying ? progress.verifyOffset ?? 0 : 0
    const retries = !progress.done ? [] : verifying ? progress.objects.slice(offset)
      : progress.objects.filter(item => !['copied', 'reused'].includes(item.state))
    if (verifying && progress.done) progress.verifyOffset = offset
    for (let at = 0; at < retries.length && batches < maximum; at += MAX_BATCH) {
      const descriptors: Descriptor[] = []
      for (const item of retries.slice(at, at + MAX_BATCH)) descriptors.push(await validateDescriptor({ key: item.key, size: item.size, metadata: item.metadata, metadataSha256: item.metadataSha256 }))
      await transfer(name, progress, descriptors)
      if (verifying) { progress.verifyOffset = offset + at + descriptors.length; await save(path, state) }
    }
    if (verifying && progress.done) {
      if ((progress.verifyOffset ?? 0) < progress.objects.length) verificationComplete = false
      else progress.verifyOffset = null
      await save(path, state)
    }
    while (!progress.done && batches < maximum) {
      if (!progress.pending) {
        const params = new URLSearchParams({ bucket: name }); if (progress.cursor) params.set('cursor', progress.cursor)
        const page = await request(source, `/v1/list?${params}`)
        if (page.bucket !== name || !Array.isArray(page.objects) || page.objects.length > MAX_BATCH || typeof page.truncated !== 'boolean'
          || !Array.isArray(page.excludedReceiptKeys) || page.excludedReceiptKeys.some(key => typeof key !== 'string')
          || page.truncated && (typeof page.cursor !== 'string' || !page.cursor || page.cursor === progress.cursor)
          || !page.truncated && page.cursor !== null) throw new Error('migration_listing_invalid')
        const objects: Descriptor[] = []
        for (const item of page.objects) objects.push(await validateDescriptor(item))
        progress.pending = { objects, cursor: page.cursor as string | null, truncated: page.truncated, excludedReceiptKeys: page.excludedReceiptKeys as string[] }
        await save(path, state)
      }
      const pending = progress.pending
      if (pending.objects.length) await transfer(name, progress, pending.objects)
      else batches++
      progress.cursor = pending.cursor
      progress.done = !pending.truncated
      progress.excludedReceiptKeys = [...new Set([...progress.excludedReceiptKeys, ...pending.excludedReceiptKeys])]
      progress.pending = null
      await save(path, state)
    }
  }
  const objects = selected.flatMap(name => state.buckets[name]?.objects ?? [])
  return { migrationId: options.migrationId, selectedBuckets: selected, batches,
    copiedOrVerified: objects.filter(item => ['copied', 'reused'].includes(item.state)).length,
    heldOrErrors: objects.filter(item => !['copied', 'reused'].includes(item.state)).length,
    excludedToolReceipts: selected.reduce((sum, name) => sum + (state.buckets[name]?.excludedReceiptKeys.length ?? 0), 0),
    verificationComplete,
    complete: verificationComplete && selected.every(name => state.buckets[name]?.done && !state.buckets[name]?.pending)
      && objects.every(item => ['copied', 'reused'].includes(item.state)), manifestPath: path }
}

async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>()
  let verify = false
  for (let at = 0; at < args.length; at++) {
    if (args[at] === '--verify') { verify = true; continue }
    if (!['--manifest', '--bucket', '--max-pages'].includes(args[at]) || !args[at + 1] || values.has(args[at])) throw new Error('migration_arguments_invalid')
    values.set(args[at], args[++at])
  }
  const selected = values.get('--bucket')
  const result = await copyAccountR2({ migrationId: process.env.MIGRATION_ID ?? '', token: process.env.MIGRATION_TRANSFER_TOKEN ?? '',
    source: process.env.MIGRATION_SOURCE_URL ?? '', target: process.env.MIGRATION_TARGET_URL ?? '', manifestPath: values.get('--manifest') ?? '.tmp/account-r2-migration.json',
    ...(selected ? { buckets: [selected as BucketAlias] } : {}), ...(values.has('--max-pages') ? { maxPages: Number(values.get('--max-pages')) } : {}), verify })
  console.log(JSON.stringify(result))
  if (!result.complete) process.exitCode = 2
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  console.error('account_r2_migration_failed; inspect the private checkpoint and retry; no credentials were logged')
  process.exitCode = 1
})
