import { cloudMiniMaxSchema, cloudLedgerSchema, cloudQuotaSchema, unknownCloudQuota, CLOUD_MONITOR_REFRESH_MS, type CloudLedger, type CloudQuotaSnapshot } from '../../../src/lib/admin/cloud-minimax-contract'
import { coverageSnapshotSchema } from '../../catalog-maintenance/src/coverage'
import { canonicalJson } from '../../../scripts/maintenance/contracts'
import type { CatalogApiEnv } from './types'

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const iso = (now: number) => new Date(now).toISOString()
const day = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
const safeModel = (value: string) => value === 'MiniMax-M3' || value === 'MiniMax-M3.1-Flash' || value === 'MiniMax-M3.1-Flash-Preview' ? value : 'other'
const safeCode = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_:.-]{1,120}$/.test(value) ? value : null
type Period = { id: CloudLedger['periods'][number]['id']; startAt: string; endAt: string }
const tokenKeys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
function metric(path: string) {
  return `CASE WHEN json_type(u,'$.${path}') IN('integer','real') AND json_extract(u,'$.${path}')>=0 AND json_extract(u,'$.${path}')<=9007199254740991 AND CAST(json_extract(u,'$.${path}') AS INTEGER)=json_extract(u,'$.${path}') THEN CAST(json_extract(u,'$.${path}') AS INTEGER) END`
}
// One bounded indexed scan per displayed window. SQL projects only safe numeric
// usage; neither raw provider responses, prompts nor private output keys leave D1.
export const CLOUD_USAGE_SQL = `WITH windows AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.startAt') start_at,json_extract(value,'$.endAt') end_at FROM json_each(?)),
  attempts AS NOT MATERIALIZED (SELECT started_at,model,status,CASE WHEN json_valid(usage_json) THEN usage_json ELSE '{}' END u FROM maintenance_model_attempts INDEXED BY maintenance_model_attempt_started),
  metrics AS NOT MATERIALIZED (SELECT *,COALESCE(${metric('input_tokens')},${metric('prompt_tokens')}) input,
    COALESCE(${metric('output_tokens')},${metric('completion_tokens')}) output,
    COALESCE(${metric('cache_read_input_tokens')},${metric('prompt_tokens_details.cached_tokens')}) cacheRead,${metric('cache_creation_input_tokens')} cacheWrite FROM attempts)
  SELECT w.id,CASE WHEN a.model IN('MiniMax-M3','MiniMax-M3.1-Flash','MiniMax-M3.1-Flash-Preview') THEN a.model ELSE 'other' END model,COUNT(*) attempts,
    SUM(a.status='completed') completed,SUM(a.status='unknown') unknown,SUM(a.status='known_failed') knownFailed,SUM(a.status='send_started') sendStarted,SUM(a.status='reserved') reserved,
    SUM(a.input) input,SUM(a.output) output,SUM(a.cacheRead) cacheRead,SUM(a.cacheWrite) cacheWrite,SUM(a.input IS NULL OR a.output IS NULL) unknownUsageAttempts
  FROM windows w CROSS JOIN metrics a ON a.started_at>=w.start_at AND a.started_at<=w.end_at GROUP BY w.id,2`
