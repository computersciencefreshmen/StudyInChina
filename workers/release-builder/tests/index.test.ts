import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleFetch,
  handleQueue,
  isReleaseQueueJob,
  scheduleReleaseJobs,
} from '../src/index'
import type { ReleaseBuilderEnv } from '../src/types'

const validJob = {
  version: 1 as const,
  outboxEventId: 'outbox-release-1',
  publicationJobId: 'publication-job-1',
  catalogReleaseId: 'catalog-release-1',
  requestedAt: '2026-07-23T08:00:00.000Z',
}

function environmentWithRows(
  rows: Array<{
    outbox_event_id: string
    publication_job_id: string
    catalog_release_id: string
    created_at: string
  }> = [],
) {
  const sent: unknown[] = []
  const deadLetters: unknown[] = []
  const statement = {
    bind() { return this },
    first: async () => null,
    all: async () => ({ success: true, results: rows }),
    run: async () => ({ success: true, meta: { changes: 1 } }),
  }
  const environment = {
    PIPELINE_DB: {
      prepare: () => statement,
      batch: async () => [],
    },
    CATALOG_DB: {
      prepare: () => statement,
      batch: async () => [],
    },
    RELEASE_ARTIFACTS: {
      get: async () => null,
      head: async () => null,
      put: async () => undefined,
    },
    RELEASE_QUEUE: {
      send: async (body: unknown) => { sent.push(body) },
    },
    RELEASE_BUILDER_DLQ: {
      send: async (body: unknown) => { deadLetters.push(body) },
    },
  } as unknown as ReleaseBuilderEnv
  return { environment, sent, deadLetters }
}

test('release queue jobs require exact versioned identities and an ISO timestamp', () => {
  assert.equal(isReleaseQueueJob(validJob), true)
  assert.equal(isReleaseQueueJob({ ...validJob, version: 2 }), false)
  assert.equal(isReleaseQueueJob({ ...validJob, outboxEventId: '../escape' }), false)
  assert.equal(isReleaseQueueJob({ ...validJob, requestedAt: 'not-a-date' }), false)
})

test('scheduler emits compact jobs from relational outbox identities', async () => {
  const { environment, sent } = environmentWithRows([
    {
      outbox_event_id: validJob.outboxEventId,
      publication_job_id: validJob.publicationJobId,
      catalog_release_id: validJob.catalogReleaseId,
      created_at: validJob.requestedAt,
    },
  ])
  await scheduleReleaseJobs(
    { scheduledTime: Date.parse(validJob.requestedAt), cron: '47 * * * *' },
    environment,
  )
  assert.deepEqual(sent, [validJob])
})

test('invalid queue messages fail closed into the DLQ', async () => {
  const { environment, deadLetters } = environmentWithRows()
  let acknowledged = false
  let retried = false
  await handleQueue(
    {
      messages: [{
        id: 'message-1',
        body: { version: 99 },
        attempts: 1,
        ack: () => { acknowledged = true },
        retry: () => { retried = true },
      }],
    },
    environment,
  )
  assert.equal(acknowledged, true)
  assert.equal(retried, false)
  assert.equal(deadLetters.length, 1)
  assert.equal((deadLetters[0] as { code: string }).code, 'invalid_release_job')
})

test('health endpoint exposes only service identity', async () => {
  const response = handleFetch(new Request('https://worker.example/health'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'studyinchina-release-builder',
    version: '1.0.0',
  })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
