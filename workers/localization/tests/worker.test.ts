import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import type { LocalizationEnv } from '../src/types'

const environment = {
  TRANSLATION_ENABLED: 'true',
  LOCALIZATION_ADMIN_TOKEN: 'test-admin-token',
} as LocalizationEnv

test('health is public but batch operations require a bearer token', async () => {
  const health = await handleFetch(new Request('https://worker.example/health'), environment)
  assert.equal(health.status, 200)
  assert.deepEqual((await health.json() as { defaultTargets: string[] }).defaultTargets, [
    'zh',
    'en',
    'ru',
  ])

  const forbidden = await handleFetch(new Request('https://worker.example/v1/batches', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  }), environment)
  assert.equal(forbidden.status, 403)
})

