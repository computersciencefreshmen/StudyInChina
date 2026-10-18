import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { Agent } from 'undici'
import { getTodayDate } from '../../src/lib/data/freshness'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { buildUniversityMaintenancePlan, emptyUniversityMaintenanceState, maintenanceDigest, selectUniversityMaintenanceSources, universityMaintenanceStateSchema,
  type UniversityMaintenancePlan, type UniversityMaintenanceResults, type UniversityMaintenanceState } from '../../src/lib/maintenance/university-coverage'
import { assertSafeSourceUrl, normalizeAllowedHost } from '../../workers/ingestion/src/security'
import { isRobotsPathAllowed } from '../../workers/ingestion/src/robots'

const MAX_BYTES = 2 * 1024 * 1024, USER_AGENT = 'StudyInChinaDataBot/1.0 (+https://studyinchina.vercel.app/en/data-policy)'
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
class CaptureFailure extends Error {
  constructor(message: string, readonly httpStatus: number | null = null, readonly finalUrl: string | null = null) { super(message) }
}
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const sourceObservationSchema = z.object({
  requestedUrl: z.string(), finalUrl: z.string().nullable(), startedAt: z.string(), completedAt: z.string(),
  httpStatus: z.number().int().nullable(), outcome: z.enum(['captured', 'unchanged', 'blocked', 'failed']),
  errorCode: z.string().nullable(), rawSha256: digestSchema.nullable(), byteLength: z.number().int().nonnegative(),
  rawFile: z.string().nullable(), contentType: z.string().nullable(), completeBody: z.boolean(),
  candidates: z.array(z.object({ url: z.string(), anchorText: z.string(), status: z.literal('candidate_pending_review') }).strict()),
}).strict()
type SourceObservation = z.infer<typeof sourceObservationSchema>
type CaptureDependencies = {
  fetch?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void>;
  resolveAddresses?: (hostname: string) => Promise<string[]>;
}
export type CaptureOptions = { root: string; planFile: string; dataDirectory: string; stateFile: string; outputDirectory: string; today: string }
const inside = (root: string, path: string) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(new Error('request_deadline')); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([work, interrupted]) } finally { signal.removeEventListener('abort', abort) }
}
async function ensureContained(root: string, path: string) {
  let parent = path
  for (;;) {
    try { const stat = await lstat(parent); if (parent === path && stat.isSymbolicLink() || !inside(await realpath(root), await realpath(parent))) throw new Error('Capture path escapes workspace'); return }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const next = dirname(parent); if (next === parent) throw error; parent = next }
  }
}
async function atomicFile(path: string, bytes: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
}
const jsonFile = (path: string, value: unknown) => atomicFile(path, `${JSON.stringify(value, null, 2)}\n`)
async function optionalJson(path: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
async function verifyObservationBytes(directory: string, observation: SourceObservation) {
  if (!observation.rawFile) return
  const path = resolve(directory, observation.rawFile)
  if (!inside(directory, path)) throw new Error('Source checkpoint raw path differs')
  const bytes = await readFile(path)
  if (hash(bytes) !== observation.rawSha256 || bytes.length !== observation.byteLength) throw new Error('Source checkpoint bytes differ; no replay')
}

export function isPublicCaptureAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b))
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase()
    if (value.startsWith('::ffff:')) return isPublicCaptureAddress(value.slice(7))
    return value !== '::' && value !== '::1' && !/^(?:fc|fd|fe[89ab]|ff|2001:db8:)/.test(value)
  }
  return false
}

