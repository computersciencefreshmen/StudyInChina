import type { MaintenanceEnv } from './types'

/** Exact opt-in only: malformed values must never enlarge the default queue.
 * Falling back to eight preserves existing operation after a deployment typo.
 * This is a dispatch bound, not a model-concurrency or provider-quota override. */
export function tickJobLimit(env: Pick<MaintenanceEnv, 'TICK_JOB_LIMIT'>): 8 | 16 | 32 {
  return env.TICK_JOB_LIMIT === '32' ? 32 : env.TICK_JOB_LIMIT === '16' ? 16 : 8
}
