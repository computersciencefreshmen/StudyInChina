import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getTodayDate } from '../data/freshness'
import { selectPublishedData } from '../data/publication'
import type { AuditMeta, DataBundle } from '../data/types'

const DAY = 86_400_000
const identifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,199}$/)
const timestamp = z.string().datetime({ offset: true })
export const attemptOutcomeSchema = z.enum(['captured', 'unchanged', 'failed', 'blocked', 'no_sources'])
const attemptStateSchema = z.object({
  lastAttemptAt: timestamp,
  nextAttemptAt: timestamp,
  consecutiveFailures: z.number().int().min(0).max(1_000_000),
  lastOutcome: attemptOutcomeSchema,
  sourceOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  errorCode: z.string().regex(/^[a-z0-9_-]{1,80}$/).optional(),
}).strict().refine(value => Date.parse(value.nextAttemptAt) > Date.parse(value.lastAttemptAt), 'Retry must follow its attempt')

export const universityMaintenanceStateSchema = z.object({
  format: z.literal('studyinchina.university-maintenance-state'),
  version: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  attempts: z.record(identifier, attemptStateSchema),
}).strict()
export type UniversityMaintenanceState = z.infer<typeof universityMaintenanceStateSchema>
export const universityMaintenanceResultsSchema = z.object({
  format: z.literal('studyinchina.university-maintenance-results'),
  version: z.literal(1),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  results: z.array(z.object({
    universityId: identifier,
    outcome: attemptOutcomeSchema,
    attemptedAt: timestamp,
    completedAt: timestamp.optional(),
    sourceOffset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    errorCode: z.string().regex(/^[a-z0-9_-]{1,80}$/).optional(),
  }).strict()).max(1000),
}).strict()
export type UniversityMaintenanceResults = z.infer<typeof universityMaintenanceResultsSchema>
export type MaintenanceReason = 'zero-current-programs' | 'never-discovered' | 'expiring-within-seven-days' | 'overdue-review' | 'no-current-cycles' | 'blocked' | 'routine-review'

export function emptyUniversityMaintenanceState(): UniversityMaintenanceState {
  return { format: 'studyinchina.university-maintenance-state', version: 1, revision: 0, attempts: {} }
}

export function assertMaintenanceDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error('A real YYYY-MM-DD date is required')
}
export function maintenanceDigest(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)])) : item
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}
const daysAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
const midnightChina = (date: string) => new Date(`${date}T00:00:00+08:00`).toISOString()
const expired = (record: AuditMeta, today: string) => record.status === 'stale' || record.reviewAfter < today
const officialUrl = (value: string | null | undefined): string | null => {
  if (!value) return null
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : null } catch { return null }
}

/** Rotate only within the exact plan's approved sources, never expanding its host or URL scope. */
export function selectUniversityMaintenanceSources(school: {
  official: { admissions: string | null; sources: { url: string }[] }
  scheduling: { sourceOffset?: number }
}) {
  const approvedUrls = [...new Set([school.official.admissions, ...school.official.sources.map(row => row.url)].filter((value): value is string => Boolean(value)))]
  if (!approvedUrls.length) return { approvedUrls, selectedUrls: [] as string[], nextSourceOffset: 0 }
  const start = (school.scheduling.sourceOffset ?? 0) % approvedUrls.length
  const selectedUrls = Array.from({ length: Math.min(2, approvedUrls.length) }, (_, index) => approvedUrls[(start + index) % approvedUrls.length])
  return { approvedUrls, selectedUrls, nextSourceOffset: (start + selectedUrls.length) % approvedUrls.length }
}

