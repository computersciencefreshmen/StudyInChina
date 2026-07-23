import assert from 'node:assert/strict'
import test from 'node:test'
import { IngestionError } from '../src/errors'
import { readBoundedBody } from '../src/pipeline'

test('streaming body reader stops an unbounded response before buffering it all', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8))
      controller.enqueue(new Uint8Array(8))
      controller.enqueue(new Uint8Array(8))
    },
    cancel() {
      cancelled = true
    },
  })
  const response = new Response(body)

  await assert.rejects(
    readBoundedBody(response, 12),
    (error: unknown) => error instanceof IngestionError && error.code === 'response_too_large',
  )
  assert.equal(cancelled, true)
})

test('streaming body reader preserves a response inside the limit', async () => {
  const expected = new TextEncoder().encode('official source')
  const response = new Response(expected)
  const actual = new Uint8Array(await readBoundedBody(response, expected.byteLength))
  assert.deepEqual(actual, expected)
})

test('streaming body reader aborts a response that stalls after headers', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'))
    },
    pull() {
      return new Promise<void>(() => undefined)
    },
    cancel() {
      cancelled = true
    },
  })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 10)

  await assert.rejects(
    readBoundedBody(new Response(body), 1_024, controller.signal),
    (error: unknown) => error instanceof IngestionError && error.code === 'response_timeout',
  )
  assert.equal(cancelled, true)
})
