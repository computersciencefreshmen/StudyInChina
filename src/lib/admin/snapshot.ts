import 'server-only'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createCatalogRepository } from '@/lib/catalog/repository'
import type { DataBundle } from '@/lib/data/types'
import { getTodayDate } from '@/lib/data/freshness'
import { getVerificationCapabilities } from './verification'
import type { AdminRun, AdminSnapshot, TokenUsage } from './types'
import { ledgerTokenUsage, sumTokenUsage } from './telemetry-contract'
import { telemetryIsStale } from './telemetry-contract'
import { currentQuotaObservation, EXECUTOR_RUN_ID, projectUsageLedger } from './executor-contract'
import { readRemoteTelemetry, remoteExecutorConfiguration, remoteExecutorConnected, remoteExecutorControllable } from './remote-executor'
import type { ProcessProbe } from '../../../scripts/ingestion/minimax-quota-supervisor'

const RUN_ID = EXECUTOR_RUN_ID
type Json = Record<string, unknown>
const number = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
const date = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
const model = (value: unknown): string | null => typeof value === 'string' && /^MiniMax-M[\w.-]{1,80}$/.test(value) ? value : null
const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastInputTokens: null, lastOutputTokens: null, lastResponseAt: null })

export function normalizeTokenUsage(usage: unknown, checkedAt: unknown): TokenUsage {
  const raw = usage && typeof usage === 'object' ? usage as Json : {}
  const details = raw.prompt_tokens_details && typeof raw.prompt_tokens_details === 'object' ? raw.prompt_tokens_details as Json : {}
  const input = number(raw.input_tokens ?? raw.prompt_tokens)
  const output = number(raw.output_tokens ?? raw.completion_tokens)
  const cacheReadTokens = number(raw.cache_read_input_tokens ?? details.cached_tokens) ?? 0
  const cacheWriteTokens = number(raw.cache_creation_input_tokens) ?? 0
  // Anthropic's input_tokens excludes cached input; OpenAI's prompt_tokens includes it.
  const inputTokens = (input ?? 0) + ('input_tokens' in raw ? cacheReadTokens + cacheWriteTokens : 0)
  return { inputTokens, outputTokens: output ?? 0, totalTokens: number(raw.total_tokens) ?? inputTokens + (output ?? 0), requests: input !== null || output !== null ? 1 : 0,
    cacheReadTokens, cacheWriteTokens, lastInputTokens: input === null ? null : inputTokens, lastOutputTokens: output, lastResponseAt: date(checkedAt) }
}

function sumUsage(values: TokenUsage[]): TokenUsage {
  return sumTokenUsage(values)
}

async function boundedJson(file: string, maxBytes = 64 * 1_024): Promise<Json | null> {
  // Local opt-in telemetry is never a deployment asset; suppress dynamic file tracing.
  try { const info = await stat(/* turbopackIgnore: true */ file); if (!info.isFile() || info.size > maxBytes) return null; return JSON.parse(await readFile(/* turbopackIgnore: true */ file, 'utf8')) as Json } catch { return null }
}

async function summarySnapshot(directory: string): Promise<Pick<AdminRun, 'summary' | 'summaryAt'>> {
  const snapshots: Array<Pick<AdminRun, 'summary' | 'summaryAt'>> = []
  for (const filename of ['report.json', 'partial-report.json']) {
    let file
    try {
      file = await open(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ directory, filename), 'r')
      const buffer = Buffer.alloc(16 * 1_024)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const header = buffer.subarray(0, bytesRead).toString('utf8')
      const match = /"summary"\s*:\s*(\{[^}]*\})/.exec(header)
      if (!match) continue
      const raw = JSON.parse(match[1]) as Json
      snapshots.push({ summary: { supportedCandidateFields: number(raw.supportedCandidateFields), contradictedCandidateFields: number(raw.contradictedCandidateFields), unconfirmedFields: number(raw.unconfirmedFields), modelErrorRecords: number(raw.modelErrorRecords) }, summaryAt: date(/"generatedAt"\s*:\s*"([^"]+)"/.exec(header)?.[1]) })
    } catch { /* Missing or atomically replaced checkpoints are normal. */ } finally { await file?.close().catch(() => {}) }
  }
  return snapshots.sort((a, b) => Date.parse(b.summaryAt || '') - Date.parse(a.summaryAt || ''))[0] ?? { summary: null, summaryAt: null }
}

// Usage is the final property in verifier response files. Read only a small header and tail,
// never transfer catalog claims, model text, provider configuration or source snapshots.
async function responseUsage(filePath: string, size: number): Promise<TokenUsage> {
  let file
  try {
    file = await open(/* turbopackIgnore: true */ filePath, 'r')
    const header = Buffer.alloc(Math.min(size, 1_024))
    const tail = Buffer.alloc(Math.min(size, 16 * 1_024))
    await file.read(header, 0, header.length, 0)
    await file.read(tail, 0, tail.length, Math.max(0, size - tail.length))
    const checkedAt = /"checkedAt"\s*:\s*"([^"]+)"/.exec(header.toString('utf8'))?.[1]
    const usage = savedResponseUsage(tail.toString('utf8'))
    return usage !== undefined ? normalizeTokenUsage(usage, checkedAt) : emptyUsage()
  } catch { return emptyUsage() } finally { await file?.close().catch(() => {}) }
}