/** A local work queue; neither source acquisition nor factual certification occurs here. */
export function buildUniversityMaintenancePlan(bundle: DataBundle, options: {
  today?: string; limit?: number; state?: UniversityMaintenanceState
} = {}) {
  const today = options.today ?? getTodayDate(), limit = options.limit ?? 10
  assertMaintenanceDate(today)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limit must be an integer from 1 through 1000')
  const state = universityMaintenanceStateSchema.parse(options.state ?? emptyUniversityMaintenanceState())
  const publication = selectPublishedData(bundle, today)
  const mapIds = new Set(publication.universities.map(row => row.id))
  const publishedProgramIds = new Set(publication.programs.map(row => row.id))
  const publishedCycleIds = new Set(publication.admissionCycles.map(row => row.id))
  const sourceById = new Map(bundle.sources.filter(row => row.official).map(row => [row.id, row]))
  const programsByUniversity = new Map<string, DataBundle['programs']>()
  const cyclesByProgram = new Map<string, DataBundle['admissionCycles']>()
  for (const row of bundle.programs) programsByUniversity.set(row.universityId, [...(programsByUniversity.get(row.universityId) ?? []), row])
  for (const row of bundle.admissionCycles) cyclesByProgram.set(row.programId, [...(cyclesByProgram.get(row.programId) ?? []), row])
  const universities = publication.universities.map(university => {
    const programs = programsByUniversity.get(university.id) ?? []
    const cycles = programs.flatMap(row => cyclesByProgram.get(row.id) ?? [])
    const currentPrograms = programs.filter(row => publishedProgramIds.has(row.id))
    const currentCycles = cycles.filter(row => publishedCycleIds.has(row.id))
    const records = [university, ...programs, ...cycles].filter(row => row.status !== 'archived')
    const publicRecords = [university, ...currentPrograms, ...currentCycles]
    const reviewDates = records.map(row => row.reviewAfter).sort()
    const futureReviewDates = reviewDates.filter(date => date >= today)
    const expiringCount = publicRecords.filter(row => row.reviewAfter >= today && row.reviewAfter <= daysAfter(today, 7)).length
    const previous = Object.hasOwn(state.attempts, university.id) ? state.attempts[university.id] : undefined
    const reasons: MaintenanceReason[] = []
    if (!currentPrograms.length) reasons.push('zero-current-programs')
    if (!programs.length) reasons.push('never-discovered')
    if (expiringCount) reasons.push('expiring-within-seven-days')
    if (records.some(row => expired(row, today))) reasons.push('overdue-review')
    if (programs.length && !currentCycles.length) reasons.push('no-current-cycles')
    if (previous?.lastOutcome === 'blocked') reasons.push('blocked')
    if (!reasons.length) reasons.push('routine-review')
    const sourceIds = new Set(records.flatMap(row => row.sourceIds))
    const sources = [...sourceIds].flatMap(id => { const row = sourceById.get(id), url = officialUrl(row?.url); return row && url ? [{ id, url, checkedAt: row.accessedAt }] : [] }).sort((a, b) => a.id.localeCompare(b.id))
    const website = officialUrl(university.officialUrl), admissions = officialUrl(university.admissionsUrl)
    return {
      universityId: university.id, cityId: university.cityId, slug: university.slug, name: university.name,
      identity: { status: university.status, verifiedAt: university.verifiedAt, reviewAfter: university.reviewAfter },
      programs: { raw: programs.length, current: currentPrograms.length, expiredReview: programs.filter(row => expired(row, today)).length,
        identityOnly: programs.filter(row => row.verificationScope === 'identity').length, draft: programs.filter(row => row.status === 'draft').length, archived: programs.filter(row => row.status === 'archived').length },
      cycles: { raw: cycles.length, current: currentCycles.length, expiredReview: cycles.filter(row => expired(row, today)).length,
        deadlinePassed: cycles.filter(row => row.dateStatus !== 'rolling' && row.closesOn !== null && row.closesOn < today).length,
        previousCycleReference: cycles.filter(row => row.dateStatus === 'previous-cycle-reference').length, draft: cycles.filter(row => row.status === 'draft').length },
      review: { dueCount: records.filter(row => expired(row, today)).length, oldestReviewDate: reviewDates[0] ?? null,
        nextReviewDate: futureReviewDates[0] ?? null, expiringWithinSevenDays: expiringCount },
      official: { website, admissions, sources, discoveryUrls: [...new Set([admissions, website, ...sources.map(row => row.url)].filter((url): url is string => Boolean(url)))] },
      reasons, priority: reasons.includes('zero-current-programs') ? 0 : expiringCount ? 1 : reasons.includes('overdue-review') ? 2 : 3,
      scheduling: { eligible: !previous || getTodayDate(new Date(previous.nextAttemptAt)) <= today,
        lastAttemptAt: previous?.lastAttemptAt ?? null, nextAttemptAt: previous?.nextAttemptAt ?? null,
        consecutiveFailures: previous?.consecutiveFailures ?? 0, sourceOffset: previous?.sourceOffset ?? 0,
        lastOutcome: previous?.lastOutcome ?? null, errorCode: previous?.errorCode ?? null },
    }
  }).sort((a, b) => a.universityId.localeCompare(b.universityId))
  // Oldest/unattempted first prevents an unchanged empty school starving the rest.
  const eligible = universities.filter(row => row.scheduling.eligible).sort((a, b) =>
    (a.scheduling.lastAttemptAt ?? '').localeCompare(b.scheduling.lastAttemptAt ?? '') || a.priority - b.priority || a.universityId.localeCompare(b.universityId))
  const hiddenUniversities = bundle.universities.filter(row => !mapIds.has(row.id)).map(row => ({ universityId: row.id, cityId: row.cityId, name: row.name,
    status: row.status, reviewAfter: row.reviewAfter, reason: expired(row, today) ? 'identity-review-expired' : row.status !== 'verified' ? 'identity-not-verified'
      : !publication.cities.some(city => city.id === row.cityId) ? 'city-not-published' : 'identity-provenance-or-date' })).sort((a, b) => a.universityId.localeCompare(b.universityId))
  const plan = { format: 'studyinchina.university-maintenance-plan' as const, version: 1 as const, today, timeZone: 'Asia/Shanghai' as const,
    inputSha256: maintenanceDigest(bundle), stateRevision: state.revision, limit,
    policy: { scope: 'all-published-map-universities' as const, sourceCapturePerformed: false, paidCallsPerformed: false,
      canonicalWritesPerformed: false, factsVerified: false, publicationPerformed: false, countsMayOverlap: true,
      ordering: 'eligible oldest-attempt first; then zero-current, expiring, overdue, routine; stable university ID' },
    summary: { rawUniversities: bundle.universities.length, mapUniversities: universities.length, hiddenUniversities: hiddenUniversities.length,
      zeroCurrentPrograms: universities.filter(row => !row.programs.current).length, neverDiscovered: universities.filter(row => !row.programs.raw).length,
      expiringWithinSevenDays: universities.filter(row => row.review.expiringWithinSevenDays > 0).length,
      blocked: universities.filter(row => row.reasons.includes('blocked')).length, eligible: eligible.length, selected: Math.min(limit, eligible.length), cooldown: universities.length - eligible.length },
    universities, hiddenUniversities, selectedUniversityIds: eligible.slice(0, limit).map(row => row.universityId),
  }
  return { ...plan, planSha256: maintenanceDigest(plan) }
}
export type UniversityMaintenancePlan = ReturnType<typeof buildUniversityMaintenancePlan>

