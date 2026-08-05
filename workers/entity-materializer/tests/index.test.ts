import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DAILY_RELEASE_CRON,
  handleFetch,
  shouldRequestDailyRelease,
} from '../src/index'

test('only the dedicated daily cron can request a release', () => {
  assert.equal(shouldRequestDailyRelease('47 * * * *'), false)
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
