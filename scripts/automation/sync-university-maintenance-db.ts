import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { assertMaintenanceDate, maintenanceDigest, type UniversityMaintenancePlan } from '../../src/lib/maintenance/university-coverage'

const digest = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative(), date = z.string().refine(value => { try { assertMaintenanceDate(value); return true } catch { return false } })
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,199}$/), timestamp = z.string().datetime({ offset: true })
const programCounts = z.object({ raw: count, current: count, expiredReview: count, identityOnly: count, draft: count, archived: count }).strict()
const cycleCounts = z.object({ raw: count, current: count, expiredReview: count, deadlinePassed: count, previousCycleReference: count, draft: count }).strict()
const schoolSchema = z.object({ universityId: id, cityId: id, name: z.record(z.string(), z.string()),
  identity: z.object({ status: z.enum(['draft', 'verified', 'stale', 'archived']), verifiedAt: date, reviewAfter: date }).strict(),
  programs: programCounts, cycles: cycleCounts,
  reasons: z.array(z.string()), official: z.object({ website: z.string().nullable(), admissions: z.string().nullable(), sources: z.array(z.object({ id: z.string(), url: z.string(), checkedAt: date }).strict()) }).passthrough(),
  scheduling: z.object({ lastAttemptAt: timestamp.nullable(), nextAttemptAt: timestamp.nullable(), consecutiveFailures: count, lastOutcome: z.string().nullable(), sourceOffset: count.optional() }).passthrough(),
}).passthrough()
const hiddenSchema = z.object({ universityId: id, cityId: id, name: z.record(z.string(), z.string()), status: z.enum(['draft', 'verified', 'stale', 'archived']), reviewAfter: date, reason: z.string() }).strict()
const planSchema = z.object({ format: z.literal('studyinchina.university-maintenance-plan'), version: z.literal(1), today: date, timeZone: z.literal('Asia/Shanghai'),
  inputSha256: digest, planSha256: digest, stateRevision: count, selectedUniversityIds: z.array(id), universities: z.array(schoolSchema), hiddenUniversities: z.array(hiddenSchema),
  summary: z.object({ rawUniversities: count, mapUniversities: count, hiddenUniversities: count, selected: count }).passthrough(),
}).passthrough()
const observationSchema = z.object({ requestedUrl: z.string(), finalUrl: z.string().nullable(), startedAt: timestamp, completedAt: timestamp,
  httpStatus: z.number().int().min(100).max(599).nullable(), outcome: z.enum(['captured', 'unchanged', 'blocked', 'failed']), errorCode: z.string().regex(/^[a-z0-9_-]{1,80}$/).nullable(), rawSha256: digest.nullable(),
  byteLength: count.max(2 * 1024 * 1024), rawFile: z.string().nullable(), contentType: z.string().nullable(), completeBody: z.boolean(),
  candidates: z.array(z.object({ url: z.string(), anchorText: z.string(), status: z.literal('candidate_pending_review') }).strict()),
}).strict()
const reportSchema = z.object({ format: z.literal('studyinchina.university-source-capture'), version: z.literal(1), planSha256: digest, today: date,
  policy: z.object({ maximumUrlsPerUniversity: z.literal(2), maximumConcurrentSchools: z.literal(2), minimumDomainIntervalMs: z.literal(5000), maximumResponseBytes: z.literal(2 * 1024 * 1024), requestDeadlineMs: z.literal(20_000), paidCalls: z.literal(0), canonicalWrites: z.literal(0), factsVerified: z.literal(0), publicationPerformed: z.literal(false) }).strict(),
  results: z.array(z.object({ universityId: id, processingStatus: z.enum(['captured_pending_review', 'held', 'no_sources']), attemptedAt: timestamp, completedAt: timestamp.optional(), sources: z.array(observationSchema).max(2) }).strict()),
}).strict()
type Plan = z.infer<typeof planSchema>
type Report = z.infer<typeof reportSchema>
const inside = (root: string, path: string) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
async function containedPath(root: string, path: string) {
  let parent = path
  for (;;) { try { const stat = await lstat(parent); if (parent === path && stat.isSymbolicLink() || !inside(await realpath(root), await realpath(parent))) throw new Error('Ledger path escapes workspace'); return }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const next = dirname(parent); if (next === parent) throw error; parent = next } }
}
function safeUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || [...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization|signature|api.?key/i.test(key))) throw new Error('Credential-bearing or unsafe URL cannot enter the maintenance ledger')
  return url.href
}

