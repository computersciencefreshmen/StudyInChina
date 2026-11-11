import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../scripts/maintenance/contracts'
import { collectCloudMaintenanceHealth, evaluateCloudMaintenanceHealth } from '../../scripts/automation/cloud-maintenance-health'
import { MaintenanceHttpError, type MaintenanceClient } from '../../scripts/automation/catalog-maintenance-client'
import type { CoverageSnapshot } from '../../workers/catalog-maintenance/src/coverage'

const now = new Date('2026-11-11T16:02:00.000Z'), observedAt = '2026-11-11T16:00:36.512Z', scope = 'a'.repeat(64), catalog = 'b'.repeat(64)
const release = () => ({ data: { id: 'json:2026-11-10', catalogBackend: 'json', evaluatedForDate: '2026-11-12', activatedAt: '2026-11-10T00:00:00.000Z', deploymentSha: null,
  rawCounts: { universities: 295, programs: 2168, scholarships: 400, admissionCycles: 1654, cities: 62, sources: 2869 },
  publicCounts: { universities: 245, programs: 751, scholarships: 0, admissionCycles: 751, cities: 62, sources: 706 } } })
function ready() {
  return { format: 'studyinchina.cloud-maintenance-status', version: 1, observedAt, enabled: true, modelEnabled: true, scopeCount: 2,
    control: { enabled: 1, models_enabled: 1, seed_complete: 1, targets_complete: 1, scope_sha256: scope, input_catalog_sha256: catalog },
    backend: { state: 'ready', retryAt: null }, reconciliationGate: { ready: true }, jobs: [], modelAttempts: [], coverage: {} as Record<string, unknown>,
    lastRuntimeTick: { format: 'studyinchina.cloud-maintenance-tick', version: 1, observedAt: '2026-11-11T16:00:34.856Z', state: 'running', code: 'bounded_scheduler_completed' },
    lastEvent: { kind: 'scheduler_tick', observed_at: observedAt } }
}
// Same observed runtime shape as run 43053746104: null controls are unknown,
// and an R2-persisted daily reset wait does not imply manual pause or empty data.
function quotaWait() {
  return { ...ready(), enabled: false, modelEnabled: false, scopeCount: null, control: null, coverage: null, jobs: null,
    modelAttempts: [{ status: 'unknown', count: 399 }], backend: { state: 'quota_wait', retryAt: '2026-11-12T00:00:00.000Z' },
    lastRuntimeTick: { ...ready().lastRuntimeTick, state: 'quota_wait', code: 'daily_quota_wait_cached' } }
}
function snapshot(programs = 5): CoverageSnapshot {
  const content = { format: 'studyinchina.school-program-coverage' as const, version: 1 as const, scopeRegistrySha256: scope, inputCatalogSha256: catalog, evaluatedOn: '2026-11-12',
    schools: [0, 1].map(index => { const n = index === 0 ? programs : 0; return { universityId: `uni-${index}`, rawProgramCount: n, directoryProgramCount: n, currentProgramCount: n,
      minimumProgramCount: 5 as const, gap: Math.max(0, 5 - n), coverageBand: n >= 5 ? 'five-plus' as const : n === 0 ? 'zero' as const : n === 1 ? 'one' as const : 'two-to-four' as const,
      countedProgramIds: Array.from({ length: n }, (_, id) => `program-${index}-${id}`), directoryScholarshipCount: 2, currentScholarshipCount: 1, reviewAfter: '2026-11-12' } }) }
  return { ...content, sha256: createHash('sha256').update(canonicalJson(content)).digest('hex') }
}
const check = (report: ReturnType<typeof evaluateCloudMaintenanceHealth>, id: string) => report.checks.find(value => value.id === id)!
function observed(programs = 5) { const status = ready(), coverage = snapshot(programs); status.coverage = { snapshotSha256: coverage.sha256 }; return { maintenance: status, coverage, release: release() } }

