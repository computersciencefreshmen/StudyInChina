import { OPERATIONS_QUERIES, operationsParameters } from '../../workers/shared/operations-queries'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildComprehensiveDataAudit, readAuditData } from '../quality/comprehensive-data-audit'
import { evaluateP0Reliability, P0_OBSERVATION_FORMAT } from '../operations/evaluate-p0-reliability.mjs'
import { getTodayDate } from '../../src/lib/data/freshness'
import type { DataBundle } from '../../src/lib/data/types'

type Row = Record<string, unknown>
type Status = 'pass' | 'fail' | 'unobserved'
type Observation = { state: 'observed' | 'not_configured' | 'unavailable' | 'invalid'; rows?: Row[] }
export type HealthCheck = { id: string; status: Status; code: string; value: unknown; detail: string }
export type WorkflowSpec = { file: string; maxAgeHours: number }
export type OperationsOptions = {
  root: string; remote: boolean; wrangler?: boolean; operationsUrl?: string; databaseId?: string; githubRepo?: string; releaseUrl?: string;
  expectedBackend: 'json' | 'shadow' | 'd1'; output?: string; previous?: string; p0Input?: string;
  reportOnly: boolean; workflows: WorkflowSpec[];
}
type Dependencies = { fetch?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; now?: Date; data?: DataBundle; runWrangler?: (args: string[]) => Promise<string> }

export const SERVICES = ['ingestion', 'entity-materializer', 'publisher', 'release-builder'] as const
export const DEFAULT_WORKFLOWS: WorkflowSpec[] = [
  { file: 'data-health.yml', maxAgeHours: 30 },
  { file: 'program-fact-refresh.yml', maxAgeHours: 48 },
  { file: 'autonomous-catalog.yml', maxAgeHours: 30 },
  { file: 'official-catalog-harvest.yml', maxAgeHours: 192 },
  { file: 'cloudflare-backup.yml', maxAgeHours: 30 },
  { file: 'cloudflare-restore-drill.yml', maxAgeHours: 2_280 },
]

// Fixed, parameter-bound SELECT statements only. No credentials or arbitrary SQL are accepted by the CLI.
export { OPERATIONS_QUERIES } from '../../workers/shared/operations-queries'

