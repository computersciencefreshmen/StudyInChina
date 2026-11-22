import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { candidatePath, reviewTranslationBacklog } from './review-program-translations.mjs'
import { reviewTranslation, TranslationProviderError } from './minimax-translation-provider.ts'
import { translationKey, restoreTranslationText, protectTranslationText } from '../../src/lib/program-translation-contract.ts'
import { publicationPath, reviewBinding, translationConflict, translationScope, validatePublishedTranslation, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'

const source = 'Applicants must provide proof of IELTS 6.5 or a waiver for prior English study.'
const text = '申请人须提交 IELTS 6.5 的证明，或提交因先前使用英语学习而获豁免的证明。'
const row = { id: 'example-a', schoolId: 'a', name: 'Arts', status: 'extracted', fields: { requirements: source, language: 'English' } }
const scope = translationScope(row, 'requirements'), locale = 'zh'
const candidate = { schemaVersion: 1, version: 'v1', key: translationKey(source, locale),
  sourceHash: createHash('sha256').update(source).digest('hex'), targetLocale: locale, text, model: 'MiniMax-M3',
  method: 'minimax', factPolicy: 'literal-v2', validation: 'passed', translatedAt: '2026-11-18T00:00:00.000Z' }
const pass = { verdict: 'PASS', model: 'MiniMax-M3', issue: null, sourceQuote: '', targetQuote: '', usage: { inputTokens: 60, outputTokens: 15 } }
const fixture = t => {
  const root = mkdtempSync(join(tmpdir(), 'translation-review-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, candidatePath(source, locale))
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(candidate))
  return { root, records: [row], maxCalls: 2, concurrency: 1, deadline: Date.now() + 120_000, key: 'test-only',
    checkpoint: () => true, quota: async () => ({ allow: true, remainingPercent: 80 }), review: async () => pass }
}

test('published model text requires independent review for this source, target, policy and exact programme scope', async t => {
  const options = fixture(t), path = join(options.root, publicationPath(source, locale, scope))
  assert.equal(validatePublishedTranslation(candidate, source, locale, scope), null)
  let persisted = false
  const journal = join(options.root, 'translations/review-reservations', REVIEW_POLICY, locale, reviewBinding(source, text, locale, scope) + '.json')
  const result = await reviewTranslationBacklog({ ...options, checkpoint: () => {
    if (existsSync(journal) && JSON.parse(readFileSync(journal)).state === 'reserved') persisted = true
  }, review: async data => {
    assert.ok(persisted); assert.equal(data.source, source); assert.equal(data.text, text); assert.equal(data.scope.track, 'English')
    assert.equal(data.messages, undefined); return pass
  } })
  assert.equal(result.approved, 1); assert.equal(result.inputTokens, 60)
  const approved = JSON.parse(readFileSync(path))
  assert.ok(validatePublishedTranslation(approved, source, locale, scope))
  for (const changed of [{ ...scope, field: 'materials' }, { ...scope, track: 'Chinese' }, { ...scope, school: 'b' }])
    assert.equal(validatePublishedTranslation(approved, source, locale, changed), null)
  assert.equal(validatePublishedTranslation({ ...approved, text: text + '附加说明。' }, source, locale, scope), null)
  assert.equal(validatePublishedTranslation({ ...approved, review: { ...approved.review, policy: 'older' } }, source, locale, scope), null)
  assert.equal((await reviewTranslationBacklog(options)).modelCalls, 0)
})

test('REVISE, BLOCK and unknown never publish, unknown never replays, a lost reservation checkpoint sends nothing', async t => {
  for (const state of ['REVISE', 'BLOCK', 'unknown', 'push_failure']) {
    const options = fixture(t)
    let calls = 0
    const run = () => reviewTranslationBacklog({ ...options,
      checkpoint: () => { if (state === 'push_failure') throw new Error('checkpoint_failure') },
      review: async () => { calls++; if (state === 'unknown') throw new Error('lost'); return { ...pass, verdict: state } } })
    if (state === 'push_failure') await assert.rejects(run(), /checkpoint_failure/)
    else { await run(); await run() }
    assert.equal(calls, state === 'push_failure' ? 0 : 1)
    assert.equal(existsSync(join(options.root, publicationPath(source, locale, scope))), false)
  }
})

test('bilingual counterexamples fail even if an independent reviewer blindly passes them', () => {
  for (const [original, output, reason] of [
    ['Not available to those who have studied Chinese.', '本课程向学过 Chinese 语言的人士开放，具体请参见 not。', 'untranslated_condition'],
    ['Foreign nationals aged 16-40 and above.', '年龄在16-40和above之间。', 'untranslated_condition'],
    ['Not available to those who are under 18 years old.', '本项目 not 向 under 18 years old 开放。', 'untranslated_condition'],
    ['CNY 24000 per semester', '全程 CNY 24000', 'amount_period'],
    ['HSK 5 or IELTS 6.5', 'HSK 5 和 IELTS 6.5', 'and_or'],
    ['Applicants must be under 18 years old.', '申请人年龄不超过18周岁。', 'boundary'],
    ['IELTS 6.5 or an exemption for previous English-medium education.', '所有申请人需提交 IELTS 6.5。', 'exemption'],
    ['Not eligible if you have previously studied Chinese.', '学过中文的申请人也可以申请。', 'negation'],
  ]) assert.equal(translationConflict(original, output, locale), reason)
  const protectedText = protectTranslationText(source, 'literal-v2')
  assert.equal(restoreTranslationText('申请人须提交 __SC_000000__ __SC_000001__ 的证明，或提交因先前使用英语学习而获豁免的证明。', protectedText), text)
})

test('review provider receives only original, candidate and scope, and rejects ungrounded issue verdicts', async () => {
  for (const invalid of [true, false]) {
    const call = () => reviewTranslation({ key: 'test-only', locale, scope, source, text, fetcher: async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.match(body.system, /independent bilingual admissions reviewer/)
      assert.deepEqual(JSON.parse(body.messages[0].content), { targetLanguage: 'Chinese', scope, original: source, candidate: text })
      const verdict = { verdict: 'REVISE', issue: 'omission', sourceQuote: 'waiver', targetQuote: invalid ? 'invented' : '证明' }
      return Response.json({ model: 'MiniMax-M3', type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(verdict) }],
        usage: { input_tokens: 15, output_tokens: 5 } })
    } })
    if (invalid) await assert.rejects(call(), /translation_review_quote_invalid/)
    else assert.equal((await call()).verdict, 'REVISE')
  }
})

