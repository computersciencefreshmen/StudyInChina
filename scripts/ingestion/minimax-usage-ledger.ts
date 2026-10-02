import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { QuotaState } from './minimax-quota'

export type UsageApiFormat = 'anthropic' | 'openai-chat' | 'openai-responses'
export type UsageMetadata = {
  attemptId: string; requestedAt: string; receivedAt: string; inputSha256: string;
  model: string; modelConfigSha256?: string | null; providerId?: string | null;
  requestSha256: string; httpStatus: number | null; apiFormat: UsageApiFormat;
  source?: 'model-attempt' | 'historical-response'
}
type CounterName = 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens' | 'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'prompt_tokens_details.cached_tokens' | 'input_tokens_details.cached_tokens' | 'completion_tokens_details.reasoning_tokens' | 'output_tokens_details.reasoning_tokens'
export type NormalizedUsage = {
  status: 'measured' | 'missing' | 'invalid'; apiFormat: UsageApiFormat;
  inputTokens: number | null; uncachedInputTokens: number | null; outputTokens: number | null;
  cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null;
  reportedTotalTokens: number | null; reportedTokens: number | null;
  counters: Partial<Record<CounterName, number | null>>; warnings: string[];
}
export type UsageReceipt = UsageMetadata & {
  schemaVersion: 1; source: 'model-attempt' | 'historical-response';
  usage: NormalizedUsage; day: string; requestDay: string;
  quotaWindow: { startAt: string; resetAt: string; checkedAt: string; remainingPercent: number | null; pool: 'general'; basis: 'official-preflight' } | null;
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const RUN_ID = /^[a-f0-9]{16}(?:-[a-f0-9]{12})?(?:-r[a-f0-9]{12})?$/
const HASH = /^[a-f0-9]{64}$/
const FORMAT = new Set<UsageApiFormat>(['anthropic', 'openai-chat', 'openai-responses'])
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const counterPaths: CounterName[] = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_tokens_details.cached_tokens', 'input_tokens_details.cached_tokens', 'completion_tokens_details.reasoning_tokens', 'output_tokens_details.reasoning_tokens']
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

export function shanghaiUsageDay(timestamp: string) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) throw new Error('Usage timestamp is invalid')
  const parts = dayFormatter.formatToParts(time)
  const part = (name: string) => parts.find(item => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Anthropic cache buckets are disjoint; OpenAI cached/reasoning counters are subsets, not additional tokens.
 * Protocol reference: https://platform.minimax.cn/docs/api-reference/text-prompt-caching
 */
export function normalizeModelUsage(raw: unknown, apiFormat: UsageApiFormat): NormalizedUsage {
  if (!FORMAT.has(apiFormat)) throw new Error('Usage API format is invalid')
  const usage = object(raw)
  const counters: NormalizedUsage['counters'] = {}
  const warnings: string[] = []
  for (const path of counterPaths) {
    const [parent, child] = path.split('.')
    const value = child ? object(usage?.[parent])?.[child] : usage?.[parent]
    if (value !== undefined) { counters[path] = count(value); if (counters[path] === null) warnings.push(`Invalid counter: ${path}`) }
  }
  const aliases = (paths: CounterName[], defaultValue: number | null = null) => {
    const supplied = paths.filter(path => counters[path] !== undefined)
    if (!supplied.length) return defaultValue
    const values = supplied.map(path => counters[path]!)
    if (values.some(value => value === null) || values.some(value => value !== values[0])) { warnings.push(`Conflicting or invalid aliases: ${paths.join(',')}`); return null }
    return values[0]
  }
  const outputTokens = aliases(apiFormat === 'openai-chat' ? ['completion_tokens', 'output_tokens'] : ['output_tokens', 'completion_tokens'])
  const cacheReadTokens = aliases(['cache_read_input_tokens', 'prompt_tokens_details.cached_tokens', 'input_tokens_details.cached_tokens'], 0)
  const cacheWriteTokens = aliases(['cache_creation_input_tokens'], 0)
  const reasoningTokens = aliases(['completion_tokens_details.reasoning_tokens', 'output_tokens_details.reasoning_tokens'], 0)
  const reportedTotalTokens = aliases(['total_tokens'])
  const baseInput = aliases(apiFormat === 'openai-chat' ? ['prompt_tokens', 'input_tokens'] : ['input_tokens', 'prompt_tokens'])
  let inputTokens: number | null = null
  let uncachedInputTokens: number | null = null
  if (apiFormat === 'anthropic') {
    if (baseInput !== null && cacheReadTokens !== null && cacheWriteTokens !== null) {
      inputTokens = baseInput + cacheReadTokens + cacheWriteTokens
      uncachedInputTokens = baseInput
    }
  } else if (baseInput !== null) {
    inputTokens = baseInput
    if (cacheReadTokens !== null && cacheWriteTokens !== null && cacheReadTokens + cacheWriteTokens <= baseInput) uncachedInputTokens = baseInput - cacheReadTokens - cacheWriteTokens
    else warnings.push('Cache subsets exceed input or are invalid')
  }
  let reportedTokens = inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  if (reportedTokens !== null && !Number.isSafeInteger(reportedTokens)) { warnings.push('Token total exceeds safe integer range'); reportedTokens = null }
  if (reasoningTokens !== null && outputTokens !== null && reasoningTokens > outputTokens) warnings.push('Reasoning subset exceeds output')
  if (reportedTotalTokens !== null && reportedTokens !== null && reportedTotalTokens !== reportedTokens) warnings.push('API total_tokens differs from protocol bucket sum')
  return { status: reportedTokens !== null ? 'measured' : usage ? 'invalid' : 'missing', apiFormat, inputTokens, uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, reportedTotalTokens, reportedTokens, counters, warnings }
}

function sanitizeMetadata(value: UsageMetadata): UsageMetadata {
  if (!value || typeof value.attemptId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.attemptId) ||
    !HASH.test(value.inputSha256) || !HASH.test(value.requestSha256) || !/^MiniMax-M[\w.-]{1,64}$/.test(value.model) || !FORMAT.has(value.apiFormat) ||
    (value.httpStatus !== null && (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599))) throw new Error('Usage metadata is invalid')
  if (value.httpStatus === null && value.source === 'historical-response') throw new Error('Historical usage requires an HTTP status')
  const requested = Date.parse(value.requestedAt)
  const received = Date.parse(value.receivedAt)
  if (!Number.isFinite(requested) || !Number.isFinite(received) || received < requested) throw new Error('Usage timestamps are invalid')
  if (value.providerId !== undefined && value.providerId !== null && !/^[a-zA-Z0-9_.-]{1,128}$/.test(value.providerId)) throw new Error('Usage provider ID is invalid')
  if (value.modelConfigSha256 !== undefined && value.modelConfigSha256 !== null && !HASH.test(value.modelConfigSha256)) throw new Error('Usage model configuration hash is invalid')
  if (value.source !== undefined && !['model-attempt', 'historical-response'].includes(value.source)) throw new Error('Usage receipt source is invalid')
  // Explicit allowlist: extra runtime API/config properties, including credentials, are never serialized.
  return { attemptId: value.attemptId, requestedAt: new Date(requested).toISOString(), receivedAt: new Date(received).toISOString(), inputSha256: value.inputSha256,
    model: value.model, modelConfigSha256: value.modelConfigSha256 || null, providerId: value.providerId || null,
    requestSha256: value.requestSha256, httpStatus: value.httpStatus, apiFormat: value.apiFormat, source: value.source || 'model-attempt' }
}