function record(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}
function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const milliseconds = Date.parse(normalized)
  return Number.isFinite(milliseconds) ? milliseconds : null
}
function ageHours(value: unknown, now: number): number | null {
  const timestamp = instant(value)
  return timestamp === null || timestamp > now ? null : (now - timestamp) / 3_600_000
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json') || !response.body) throw new Error('invalid_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2_000_000) { await reader.cancel(); throw new Error('response_too_large') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function collectOperationsHealth(options: OperationsOptions, dependencies: Dependencies = {}) {
  const fetcher = dependencies.fetch ?? fetch
  const environment = dependencies.env ?? process.env
  const now = dependencies.now ?? new Date()
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid evaluation date')
  const nowIso = now.toISOString()
  const today = getTodayDate(now)
  const checks: HealthCheck[] = []
  const add = (id: string, status: Status, code: string, value: unknown, detail: string) => checks.push({ id, status, code, value, detail })
  const queryParameters = operationsParameters(now)
  const account = environment.CLOUDFLARE_ACCOUNT_ID
  const token = environment.CLOUDFLARE_API_TOKEN
  const configured = Boolean(options.remote && token && account && /^[a-f0-9]{32}$/i.test(account)
    && options.databaseId && /^[a-f0-9-]{36}$/i.test(options.databaseId))
  let workerObservations: Record<string, Observation> | undefined
  if (options.operationsUrl) {
    try {
      const url = new URL(options.operationsUrl)
      const host = environment.INGESTION_TOKEN_HOST ?? 'studyinchina-ingestion.13022037121.workers.dev'
      if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port || url.search || url.hash || !['/', '/operations'].includes(url.pathname)) throw new Error('unsafe_operations_origin')
      url.pathname = '/operations'
      if (!environment.INGESTION_ADMIN_TOKEN) throw new Error('missing_operations_token')
      const response = await fetcher(url, { headers: { Authorization: 'Bearer ' + environment.INGESTION_ADMIN_TOKEN }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) })
      const payload = record(await boundedJson(response))
      if (!response.ok || payload?.format !== 'studyinchina.operations-observations' || instant(payload.observedAt) === null || +now - instant(payload.observedAt)! < -60000 || +now - instant(payload.observedAt)! > 900000) throw new Error('invalid_operations_response')
      workerObservations = record(payload.observations) as Record<string, Observation> | null ?? undefined
    } catch { workerObservations = {} }
  }
  const query = async (key: keyof typeof OPERATIONS_QUERIES): Promise<Observation> => {
    if (options.operationsUrl) {
      const observation = workerObservations?.[key]
      return observation?.state === 'observed' && Array.isArray(observation.rows) && observation.rows.every(record) ? observation : { state: 'unavailable' }
    }
    if (options.wrangler) {
      try {
        const sql = OPERATIONS_QUERIES[key].replace(/\?(\d+)/g, (_, index: string) => "'" + queryParameters[key][Number(index) - 1] + "'")
        const args = [resolve(options.root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'INGESTION_DB', '--config', resolve(options.root, 'workers/ingestion/wrangler.jsonc'), '--remote', '--command', sql, '--json']
        const stdout = dependencies.runWrangler ? await dependencies.runWrangler(args)
          : (await promisify(execFile)(process.execPath, args, { cwd: options.root, shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 2_000_000 })).stdout
        const body = JSON.parse(stdout)
        const result = Array.isArray(body) ? record(body[0]) : null
        if (result?.success !== true || !Array.isArray(result.results) || !result.results.every(record)) return { state: 'invalid' }
        return { state: 'observed', rows: result.results as Row[] }
      } catch (error) {
        const failure = record(error)
        const message = [error instanceof Error ? error.message : '', failure?.stdout, failure?.stderr].filter(value => typeof value === 'string').join('\n')
        return { state: /no such table/i.test(message) ? 'not_configured' : 'unavailable' }
      }
    }
    if (!configured) return { state: 'not_configured' }
    try {
      const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${options.databaseId}/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: OPERATIONS_QUERIES[key], params: queryParameters[key] }),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      })
      const body = record(await boundedJson(response))
      if (!response.ok || body?.success !== true) {
        return { state: /no such table/i.test(JSON.stringify(body?.errors ?? [])) ? 'not_configured' : 'unavailable' }
      }
      const result = Array.isArray(body.result) ? record(body.result[0]) : null
      if (result?.success !== true || !Array.isArray(result.results) || !result.results.every(record)) {
        return { state: /no such table/i.test(JSON.stringify(result?.error ?? '')) ? 'not_configured' : 'invalid' }
      }
      return { state: 'observed', rows: result.results as Row[] }
    } catch { return { state: 'unavailable' } }
  }
  const keys = Object.keys(OPERATIONS_QUERIES) as (keyof typeof OPERATIONS_QUERIES)[]
  const entries: [typeof keys[number], Observation][] = []
  // Wrangler shares its local OAuth refresh cache, so avoid concurrent CLI writes to that cache.
  if (options.wrangler) { for (const key of keys) entries.push([key, await query(key)]) }
  else entries.push(...await Promise.all(keys.map(async key => [key, await query(key)] as [typeof keys[number], Observation])))
  const observations = Object.fromEntries(entries) as Record<typeof keys[number], Observation>
  for (const key of keys) {
    const observation = observations[key]
    add(`pipeline.${key}.observation`, observation.state === 'observed' ? 'pass' : 'unobserved', observation.state, null,
      observation.state === 'observed' ? 'Read-only Pipeline D1 query completed.' : 'Runtime state is unavailable; missing credentials or schema never mean an empty queue.')
  }
  const numeric = (key: keyof typeof OPERATIONS_QUERIES, field: string, id: string, maximum: number, detail: string) => {
    const value = count(observations[key].rows?.[0]?.[field])
    add(id, value === null ? 'unobserved' : value > maximum ? 'fail' : 'pass', value === null ? 'missing_metric' : value > maximum ? 'threshold_exceeded' : 'within_threshold', value, detail)
  }
  const backlog = (key: 'jobs' | 'outbox' | 'entities', countField: string, timestampField: string, maximum: number) => {
    const row = observations[key].rows?.[0]
    const quantity = count(row?.[countField])
    const age = ageHours(row?.[timestampField], now.valueOf())
    const valid = quantity !== null && (quantity === 0 ? row?.[timestampField] === null : age !== null)
    add(`pipeline.${key}.backlog_age`, !valid ? 'unobserved' : quantity! > 0 && age! >= maximum ? 'fail' : 'pass', !valid ? 'invalid_backlog' : quantity! > 0 && age! >= maximum ? 'stalled_backlog' : 'within_threshold',
      { count: quantity, oldestAt: valid ? row?.[timestampField] : null }, `Oldest pending work must be younger than ${maximum} hours; an empty backlog requires explicit count zero and null time.`)
  }
  numeric('jobs', 'stuck_count', 'ingestion.stuck_running', 0, 'Running ingestion jobs must make progress within two hours.')
  numeric('jobs', 'failed_recent_count', 'ingestion.failed_recent', 0, 'Terminal ingestion failures in the last 24 hours require automatic retry or investigation.')
  numeric('jobs', 'exhausted_recent_count', 'ingestion.retry_exhausted', 0, 'Jobs reaching four attempts and terminal failure in the last 24 hours need recovery.')
  const enabledSources = count(observations.sources.rows?.[0]?.enabled_count)
  add('sources.enabled_registry', enabledSources === null ? 'unobserved' : enabledSources === 0 ? 'fail' : 'pass', enabledSources === null ? 'missing_metric' : enabledSources === 0 ? 'empty_registry' : 'sources_registered', enabledSources, 'The automation must have at least one enabled official source to monitor.')
  numeric('sources', 'overdue_count', 'sources.overdue_fetch', 0, 'Enabled sources must not remain unattempted or overdue for more than 24 hours.')
  numeric('sources', 'repeatedly_failed_count', 'sources.repeated_failures', 0, 'Sources with four consecutive failures need a recovery plan, not another invented verification date.')
  numeric('outbox', 'dead_letter_count', 'release.dead_letters', 0, 'Terminal release outbox events must be recovered; this is not a Cloudflare Queue DLQ metric.')
  numeric('outbox', 'expired_lease_count', 'release.expired_leases', 0, 'Expired processing leases indicate interrupted work awaiting scheduler recovery.')
  numeric('retries', 'repeatedly_failed_count', 'automation.repeated_failures', 0, 'Four or more automatic retry failures indicate a persistent operational problem; they never approve evidence.')
  numeric('retries', 'overdue_count', 'automation.overdue_retries', 0, 'Due automatic retries must be attempted within two hours of their scheduled retry time.')
  numeric('evidence', 'overdue_count', 'pipeline.overdue_evidence', 0, 'Validated, applied or published canonical records must not retain overdue evidence as current.')
  backlog('jobs', 'active_count', 'oldest_active_at', 2)
  backlog('outbox', 'pending_count', 'oldest_pending_at', 168)
  backlog('entities', 'pending_count', 'oldest_pending_at', 24)

  const heartbeatRows = observations.heartbeats.rows ?? []
  for (const service of SERVICES) {
    const row = heartbeatRows.find(item => item.service_name === service)
    const age = ageHours(row?.last_succeeded_at, now.valueOf())
    const start = instant(row?.last_started_at)
    const valid = row && age !== null && start !== null && start <= now.valueOf()
    const failure = Boolean(row?.last_error_code)
    add(`scheduler.${service}`, failure ? 'fail' : !valid ? 'unobserved' : age! > 1.5 ? 'fail' : 'pass', failure ? 'last_run_failed' : !valid ? 'missing_successful_heartbeat' : age! > 1.5 ? 'scheduler_stopped' : 'within_threshold',
      { lastStartedAt: valid ? row.last_started_at : null, lastSucceededAt: valid ? row.last_succeeded_at : null, lastRunFailed: failure },
      'A successful persisted scheduler run must be observed within 90 minutes. HTTP /health and an idle job table are not scheduler evidence.')
  }

  let publicRelease: Row | null = null
  if (options.releaseUrl) {
    try {
      const url = new URL(options.releaseUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid_release_url')
      const response = await fetcher(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } })
      const body = record(await boundedJson(response))
      const release = record(body?.data)
      if (!response.ok || typeof release?.id !== 'string' || !['json', 'shadow', 'd1'].includes(String(release.catalogBackend))) throw new Error('invalid_release')
      publicRelease = { id: release.id.slice(0, 200), catalogBackend: release.catalogBackend, evaluatedForDate: release.evaluatedForDate, activatedAt: release.activatedAt }
      add('publication.backend', release.catalogBackend === options.expectedBackend ? 'pass' : 'fail', release.catalogBackend === options.expectedBackend ? 'expected_backend' : 'publication_backend_mismatch', release.catalogBackend,
        `Expected ${options.expectedBackend}. A working Pipeline does not prove its changes reach a JSON-backed website.`)
      add('publication.evaluation_date', release.evaluatedForDate === today ? 'pass' : 'fail', release.evaluatedForDate === today ? 'current_date' : 'stale_public_projection', typeof release.evaluatedForDate === 'string' ? release.evaluatedForDate.slice(0, 10) : null,
        'The public release must evaluate deadline and review states for the current China calendar date.')
    } catch { add('publication.observation', 'unobserved', 'unavailable', null, 'Public release JSON could not be verified; login HTML and redirects are not successful publication.') }
  } else add('publication.observation', 'unobserved', 'not_configured', null, 'Supply --release-url to verify what applicants actually receive.')

  await Promise.all(options.workflows.map(async workflow => {
    const id = `workflow.${workflow.file}`
    if (!options.githubRepo) { add(id, 'unobserved', 'not_configured', null, 'Supply --github-repo to verify scheduled workflow execution.'); return }
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
      const githubToken = environment.GH_TOKEN ?? environment.GITHUB_TOKEN
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`
      const response = await fetcher(`https://api.github.com/repos/${options.githubRepo}/actions/workflows/${workflow.file}/runs?branch=main&per_page=20`, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      const body = record(await boundedJson(response))
      if (!response.ok || !Array.isArray(body?.workflow_runs)) throw new Error('workflow_unavailable')
      const runs = body.workflow_runs.map(record).filter((run): run is Row => Boolean(run))
      const latest = runs[0]
      const successful = runs.find(run => run.status === 'completed' && run.conclusion === 'success')
      const age = ageHours(successful?.updated_at, now.valueOf())
      const latestAge = ageHours(latest?.run_started_at ?? latest?.created_at, now.valueOf())
      const failed = latest?.status === 'completed' && latest.conclusion !== 'success'
      const stalled = latest && latest.status !== 'completed' && latestAge !== null && latestAge >= 6
      const valid = age !== null
      add(id, failed || stalled ? 'fail' : !valid ? 'unobserved' : age > workflow.maxAgeHours ? 'fail' : 'pass', failed ? 'latest_run_failed' : stalled ? 'workflow_stalled' : !valid ? 'no_recent_success_observed' : age > workflow.maxAgeHours ? 'schedule_overdue' : 'within_threshold',
        { lastSuccessfulAt: successful?.updated_at ?? null, latestRunId: typeof latest?.id === 'number' ? latest.id : null, conclusion: typeof latest?.conclusion === 'string' ? latest.conclusion.slice(0, 40) : null },
        `A main-branch successful run is required within ${workflow.maxAgeHours} hours. Workflow success alone is not backup readback proof.`)
    } catch { add(id, 'unobserved', 'unavailable', null, 'Workflow runs could not be verified; missing access and missing deployments remain explicit.') }
  }))

  let contentSummary: ReturnType<typeof buildComprehensiveDataAudit>['summary'] | null = null
  try {
    contentSummary = buildComprehensiveDataAudit(dependencies.data ?? readAuditData(options.root), today).summary
    add('content.schema', contentSummary.schemaValid ? 'pass' : 'fail', contentSummary.schemaValid ? 'valid' : 'schema_invalid', contentSummary.schemaValid, 'Reuse the comprehensive audit schema and provenance checks.')
    add('content.verified_overdue', contentSummary.verifiedOverdue ? 'fail' : 'pass', contentSummary.verifiedOverdue ? 'overdue_current_claims' : 'within_threshold', contentSummary.verifiedOverdue, 'No verified record may retain evidence past its review date.')
    const stale = contentSummary.findingsByCode.stale_evidence ?? 0
    add('content.review_backlog', stale ? 'fail' : 'pass', stale ? 'stale_evidence_backlog' : 'within_threshold', stale, 'Stale identities remain discoverable, but their evidence backlog still needs automated re-verification.')
  } catch { add('content.observation', 'unobserved', 'invalid_local_data', null, 'Local catalogue data could not be audited; no completeness claim is made.') }

  const p0: Row = { format: P0_OBSERVATION_FORMAT, formatVersion: 1, observedAt: nowIso }
  if (options.p0Input) {
    try {
      const extra = record(JSON.parse(readFileSync(resolve(options.p0Input), 'utf8')))
      const evaluation = evaluateP0Reliability(extra, now)
      if (evaluation.checks.find(check => check.id === 'input_contract')?.status !== 'pass'
        || evaluation.checks.find(check => check.id === 'observation_freshness')?.status !== 'pass') throw new Error('stale_observations')
      p0.backup = extra?.backup
      p0.dlq = extra?.dlq
    } catch { add('p0.extra_observations', 'unobserved', 'invalid_or_stale', null, 'Additional backup/DLQ observations must use the existing P0 contract and be at most 15 minutes old.') }
  }
  const ingestionHeartbeat = heartbeatRows.find(row => row.service_name === 'ingestion')
  if (ingestionHeartbeat) p0.scheduler = { source: 'pipeline-d1:automation-service-runs/ingestion', lastHeartbeatAt: ingestionHeartbeat.last_succeeded_at }
  const outbox = observations.outbox.rows?.[0]
  if (outbox) p0.outbox = { source: 'pipeline-d1:outbox-events/pending', backlogCount: outbox.pending_count, oldestPendingAt: outbox.oldest_pending_at }
  if (publicRelease?.catalogBackend === 'd1') p0.release = { source: 'public-catalog:release/active', lastActivatedAt: publicRelease.activatedAt }
  const reliability = evaluateP0Reliability(p0, now)
  for (const check of reliability.checks) add(`p0.${check.id}`, check.status, check.status, check.status === 'pass' ? null : check.observedAt, check.detail)
  const summary = checks.reduce((totals, check) => { totals[check.status] += 1; return totals }, { pass: 0, fail: 0, unobserved: 0 })
  const incidents = checks.filter(check => check.status !== 'pass').map(({ id, status, code, value }) => ({ id, status, code, value: id.startsWith('scheduler.') ? { lastSucceededAt: record(value)?.lastSucceededAt, lastRunFailed: record(value)?.lastRunFailed } : value })).sort((a, b) => a.id.localeCompare(b.id))
  const fingerprint = createHash('sha256').update(JSON.stringify(incidents)).digest('hex')
  let previousFingerprint: string | null = null
  if (options.previous) { try { const previous = record(JSON.parse(readFileSync(resolve(options.previous), 'utf8'))); previousFingerprint = typeof previous?.fingerprint === 'string' ? previous.fingerprint : null } catch { /* A missing checkpoint is a first observation, never a healthy result. */ } }
  return {
    format: 'studyinchina.automation-operations-health', formatVersion: 1, evaluatedAt: nowIso,
    status: summary.fail || summary.unobserved ? 'fail' : 'pass', summary, fingerprint,
    notification: { changed: previousFingerprint !== fingerprint, actionable: incidents.length > 0, recovered: previousFingerprint !== null && previousFingerprint !== fingerprint && incidents.length === 0 },
    scope: { requestedRemote: options.remote || Boolean(options.wrangler) || Boolean(options.operationsUrl), observationTransport: options.operationsUrl ? 'authenticated-worker' : options.wrangler ? 'wrangler-cli' : 'cloudflare-rest', pipelineObserved: observations.heartbeats.state === 'observed', expectedBackend: options.expectedBackend, productionRunningClaim: false },
    publicRelease, contentSummary, reliability, checks,
  }
}

