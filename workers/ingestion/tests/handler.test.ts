import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import type { IngestionEnv } from '../src/types'

test('health endpoint exposes no database or secret details', async () => {
  const response = await handleFetch(
    new Request('https://worker.example/health'),
    {} as IngestionEnv,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'studyinchina-ingestion',
    version: '1.0.0',
  })
})

test('manual enqueue fails closed when no admin token is configured', async () => {
  const response = await handleFetch(
    new Request('https://worker.example/enqueue', {
      method: 'POST',
      headers: { Authorization: 'Bearer guessed' },
      body: JSON.stringify({ sourceId: 'example-program-source' }),
    }),
    {} as IngestionEnv,
  )
  assert.equal(response.status, 403)
})
