import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { maintenanceClientFromEnvironment, MaintenanceHttpError, type MaintenanceClient } from './catalog-maintenance-client'
import { canonicalJson } from '../maintenance/contracts'
import { coverageSnapshotSchema } from '../../workers/catalog-maintenance/src/coverage'
import { getTodayDate } from '../../src/lib/data/freshness'

type Row = Record<string, unknown>
export type CloudHealthCheck = { id: string; status: 'pass' | 'wait' | 'fail' | 'unobserved'; code: string; value: unknown }
export type CloudHealthInput = { maintenance?: unknown; maintenanceError?: string; release?: unknown; releaseError?: string;
  coverage?: unknown; coverageError?: string; previous?: unknown }
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const budgetUnknownCodes = new Set(['budget_policy_unavailable', 'budget_policy_invalid', 'budget_observation_missing',
  'budget_observation_invalid', 'budget_policy_changed', 'budget_observation_future', 'budget_observation_stale',
  'budget_period_invalid', 'budget_period_unconfirmed', 'budget_observation_unknown', 'budget_total_unconfirmed'])
function observedBudgetWait(value: unknown) {
  const budget = row(value)
  if (budget?.allowed !== false || typeof budget.code !== 'string') return null
  if (budget.state === 'paused' && ['budget_paused', 'budget_threshold_reached'].includes(budget.code)
    || budget.state === 'unknown' && budgetUnknownCodes.has(budget.code))
    return { allowed: false as const, state: budget.state as 'paused' | 'unknown', code: budget.code }
  return null
}
const publicCounts = (value: unknown) => {
  const input = row(value)
  return input ? Object.fromEntries(['universities', 'programs', 'admissionCycles', 'scholarships', 'cities', 'sources']
    .map(key => [key, count(input[key])])) : null
}

