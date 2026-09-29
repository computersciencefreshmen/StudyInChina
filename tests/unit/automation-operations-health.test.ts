import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { collectOperationsHealth, OPERATIONS_QUERIES, parseOperationsArguments, SERVICES, type OperationsOptions } from '../../scripts/automation/operations-health'
import { P0_OBSERVATION_FORMAT } from '../../scripts/operations/evaluate-p0-reliability.mjs'
import type { DataBundle } from '../../src/lib/data/types'

const now = new Date('2026-09-16T08:00:00.000Z')
const recent = '2026-09-16T07:50:00.000Z'
const environment = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'do-not-leak-secret', GH_TOKEN: 'do-not-leak-github' }
const data: DataBundle = { sources: [], cities: [], universities: [], programs: [], admissionCycles: [], scholarships: [] }
const folders: string[] = []
const temporary = () => { const folder = mkdtempSync(join(tmpdir(), 'operations-health-')); folders.push(folder); return folder }
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

type Rows = Record<keyof typeof OPERATIONS_QUERIES, Record<string, unknown>[]>
function healthyRows(): Rows {
  return {
    heartbeats: SERVICES.map(service => ({ service_name: service, last_started_at: recent, last_succeeded_at: recent, last_error_code: null, updated_at: recent })),
    jobs: [{ active_count: 0, oldest_active_at: null, stuck_count: 0, failed_recent_count: 0, exhausted_recent_count: 0 }],
    sources: [{ enabled_count: 1, due_count: 0, overdue_count: 0, repeatedly_failed_count: 0 }],
    outbox: [{ pending_count: 0, oldest_pending_at: null, dead_letter_count: 0, expired_lease_count: 0 }],
    entities: [{ pending_count: 0, oldest_pending_at: null }],
    retries: [{ pending_count: 0, repeatedly_failed_count: 0, overdue_count: 0 }],
    evidence: [{ overdue_count: 0 }],
  }
}
function options(extra: Partial<OperationsOptions> = {}): OperationsOptions {
  return { root: process.cwd(), remote: true, databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', githubRepo: 'owner/repo', releaseUrl: 'https://catalog.example/api/v1/releases/current', expectedBackend: 'd1', reportOnly: false, workflows: [{ file: 'data-health.yml', maxAgeHours: 30 }], ...extra }
}
function p0Evidence(observedAt = now.toISOString()) {
  const path = join(temporary(), 'p0.json')
  writeFileSync(path, JSON.stringify({ format: P0_OBSERVATION_FORMAT, formatVersion: 1, observedAt,
    backup: { source: 'r2:backup/readback', lastVerifiedAt: recent },
    dlq: { source: 'cloudflare-queues:dlq/metrics', backlogCount: 0, oldestMessageAt: null },
  }))
  return path
}
function mockFetcher(rows = healthyRows(), settings: { backend?: string; releaseResponse?: Response; workflows?: Record<string, unknown>[]; missingTable?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith('https://api.cloudflare.com/')) {
      const request = JSON.parse(String(init?.body))
      const key = (Object.keys(OPERATIONS_QUERIES) as (keyof typeof OPERATIONS_QUERIES)[]).find(key => OPERATIONS_QUERIES[key] === request.sql)
      if (!key) throw new Error('Unexpected SQL')
      if (key === 'heartbeats' && settings.missingTable) return Response.json({ success: false, errors: [{ message: 'no such table: automation_service_runs; do-not-leak-secret' }] }, { status: 400 })
      return Response.json({ success: true, result: [{ success: true, results: rows[key] }] })
    }
    if (url.startsWith('https://api.github.com/')) return Response.json({ workflow_runs: settings.workflows ?? [{ id: 1, status: 'completed', conclusion: 'success', updated_at: recent, run_started_at: recent }] })
    return settings.releaseResponse ?? Response.json({ data: { id: 'release-1', catalogBackend: settings.backend ?? 'd1', evaluatedForDate: '2026-09-16', activatedAt: recent } })
  }) as typeof fetch
  return { fetcher, calls }
}
function check(report: Awaited<ReturnType<typeof collectOperationsHealth>>, id: string) {
  const item = report.checks.find(item => item.id === id)
  expect(item, `Missing check: ${id}`).toBeDefined()
  return item!
}

