import { createHash } from 'node:crypto'

const SERVICE = 'https://studyinchina-catalog-maintenance.yanghanyu2023.workers.dev'
type Outcome = 'received' | 'rate_limited' | 'unknown' | 'not_sent'
const reasons = new Set(['model_lane_disabled', 'translation_lane_disabled', 'model_capacity_offline_fenced',
  'model_capacity', 'quota_unknown', 'quota_exhausted_or_overflow_margin', 'maintenance_quota_reserved',
  'quota_backend_wait', 'account_migration_frozen', 'unauthorized', 'budget_wait'])

/** The Git journal controls which work may be retried. The account Worker
 * serializes quota/capacity decisions with the official extraction lane. */
export async function acquireTranslationPermit(wire: string, transport = fetch, environment = process.env) {
  const token = environment.CATALOG_MAINTENANCE_TOKEN
  if (environment.CATALOG_MAINTENANCE_URL?.replace(/\/$/u, '') !== SERVICE || !token || /[\r\n]/u.test(token)) return { state: 'wait' as const, reason: 'admission_configuration_missing', retrySeconds: 900 }
  const requestSha256 = createHash('sha256').update(wire).digest('hex')
  const post = (path: string, data: object) => transport(SERVICE + path, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(data) })
  try {
    const response = await post('/translation/acquire', { requestSha256 })
    const reply = await response.json()
    if (reply?.error === 'translation_outcome_protected') return { state: 'protected' as const }
    if (!response.ok || typeof reply?.permit !== 'string' || !/^[a-f0-9-]{36}$/u.test(reply.permit)) {
      // Never carry unexpected response text, identifiers, or credentials into the feed.
      const reason = reasons.has(reply?.error) ? reply.error as string : 'admission_response_unrecognized'
      return { state: 'wait' as const, reason, retrySeconds: Number.isFinite(reply?.retryAfter) ? Math.max(30, Math.min(604800, reply.retryAfter)) : 900 }
    }
    const permit = reply.permit
    return { state: 'admitted' as const, async settle(outcome: Outcome, retrySeconds?: number) {
      // A lost acknowledgement must not turn an already completed model result
      // into permission to replay. The central lease expires; its digest stays protected.
      try {
        const ack = await post('/translation/settle', { requestSha256, permit, outcome, retrySeconds })
        await ack.body?.cancel()
      } catch { /* durable journal remains authoritative for this result */ }
    } }
  } catch { return { state: 'wait' as const, reason: 'admission_service_unavailable', retrySeconds: 300 } }
}
