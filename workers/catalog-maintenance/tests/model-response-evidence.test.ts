import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveModelResponse, MAX_PROVIDER_RESPONSE_BYTES } from '../src/model-response-evidence'
import { seed, setControls } from '../src/repository'
import { canonical, digest, gateRequest } from '../src/util'
import type { ModelRequest } from '../src/types'
import { makeEnv, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

const good = { content: [{ type: 'text', text: '{"programs":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 } }
async function setup(respond: () => Promise<Response> | Response) {
  let calls = 0
  const f = makeEnv(async input => { if (String(input).includes('token_plan')) return quotaResponse(); calls++; return respond() })
  await seed(f.env, seedInput())
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?').run('d'.repeat(64), 'e'.repeat(64))
  const input: ModelRequest = { reservationKey: await digest('response-test'), sourceId: await digest('https://test.edu.cn/catalog'), universityIds: ['uni-000'], snapshotSha256: 'd'.repeat(64), pass: 'primary', payload: 'explicit test payload', lane: 'expansion', recordIds: [] }
  return { ...f, input, calls: () => calls, run: () => gateRequest(f.env, '/model/run', input), row: () => f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts ORDER BY started_at DESC').get()! }
}
async function assertEvidence(f: Awaited<ReturnType<typeof setup>>, expected: Uint8Array) {
  const usage = JSON.parse(String(f.row().usage_json)), ref = usage.providerResponse
  assert.equal(ref.httpStatus, 200)
  const envelopeBytes = f.bucket.objects.get(ref.objectKey)!
  assert.equal(await digest(envelopeBytes), ref.sha256); assert.equal(envelopeBytes.length, ref.byteLength)
  const envelope = JSON.parse(new TextDecoder().decode(envelopeBytes))
  assert.equal(envelope.reservationKey, f.input.reservationKey); assert.equal(envelope.attemptId, f.row().attempt_id)
  assert.equal(envelope.requestSha256, await digest(f.input.payload)); assert.equal(envelope.requestedModel, 'MiniMax-M3')
  assert.equal(envelope.sourceId, f.input.sourceId); assert.equal(envelope.snapshotSha256, f.input.snapshotSha256); assert.equal(envelope.pass, f.input.pass)
  assert.equal(envelope.complete, true); assert.deepEqual(envelope.body, ref.body)
  assert.deepEqual(f.bucket.objects.get(ref.body.objectKey), expected)
  assert.equal(await digest(expected), ref.body.sha256); assert.equal(expected.length, ref.body.byteLength)
  assert.equal(JSON.stringify(envelope).includes(f.env.MINIMAX_SUBSCRIPTION_KEY!), false)
  assert.equal(JSON.stringify(envelope).includes(f.input.payload), false)
  return { usage, envelope, ref }
}

test('received invalid output has exact body/usage evidence and a permanent known-failure reservation', async t => {
  const cases = [
    { name: 'invalid model JSON', body: JSON.stringify({ ...good, content: [{ type: 'text', text: 'not JSON' }] }), code: 'model_output_invalid' },
    { name: 'token limit even with parseable content', body: JSON.stringify({ ...good, stop_reason: 'max_tokens' }), code: 'model_output_truncated' },
    { name: 'no text', body: JSON.stringify({ ...good, content: [] }), code: 'model_output_invalid' },
    { name: 'invalid envelope JSON', body: '{', code: 'model_response_invalid' },
    { name: 'non-object envelope', body: '[]', code: 'model_response_invalid' },
    { name: 'empty envelope', body: '', code: 'model_response_invalid' },
  ]
  for (const c of cases) await t.test(c.name, async () => {
    const bytes = new TextEncoder().encode(c.body), f = await setup(() => new Response(bytes))
    try {
      const response = await f.run(); assert.equal(response.status, 409); assert.equal((await response.json()).error, c.code)
      assert.equal(f.row().status, 'known_failed'); assert.equal(f.row().error_code, c.code); assert.equal(f.row().output_key, null)
      const { usage } = await assertEvidence(f, bytes)
      if (c.body.includes('input_tokens')) { assert.equal(usage.input_tokens, 11); assert.equal(usage.output_tokens, 7) }
      else assert.equal(usage.usage, null, 'missing usage must not become zero usage')
      assert.equal((f.storage.values.get(`request:${f.input.reservationKey}`) as { retryable: boolean }).retryable, false)
      assert.equal((await (await f.run()).json()).error, 'prior_model_outcome_requires_review'); assert.equal(f.calls(), 1)
    } finally { f.db.sqlite.close() }
  })
})

test('malformed UTF-8 is archived as bytes without lossy decoding into successful output', async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00]), f = await setup(() => new Response(bytes))
  try { assert.equal((await (await f.run()).json()).error, 'model_response_invalid'); await assertEvidence(f, bytes); assert.equal(f.row().status, 'known_failed') }
  finally { f.db.sqlite.close() }
})

test('valid responses keep output/cache and request wire semantics while linking raw evidence', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(good)), f = await setup(() => new Response(bytes))
  try {
    const response = await f.run(); assert.equal(response.status, 200)
    const result = await response.json(); assert.deepEqual(result.output, { programs: [] }); assert.equal(f.row().status, 'completed')
    const { ref } = await assertEvidence(f, bytes), artifact = JSON.parse(new TextDecoder().decode(f.bucket.objects.get(result.artifactKey)!))
    assert.deepEqual(artifact.usage, good.usage); assert.deepEqual(artifact.providerResponse, ref)
    assert.deepEqual((await (await f.run()).json()).output, result.output); assert.equal(f.calls(), 1)
  } finally { f.db.sqlite.close() }
})

