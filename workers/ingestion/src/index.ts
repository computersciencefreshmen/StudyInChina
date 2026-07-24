import { asIngestionError } from './errors'
import {
  infrastructureCostPolicy,
  permitsBrowserForSource,
  permitsScheduledReason,
  scheduledJobReason,
} from './cost-policy'
import { sha256Hex } from './hash'
import { processIngestionJob } from './pipeline'
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

function isIngestionJob(value: unknown): value is IngestionJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Record<string, unknown>
  return (
    job.version === 1 &&
    typeof job.jobId === 'string' &&
    job.jobId.length > 0 &&
    typeof job.sourceId === 'string' &&
    /^[a-z0-9][a-z0-9_-]{0,127}$/.test(job.sourceId) &&
    (job.reason === 'scheduled' ||
      job.reason === 'discovery' ||
      job.reason === 'manual' ||
      job.reason === 'retry') &&
    typeof job.scheduledAt === 'string' &&
    !Number.isNaN(new Date(job.scheduledAt).getTime())
  )
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
  const sourceIds = await listDueSourceIds(
    environment,
    scheduledAt,
    limit,
    costPolicy.allowDiscovery,
  )
  for (const sourceId of sourceIds) {
    const source = await loadSourceState(environment, sourceId)
    if (!source) continue
    const reason = scheduledJobReason(source.manifest.sourceCategory)
    if (!permitsScheduledReason(costPolicy, reason)) continue
    if (
      source.manifest.fetch.renderMode === 'browser'
      && !permitsBrowserForSource(costPolicy, source.manifest.sourceCategory)
    ) continue
    const jobId = await sha256Hex(`${reason}:${sourceId}:${scheduledAt}`)
    const job: IngestionJob = {
      version: 1,
      jobId,
      sourceId,
      reason,
      scheduledAt,
    }
    await enqueueClaimedJob(environment, job)
  }
}

async function handleQueue(
  batch: QueueMessageBatch<unknown>,
  environment: IngestionEnv,
): Promise<void> {
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
        await environment.INGESTION_QUEUE.send(job, { delaySeconds: 5 })
        message.ack()
      } catch {
        message.retry({ delaySeconds: 5 })
      }
      continue
    }
    try {
      await markJobRunning(environment, job, message.attempts, receivedAt.toISOString())
      await processIngestionJob(environment, job, fetch, receivedAt)
      message.ack()
    } catch (error) {
      const ingestionError = asIngestionError(error)
      const shouldRetry = ingestionError.retryable && message.attempts < maximumAttempts
      const retryAt = shouldRetry ? undefined : new Date(receivedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString()
      try {
        await recordJobFailure(environment, {
          job,
          sourceId: job.sourceId,
          attempt: message.attempts,
          code: ingestionError.code,
          message: ingestionError.message,
          retrying: shouldRetry,
          now: receivedAt.toISOString(),
          nextFetchAt: retryAt,
        })
      } catch {
        if (message.attempts < maximumAttempts) {
          message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
          continue
        }
      }

      if (shouldRetry) {
        message.retry({
          delaySeconds: retryDelaySeconds(
            message.attempts,
            ingestionError.retryAfterSeconds,
          ),
        })
        continue
      }

      const failure: IngestionFailure = {
        version: 1,
        failureId: await sha256Hex(`${job.jobId}:${message.attempts}:${ingestionError.code}`),
        job,
        failedAt: receivedAt.toISOString(),
        attempt: message.attempts,
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
    await scheduleDueSources(controller, environment)
  },
}

export { handleFetch, handleQueue, scheduleDueSources }
export default worker
