import assert from 'node:assert/strict'
import test from 'node:test'
import { seed, setControls } from '../src/repository'
import type { ModelRequest } from '../src/types'
import { digest, gateRequest } from '../src/util'
import { makeEnv, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

async function enabled(f: ReturnType<typeof makeEnv>) {
  const input = seedInput()
  input.schools[0].sourceSeeds.push({ ...input.schools[0].sourceSeeds[0], id: 'second-official', url: 'https://test.edu.cn/second' })
  await seed(f.env, input)
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
}
async function request(second = false): Promise<ModelRequest> {
  return { reservationKey: await digest(second ? 'second-request' : 'first-request'), sourceId: await digest(second ? 'https://test.edu.cn/second' : 'https://test.edu.cn/catalog'),
    universityIds: ['uni-000'], snapshotSha256: (second ? 'e' : 'd').repeat(64), pass: 'primary', payload: second ? 'disjoint official source' : 'first official source', lane: 'expansion', recordIds: [] }
}

test('fully received truncated output is consumed once with exact immutable bytes and does not block a disjoint request', async () => {
  let calls = 0
  const truncated = JSON.stringify({ content: [{ type: 'text', text: '{"programs":[' }], usage: { input_tokens: 10, output_tokens: 8192 }, stop_reason: 'max_tokens' })
  const f = makeEnv(async url => {
    if (String(url).includes('token_plan')) return quotaResponse()
    calls++
    return calls === 1 ? new Response(truncated, { status: 200 }) : Response.json({ content: [{ type: 'text', text: '{"programs":[]}' }], stop_reason: 'end_turn' })
  })
  try {
    await enabled(f)
    const first = await request(), response = await gateRequest(f.env, '/model/run', first), result = await response.json()
    assert.equal(response.status, 409)
    assert.equal(result.error, 'model_output_truncated')
    const attempt = f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts WHERE reservation_key=?').get(first.reservationKey)!
    assert.equal(attempt.status, 'known_failed')
    assert.equal(attempt.error_code, 'model_output_truncated')
    assert.equal(attempt.output_key, null)
    assert.equal(attempt.output_sha256, null)
    const usage = JSON.parse(String(attempt.usage_json))
    assert.equal(usage.output_tokens, 8192)
    assert.deepEqual(usage.providerResponse, result.providerResponse)
    const object = f.bucket.objects.get(usage.providerResponse.artifactKey)!
    assert.equal(await digest(object), usage.providerResponse.artifactSha256)
    const receipt = JSON.parse(new TextDecoder().decode(object))
    assert.equal(receipt.format, 'studyinchina.provider-response')
    assert.equal(receipt.attemptId, attempt.attempt_id)
    assert.equal(receipt.requestSha256, await digest(first.payload))
    assert.equal(receipt.sourceId, first.sourceId)
    assert.equal(receipt.snapshotSha256, first.snapshotSha256)
    assert.equal(receipt.bodySha256, await digest(truncated))
    assert.equal(Buffer.from(receipt.bodyBase64, 'base64').toString('utf8'), truncated)
    assert.equal(receipt.bodyByteLength, Buffer.byteLength(truncated))
    assert.equal(receipt.httpStatus, 200)
    const reservation = f.storage.values.get(`request:${first.reservationKey}`) as { state: string; retryable: boolean }
    assert.equal(reservation.state, 'known_failed')
    assert.equal(reservation.retryable, false)
    assert.equal((await gateRequest(f.env, '/model/run', first)).status, 409)
    assert.equal(calls, 1)
    assert.equal((await gateRequest(f.env, '/model/run', await request(true))).status, 200)
    assert.equal(calls, 2)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_model_attempts WHERE status='unknown'").get()!.n, 0)
    assert.deepEqual(f.bucket.objects.get(usage.providerResponse.artifactKey), object)
  } finally { f.db.sqlite.close() }
})

test('complete saved HTTP200 invalid provider JSON or model JSON becomes nonretryable output-invalid', async () => {
  for (const body of ['not a JSON response', JSON.stringify({ content: [{ type: 'text', text: '{"programs":[' }], stop_reason: 'end_turn' }), JSON.stringify({ content: [], stop_reason: 'end_turn' })]) {
    let calls = 0
    const f = makeEnv(async url => { if (String(url).includes('token_plan')) return quotaResponse(); calls++; return new Response(body, { status: 200 }) })
    try {
      await enabled(f)
      const input = await request(), response = await gateRequest(f.env, '/model/run', input), failure = await response.json()
      assert.equal(failure.error, 'model_output_invalid')
      assert.equal(response.status, 409)
      assert.equal((f.storage.values.get(`request:${input.reservationKey}`) as { retryable: boolean }).retryable, false)
      const attempt = f.db.sqlite.prepare('SELECT status,error_code,usage_json FROM maintenance_model_attempts').get()!
      assert.equal(attempt.status, 'known_failed')
      assert.equal(attempt.error_code, 'model_output_invalid')
      const ref = JSON.parse(String(attempt.usage_json)).providerResponse
      const receipt = JSON.parse(new TextDecoder().decode(f.bucket.objects.get(ref.artifactKey)))
      assert.equal(Buffer.from(receipt.bodyBase64, 'base64').toString('utf8'), body)
      await gateRequest(f.env, '/model/run', input)
      assert.equal(calls, 1)
    } finally { f.db.sqlite.close() }
  }
})

test('network or body read ambiguity remains unknown and cannot be retried', async () => {
  for (const kind of ['network', 'body', 'oversized'] as const) {
    let calls = 0
    const f = makeEnv(async url => {
      if (String(url).includes('token_plan')) return quotaResponse()
      calls++
      if (kind === 'network') throw new Error('lost response')
      if (kind === 'oversized') return new Response('body', { status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); controller.error(new Error('response stream interrupted')) } }), { status: 200 })
    })
    try {
      await enabled(f)
      const input = await request(), response = await gateRequest(f.env, '/model/run', input)
      assert.equal((await response.json()).error, 'model_outcome_unknown')
      assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()!.status, 'unknown')
      await gateRequest(f.env, '/model/run', input)
      assert.equal(calls, 1)
      assert.equal([...f.bucket.objects.keys()].filter(key => key.startsWith('maintenance/models/')).length, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('an unconfirmed provider receipt or later result write stays unknown even after a full HTTP response', async () => {
  for (const failAt of [1, 2]) {
    let calls = 0, puts = 0
    const f = makeEnv(async url => { if (String(url).includes('token_plan')) return quotaResponse(); calls++; return Response.json({ content: [{ type: 'text', text: '{"programs":[]}' }], stop_reason: 'end_turn' }) })
    try {
      await enabled(f)
      const put = f.bucket.put.bind(f.bucket)
      f.bucket.put = async (key, value, options) => { if (key.startsWith('maintenance/models/') && ++puts === failAt) throw new Error('ambiguous artifact persistence'); return put(key, value, options) }
      const input = await request(), response = await gateRequest(f.env, '/model/run', input)
      assert.equal((await response.json()).error, 'model_outcome_unknown')
      assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get()!.status, 'unknown')
      await gateRequest(f.env, '/model/run', input)
      assert.equal(calls, 1)
      assert.equal([...f.bucket.objects.keys()].filter(key => key.startsWith('maintenance/models/')).length, failAt - 1)
    } finally { f.db.sqlite.close() }
  }
})