export function validateLedgerPlan(input: unknown): Plan {
  const plan = planSchema.parse(input), { planSha256, ...body } = input as UniversityMaintenancePlan
  if (maintenanceDigest(body) !== planSha256) throw new Error('Plan content does not match its exact SHA-256')
  const visible = new Set(plan.universities.map(row => row.universityId)), all = [...visible, ...plan.hiddenUniversities.map(row => row.universityId)]
  if (visible.size !== plan.universities.length || new Set(all).size !== all.length || new Set(plan.selectedUniversityIds).size !== plan.selectedUniversityIds.length
    || plan.selectedUniversityIds.some(value => !visible.has(value)) || plan.summary.mapUniversities !== plan.universities.length || plan.summary.hiddenUniversities !== plan.hiddenUniversities.length
    || plan.summary.rawUniversities !== all.length || plan.summary.selected !== plan.selectedUniversityIds.length) throw new Error('Plan university scope or counts are inconsistent')
  for (const school of plan.universities) {
    if (school.programs.current > school.programs.raw || school.cycles.current > school.cycles.raw) throw new Error('Current counts exceed raw counts')
    for (const url of [school.official.website, school.official.admissions, ...school.official.sources.map(row => row.url)]) if (url) safeUrl(url)
  }
  return plan
}

