import { isolateCandidate, promoteCandidate } from './promoter'
import type {
  PromotionFailure,
  PromotionJob,
  PublisherEnv,
  QueueMessageBatch,
  ScheduledControllerLike,
} from './types'

const SERVICE_VERSION = '1.0.0'
const CANDIDATE_ID = /^[a-z0-9][a-z0-9_-]{0,159}$/

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

function isPromotionJob(value: unknown): value is PromotionJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Record<string, unknown>
  return job.version === 1
    && typeof job.candidateId === 'string'
    && CANDIDATE_ID.test(job.candidateId)
    && typeof job.requestedAt === 'string'
    && !Number.isNaN(new Date(job.requestedAt).getTime())
}

async function scheduleValidatedCandidates(
  controller: ScheduledControllerLike,
  environment: PublisherEnv,
): Promise<void> {
  const requestedAt = new Date(controller.scheduledTime).toISOString()
  const limit = boundedInteger(environment.SCHEDULE_BATCH_LIMIT, 20, 1, 100)
  const result = await environment.PIPELINE_DB.prepare(
    `SELECT candidate.candidate_id
       FROM ingestion_candidates candidate
       LEFT JOIN candidate_promotions promotion
         ON promotion.candidate_id = candidate.candidate_id
      WHERE candidate.candidate_status = 'validated'
        AND candidate.gate_status IN ('rule-pass', 'dual-pass')
        AND (
          promotion.candidate_id IS NULL
          OR (
            promotion.promotion_status = 'applying'
            AND promotion.lease_expires_at <= ?1
          )
        )
      ORDER BY candidate.created_at, candidate.candidate_id
      LIMIT ?2`,
  ).bind(requestedAt, limit).all<{ candidate_id: string }>()
  if (!result.success) throw new Error(`publisher scheduler query failed: ${result.error ?? 'unknown'}`)
  for (const row of result.results ?? []) {
    await environment.PROMOTION_QUEUE.send({
      version: 1,
      candidateId: row.candidate_id,
      requestedAt,
    })
  }
}

async function handleQueue(
  batch: QueueMessageBatch<unknown>,
  environment: PublisherEnv,
): Promise<void> {
  const maximumAttempts = boundedInteger(environment.MAX_QUEUE_ATTEMPTS, 4, 1, 10)
  for (const message of batch.messages) {
    if (!isPromotionJob(message.body)) {
      const failure: PromotionFailure = {
        version: 1,
        job: {
          version: 1,
          candidateId: 'invalid-message',
          requestedAt: new Date().toISOString(),
        },
        failedAt: new Date().toISOString(),
        attempt: message.attempts,
        code: 'invalid_promotion_job',
        message: 'Queue message did not match PromotionJob version 1',
      }
      await environment.PUBLISHER_DLQ.send(failure)
      message.ack()
      continue
    }

    const job = message.body
    try {
      const result = await promoteCandidate(environment.PIPELINE_DB, job.candidateId)
      if (result.status === 'busy') {
        message.retry({ delaySeconds: 60 })
      } else {
        message.ack()
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      if (message.attempts < maximumAttempts) {
        message.retry({ delaySeconds: Math.min(3_600, 60 * 2 ** (message.attempts - 1)) })
        continue
      }
      try {
        await isolateCandidate(
          environment.PIPELINE_DB,
          job.candidateId,
          'publisher_runtime_failure',
          [messageText],
          new Date(),
        )
      } catch {
        // The scheduled poller will rediscover a still-validated candidate or
        // an expired applying lease after the infrastructure failure clears.
      }
      await environment.PUBLISHER_DLQ.send({
        version: 1,
        job,
        failedAt: new Date().toISOString(),
        attempt: message.attempts,
        code: 'publisher_runtime_failure',
        message: messageText.slice(0, 1_000),
      })
      message.ack()
    }
  }
}

function handleFetch(request: Request): Response {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json(
      { ok: true, service: 'studyinchina-publisher', version: SERVICE_VERSION },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    )
  }
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
}

const worker = {
  fetch: handleFetch,
  queue: handleQueue,
  scheduled: scheduleValidatedCandidates,
}

export { handleFetch, handleQueue, scheduleValidatedCandidates }
export default worker
