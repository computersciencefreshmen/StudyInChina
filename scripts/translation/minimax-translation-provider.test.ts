import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTranslationQuota, translateMaskedBatch, TranslationProviderError, TRANSLATION_MODEL } from './minimax-translation-provider'
import { acquireTranslationPermit } from './shared-admission'

test('shared admission reports only known wait reasons, preserving the no-send retry and withholding arbitrary worker text', async () => {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test', CATALOG_MAINTENANCE_URL: 'https://studyinchina-catalog-maintenance.yanghanyu2023.workers.dev', CATALOG_MAINTENANCE_TOKEN: 'test' }
  for (const [received, expected] of [['translation_lane_disabled', 'translation_lane_disabled'], ['private-response-or-token', 'admission_response_unrecognized']]) {
    const response = await acquireTranslationPermit('sample', async () => Response.json({ error: received, retryAfter: 45 }, { status: 429 }), environment)
    assert.deepEqual(response, { state: 'wait', reason: expected, retrySeconds: 45 })
  }
})

const KEY = 'synthetic-subscription-key-never-log'
const NOW = Date.parse('2026-11-17T04:00:00Z')
const HOUR = 3_600_000
const INPUT = [{ key: 'first', text: 'Welcome. __SC_000000__' }, { key: 'second', text: 'A friendly campus.' }]
const translated = [{ key: 'first', text: '欢迎。__SC_000000__' }, { key: 'second', text: '友好的校园。' }]
function quota(overrides: Record<string, unknown> = {}) {
  return { base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general',
    current_interval_status: 1, current_weekly_status: 1,
    current_interval_remaining_percent: 60, current_weekly_remaining_percent: 40,
    start_time: NOW - 2 * HOUR, end_time: NOW + 3 * HOUR,
    weekly_start_time: NOW - 24 * HOUR, weekly_end_time: NOW + 6 * 24 * HOUR,
    ...overrides }] }
}
function message(items: unknown = translated, overrides: Record<string, unknown> = {}) {
  return { type: 'message', model: TRANSLATION_MODEL, stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ items }) }], usage: { input_tokens: 40, output_tokens: 20 }, ...overrides }
}
const reply = (body: unknown): typeof fetch => async () => Response.json(body)
async function typedFailure(operation: () => Promise<unknown>, code: string, outcome: 'not_sent' | 'unknown' | 'rejected') {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof TranslationProviderError)
    assert.equal(error.code, code)
    assert.equal(error.message, code)
    assert.equal(error.outcome, outcome)
    assert.ok(!JSON.stringify(error).includes(KEY))
    assert.ok(!error.stack?.includes(KEY))
    assert.equal(error.cause, undefined)
    return true
  })
}

