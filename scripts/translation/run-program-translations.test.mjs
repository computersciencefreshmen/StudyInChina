import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { buildTranslationUnits, runProgramTranslations, runTranslationCheckpoint, splitTranslationSource } from './run-program-translations.mjs'
import { translationKey } from '../../src/lib/program-translation-contract.ts'
import { candidatePath as translationPath } from './review-program-translations.mjs'

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
  concurrency: 1, maxMinutes: 8, quota: allowed, checkpoint: () => true, factPolicy: null })
const journal = (root, original, locale = 'zh') => join(root, 'translations', 'reservations', 'v1', locale, translationKey(original, locale) + '.json')
const writeJournal = (root, original, value) => {
  const path = journal(root, original)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ schemaVersion: 1, key: translationKey(original, 'zh'), locale: 'zh', ...value }))
}
const clock = Date.parse('2026-11-17T09:00:00.000Z')
const pair = [records[0], { ...records[0], id: 'sicas-2', fields: { requirements: 'Please provide the application documents and your personal statement. TOEFL 80 is required.' } }]

test('reserves a bounded generation phase even with a large independent review backlog', async () => {
  const phases = []
  const result = await runTranslationCheckpoint({ root: 'unused', titleRecords: [], records, maxCalls: 120,
    maxMinutes: 12, concurrency: 2, now: () => clock,
    reviewBatch: async input => {
      const title = input.fields.includes('title')
      phases.push(title ? 'review titles' : 'review details')
      assert.equal(input.deadline, clock + 12 * 60_000)
      const modelCalls = title ? 0 : input.maxCalls
      return { startedAt: new Date(clock).toISOString(), state: 'review_checkpoint', modelCalls, approved: modelCalls,
        revise: 0, blocked: 0, unknown: 0, skippedCopy: 0, skippedSameLanguage: 0, inputTokens: modelCalls, outputTokens: modelCalls }
    }, generateBatch: async input => {
      const title = input.fields.includes('title')
      phases.push(title ? 'generate titles' : 'generate missing detail translations')
      assert.equal(input.maxCalls, title ? 1 : 30)
      if (!title) assert.equal(input.maxMinutes, 4)
      return { state: 'checkpoint_complete', modelCalls: title ? 0 : 10, inputTokens: title ? 0 : 12, outputTokens: title ? 0 : 8 }
    } })
  assert.deepEqual(phases, ['review titles', 'generate titles', 'generate missing detail translations', 'review details'])
  assert.equal(result.modelCalls, 120)
  assert.equal(result.review.approved, 110)
  assert.equal(result.inputTokens, 122)
})

test('shared text deduplicates across schools and languages have distinct keys', () => {
  const units = buildTranslationUnits([...records, { ...records[0], id: 'sicas-2', schoolId: 'sicas-2' }])
  assert.deepEqual(units.map(unit => unit.locale), ['zh', 'ru', 'de', 'fr', 'es'])
  assert.equal(new Set(units.map(unit => unit.key)).size, 5)
})

test('an English target only queues source with evidence of another language', () => {
  const originals = [
    'Non-Chinese citizen.',
    'High school graduate',
    'Official site: https://example.test/申请',
    'Applicants should maintain a healthy physique.',
    'Download and complete the form 留学生信息表.doc.',
    'See 英语为母语的国家信息 English as Native Language List.pdf2) Submit the remaining documents.',
    '申请人须提交学历证明。',
    '请提交留学生信息表.doc，并确认材料齐全。',
    'Подайте документы для поступления.',
    'Veuillez soumettre votre dossier de candidature.',
    'Bewerber müssen die Unterlagen einreichen.',
    'Los solicitantes deben presentar los requisitos.',
    'Licence en physique',
    'Diplôme de licence',
    'Master en informatique',
    'Maschinenbau',
    'Deutschkenntnisse erforderlich',
    'Abitur oder gleichwertiger Abschluss',
    'Certificado de bachillerato',
    'Título universitario',
    'Licenciatura en Fisica',
  ]
  const rows = originals.map((requirements, index) => ({
    ...records[0], id: `sample-${index}`, fields: { requirements },
  }))
  const units = buildTranslationUnits(rows, ['en'], ['requirements'])
  assert.deepEqual(units.map(unit => unit.source), originals.slice(6))
})

