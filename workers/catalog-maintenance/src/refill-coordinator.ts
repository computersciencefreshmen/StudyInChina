import type { Control } from './types'
import { control } from './repository'
import { selectRefillCandidates, dispatchRefillCandidates, planDueCaptureJobs,
  observeRefillDispatch, readRefillDispatchStatus, declineRefillDispatch } from './refill-dispatch'
import { fetchPlanQuota, quotaAdmission } from './admission'
import { hasUrgentMaintenance } from './admission-priority'
import { nativeReconciliationGate } from './native-reconciliation-guard'
import { quotaWait, rememberQuotaWait } from './runtime'
import { isDailyD1QuotaError } from './backend-errors'
import { readBackgroundBudgetGate } from '../../shared/background-budget'
import { authorized, canonical, digest, HASH, json, record, requestJson } from './util'
import { continuousRefillEnabled, refillKind, refillModelLimit, refillModelWatermark, REFILL_SINGLETON, REFILL_INTERVAL_MS, REFILL_LIMITS, REFILL_WINDOW_MS,
  type RefillAcquireInput, type RefillCandidate, type RefillDispatchResult, type RefillDurableState, type RefillEnv,
  type RefillFence, type RefillJobState, type RefillKind, type RefillPermitResult } from './refill-contract'

type Gate = { fence: RefillFence | null; capture: boolean; model: boolean; expansion?: boolean; quotaCheckedAt?: number; reason: string; retryAt: number }
type Entry = { candidate: RefillCandidate; fenceSha256: string | null; epochSha256: string; dispatchToken: string;
  kind: RefillKind; phase: 'prepared' | 'sending' | 'sent' | 'uncertain'; createdAt: number;
  chargeWindow: number;
  permit: { token: string; attempt: number; updatedAt: string; observedRunning: boolean; claimLease: string | null } | null }
type Saved = { version: 1; generation: number; epochSha256: string | null; fence: RefillFence | null; outstanding: Record<string, Entry>;
  window: number; used: { capture: number; model: number }; lastRefillAt: number | null; nextRefillAt: number | null;
  idleReason: string; gateRetryAt: number | null; modelDemand: boolean; wakeReason: string | null;
  pendingPlanWindow: number | null; lastPlannedWindow: number | null; quota: { checkedAt: number; model: boolean; expansion: boolean; reason: string; retryAt: number } | null }
type Repository = {
  selectRefillCandidates(env: RefillEnv, options: { kind: RefillKind; limit: number; excludeJobIds: string[]; now: number; allowExpansion?: boolean }): Promise<{ fence: RefillFence | null; candidates: RefillCandidate[]; nextDueAt?: string | null; scanRetryAt?: string | null }>;
  dispatchRefillCandidates(env: RefillEnv, fence: RefillFence, candidates: RefillCandidate[], options: { now: number; dispatchToken: string; epochSha256: string }): Promise<RefillDispatchResult>;
  planDueCaptureJobs(env: RefillEnv, now: number): Promise<unknown>;
  observeRefillDispatch(env: RefillEnv, dispatchToken: string, jobId: string): Promise<boolean>;
  readRefillDispatchStatus(env: RefillEnv, dispatchToken: string, options?: { includeJobState?: boolean }): Promise<{ entries: Array<{ jobId: string; status: string; epochSha256: string; resolution?: string | null; receivedNotStartedReceiptSha256?: string | null }> }>;
  declineRefillDispatch(env: RefillEnv, input: { jobId: string; dispatchToken: string; epochSha256: string; reason: string; currentEpochSha256?: string }): Promise<{ declined: boolean; reason: string }>;
}
export type RefillDependencies = {
  now(): number; gate(env: RefillEnv, now: number, provider: boolean): Promise<Gate>;
  jobs(env: RefillEnv, ids: string[]): Promise<RefillJobState[]>;
  select: Repository['selectRefillCandidates']; dispatch: Repository['dispatchRefillCandidates']; plan: Repository['planDueCaptureJobs'];
  observe: Repository['observeRefillDispatch']; dispatchStatus: Repository['readRefillDispatchStatus'];
  decline: Repository['declineRefillDispatch'];
}
const fenceFor = (cfg: Control): RefillFence => ({ scopeSha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256, revision: cfg.revision, canaryJson: cfg.canary_json })
const TELEMETRY_KEY = 'refill-telemetry-v1'
const sameFence = (a: RefillFence | null, b: RefillFence | null) => Boolean(a && b && a.scopeSha256 === b.scopeSha256
  && a.inputCatalogSha256 === b.inputCatalogSha256 && a.revision === b.revision && a.canaryJson === b.canaryJson)
const stopped = (reason: string, now: number, wait = 300_000, fence: RefillFence | null = null): Gate => ({ fence, capture: false, model: false, reason, retryAt: now + wait })

/** The coordinator never calls a model. Actual admission still performs its own
 * fresh provider/429/concurrency/reservation checks immediately before sending. */