test('transport, partial, oversized and redirected responses remain unknown and cannot resend', async t => {
  const cases: Array<[string, () => Response | Promise<Response>]> = [
    ['transport', () => { throw new Error('lost reply') }],
    ['stream failed after prefix', () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.error(new Error('connection reset')) } }))],
    ['length mismatch', () => new Response('{}', { headers: { 'content-length': '99' } })],
    ['oversized header', () => new Response('{}', { headers: { 'content-length': String(MAX_PROVIDER_RESPONSE_BYTES + 1) } })],
    ['oversized bytes', () => new Response(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES + 1))],
    ['redirect', () => new Response(null, { status: 307, headers: { location: 'https://never-follow.invalid' } })],
  ]
  for (const [name, respond] of cases) await t.test(name, async () => {
    const f = await setup(respond)
    try {
      assert.equal((await (await f.run()).json()).error, 'model_outcome_unknown'); assert.equal(f.row().status, 'unknown')
      assert.equal(f.row().usage_json, null); assert.equal([...f.bucket.objects.keys()].filter(key => key.startsWith('maintenance/provider-responses/')).length, 0)
      assert.equal((await (await f.run()).json()).error, 'prior_model_outcome_requires_review'); assert.equal(f.calls(), 1)
    } finally { f.db.sqlite.close() }
  })
})

test('archive put/readback failures fail closed without claiming received evidence was confirmed', async t => {
  for (const mode of ['body-put', 'envelope-put', 'readback', 'conflict'] as const) await t.test(mode, async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(good)), f = await setup(() => new Response(bytes))
    const put = f.bucket.put.bind(f.bucket), get = f.bucket.get.bind(f.bucket)
    if (mode === 'conflict') f.bucket.objects.set(`maintenance/provider-responses/${f.input.reservationKey}/${await digest(bytes)}.bin`, new Uint8Array([1]))
    f.bucket.put = async (key, value, options) => {
      if (mode === 'body-put' && key.endsWith('.bin') || mode === 'envelope-put' && key.includes('provider-responses/') && key.endsWith('.json')) throw new Error('R2 unavailable')
      return put(key, value, options)
    }
    if (mode === 'readback') f.bucket.get = async key => { const object = await get(key); return object && key.endsWith('.bin') ? { ...object, arrayBuffer: async () => new Uint8Array([7]).buffer } : object }
    try {
      assert.equal((await (await f.run()).json()).error, 'model_outcome_unknown'); assert.equal(f.row().status, 'unknown')
      assert.equal(f.row().error_code, 'model_response_evidence_unconfirmed'); assert.equal(f.row().usage_json, null)
      assert.equal((await (await f.run()).json()).error, 'prior_model_outcome_requires_review'); assert.equal(f.calls(), 1)
    } finally { f.db.sqlite.close() }
  })
})

