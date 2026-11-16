import { REFILL_SINGLETON, continuousRefillEnabled, type RefillAcquireInput, type RefillEnv, type RefillPermitResult, type RefillWakeInput } from './refill-contract'
import { HASH } from './util'

export { continuousRefillEnabled } from './refill-contract'
async function request(env: RefillEnv, path: '/wake' | '/acquire' | '/claimed' | '/decline' | '/release' | '/status', body?: unknown): Promise<Record<string, unknown>> {
  if (!env.REFILL_COORDINATOR || !HASH.test(env.MAINTENANCE_ADMIN_TOKEN ?? '')) throw new Error('refill_binding_unavailable')
  const stub = env.REFILL_COORDINATOR.get(env.REFILL_COORDINATOR.idFromName(REFILL_SINGLETON))
  const response = await stub.fetch(new Request(`https://catalog-refill.internal${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  if (!response.ok) throw new Error('refill_coordinator_unavailable')
  const value = await response.json() as Record<string, unknown>
  if (!value || typeof value !== 'object') throw new Error('refill_response_invalid')
  return value
}
export async function wakeRefill(env: RefillEnv, input: RefillWakeInput) {
  if (!continuousRefillEnabled(env)) return { enabled: false, reason: 'continuous_refill_disabled' }
  return request(env, '/wake', input)
}
export async function acquireRefillPermit(env: RefillEnv, input: RefillAcquireInput): Promise<RefillPermitResult> {
  if (!continuousRefillEnabled(env)) return input.dispatchToken || input.epochSha256
    ? { allowed: false, reason: 'refill_delivery_disabled', retryAfter: 300 }
    : { allowed: true, reason: 'continuous_refill_disabled', retryAfter: 0 }
  try {
    const value = await request(env, '/acquire', input)
    if (typeof value.allowed !== 'boolean' || typeof value.reason !== 'string' || typeof value.retryAfter !== 'number'
      || value.allowed && typeof value.permitToken !== 'string') throw new Error('refill_permit_invalid')
    return { allowed: value.allowed, reason: value.reason, retryAfter: value.retryAfter,
      ...(typeof value.permitToken === 'string' ? { permitToken: value.permitToken } : {}) }
  }
  catch { return { allowed: false, reason: 'refill_coordinator_unavailable', retryAfter: 30 } }
}
export async function releaseRefillPermit(env: RefillEnv, input: { jobId: string; permitToken: string }) {
  // A deployment pause still lets a real finished job return its permit. The
  // coordinator independently verifies the D1 state; this body is only a hint.
  if (!env.REFILL_COORDINATOR) return { released: false, reason: 'refill_binding_unavailable' }
  return request(env, '/release', input)
}
export async function confirmRefillClaim(env: RefillEnv, input: { jobId: string; permitToken: string; leaseToken: string }) {
  const result = await request(env, '/claimed', input)
  if (result.confirmed !== true) throw new Error('refill_claim_unconfirmed')
  return result
}
export async function declineRefillDelivery(env: RefillEnv, input: { jobId: string; dispatchToken: string; epochSha256: string; reason: string }) {
  return request(env, '/decline', input)
}
export async function readRefillStatus(env: RefillEnv) {
  if (!env.REFILL_COORDINATOR) return { enabled: false, reason: 'refill_binding_unavailable' }
  return request(env, '/status')
}
