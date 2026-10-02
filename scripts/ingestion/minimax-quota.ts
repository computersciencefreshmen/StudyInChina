import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { readBoundedBody } from '../../workers/ingestion/src/body'
import { isCurrentQuotaWindow } from './minimax-quota-window'
export { isCurrentQuotaWindow } from './minimax-quota-window'

const QUOTA_ENDPOINTS = new Set([
  'https://www.minimax.cn/v1/token_plan/remains',
  'https://www.minimax.io/v1/token_plan/remains',
])
const MAX_RESPONSE_BYTES = 128 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

export type QuotaApiConfig = {
  endpoint: string
  /** Non-enumerable on configurations returned by this module; never log credentials. */
  key: string
  model: string
  providerId?: string
}

export type QuotaWindow = {
  remainingPercent: number | null
  startAt: string | null
  resetAt: string | null
  resetInMs: number | null
}

export type QuotaState = {
  state: 'available' | 'exhausted' | 'unknown'
  canRun: boolean
  reason: string
  model: string
  pool: 'general'
  checkedAt: string
  fiveHour: QuotaWindow
  weekly: QuotaWindow
  balanceFallbackAllowed: false
}

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
const supportedModel = (value: unknown): value is string => typeof value === 'string' && /^MiniMax-M[\w.-]{1,64}$/.test(value)
const emptyWindow = (): QuotaWindow => ({ remainingPercent: null, startAt: null, resetAt: null, resetInMs: null })
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000
const percent = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null

function unknownQuota(model: string, reason: string, now: number): QuotaState {
  return {
    state: 'unknown', canRun: false, reason, model: supportedModel(model) ? model : 'unknown', pool: 'general',
    checkedAt: new Date(now).toISOString(), fiveHour: emptyWindow(), weekly: emptyWindow(), balanceFallbackAllowed: false,
  }
}

/** Select only the user's current official MiniMax provider, never another provider or a proxy. */
export function quotaConfigFromEnvironment(environment: Record<string, string | undefined>, providerId?: string): QuotaApiConfig {
  const base = environment.ANTHROPIC_BASE_URL
  let url: URL
  try { url = new URL(base || '') } catch { throw new Error('Current Claude provider has no valid official MiniMax endpoint') }
  const hosts = new Set(['api.minimax.cn', 'api.minimaxi.com', 'api.minimax.io'])
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || url.pathname.replace(/\/$/, '') !== '/anthropic') {
    throw new Error('Current Claude provider is not an official MiniMax Anthropic provider')
  }
  const key = environment.ANTHROPIC_AUTH_TOKEN || environment.ANTHROPIC_API_KEY
  if (!key?.trim() || /[\r\n]/.test(key)) throw new Error('Current MiniMax provider has no usable credential')
  const model = environment.ANTHROPIC_MODEL || environment.ANTHROPIC_DEFAULT_SONNET_MODEL || 'MiniMax-M2.7'
  if (!supportedModel(model)) throw new Error('Current Claude provider does not select a MiniMax text model')
  const config = {
    endpoint: url.hostname === 'api.minimax.io' ? 'https://www.minimax.io/v1/token_plan/remains' : 'https://www.minimax.cn/v1/token_plan/remains',
    model, ...(providerId ? { providerId } : {}),
  } as QuotaApiConfig
  Object.defineProperty(config, 'key', { value: key, enumerable: false })
  return config
}

export function getCcSwitchQuotaConfig(): QuotaApiConfig {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(join(homedir(), '.cc-switch', 'cc-switch.db'), { readOnly: true })
    const row = db.prepare("SELECT id, settings_config FROM providers WHERE app_type='claude' AND is_current=1").get()
    if (!row || typeof row.settings_config !== 'string' || typeof row.id !== 'string') throw new Error('Current MiniMax provider unavailable')
    const settings = object(JSON.parse(row.settings_config))
    const environment = object(settings?.env)
    if (!environment) throw new Error('Current MiniMax provider settings unavailable')
    return quotaConfigFromEnvironment(environment as Record<string, string | undefined>, row.id)
  } catch {
    // SQLite and JSON exception text can include private configuration. Never forward it.
    throw new Error('CC Switch current Claude provider is not a usable official MiniMax provider')
  } finally { db?.close() }
}