function emptyCounters(): CloudLedger['periods'][number]['totals'] {
  return { attempts: 0, completed: 0, unknown: 0, knownFailed: 0, sendStarted: 0, reserved: 0, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null, unknownUsageAttempts: 0 } }
}
async function sha256(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('') }
async function coverage(env: CatalogApiEnv, scope: string, catalog: string, ids: Set<string>, now: number): Promise<CloudLedger['coverage']> {
  if (!env.SOURCE_SNAPSHOTS || !env.PIPELINE_DB) return null
  try {
    const pointer = await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='coverage_snapshot' AND json_extract(details_json,'$.scopeRegistrySha256')=? AND json_extract(details_json,'$.inputCatalogSha256')=? ORDER BY observed_at DESC,event_id DESC LIMIT 1").bind(scope, catalog).first<{ details_json: string }>()
    const ref = pointer ? JSON.parse(pointer.details_json) : null
    if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256)) return null
    const object = await env.SOURCE_SNAPSHOTS.get(`maintenance/coverage/${ref.sha256}.json`)
    if (!object?.text || object.size === undefined || object.size > 2 * 1024 * 1024) return null
    const snapshot = coverageSnapshotSchema.parse(JSON.parse(await object.text())), { sha256: hash, ...content } = snapshot
    if (hash !== ref.sha256 || await sha256(canonicalJson(content)) !== hash || snapshot.scopeRegistrySha256 !== scope || snapshot.inputCatalogSha256 !== catalog
      || snapshot.evaluatedOn > day(now) || snapshot.schools.length !== ids.size || new Set(snapshot.schools.map(s => s.universityId)).size !== ids.size || snapshot.schools.some(s => !ids.has(s.universityId))) return null
    return { evaluatedOn: snapshot.evaluatedOn, stale: snapshot.evaluatedOn !== day(now), schools: ids.size,
      zero: snapshot.schools.filter(s => s.currentProgramCount === 0).length, one: snapshot.schools.filter(s => s.currentProgramCount === 1).length,
      twoToFour: snapshot.schools.filter(s => s.currentProgramCount >= 2 && s.currentProgramCount < 5).length, fivePlus: snapshot.schools.filter(s => s.currentProgramCount >= 5).length,
      currentPrograms: snapshot.schools.reduce((n, s) => n + s.currentProgramCount, 0), currentScholarships: snapshot.schools.reduce((n, s) => n + s.currentScholarshipCount, 0) }
  } catch { return null }
}
export async function readCloudLedger(env: CatalogApiEnv, quota: CloudQuotaSnapshot, now: number): Promise<CloudLedger> {
  const db = env.PIPELINE_DB
  if (!db) throw new Error('binding_missing')
  const today = day(now), endAt = iso(now)
  const periods: Period[] = [{ id: 'today', startAt: iso(Date.parse(`${today}T00:00:00+08:00`)), endAt }, { id: 'recent-seven-days', startAt: iso(now - 7 * 86400000), endAt }]
  if (quota.fiveHour && Date.parse(quota.fiveHour.startAt) <= now && Date.parse(quota.fiveHour.resetAt) > now) periods.push({ id: 'five-hour', startAt: quota.fiveHour.startAt, endAt })
  if (quota.weekly && !quota.weekly.unlimited && quota.weekly.startAt && quota.weekly.resetAt && Date.parse(quota.weekly.startAt) >= now - 8 * 86400000 && Date.parse(quota.weekly.resetAt) > now) periods.push({ id: 'weekly', startAt: quota.weekly.startAt, endAt })
  const since = iso(now - 7 * 86400000)
  const [aggregate, recent, jobs, cfg] = await Promise.all([
    db.prepare(CLOUD_USAGE_SQL).bind(JSON.stringify(periods)).all<Record<string, string | number | null>>(),
    db.prepare('SELECT attempt_id,model,status,started_at,completed_at,pass,error_code FROM maintenance_model_attempts INDEXED BY maintenance_model_attempt_started WHERE started_at>=? AND started_at<=? ORDER BY started_at DESC,attempt_id DESC LIMIT 12').bind(since, endAt).all<Record<string, string | null>>(),
    db.prepare('SELECT job_id,stage,status,updated_at,error_code FROM maintenance_jobs INDEXED BY maintenance_job_updated WHERE updated_at>=? AND updated_at<=? ORDER BY updated_at DESC,job_id DESC LIMIT 10').bind(since, endAt).all<Record<string, string | null>>(),
    db.prepare('SELECT enabled,models_enabled,targets_complete,scope_sha256,input_catalog_sha256,revision FROM maintenance_control WHERE singleton=1').first<{ enabled: number; models_enabled: number; targets_complete: number; scope_sha256: string; input_catalog_sha256: string; revision: number }>(),
  ])
  if (!cfg || !aggregate.success || !recent.success || !jobs.success) throw new Error('backend_unavailable')
  const schoolRows = await db.prepare('SELECT university_id FROM maintenance_schools WHERE scope_sha256=?').bind(cfg.scope_sha256).all<{ university_id: string }>()
  if (!schoolRows.success) throw new Error('backend_unavailable')
  const ids = new Set((schoolRows.results ?? []).map(s => s.university_id))
  const resultPeriods = periods.map(p => {
    const models = (aggregate.results ?? []).filter(row => row.id === p.id).map(row => ({ model: safeModel(String(row.model)), attempts: row.attempts, completed: row.completed, unknown: row.unknown,
      knownFailed: row.knownFailed, sendStarted: row.sendStarted, reserved: row.reserved,
      tokens: { input: row.input, output: row.output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, unknownUsageAttempts: row.unknownUsageAttempts } }))
    const totals = emptyCounters()
    for (const m of models) {
      for (const key of ['attempts', 'completed', 'unknown', 'knownFailed', 'sendStarted', 'reserved'] as const) totals[key] += Number(m[key])
      totals.tokens.unknownUsageAttempts += Number(m.tokens.unknownUsageAttempts)
      for (const key of tokenKeys) if (m.tokens[key] !== null) totals.tokens[key] = (totals.tokens[key] ?? 0) + Number(m.tokens[key])
    }
    return { ...p, totals, models }
  })
  return cloudLedgerSchema.parse({ observedAt: endAt, timezone: 'Asia/Shanghai', today, periods: resultPeriods,
    control: { enabled: cfg.enabled === 1, modelsEnabled: cfg.models_enabled === 1, targetsReady: cfg.targets_complete === 1, scopeCount: ids.size, revision: cfg.revision },
    recentAttempts: (recent.results ?? []).map(r => ({ attemptId: r.attempt_id, model: safeModel(String(r.model)), status: r.status, startedAt: r.started_at, completedAt: r.completed_at, pass: r.pass, errorCode: safeCode(r.error_code) })),
    recentJobs: (jobs.results ?? []).map(r => ({ id: r.job_id, stage: r.stage, status: r.status, updatedAt: r.updated_at, errorCode: safeCode(r.error_code) })),
    coverage: await coverage(env, cfg.scope_sha256, cfg.input_catalog_sha256, ids, now) })
}
type Cache = { until: number; ledger: CloudLedger | null; pending?: Promise<CloudLedger | null>; failed: boolean }
const cache = new WeakMap<CatalogApiEnv, Cache>()
export async function handleAdminMiniMaxMonitor(request: Request, env: CatalogApiEnv, now = Date.now()): Promise<Response> {
  const token = env.ADMIN_TELEMETRY_TOKEN, expected = `Bearer ${token ?? ''}`, supplied = request.headers.get('authorization') ?? ''
  let mismatch = expected.length ^ supplied.length
  for (let i = 0; i < Math.max(expected.length, supplied.length); i++) mismatch |= (expected.charCodeAt(i) || 0) ^ (supplied.charCodeAt(i) || 0)
  if (!token || token.length < 32 || mismatch !== 0) return Response.json({ error: 'forbidden' }, { status: 403, headers })
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } })
  let quota = unknownCloudQuota(now)
  try { if (env.MAINTENANCE_MONITOR) quota = cloudQuotaSchema.parse(await env.MAINTENANCE_MONITOR.readQuota()) } catch { /* Preserve ledger availability independently. */ }
  let entry = cache.get(env)
  if (!entry) { entry = { until: 0, ledger: null, failed: false }; cache.set(env, entry) }
  if (!entry.pending && entry.until <= now) {
    const current = entry
    current.pending = readCloudLedger(env, quota, now).then(value => { current.ledger = value; current.failed = false; current.until = now + CLOUD_MONITOR_REFRESH_MS; return value }, () => { current.failed = true; current.until = now + 15_000; return current.ledger }).finally(() => { current.pending = undefined })
  }
  if (entry.pending) await entry.pending
  const ledgerState = !entry.ledger ? 'unavailable' : entry.failed || now - Date.parse(entry.ledger.observedAt) > 120_000 ? 'stale' : 'fresh'
  const result = cloudMiniMaxSchema.parse({ version: 1, generatedAt: iso(now), quota, ledgerState, ledger: entry.ledger,
    code: !env.PIPELINE_DB ? 'binding_missing' : entry.failed ? 'backend_unavailable' : 'observed', modelCallsPerformed: false })
  return Response.json(result, { headers })
}