/** The validated addresses are returned directly to the TLS socket lookup, without a second DNS lookup. */
export function createPublicCaptureLookup(addresses: (hostname: string) => Promise<string[]>): LookupFunction {
  return (hostname, options, callback) => {
    void addresses(hostname).then(found => {
      if (!found.length || found.some(address => !isPublicCaptureAddress(address))) throw new Error('private_or_unresolved_host')
      const requestedFamily = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family
      const candidates = found.map(address => ({ address, family: isIP(address) })).filter(row => !requestedFamily || row.family === requestedFamily)
      if (!candidates.length) throw new Error('private_or_unresolved_host')
      if (options.all) callback(null, candidates)
      else callback(null, candidates[0].address, candidates[0].family)
    }).catch(error => callback(error instanceof Error ? error : new Error('private_or_unresolved_host'), ''))
  }
}

/** HTML remains untrusted discovery text; preserve the original bytes and honor declared legacy Chinese encodings. */
export function decodeMaintenanceHtml(bytes: Uint8Array, contentType = ''): string {
  const header = /charset\s*=\s*["']?\s*([a-z0-9._-]+)/i.exec(contentType)?.[1]
  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 8192))
  const meta = /<meta\b[^>]*charset\s*=\s*["']?\s*([a-z0-9._-]+)/i.exec(prefix)?.[1]
  for (const charset of [header, meta, 'utf-8']) {
    if (!charset) continue
    try { return new TextDecoder(charset).decode(bytes) } catch { /* Unsupported labels do not permit URL or host expansion. */ }
  }
  return new TextDecoder().decode(bytes)
}

export function approvedCaptureUrl(value: string, allowedHosts: string[]): URL {
  const url = assertSafeSourceUrl(value, allowedHosts)
  if (url.port) throw new Error('Explicit ports are not allowed')
  url.hash = ''
  return url
}

/** Link discovery only: candidates are neither programme identities nor admissions facts. */
export function extractMaintenanceLinkCandidates(html: string, baseUrl: string, allowedHosts: string[]) {
  const candidates = new Map<string, SourceObservation['candidates'][number]>()
  const matcher = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(matcher)) {
    if (candidates.size >= 50) break
    const href = (match[1] ?? match[2] ?? match[3] ?? '').replaceAll('&amp;', '&')
    const text = match[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!/admiss|catalog|program|undergrad|postgrad|master|doctor|scholar|degree|招生|专业|本科|硕士|博士/i.test(`${href} ${text}`)) continue
    try { const url = approvedCaptureUrl(new URL(href, baseUrl).href, allowedHosts); candidates.set(url.href, { url: url.href, anchorText: text, status: 'candidate_pending_review' }) } catch { /* No host expansion or inferred replacement URL. */ }
  }
  return [...candidates.values()].sort((a, b) => a.url.localeCompare(b.url))
}

export function validateCapturePlan(bundle: DataBundle, state: UniversityMaintenanceState, input: unknown, today: string): UniversityMaintenancePlan {
  const header = z.object({ today: z.string(), limit: z.number().int().min(1).max(1000), planSha256: digestSchema }).passthrough().parse(input)
  if (header.today !== today) throw new Error('Capture plan must use the current China calendar date')
  const expected = buildUniversityMaintenancePlan(bundle, { today, state, limit: header.limit })
  if (maintenanceDigest(input) !== maintenanceDigest(expected)) throw new Error('Capture plan differs from exact catalogue inputs or durable state')
  if (expected.selectedUniversityIds.length > 20) throw new Error('Source capture is bounded to 20 selected universities; create a smaller plan')
  return expected
}