function windowFrom(row: JsonObject, weekly: boolean, now: number): QuotaWindow {
  const remainingPercent = percent(row[weekly ? 'current_weekly_remaining_percent' : 'current_interval_remaining_percent'])
  const start = row[weekly ? 'weekly_start_time' : 'start_time']
  const end = row[weekly ? 'weekly_end_time' : 'end_time']
  const valid = validTime(start) && validTime(end) && end > start
  return {
    remainingPercent,
    startAt: valid ? new Date(start).toISOString() : null,
    resetAt: valid ? new Date(end).toISOString() : null,
    resetInMs: valid ? Math.max(0, end - now) : null,
  }
}

/**
 * The official Token Plan response reports shared text quota as model_name=general.
 * Remaining percentages are authoritative: count fields can be zero with quota left.
 * Status enums and non-text pools do not establish permission to call a text model.
 */
export function normalizeQuota(payload: unknown, model: string, now = Date.now()): QuotaState {
  const result = unknownQuota(model, 'quota_schema_unknown', now)
  const root = object(payload)
  if (!supportedModel(model) || !root || object(root.base_resp)?.status_code !== 0 || !Array.isArray(root.model_remains)) return result
  const rows = root.model_remains.map(object).filter(row => row?.model_name === 'general')
  if (rows.length !== 1 || !rows[0]) return result
  const row = rows[0]
  result.fiveHour = windowFrom(row, false, now)
  result.weekly = windowFrom(row, true, now)
  if (result.fiveHour.remainingPercent === null || result.weekly.remainingPercent === null) return result
  const start = row.start_time
  const end = row.end_time
  const weeklyStart = row.weekly_start_time
  const weeklyEnd = row.weekly_end_time
  if (!validTime(start) || !validTime(end) || !validTime(weeklyStart) || !validTime(weeklyEnd) || !isCurrentQuotaWindow(result.fiveHour, 'fiveHour', now) || !isCurrentQuotaWindow(result.weekly, 'weekly', now)) {
    result.reason = 'quota_window_unknown_or_expired'
    return result
  }
  if (result.fiveHour.remainingPercent === 0 || result.weekly.remainingPercent === 0) {
    result.state = 'exhausted'
    result.reason = result.weekly.remainingPercent === 0 ? 'weekly_quota_exhausted' : 'five_hour_quota_exhausted'
    return result
  }
  result.state = 'available'
  result.canRun = true
  result.reason = 'plan_quota_available'
  return result
}

export type FetchQuotaOptions = {
  fetcher?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

/** A read-only plan query. There is no purchase, account balance, model, or fallback request. */
export async function fetchQuota(config: QuotaApiConfig, options: FetchQuotaOptions = {}): Promise<QuotaState> {
  const clock = options.now || Date.now
  const model = supportedModel(config.model) ? config.model : 'unknown'
  if (!QUOTA_ENDPOINTS.has(config.endpoint) || !supportedModel(config.model) || typeof config.key !== 'string' || !config.key.trim() || /[\r\n]/.test(config.key)) {
    return unknownQuota(model, 'unsafe_quota_configuration', clock())
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) return unknownQuota(model, 'invalid_quota_timeout', clock())
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await (options.fetcher || fetch)(config.endpoint, {
      method: 'GET', redirect: 'error', signal, cache: 'no-store',
      headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
    })
    if (response.redirected || (response.url && response.url !== config.endpoint)) return unknownQuota(model, 'quota_redirect_rejected', clock())
    if (!response.ok) return unknownQuota(model, `quota_http_${response.status}`, clock())
    const body = await readBoundedBody(response, MAX_RESPONSE_BYTES, signal)
    let payload: unknown
    try { payload = JSON.parse(new TextDecoder().decode(body)) } catch { return unknownQuota(model, 'quota_response_json_invalid', clock()) }
    return normalizeQuota(payload, model, clock())
  } catch {
    // Raw network/body/API error text and response bodies must never enter logs.
    return unknownQuota(model, signal.aborted ? 'quota_timeout' : 'quota_query_failed', clock())
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('npx tsx scripts/ingestion/minimax-quota.ts [--use-ccswitch] (read-only current provider plan quota)')
    return
  }
  if (args.some(arg => arg !== '--use-ccswitch') || args.length > 1) throw new Error('Only --use-ccswitch is supported')
  const quota = await fetchQuota(getCcSwitchQuotaConfig())
  console.log(JSON.stringify(quota))
  process.exitCode = quota.canRun ? 0 : quota.state === 'exhausted' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.log(JSON.stringify(unknownQuota('unknown', 'quota_configuration_unavailable', Date.now())))
    process.exitCode = 1
  })
}