/** Outcome receipts schedule work only. A captured source is never a verified record. */
export function recordUniversityMaintenanceAttempts(plan: UniversityMaintenancePlan, initial: UniversityMaintenanceState, input: unknown): UniversityMaintenanceState {
  const state = universityMaintenanceStateSchema.parse(initial), receipt = universityMaintenanceResultsSchema.parse(input)
  if (receipt.planSha256 !== plan.planSha256 || plan.stateRevision !== state.revision) throw new Error('Attempt receipt does not match the exact current plan')
  if (!receipt.results.length) {
    if (plan.selectedUniversityIds.length) throw new Error('An empty receipt is only valid for an empty plan')
    return state
  }
  const selected = new Set(plan.selectedUniversityIds), seen = new Set<string>()
  const attempts = { ...state.attempts }
  for (const result of receipt.results) {
    if (!selected.has(result.universityId) || seen.has(result.universityId)) throw new Error('Attempt must name a selected university exactly once')
    seen.add(result.universityId)
    const attemptDay = getTodayDate(new Date(result.attemptedAt))
    if (attemptDay !== plan.today) throw new Error('Attempt date must match the plan China calendar date')
    if (result.completedAt && Date.parse(result.completedAt) < Date.parse(result.attemptedAt)) throw new Error('Completion must not precede batch admission')
    const school = plan.universities.find(row => row.universityId === result.universityId)!
    if (result.sourceOffset !== selectUniversityMaintenanceSources(school).nextSourceOffset) throw new Error('Source offset must match the exact bounded source rotation')
    const previous = Object.hasOwn(attempts, result.universityId) ? attempts[result.universityId] : undefined
    if (previous && Date.parse(result.attemptedAt) <= Date.parse(previous.lastAttemptAt)) throw new Error('Attempt must be newer than its durable predecessor')
    const failed = !['captured', 'unchanged'].includes(result.outcome)
    const consecutiveFailures = failed ? Math.min((previous?.consecutiveFailures ?? 0) + 1, 1_000_000) : 0
    const delay = result.outcome === 'blocked' ? 14 : result.outcome === 'no_sources' ? 7 : failed ? Math.min(14, 2 ** Math.min(consecutiveFailures - 1, 4)) : 1
    attempts[result.universityId] = { lastAttemptAt: new Date(result.attemptedAt).toISOString(), nextAttemptAt: midnightChina(daysAfter(attemptDay, delay)),
      consecutiveFailures, lastOutcome: result.outcome, sourceOffset: result.sourceOffset, ...(result.errorCode ? { errorCode: result.errorCode } : {}) }
  }
  return universityMaintenanceStateSchema.parse({ ...state, revision: state.revision + 1, attempts })
}
