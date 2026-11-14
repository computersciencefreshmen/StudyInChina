import { readPlanQuotaReport } from './quota-report'
import type { MaintenanceEnv } from './types'
import { CLOUD_MONITOR_REFRESH_MS, type CloudQuotaSnapshot, unknownCloudQuota, quotaObservationIsCurrent } from '../../../src/lib/admin/cloud-minimax-contract'

type Cached = { until: number; good: CloudQuotaSnapshot | null; pending?: Promise<CloudQuotaSnapshot> }
const cache = new WeakMap<MaintenanceEnv, Cached>()
/** Per-isolate monitoring cache only. Admission fetches its own fresh quota. */
export async function readQuotaSnapshot(env: MaintenanceEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<CloudQuotaSnapshot> {
  if (env.MODEL_STATE_MIGRATION_ROLE === 'source') return unknownCloudQuota(now)
  let saved = cache.get(env)
  if (saved?.pending) return saved.pending
  if (saved && saved.until > now && saved.good) return quotaObservationIsCurrent(saved.good, now) ? saved.good : { ...saved.good, state: saved.good.observedAt ? 'stale' : 'unknown' }
  saved ??= { until: 0, good: null }
  const entry = saved
  const pending = (async () => {
    try {
      const report = await readPlanQuotaReport(env, fetcher), q = report.quota
      if (!q) throw new Error('quota_unavailable')
      const value: CloudQuotaSnapshot = { state: 'fresh', observedAt: q.checkedAt, checkedAt: report.observedAt,
        fiveHour: { remainingPercent: q.fiveHourRemaining, startAt: q.fiveHourStart, resetAt: q.fiveHourReset },
        weekly: { unlimited: q.weeklyUnlimited === true, remainingPercent: q.weeklyRemaining, startAt: q.weeklyStart, resetAt: q.weeklyReset }, code: 'observed', modelCallsPerformed: false }
      entry.good = value; entry.until = now + CLOUD_MONITOR_REFRESH_MS
      return value
    } catch {
      const value: CloudQuotaSnapshot = entry.good ? { ...entry.good, state: entry.good.observedAt ? 'stale' : 'unknown', checkedAt: new Date(now).toISOString(), code: 'quota_unavailable' } : unknownCloudQuota(now)
      entry.good = value; entry.until = now + 15_000
      return value
    } finally { entry.pending = undefined }
  })()
  entry.pending = pending; cache.set(env, entry)
  return pending
}