describe('cloud-mode hourly operational observations', () => {
  it('reports the actual daily quota wait without zero coverage, manual-pause inference or a fake processing-success claim', () => {
    const report = evaluateCloudMaintenanceHealth({ maintenance: quotaWait(), release: release() }, { now })
    expect(report.status).toBe('waiting'); expect(report.runtime.retryAt).toBe('2026-11-12T00:00:00.000Z')
    expect(check(report, 'maintenance.backend')).toMatchObject({ status: 'wait', code: 'daily_quota_wait' })
    expect(check(report, 'maintenance.controls').code).not.toBe('operator_pause_preserved')
    expect(report.coverage).toMatchObject({ state: 'unobserved', bands: null, schoolCount: null, currentScholarshipAssociations: null, schoolsWithCurrentScholarships: null })
    expect(report.runtime.processingProgress).toBe('unobserved'); expect(report.scope.productionRunningClaim).toBe(false)
    expect(report.publication?.publicCounts?.scholarships).toBe(0); expect(report.publication?.rawCounts?.scholarships).toBe(400)
  })
  it('distinguishes JSON website delivery from D1 maintenance storage', () => {
    const report = evaluateCloudMaintenanceHealth(observed(), { now })
    expect(report.status).toBe('pass'); expect(check(report, 'publication.backend')).toMatchObject({ status: 'pass', value: { expected: null, observed: 'json' } })
    expect(report.coverage.bands).toEqual({ zero: 1, one: 0, 'two-to-four': 0, 'five-plus': 1 })
    expect(report.coverage.currentScholarshipAssociations).toBe(2); expect(report.coverage.schoolsWithCurrentScholarships).toBe(2)
    expect(report.publication?.latestAcknowledgement).toBeNull()
    expect(evaluateCloudMaintenanceHealth(observed(), { now, expectedBackend: 'd1' }).status).toBe('fail')
    const futureD1 = observed(); futureD1.release.data.catalogBackend = 'd1'
    expect(evaluateCloudMaintenanceHealth(futureD1, { now }).status).toBe('pass')
  })
  it('keeps missing coverage unknown while running instead of inventing an all-zero healthy snapshot', () => {
    const report = evaluateCloudMaintenanceHealth({ maintenance: ready(), release: release() }, { now })
    expect(report.status).toBe('unobserved'); expect(report.coverage.bands).toBeNull(); expect(report.coverage.currentConcretePrograms).toBeNull()
    expect(report.growth.assessment).toBe('previous_report_unavailable'); expect(report.notification.growthDetected).toBe(false)
  })
  it('alerts after a recorded reset expires or a documented wait persists across more than 24 hours', () => {
    const expired = quotaWait(); expired.backend.retryAt = '2026-11-11T16:01:00.000Z'
    expect(check(evaluateCloudMaintenanceHealth({ maintenance: expired, release: release() }, { now }), 'maintenance.backend').code).toBe('quota_reset_overdue')
    const previous = { format: 'studyinchina.automation-operations-health', mode: 'cloud', evaluatedAt: '2026-11-11T15:00:00.000Z', runtime: { backendState: 'quota_wait', quotaWaitSince: '2026-11-10T15:00:00.000Z' } }
    const report = evaluateCloudMaintenanceHealth({ maintenance: quotaWait(), release: release(), previous }, { now })
    expect(report.status).toBe('fail'); expect(check(report, 'maintenance.backend').code).toBe('persistent_quota_wait')
  })
  it('does not infer continuous quota wait across an observation gap or from a start after its report', () => {
    for (const previous of [
      { evaluatedAt: '2026-11-10T15:00:00.000Z', quotaWaitSince: '2026-11-10T15:00:00.000Z' },
      { evaluatedAt: '2026-11-11T13:59:00.000Z', quotaWaitSince: '2026-11-10T15:00:00.000Z' },
      { evaluatedAt: '2026-11-11T15:00:00.000Z', quotaWaitSince: '2026-11-11T15:01:00.000Z' },
    ]) {
      const report = evaluateCloudMaintenanceHealth({ maintenance: quotaWait(), release: release(), previous: {
        format: 'studyinchina.automation-operations-health', mode: 'cloud', evaluatedAt: previous.evaluatedAt,
        runtime: { backendState: 'quota_wait', quotaWaitSince: previous.quotaWaitSince },
      } }, { now })
      expect(report.status).toBe('waiting'); expect(report.runtime.quotaWaitSince).toBe(now.toISOString())
      expect(check(report, 'maintenance.backend').code).toBe('daily_quota_wait')
    }
  })
  it('alerts on stale durable ticks and backend/errors without treating fresh HTTP service as scheduler progress', () => {
    const stale = ready(); stale.lastRuntimeTick.observedAt = '2026-11-11T14:00:00.000Z'
    expect(check(evaluateCloudMaintenanceHealth({ ...observed(), maintenance: stale }, { now }), 'maintenance.scheduler').code).toBe('durable_tick_stale')
    const unavailable = { ...ready(), backend: { state: 'backend_unavailable', retryAt: null } }
    expect(check(evaluateCloudMaintenanceHealth({ maintenance: unavailable, release: release() }, { now }), 'maintenance.backend').status).toBe('fail')
    const failed = ready(); failed.lastRuntimeTick.state = 'error'; failed.lastRuntimeTick.code = 'partition_original_source_outcome_unknown'
    expect(check(evaluateCloudMaintenanceHealth({ maintenance: failed, release: release() }, { now }), 'maintenance.unknown_outcomes').code).toBe('current_unknown_outcome_blocker')
  })
  it('preserves an explicit manual pause, while old protected unknown history alone is not a new failure', () => {
    const status = ready(); status.enabled = false; status.modelEnabled = false; status.control.enabled = 0
    expect(check(evaluateCloudMaintenanceHealth({ ...observed(), maintenance: status }, { now }), 'maintenance.controls')).toMatchObject({ status: 'wait', code: 'operator_pause_preserved' })
    const history = { ...observed(), maintenance: { ...observed().maintenance, modelAttempts: [{ status: 'unknown', count: 9 }] } }
    expect(evaluateCloudMaintenanceHealth(history, { now }).status).toBe('pass')
  })
  it('rejects tampered, foreign-catalogue and previous-day coverage even if metadata labels it current', () => {
    for (const change of ['hash', 'catalog', 'day'] as const) {
      const input = observed(); if (change === 'hash') input.coverage.schools[0].rawProgramCount++
      else if (change === 'catalog') input.coverage.inputCatalogSha256 = 'f'.repeat(64)
      else input.coverage.evaluatedOn = '2026-11-10'
      expect(check(evaluateCloudMaintenanceHealth(input, { now }), 'maintenance.coverage').status).toBe('fail')
    }
  })
  it('compares available evidence and publication deltas without treating absent previous reports as zero', () => {
    const previous = evaluateCloudMaintenanceHealth(observed(4), { now: new Date('2026-11-11T16:01:00.000Z') })
    const report = evaluateCloudMaintenanceHealth({ ...observed(5), previous }, { now })
    expect(report.growth).toMatchObject({ currentConcretePrograms: 1, schoolsMeetingMinimum: 1, schoolsWithCurrentScholarships: 0, publishedPrograms: 0, publishedScholarships: 0 })
    expect(report.fingerprint).toBe(previous.fingerprint); expect(report.notification).toMatchObject({ changed: true, growthDetected: true })
  })
})