function admissionWindow(quota: QuotaState | undefined, requestedAt: string): UsageReceipt['quotaWindow'] {
  if (!quota || quota.pool !== 'general' || !quota.fiveHour.startAt || !quota.fiveHour.resetAt) return null
  const start = Date.parse(quota.fiveHour.startAt)
  const end = Date.parse(quota.fiveHour.resetAt)
  const checked = Date.parse(quota.checkedAt)
  const requested = Date.parse(requestedAt)
  if (![start, end, checked, requested].every(Number.isFinite) || end - start !== 18_000_000 || requested < start || requested >= end || checked > requested || checked < start) return null
  return { startAt: new Date(start).toISOString(), resetAt: new Date(end).toISOString(), checkedAt: new Date(checked).toISOString(),
    remainingPercent: typeof quota.fiveHour.remainingPercent === 'number' && quota.fiveHour.remainingPercent >= 0 && quota.fiveHour.remainingPercent <= 100 ? quota.fiveHour.remainingPercent : null, pool: 'general', basis: 'official-preflight' }
}

async function safeJson(directory: string, name: string, maxBytes = 2 * 1024 * 1024) {
  const root = await realpath(directory)
  const file = await realpath(join(directory, name))
  const inside = relative(root, file)
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Usage file escapes its run directory')
  if ((await stat(file)).size > maxBytes) throw new Error('Usage file exceeds its byte limit')
  const bytes = await readFile(file)
  if (bytes.byteLength > maxBytes) throw new Error('Usage file exceeds its byte limit')
  return JSON.parse(bytes.toString('utf8'))
}

