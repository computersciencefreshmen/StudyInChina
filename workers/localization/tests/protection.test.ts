import assert from 'node:assert/strict'
import test from 'node:test'
import { protectStructuredFacts, restoreStructuredFacts } from '../src/protection'

test('dates, amounts, URLs, emails, and numeric identifiers are immutable model tokens', () => {
  const source = [
    'Apply by 2026-09-01.',
    'Tuition is CNY 30,000 and HSK 5 is required.',
    'Use https://example.edu.cn/apply or admit@example.edu.cn.',
  ].join(' ')
  const protectedText = protectStructuredFacts(source)
  assert.ok(protectedText.tokens.length >= 5)
  assert.doesNotMatch(protectedText.text, /2026-09-01|30,000|https:\/\//u)

  const translated = `请翻译：${protectedText.text}`
  const restored = restoreStructuredFacts(translated, protectedText)
  for (const value of ['2026-09-01', 'CNY 30,000', '5', 'https://example.edu.cn/apply']) {
    assert.ok(restored.includes(value))
  }
})

test('modified, missing, or duplicated protected tokens are rejected', () => {
  const protectedText = protectStructuredFacts('Deadline 2026-09-01; tuition CNY 30,000.')
  assert.throws(
    () => restoreStructuredFacts(
      protectedText.text.replace('__SIC_PROTECTED_0000__', '2027-01-01'),
      protectedText,
    ),
    /protected date\/amount token/u,
  )
  assert.throws(
    () => restoreStructuredFacts(
      `${protectedText.text} __SIC_PROTECTED_0000__`,
      protectedText,
    ),
    /protected date\/amount token/u,
  )
})