async function validateLedgerReport(plan: Plan, input: unknown, evidence?: { root: string; directory: string }): Promise<Report | null> {
  if (input === undefined || input === null) return null
  const report = reportSchema.parse(input)
  if (report.planSha256 !== plan.planSha256 || report.today !== plan.today) throw new Error('Capture report does not match the exact plan')
  const selected = new Set(plan.selectedUniversityIds), seen = new Set<string>()
  if (report.results.length !== selected.size) throw new Error('Capture report must cover every selected university once')
  for (const result of report.results) {
    if (!selected.has(result.universityId) || seen.has(result.universityId)) throw new Error('Report university is duplicated or outside selected scope')
    seen.add(result.universityId)
    const school = plan.universities.find(row => row.universityId === result.universityId)!
    const approved = [...new Set([school.official.admissions, ...school.official.sources.map(row => row.url)].filter((value): value is string => Boolean(value)))], hosts = new Set(approved.map(url => new URL(url).hostname))
    const start = approved.length ? (school.scheduling.sourceOffset ?? 0) % approved.length : 0
    const chosen = Array.from({ length: Math.min(2, approved.length) }, (_, index) => approved[(start + index) % approved.length])
    const urls = new Set<string>()
    if (result.completedAt && Date.parse(result.completedAt) < Date.parse(result.attemptedAt)) throw new Error('University attempt times are reversed')
    for (const source of result.sources) {
      if (!chosen.includes(source.requestedUrl) || urls.has(source.requestedUrl)) throw new Error('Source URL is outside the exact capture scope')
      urls.add(source.requestedUrl); safeUrl(source.requestedUrl)
      if (source.finalUrl && (!hosts.has(new URL(safeUrl(source.finalUrl)).hostname))) throw new Error('Final source hostname is outside the approved scope')
      if (Date.parse(source.completedAt) < Date.parse(source.startedAt)) throw new Error('Source observation times are reversed')
      for (const candidate of source.candidates) if (!hosts.has(new URL(safeUrl(candidate.url)).hostname)) throw new Error('Candidate hostname is outside the approved scope')
      if (source.rawSha256 !== null || source.rawFile !== null) {
        if (!evidence || !source.rawSha256 || !source.rawFile || !source.completeBody) throw new Error('Raw evidence file and hash are required')
        const path = resolve(evidence.directory, source.rawFile)
        if (!inside(evidence.directory, path)) throw new Error('Raw evidence path escapes its report directory')
        await containedPath(evidence.root, path)
        if ((await lstat(path)).size > 2 * 1024 * 1024) throw new Error('Raw evidence exceeds the capture limit')
        const bytes = await readFile(path)
        if (bytes.length !== source.byteLength || createHash('sha256').update(bytes).digest('hex') !== source.rawSha256) throw new Error('Raw evidence hash or size differs')
      } else if (source.byteLength !== 0 || source.completeBody || ['captured', 'unchanged'].includes(source.outcome)) throw new Error('Successful observation lacks raw evidence')
    }
    const captured = result.sources.some(source => ['captured', 'unchanged'].includes(source.outcome))
    if (captured !== (result.processingStatus === 'captured_pending_review') || (result.sources.length === 0) !== (result.processingStatus === 'no_sources')) throw new Error('Report status does not match its source observations')
  }
  return report
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO schema_version VALUES(1,1);
CREATE TABLE IF NOT EXISTS maintenance_runs (plan_sha256 TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, source_date TEXT NOT NULL, state_revision INTEGER NOT NULL, status TEXT NOT NULL, report_sha256 TEXT, selected_count INTEGER NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS university_coverage (university_id TEXT PRIMARY KEY, name_json TEXT NOT NULL, city_id TEXT NOT NULL, visibility TEXT NOT NULL, active INTEGER NOT NULL, raw_program_count INTEGER, current_program_count INTEGER NOT NULL, expired_program_count INTEGER, identity_only_count INTEGER, draft_program_count INTEGER, raw_cycle_count INTEGER, current_cycle_count INTEGER NOT NULL, expired_cycle_count INTEGER, passed_deadline_count INTEGER, reasons_json TEXT NOT NULL, official_urls_json TEXT NOT NULL, identity_verified_at TEXT, identity_review_after TEXT NOT NULL, evaluated_for_date TEXT NOT NULL, last_plan_sha256 TEXT NOT NULL REFERENCES maintenance_runs(plan_sha256), last_attempt_at TEXT, next_attempt_at TEXT, consecutive_failures INTEGER NOT NULL, last_outcome TEXT);
CREATE TABLE IF NOT EXISTS coverage_history (plan_sha256 TEXT NOT NULL REFERENCES maintenance_runs(plan_sha256), university_id TEXT NOT NULL, visibility TEXT NOT NULL, coverage_json TEXT NOT NULL, PRIMARY KEY(plan_sha256,university_id));
CREATE TABLE IF NOT EXISTS source_observations (plan_sha256 TEXT NOT NULL REFERENCES maintenance_runs(plan_sha256), university_id TEXT NOT NULL, requested_url TEXT NOT NULL, final_url TEXT, checked_at TEXT NOT NULL, http_status INTEGER, raw_sha256 TEXT, byte_length INTEGER NOT NULL, outcome TEXT NOT NULL, processing_status TEXT NOT NULL, error_code TEXT, PRIMARY KEY(plan_sha256,university_id,requested_url));
CREATE TABLE IF NOT EXISTS university_attempts (plan_sha256 TEXT NOT NULL REFERENCES maintenance_runs(plan_sha256), university_id TEXT NOT NULL, attempted_at TEXT NOT NULL, processing_status TEXT NOT NULL, source_count INTEGER NOT NULL, completed_at TEXT, PRIMARY KEY(plan_sha256,university_id));
CREATE TABLE IF NOT EXISTS ledger_head (singleton INTEGER PRIMARY KEY CHECK(singleton=1), plan_sha256 TEXT NOT NULL, source_date TEXT NOT NULL, state_revision INTEGER NOT NULL, input_sha256 TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS university_coverage_due ON university_coverage(active,current_program_count,identity_review_after);
CREATE INDEX IF NOT EXISTS source_observations_school ON source_observations(university_id,checked_at);
`

/** Query mirror only. JSON execution state and the official catalogue remain independent. */
export async function ingestUniversityMaintenanceLedger(db: DatabaseSync, planInput: unknown, reportInput?: unknown, options: { now?: string; evidence?: { root: string; directory: string } } = {}) {
  const plan = validateLedgerPlan(planInput), report = await validateLedgerReport(plan, reportInput, options.evidence), now = options.now ?? new Date().toISOString()
  timestamp.parse(now)
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  if (version !== 0 && version !== 1) throw new Error('Unsupported maintenance ledger schema version')
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;')
  try {
    db.exec(SCHEMA)
    if (!db.prepare('PRAGMA table_info(university_attempts)').all().some(column => column.name === 'completed_at')) db.exec('ALTER TABLE university_attempts ADD COLUMN completed_at TEXT')
    if (db.prepare('SELECT version FROM schema_version WHERE singleton=1').get()?.version !== 1) throw new Error('Unsupported maintenance ledger schema version')
    db.exec('PRAGMA user_version=1;')
    const reportSha = report ? maintenanceDigest(reportInput) : null
    const prior = db.prepare('SELECT report_sha256 FROM maintenance_runs WHERE plan_sha256=?').get(plan.planSha256)
    if (prior?.report_sha256 && reportSha && prior.report_sha256 !== reportSha) throw new Error('An immutable report already exists for this plan')
    const runStatus = report ? !report.results.length ? 'no_work' : report.results.some(row => row.processingStatus === 'captured_pending_review') ? 'captured_pending_review' : 'held' : 'planned'
    db.prepare(`INSERT INTO maintenance_runs VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(plan_sha256) DO UPDATE SET status=CASE WHEN excluded.report_sha256 IS NULL THEN maintenance_runs.status ELSE excluded.status END, report_sha256=COALESCE(excluded.report_sha256,maintenance_runs.report_sha256), last_seen_at=excluded.last_seen_at`).run(plan.planSha256, plan.inputSha256, plan.today, plan.stateRevision, runStatus, reportSha, plan.selectedUniversityIds.length, now, now)
    const head = db.prepare('SELECT * FROM ledger_head WHERE singleton=1').get()
    const replaceCoverage = !head || plan.today > String(head.source_date) || plan.today === head.source_date && (plan.stateRevision > Number(head.state_revision) || plan.stateRevision === head.state_revision && plan.inputSha256 === head.input_sha256)
    if (replaceCoverage) db.exec("UPDATE university_coverage SET active=0,visibility='removed'")
    const upsert = db.prepare(`INSERT INTO university_coverage VALUES(${Array(24).fill('?').join(',')}) ON CONFLICT(university_id) DO UPDATE SET name_json=excluded.name_json,city_id=excluded.city_id,visibility=excluded.visibility,active=excluded.active,raw_program_count=excluded.raw_program_count,current_program_count=excluded.current_program_count,expired_program_count=excluded.expired_program_count,identity_only_count=excluded.identity_only_count,draft_program_count=excluded.draft_program_count,raw_cycle_count=excluded.raw_cycle_count,current_cycle_count=excluded.current_cycle_count,expired_cycle_count=excluded.expired_cycle_count,passed_deadline_count=excluded.passed_deadline_count,reasons_json=excluded.reasons_json,official_urls_json=excluded.official_urls_json,identity_verified_at=excluded.identity_verified_at,identity_review_after=excluded.identity_review_after,evaluated_for_date=excluded.evaluated_for_date,last_plan_sha256=excluded.last_plan_sha256,last_attempt_at=COALESCE(excluded.last_attempt_at,university_coverage.last_attempt_at),next_attempt_at=COALESCE(excluded.next_attempt_at,university_coverage.next_attempt_at),consecutive_failures=CASE WHEN excluded.last_attempt_at IS NULL THEN university_coverage.consecutive_failures ELSE excluded.consecutive_failures END,last_outcome=COALESCE(excluded.last_outcome,university_coverage.last_outcome)`)
    const history = db.prepare('INSERT OR IGNORE INTO coverage_history VALUES(?,?,?,?)')
    for (const school of plan.universities) {
      history.run(plan.planSha256, school.universityId, 'visible', JSON.stringify({ programs: school.programs, cycles: school.cycles, reasons: school.reasons,
        scheduling: { lastAttemptAt: school.scheduling.lastAttemptAt, nextAttemptAt: school.scheduling.nextAttemptAt,
          consecutiveFailures: school.scheduling.consecutiveFailures, lastOutcome: school.scheduling.lastOutcome,
          ...(typeof school.scheduling.sourceOffset === 'number' ? { sourceOffset: school.scheduling.sourceOffset } : {}) } }))
      if (replaceCoverage) upsert.run(school.universityId, JSON.stringify(school.name), school.cityId, 'visible', 1, school.programs.raw, school.programs.current, school.programs.expiredReview, school.programs.identityOnly, school.programs.draft, school.cycles.raw, school.cycles.current, school.cycles.expiredReview, school.cycles.deadlinePassed, JSON.stringify(school.reasons), JSON.stringify([...new Set([school.official.website, school.official.admissions, ...school.official.sources.map(row => row.url)].filter(Boolean))]), school.identity.verifiedAt, school.identity.reviewAfter, plan.today, plan.planSha256, school.scheduling.lastAttemptAt, school.scheduling.nextAttemptAt, school.scheduling.consecutiveFailures, school.scheduling.lastOutcome)
    }
    for (const school of plan.hiddenUniversities) {
      history.run(plan.planSha256, school.universityId, 'hidden', JSON.stringify({ identityStatus: school.status, reviewAfter: school.reviewAfter, reason: school.reason, hiddenDetailCounts: 'unknown' }))
      if (replaceCoverage) upsert.run(school.universityId, JSON.stringify(school.name), school.cityId, 'hidden', 0, null, 0, null, null, null, null, 0, null, null, JSON.stringify([school.reason]), '[]', null, school.reviewAfter, plan.today, plan.planSha256, null, null, 0, null)
    }
    if (replaceCoverage) db.prepare('INSERT INTO ledger_head VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET plan_sha256=excluded.plan_sha256,source_date=excluded.source_date,state_revision=excluded.state_revision,input_sha256=excluded.input_sha256').run(plan.planSha256, plan.today, plan.stateRevision, plan.inputSha256)
    const observation = db.prepare('INSERT OR IGNORE INTO source_observations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    const attempt = db.prepare('INSERT OR IGNORE INTO university_attempts VALUES(?,?,?,?,?,?)')
    if (report) for (const school of report.results) {
      attempt.run(plan.planSha256, school.universityId, school.attemptedAt, school.processingStatus, school.sources.length, school.completedAt ?? null)
      for (const source of school.sources) observation.run(plan.planSha256, school.universityId, source.requestedUrl, source.finalUrl, source.completedAt, source.httpStatus, source.rawSha256, source.byteLength, source.outcome, school.processingStatus, source.errorCode)
    }
    db.exec('COMMIT')
    return { format: 'studyinchina.university-maintenance-ledger-summary', schemaVersion: 1, role: 'local-operational-query-mirror', executionAuthority: 'json-maintenance-state', factualCatalogueChanged: false, websiteBackendChanged: false,
      ingestedPlanSha256: plan.planSha256, coverageHeadUpdated: replaceCoverage, counts: db.prepare(`SELECT (SELECT COUNT(*) FROM university_coverage WHERE active=1) AS active_map_universities,(SELECT COUNT(*) FROM university_coverage WHERE visibility='hidden') AS hidden_universities,(SELECT COUNT(*) FROM maintenance_runs) AS maintenance_runs,(SELECT COUNT(*) FROM source_observations) AS source_observations,(SELECT COUNT(*) FROM coverage_history) AS history_rows`).get() }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

export type LedgerArguments = { root: string; planFile: string; reportFile?: string; database: string }
export function parseUniversityLedgerArguments(args: string[], root = process.cwd()): LedgerArguments {
  const values = new Map<string, string>(), allowed = new Set(['--plan', '--report', '--database'])
  for (let i = 0; i < args.length; i += 2) { if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown, duplicate or incomplete ledger argument'); values.set(args[i], args[i + 1]) }
  if (!values.has('--plan')) throw new Error('--plan is required')
  root = resolve(root)
  const path = (value: string) => { const result = resolve(root, value); if (!inside(root, result)) throw new Error('Ledger inputs must stay within workspace'); return result }
  const database = path(values.get('--database') ?? '.tmp/university-maintenance/maintenance.sqlite')
  if (!inside(resolve(root, '.tmp/university-maintenance'), database) || extname(database) !== '.sqlite') throw new Error('Ledger database must be a .sqlite file under .tmp/university-maintenance')
  const planFile = path(values.get('--plan')!), reportFile = values.has('--report') ? path(values.get('--report')!) : undefined
  if (database === planFile || database === reportFile) throw new Error('Database and input paths must differ')
  return { root, database, planFile, reportFile }
}
export async function syncUniversityMaintenanceDb(options: LedgerArguments) {
  for (const path of [options.database, `${options.database}-journal`, `${options.database}-wal`, `${options.database}-shm`, options.planFile, ...(options.reportFile ? [options.reportFile] : [])]) await containedPath(options.root, path)
  const plan = JSON.parse(await readFile(options.planFile, 'utf8')), report = options.reportFile ? JSON.parse(await readFile(options.reportFile, 'utf8')) : undefined
  // Validate before creating a new database. Historical plan artifacts remain queryable after execution state advances.
  validateLedgerPlan(plan)
  await mkdir(dirname(options.database), { recursive: true }); await containedPath(options.root, options.database)
  const db = new DatabaseSync(options.database, { timeout: 5000, enableForeignKeyConstraints: true })
  try { db.exec('PRAGMA journal_mode=DELETE;'); return await ingestUniversityMaintenanceLedger(db, plan, report, { evidence: options.reportFile ? { root: options.root, directory: dirname(options.reportFile) } : undefined }) }
  finally { db.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncUniversityMaintenanceDb(parseUniversityLedgerArguments(process.argv.slice(2))).then(summary => console.log(JSON.stringify(summary)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Local maintenance ledger sync failed'); process.exitCode = 1 })
}