/** Usage is followed by immutable attempt metadata in newer responses. */
export function savedResponseUsage(text: string): unknown {
  const matches = [...text.matchAll(/"usage"\s*:\s*/g)]
  const last = matches.at(-1)
  if (!last) return undefined
  const start = last.index! + last[0].length
  if (text.slice(start, start + 4) === 'null') return null
  if (text[start] !== '{') return undefined
  let depth = 0, quoted = false, escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, index + 1)) } catch { return undefined } }
  }
  return undefined
}

const responseCache = new Map<string, { mtime: number; size: number; value: TokenUsage }>()
const runUsageCache = new Map<string, { at: number; pending: Promise<TokenUsage> }>()
async function scanUsage(directory: string): Promise<TokenUsage> {
  try {
    const root = join(directory, 'responses')
    const entries = (await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true })).filter(entry => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
    const values: TokenUsage[] = []
    let next = 0
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < entries.length) {
        const file = join(root, entries[next++].name)
        try {
          const info = await stat(/* turbopackIgnore: true */ file)
          let cached = responseCache.get(file)
          if (!cached || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
            cached = { mtime: info.mtimeMs, size: info.size, value: await responseUsage(file, info.size) }
            if (responseCache.size > 20_000) responseCache.clear()
            responseCache.set(file, cached)
          }
          values.push(cached.value)
        } catch { /* A concurrent atomic rewrite can be retried next time. */ }
      }
    }))
    return sumUsage(values)
  } catch { return emptyUsage() }
}

function cachedUsage(directory: string): Promise<TokenUsage> {
  const cached = runUsageCache.get(directory)
  if (cached && Date.now() - cached.at < 5_000) return cached.pending
  const pending = scanUsage(directory)
  runUsageCache.set(directory, { at: Date.now(), pending })
  return pending
}

/** A reused PID, unrelated Node process, or unverified OS identity is not a running verifier. */
export function verificationProcessMatches(probe: ProcessProbe, receipt: Json | null, manifest: Json | null): boolean {
  const started = Date.parse(String(receipt?.startedAt || ''))
  const created = Date.parse(probe.createdAt || '')
  return Boolean(probe.alive && probe.inspected && probe.fingerprint && (probe.verifier || probe.adminVerifier || probe.recoveryVerifier) &&
    Number.isFinite(started) && Number.isFinite(created) && created <= started && started - created <= 120_000 &&
    receipt && manifest && /^[a-f0-9]{64}$/.test(String(receipt.inputSha256)) && /^[a-f0-9]{64}$/.test(String(receipt.modelConfigSha256)) &&
    receipt.inputSha256 === manifest.inputSha256 && receipt.modelConfigSha256 === manifest.modelConfigSha256 &&
    receipt.model === manifest.model && receipt.selectedRecords === manifest.selectedRecords)
}
async function verifiedRunAlive(directory: string, receipt: Json | null, manifest: Json | null): Promise<boolean> {
  if (!Number.isSafeInteger(receipt?.pid) || Number(receipt?.pid) <= 0) return false
  try {
    const { probeNativeProcess } = await import('../../../scripts/ingestion/minimax-quota-supervisor')
    const root = dirname(dirname(dirname(directory)))
    return verificationProcessMatches(await probeNativeProcess(Number(receipt?.pid), root), receipt, manifest)
  } catch { return false }
}

export async function readVerificationRun(directory: string, id: string): Promise<AdminRun> {
  const [savedStatus, progress, receipt, manifest, summary, tokenUsage] = await Promise.all([
    boundedJson(join(directory, 'status.json')), boundedJson(join(directory, 'progress.json')),
    boundedJson(join(directory, 'run-receipt.json')), boundedJson(join(directory, 'manifest.json')),
    summarySnapshot(directory), cachedUsage(directory),
  ])
  const status = savedStatus ?? progress ?? {}
  const value = status.status
  return { id, title: id === '698fd533401f3de8' ? '全量目录核验' : id === '9dd414cb9cb419af' ? '最新高校补充核验' : '目录核验任务',
    status: value === 'running' || value === 'failed' || value === 'completed' || value === 'incomplete' ? value : 'unknown',
    alive: await verifiedRunAlive(directory, receipt, manifest), model: model(status.model ?? receipt?.model ?? manifest?.model),
    effort: typeof receipt?.effort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(receipt.effort) ? receipt.effort : null,
    thinking: receipt?.thinking === 'adaptive' || receipt?.thinking === 'disabled' ? receipt.thinking : null,
    selectedRecords: number(status.selectedRecords ?? receipt?.selectedRecords ?? manifest?.selectedRecords), completedRecords: number(status.completedRecords),
    startedAt: date(status.startedAt ?? receipt?.startedAt), updatedAt: date(status.updatedAt ?? status.finishedAt ?? status.startedAt ?? receipt?.startedAt),
    fatal: status.fatal ? typeof status.fatal === 'string' && /^MiniMax HTTP \d{3}$/.test(status.fatal) ? status.fatal : '核验进程报告错误' : null,
    ...summary, tokenUsage }
}

