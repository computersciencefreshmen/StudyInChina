import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { candidatePath, reviewTranslationBacklog } from './review-program-translations.mjs'
import { reviewTranslation } from './minimax-translation-provider.ts'
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
    if (invalid) await assert.rejects(call(), /translation_review_response_invalid/)
    else assert.equal((await call()).verdict, 'REVISE')
  }
})
