import type { DurableNamespace, DurableStorage, MaintenanceEnv } from './types'

export const REFILL_SINGLETON = 'catalog-refill-v1'
export const REFILL_DISPATCH_TOKEN = /^[A-Za-z0-9_-]{8,160}$/
export const REFILL_INTERVAL_MS = 10_000
export const REFILL_WINDOW_MS = 15 * 60_000
export const REFILL_LIMITS = { capture: 2, model: 8, modelMaxOutstanding: 30, capturePerWindow: 64, modelPerWindow: 256, batch: 8 } as const
export type RefillKind = 'capture' | 'model'
export type RefillStage = 'capture' | 'extract' | 'award' | 'maintain'
export type RefillEnv = MaintenanceEnv & { REFILL_COORDINATOR?: DurableNamespace; CONTINUOUS_REFILL_ENABLED?: string; REFILL_MODEL_LIMIT?: string }
export type RefillFence = { scopeSha256: string; inputCatalogSha256: string; revision: number; canaryJson: string }
export type RefillCandidate = { jobId: string; sourceId: string; stage: RefillStage;
  status: 'queued' | 'retry'; attempt: number; updatedAt: string; enqueuedAt: string | null; leaseToken: string | null;
  [key: string]: unknown }
export type RefillDispatchResult = { sent: string[]; notSent: Array<{ jobId: string; reason: string }>; unconfirmed: string[] }
export type RefillJobState = { jobId: string; sourceId: string; stage: RefillStage; status: string; attempt: number; updatedAt: string; leaseToken: string | null; leaseUntil: string | null; protectedModel: boolean; inScope: boolean }
export type RefillAcquireInput = { jobId: string; dispatchToken?: string; epochSha256?: string }
export type RefillPermitResult = { allowed: boolean; permitToken?: string; reason: string; retryAfter: number }
export type RefillWakeInput = { reason: 'watchdog' | 'completion' | 'operator'; planCaptures?: boolean }
export type RefillStorage = DurableStorage & { setAlarm(time: number): Promise<void>; deleteAlarm(): Promise<void>; getAlarm?(): Promise<number | null> }
export type RefillDurableState = { storage: RefillStorage; id?: unknown }
export const continuousRefillEnabled = (env: RefillEnv) => env.CONTINUOUS_REFILL_ENABLED === 'true'
export const refillKind = (stage: RefillStage): RefillKind => stage === 'capture' ? 'capture' : 'model'
/** Stage pilots are explicit; absent or malformed values retain the original two. */
export const refillModelLimit = (env: RefillEnv) =>
  env.REFILL_MODEL_LIMIT === '4' ? 4 : env.REFILL_MODEL_LIMIT === '8' ? 8 : env.REFILL_MODEL_LIMIT === '16' ? 16 : 2
/** Keep two capture slots inside the existing 32-job durable/SQL state bound. */
export const refillModelWatermark = (env: RefillEnv) => Math.min(REFILL_LIMITS.modelMaxOutstanding,Math.max(REFILL_LIMITS.model,refillModelLimit(env)*2))