export async function readLocalVerificationRuns(root = process.cwd()): Promise<AdminRun[]> {
  if (!getVerificationCapabilities().localMonitoring) return []
  const directory = join(root, '.official-harvest', 'minimax-verification')
  try {
    const entries = (await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && RUN_ID.test(entry.name))
    const runs = await Promise.all(entries.map(entry => readVerificationRun(join(directory, entry.name), entry.name)))
    return runs.sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''))
  } catch { return [] }
}

export function catalogSnapshot(data: DataBundle, today = getTodayDate()): AdminSnapshot['catalog'] {
  const records = [...data.universities, ...data.programs, ...data.admissionCycles, ...data.scholarships, ...data.cities]
  const statuses = { verified: 0, needsReview: 0, stale: 0, draft: 0, archived: 0 }
  let overdueRecords = 0
  for (const record of records) {
    const overdue = record.reviewAfter < today
    if (overdue && record.status === 'verified') overdueRecords++
    statuses[record.status]++
    if (record.status === 'draft' || record.status === 'stale' || (record.status === 'verified' && overdue)) statuses.needsReview++
  }
  return { counts: { universities: data.universities.length, programs: data.programs.length, admissionCycles: data.admissionCycles.length, scholarships: data.scholarships.length, cities: data.cities.length, sources: data.sources.length }, statuses, overdueRecords, totalRecords: records.length + data.sources.length, officialSources: data.sources.filter(source => source.official).length }
}

const catalog = createCatalogRepository()
let cachedCatalog: { at: number; value: AdminSnapshot['catalog'] } | undefined
export async function getAdminSnapshot(): Promise<AdminSnapshot> {
  if (!cachedCatalog || Date.now() - cachedCatalog.at >= 30_000) cachedCatalog = { at: Date.now(), value: catalogSnapshot(await catalog.getBundle()) }
  const capabilities = getVerificationCapabilities()
  const generatedAt = new Date().toISOString()
  const todayDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (!capabilities.localMonitoring) {
    const remote = await readRemoteTelemetry()
    const connected = remoteExecutorConnected(remote)
    const controls = remoteExecutorConfiguration()?.controlEnabled === true && remoteExecutorControllable(remote)
    const automation = remote?.automation ? { ...remote.automation, connected, quota: currentQuotaObservation(remote.automation.quota) } : null
    const ledger = remote?.ledger ? { ...remote.ledger, todayDay } : null
    return { generatedAt, catalog: cachedCatalog.value, runs: remote?.runs || [],
      capabilities: { ...capabilities, startVerification: connected && controls, automationControl: connected && controls,
        credentialSource: connected ? 'ccswitch' : capabilities.credentialSource, reason: connected && controls ? null : remote ? '本机执行器未在线，或控制通道尚未启用。' : capabilities.reason },
      telemetry: { source: remote ? 'remote' : 'unavailable', observedAt: remote?.observedAt || null, stale: !remote || telemetryIsStale(remote.observedAt) },
      model: remote?.model || { configured: null }, usage: { ...(ledger ? ledgerTokenUsage(ledger, remote!.usage) : remote?.usage || emptyUsage()), budgetTokens: null },
      usageBasis: ledger ? 'immutable-ledger' : remote ? 'saved-responses' : 'unavailable', ledger, automation }
  }
  const [runs, savedLedger, automation] = await Promise.all([
    readLocalVerificationRuns(), boundedJson(join(process.cwd(), '.tmp/minimax-verification/usage-ledger.json'), 512 * 1_024),
    import('../../../scripts/ingestion/minimax-admin-control').then(module => module.readExecutorStatus()).catch(() => null),
  ])
  const ledger = projectUsageLedger(savedLedger, todayDay)
  const savedUsage = sumUsage(runs.map(run => run.tokenUsage))
  return { generatedAt, catalog: cachedCatalog.value, runs, capabilities: { ...capabilities,
      automationControl: Boolean(automation && automation.reason !== 'process_identity_unconfirmed') },
    telemetry: { source: capabilities.localMonitoring ? 'local' : 'unavailable', observedAt: capabilities.localMonitoring ? generatedAt : null, stale: !capabilities.localMonitoring },
    model: { configured: model(process.env.MINIMAX_MODEL || process.env.ANTHROPIC_MODEL) ?? runs.find(run => run.model)?.model ?? null },
    usage: { ...(ledger ? ledgerTokenUsage(ledger, savedUsage) : savedUsage), budgetTokens: null }, usageBasis: ledger ? 'immutable-ledger' : 'saved-responses', ledger,
    automation: automation ? { ...automation, quota: currentQuotaObservation(automation.quota) } : null }
}