export async function readRefillGate(env: RefillEnv, now: number, provider: boolean): Promise<Gate> {
  if (!continuousRefillEnabled(env)) return stopped('continuous_refill_disabled', now)
  if (env.MODEL_STATE_MIGRATION_ROLE === 'source') return stopped('account_migration_frozen', now)
  if (env.MAINTENANCE_ENABLED !== 'true') return stopped('maintenance_disabled', now)
  const budget = await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET, now)
  if (!budget.allowed) return stopped(budget.code, now)
  const waiting = await quotaWait(env, now)
  if (waiting) return { ...stopped('d1_quota_wait', now), retryAt: Date.parse(waiting.retryAt) }
  const cfg = await control(env)
  if (!cfg) return stopped('control_unavailable', now)
  const fence = fenceFor(cfg)
  if (!cfg.enabled || !cfg.seed_complete || !cfg.targets_complete) return stopped('control_not_ready', now, 60_000, fence)
  if (cfg.scope_sha256 !== env.SCOPE_REGISTRY_SHA256) return stopped('scope_pin_changed', now, 60_000, fence)
  if (!(await nativeReconciliationGate(env)).ready) return stopped('native_head_reconciliation_required', now, 300_000, fence)
  if (!cfg.models_enabled) return { fence, capture: true, model: false, expansion: false, reason: 'models_disabled', retryAt: now + 60_000 }
  if (!provider) return { fence, capture: true, model: true, reason: 'ready', retryAt: now }
  const quota = await fetchPlanQuota(env)
  const checkedAt = Date.now(), urgent = await hasUrgentMaintenance(env, cfg, checkedAt)
  const expansion = quotaAdmission(quota, 'expansion', urgent, env.MINIMAX_CREDIT_FALLBACK_DISABLED === 'true', Date.now())
  const maintenance = quotaAdmission(quota, 'maintenance', urgent, env.MINIMAX_CREDIT_FALLBACK_DISABLED === 'true', Date.now())
  return { fence, capture: true, model: maintenance.allow, expansion: expansion.allow, quotaCheckedAt: checkedAt,
    reason: expansion.code, retryAt: checkedAt + Math.max(expansion.retryAfter, maintenance.retryAfter) * 1000 }
}

async function jobs(env: RefillEnv, ids: string[]): Promise<RefillJobState[]> {
  if (!ids.length) return []
  const rows = (await env.PIPELINE_DB.prepare(`SELECT j.job_id,j.source_id,j.stage,j.status,j.attempt,j.updated_at,j.lease_token,j.lease_until,
    EXISTS(SELECT 1 FROM maintenance_sources s JOIN maintenance_source_schools ss ON ss.source_id=s.source_id
      JOIN maintenance_schools u ON u.university_id=ss.university_id JOIN maintenance_control c ON c.singleton=1
      WHERE s.source_id=j.source_id AND s.enabled=1 AND u.scope_sha256=c.scope_sha256
        AND (json_array_length(c.canary_json)=0 OR u.university_id IN(SELECT value FROM json_each(c.canary_json)))) in_scope,
    CASE WHEN j.stage='capture' THEN 0 ELSE EXISTS(SELECT 1 FROM maintenance_model_attempts a
      WHERE a.source_id=j.source_id AND a.snapshot_sha256=j.snapshot_sha256 AND a.status IN('unknown','send_started','reserved')) END protected_model
    FROM maintenance_jobs j WHERE j.job_id IN(SELECT value FROM json_each(?)) LIMIT 32`).bind(JSON.stringify(ids)).all<{
      job_id: string; source_id: string; stage: RefillJobState['stage']; status: string; attempt: number; updated_at: string;
      lease_token: string | null; lease_until: string | null; in_scope: number; protected_model: number
    }>()).results ?? []
  return rows.map(row => ({ jobId: row.job_id, sourceId: row.source_id, stage: row.stage, status: row.status,
    attempt: row.attempt, updatedAt: row.updated_at, leaseToken: row.lease_token, leaseUntil: row.lease_until,
    inScope: row.in_scope === 1, protectedModel: row.protected_model === 1 }))
}

// Repository functions are supplied by the companion bounded selection/dispatch
// module. The interface keeps fake storage tests independent of queue egress.
const defaults: RefillDependencies = { now: Date.now, gate: readRefillGate, jobs,
  select: selectRefillCandidates, dispatch: dispatchRefillCandidates, plan: planDueCaptureJobs,
  observe: observeRefillDispatch, dispatchStatus: (env, token) => readRefillDispatchStatus(env, token, { includeJobState: false }), decline: declineRefillDispatch }

/** One independent singleton. In particular, it never opens, deletes, expires or
 * rewrites a request in the ModelAdmission Durable Object. */