describe('automation operations health', () => {
  it('requires observations instead of treating an unconfigured runtime as healthy', async () => {
    const { fetcher, calls } = mockFetcher()
    const report = await collectOperationsHealth(options({ remote: false, githubRepo: undefined, releaseUrl: undefined }), { fetch: fetcher, env: {}, now, data })
    expect(calls).toHaveLength(0)
    expect(report.status).toBe('fail')
    expect(check(report, 'pipeline.heartbeats.observation')).toMatchObject({ status: 'unobserved', code: 'not_configured' })
    expect(check(report, 'pipeline.outbox.backlog_age').status).toBe('unobserved')
    expect(check(report, 'p0.dlq_backlog').status).toBe('unobserved')
    expect(report.scope.productionRunningClaim).toBe(false)
  })

  it('passes only with fresh persisted runs, workflows, publication and backup/DLQ evidence', async () => {
    const { fetcher, calls } = mockFetcher()
    const report = await collectOperationsHealth(options({ p0Input: p0Evidence() }), { fetch: fetcher, env: environment, now, data })
    expect(report.checks.filter(item => item.status !== 'pass')).toEqual([])
    expect(report.status).toBe('pass')
    expect(JSON.stringify(report)).not.toContain('do-not-leak')
    for (const call of calls) {
      expect(call.init?.redirect).toBe('error')
      if (call.url.startsWith('https://api.cloudflare.com/')) {
        const request = JSON.parse(String(call.init?.body))
        expect(request.sql).toMatch(/^SELECT /)
        expect(request.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/)
        expect(request.params.every((value: unknown) => typeof value === 'string')).toBe(true)
      } else if (!call.url.startsWith('https://api.github.com/')) expect(call.init?.headers).not.toHaveProperty('Authorization')
    }
  })

  it('detects stopped services, terminal attempts, persistent retries and aged materialization work', async () => {
    const rows = healthyRows()
    rows.heartbeats[0].last_succeeded_at = '2026-09-16T05:00:00Z'
    rows.jobs[0].stuck_count = 2
    rows.jobs[0].failed_recent_count = 1
    rows.jobs[0].exhausted_recent_count = 1
    rows.outbox[0].dead_letter_count = 1
    rows.entities[0] = { pending_count: 3, oldest_pending_at: '2026-09-15T07:00:00Z' }
    rows.retries[0] = { pending_count: 2, repeatedly_failed_count: 1, overdue_count: 1 }
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher(rows).fetcher, env: environment, now, data })
    expect(check(report, 'scheduler.ingestion').code).toBe('scheduler_stopped')
    for (const id of ['ingestion.stuck_running', 'ingestion.retry_exhausted', 'release.dead_letters', 'pipeline.entities.backlog_age', 'automation.repeated_failures', 'automation.overdue_retries']) expect(check(report, id).status).toBe('fail')
  })

  it('detects an empty source registry and never passes malformed metrics', async () => {
    const rows = healthyRows()
    rows.sources[0].enabled_count = 0
    rows.jobs[0].stuck_count = -1
    rows.outbox[0].pending_count = null
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher(rows).fetcher, env: environment, now, data })
    expect(check(report, 'sources.enabled_registry').code).toBe('empty_registry')
    expect(check(report, 'ingestion.stuck_running').status).toBe('unobserved')
    expect(check(report, 'pipeline.outbox.backlog_age').status).toBe('unobserved')
  })

  it('keeps undeployed heartbeat schema explicit without exposing Cloudflare errors', async () => {
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher(undefined, { missingTable: true }).fetcher, env: environment, now, data })
    expect(check(report, 'pipeline.heartbeats.observation').code).toBe('not_configured')
    expect(check(report, 'scheduler.publisher').status).toBe('unobserved')
    expect(JSON.stringify(report)).not.toContain('do-not-leak-secret')
  })

  it('rejects login HTML even when the public endpoint responds HTTP 200', async () => {
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher(undefined, { releaseResponse: new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }) }).fetcher, env: environment, now, data })
    expect(check(report, 'publication.observation').status).toBe('unobserved')
    expect(check(report, 'p0.release_age').status).toBe('unobserved')
  })

  it('detects a JSON website disconnected from the D1 publishing pipeline', async () => {
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher(undefined, { backend: 'json' }).fetcher, env: environment, now, data })
    expect(check(report, 'publication.backend')).toMatchObject({ status: 'fail', code: 'publication_backend_mismatch' })
    expect(check(report, 'p0.release_age').status).toBe('unobserved')
  })

  it('does not refresh the timestamp on old backup or zero-DLQ observations', async () => {
    const report = await collectOperationsHealth(options({ p0Input: p0Evidence('2026-09-16T07:00:00Z') }), { fetch: mockFetcher().fetcher, env: environment, now, data })
    expect(check(report, 'p0.extra_observations')).toMatchObject({ status: 'unobserved', code: 'invalid_or_stale' })
    expect(check(report, 'p0.dlq_backlog').status).toBe('unobserved')
  })

  it('reports a failed or stalled workflow even with no preceding successful run', async () => {
    for (const [run, code] of [
      [{ id: 1, status: 'completed', conclusion: 'failure', updated_at: recent }, 'latest_run_failed'],
      [{ id: 2, status: 'in_progress', conclusion: null, run_started_at: '2026-09-16T01:00:00Z' }, 'workflow_stalled'],
    ] as const) {
      const report = await collectOperationsHealth(options(), { fetch: mockFetcher(undefined, { workflows: [run] }).fetcher, env: environment, now, data })
      expect(check(report, 'workflow.data-health.yml')).toMatchObject({ status: 'fail', code })
    }
  })

  it('keeps the fingerprint stable when time advances without a material incident change', async () => {
    const rows = healthyRows()
    rows.heartbeats[0].last_error_code = 'runtime_failure'
    const input = options()
    const first = await collectOperationsHealth(input, { fetch: mockFetcher(rows).fetcher, env: environment, now, data })
    const previous = join(temporary(), 'previous.json')
    writeFileSync(previous, JSON.stringify(first))
    rows.heartbeats[0].last_started_at = '2026-09-16T07:59:00Z'
    const second = await collectOperationsHealth({ ...input, previous }, { fetch: mockFetcher(rows).fetcher, env: environment, now: new Date(now.valueOf() + 60_000), data })
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.notification).toMatchObject({ changed: false, actionable: true, recovered: false })
  })

  it('uses fixed Wrangler arguments without requiring or exporting API credentials', async () => {
    const calls: string[][] = []
    const rows = healthyRows()
    const report = await collectOperationsHealth(options({ wrangler: true, githubRepo: undefined, releaseUrl: undefined }), {
      env: {}, now, data,
      runWrangler: async args => {
        calls.push(args)
        const sql = args[args.indexOf('--command') + 1]
        const key = (Object.keys(OPERATIONS_QUERIES) as (keyof typeof OPERATIONS_QUERIES)[]).find(key => sql.split(' FROM ').at(-1)?.split('\n')[0].trim() === OPERATIONS_QUERIES[key].split(' FROM ').at(-1)?.split('\n')[0].trim())
        if (!key) throw new Error('Unexpected SQL')
        return JSON.stringify([{ success: true, results: rows[key] }])
      },
    })
    expect(calls).toHaveLength(Object.keys(OPERATIONS_QUERIES).length)
    expect(report.scope.pipelineObserved).toBe(true)
    for (const args of calls) {
      expect(args.slice(1, 4)).toEqual(['d1', 'execute', 'INGESTION_DB'])
      expect(args).toContain('--remote')
      expect(args.at(-1)).toBe('--json')
      expect(args[args.indexOf('--command') + 1]).not.toMatch(/\?\d/)
    }
    expect(check(report, 'scheduler.ingestion').status).toBe('pass')
  })

  it('validates every observation query against the actual complete D1 migration schema', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const folder = resolve('infra/d1/pipeline/migrations')
      for (const file of readdirSync(folder).filter(file => file.endsWith('.sql')).sort()) db.exec(readFileSync(join(folder, file), 'utf8'))
      for (const sql of Object.values(OPERATIONS_QUERIES)) {
        const parameters = [...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1]))
        const args = Array.from({ length: Math.max(0, ...parameters) }, () => now.toISOString())
        expect(() => db.prepare(sql).all(...args)).not.toThrow()
      }
    } finally { db.close() }
  })

  it('distinguishes a missing Wrangler table from a broken connection without leaking diagnostics', async () => {
    const report = await collectOperationsHealth(options({ wrangler: true, githubRepo: undefined, releaseUrl: undefined }), {
      env: {}, now, data, runWrangler: async () => { throw Object.assign(new Error('Command failed'), { stdout: 'no such table: automation_service_runs; do-not-leak-secret' }) },
    })
    expect(check(report, 'pipeline.heartbeats.observation').code).toBe('not_configured')
    expect(JSON.stringify(report)).not.toContain('do-not-leak-secret')
  })

  it('allows fresh sources time to start while counting old retries and terminal attempt exhaustion', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(readFileSync(resolve('infra/d1/pipeline/migrations/0004_worker_runtime.sql'), 'utf8'))
      db.prepare('INSERT INTO ingestion_sources(source_id, manifest_json, created_at, next_fetch_at, consecutive_failures) VALUES (?, ?, ?, ?, ?)').run('new', '{}', recent, null, 0)
      db.prepare('INSERT INTO ingestion_sources(source_id, manifest_json, created_at, next_fetch_at, consecutive_failures) VALUES (?, ?, ?, ?, ?)').run('old', '{}', '2026-09-14T00:00:00Z', null, 4)
      expect(db.prepare(OPERATIONS_QUERIES.sources).get(now.toISOString(), '2026-09-15T08:00:00Z')).toMatchObject({ enabled_count: 2, due_count: 2, overdue_count: 1, repeatedly_failed_count: 1 })
      const insertJob = db.prepare('INSERT INTO ingestion_jobs(job_id, source_id, status, reason, scheduled_at, attempt, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      insertJob.run('exhausted', 'old', 'failed', 'scheduled', recent, 4, recent, recent, recent)
      insertJob.run('historical', 'old', 'failed', 'scheduled', '2026-09-14T00:00:00Z', 4, '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z')
      insertJob.run('stuck', 'old', 'running', 'scheduled', '2026-09-16T04:00:00Z', 1, null, '2026-09-16T04:00:00Z', '2026-09-16T04:00:00Z')
      expect(db.prepare(OPERATIONS_QUERIES.jobs).get('2026-09-16T06:00:00Z', '2026-09-15T08:00:00Z')).toMatchObject({ active_count: 1, stuck_count: 1, failed_recent_count: 1, exhausted_recent_count: 1 })
    } finally { db.close() }
  })

  it('validates CLI identifiers and preserves input evidence', () => {
    expect(parseOperationsArguments(['--wrangler', '--workflow', 'automated-refresh.yml:3'])).toMatchObject({ remote: true, wrangler: true })
    expect(parseOperationsArguments(['--expected-backend', 'json']).expectedBackend).toBe('json')
    for (const args of [['--database-id', 'bad'], ['--github-repo', 'owner/repo/elsewhere'], ['--workflow', '../job.yml:2'], ['--output', 'same.json', '--previous', 'same.json']]) expect(() => parseOperationsArguments(args)).toThrow()
  })
})