export async function captureUniversityMaintenanceSources(options: CaptureOptions, dependencies: CaptureDependencies = {}) {
  const clock = dependencies.now ?? (() => new Date())
  const sleep = dependencies.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const addresses = dependencies.resolveAddresses ?? (async hostname => (await lookup(hostname, { all: true })).map(row => row.address))
  const dispatcher = dependencies.fetch ? undefined : new Agent({ connect: { lookup: createPublicCaptureLookup(addresses), timeout: 20_000 } })
  const fetcher = dependencies.fetch ?? ((url, init) => fetch(url, { ...init, dispatcher } as RequestInit)) as typeof fetch
  if (options.today !== getTodayDate(clock())) throw new Error('Capture date must equal today in Asia/Shanghai')
  const base = resolve(options.root, '.official-harvest/university-maintenance')
  if (!inside(base, options.outputDirectory)) throw new Error('Source evidence must stay under .official-harvest/university-maintenance')
  for (const path of [options.planFile, options.dataDirectory, options.stateFile, options.outputDirectory, base]) await ensureContained(options.root, path)
  const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
  const bundle = bundleSchema.parse(Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, name]) => {
    const path = resolve(options.dataDirectory, `${name}.json`); await ensureContained(options.root, path)
    return [key, JSON.parse(await readFile(path, 'utf8'))]
  }))))
  const stateInput = await optionalJson(options.stateFile), state = stateInput === null ? emptyUniversityMaintenanceState() : universityMaintenanceStateSchema.parse(stateInput)
  const plan = validateCapturePlan(bundle, state, JSON.parse(await readFile(options.planFile, 'utf8')), options.today)
  await mkdir(base, { recursive: true }); await ensureContained(options.root, base)
  const lockPath = resolve(base, 'capture.lock'), lock = await open(lockPath, 'wx')
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, planSha256: plan.planSha256, startedAt: clock().toISOString() }))
    const runDirectory = resolve(options.outputDirectory, plan.planSha256), completionPath = resolve(runDirectory, 'completion.json')
    await mkdir(runDirectory, { recursive: true }); await ensureContained(options.root, runDirectory)
    const completed = await optionalJson(completionPath)
    if (completed !== null) {
      const checkpoint = z.object({ format: z.literal('studyinchina.university-source-capture-completion'), planSha256: digestSchema,
        reportSha256: digestSchema, receiptSha256: digestSchema }).strict().parse(completed)
      const report = await optionalJson(resolve(runDirectory, 'report.json')), receipt = await optionalJson(resolve(runDirectory, 'results.json'))
      if (checkpoint.planSha256 !== plan.planSha256 || maintenanceDigest(report) !== checkpoint.reportSha256 || maintenanceDigest(receipt) !== checkpoint.receiptSha256) throw new Error('Completed capture checkpoint differs; no automatic replay')
      const saved = z.object({ results: z.array(z.object({ sources: z.array(sourceObservationSchema) }).passthrough()) }).passthrough().parse(report)
      for (const school of saved.results) for (const source of school.sources) await verifyObservationBytes(runDirectory, source)
      return { report, receipt, runDirectory, reusedCompletion: true }
    }
    const admissionPath = resolve(runDirectory, 'batch-admission.json')
    const admission = z.object({ planSha256: digestSchema, attemptedAt: z.string().datetime({ offset: true }) }).strict().parse(
      await optionalJson(admissionPath) ?? { planSha256: plan.planSha256, attemptedAt: clock().toISOString() })
    if (admission.planSha256 !== plan.planSha256 || getTodayDate(new Date(admission.attemptedAt)) !== plan.today) throw new Error('Batch admission differs from its original plan date')
    if (await optionalJson(admissionPath) === null) await jsonFile(admissionPath, admission)
    const indexPath = resolve(base, 'source-index.json')
    const index = z.record(digestSchema, digestSchema).parse(await optionalJson(indexPath) ?? {})
    const priorHashes = { ...index }, robots = new Map<string, Promise<{ allowed: boolean; text: string; errorCode: string | null }>>()
    const domainTails = new Map<string, Promise<void>>(), nextRequest = new Map<string, number>(), resolved = new Map<string, Promise<void>>()
    const domainKey = (host: string) => { const parts = host.split('.'); return parts.slice(-(/\.(?:edu|gov|com|org)\.cn$/.test(host) ? 3 : 2)).join('.') }
    const limitedFetch = async (url: URL, signal: AbortSignal) => {
      if (!resolved.has(url.hostname)) resolved.set(url.hostname, (async () => { const found = await addresses(url.hostname); if (!found.length || found.some(address => !isPublicCaptureAddress(address))) throw new Error('private_or_unresolved_host') })())
      await abortable(resolved.get(url.hostname)!, signal)
      const key = domainKey(url.hostname), previous = domainTails.get(key) ?? Promise.resolve()
      let release!: () => void
      domainTails.set(key, new Promise<void>(resolve => { release = resolve }))
      try {
        await abortable(previous, signal)
        const delay = Math.max(0, (nextRequest.get(key) ?? 0) - clock().valueOf())
        if (delay) await abortable(sleep(delay), signal)
        signal.throwIfAborted()
        nextRequest.set(key, clock().valueOf() + 5000)
        return await abortable(fetcher(url, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.1' }, signal }), signal)
      } finally { release() }
    }
    const boundedFetch = async (initial: URL, hosts: string[], checkRobots: boolean): Promise<{ response: Response; finalUrl: URL; bytes: Uint8Array }> => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000)
      let current = initial
      try {
        for (let hop = 0; hop <= 5; hop++) {
          current = approvedCaptureUrl(current.href, hosts)
          if (checkRobots) {
            const policy = await abortable(robotsFor(current, hosts), controller.signal)
            if (!policy.allowed || !isRobotsPathAllowed(policy.text, current, USER_AGENT)) throw new Error(policy.errorCode ?? 'robots_disallow')
          }
          const response = await limitedFetch(current, controller.signal)
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel()
            if (hop === 5 || !response.headers.get('location')) throw new Error('redirect_limit_or_missing_location')
            try { current = approvedCaptureUrl(new URL(response.headers.get('location')!, current).href, hosts) }
            catch { throw new CaptureFailure('unsafe_source_or_redirect', response.status, current.href) }
            continue
          }
          if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new CaptureFailure('body_too_large', response.status, current.href) }
          const chunks: Uint8Array[] = []; let length = 0
          const reader = response.body?.getReader()
          if (reader) try { for (;;) { const chunk = await abortable(reader.read(), controller.signal); if (chunk.done) break; length += chunk.value.byteLength; if (length > MAX_BYTES) { await reader.cancel(); throw new CaptureFailure('body_too_large', response.status, current.href) } chunks.push(chunk.value) } } finally { reader.releaseLock() }
          return { response, finalUrl: current, bytes: Buffer.concat(chunks) }
        }
        throw new Error('redirect_limit')
      } finally { clearTimeout(timer) }
    }
    const robotsFor = (url: URL, hosts: string[]) => {
      // The cache key includes the school allowlist, so another school's policy cannot widen redirects.
      const key = `${url.origin}|${hosts.join(',')}`
      if (!robots.has(key)) robots.set(key, (async () => {
        try {
          const result = await boundedFetch(new URL('/robots.txt', url), hosts, false)
          const rawSha256 = hash(result.bytes), path = resolve(runDirectory, 'robots', `${hash(key)}.bin`)
          await atomicFile(path, result.bytes)
          await jsonFile(`${path}.json`, { requestedUrl: new URL('/robots.txt', url).href, finalUrl: result.finalUrl.href, checkedAt: clock().toISOString(), httpStatus: result.response.status, rawSha256, byteLength: result.bytes.length })
          if ([404, 410].includes(result.response.status)) return { allowed: true, text: '', errorCode: null }
          if (!result.response.ok) return { allowed: false, text: '', errorCode: `robots_http_${result.response.status}` }
          return { allowed: true, text: decodeMaintenanceHtml(result.bytes, result.response.headers.get('content-type') ?? ''), errorCode: null }
        } catch { return { allowed: false, text: '', errorCode: 'robots_unavailable' } }
      })())
      return robots.get(key)!
    }
    const sourceCache = new Map<string, Promise<SourceObservation>>()
    const observe = (value: string, hosts: string[]) => {
      const cacheKey = `${value}|${hosts.join(',')}`
      if (!sourceCache.has(cacheKey)) sourceCache.set(cacheKey, (async (): Promise<SourceObservation> => {
        const key = hash(cacheKey), checkpointPath = resolve(runDirectory, 'sources', `${key}.json`), startedPath = `${checkpointPath}.started`
        await mkdir(dirname(checkpointPath), { recursive: true })
        const existing = await optionalJson(checkpointPath)
        if (existing !== null) {
          const observation = sourceObservationSchema.parse(existing)
          if (observation.requestedUrl !== value) throw new Error('Source checkpoint URL differs; no replay')
          await verifyObservationBytes(runDirectory, observation)
          if (observation.rawSha256 && ['captured', 'unchanged'].includes(observation.outcome)) index[hash(value)] = observation.rawSha256
          return observation
        }
        const startedAt = clock().toISOString()
        const empty: SourceObservation = { requestedUrl: value, finalUrl: null, startedAt, completedAt: startedAt, httpStatus: null, outcome: 'failed', errorCode: null,
          rawSha256: null, byteLength: 0, rawFile: null, contentType: null, completeBody: false, candidates: [] }
        let marker
        try { marker = await open(startedPath, 'wx'); await marker.writeFile(JSON.stringify({ planSha256: plan.planSha256, requestedUrl: value, startedAt })); await marker.close() }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { ...empty, errorCode: 'interrupted_capture_requires_reconciliation' }; throw error }
        let observation: SourceObservation
        try {
          const url = approvedCaptureUrl(value, hosts), result = await boundedFetch(url, hosts, true)
          const rawSha256 = hash(result.bytes), rawFile = resolve(runDirectory, 'raw', `${rawSha256}.bin`)
          await atomicFile(rawFile, result.bytes)
          const blocked = [401, 403, 429].includes(result.response.status), outcome = blocked ? 'blocked' : !result.response.ok ? 'failed' : priorHashes[hash(value)] === rawSha256 ? 'unchanged' : 'captured'
          const contentType = result.response.headers.get('content-type')?.slice(0, 200) ?? null
          observation = { ...empty, finalUrl: result.finalUrl.href, completedAt: clock().toISOString(), httpStatus: result.response.status, outcome,
            errorCode: result.response.ok ? null : `source_http_${result.response.status}`, rawSha256, byteLength: result.bytes.length,
            rawFile: relative(runDirectory, rawFile).split(sep).join('/'), contentType, completeBody: true,
            candidates: result.response.ok && contentType?.includes('html') ? extractMaintenanceLinkCandidates(decodeMaintenanceHtml(result.bytes, contentType), result.finalUrl.href, hosts) : [] }
          if (result.response.ok) index[hash(value)] = rawSha256
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          const errorCode = /robots/.test(message) ? message : /body_too_large|private_or_unresolved_host|redirect_limit_or_missing_location|unsafe_source_or_redirect/.test(message) ? message : /allowlist|hostname|HTTPS|credentials|port|Private|local/.test(message) ? 'unsafe_source_or_redirect' : 'network_or_deadline_failure'
          observation = { ...empty, completedAt: clock().toISOString(), outcome: /robots_disallow|robots_http_(?:401|403|429)|unsafe_source/.test(errorCode) ? 'blocked' : 'failed', errorCode,
            httpStatus: error instanceof CaptureFailure ? error.httpStatus : null, finalUrl: error instanceof CaptureFailure ? error.finalUrl : null }
        }
        await jsonFile(checkpointPath, observation)
        return observation
      })())
      return sourceCache.get(cacheKey)!
    }
    const selected = plan.selectedUniversityIds.map(id => plan.universities.find(row => row.universityId === id)!)
    const results: { universityId: string; processingStatus: string; attemptedAt: string; completedAt: string; sources: SourceObservation[] }[] = []
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
      while (cursor < selected.length) {
        const school = selected[cursor++], selection = selectUniversityMaintenanceSources(school)
        const hosts = [...new Set(selection.approvedUrls.map(value => { try { return normalizeAllowedHost(new URL(value).hostname) } catch { return '' } }).filter(Boolean))].sort()
        const sources: SourceObservation[] = []
        for (const value of selection.selectedUrls) sources.push(await observe(value, hosts))
        results.push({ universityId: school.universityId, attemptedAt: admission.attemptedAt, completedAt: clock().toISOString(), processingStatus: sources.some(row => ['captured', 'unchanged'].includes(row.outcome)) ? 'captured_pending_review' : sources.length ? 'held' : 'no_sources', sources })
      }
    }))
    results.sort((a, b) => a.universityId.localeCompare(b.universityId))
    const receipt: UniversityMaintenanceResults = { format: 'studyinchina.university-maintenance-results', version: 1, planSha256: plan.planSha256,
      results: results.map(row => { const outcome = row.processingStatus === 'captured_pending_review' ? row.sources.every(source => source.outcome === 'unchanged') ? 'unchanged' as const : 'captured' as const : row.sources.some(source => source.outcome === 'blocked') ? 'blocked' as const : row.sources.length ? 'failed' as const : 'no_sources' as const
        return { universityId: row.universityId, outcome, attemptedAt: row.attemptedAt, completedAt: row.completedAt,
          sourceOffset: selectUniversityMaintenanceSources(plan.universities.find(school => school.universityId === row.universityId)!).nextSourceOffset,
          ...(!['captured', 'unchanged'].includes(outcome) ? { errorCode: row.sources[0]?.errorCode ?? 'no_approved_sources' } : {}) } }) }
    const report = { format: 'studyinchina.university-source-capture', version: 1, planSha256: plan.planSha256, today: plan.today,
      policy: { maximumUrlsPerUniversity: 2, maximumConcurrentSchools: 2, minimumDomainIntervalMs: 5000, maximumResponseBytes: MAX_BYTES,
        requestDeadlineMs: 20_000, paidCalls: 0, canonicalWrites: 0, factsVerified: 0, publicationPerformed: false }, results }
    await jsonFile(resolve(runDirectory, 'report.json'), report)
    await jsonFile(resolve(runDirectory, 'results.json'), receipt)
    await jsonFile(indexPath, index)
    await jsonFile(completionPath, { format: 'studyinchina.university-source-capture-completion', planSha256: plan.planSha256,
      reportSha256: maintenanceDigest(report), receiptSha256: maintenanceDigest(receipt) })
    return { report, receipt, runDirectory, reusedCompletion: false }
  } finally { await lock.close(); await unlink(lockPath); await dispatcher?.destroy() }
}

