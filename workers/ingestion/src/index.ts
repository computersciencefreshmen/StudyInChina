import { registerAutomaticSourceBindings } from './automatic-source-bindings'
import { handleOperations } from './operations'
import { withAutomationHeartbeat } from '../../shared/automation-heartbeat'
import { readBackgroundBudgetGate, BACKGROUND_BUDGET_RETRY_SECONDS } from '../../shared/background-budget'
import { registerDiscoveredSources } from './source-discovery'
import { asIngestionError, IngestionError } from './errors'
import {
  infrastructureCostPolicy,
  permitsBrowserForSource,
  permitsScheduledReason,
  scheduledJobReason,
} from './cost-policy'
import { sha256Hex } from './hash'
import { processIngestionJob } from './pipeline'
import { ensureReadBudgetIndexes } from './read-budget-indexes'
import { drainBudgetHeldJobs, isIngestionJob, rememberBudgetHeldJob } from './budget-held-jobs'
import {
  claimJob,
  acquireDomainLease,
  listDueSourceIds,
  loadSourceState,
  markEnqueueFailed,
  markJobRunning,
  recordJobFailure,
  releaseDomainLease,
} from './repository'
import { boundedInteger, retryDelaySeconds } from './retry'
import { constantTimeEqual } from './security'
import {
  INGESTION_SERVICE_VERSION,
  type IngestionEnv,
  type IngestionFailure,
  type IngestionJob,
  type QueueMessageBatch,
  type ScheduledControllerLike,
} from './types'

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function enqueueClaimedJob(environment: IngestionEnv, job: IngestionJob): Promise<boolean> {
  if (!(await claimJob(environment, job))) return false
  try {
    await environment.INGESTION_QUEUE.send(job)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markEnqueueFailed(environment, job.jobId, new Date().toISOString(), message)
    throw error
  }
}

async function scheduleDueSources(
  controller: ScheduledControllerLike,
  environment: IngestionEnv,
): Promise<void> {
  const scheduledAt = new Date(controller.scheduledTime).toISOString()
  const limit = boundedInteger(environment.SCHEDULE_BATCH_LIMIT, 20, 1, 250)
  const costPolicy = infrastructureCostPolicy(environment.INFRA_FORECAST_CNY)
  const errors: unknown[] = []
  try { await drainBudgetHeldJobs(environment, limit) }
  catch (error) { errors.push(error) }
  if (costPolicy.allowDiscovery) {
    try { await registerDiscoveredSources(environment, scheduledAt) }
    catch (error) { errors.push(error) }
  }
  try { await registerAutomaticSourceBindings(environment, scheduledAt) }
  catch (error) { errors.push(error) }
  const sourceIds = await listDueSourceIds(
    environment, scheduledAt, limit, costPolicy.allowDiscovery, costPolicy.browserScope,
  )
  for (const sourceId of sourceIds) {
    try {
      const source = await loadSourceState(environment, sourceId)
      if (!source || !source.manifest.enabled || source.manifest.robots.mode === 'blocked') continue
      const reason = scheduledJobReason(source.manifest.sourceCategory)
      if (!permitsScheduledReason(costPolicy, reason)) continue
      if (source.manifest.fetch.renderMode === 'browser'
        && !permitsBrowserForSource(costPolicy, source.manifest.sourceCategory)) continue
      const jobId = await sha256Hex(`${reason}:${sourceId}:${scheduledAt}`)
      await enqueueClaimedJob(environment, { version: 1, jobId, sourceId, reason, scheduledAt })
    } catch (error) {
      errors.push(error)
      // Isolate a broken manifest/queue send and give later sources a turn next time.
      const retryAt = new Date(controller.scheduledTime + 15 * 60 * 1000).toISOString()
      try {
        const deferred = await environment.INGESTION_DB.prepare(`
          UPDATE ingestion_sources SET next_fetch_at = ?2, last_error_code = 'schedule_failed', updated_at = ?3
          WHERE source_id = ?1
        `).bind(sourceId, retryAt, scheduledAt).run()
        if (!deferred.success) throw new Error('Could not defer failed source schedule')
      } catch (persistError) { errors.push(persistError) }
    }
  }
  // Heartbeat reports a partial failure, after all unaffected sources were scheduled.
  if (errors.length) throw new AggregateError(errors, 'Some ingestion sources could not be scheduled')
}

