import { readQuotaProvider, normalizePlanQuota } from './admission'
import type { MaintenanceEnv } from './types'
import { nowIso, record } from './util'

const QUOTA_FIELDS = ['current_interval_remaining_percent', 'current_weekly_remaining_percent',
  'current_interval_status', 'current_weekly_status', 'interval_boost_permille', 'weekly_boost_permille',
  'current_interval_total_count', 'current_interval_usage_count', 'current_weekly_total_count', 'current_weekly_usage_count',
  'start_time', 'end_time', 'weekly_start_time', 'weekly_end_time'] as const

// Preserve the distinction between missing, null, and an unexpected type while
// refusing arbitrary provider strings, account IDs, keys, or response bodies.
function providerObservation(payload: unknown) {
  const root = record(payload)
  const rows = Array.isArray(root?.model_remains) ? root.model_remains.map(record).filter(row => row?.model_name === 'general') : []
  return {
    responseReceived: payload !== null,
    statusCode: typeof record(root?.base_resp)?.status_code === 'number' ? record(root?.base_resp)?.status_code : null,
    generalRows: rows.length,
    fields: rows.length === 1 && rows[0] ? Object.fromEntries(QUOTA_FIELDS.map(key => {
      const value = rows[0]![key]
      return [key, { present: Object.hasOwn(rows[0]!, key), type: value === null ? 'null' : typeof value,
        value: typeof value === 'number' && Number.isFinite(value) ? value : null }]
    })) : null,
  }
}

/** A provider read, independent of the D1 execution ledger. This never admits
 * work, consumes a model request, or changes the account's billing settings. */
export async function readPlanQuotaReport(env: MaintenanceEnv, fetcher: typeof fetch = fetch) {
  const {payload,transport} = await readQuotaProvider(env, fetcher), quota = normalizePlanQuota(payload)
  return {
    format: 'studyinchina.maintenance-quota', version: 1,
    observedAt: nowIso(), state: quota ? 'observed' : 'quota_unknown',
    quota, providerTransport: transport, providerObservation: providerObservation(payload), backendIndependent: true, modelCallsPerformed: false,
    admissionPolicy: {
      minimumRemainingPercent: env.MINIMAX_CREDIT_FALLBACK_DISABLED === 'true' ? 0 : 5,
      urgentMaintenanceReservePercent: 20,
      providerBillingSettingsVerified: false,
    },
  }
}
