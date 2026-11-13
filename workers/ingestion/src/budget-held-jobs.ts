import { BUDGET_OBSERVATION_KEY, readBackgroundBudgetGate } from '../../shared/background-budget'
import { infrastructureCostPolicy, permitsBrowserForSource, permitsScheduledReason, scheduledJobReason } from './cost-policy'
import { sha256Hex, stableJson } from './hash'
import { readBudgetHeldJobState } from './repository'
import { validateManifest } from './security'
import type { IngestionEnv, IngestionJob } from './types'

export const BUDGET_HELD_PREFIX = 'ingestion/runtime/budget-held-jobs/pending/'
const DONE_PREFIX = 'ingestion/runtime/budget-held-jobs/results/'
const CURSOR_KEY = 'ingestion/runtime/budget-held-jobs/list-cursor.v1.json'
const MAX_BYTES = 4096
const options = { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } }
type Marker = { format: 'studyinchina.ingestion-budget-held-job'; version: 1; heldAt: string; holdSha256: string; job: IngestionJob }

export function isIngestionJob(value: unknown): value is IngestionJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Record<string, unknown>
  return job.version === 1 && typeof job.jobId === 'string' && job.jobId.length > 0
    && typeof job.sourceId === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(job.sourceId)
    && typeof job.reason === 'string' && ['scheduled', 'discovery', 'manual', 'retry'].includes(job.reason)
    && (job.deliveryAttemptOffset === undefined || typeof job.deliveryAttemptOffset === 'number'
      && Number.isSafeInteger(job.deliveryAttemptOffset) && job.deliveryAttemptOffset >= 0 && job.deliveryAttemptOffset <= 1000)
    && typeof job.scheduledAt === 'string' && Number.isFinite(Date.parse(job.scheduledAt))
}

async function readText(env: IngestionEnv, key: string): Promise<string | null> {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object) return null
  if ('size' in object && typeof object.size === 'number' && object.size > MAX_BYTES) throw new Error('budget_held_artifact_too_large')
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) throw new Error('budget_held_artifact_too_large')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
async function read(env: IngestionEnv, key: string): Promise<{ text: string; value: Record<string, unknown> } | null> {
  const text = await readText(env, key)
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('budget_held_artifact_invalid')
  return { text, value: value as Record<string, unknown> }
}

function payload(job: IngestionJob): IngestionJob {
  return { version: 1, jobId: job.jobId, sourceId: job.sourceId, reason: job.reason, scheduledAt: job.scheduledAt }
}
function marker(value: Record<string, unknown>): Marker {
  if (value.format !== 'studyinchina.ingestion-budget-held-job' || value.version !== 1
    || typeof value.heldAt !== 'string' || !Number.isFinite(Date.parse(value.heldAt))
    || typeof value.holdSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.holdSha256) || !isIngestionJob(value.job)) {
    throw new Error('budget_held_marker_invalid')
  }
  return value as Marker
}

/** A durable marker survives provider retry exhaustion. A failed persistence
 * never acknowledges a message; the caller keeps its normal queue retry. */
export async function rememberBudgetHeldJob(env: IngestionEnv, value: unknown, now = new Date()): Promise<void> {
  if (!isIngestionJob(value)) return
  // Separate observations keep a second pause from losing its marker while a
  // previously admitted recovery finishes. Missing observations use an hourly
  // operational bucket, never a claim that business inputs stayed unchanged.
  const observation = await readText(env, BUDGET_OBSERVATION_KEY)
  const holdSha256 = await sha256Hex(observation ?? `missing:${now.toISOString().slice(0, 13)}`)
  const job = payload(value), key = `${BUDGET_HELD_PREFIX}${await sha256Hex(job.jobId)}/${holdSha256}.json`
  const existing = await read(env, key)
  if (!existing) {
    const text = stableJson({ format: 'studyinchina.ingestion-budget-held-job', version: 1, heldAt: now.toISOString(), holdSha256, job })
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('budget_held_artifact_too_large')
    await env.SNAPSHOTS_BUCKET.put(key, text, options)
  }
  const saved = await read(env, key)
  if (!saved || marker(saved.value).holdSha256 !== holdSha256
    || stableJson(payload(marker(saved.value).job)) !== stableJson(job)) throw new Error('budget_held_marker_not_persisted')
}

/** Bounded operational pagination is independent of facts/freshness. Keeping a
 * cursor lets disabled or malformed markers yield to later eligible schools. */