/** Pure evaluation: a quota wait is a recorded wait, never evidence of empty data or successful work. */
export function evaluateCloudMaintenanceHealth(input: CloudHealthInput, options: { now?: Date; expectedBackend?: 'json' | 'shadow' | 'd1' } = {}) {
  const now = options.now ?? new Date(), time = +now
  if (!Number.isFinite(time)) throw new Error('cloud_health_time_invalid')
  const today = getTodayDate(now)
  const checks: CloudHealthCheck[] = []
  const add = (id: string, status: CloudHealthCheck['status'], code: string, value: unknown = null) => checks.push({ id, status, code, value })
  const candidate = row(input.maintenance), observed = instant(candidate?.observedAt)
  const status = candidate?.format === 'studyinchina.cloud-maintenance-status' && candidate.version === 1 ? candidate : null
  const backend = row(status?.backend), cfg = row(status?.control), tick = row(status?.lastRuntimeTick)
  const priorCandidate = row(input.previous), priorTime = instant(priorCandidate?.evaluatedAt)
  const previous = priorCandidate?.format === 'studyinchina.automation-operations-health' && priorCandidate.mode === 'cloud' && priorTime !== null && priorTime <= time ? priorCandidate : null
  const previousRuntime = row(previous?.runtime)
  const statusFresh = observed !== null && observed <= time + 60000 && time - observed <= 15 * 60000
  if (input.maintenanceError) add('maintenance.observation', 'fail', input.maintenanceError)
  else add('maintenance.observation', status && statusFresh ? 'pass' : 'fail', !status ? 'invalid_status_contract' : !statusFresh ? 'stale_status_observation' : 'authenticated_status_observed', status?.observedAt ?? null)

  const quota = backend?.state === 'quota_wait', retry = instant(backend?.retryAt)
  const budgetWait = backend?.state === 'budget_wait', budget = budgetWait ? observedBudgetWait(status?.budget) : null
  const priorWaitStart = previousRuntime?.backendState === 'quota_wait' ? instant(previousRuntime.quotaWaitSince) : null
  // Only adjacent hourly observations can establish a continuous wait. A gap
  // cannot rule out work or recovery between reports, and its start must be historical.
  const priorWaitContinuous = priorTime !== null && time - priorTime <= 2 * 3600000
    && priorWaitStart !== null && priorWaitStart <= priorTime
  const quotaWaitSince = quota ? new Date(priorWaitContinuous ? priorWaitStart : time).toISOString() : null
  const longQuota = quota && quotaWaitSince !== null && time - Date.parse(quotaWaitSince) >= 24 * 3600000
  const validQuotaWait = quota && retry !== null && retry > time && retry <= time + 26 * 3600000 && !longQuota
  if (quota) add('maintenance.backend', validQuotaWait ? 'wait' : 'fail', longQuota ? 'persistent_quota_wait' : retry !== null && retry <= time ? 'quota_reset_overdue' : !validQuotaWait ? 'invalid_quota_reset' : 'daily_quota_wait', { retryAt: typeof backend?.retryAt === 'string' ? backend.retryAt : null, quotaWaitSince })
  else if (budgetWait) add('maintenance.backend', budget ? 'wait' : 'fail', budget?.code ?? 'budget_wait_unproven', budget ? { ...budget,
    action: budget.state === 'paused' ? 'Review billing, then explicitly resume after a fresh under-threshold observation.'
      : 'Restore verified billing evidence or configuration; unknown spending cannot authorize background work.' } : null)
  else if (backend?.state === 'ready') add('maintenance.backend', 'pass', 'backend_observed')
  else add('maintenance.backend', 'fail', status ? 'backend_unavailable' : 'backend_unobserved')

  const tickTime = instant(tick?.observedAt), tickAgeMinutes = tickTime === null ? null : (time - tickTime) / 60000
  const validTick = tick?.format === 'studyinchina.cloud-maintenance-tick' && tick.version === 1 && tickAgeMinutes !== null && tickAgeMinutes >= -1
  add('maintenance.scheduler', !validTick ? 'unobserved' : tickAgeMinutes! > 45 ? 'fail' : tick?.state === 'error' ? 'fail' : 'pass',
    !validTick ? 'durable_tick_unobserved' : tickAgeMinutes! > 45 ? 'durable_tick_stale' : tick?.state === 'error' ? 'durable_tick_error' : 'durable_tick_current',
    { observedAt: validTick ? tick?.observedAt : null, ageMinutes: validTick ? Math.round(tickAgeMinutes! * 10) / 10 : null, state: typeof tick?.state === 'string' ? tick.state : null, code: typeof tick?.code === 'string' ? tick.code : null })
  if (quota) add('maintenance.controls', 'unobserved', 'controls_unavailable_during_quota_wait')
  else if (budgetWait) add('maintenance.controls', 'unobserved', 'controls_unavailable_during_budget_wait')
  else if (!cfg) add('maintenance.controls', 'wait', 'bootstrap_or_controls_unobserved')
  else if (cfg.enabled === 0) add('maintenance.controls', 'wait', 'operator_pause_preserved')
  else if (row(status?.reconciliationGate)?.ready === false) add('maintenance.controls', 'wait', 'native_reconciliation_wait')
  else if (status?.enabled === false) add('maintenance.controls', 'wait', 'deployment_activation_disabled')
  else if (cfg.seed_complete !== 1 || cfg.targets_complete !== 1) add('maintenance.controls', 'wait', 'seed_or_targets_pending')
  else if (status?.modelEnabled !== true) add('maintenance.controls', 'wait', 'model_lane_disabled')
  else add('maintenance.controls', 'pass', 'existing_controls_running')

  const groups = (value: unknown): Row[] | null => Array.isArray(value) && value.every(item => typeof row(item)?.status === 'string' && count(row(item)?.count) !== null) ? value as Row[] : null
  const jobRows = groups(status?.jobs), attempts = groups(status?.modelAttempts)
  const unknownJobs = jobRows?.filter(value => value.status === 'unknown').reduce((sum, value) => sum + (count(value.count) ?? 0), 0) ?? null
  const unknownModels = attempts?.filter(value => value.status === 'unknown').reduce((sum, value) => sum + (count(value.count) ?? 0), 0) ?? null
  const currentUnknownFailure = tick?.state === 'error' && /unknown|unresolved/iu.test(String(tick.code))
  const historicalUnknowns = unknownJobs !== null && unknownModels !== null && unknownJobs + unknownModels > 0
  const disposition = row(status?.unknownJobDisposition), totalUnknown = count(disposition?.totalUnknown), quarantinedUnknown = count(disposition?.quarantinedUnknown), unresolvedUnknown = count(disposition?.unresolvedUnknown)
  const quarantineObserved = totalUnknown !== null && quarantinedUnknown !== null && unresolvedUnknown !== null && totalUnknown === unknownJobs
    && quarantinedUnknown + unresolvedUnknown === totalUnknown && disposition?.replayAllowed === false && disposition.modelSuccessesClaimed === false
    && (quarantinedUnknown === 0 || disposition.state === 'active' && sha(disposition.proofSha256))
  add('maintenance.unknown_outcomes', currentUnknownFailure ? 'fail' : unknownJobs === null || unknownModels === null || historicalUnknowns ? 'unobserved' : 'pass',
    currentUnknownFailure ? 'current_unknown_outcome_blocker' : unknownJobs === null || unknownModels === null ? 'outcomes_unobserved' : historicalUnknowns ? 'historical_or_guarded_unknown_outcomes' : 'no_unknown_outcomes_observed',
    { jobs: unknownJobs, modelAttempts: unknownModels,
      ...(quarantineObserved ? { totalUnknown, quarantinedUnknown, unresolvedUnknown, quarantineProofSha256: disposition?.proofSha256 ?? null,
        importedDoUnknownAtMigration: count(row(disposition?.importedDoStates)?.unknown),
        replayAllowed: false, modelSuccessesClaimed: false } : {}),
      classification: quarantineObserved && quarantinedUnknown! > 0 ? 'Reviewed terminal quarantines remain unknown and NO_REPLAY. They are not model successes or new catalogue records.'
        : 'Aggregate history does not identify a new failed request; reservations remain preserved.' })
  // created_at dates and scheduler_tick events cannot prove processor progress.
  // Report that limitation rather than treating a newly served /status as activity.
  add('maintenance.processing_progress', 'unobserved', quota ? 'progress_unobserved_during_quota_wait' : budgetWait ? 'progress_unobserved_during_budget_wait' : 'processing_timestamp_not_exposed')

  const coverageMeta = row(status?.coverage)
  let coverage: { state: 'observed' | 'unobserved'; snapshotSha256: string | null; evaluatedOn: string | null; schoolCount: number | null;
    bands: Record<string, number> | null; schoolsMeetingMinimum: number | null; totalProgramGap: number | null;
    currentConcretePrograms: number | null; directoryScholarshipAssociations: number | null; currentScholarshipAssociations: number | null;
    schoolsWithCurrentScholarships: number | null } = {
    state: 'unobserved', snapshotSha256: null, evaluatedOn: null, schoolCount: null, bands: null, schoolsMeetingMinimum: null, totalProgramGap: null,
    currentConcretePrograms: null, directoryScholarshipAssociations: null, currentScholarshipAssociations: null, schoolsWithCurrentScholarships: null,
  }
  const parsed = coverageSnapshotSchema.safeParse(input.coverage)
  if (input.coverage !== undefined) {
    const value = parsed.success ? parsed.data : null
    const content = value ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'sha256')) : null
    const bound = Boolean(value && value.sha256 === hash(content) && value.sha256 === coverageMeta?.snapshotSha256
      && value.scopeRegistrySha256 === cfg?.scope_sha256 && value.inputCatalogSha256 === cfg?.input_catalog_sha256
      && value.evaluatedOn === today && value.schools.length === new Set(value.schools.map(school => school.universityId)).size)
    if (!value || !bound) add('maintenance.coverage', 'fail', 'coverage_snapshot_invalid_or_wrong_scope')
    else {
      const bands = Object.fromEntries(['zero', 'one', 'two-to-four', 'five-plus'].map(band => [band, value.schools.filter(school => school.coverageBand === band).length]))
      coverage = { state: 'observed', snapshotSha256: value.sha256, evaluatedOn: value.evaluatedOn, schoolCount: value.schools.length, bands,
        schoolsMeetingMinimum: value.schools.filter(school => school.gap === 0).length, totalProgramGap: value.schools.reduce((sum, school) => sum + school.gap, 0),
        currentConcretePrograms: new Set(value.schools.flatMap(school => school.countedProgramIds)).size,
        directoryScholarshipAssociations: value.schools.reduce((sum, school) => sum + school.directoryScholarshipCount, 0),
        currentScholarshipAssociations: value.schools.reduce((sum, school) => sum + school.currentScholarshipCount, 0),
        schoolsWithCurrentScholarships: value.schools.filter(school => school.currentScholarshipCount > 0).length }
      add('maintenance.coverage', 'pass', 'evidence_bound_coverage_observed', { evaluatedOn: value.evaluatedOn, snapshotSha256: value.sha256 })
    }
  } else add('maintenance.coverage', 'unobserved', input.coverageError ?? (quota ? 'coverage_unavailable_during_quota_wait' : budgetWait ? 'coverage_unavailable_during_budget_wait' : 'coverage_snapshot_unobserved'))

  const payload = row(input.release), release = row(payload?.data)
  const releaseBackend = release?.catalogBackend, expectedBackend = options.expectedBackend ?? null
  const releaseValid = Boolean(release && typeof release.id === 'string' && ['json', 'shadow', 'd1'].includes(String(releaseBackend)))
  if (input.releaseError) add('publication.observation', 'fail', input.releaseError)
  else add('publication.observation', releaseValid ? 'pass' : 'fail', releaseValid ? 'public_release_observed' : 'public_release_invalid')
  if (releaseValid) {
    add('publication.backend', expectedBackend === null || releaseBackend === expectedBackend ? 'pass' : 'fail', expectedBackend === null ? 'observed_backend' : releaseBackend === expectedBackend ? 'expected_backend' : 'publication_backend_mismatch', { expected: expectedBackend, observed: releaseBackend })
    add('publication.evaluation_date', release?.evaluatedForDate === today ? 'pass' : 'fail', release?.evaluatedForDate === today ? 'current_date' : 'stale_public_projection', release?.evaluatedForDate ?? null)
  }
  const publication = releaseValid ? { id: release!.id, catalogBackend: releaseBackend, evaluatedForDate: release!.evaluatedForDate ?? null,
    activatedAt: release!.activatedAt ?? null, deploymentSha: typeof release!.deploymentSha === 'string' ? release!.deploymentSha : null,
    publicCounts: publicCounts(release!.publicCounts), rawCounts: publicCounts(release!.rawCounts),
    directoryCounts: publicCounts(release!.directoryCounts), currentFactsCounts: publicCounts(release!.currentFactsCounts), currentOpportunityCounts: publicCounts(release!.currentOpportunityCounts),
    latestAcknowledgement: null, acknowledgementObservation: 'not_exposed_by_status' } : null
  const previousCoverage = row(previous?.coverage), previousPublication = row(previous?.publication)
  const comparableCoverage = coverage.state === 'observed' && previousCoverage?.state === 'observed'
    && row(previous?.scope)?.registeredScopeSha256 === cfg?.scope_sha256
  const delta = (current: unknown, prior: unknown) => count(current) !== null && count(prior) !== null ? Number(current) - Number(prior) : null
  const growth = { previousObservedAt: previous?.evaluatedAt ?? null,
    currentConcretePrograms: comparableCoverage ? delta(coverage.currentConcretePrograms, previousCoverage?.currentConcretePrograms) : null,
    schoolsMeetingMinimum: comparableCoverage ? delta(coverage.schoolsMeetingMinimum, previousCoverage?.schoolsMeetingMinimum) : null,
    currentScholarshipAssociations: comparableCoverage ? delta(coverage.currentScholarshipAssociations, previousCoverage?.currentScholarshipAssociations) : null,
    schoolsWithCurrentScholarships: comparableCoverage ? delta(coverage.schoolsWithCurrentScholarships, previousCoverage?.schoolsWithCurrentScholarships) : null,
    publishedPrograms: previousPublication?.catalogBackend === releaseBackend ? delta(publication?.publicCounts?.programs, row(previousPublication?.publicCounts)?.programs) : null,
    publishedScholarships: previousPublication?.catalogBackend === releaseBackend ? delta(publication?.publicCounts?.scholarships, row(previousPublication?.publicCounts)?.scholarships) : null,
    assessment: previous ? 'compared_where_observed' : 'previous_report_unavailable' }
  const growthDetected = Object.values(growth).some(value => typeof value === 'number' && value > 0)
  const failures = checks.some(check => check.status === 'fail'), waiting = checks.some(check => check.status === 'wait')
  // Missing coverage/progress during a legitimate wait remains unknown in the
  // report. Unknown coverage while running is actionable, unlike absent processor timestamps.
  const requiredUnknown = checks.some(check => check.status === 'unobserved' && check.id !== 'maintenance.processing_progress' && check.code !== 'historical_or_guarded_unknown_outcomes')
  const resultStatus = failures ? 'fail' : waiting ? 'waiting' : requiredUnknown ? 'unobserved' : 'pass'
  const incidents = checks.filter(check => check.status !== 'pass').map(({ id, status: state, code }) => ({ id, status: state, code }))
  const fingerprint = hash(incidents)
  return { format: 'studyinchina.automation-operations-health', formatVersion: 1, mode: 'cloud', evaluatedAt: now.toISOString(), status: resultStatus,
    summary: Object.fromEntries(['pass', 'wait', 'fail', 'unobserved'].map(state => [state, checks.filter(check => check.status === state).length])),
    fingerprint, notification: { changed: previous?.fingerprint !== fingerprint || growthDetected, growthDetected, actionable: resultStatus === 'fail' || resultStatus === 'unobserved' || budget !== null },
    scope: { configuredSchoolCount: count(status?.scopeCount), registeredScopeSha256: typeof cfg?.scope_sha256 === 'string' ? cfg.scope_sha256 : null,
      inputCatalogSha256: typeof cfg?.input_catalog_sha256 === 'string' ? cfg.input_catalog_sha256 : null,
      pendingBootstrapScopeSha256: typeof row(status?.bootstrapPending)?.scopeRegistrySha256 === 'string' ? row(status?.bootstrapPending)!.scopeRegistrySha256 : null, productionRunningClaim: false },
    runtime: { backendState: typeof backend?.state === 'string' ? backend.state : 'unobserved', retryAt: !budgetWait && typeof backend?.retryAt === 'string' ? backend.retryAt : null,
      quotaWaitSince, budget, lastRuntimeTick: tick ? { observedAt: tick.observedAt ?? null, state: tick.state ?? null, code: tick.code ?? null } : null,
      enabled: typeof status?.enabled === 'boolean' ? status.enabled : null, modelEnabled: typeof status?.modelEnabled === 'boolean' ? status.modelEnabled : null,
      controlObservation: cfg ? 'observed' : 'unobserved', processingProgress: 'unobserved',
      jobs: jobRows?.map(value => ({ stage: value.stage, status: value.status, count: count(value.count), oldestCreatedAt: value.oldest_at ?? null })) ?? null,
      modelAttempts: attempts?.map(value => ({ status: value.status, count: count(value.count) })) ?? null,
      lastRecordedEvent: row(status?.lastEvent) ? { kind: row(status?.lastEvent)?.kind ?? null, observedAt: row(status?.lastEvent)?.observed_at ?? null } : null },
    coverage, publication, growth, checks }
}

