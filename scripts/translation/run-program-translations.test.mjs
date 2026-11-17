import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildTranslationUnits, runProgramTranslations, splitTranslationSource } from './run-program-translations.mjs'
import { translationKey, translationPath } from '../../src/lib/program-translation-contract.ts'

const source = 'Please submit your application documents. IELTS 6.0 is required.'
const records = [{ id: 'sicas-1', schoolId: 'sicas-1', status: 'extracted', fields: { requirements: source } }]
const allowed = async () => ({ allow: true, remainingPercent: 80, retryAt: null, reason: 'subscription_available' })
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const fakeModel = calls => async ({ items, locale }) => {
  calls.push({ items, locale })
  const prose = { zh: '请提交申请材料，并按规定提供证明。', en: 'Please submit the application documents and supporting evidence.',
    ru: 'Предоставьте документы для поступления и подтверждающие материалы.', de: 'Bitte reichen Sie die Bewerbungsunterlagen ein.',
    fr: 'Veuillez transmettre les documents de candidature.', es: 'Presente los documentos de solicitud.' }[locale]
  return { model: 'MiniMax-M3', usage: { inputTokens: 100, outputTokens: 80 }, items: items.map(item => ({ key: item.key,
    text: prose + ' ' + (item.text.match(/__SC_\d{6}__/g) || []).join(' ') })) }
}
const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'sic-translation-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root }
const options = root => ({ feedDir: root, records, environment: { MINIMAX_SUBSCRIPTION_KEY: 'test-subscription-only' }, maxCalls: 1,
  concurrency: 1, maxMinutes: 8, quota: allowed, checkpoint: () => true })

test('shared text deduplicates across schools and languages have distinct keys', () => {
  const units = buildTranslationUnits([...records, { ...records[0], id: 'sicas-2', schoolId: 'sicas-2' }])
  assert.equal(units.length, 6)
  assert.equal(new Set(units.map(unit => unit.key)).size, 6)
  assert.deepEqual(units.slice(0, 2).map(unit => unit.locale), ['zh', 'en'])
})
test('long prose chunks preserve exact source bytes', () => {
  const text = ('Ordinary introduction.\nIELTS 6.0 is required.\n' + 'A second paragraph.\n').repeat(80)
  const chunks = splitTranslationSource(text, 500)
  assert.ok(chunks.length > 1); assert.equal(chunks.join(''), text)
  assert.ok(chunks.every(chunk => !chunk.includes('IELTS') || chunk.includes('IELTS 6.0 is required.')))
})
test('a sentence boundary inside an abbreviated date cannot split the protected date', () => {
  const text = 'A'.repeat(5990) + '. Nov. 17, 2026 is the deadline. Please submit documentation.'
  const chunks = splitTranslationSource(text)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.every(chunk => !chunk.includes('Nov.') || chunk.includes('Nov. 17, 2026')))
})
test('durable reservation is checkpointed before billing and original facts stay untouched', async t => {
  const root = fixture(t), original = JSON.stringify(records), calls = []; let persistedReservation = false
  const result = await runProgramTranslations({ ...options(root), checkpoint: () => {
    const files = readdirSync(root, { recursive: true }).filter(name => name.includes('reservations') && name.endsWith('.json'))
    persistedReservation ||= files.some(file => read(join(root, file)).state === 'reserved'); return true
  }, translate: async input => { assert.ok(persistedReservation); return fakeModel(calls)(input) } })
  assert.equal(result.modelCalls, 1); assert.equal(calls[0].locale, 'zh'); assert.equal(JSON.stringify(records), original)
  const entry = read(join(root, translationPath(source, 'zh')))
  assert.ok(entry.text.includes('IELTS 6.0')); assert.ok(entry.text.includes('required')); assert.equal(entry.method, 'minimax')
  assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 80)
})
test('completed unit is reused on subsequent runs rather than billed again', async t => {
  const root = fixture(t), calls = [], translate = fakeModel(calls)
  await runProgramTranslations({ ...options(root), translate })
  await runProgramTranslations({ ...options(root), translate })
  const firstKey = translationKey(source, 'zh')
  assert.equal(calls.flatMap(call => call.items).filter(item => item.key === firstKey).length, 1)
})
test('unknown provider outcome remains quarantined across later runs', async t => {
  const root = fixture(t), calls = []
  const translate = async input => { calls.push(input); throw Object.assign(new Error('provider_transport_unknown'), { code: 'provider_transport_unknown', outcome: 'unknown' }) }
  const first = await runProgramTranslations({ ...options(root), translate })
  assert.ok(first.blockedUnknownUnits > 0)
  await runProgramTranslations({ ...options(root), translate })
  const firstKey = translationKey(source, 'zh')
  assert.equal(calls.flatMap(call => call.items).filter(item => item.key === firstKey).length, 1)
})
test('unknown or exhausted quota never starts a model call', async t => {
  const root = fixture(t)
  const result = await runProgramTranslations({ ...options(root), quota: async () => ({ allow: false, remainingPercent: null, retryAt: null, reason: 'quota_unknown' }),
    translate: async () => { throw new Error('must_not_call') } })
  assert.equal(result.modelCalls, 0); assert.equal(result.state, 'quota_wait')
})
test('changed critical information is rejected instead of published', async t => {
  const root = fixture(t)
  const result = await runProgramTranslations({ ...options(root), translate: async ({ items }) => ({ model: 'MiniMax-M3', usage: { inputTokens: 20, outputTokens: 20 },
    items: items.map(item => ({ key: item.key, text: 'IELTS 4.0 is enough.' })) }) })
  assert.ok(result.failedUnits > 0); assert.equal(existsSync(join(root, translationPath(source, 'zh'))), false)
  assert.equal(result.inputTokens, 20); assert.equal(result.outputTokens, 20)
})
test('known charged usage survives provider rejection without publishing its invalid output', async t => {
  const root = fixture(t)
  const result = await runProgramTranslations({ ...options(root), translate: async () => {
    throw Object.assign(new Error('translation_output_json_invalid'), { code: 'translation_output_json_invalid', outcome: 'rejected', usage: { inputTokens: 55, outputTokens: 34 } })
  } })
  assert.equal(result.inputTokens, 55); assert.equal(result.outputTokens, 34)
  assert.equal(existsSync(join(root, translationPath(source, 'zh'))), false)
})
test('failed reservation checkpoint prevents all model requests', async t => {
  const root = fixture(t); let checkpoints = 0, modelCalls = 0
  await assert.rejects(runProgramTranslations({ ...options(root), checkpoint: () => { if (++checkpoints === 2) throw new Error('push_failed'); return true },
    translate: async input => { modelCalls++; return fakeModel([])(input) } }), /push_failed/)
  assert.equal(modelCalls, 0)
})
test('other-language requests wait for the English/Chinese wave to settle', async t => {
  const root = fixture(t); let primaryFinished = false
  await runProgramTranslations({ ...options(root), maxCalls: 3, concurrency: 8, translate: async input => {
    if (input.locale === 'zh') {
      await new Promise(resolve => setTimeout(resolve, 10)); primaryFinished = true
    } else assert.ok(primaryFinished)
    return fakeModel([])(input)
  } })
})
