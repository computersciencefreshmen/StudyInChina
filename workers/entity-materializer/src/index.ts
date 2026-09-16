import { withAutomationHeartbeat } from '../../shared/automation-heartbeat'
import { processEntityMaterializationBatch } from '../../ingestion/src/entity-materializer-scheduler'
import type {
  D1Database,
  ScheduledControllerLike,
} from '../../ingestion/src/types'

const SERVICE_VERSION = '1.0.0'
export const DAILY_RELEASE_CRON = '17 19 * * *'
export const MATERIALIZATION_CRON = '*/15 * * * *'

export interface EntityMaterializerEnv {
  PIPELINE_DB: D1Database
  MATERIALIZATION_BATCH_LIMIT?: string
  RELEASE_CANDIDATE_LIMIT?: string
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : fallback
}

export function shouldRequestDailyRelease(cron: string): boolean {
  // The DB's unique daily release window makes catch-up calls idempotent.
  // Missing one dedicated cron must not delay verified updates another day.
  return [DAILY_RELEASE_CRON, MATERIALIZATION_CRON, '47 * * * *'].includes(cron.trim())
}

async function materializeScheduledBatch(
  controller: ScheduledControllerLike,
  environment: EntityMaterializerEnv,
): Promise<void> {
  const result = await processEntityMaterializationBatch(environment.PIPELINE_DB, {
    candidateLimit: boundedInteger(
      environment.MATERIALIZATION_BATCH_LIMIT,
      20,
      100,
    ),
    releaseCandidateLimit: boundedInteger(
      environment.RELEASE_CANDIDATE_LIMIT,
      500,
      1_000,
    ),
    now: new Date(controller.scheduledTime).toISOString(),
    requestRelease: shouldRequestDailyRelease(controller.cron),
  })
  if (result.failures.length) {
    const error = new Error(`${result.failures.length} entity materialization attempts are awaiting retry`)
    Object.assign(error, { code: 'entity_materialization_partial_failure' })
    throw error
  }
}

export async function scheduleEntityMaterialization(controller: ScheduledControllerLike, environment: EntityMaterializerEnv): Promise<void> {
  await withAutomationHeartbeat(environment.PIPELINE_DB, 'entity-materializer', () => materializeScheduledBatch(controller, environment))
}

export function handleFetch(request: Request): Response {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json(
      {
        ok: true,
        service: 'studyinchina-entity-materializer',
        version: SERVICE_VERSION,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    )
  }
  return Response.json(
    { ok: false, error: 'not_found' },
    {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

const worker = {
  fetch: handleFetch,
  scheduled: scheduleEntityMaterialization,
}

export default worker