test('received review failures retain safe diagnostics and accounting without becoming a semantic verdict or replay', async t => {
  const options = fixture(t), marker = 'private-provider-body-and-credential'
  const journal = join(options.root, 'translations/review-reservations', REVIEW_POLICY, locale, reviewBinding(source, text, locale, scope) + '.json')
  let calls = 0
  const failure = Object.assign(new TranslationProviderError('translation_review_schema_invalid', 'rejected', null, false,
    { inputTokens: 375, outputTokens: 24 }), { providerBody: marker, cause: marker })
  const run = () => reviewTranslationBacklog({ ...options, review: async () => { calls++; throw failure } })
  const summary = await run(), saved = JSON.parse(readFileSync(journal))
  assert.deepEqual(summary.lastProviderError, { code: 'translation_review_schema_invalid', outcome: 'rejected', usage: { inputTokens: 375, outputTokens: 24 } })
  assert.equal(summary.state, 'provider_wait'); assert.equal(summary.approved, 0); assert.equal(summary.revise, 0); assert.equal(summary.blocked, 1)
  assert.equal(summary.inputTokens, 375); assert.equal(summary.outputTokens, 24)
  assert.deepEqual(saved, { binding: reviewBinding(source, text, locale, scope), checkedAt: saved.checkedAt, state: 'failed', ...summary.lastProviderError })
  assert.ok(!JSON.stringify({ summary, saved }).includes(marker))
  assert.equal(existsSync(join(options.root, publicationPath(source, locale, scope))), false)
  await run(); assert.equal(calls, 1)
})

test('diagnostics do not expose arbitrary errors or invalid counts, and unknown outcomes stay protected', async t => {
  for (const outcome of ['unknown', 'unexpected-private-outcome']) {
    const options = fixture(t), marker = 'translation_private_body'
    let calls = 0
    const run = () => reviewTranslationBacklog({ ...options, review: async () => {
      calls++; throw Object.assign(new Error(marker), { code: marker, outcome, usage: { inputTokens: -1, outputTokens: Infinity } })
    } })
    const summary = await run()
    assert.deepEqual(summary.lastProviderError, { code: 'translation_review_provider_error', outcome: 'unknown' })
    assert.equal(summary.unknown, 1); assert.equal(summary.blocked, 0); assert.equal(summary.inputTokens, 0); assert.equal(summary.outputTokens, 0)
    assert.ok(!JSON.stringify(summary).includes(marker))
    await run(); assert.equal(calls, 1)
  }
})

