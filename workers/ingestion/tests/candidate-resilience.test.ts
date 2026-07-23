import assert from 'node:assert/strict'
import test from 'node:test'
import { IngestionError } from '../src/errors'
import { buildCandidate } from '../src/pipeline'
import type { IngestionEnv } from '../src/types'
import { sourceManifest } from './fixtures'

test('MiniMax quota failure produces no candidate and remains retryable', async () => {
  const environment = {
    MINIMAX_API_URL: 'https://api.minimax.io/v1/chat/completions',
    MINIMAX_API_KEY: 'test-only',
    MINIMAX_MODEL: 'MiniMax-M2.7',
  } as IngestionEnv
  const fetcher = async () => new Response('quota exhausted', {
    status: 429,
    headers: { 'Retry-After': '120' },
  })

  await assert.rejects(
    buildCandidate(
      environment,
      sourceManifest(),
      'snapshot-1',
      'https://admissions.example.edu.cn/programs/computer-science',
      'Deadline: 2026-09-01 Tuition: 30000 CNY',
      'text/html',
      fetcher,
      '2026-07-20T00:00:00.000Z',
    ),
    (error: unknown) => error instanceof IngestionError
      && error.code === 'minimax_http_429'
      && error.retryable,
  )
})