/** Persist immediately after parsing an API reply, before parsing the model's generated JSON. */
export async function recordModelUsage(runDirectory: string, metadata: UsageMetadata, parsedUsage: unknown, quota?: QuotaState) {
  const value = sanitizeMetadata(metadata)
  if (value.httpStatus === null && parsedUsage != null) throw new Error('Transport-unknown usage cannot contain measured counters')
  const receipt: UsageReceipt = { ...value, schemaVersion: 1, source: value.source || 'model-attempt', usage: normalizeModelUsage(parsedUsage, value.apiFormat),
    day: shanghaiUsageDay(value.receivedAt), requestDay: shanghaiUsageDay(value.requestedAt), quotaWindow: admissionWindow(quota, value.requestedAt) }
  const root = await realpath(runDirectory)
  const directory = join(root, 'usage-receipts')
  await mkdir(directory, { recursive: true })
  const inside = relative(root, await realpath(directory))
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Usage output escapes its run directory')
  const name = `${hash(value.attemptId)}.json`
  const file = join(directory, name)
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  const temporary = join(directory, `${name}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
  let created = true
  try { await link(temporary, file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    created = false
    const existing = await safeJson(root, join('usage-receipts', name), 128 * 1024)
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) throw new Error('Usage attempt ID already exists with different metadata or usage')
  } finally { await unlink(temporary) }
  return { attemptId: value.attemptId, receiptFile: join('usage-receipts', name), created }
}

/** Surviving response files are a historical lower bound: old overwrites/failed attempts cannot be reconstructed. */
export async function seedHistoricalUsage(runDirectory: string) {
  const manifest = await safeJson(runDirectory, 'manifest.json') as Record<string, unknown>
  if (typeof manifest.inputSha256 !== 'string' || !HASH.test(manifest.inputSha256)) throw new Error('Historical usage manifest is invalid')
  let added = 0
  let reused = 0
  let alreadyInstrumented = 0
  let rejected = 0
  const directory = join(runDirectory, 'responses')
  for (const file of existsSync(directory) ? await readdir(directory) : []) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
    try {
      const response = await safeJson(runDirectory, join('responses', file)) as Record<string, unknown>
      if (typeof response.attemptId === 'string' && existsSync(join(runDirectory, 'usage-receipts', `${hash(response.attemptId)}.json`))) { alreadyInstrumented++; continue }
      const apiFormat: UsageApiFormat = object(response.usage)?.prompt_tokens !== undefined ? 'openai-chat' : object(object(response.usage)?.input_tokens_details) ? 'openai-responses' : 'anthropic'
      const normalized = normalizeModelUsage(response.usage, apiFormat)
      const attemptId = `legacy-${hash(JSON.stringify({ inputSha256: manifest.inputSha256, requestSha256: response.requestSha256, receivedAt: response.checkedAt,
        model: response.model, modelConfigSha256: response.modelConfigSha256 || null, counters: normalized.counters }))}`
      const saved = await recordModelUsage(runDirectory, { attemptId, source: 'historical-response', requestedAt: response.checkedAt as string, receivedAt: response.checkedAt as string,
        inputSha256: manifest.inputSha256, model: response.model as string, modelConfigSha256: response.modelConfigSha256 as string | null,
        // Historical response receipts did not retain provider identity. Do not guess it from a rewritten manifest.
        providerId: typeof response.providerId === 'string' ? response.providerId : null, requestSha256: response.requestSha256 as string, httpStatus: 200, apiFormat }, response.usage)
      if (saved.created) added++; else reused++
    } catch { rejected++ }
  }
  return { added, reused, alreadyInstrumented, rejected }
}

type UsageTotals = {
  attempts: number; instrumentedAttempts: number; historicalResponses: number; unknownUsageAttempts: number;
  reportedTokens: number; instrumentedReportedTokens: number; historicalReportedTokensLowerBound: number;
  inputTokens: number; uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number;
}
const emptyTotals = (): UsageTotals => ({ attempts: 0, instrumentedAttempts: 0, historicalResponses: 0, unknownUsageAttempts: 0,
  reportedTokens: 0, instrumentedReportedTokens: 0, historicalReportedTokensLowerBound: 0, inputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
function addUsage(total: UsageTotals, receipt: UsageReceipt) {
  total.attempts++
  const historical = receipt.source === 'historical-response'
  if (historical) total.historicalResponses++; else total.instrumentedAttempts++
  if (receipt.usage.reportedTokens === null) { total.unknownUsageAttempts++; return }
  total.reportedTokens += receipt.usage.reportedTokens
  if (historical) total.historicalReportedTokensLowerBound += receipt.usage.reportedTokens; else total.instrumentedReportedTokens += receipt.usage.reportedTokens
  for (const field of ['inputTokens', 'uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) total[field] += receipt.usage[field] || 0
}

export async function buildUsageReport(projectRoot = process.cwd(), dailyTarget: number | null = null, onlyRunId?: string) {
  if (dailyTarget !== null && (!Number.isSafeInteger(dailyTarget) || dailyTarget <= 0)) throw new Error('Daily token target is invalid')
  if (onlyRunId && !RUN_ID.test(onlyRunId)) throw new Error('Usage report run ID is invalid')
  const verificationRoot = join(resolve(projectRoot), '.official-harvest/minimax-verification')
  const runIds = onlyRunId ? [onlyRunId] : (await readdir(verificationRoot, { withFileTypes: true })).filter(item => item.isDirectory() && RUN_ID.test(item.name)).map(item => item.name)
  const byAttempt = new Map<string, UsageReceipt>()
  const conflictingAttemptIds = new Set<string>()
  let rejectedReceipts = 0
  let duplicateReceiptCopies = 0
  for (const runId of runIds) {
    const directory = join(verificationRoot, runId)
    const usageDirectory = join(directory, 'usage-receipts')
    for (const file of existsSync(usageDirectory) ? await readdir(usageDirectory) : []) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      try {
        const receipt = await safeJson(directory, join('usage-receipts', file), 128 * 1024) as UsageReceipt
        const metadata = sanitizeMetadata(receipt)
        // Validate stored totals by rehydrating the allowlisted nested counters as well.
        const raw: Record<string, unknown> = Object.fromEntries(Object.entries(receipt.usage.counters).filter(([path]) => !path.includes('.')))
        for (const [path, value] of Object.entries(receipt.usage.counters)) if (path.includes('.')) {
          const [parent, child] = path.split('.')
          const nested = object(raw[parent]) || {}
          nested[child] = value
          raw[parent] = nested
        }
        const checkedUsage = normalizeModelUsage(receipt.usage.status === 'missing' ? null : raw, metadata.apiFormat)
        if (metadata.httpStatus === null && checkedUsage.status !== 'missing') throw new Error('Transport-unknown usage cannot contain measured counters')
        const window = receipt.quotaWindow
        const checkedWindow = window ? admissionWindow({ pool: window.pool, checkedAt: window.checkedAt,
          fiveHour: { startAt: window.startAt, resetAt: window.resetAt, remainingPercent: window.remainingPercent, resetInMs: null } } as QuotaState, metadata.requestedAt) : null
        if (receipt.schemaVersion !== 1 || file !== `${hash(receipt.attemptId)}.json` || receipt.day !== shanghaiUsageDay(metadata.receivedAt) ||
          receipt.requestDay !== shanghaiUsageDay(metadata.requestedAt) || JSON.stringify(checkedUsage) !== JSON.stringify(receipt.usage) ||
          JSON.stringify(checkedWindow) !== JSON.stringify(receipt.quotaWindow)) throw new Error('Usage receipt integrity mismatch')
        const previous = byAttempt.get(receipt.attemptId)
        if (previous) {
          if (JSON.stringify(previous) === JSON.stringify(receipt)) duplicateReceiptCopies++
          else conflictingAttemptIds.add(receipt.attemptId)
        } else byAttempt.set(receipt.attemptId, receipt)
      } catch { rejectedReceipts++ }
    }
  }
  const totals = emptyTotals()
  const daily = new Map<string, UsageTotals>()
  const windows = new Map<string, { startAt: string | null; resetAt: string | null; totals: UsageTotals }>()
  const providersAndModels = new Map<string, { providerId: string | null; model: string; totals: UsageTotals }>()
  const dailyProvidersAndModels = new Map<string, { day: string; providerId: string | null; model: string; totals: UsageTotals }>()
  for (const [id, receipt] of byAttempt) {
    if (conflictingAttemptIds.has(id)) continue
    addUsage(totals, receipt)
    const day = daily.get(receipt.day) || emptyTotals()
    addUsage(day, receipt); daily.set(receipt.day, day)
    const windowKey = receipt.quotaWindow ? `${receipt.quotaWindow.startAt}/${receipt.quotaWindow.resetAt}` : 'unknown'
    const window = windows.get(windowKey) || { startAt: receipt.quotaWindow?.startAt || null, resetAt: receipt.quotaWindow?.resetAt || null, totals: emptyTotals() }
    addUsage(window.totals, receipt); windows.set(windowKey, window)
    const providerKey = `${receipt.providerId || 'unknown'}/${receipt.model}`
    const provider = providersAndModels.get(providerKey) || { providerId: receipt.providerId || null, model: receipt.model, totals: emptyTotals() }
    addUsage(provider.totals, receipt); providersAndModels.set(providerKey, provider)
    const dailyProviderKey = `${receipt.day}/${providerKey}`
    const dailyProvider = dailyProvidersAndModels.get(dailyProviderKey) || { day: receipt.day, providerId: receipt.providerId || null, model: receipt.model, totals: emptyTotals() }
    addUsage(dailyProvider.totals, receipt); dailyProvidersAndModels.set(dailyProviderKey, dailyProvider)
  }
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', dayBasis: 'API response receivedAt; requestDay is preserved on each receipt',
    dailyTarget, serverDashboardBillingTokens: null, planQuotaDebitTokens: null,
    methodology: 'Actual API usage counters only. Historical surviving response files are a lower bound; overwritten responses and errors without usage are unknown. OpenAI cache/reasoning subsets are not added twice. Official preflight windows identify admission, not server billing allocation. API-reported tokens do not establish dashboard billing or Token Plan debit.',
    totals, rejectedReceipts, duplicateReceiptCopies, conflictingAttemptIds: [...conflictingAttemptIds],
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([day, values]) => ({ day, ...values, targetProgress: dailyTarget ? values.reportedTokens / dailyTarget : null, remainingToTarget: dailyTarget ? Math.max(0, dailyTarget - values.reportedTokens) : null })),
    windows: [...windows].map(([id, value]) => ({ id, ...value })), providersAndModels: [...providersAndModels.values()], dailyProvidersAndModels: [...dailyProvidersAndModels.values()], runIds }
}

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--run', '--daily-target', '--seed-historical', '--output'])
  const values = new Map<string, string>()
  let seed = false
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    if (!allowed.has(name) || values.has(name) || (name === '--seed-historical' && seed)) throw new Error('Usage ledger arguments are invalid')
    if (name === '--seed-historical') { seed = true; continue }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('Usage ledger option requires a value')
    values.set(name, value)
  }
  const onlyRunId = values.get('--run')
  if (onlyRunId && !RUN_ID.test(onlyRunId)) throw new Error('Usage report run ID is invalid')
  const target = values.has('--daily-target') ? Number(values.get('--daily-target')) : null
  if (target !== null && (!Number.isSafeInteger(target) || target <= 0)) throw new Error('Daily token target is invalid')
  const projectRoot = process.cwd()
  const verificationRoot = join(projectRoot, '.official-harvest/minimax-verification')
  if (seed) {
    const ids = onlyRunId ? [onlyRunId] : (await readdir(verificationRoot, { withFileTypes: true })).filter(item => item.isDirectory() && RUN_ID.test(item.name)).map(item => item.name)
    const results = []
    for (const id of ids) results.push({ runId: id, ...await seedHistoricalUsage(join(verificationRoot, id)) })
    console.log(JSON.stringify({ historicalSeed: results }))
  }
  const report = await buildUsageReport(projectRoot, target, onlyRunId)
  const output = values.get('--output')
  if (output) {
    const file = resolve(projectRoot, output)
    const inside = relative(resolve(projectRoot), file)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Usage report output must stay inside the project')
    await mkdir(resolve(file, '..'), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }
  console.log(JSON.stringify(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Usage ledger failed'); process.exitCode = 1 })
}