export function parseOperationsArguments(args: string[]): OperationsOptions {
  const options: OperationsOptions = { root: process.cwd(), remote: false, expectedBackend: 'd1', reportOnly: false, workflows: DEFAULT_WORKFLOWS.map(item => ({ ...item })) }
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--wrangler') { options.wrangler = true; options.remote = true; continue }
    if (flag === '--operations-url') { const value = args[++index]; if (!value || value.startsWith('--')) throw new Error('A CLI option requires a value'); options.operationsUrl = value; options.remote = true; continue }
    if (flag === '--remote') { options.remote = true; continue }
    if (flag === '--report-only') { options.reportOnly = true; continue }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('A CLI option requires a value')
    if (flag === '--root') options.root = resolve(value)
    else if (flag === '--database-id') options.databaseId = value
    else if (flag === '--github-repo') options.githubRepo = value
    else if (flag === '--release-url') options.releaseUrl = value
    else if (flag === '--output') options.output = resolve(value)
    else if (flag === '--previous') options.previous = resolve(value)
    else if (flag === '--p0-input') options.p0Input = resolve(value)
    else if (flag === '--expected-backend' && ['json', 'shadow', 'd1'].includes(value)) options.expectedBackend = value as OperationsOptions['expectedBackend']
    else if (flag === '--workflow') {
      const [file, age] = value.split(':')
      if (!/^[a-z0-9][a-z0-9_.-]*\.ya?ml$/i.test(file) || !Number.isFinite(Number(age)) || Number(age) <= 0) throw new Error('Invalid workflow specification')
      options.workflows = [...options.workflows.filter(item => item.file !== file), { file, maxAgeHours: Number(age) }]
    } else throw new Error('Unknown CLI option')
  }
  if (options.databaseId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options.databaseId)) throw new Error('Invalid D1 database identifier')
  if (options.githubRepo && !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(options.githubRepo)) throw new Error('Invalid GitHub repository')
  for (const input of [options.previous, options.p0Input]) if (input && input === options.output) throw new Error('Output must not overwrite input evidence')
  return options
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void (async () => {
    const options = parseOperationsArguments(process.argv.slice(2))
    const report = await collectOperationsHealth(options)
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (options.output) { mkdirSync(dirname(options.output), { recursive: true }); writeFileSync(options.output, json) }
    process.stdout.write(json)
    if (!options.reportOnly && report.status !== 'pass') process.exitCode = 1
  })().catch(() => {
    process.stderr.write('Operations health check could not complete; check configuration and local paths. No runtime health claim was made.\n')
    process.exitCode = 1
  })
}