test('confirmed body/usage survive a later output-artifact or SQL evidence-update failure', async t => {
  for (const mode of ['output-put', 'usage-update'] as const) await t.test(mode, async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(good)), f = await setup(() => new Response(bytes))
    const put = f.bucket.put.bind(f.bucket), prepare = f.db.prepare.bind(f.db)
    f.bucket.put = async (key, value, options) => { if (mode === 'output-put' && key.startsWith('maintenance/models/')) throw new Error('canonical output unavailable'); return put(key, value, options) }
    f.db.prepare = sql => { if (mode === 'usage-update' && sql.startsWith('UPDATE maintenance_model_attempts SET usage_json=')) throw new Error('D1 failed'); return prepare(sql) }
    try {
      assert.equal((await (await f.run()).json()).error, 'model_outcome_unknown'); assert.equal(f.row().status, 'unknown')
      await assertEvidence(f, bytes); assert.equal((await (await f.run()).json()).error, 'prior_model_outcome_requires_review'); assert.equal(f.calls(), 1)
    } finally { f.db.sqlite.close() }
  })
})

test('pre-existing unknown bytes in both ledgers remain unchanged without any new provider/evidence work', async () => {
  const f = await setup(() => Response.json(good))
  try {
    const unknown = { state: 'unknown', attemptId: 'historical-unknown', requestSha256: await digest(f.input.payload), retryable: false, attemptCount: 1 }
    f.storage.values.set(`request:${f.input.reservationKey}`, unknown)
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,usage_json,error_code,quota_json) VALUES(?,?,?,?,?,?,?,'unknown',?,?,?,'{}')")
      .run(f.input.reservationKey, unknown.attemptId, f.input.sourceId, f.input.snapshotSha256, f.input.pass, unknown.requestSha256, 'MiniMax-M3', '2026-11-14T07:45:55.446Z', null, 'model_outcome_unknown')
    const sqlBefore = JSON.stringify(f.row()), doBefore = canonical(unknown), bucketBefore = [...f.bucket.objects].map(([key, bytes]) => [key, Array.from(bytes)])
    assert.equal((await (await f.run()).json()).error, 'prior_model_outcome_requires_review')
    assert.equal(JSON.stringify(f.row()), sqlBefore); assert.equal(canonical(f.storage.values.get(`request:${f.input.reservationKey}`)), doBefore)
    assert.equal(f.calls(), 0); assert.deepEqual([...f.bucket.objects].map(([key, bytes]) => [key, Array.from(bytes)]), bucketBefore)
  } finally { f.db.sqlite.close() }
})

test('provider429 remains explicitly retryable after durable cooldown, with separate immutable response receipts', async () => {
  let time = Date.now(), sends = 0
  const realNow = Date.now; Date.now = () => time
  const f = await setup(() => ++sends === 1 ? new Response('busy', { status: 429, headers: { 'retry-after': '60' } }) : Response.json(good))
  try {
    assert.equal((await f.run()).status, 429); const first = f.row(), usage = JSON.parse(String(first.usage_json))
    assert.equal(first.status, 'known_failed'); assert.equal(usage.providerResponse.httpStatus, 429)
    assert.equal((f.storage.values.get(`request:${f.input.reservationKey}`) as { retryable: boolean }).retryable, true)
    assert.equal((await f.run()).status, 429); assert.equal(f.calls(), 1); time += 61000
    assert.equal((await f.run()).status, 200); assert.equal(f.calls(), 2)
    const attempts = f.db.sqlite.prepare('SELECT attempt_id,status,usage_json FROM maintenance_model_attempts').all()
    assert.equal(attempts.length, 2); assert.equal(new Set(attempts.map(row => JSON.parse(String(row.usage_json)).providerResponse.sha256)).size, 2)
  } finally { Date.now = realNow; f.db.sqlite.close() }
})

test('archive helper uses conditional immutable writes and a content-addressed raw-byte identity', async () => {
  const f = await setup(() => Response.json(good)), bytes = new TextEncoder().encode(JSON.stringify(good)), options: unknown[] = []
  const put = f.bucket.put.bind(f.bucket)
  f.bucket.put = async (key, value, option) => { options.push(option); return put(key, value, option) }
  try {
    const a = await archiveModelResponse(f.env, new Response(bytes), f.input, 'one-attempt', await digest(f.input.payload), 'MiniMax-M3', AbortSignal.timeout(1000))
    const b = await archiveModelResponse(f.env, new Response(bytes), f.input, 'one-attempt', await digest(f.input.payload), 'MiniMax-M3', AbortSignal.timeout(1000))
    assert.equal(a.reference.body.objectKey, b.reference.body.objectKey)
    assert.equal(a.reference.body.sha256, await digest(bytes)); assert.equal(options.every(option => (option as { onlyIf: { etagDoesNotMatch: string } }).onlyIf.etagDoesNotMatch === '*'), true)
  } finally { f.db.sqlite.close() }
})