// These checks exercise the same defaults used by the scheduled runtime-health CLI.
describe('scheduled workflow health coverage', () => {
  it('observes daily catalog publication and detects its missing successful run', async () => {
    const defaults = parseOperationsArguments([])
    const { fetcher: underlying, calls } = mockFetcher()
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/autonomous-catalog.yml/runs?')) return Response.json({ workflow_runs: [] })
      return underlying(input, init)
    }) as typeof fetch
    const report = await collectOperationsHealth(options({ workflows: defaults.workflows }), { fetch: fetcher, env: environment, now, data })
    expect(check(report, 'workflow.autonomous-catalog.yml')).toMatchObject({ status: 'unobserved', code: 'no_recent_success_observed' })
    expect(calls.some(call => call.url.includes('/program-fact-refresh.yml/runs?'))).toBe(true)
  })

  it.each([{ hours: 47, status: 'pass', code: 'within_threshold' }, { hours: 49, status: 'fail', code: 'schedule_overdue' }])(
    'flags a daily program refresh after 48 hours ($hours hours)', async ({ hours, status, code }) => {
      const timestamp = new Date(now.valueOf() - hours * 3_600_000).toISOString()
      const fetcher = mockFetcher(undefined, { workflows: [{ id: 1, status: 'completed', conclusion: 'success', updated_at: timestamp, run_started_at: timestamp }] }).fetcher
      const report = await collectOperationsHealth(options({ workflows: parseOperationsArguments([]).workflows }), { fetch: fetcher, env: environment, now, data })
      expect(check(report, 'workflow.program-fact-refresh.yml')).toMatchObject({ status, code })
    },
  )

  it('shows healthy runtime separately from missing backup and DLQ evidence without lowering the readiness gate', async () => {
    const report = await collectOperationsHealth(options(), { fetch: mockFetcher().fetcher, env: environment, now, data })
    expect(check(report, 'scheduler.ingestion').status).toBe('pass')
    expect(check(report, 'p0.backup_age').status).toBe('unobserved')
    expect(check(report, 'p0.dlq_backlog').status).toBe('unobserved')
    expect(report.status).toBe('fail')
  })
})