test('a mixed source translates the Chinese chunk and keeps its English portion verbatim', async t => {
  const root = fixture(t)
  const intro = 'High school graduate.\n'.repeat(270).trimEnd()
  const english = intro.padEnd(5999) + '\n'
  const chinese = '申请人须提交学历证明和具备完整签名的文件。'.repeat(6)
  const original = english + chinese
  const [first, second] = splitTranslationSource(original)
  assert.ok(first === english && second === chinese)
  const translated = 'Submit proof of education and fully signed documentation.'.repeat(6)
  const result = await runProgramTranslations({
    ...options(root),
    records: [{ ...records[0], fields: { requirements: original } }],
    locales: ['en'], fields: ['requirements'],
    translate: async ({ items }) => {
      assert.deepEqual(items.map(item => item.text), [chinese])
      return { model: 'MiniMax-M3', usage: { inputTokens: 60, outputTokens: 50 }, items: [{ key: items[0].key, text: translated }] }
    },
  })
  assert.equal(result.modelCalls, 1)
  assert.equal(read(join(root, translationPath(original, 'en'))).text, english + translated)
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

test('a fact-invalid neighbour cannot discard a valid item or multiply measured response usage', async t => {
  const root = fixture(t), original = JSON.stringify(pair), calls = []
  const result = await runProgramTranslations({ ...options(root), records: pair, translate: async input => {
    const response = await fakeModel(calls)(input)
    response.items[1].text = '未经保留原文的 TOEFL 40。'
    return response
  } })
  assert.equal(calls[0].items.length, 2)
  assert.equal(existsSync(join(root, translationPath(pair[0].fields.requirements, 'zh'))), true)
  assert.equal(existsSync(join(root, translationPath(pair[1].fields.requirements, 'zh'))), false)
  assert.equal(read(journal(root, pair[0].fields.requirements)).state, 'completed')
  assert.equal(read(journal(root, pair[1].fields.requirements)).state, 'failed')
  assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 80)
  assert.equal(result.failedUnits, 1); assert.equal(JSON.stringify(pair), original)
})

test('provider-rejected items are isolated and successful neighbours are never charged again', async t => {
  const root = fixture(t), calls = [], badSource = pair[1].fields.requirements, goodSource = pair[0].fields.requirements
  await runProgramTranslations({ ...options(root), records: pair, now: () => clock, translate: async input => {
    const response = await fakeModel(calls)(input), rejected = response.items.pop()
    return { ...response, rejectedItems: [{ key: rejected.key, code: 'translation_placeholder_mismatch' }] }
  } })
  assert.equal(read(journal(root, goodSource)).state, 'completed')
  const rejected = read(journal(root, badSource))
  assert.equal(rejected.state, 'failed'); assert.equal(rejected.retryPolicy, 'item-v2'); assert.equal(rejected.policyAttempts, 1)
  await runProgramTranslations({ ...options(root), records: pair, now: () => clock + 16 * 60_000, translate: fakeModel(calls) })
  assert.equal(calls[1].items.length, 1)
  assert.equal(calls[1].items[0].key, translationKey(badSource, 'zh'))
  assert.equal(calls.flatMap(call => call.items).filter(item => item.key === translationKey(goodSource, 'zh')).length, 1)
  assert.equal(read(journal(root, badSource)).state, 'completed')
})

test('legacy quality-failed batch items receive only two isolated policy-upgrade attempts while keeping lifetime attempts', async t => {
  const root = fixture(t), calls = []
  writeJournal(root, source, { state: 'failed', attempts: 2, code: 'translation_validation_or_provider_rejected', retryAt: new Date(clock - 1).toISOString() })
  const reject = async input => {
    calls.push(input)
    assert.equal(input.items.length, 1)
    return { model: 'MiniMax-M3', usage: { inputTokens: 20, outputTokens: 10 }, items: [],
      rejectedItems: [{ key: input.items[0].key, code: 'translation_placeholder_mismatch' }] }
  }
  await runProgramTranslations({ ...options(root), now: () => clock, translate: reject })
  assert.equal(read(journal(root, source)).attempts, 3)
  assert.equal(read(journal(root, source)).policyAttempts, 1)
  await runProgramTranslations({ ...options(root), now: () => clock + 16 * 60_000, translate: reject })
  assert.equal(read(journal(root, source)).attempts, 4)
  assert.equal(read(journal(root, source)).policyAttempts, 2)
  await runProgramTranslations({ ...options(root), now: () => clock + 32 * 60_000, translate: fakeModel(calls) })
  assert.equal(calls.flatMap(call => call.items).filter(item => item.key === translationKey(source, 'zh')).length, 2)
})

test('legacy retry upgrade respects cooldown and never rescues unknown, reserved or configuration failures', async t => {
  for (const value of [
    { state: 'unknown', attempts: 2, code: 'translation_transport_unknown', retryAt: new Date(clock - 1).toISOString() },
    { state: 'reserved', attempts: 2, code: 'translation_validation_or_provider_rejected', retryAt: new Date(clock - 1).toISOString() },
    { state: 'failed', attempts: 2, code: 'translation_http_401', retryAt: new Date(clock - 1).toISOString() },
    { state: 'failed', attempts: 2, code: 'translation_input_too_large', retryAt: new Date(clock - 1).toISOString() },
    { state: 'failed', attempts: 2, code: 'translation_validation_or_provider_rejected', retryAt: new Date(clock + 60_000).toISOString() },
  ]) {
    const root = fixture(t), calls = []
    writeJournal(root, source, value)
    await runProgramTranslations({ ...options(root), now: () => clock, translate: fakeModel(calls) })
    assert.equal(calls.flatMap(call => call.items).filter(item => item.key === translationKey(source, 'zh')).length, 0)
    assert.deepEqual(read(journal(root, source)).state, value.state)
    assert.equal(read(journal(root, source)).attempts, 2)
  }
})

test('an output-storage failure cannot rewrite a completed neighbour or allow another billing wave', async t => {
  const root = fixture(t), calls = []
  mkdirSync(join(root, translationPath(pair[1].fields.requirements, 'zh')), { recursive: true })
  await assert.rejects(runProgramTranslations({ ...options(root), records: pair, maxCalls: 10, translate: fakeModel(calls) }), /translation_storage_failed/)
  assert.equal(calls.length, 1)
  assert.equal(read(journal(root, pair[0].fields.requirements)).state, 'completed')
  assert.equal(read(journal(root, pair[1].fields.requirements)).state, 'reserved')
  assert.equal(read(join(root, translationPath(pair[0].fields.requirements, 'zh'))).method, 'minimax')
})

test('a failed post-response checkpoint stops work before another billing wave', async t => {
  const root = fixture(t), calls = []; let checkpoints = 0
  await assert.rejects(runProgramTranslations({ ...options(root), records: pair, maxCalls: 10,
    checkpoint: () => { if (++checkpoints === 3) throw new Error('checkpoint_push_failed'); return true }, translate: fakeModel(calls) }), /checkpoint_push_failed/)
  assert.equal(calls.length, 1)
  assert.equal(read(journal(root, pair[0].fields.requirements)).state, 'completed')
})

for (const [code, outcome] of [['translation_rate_limited', 'rejected'], ['translation_http_529', 'unknown']]) {
  test(`${code} stops later waves while the already-started successful neighbour is checkpointed`, async t => {
    const root = fixture(t), calls = []; let checkpoints = 0
    const many = Array.from({ length: 18 }, (_, i) => ({ ...records[0], id: `sicas-${i}`,
      fields: { requirements: `Please submit your application documents for programme number ${i}. IELTS 6.0 is required.` } }))
    const byKey = new Map(many.map(row => [translationKey(row.fields.requirements, 'zh'), row.fields.requirements]))
    const result = await runProgramTranslations({ ...options(root), records: many, maxCalls: 10, concurrency: 2,
      checkpoint: () => { checkpoints++; return true }, translate: async input => {
        calls.push(input)
        if (calls.length === 1) {
          await new Promise(resolve => setTimeout(resolve, 5))
          throw Object.assign(new Error('never retain provider body or credentials'), { code, outcome })
        }
        await new Promise(resolve => setTimeout(resolve, 10))
        return fakeModel([])(input)
      } })
    assert.equal(calls.length, 2)
    assert.equal(result.state, 'provider_wait'); assert.equal(result.lastProviderError, code)
    assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 80)
    for (const item of calls[0].items) assert.equal(read(journal(root, byKey.get(item.key))).state, outcome === 'unknown' ? 'unknown' : 'failed')
    for (const item of calls[1].items) {
      assert.equal(read(journal(root, byKey.get(item.key))).state, 'completed')
      assert.equal(existsSync(join(root, translationPath(byKey.get(item.key), 'zh'))), true)
    }
    assert.ok(checkpoints >= 3)
    assert.equal(JSON.stringify(result).includes('never retain provider body or credentials'), false)
  })
}