export class CatalogRefillCoordinator {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly deps: RefillDependencies
  private readonly singleton: boolean
  constructor(private readonly state: RefillDurableState, private readonly env: RefillEnv, dependencies: Partial<RefillDependencies> = {}) {
    this.deps = { ...defaults, ...dependencies }
    this.singleton = env.REFILL_COORDINATOR && state.id !== undefined
      ? String(env.REFILL_COORDINATOR.idFromName(REFILL_SINGLETON)) === String(state.id)
      : Object.keys(dependencies).length > 0
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run)
    this.tail = result.catch(() => undefined)
    return result
  }
  private async load(): Promise<Saved> {
    const saved = await this.state.storage.get<Saved>('refill-v1')
    if (saved) {
      if (saved.version !== 1 || Object.keys(saved.outstanding).length > 32) throw new Error('refill_state_invalid')
      return saved
    }
    return { version: 1, generation: 0, epochSha256: null, fence: null, outstanding: {}, window: Math.floor(this.deps.now() / REFILL_WINDOW_MS),
      used: { capture: 0, model: 0 }, lastRefillAt: null, nextRefillAt: null, idleReason: 'not_started', gateRetryAt: null, modelDemand: false, wakeReason: null,
      pendingPlanWindow: null, lastPlannedWindow: null, quota: null }
  }
  private async save(saved: Saved) {
    const telemetry = this.telemetry(saved)
    // The read-only dashboard observes one committed snapshot. A proof scan or
    // Queue send may take time, but never holds this storage transaction open.
    await this.state.storage.transaction(async txn => {
      await txn.put('refill-v1', saved)
      await txn.put(TELEMETRY_KEY, telemetry)
    })
  }
  private async schedule(saved: Saved, at: number) {
    const now = this.deps.now(), next = Math.max(now + REFILL_INTERVAL_MS, at)
    if (saved.nextRefillAt !== null && saved.nextRefillAt <= next && saved.nextRefillAt > now) {
      // Keeping an earlier alarm must still persist newly requested work, such
      // as the watchdog's capture-planning intent, before returning to its caller.
      await this.save(saved)
      if (!this.state.storage.getAlarm || await this.state.storage.getAlarm() !== saved.nextRefillAt) await this.state.storage.setAlarm(saved.nextRefillAt)
      return
    }
    saved.nextRefillAt = next
    // Saving intention first is safe if alarm installation fails: the watchdog
    // installs it again. No Queue.send is authorized by the alarm alone.
    await this.save(saved)
    await this.state.storage.setAlarm(next)
  }
  private async close(saved: Saved, jobId: string, reason: string) {
    const entry = saved.outstanding[jobId]
    if (!entry) return
    await this.state.storage.put(`closed:${entry.dispatchToken}:${jobId}`, { reason, at: this.deps.now() })
    delete saved.outstanding[jobId]
    await this.save(saved)
  }
  private async reconcile(saved: Saved) {
    const ids = Object.keys(saved.outstanding)
    const current = new Map((await this.deps.jobs(this.env, ids)).map(row => [row.jobId, row]))
    const deliveries = Object.values(saved.outstanding).filter(entry => entry.fenceSha256 !== null)
    for (const dispatchToken of new Set(deliveries.map(entry => entry.dispatchToken))) {
      const ledger = await this.deps.dispatchStatus(this.env, dispatchToken)
      for (const receipt of ledger.entries) {
        const entry = saved.outstanding[receipt.jobId], job = current.get(receipt.jobId)
        if (!entry || entry.dispatchToken !== dispatchToken || receipt.epochSha256 !== entry.epochSha256) continue
        const refused = receipt.status === 'observed' && receipt.resolution === 'received_not_started' && HASH.test(receipt.receivedNotStartedReceiptSha256 ?? '')
        if (refused && job && ['queued', 'retry'].includes(job.status) && job.attempt === entry.candidate.attempt && !job.leaseToken) await this.close(saved, receipt.jobId, 'received_not_started_verified')
        else if (receipt.status === 'not_sent' && job && !job.protectedModel && ['queued', 'retry', 'held', 'done'].includes(job.status)) await this.close(saved, receipt.jobId, 'not_sent_verified')
        else if (receipt.status === 'sent' || receipt.status === 'observed') entry.phase = 'sent'
      }
    }
    for (const id of ids) {
      const entry = saved.outstanding[id], job = current.get(id)
      if (!entry) continue
      if (!job) { entry.phase = 'uncertain'; continue }
      // Neither an unknown result, an active model nor an expired execution
      // lease becomes free capacity through a timer or completion request.
      if (job.status === 'unknown' || job.protectedModel) { entry.phase = 'uncertain'; continue }
      if (job.status === 'running') { if (entry.permit) { entry.permit.observedRunning = true; entry.permit.claimLease = job.leaseToken }; continue }
      if (job.status === 'done' || job.status === 'held') { await this.deps.observe(this.env, entry.dispatchToken, id); await this.close(saved, id, 'terminal_verified'); continue }
      if (entry.permit && job.status === 'retry' && (job.attempt > entry.permit.attempt || entry.permit.observedRunning && job.updatedAt !== entry.permit.updatedAt)) {
        await this.deps.observe(this.env, entry.dispatchToken, id)
        await this.close(saved, id, 'retry_verified'); continue
      }
    }
    await this.save(saved)
    return current
  }
  private resetBudget(saved: Saved, now: number) {
    const window = Math.floor(now / REFILL_WINDOW_MS)
    if (saved.window !== window) { saved.window = window; saved.used = { capture: 0, model: 0 } }
  }
  private async epoch(fence: RefillFence, generation: number) {
    // Raising/lowering an execution cap does not change evidence applicability.
    // Existing permits keep counting until real completion; only data/control
    // epochs and explicit durable suspension invalidate a queued delivery.
    return digest(canonical({ version: 1, fence, generation }))
  }
  private async adopt(saved: Saved, current: Gate) {
    if (!current.fence) return
    const unchanged = saved.fence && sameFence(saved.fence, current.fence) && saved.epochSha256 === await this.epoch(current.fence, saved.generation)
    if (!unchanged) {
      const jobs = await this.reconcile(saved)
      const nextGeneration = saved.generation + 1, nextEpoch = await this.epoch(current.fence, nextGeneration)
      for (const [id, entry] of Object.entries(saved.outstanding)) {
        const row = jobs.get(id)
        // Old deliveries are rejected by acquire. Only provably not-running,
        // not-unknown jobs can leave their old epoch's reservation.
        if (row && ['queued', 'retry'].includes(row.status) && !row.leaseToken && row.attempt === entry.candidate.attempt) {
          if (entry.phase === 'prepared' && !entry.permit) await this.close(saved, id, 'epoch_prepared_invalidated')
          else {
            const receipt = await this.deps.decline(this.env, { jobId: id, dispatchToken: entry.dispatchToken, epochSha256: entry.epochSha256, currentEpochSha256: nextEpoch, reason: 'stale_epoch' })
            if (receipt.declined) await this.close(saved, id, 'epoch_delivery_declined')
          }
        }
      }
      saved.generation = nextGeneration; saved.epochSha256 = nextEpoch; saved.fence = current.fence; saved.quota = null
      await this.save(saved)
    }
  }
  private counts(saved: Saved) {
    const entries = Object.values(saved.outstanding)
    const count = (kind: RefillKind, permits: boolean) => entries.filter(entry => entry.kind === kind && (!permits || entry.permit !== null)).length
    return { pending: { capture: count('capture', false), model: count('model', false) }, inflight: { capture: count('capture', true), model: count('model', true) }, uncertain: entries.filter(entry => entry.phase === 'uncertain' || entry.phase === 'sending' || entry.phase === 'prepared').length }
  }
  private telemetry(saved: Saved) {
    const counts = this.counts(saved), enabled = continuousRefillEnabled(this.env) && this.env.MODEL_STATE_MIGRATION_ROLE !== 'source'
    const channel = (kind: RefillKind) => ({ pending: counts.pending[kind] - counts.inflight[kind], inflight: counts.inflight[kind],
      eligible: null, limit: kind === 'capture' ? 2 : refillModelLimit(this.env), epochUsed: saved.used[kind], epochCap: kind === 'capture' ? 64 : 256 })
    return { format: 'studyinchina.continuous-refill', version: 1, observedAt: new Date(this.deps.now()).toISOString(), enabled,
      state: !enabled ? 'disabled' : saved.gateRetryAt !== null ? 'waiting' : counts.inflight.model + counts.inflight.capture ? 'running' : 'idle',
      reason: saved.idleReason, model: channel('model'), capture: channel('capture'), uncertainDeliveries: counts.uncertain,
      refillLatencyP95Ms: null, refillLatencySamples: 0, modelTaskBusyPercent: null,
      revision: saved.fence?.revision ?? null, idleReason: saved.idleReason,
      lastRefillAt: saved.lastRefillAt === null ? null : new Date(saved.lastRefillAt).toISOString(),
      nextRefillAt: saved.nextRefillAt === null ? null : new Date(saved.nextRefillAt).toISOString(),
      nextWakeAt: saved.nextRefillAt === null ? null : new Date(saved.nextRefillAt).toISOString(),
      gateRetryAt: saved.gateRetryAt === null ? null : new Date(saved.gateRetryAt).toISOString(),
      dispatchBudget: { windowStart: new Date(saved.window * REFILL_WINDOW_MS).toISOString(), used: saved.used, limits: { capture: 64, model: 256 } },
      stageLimits: { capture: 2, model: refillModelLimit(this.env) }, modelCallsPerformed: false }
  }
  private async wake(reason: string, planCaptures = false) {
    const saved = await this.load(), now = this.deps.now()
    if (!continuousRefillEnabled(this.env) || this.env.MODEL_STATE_MIGRATION_ROLE === 'source') {
      saved.idleReason = this.env.MODEL_STATE_MIGRATION_ROLE === 'source' ? 'account_migration_frozen' : 'continuous_refill_disabled'
      saved.nextRefillAt = null; saved.epochSha256 = null; saved.fence = null; await this.save(saved); await this.state.storage.deleteAlarm()
      return this.telemetry(saved)
    }
    saved.wakeReason = reason
    const window = Math.floor(now / REFILL_WINDOW_MS)
    if (planCaptures && saved.lastPlannedWindow !== window) saved.pendingPlanWindow = window
    await this.schedule(saved, Math.max(saved.gateRetryAt ?? 0, (saved.lastRefillAt ?? 0) + REFILL_INTERVAL_MS, now + REFILL_INTERVAL_MS))
    return this.telemetry(saved)
  }
  private async send(saved: Saved, batch: Entry[]) {
    const first = batch[0]
    const fence = await this.state.storage.get<RefillFence>(`plan:${first.dispatchToken}`)
    if (!fence || !first.fenceSha256 || await digest(canonical(fence)) !== first.fenceSha256) throw new Error('refill_dispatch_plan_invalid')
    const members = await this.state.storage.get<string[]>(`plan-members:${first.dispatchToken}`)
    if (!members || canonical([...members].sort()) !== canonical(batch.map(entry => entry.candidate.jobId).sort())) throw new Error('refill_dispatch_group_incomplete')
    const sendingAt = this.deps.now()
    this.resetBudget(saved, sendingAt)
    const cap = first.kind === 'model' ? REFILL_LIMITS.modelPerWindow : REFILL_LIMITS.capturePerWindow
    const uncharged = batch.filter(entry => entry.chargeWindow !== saved.window)
    if (uncharged.length > cap - saved.used[first.kind]) throw new Error('refill_recovery_window_budget')
    for (const entry of uncharged) { saved.used[entry.kind]++; entry.chargeWindow = saved.window }
    batch.forEach(entry => { entry.phase = 'sending' })
    await this.save(saved)
    let result: RefillDispatchResult
    try { result = await this.deps.dispatch(this.env, fence, batch.map(entry => entry.candidate), { now: sendingAt, dispatchToken: first.dispatchToken, epochSha256: first.epochSha256 }) }
    catch { batch.forEach(entry => { entry.phase = 'uncertain' }); await this.save(saved); throw new Error('dispatch_outcome_unconfirmed') }
    const sent = new Set(result.sent), rejected = new Map(result.notSent.map(row => [row.jobId, row.reason]))
    for (const prior of batch) {
      const id = prior.candidate.jobId, entry = saved.outstanding[id]
      if (sent.has(id) && !rejected.has(id)) entry.phase = 'sent'
      else if (rejected.has(id) && !sent.has(id) && !result.unconfirmed.includes(id)) await this.close(saved, id, rejected.get(id)!)
      else entry.phase = 'uncertain'
    }
    await this.save(saved)
  }
  private async refill() {
    if (this.env.MODEL_STATE_MIGRATION_ROLE === 'source') return
    if (!this.singleton) return
    const saved = await this.load(), now = this.deps.now()
    const scheduledFor = saved.nextRefillAt
    saved.nextRefillAt = null
    if (!continuousRefillEnabled(this.env) || this.env.MODEL_STATE_MIGRATION_ROLE === 'source') { await this.wake('watchdog'); return }
    const notBefore = Math.max(scheduledFor ?? 0, saved.gateRetryAt ?? 0, (saved.lastRefillAt ?? 0) + REFILL_INTERVAL_MS)
    if (notBefore > now) { await this.schedule(saved, notBefore); return }
    this.resetBudget(saved, now)
    try {
      const current = await this.deps.gate(this.env, now, true)
      await this.adopt(saved, current)
      if (current.capture) saved.quota = { checkedAt: current.quotaCheckedAt ?? this.deps.now(), model: current.model, expansion: current.expansion !== false, reason: current.reason, retryAt: current.retryAt }
      if (!current.capture && !current.model) {
        saved.idleReason = current.reason; saved.gateRetryAt = current.retryAt
        if (!continuousRefillEnabled(this.env) || this.env.MODEL_STATE_MIGRATION_ROLE === 'source') { await this.save(saved); await this.state.storage.deleteAlarm(); return }
        await this.schedule(saved, current.retryAt); return
      }
      await this.reconcile(saved)
      saved.lastRefillAt = now; saved.gateRetryAt = null
      if (!current.fence || !saved.epochSha256) throw new Error('refill_fence_missing')
      if (saved.pendingPlanWindow !== null) {
        await this.deps.plan(this.env, now)
        saved.lastPlannedWindow = Math.floor(now / REFILL_WINDOW_MS); saved.pendingPlanWindow = null
        await this.save(saved)
      }
      let remaining = REFILL_LIMITS.batch, selected = 0, nextDueAt: number | null = null, scanRetryAt: number | null = null
      const prepared = Object.values(saved.outstanding).filter(entry => entry.phase === 'prepared')
      for (const dispatchToken of new Set(prepared.map(entry => entry.dispatchToken))) {
        const group = Object.values(saved.outstanding).filter(entry => entry.dispatchToken === dispatchToken)
        if (group.length > remaining || !group.every(entry => entry.phase === 'prepared' && entry.epochSha256 === saved.epochSha256
          && (entry.kind === 'capture' ? current.capture : current.model && (current.expansion !== false || entry.candidate.stage === 'maintain')))) continue
        const cap = group[0].kind === 'model' ? REFILL_LIMITS.modelPerWindow : REFILL_LIMITS.capturePerWindow
        if (group.filter(entry => entry.chargeWindow !== saved.window).length > cap - saved.used[group[0].kind]) continue
        // A persisted prepared state proves send-start was never confirmed. A
        // sending/uncertain state is NEVER taken through this recovery path.
        await this.send(saved, group); remaining -= group.length; selected += group.length
      }
      for (const kind of ['model', 'capture'] as const) {
        const count = kind === 'model' && current.expansion === false
          ? Object.values(saved.outstanding).filter(entry => entry.kind === 'model' && entry.candidate.stage === 'maintain').length
          : this.counts(saved).pending[kind]
        const watermark = kind === 'model' ? refillModelWatermark(this.env) : REFILL_LIMITS.capture
        const cap = kind === 'capture' ? REFILL_LIMITS.capturePerWindow : REFILL_LIMITS.modelPerWindow
        const kindRoom = kind === 'model' ? Math.min(watermark - count, REFILL_LIMITS.modelMaxOutstanding - this.counts(saved).pending.model) : watermark - count
        const room = Math.min(remaining, kindRoom, cap - saved.used[kind], 32 - Object.keys(saved.outstanding).length)
        if (room <= 0 || !(kind === 'model' ? current.model : current.capture)) continue
        const plan = await this.deps.select(this.env, { kind, limit: room, excludeJobIds: Object.keys(saved.outstanding), now, allowExpansion: current.expansion !== false })
        const due = Date.parse(plan.nextDueAt ?? '')
        if (Number.isFinite(due) && due > now) nextDueAt = Math.min(nextDueAt ?? Infinity, due)
        const scan = Date.parse(plan.scanRetryAt ?? '')
        // This is only a bounded scan continuation, never evidence that any
        // candidate is eligible, due, or admitted for an execution permit.
        if (Number.isFinite(scan)) scanRetryAt = Math.min(scanRetryAt ?? Infinity, Math.max(now + REFILL_INTERVAL_MS, scan))
        if (!plan.fence || !sameFence(current.fence, plan.fence)) { saved.idleReason = 'selection_epoch_changed'; break }
        if (plan.candidates.length > room || new Set(plan.candidates.map(candidate => candidate.jobId)).size !== plan.candidates.length) throw new Error('refill_selection_invalid')
        if (kind === 'model') saved.modelDemand = plan.candidates.length > 0 || this.counts(saved).pending.model > 0
        if (!plan.candidates.length) continue
        if (plan.candidates.some(candidate => !HASH.test(candidate.jobId) || !HASH.test(candidate.sourceId) || refillKind(candidate.stage) !== kind || saved.outstanding[candidate.jobId]
          || new TextEncoder().encode(canonical(candidate)).length > 2048)) throw new Error('refill_candidate_invalid')
        const dispatchToken = crypto.randomUUID()
        const fenceSha256 = await digest(canonical(plan.fence))
        // Full canary/fairness proofs live once per plan. Repeating a 295-school
        // fence for every outstanding job could exceed a DO value's size limit.
        await this.state.storage.put(`plan:${dispatchToken}`, plan.fence)
        await this.state.storage.put(`plan-members:${dispatchToken}`, plan.candidates.map(candidate => candidate.jobId))
        for (const candidate of plan.candidates) {
          saved.outstanding[candidate.jobId] = { candidate, fenceSha256, epochSha256: saved.epochSha256, dispatchToken, kind, phase: 'prepared', createdAt: now, chargeWindow: saved.window, permit: null }
          saved.used[kind]++
        }
        // Complete selection and its bounded window charge are durable before
        // the send-start marker, which is durable before ANY queue egress.
        await this.save(saved)
        await this.send(saved, plan.candidates.map(candidate => saved.outstanding[candidate.jobId]))
        selected += plan.candidates.length; remaining -= plan.candidates.length
      }
      const counts = this.counts(saved)
      saved.idleReason = selected ? 'dispatched' : counts.uncertain ? 'dispatch_outcome_requires_reconciliation' : counts.pending.model + counts.pending.capture ? 'waiting_for_real_completion' : 'no_eligible_work'
      const capped = saved.used.model >= REFILL_LIMITS.modelPerWindow && saved.used.capture >= REFILL_LIMITS.capturePerWindow
      const wait = capped ? (saved.window + 1) * REFILL_WINDOW_MS : selected ? now + REFILL_INTERVAL_MS : counts.uncertain ? now + 300_000
        : counts.pending.model + counts.pending.capture ? now + 60_000 : Math.min(nextDueAt ?? Infinity, now + REFILL_WINDOW_MS)
      // A blocked model window may sleep while capture has no work. Completion
      // notifications preserve this retry boundary rather than a hot loop.
      await this.schedule(saved, Math.max(capped ? wait : Math.min(wait, scanRetryAt ?? Infinity), saved.gateRetryAt ?? 0))
    } catch (error) {
      saved.idleReason = isDailyD1QuotaError(error) ? 'd1_quota_wait' : error instanceof Error && error.message === 'dispatch_outcome_unconfirmed' ? error.message : 'refill_backend_unavailable'
      if (isDailyD1QuotaError(error)) {
        const waiting = await rememberQuotaWait(this.env)
        saved.gateRetryAt = Date.parse(waiting.retryAt)
      } else saved.gateRetryAt = now + 60_000
      await this.schedule(saved, saved.gateRetryAt)
    }
  }
  private async acquire(input: RefillAcquireInput): Promise<RefillPermitResult> {
    const denied = (reason: string, retryAfter = 10): RefillPermitResult => ({ allowed: false, reason, retryAfter })
    if (!HASH.test(input.jobId)) return denied('refill_job_invalid', 300)
    if (!continuousRefillEnabled(this.env) || this.env.MODEL_STATE_MIGRATION_ROLE === 'source') return denied('continuous_refill_disabled', 300)
    const now = this.deps.now(), saved = await this.load()
    const current = await this.deps.gate(this.env, now, false)
    await this.adopt(saved, current)
    if (!current.capture || !current.fence || !saved.epochSha256) return denied(current.reason, Math.max(10, Math.ceil((current.retryAt - now) / 1000)))
    await this.reconcile(saved)
    const job = (await this.deps.jobs(this.env, [input.jobId]))[0]
    if (!job || !job.inScope || !['capture', 'extract', 'award', 'maintain'].includes(job.stage)) return denied('refill_job_outside_scope', 300)
    if (job.protectedModel || job.status === 'unknown') return denied('refill_unknown_outcome_protected', 300)
    if (job.status !== 'queued' && job.status !== 'retry') return denied('refill_job_not_runnable', 30)
    let entry = saved.outstanding[input.jobId]
    if (input.dispatchToken !== undefined || input.epochSha256 !== undefined) {
      if (!entry || !input.dispatchToken || input.epochSha256 !== saved.epochSha256 || entry.dispatchToken !== input.dispatchToken || entry.epochSha256 !== saved.epochSha256) return denied('refill_delivery_epoch_invalid', 300)
      if (await this.state.storage.get(`closed:${input.dispatchToken}:${input.jobId}`)) return denied('refill_delivery_closed', 300)
    } else if (entry && entry.epochSha256 !== saved.epochSha256) return denied('refill_previous_epoch_inflight', 30)
    if (entry?.phase === 'prepared') return denied('refill_prepared_dispatch_pending', 30)
    if (entry?.permit) return denied('refill_permit_already_held')
    this.resetBudget(saved, now)
    const kind = refillKind(job.stage), counts = this.counts(saved)
    if (kind === 'model') {
      if (!current.model) return denied(current.reason, Math.max(10, Math.ceil((current.retryAt - now) / 1000)))
      if (!saved.quota || now - saved.quota.checkedAt > 30_000 || saved.quota.checkedAt > now) {
        const quotaGate = await this.deps.gate(this.env, this.deps.now(), true)
        if (!quotaGate.fence || !sameFence(current.fence, quotaGate.fence)) return denied('refill_selection_epoch_changed', 30)
        saved.quota = { checkedAt: quotaGate.quotaCheckedAt ?? this.deps.now(), model: quotaGate.model, expansion: quotaGate.expansion !== false, reason: quotaGate.reason, retryAt: quotaGate.retryAt }
        await this.save(saved)
      }
      if (!saved.quota.model || job.stage !== 'maintain' && !saved.quota.expansion) return denied(saved.quota.reason, Math.max(10, Math.ceil((saved.quota.retryAt - now) / 1000)))
    }
    const modelLimit = refillModelLimit(this.env)
    let modelIdleProven = current.model
    if (kind === 'capture' && current.model && !saved.modelDemand && counts.pending.model === 0) {
      const backlog = await this.deps.select(this.env, { kind: 'model', limit: 1, excludeJobIds: Object.keys(saved.outstanding), now })
      if (!sameFence(current.fence, backlog.fence)) return denied('refill_selection_epoch_changed', 30)
      saved.modelDemand = backlog.candidates.length > 0
      modelIdleProven = !backlog.scanRetryAt
    }
    const captureLimit = !modelIdleProven || saved.modelDemand || counts.pending.model > 0 ? REFILL_LIMITS.capture : Math.min(8, REFILL_LIMITS.capture + Math.max(0, modelLimit - counts.inflight.model))
    if (counts.inflight[kind] >= (kind === 'model' ? modelLimit : captureLimit)) return denied('refill_stage_capacity')
    if (!entry) {
      // Existing ordinary Queue deliveries use the same real execution gate.
      // They cannot sidestep the pilot cap or steal all capture/model slots.
      const cap = kind === 'model' ? REFILL_LIMITS.modelPerWindow : REFILL_LIMITS.capturePerWindow
      if (saved.used[kind] >= cap || Object.keys(saved.outstanding).length >= 32 || kind === 'model' && counts.pending.model >= REFILL_LIMITS.modelMaxOutstanding) return denied('refill_dispatch_budget', 60)
      entry = { candidate: { jobId: job.jobId, sourceId: job.sourceId, stage: job.stage, status: job.status as 'queued' | 'retry', attempt: job.attempt, updatedAt: job.updatedAt, enqueuedAt: null, leaseToken: job.leaseToken }, fenceSha256: null, epochSha256: saved.epochSha256,
        dispatchToken: crypto.randomUUID(), kind, phase: 'sent', createdAt: now, chargeWindow: saved.window, permit: null }
      saved.outstanding[job.jobId] = entry; saved.used[kind]++
    }
    entry.permit = { token: crypto.randomUUID(), attempt: job.attempt, updatedAt: job.updatedAt, observedRunning: false, claimLease: null }
    await this.save(saved)
    return { allowed: true, permitToken: entry.permit.token, reason: 'stage_permit_acquired', retryAfter: 0 }
  }
  async fetch(request: Request): Promise<Response> {
    if (!this.singleton) return json({ error: 'refill_singleton_required' }, 409)
    if (!authorized(request, this.env)) return json({ error: 'unauthorized' }, 401)
    if (this.env.MODEL_STATE_MIGRATION_ROLE === 'source') return json({ error: 'account_migration_frozen' }, 503)
    const path = new URL(request.url).pathname
    if (path === '/status' && request.method === 'GET') {
      // Deliberately outside the mutation serial queue. This cannot grant a
      // permit, reconcile jobs, wake an alarm or report a new observation time.
      const snapshot = await this.state.storage.get<ReturnType<CatalogRefillCoordinator['telemetry']>>(TELEMETRY_KEY)
      if (!snapshot || snapshot.format !== 'studyinchina.continuous-refill' || snapshot.version !== 1) return json({ error: 'refill_telemetry_unavailable' }, 503)
      // A deployment flag is known now; task counts and timestamps still belong
      // to the original committed observation and are never relabelled fresh.
      return json(continuousRefillEnabled(this.env) ? snapshot : { ...snapshot, enabled: false, state: 'disabled',
        reason: 'continuous_refill_disabled', idleReason: 'continuous_refill_disabled' })
    }
    return this.serial(async () => {
      if (!this.singleton) return json({ error: 'refill_singleton_required' }, 409)
      if (!authorized(request, this.env)) return json({ error: 'unauthorized' }, 401)
      if (this.env.MODEL_STATE_MIGRATION_ROLE === 'source') return json({ error: 'account_migration_frozen' }, 503)
      const path = new URL(request.url).pathname
      if (request.method !== 'POST') return json({ error: 'not_found' }, 404)
      const body = record(await requestJson(request))
      if (!body) return json({ error: 'invalid_refill_request' }, 400)
      if (path === '/wake' && ['watchdog', 'completion', 'operator'].includes(String(body.reason))) return json(await this.wake(String(body.reason), body.planCaptures === true))
      if (path === '/acquire') return json(await this.acquire(body as RefillAcquireInput))
      if (path === '/decline' && HASH.test(String(body.jobId)) && typeof body.dispatchToken === 'string' && HASH.test(String(body.epochSha256)) && typeof body.reason === 'string') {
        const saved = await this.load()
        const result = await this.deps.decline(this.env, { jobId: String(body.jobId), dispatchToken: body.dispatchToken, epochSha256: String(body.epochSha256), reason: body.reason,
          ...(saved.epochSha256 ? { currentEpochSha256: saved.epochSha256 } : {}) })
        const entry = saved.outstanding[String(body.jobId)]
        if (result.declined && entry?.dispatchToken === body.dispatchToken && entry.epochSha256 === body.epochSha256) await this.close(saved, String(body.jobId), 'received_not_started_verified')
        if (result.declined) await this.wake('completion')
        return json(result)
      }
      if (path === '/claimed' && HASH.test(String(body.jobId)) && typeof body.permitToken === 'string' && typeof body.leaseToken === 'string' && body.leaseToken.length > 0) {
        const saved = await this.load(), entry = saved.outstanding[String(body.jobId)]
        if (!entry?.permit || entry.permit.token !== body.permitToken) return json({ confirmed: false, reason: 'refill_permit_mismatch' })
        const job = (await this.deps.jobs(this.env, [String(body.jobId)]))[0]
        if (!job || job.status !== 'running' || job.leaseToken !== body.leaseToken || job.attempt <= entry.permit.attempt) return json({ confirmed: false, reason: 'running_claim_unproven' })
        await this.deps.observe(this.env, entry.dispatchToken, job.jobId)
        entry.permit.observedRunning = true; entry.permit.claimLease = job.leaseToken
        await this.save(saved)
        return json({ confirmed: true })
      }
      if (path === '/release' && HASH.test(String(body.jobId)) && typeof body.permitToken === 'string') {
        const saved = await this.load(), entry = saved.outstanding[String(body.jobId)]
        if (!entry || entry.permit?.token !== body.permitToken) return json({ released: false, reason: 'refill_permit_mismatch' })
        await this.reconcile(saved)
        const released = !saved.outstanding[String(body.jobId)]
        await this.wake('completion')
        return json({ released, reason: released ? 'terminal_state_verified' : 'job_or_model_still_inflight' })
      }
      return json({ error: 'not_found' }, 404)
    })
  }
  async alarm(): Promise<void> {
    if (this.env.MODEL_STATE_MIGRATION_ROLE === 'source') return
    return this.serial(() => this.refill())
  }
}