async function handleQueue(
  batch: QueueMessageBatch<unknown>,
  environment: IngestionEnv,
): Promise<void> {
  if (!(await readBackgroundBudgetGate(environment.BUDGET_STATE_BUCKET)).allowed) {
    const errors: unknown[] = []
    for (const message of batch.messages) {
      try { await rememberBudgetHeldJob(environment, message.body) }
      catch (error) { errors.push(error) }
      finally { message.retry({ delaySeconds: BACKGROUND_BUDGET_RETRY_SECONDS }) }
    }
    if (errors.length) throw new AggregateError(errors, 'Some budget-held ingestion jobs could not be persisted')
    return
  }
  const maximumAttempts = boundedInteger(environment.MAX_QUEUE_ATTEMPTS, 4, 1, 10)
  for (const message of batch.messages) {
    const receivedAt = new Date()
    if (!isIngestionJob(message.body)) {
      const fallbackJob: IngestionJob = {
        version: 1,
        jobId: message.id,
        sourceId: 'invalid-message',
        reason: 'retry',
        scheduledAt: receivedAt.toISOString(),
      }
      const failure: IngestionFailure = {
        version: 1,
        failureId: await sha256Hex(`invalid:${message.id}`),
        job: fallbackJob,
        failedAt: receivedAt.toISOString(),
        attempt: message.attempts,
        code: 'invalid_queue_message',
        message: 'Queue message did not match IngestionJob version 1',
        retryable: false,
      }
      await environment.INGESTION_DLQ.send(failure)
      message.ack()
      continue
    }

    const job = message.body
    const attempt = (job.deliveryAttemptOffset ?? 0) + message.attempts
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('invalid_ingestion_delivery_attempt')
    const source = await loadSourceState(environment, job.sourceId)
    const lease = source
      ? await acquireDomainLease(
        environment,
        new URL(source.manifest.officialUrl).hostname,
        receivedAt,
      )
      : null
    if (source && !lease) {
      try {
        await environment.INGESTION_QUEUE.send({ ...job, deliveryAttemptOffset: attempt - 1 }, { delaySeconds: 5 })
        message.ack()
      } catch {
        message.retry({ delaySeconds: 5 })
      }
      continue
    }
    try {
      let claimed: boolean
      try { claimed = await markJobRunning(environment, job, attempt, receivedAt.toISOString()) }
      catch (error) { throw new IngestionError(error instanceof Error ? error.message : String(error), 'job_start_failed', true) }
      if (!claimed) {
        message.ack()
        continue
      }
      await processIngestionJob(environment, job, fetch, receivedAt)
      message.ack()
    } catch (error) {
      const ingestionError = asIngestionError(error)
      const shouldRetry = ingestionError.retryable && attempt < maximumAttempts
      const retryAt = shouldRetry ? undefined : new Date(receivedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString()
      try {
        await recordJobFailure(environment, {
          job,
          sourceId: job.sourceId,
          attempt,
          code: ingestionError.code,
          message: ingestionError.message,
          retrying: shouldRetry,
          now: receivedAt.toISOString(),
          nextFetchAt: retryAt,
        })
      } catch {
        if (attempt < maximumAttempts) {
          message.retry({ delaySeconds: retryDelaySeconds(attempt) })
          continue
        }
      }

      if (shouldRetry) {
        message.retry({
          delaySeconds: retryDelaySeconds(
            attempt,
            ingestionError.retryAfterSeconds,
          ),
        })
        continue
      }

      const failure: IngestionFailure = {
        version: 1,
        failureId: await sha256Hex(`${job.jobId}:${attempt}:${ingestionError.code}`),
        job,
        failedAt: receivedAt.toISOString(),
        attempt,
        code: ingestionError.code,
        message: ingestionError.message.slice(0, 1_000),
        retryable: ingestionError.retryable,
      }
      await environment.INGESTION_DLQ.send(failure)
      message.ack()
    } finally {
      if (lease) {
        await releaseDomainLease(environment, lease, new Date()).catch(() => undefined)
      }
    }
  }
}

async function handleFetch(request: Request, environment: IngestionEnv): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({
      ok: true,
      service: 'studyinchina-ingestion',
      version: INGESTION_SERVICE_VERSION,
    })
  }

  if (request.method === 'GET' && url.pathname === '/operations') return handleOperations(request, environment)

  if (request.method === 'POST' && url.pathname === '/enqueue') {
    const configuredToken = environment.INGESTION_ADMIN_TOKEN
    const authorization = request.headers.get('authorization') ?? ''
    const suppliedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : ''
    if (!configuredToken || !constantTimeEqual(suppliedToken, configuredToken)) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
    }
    const sourceId = body && typeof body === 'object'
      ? (body as Record<string, unknown>).sourceId
      : undefined
    if (typeof sourceId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(sourceId)) {
      return jsonResponse({ ok: false, error: 'invalid_source_id' }, 400)
    }
    const budget = await readBackgroundBudgetGate(environment.BUDGET_STATE_BUCKET)
    if (!budget.allowed) {
      const response = jsonResponse({ ok: false, error: 'background_budget_blocked', budget }, 503)
      response.headers.set('Retry-After', String(BACKGROUND_BUDGET_RETRY_SECONDS))
      return response
    }
    const source = await loadSourceState(environment, sourceId)
    if (!source) {
      return jsonResponse({ ok: false, error: 'source_not_found' }, 404)
    }
    const costPolicy = infrastructureCostPolicy(environment.INFRA_FORECAST_CNY)
    if (
      source.manifest.fetch.renderMode === 'browser'
      && !permitsBrowserForSource(costPolicy, source.manifest.sourceCategory)
    ) {
      return jsonResponse({ ok: false, error: 'browser_deferred_by_cost' }, 409)
    }

    const scheduledAt = new Date().toISOString()
    const job: IngestionJob = {
      version: 1,
      jobId: await sha256Hex(`manual:${sourceId}:${crypto.randomUUID()}`),
      sourceId,
      reason: 'manual',
      scheduledAt,
    }
    try {
      const enqueued = await enqueueClaimedJob(environment, job)
      if (!enqueued) {
        return jsonResponse({ ok: false, error: 'source_already_queued' }, 409)
      }
    } catch {
      return jsonResponse({ ok: false, error: 'queue_unavailable' }, 503)
    }
    return jsonResponse({ ok: true, jobId: job.jobId }, 202)
  }

  return jsonResponse({ ok: false, error: 'not_found' }, 404)
}

const worker = {
  fetch: handleFetch,
  queue: handleQueue,
  async scheduled(
    controller: ScheduledControllerLike,
    environment: IngestionEnv,
  ): Promise<void> {
    if (!(await readBackgroundBudgetGate(environment.BUDGET_STATE_BUCKET)).allowed) return
    if ((await ensureReadBudgetIndexes(environment)).state === 'quota_wait') return
    await withAutomationHeartbeat(environment.INGESTION_DB, 'ingestion',
      () => scheduleDueSources(controller, environment))
  },
}

export { handleFetch, handleQueue, scheduleDueSources }
export default worker