test('existing terminal and unresolved journals remain byte-identical and cannot be retried by the clearer prompt', async t => {
  for (const state of ['failed', 'unknown', 'reserved', 'REVISE', 'BLOCK']) {
    const options = fixture(t), path = join(options.root, 'translations/review-reservations', REVIEW_POLICY, locale, reviewBinding(source, text, locale, scope) + '.json')
    const original = JSON.stringify({ state, binding: reviewBinding(source, text, locale, scope), checkedAt: '2026-11-18T04:32:07.222Z' }) + '\n'
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, original)
    const result = await reviewTranslationBacklog({ ...options, review: async () => { assert.fail('protected prior review was sent') } })
    assert.equal(result.modelCalls, 0); assert.equal(readFileSync(path, 'utf8'), original)
    assert.equal(existsSync(join(options.root, publicationPath(source, locale, scope))), false)
  }
})

test('review parser identifies the exact rejected contract check and preserves only known usage', async () => {
  const valid = { verdict: 'PASS', issue: null, sourceQuote: '', targetQuote: '' }
  const message = item => ({ model: 'MiniMax-M3', type: 'message', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(item) }], usage: { input_tokens: 375, output_tokens: 24 } })
  const cases = [
    [{ ...message(valid), type: 'other' }, 'translation_review_envelope_invalid', false],
    [{ ...message(valid), model: 'fallback-model' }, 'translation_model_mismatch', true],
    [{ ...message(valid), stop_reason: 'max_tokens' }, 'translation_output_truncated', true],
    [{ ...message(valid), stop_reason: 'tool_use' }, 'translation_review_stop_invalid', true],
    [{ ...message(valid), usage: { input_tokens: -1, output_tokens: 24 } }, 'translation_usage_invalid', false],
    [{ ...message(valid), content: [{ type: 'thinking', thinking: 'private' }] }, 'translation_review_content_invalid', true],
    [{ ...message(valid), content: [...message(valid).content, ...message(valid).content] }, 'translation_review_content_invalid', true],
    [{ ...message(valid), content: [{ type: 'text', text: '```json\n{}\n```' }] }, 'translation_review_json_invalid', true],
    [message({ ...valid, extra: true }), 'translation_review_schema_invalid', true],
    [message({ ...valid, verdict: 'PASS|REVISE|BLOCK' }), 'translation_review_schema_invalid', true],
    [message({ ...valid, verdict: ['PASS'] }), 'translation_review_schema_invalid', true],
    [message({ ...valid, sourceQuote: 'Applicants' }), 'translation_review_pass_invalid', true],
    [message({ verdict: 'REVISE', issue: 'invented', sourceQuote: 'waiver', targetQuote: '证明' }), 'translation_review_issue_invalid', true],
    [message({ verdict: 'BLOCK', issue: 'omission', sourceQuote: 'waiver', targetQuote: 'invented' }), 'translation_review_quote_invalid', true],
  ]
  for (const [response, code, hasUsage] of cases) {
    let calls = 0
    await assert.rejects(() => reviewTranslation({ key: 'test-only', locale, scope, source, text, fetcher: async () => {
      calls++; return Response.json(response)
    } }), error => {
      assert.ok(error instanceof TranslationProviderError); assert.equal(error.code, code); assert.equal(error.outcome, 'rejected')
      assert.deepEqual(error.usage, hasUsage ? { inputTokens: 375, outputTokens: 24 } : undefined)
      return true
    })
    assert.equal(calls, 1)
  }
  for (const verdict of ['PASS', 'REVISE', 'BLOCK']) {
    const item = verdict === 'PASS' ? valid : { verdict, issue: 'omission', sourceQuote: 'waiver', targetQuote: '证明' }
    const result = await reviewTranslation({ key: 'test-only', locale, scope, source, text, fetcher: async (_url, init) => {
      const prompt = JSON.parse(init.body).system
      assert.match(prompt, /^Review response contract: verdict-json-v2\./)
      assert.match(prompt, /Choose exactly one verdict string/)
      assert.match(prompt, /For PASS return exactly \{"verdict":"PASS","issue":null,"sourceQuote":"","targetQuote":""\}/)
      assert.match(prompt, /\{"verdict":"REVISE","issue":"and_or","sourceQuote":"HSK 5 or IELTS 6.5","targetQuote":"HSK 5 和 IELTS 6.5"\}/)
      assert.match(prompt, /use excerpts from the actual inputs only/)
      assert.ok(!prompt.includes('PASS|REVISE|BLOCK'))
      return Response.json(message(item))
    } })
    assert.equal(result.verdict, verdict)
  }
})