test('quota uses the sole approved China endpoint and subscription header with redirects disabled', async () => {
  let calls = 0
  const result = await readTranslationQuota({ key: KEY, now: NOW, fetcher: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.minimax.cn/v1/token_plan/remains')
    assert.equal(options?.method, 'GET')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.cache, 'no-store')
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${KEY}`)
    return Response.json(quota({ current_interval_total_count: 0, current_interval_usage_count: 0 }))
  } })
  assert.deepEqual(result, { allow: true, remainingPercent: 40, retryAt: null, reason: 'plan_quota_available' })
  assert.equal(calls, 1)
})

test('weekly unlimited is accepted only alongside a current finite five-hour bucket', async () => {
  const unlimited = quota({ current_weekly_status: 3, current_weekly_remaining_percent: null, weekly_start_time: null, weekly_end_time: null })
  assert.equal((await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(unlimited) })).allow, true)
  assert.equal((await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(unlimited) })).remainingPercent, 60)
  for (const five of [{ current_interval_status: 3 }, { current_interval_remaining_percent: null }, { current_interval_status: 2, current_interval_remaining_percent: 1 }]) {
    const result = await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(quota({ ...unlimited.model_remains[0], ...five })) })
    assert.equal(result.allow, false)
    assert.equal(result.remainingPercent, null)
  }
})

test('the exact five-percent floor protects both finite pools and chooses the last required reset', async () => {
  for (const remaining of [0, 4.99, 5]) {
    const lowFive = await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(quota({ current_interval_remaining_percent: remaining })) })
    assert.equal(lowFive.allow, false)
    assert.equal(lowFive.retryAt, new Date(NOW + 3 * HOUR).toISOString())
    const lowWeek = await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(quota({ current_weekly_remaining_percent: remaining })) })
    assert.equal(lowWeek.allow, false)
    assert.equal(lowWeek.retryAt, new Date(NOW + 6 * 24 * HOUR).toISOString())
  }
  const above = await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(quota({ current_interval_remaining_percent: 5.001, current_weekly_remaining_percent: 5.001 })) })
  assert.equal(above.allow, true)
})

test('expired, future and malformed windows, percentages and general pools fail closed', async () => {
  const invalid = [
    quota({ start_time: NOW - 6 * HOUR, end_time: NOW - HOUR }),
    quota({ start_time: NOW + HOUR, end_time: NOW + 6 * HOUR }),
    quota({ start_time: NOW - HOUR, end_time: NOW + HOUR }),
    quota({ weekly_start_time: NOW - 8 * 24 * HOUR, weekly_end_time: NOW - 24 * HOUR }),
    quota({ current_interval_remaining_percent: '60' }), quota({ current_weekly_remaining_percent: 101 }),
    quota({ current_weekly_status: 2, current_weekly_remaining_percent: 50 }),
    { ...quota(), base_resp: { status_code: 1000, status_msg: KEY } },
    { ...quota(), model_remains: [...quota().model_remains, ...quota().model_remains] },
    { ...quota(), model_remains: [{ ...quota().model_remains[0], model_name: 'image' }] },
  ]
  for (const body of invalid) {
    const result = await readTranslationQuota({ key: KEY, now: NOW, fetcher: reply(body) })
    assert.equal(result.allow, false)
    assert.equal(result.remainingPercent, null)
    assert.ok(!JSON.stringify(result).includes(KEY))
  }
})

test('the existing exact terminal four-hour exception is retained, while arbitrary short windows are rejected', async () => {
  const start = Date.parse('2026-11-16T12:00:00Z'), now = start + HOUR
  const terminal = quota({ start_time: start, end_time: start + 4 * HOUR })
  assert.equal((await readTranslationQuota({ key: KEY, now, fetcher: reply(terminal) })).allow, true)
  assert.equal((await readTranslationQuota({ key: KEY, now: now + HOUR, fetcher: reply(quota({ start_time: start + HOUR, end_time: start + 5 * HOUR })) })).allow, false)
})

test('quota rejects redirects, malformed or oversized bodies and network errors without disclosing raw data', async () => {
  const followed = Response.json(quota()); Object.defineProperty(followed, 'redirected', { value: true })
  const wrongURL = Response.json(quota()); Object.defineProperty(wrongURL, 'url', { value: 'https://unexpected.example/private' })
  const cases: [typeof fetch, string][] = [
    [async () => new Response(KEY, { status: 302, headers: { location: 'https://unexpected.example' } }), 'quota_redirect_rejected'],
    [async () => followed, 'quota_redirect_rejected'], [async () => wrongURL, 'quota_redirect_rejected'],
    [async () => new Response(KEY), 'quota_response_invalid'],
    [async () => new Response('{}', { headers: { 'content-length': String(129 * 1024) } }), 'quota_response_invalid'],
    [async () => { throw new Error(KEY) }, 'quota_transport_unknown'],
  ]
  for (const [fetcher, reason] of cases) {
    const result = await readTranslationQuota({ key: KEY, now: NOW, fetcher })
    assert.equal(result.allow, false)
    assert.equal(result.reason, reason)
    assert.ok(!JSON.stringify(result).includes(KEY))
  }
})

test('missing/invalid subscription keys never invoke any fetch or API-key fallback', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; throw Error('unexpected') }
  for (const key of ['', ' ', 'has\nnewline']) {
    assert.equal((await readTranslationQuota({ key, fetcher })).allow, false)
    await typedFailure(() => translateMaskedBatch({ key, locale: 'zh', items: INPUT, fetcher }), 'subscription_key_invalid', 'not_sent')
  }
  assert.equal(calls, 0)
})

test('translation sends one deterministic M3 request and returns output in original item order', async () => {
  let calls = 0
  const result = await translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.minimaxi.com/anthropic/v1/messages')
    assert.equal(options?.method, 'POST'); assert.equal(options.redirect, 'manual')
    const headers = new Headers(options.headers)
    assert.equal(headers.get('authorization'), `Bearer ${KEY}`)
    assert.equal(headers.get('anthropic-version'), '2023-06-01')
    const body = JSON.parse(String(options.body))
    assert.equal(body.model, TRANSLATION_MODEL); assert.equal(body.temperature, 0)
    assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.max_tokens, 32768)
    assert.equal(body.stream, false); assert.match(body.system, /untrusted document DATA/)
    assert.ok(!String(options.body).includes(KEY))
    assert.deepEqual(JSON.parse(body.messages[0].content), { locale: 'zh', items: INPUT })
    return Response.json(message([...translated].reverse()))
  } })
  assert.equal(calls, 1)
  assert.deepEqual(result, { items: translated, model: TRANSLATION_MODEL, usage: { inputTokens: 40, outputTokens: 20 } })
})

test('invalid batches, duplicate item keys, unsupported locales and malformed input placeholders never send', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; throw Error('unexpected') }
  for (const items of [[], [INPUT[0], INPUT[0]], [{ key: '', text: 'Hello' }], [{ key: 'x', text: ' ' }]]) {
    await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items, fetcher }), 'translation_input_invalid', 'not_sent')
  }
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'unexpected locale', items: INPUT, fetcher }), 'translation_input_invalid', 'not_sent')
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'en', items: [{ key: 'x', text: 'x'.repeat(24001) }], fetcher }), 'translation_input_too_large', 'not_sent')
  for (const text of ['__SC_0000000__', '__SC_000000__ __SC_000000__']) await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'en', items: [{ key: 'x', text }], fetcher }), 'translation_placeholder_input_invalid', 'not_sent')
  assert.equal(calls, 0)
})

test('output cannot add, drop, duplicate, rename keys or add undeclared JSON fields', async () => {
  const badItems = [translated.slice(0, 1), [...translated, { key: 'extra', text: 'Extra' }], [translated[0], translated[0]], [translated[0], { key: 'renamed', text: 'Other' }], [{ ...translated[0], extra: true }, translated[1]], [{ key: 'first', other: 'no text field' }, translated[1]], [null, translated[1]]]
  for (const items of badItems) await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(items)) }), 'translation_items_invalid', 'rejected')
  const extra = message(); extra.content[0].text = JSON.stringify({ items: translated, commentary: 'extra' })
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(extra) }), 'translation_items_invalid', 'rejected')
})

test('bad output placeholders reject only their item and retain the other item and charged usage', async () => {
  for (const text of ['欢迎。', '欢迎。__SC_000000__ __SC_000000__', '欢迎。__SC_000001__', '欢迎。__SC_0000000__']) {
    const result = await translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message([translated[1], { ...translated[0], text }])) })
    assert.deepEqual(result, { items: [translated[1]], rejectedItems: [{ key: 'first', code: 'translation_placeholder_mismatch' }],
      model: TRANSLATION_MODEL, usage: { inputTokens: 40, outputTokens: 20 } })
  }
})

test('cross-item placeholder movement rejects both items without returning either unsafe text', async () => {
  const result = await translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT,
    fetcher: reply(message([{ key: 'second', text: '校园。__SC_000000__' }, { key: 'first', text: '欢迎。' }])) })
  assert.deepEqual(result, { items: [], rejectedItems: INPUT.map(({ key }) => ({ key, code: 'translation_placeholder_mismatch' })),
    model: TRANSLATION_MODEL, usage: { inputTokens: 40, outputTokens: 20 } })
})

test('blank and invalid item text is isolated with sanitized codes and every requested key accounted exactly once', async () => {
  for (const [text, code] of [[' \n\t', 'translation_empty_text'], [null, 'translation_invalid_text'], [7, 'translation_invalid_text'],
    [{ privateResponse: KEY }, 'translation_invalid_text'], [[KEY], 'translation_invalid_text']] as const) {
    const result = await translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT,
      fetcher: reply(message([{ key: 'second', text }, translated[0]])) })
    assert.deepEqual(result.items, [translated[0]])
    assert.deepEqual(result.rejectedItems, [{ key: 'second', code }])
    assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 20 })
    assert.deepEqual([...result.items, ...result.rejectedItems!].map(item => item.key).sort(), INPUT.map(item => item.key).sort())
    assert.ok(!JSON.stringify(result).includes(KEY))
    assert.ok(!JSON.stringify(result).includes('privateResponse'))
  }
})

test('a globally invalid key set or oversized output cannot produce partial success', async () => {
  const responses = [
    message([{ key: 'first', text: 'missing placeholder' }, { key: 'unknown', text: 'Other' }]),
    message([translated[0], { key: 'second', text: 'x'.repeat(192_001) }]),
  ]
  for (const [index, response] of responses.entries()) {
    await assert.rejects(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(response) }), error => {
      assert.ok(error instanceof TranslationProviderError)
      assert.equal(error.code, index === 0 ? 'translation_items_invalid' : 'translation_output_too_large')
      assert.deepEqual(error.usage, { inputTokens: 40, outputTokens: 20 })
      return true
    })
  }
})

test('truncated, tool/incomplete, wrong-model and unaccountable usage responses are rejected', async () => {
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(undefined, { stop_reason: 'max_tokens' })) }), 'translation_output_truncated', 'rejected')
  for (const bad of [{ stop_reason: null }, { stop_reason: 'tool_use' }, { content: [{ type: 'thinking', thinking: KEY }] }]) {
    await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(undefined, bad)) }), 'translation_response_invalid', 'rejected')
  }
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(undefined, { model: 'some-fallback-model' })) }), 'translation_model_mismatch', 'rejected')
  for (const usage of [null, { input_tokens: -1, output_tokens: 1 }, { input_tokens: 1, output_tokens: 32769 }]) {
    await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(undefined, { usage })) }), 'translation_usage_invalid', 'rejected')
  }
})

test('only strict JSON is accepted, and oversized HTTP response bounds cannot be bypassed', async () => {
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async () => new Response(KEY) }), 'translation_response_json_invalid', 'rejected')
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(message(undefined, { content: [{ type: 'text', text: '```json\n{}\n```' }] })) }), 'translation_output_json_invalid', 'rejected')
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async () => new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }) }), 'translation_response_unreadable', 'unknown')
})

test('model redirects are rejected without forwarding a second request, even to the same host', async () => {
  for (const response of [new Response(KEY, { status: 307, headers: { location: 'https://unexpected.example' } }), Response.json(message())]) {
    if (response.status === 200) Object.defineProperty(response, 'url', { value: 'https://api.minimaxi.com/other' })
    let calls = 0
    await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async (_url, options) => {
      calls++; assert.equal(options?.redirect, 'manual'); return response
    } }), 'translation_redirect_rejected', 'unknown')
    assert.equal(calls, 1)
  }
})

test('HTTP429 is a typed known rejection with sanitized Retry-After and no internal replay', async () => {
  let calls = 0
  const before = Date.now()
  await assert.rejects(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async () => {
    calls++; return new Response(KEY, { status: 429, headers: { 'retry-after': '60' } })
  } }), error => {
    assert.ok(error instanceof TranslationProviderError)
    assert.equal(error.outcome, 'rejected'); assert.equal(error.retryable, true)
    assert.equal(error.code, 'translation_rate_limited')
    assert.ok(Date.parse(error.retryAfter!) >= before + 60_000)
    assert.ok(Date.parse(error.retryAfter!) <= Date.now() + 60_000)
    assert.ok(!JSON.stringify(error).includes(KEY))
    return true
  })
  assert.equal(calls, 1)
  const result = await readTranslationQuota({ key: KEY, now: NOW, fetcher: async () => new Response(KEY, { status: 429, headers: { 'retry-after': '60' } }) })
  assert.equal(result.retryAt, new Date(NOW + 60_000).toISOString())
})

test('post-send transport errors and HTTP5xx remain unknown and never authorize blind retry', async () => {
  let calls = 0
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async () => { calls++; throw new Error(KEY) } }), 'translation_transport_unknown', 'unknown')
  assert.equal(calls, 1)
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: async () => new Response(KEY, { status: 503 }) }), 'translation_http_503', 'unknown')
})

test('valid charged usage survives malformed output JSON, item-key rejection and token truncation without retaining response data', async () => {
  const cases: [unknown, string][] = [
    [message(undefined, { content: [{ type: 'text', text: `private response ${KEY}` }] }), 'translation_output_json_invalid'],
    [message([translated[0], { key: 'wrong-key', text: `private response ${KEY}` }]), 'translation_items_invalid'],
    [message(undefined, { stop_reason: 'max_tokens' }), 'translation_output_truncated'],
  ]
  for (const [response, code] of cases) {
    await assert.rejects(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: reply(response) }), error => {
      assert.ok(error instanceof TranslationProviderError)
      assert.equal(error.code, code)
      assert.equal(error.outcome, 'rejected')
      assert.deepEqual(error.usage, { inputTokens: 40, outputTokens: 20 })
      assert.ok(!JSON.stringify(error).includes(KEY))
      assert.ok(!JSON.stringify(error).includes('private response'))
      return true
    })
  }
})

test('unknown transport, unparseable HTTP JSON and invalid usage never fabricate charged token counts', async () => {
  const fetchers: typeof fetch[] = [
    async () => { throw new Error(KEY) },
    async () => new Response(KEY),
    reply(message(undefined, { usage: { input_tokens: 1_000_001, output_tokens: 10 } })),
    reply(message(undefined, { usage: { input_tokens: 40, output_tokens: 32_769 } })),
    reply(message(undefined, { usage: { input_tokens: '40', output_tokens: 20 } })),
    reply(message(undefined, { usage: null })),
  ]
  for (const fetcher of fetchers) await assert.rejects(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher }), error => {
    assert.ok(error instanceof TranslationProviderError)
    assert.equal(error.usage, undefined)
    assert.ok(!JSON.stringify(error).includes(KEY))
    return true
  })
})

test('cancellation before send is distinct from cancellation after a request starts, even if the fetcher ignores its signal', async () => {
  const before = new AbortController(); before.abort()
  let calls = 0
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, signal: before.signal, fetcher: async () => { calls++; return Response.json(message()) } }), 'translation_aborted_before_send', 'not_sent')
  assert.equal(calls, 0)
  const after = new AbortController()
  await typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, signal: after.signal, fetcher: async () => {
    calls++; queueMicrotask(() => after.abort()); return new Promise<Response>(() => undefined)
  } }), 'translation_timeout_or_aborted', 'unknown')
  assert.equal(calls, 1)
})

test('the model hard timeout aborts at90seconds and the read-only quota timeout fails closed at20seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const signals: AbortSignal[] = []
  const never: typeof fetch = async (_url, options) => {
    assert.ok(options?.signal)
    signals.push(options.signal)
    return new Promise<Response>(() => undefined)
  }
  const model = typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, fetcher: never }), 'translation_timeout_or_aborted', 'unknown')
  context.mock.timers.tick(89_999)
  assert.equal(signals[0].aborted, false)
  context.mock.timers.tick(1)
  await model
  assert.equal(signals[0].aborted, true)
  const quotaRequest = readTranslationQuota({ key: KEY, now: NOW, fetcher: never })
  context.mock.timers.tick(20_000)
  assert.deepEqual(await quotaRequest, { allow: false, remainingPercent: null, retryAt: null, reason: 'quota_timeout' })
  assert.equal(signals.length, 2)
})

test('a stalled response after HTTP200 remains an unknown outcome and cancels its body on abort', async () => {
  const stop = new AbortController()
  let cancelled = false, calls = 0
  const pending = typedFailure(() => translateMaskedBatch({ key: KEY, locale: 'zh', items: INPUT, signal: stop.signal, fetcher: async () => {
    calls++
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"message",')) },
      cancel() { cancelled = true },
    }))
  } }), 'translation_timeout_or_aborted', 'unknown')
  await new Promise<void>(done => setImmediate(done))
  stop.abort()
  await pending
  assert.equal(calls, 1)
  assert.equal(cancelled, true)
})
