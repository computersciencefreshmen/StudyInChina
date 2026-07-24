import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractionTextObjectKey,
  normalizeCanonicalText,
  sha256Hex,
  snapshotObjectKey,
  stableJson,
} from '../src/hash'
import { nextFetchAt, parseRetryAfter, retryDelaySeconds } from '../src/retry'

test('SHA-256 and snapshot keys are deterministic and content addressed', async () => {
  const digest = await sha256Hex('abc')
  assert.equal(
    digest,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(
    snapshotObjectKey('Example Program', digest, 'text/html; charset=utf-8'),
    `snapshots/ba/example-program/${digest}.html`,
  )
  assert.equal(
    extractionTextObjectKey('Example Program', digest),
    `derived/ba/example-program/${digest}.extraction.txt`,
  )
})

test('canonical normalization removes configured noise without changing stable facts', () => {
  const first = normalizeCanonicalText(
    '<meta csrf-token="one">\r\n Deadline: 2026-09-01',
    { ignorePatterns: ['csrf-token="[^"]+"'] },
  )
  const second = normalizeCanonicalText(
    '<meta csrf-token="two">\n  Deadline: 2026-09-01',
    { ignorePatterns: ['csrf-token="[^"]+"'] },
  )
  assert.equal(first, second)
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}')
})

test('retry policy respects Retry-After and caps delays at 24 hours', () => {
  assert.equal(retryDelaySeconds(1), 900)
  assert.equal(retryDelaySeconds(4), 86_400)
  assert.equal(retryDelaySeconds(1, 200_000), 86_400)
  assert.equal(parseRetryAfter('120'), 120)
  assert.equal(
    parseRetryAfter('Mon, 20 Jul 2026 01:00:00 GMT', new Date('2026-07-20T00:00:00Z')),
    3_600,
  )
})

test('next fetch jitter is deterministic for a source and time bucket', () => {
  const manifest = { id: 'source-one', schedule: { intervalHours: 24, jitterMinutes: 30 } }
  const from = new Date('2026-07-20T00:00:00Z')
  assert.equal(nextFetchAt(manifest, from), nextFetchAt(manifest, from))
  assert.ok(new Date(nextFetchAt(manifest, from)).getTime() >= from.getTime() + 24 * 60 * 60 * 1_000)
})