describe('read-only transport and the existing hourly workflow', () => {
  it('makes no coverage/D1-adjacent request during quota wait and sends no provider calls or mutations', async () => {
    const calls: string[] = [], client: MaintenanceClient = { json: async path => { calls.push(path); return quotaWait() }, artifact: async key => { calls.push(key); throw Error('must not request coverage') } }
    const report = await collectCloudMaintenanceHealth({ now, client, fetcher: (async () => Response.json(release())) as typeof fetch })
    expect(report.status).toBe('waiting'); expect(calls).toEqual(['/status'])
  })
  it('fetches only the authenticated snapshot selected by current status and verifies its bindings', async () => {
    const input = observed(), calls: string[] = [], client: MaintenanceClient = { json: async path => { calls.push(path); return input.maintenance },
      artifact: async key => { calls.push(key); return new TextEncoder().encode(JSON.stringify(input.coverage)) } }
    const report = await collectCloudMaintenanceHealth({ now, client, fetcher: (async () => Response.json(release())) as typeof fetch })
    expect(report.status).toBe('pass'); expect(calls).toEqual(['/status', `maintenance/coverage/${input.coverage.sha256}.json`])
  })
  it('does not mask missing configuration or authentication failure as quota wait', async () => {
    const fetcher = (async () => Response.json(release())) as typeof fetch
    expect(check(await collectCloudMaintenanceHealth({ now, environment: {}, fetcher }), 'maintenance.observation').code).toBe('maintenance_configuration_invalid')
    const client: MaintenanceClient = { json: async () => { throw new MaintenanceHttpError(401) }, artifact: async () => { throw Error('unused') } }
    const report = await collectCloudMaintenanceHealth({ now, client, fetcher })
    expect(report.status).toBe('fail'); expect(check(report, 'maintenance.observation').code).toBe('maintenance_authentication_failed')
  })
  it('retains the hourly cron/artifact and the unchanged legacy command behind an explicit mode switch', () => {
    const yaml = readFileSync('.github/workflows/automation-health.yml', 'utf8')
    expect(yaml).toContain("cron: '41 * * * *'"); expect(yaml).toContain("if: vars.CATALOG_MAINTENANCE_MODE == 'cloud'")
    expect(yaml).toContain("if: vars.CATALOG_MAINTENANCE_MODE != 'cloud'"); expect(yaml).toContain('npm run automation:health -- --operations-url "$INGESTION_WORKER_URL"')
    expect(yaml).toContain('CATALOG_MAINTENANCE_TOKEN: ${{ secrets.CATALOG_MAINTENANCE_TOKEN }}'); expect(yaml).toContain('name: automation-health-${{ github.run_id }}')
    expect(yaml).not.toMatch(/MINIMAX_.*(?:KEY|TOKEN)|CLOUDFLARE_API_TOKEN/)
  })
})