function transportCode(error: unknown) {
  if (error instanceof MaintenanceHttpError && [401, 403].includes(error.httpStatus)) return 'maintenance_authentication_failed'
  return error instanceof Error && error.message === 'maintenance_configuration_unavailable' ? 'maintenance_configuration_invalid' : 'maintenance_status_unavailable'
}
async function fetchPublicRelease(fetcher: typeof fetch, url: string) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || target.port || target.search || target.hash) throw new Error('public_release_url_invalid')
  const response = await fetcher(target, { redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('json') || !response.body) throw new Error('public_release_unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length
    if (bytes > 2_000_000) { await reader.cancel(); throw new Error('public_release_too_large') }; chunks.push(part.value) } }
  finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
export async function collectCloudMaintenanceHealth(options: { environment?: Record<string, string | undefined>; fetcher?: typeof fetch;
  client?: MaintenanceClient; now?: Date; releaseUrl?: string; expectedBackend?: 'json' | 'shadow' | 'd1'; previous?: unknown }) {
  const fetcher = options.fetcher ?? fetch, input: CloudHealthInput = { previous: options.previous }
  let client: MaintenanceClient | undefined
  try { client = options.client ?? maintenanceClientFromEnvironment(options.environment ?? process.env, fetcher); input.maintenance = await client.json('/status') }
  catch (error) { input.maintenanceError = transportCode(error) }
  const status = row(input.maintenance), cfg = row(status?.control), meta = row(status?.coverage)
  if (client && row(status?.backend)?.state === 'ready' && cfg?.seed_complete === 1 && cfg.targets_complete === 1 && sha(meta?.snapshotSha256)) {
    try { input.coverage = JSON.parse(new TextDecoder().decode(await client.artifact(`maintenance/coverage/${meta.snapshotSha256}.json`))) }
    catch (error) { input.coverageError = error instanceof MaintenanceHttpError && [401, 403].includes(error.httpStatus) ? 'coverage_authentication_failed' : 'coverage_snapshot_unavailable'
      if (input.coverageError === 'coverage_authentication_failed') input.maintenanceError = input.coverageError }
  }
  try { input.release = await fetchPublicRelease(fetcher, options.releaseUrl ?? 'https://studyinchina.vercel.app/api/v1/releases/current') }
  catch { input.releaseError = 'public_release_unavailable' }
  return evaluateCloudMaintenanceHealth(input, { now: options.now, expectedBackend: options.expectedBackend })
}

async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1]
    if (!['--output', '--previous', '--release-url', '--expected-backend'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error('cloud_health_arguments_invalid')
    values.set(flag, value)
  }
  const expectedBackend = values.get('--expected-backend')
  if (expectedBackend !== undefined && !['json', 'shadow', 'd1'].includes(expectedBackend)) throw new Error('cloud_health_backend_invalid')
  const output = values.has('--output') ? resolve(values.get('--output')!) : null, previousPath = values.has('--previous') ? resolve(values.get('--previous')!) : null
  if (output && output === previousPath) throw new Error('cloud_health_output_overwrites_input')
  const previous = previousPath && existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) as unknown : undefined
  const report = await collectCloudMaintenanceHealth({ expectedBackend: expectedBackend as 'json' | 'shadow' | 'd1' | undefined, previous, releaseUrl: values.get('--release-url') })
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`) }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.status === 'fail' || report.status === 'unobserved') process.exitCode = 1
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  process.stderr.write('Cloud maintenance health could not complete; check its explicit arguments and local evidence paths.\n'); process.exitCode = 1
})