export async function drainBudgetHeldJobs(env: IngestionEnv, maximum: number, now = new Date()) {
  const result = { inspected: 0, redispatched: 0, retained: 0, discarded: 0 }
  if (!env.BUDGET_STATE_BUCKET) return result
  const budget = await readBackgroundBudgetGate(env.BUDGET_STATE_BUCKET, now.getTime())
  if (!budget.allowed || budget.state !== 'ready') return result
  if (!env.SNAPSHOTS_BUCKET.list) throw new Error('budget_held_listing_unavailable')
  const limit = Math.max(1, Math.min(250, Math.floor(maximum) || 20))
  const prior = await read(env, CURSOR_KEY)
  const cursor = prior?.value.format === 'studyinchina.ingestion-budget-held-cursor' && prior.value.version === 1
    && typeof prior.value.cursor === 'string' ? prior.value.cursor : undefined
  const page = await env.SNAPSHOTS_BUCKET.list({ prefix: BUDGET_HELD_PREFIX, limit, ...(cursor ? { cursor } : {}) })
  const failures: unknown[] = []
  const policy = infrastructureCostPolicy(env.INFRA_FORECAST_CNY)
  for (const item of page.objects.slice(0, limit)) {
    result.inspected++
    try {
      if (!new RegExp(`^${BUDGET_HELD_PREFIX}[a-f0-9]{64}/[a-f0-9]{64}\\.json$`, 'u').test(item.key)) throw new Error('budget_held_key_invalid')
      const saved = await read(env, item.key)
      if (!saved) continue
      const held = marker(saved.value), job = payload(held.job), jobHash = await sha256Hex(job.jobId)
      if (item.key !== `${BUDGET_HELD_PREFIX}${jobHash}/${held.holdSha256}.json`) throw new Error('budget_held_key_mismatch')
      const markerSha256 = await sha256Hex(saved.text), jobSha256 = await sha256Hex(stableJson(job)), doneKey = `${DONE_PREFIX}${jobHash}/${markerSha256}.json`
      const verifyDone = (value: Record<string, unknown>) => value.format === 'studyinchina.ingestion-budget-held-result'
        && value.version === 1 && value.markerSha256 === markerSha256 && value.jobSha256 === jobSha256
        && ['redispatched', 'replay_refused'].includes(String(value.outcome))
      const completed = await read(env, doneKey)
      if (completed) {
        if (!verifyDone(completed.value)) throw new Error('budget_held_result_binding_invalid')
        await env.SNAPSHOTS_BUCKET.delete(item.key)
        result.discarded++
        continue
      }
      const state = await readBudgetHeldJobState(env, job.jobId)
      const neverStarted = state?.source_id === job.sourceId && state.reason === job.reason && state.scheduled_at === job.scheduledAt
        && state.status === 'queued' && state.attempt === 0 && state.started_at === null && state.completed_at === null
        && state.outcome === null && state.error_code === null
      let outcome = 'replay_refused'
      if (neverStarted) {
        // A temporarily disabled source retains its marker; pagination keeps it
        // from starving later work and it can recover after an operator enables it.
        if (state.source_enabled !== 1 || !state.manifest_json) { result.retained++; continue }
        const manifest = validateManifest(JSON.parse(state.manifest_json))
        if (manifest.id !== job.sourceId || !manifest.enabled || manifest.robots.mode !== 'enforce'
          || !permitsScheduledReason(policy, job.reason === 'discovery' ? 'discovery' : 'scheduled')
          || !permitsScheduledReason(policy, scheduledJobReason(manifest.sourceCategory))
          || manifest.fetch.renderMode === 'browser' && !permitsBrowserForSource(policy, manifest.sourceCategory)) {
          result.retained++; continue
        }
        await env.INGESTION_QUEUE.send(job)
        result.redispatched++
        outcome = 'redispatched'
      }
      const receipt = stableJson({ format: 'studyinchina.ingestion-budget-held-result', version: 1,
        markerSha256, jobSha256, outcome, observedAt: now.toISOString() })
      await env.SNAPSHOTS_BUCKET.put(doneKey, receipt, options)
      const durable = await read(env, doneKey)
      if (!durable || !verifyDone(durable.value)) throw new Error('budget_held_result_not_persisted')
      await env.SNAPSHOTS_BUCKET.delete(item.key)
      if (!neverStarted) result.discarded++
    } catch (error) { result.retained++; failures.push(error) }
  }
  if (page.truncated && !page.cursor) throw new Error('budget_held_listing_cursor_missing')
  await env.SNAPSHOTS_BUCKET.put(CURSOR_KEY, stableJson({ format: 'studyinchina.ingestion-budget-held-cursor', version: 1,
    cursor: page.truncated ? page.cursor : null }), { httpMetadata: options.httpMetadata })
  if (failures.length) throw new AggregateError(failures, 'Some budget-held ingestion jobs could not be recovered')
  return result
}