export function parseUniversityCaptureArguments(args: string[], root = process.cwd()): CaptureOptions {
  const values = new Map<string, string>(), allowed = new Set(['--plan', '--today', '--data-dir', '--state-file', '--output-dir'])
  for (let i = 0; i < args.length; i += 2) { if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown, duplicate or incomplete capture argument'); values.set(args[i], args[i + 1]) }
  root = resolve(root)
  const path = (value: string) => { const result = resolve(root, value); if (!inside(root, result)) throw new Error('Capture inputs must remain in workspace'); return result }
  if (!values.has('--plan')) throw new Error('--plan is required')
  return { root, planFile: path(values.get('--plan')!), today: values.get('--today') ?? getTodayDate(), dataDirectory: path(values.get('--data-dir') ?? 'content/data'),
    stateFile: path(values.get('--state-file') ?? '.tmp/university-maintenance/state.json'), outputDirectory: path(values.get('--output-dir') ?? '.official-harvest/university-maintenance') }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  captureUniversityMaintenanceSources(parseUniversityCaptureArguments(process.argv.slice(2))).then(result => console.log(JSON.stringify({ runDirectory: result.runDirectory, reusedCompletion: result.reusedCompletion, sourceCaptureOnly: true, paidCalls: 0 })))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Bounded source capture failed'); process.exitCode = 1 })
}
