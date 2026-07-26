import { configuredTargetLocales, translationLimits } from './config'
import { asLocalizationError, LocalizationError } from './errors'
import { planTranslationBatch, processTranslationQueueBatch } from './pipeline'
import { D1LocalizationRepository } from './repository'
import { parseBatchRequest } from './schema'
import {
  LOCALIZATION_SERVICE_VERSION,
  type LocalizationEnv,
  type QueueMessageBatch,
  type ScheduledControllerLike,
} from './types'

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function authorized(request: Request, environment: LocalizationEnv): boolean {
  const expected = environment.LOCALIZATION_ADMIN_TOKEN
  const authorization = request.headers.get('authorization') ?? ''
  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  return Boolean(expected) && constantTimeEqual(supplied, expected ?? '')
}

export async function handleFetch(
  request: Request,
  environment: LocalizationEnv,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/health') {
    const limits = translationLimits(environment)
    return response({
      ok: true,
      service: 'studyinchina-localization',
      version: LOCALIZATION_SERVICE_VERSION,
      enabled: limits.enabled,
      defaultTargets: configuredTargetLocales(environment),
    })
  }
  if (!authorized(request, environment)) {
    return response({ ok: false, error: 'forbidden' }, 403)
  }

  if (request.method === 'POST' && url.pathname === '/v1/batches') {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return response({ ok: false, error: 'invalid_json' }, 400)
    }
    try {
      const requestBody = parseBatchRequest(body)
      const result = await planTranslationBatch(environment, requestBody, 'api')
      return response({ ok: true, ...result }, requestBody.dryRun ? 200 : 202)
    } catch (error) {
      const normalized = asLocalizationError(error)
      const status = normalized.retryable ? 503 : 400
      return response({ ok: false, error: normalized.code }, status)
    }
  }

  const batchMatch = /^\/v1\/batches\/([a-f0-9]{64})$/.exec(url.pathname)
  if (request.method === 'GET' && batchMatch) {
    const summary = await new D1LocalizationRepository(environment.PIPELINE_DB)
      .batchSummary(batchMatch[1] as string)
    return summary
      ? response({ ok: true, batch: summary })
      : response({ ok: false, error: 'batch_not_found' }, 404)
  }
  return response({ ok: false, error: 'not_found' }, 404)
}

export async function handleQueue(
  batch: QueueMessageBatch<unknown>,
  environment: LocalizationEnv,
): Promise<void> {
  const maxAttempts = translationLimits(environment).maxAttempts
  for (const message of batch.messages) {
    try {
      await processTranslationQueueBatch(environment, message.body)
      message.ack()
    } catch (error) {
      const normalized = asLocalizationError(error)
      if (normalized.retryable && message.attempts < maxAttempts) {
        message.retry({
          delaySeconds: normalized.retryAfterSeconds
            ?? Math.min(3_600, 30 * (2 ** Math.max(0, message.attempts - 1))),
        })
      } else {
        message.ack()
      }
    }
  }
}

export async function handleScheduled(
  controller: ScheduledControllerLike,
  environment: LocalizationEnv,
): Promise<void> {
  const limits = translationLimits(environment)
  if (!limits.enabled) {
    controller.noRetry?.()
    return
  }
  await planTranslationBatch(environment, parseBatchRequest({
    targetLocales: configuredTargetLocales(environment),
    recordKinds: ['program', 'scholarship'],
    institutionIds: [],
    limit: limits.scheduleItems,
    dryRun: false,
  }), 'schedule', new Date(controller.scheduledTime))
}

const worker = {
  fetch: handleFetch,
  queue: handleQueue,
  scheduled: handleScheduled,
}

export default worker
export { LocalizationError }

