import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DAILY_RELEASE_CRON,
  MATERIALIZATION_CRON,
  handleFetch,
  shouldRequestDailyRelease,
} from '../src/index'

test('regular cron catches up daily releases while DB uniqueness bounds publication', () => {
  assert.equal(shouldRequestDailyRelease('unrecognized'), false)
  assert.equal(shouldRequestDailyRelease(MATERIALIZATION_CRON), true)
  assert.equal(shouldRequestDailyRelease('47 * * * *'), true)
  assert.equal(shouldRequestDailyRelease(DAILY_RELEASE_CRON), true)
})

test('health response exposes no database details', async () => {
  const response = handleFetch(new Request('https://worker.example/health'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'studyinchina-entity-materializer',
    version: '1.0.0',
  })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('unknown routes are rejected', async () => {
  const response = handleFetch(new Request('https://worker.example/private'))
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { ok: false, error: 'not_found' })
})
