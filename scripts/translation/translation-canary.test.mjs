import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { canaryRecords, inspectCanary, matchesPublicSample } from './translation-canary.mjs'
import { createHash } from 'node:crypto'
import { buildTranslationUnits } from './run-program-translations.mjs'
import { officialTitleSource, reviewBinding, translationConflict, translationScope, validatePublishedTranslation, REVIEW_MODEL, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'
import { translationKey } from '../../src/lib/program-translation-contract.ts'
import { candidatePath, reviewTranslationBacklog } from './review-program-translations.mjs'
import { CANARY_REVIEW_CONTRACT, manualCanaryRetryContext } from './translation-canary-contract.mjs'
import { TranslationProviderError } from './minimax-translation-provider.ts'

const sources = [
  ['sicas-243', 'sicas-220', 'requirements', "Applicants for Doctorates should hold a Master's degree and an HSK certificate(level 3 or above)."],
  ['sicas-4074', 'sicas-199', 'requirements', 'High school graduate'],
  ['sicas-28538', 'sicas-362', 'materials', '1. Application form 2. Personal resume 3. Scanned copy of passport 4. Senior high school graduation certificate 5. Senior high school academic transcript'],
  ['program-xiamen-university-bachelor-chinese-020302', 'uni-xiamen-university', 'title', '金融工程'],
]
const catalog = sources.map(([id, schoolId, field, source]) => ({ id, schoolId, name: field === 'title' ? source : 'Program', status: 'extracted',
  fields: { language: 'Chinese', description: 'Unselected source field', [field]: source } }))

test('the manual canary selects four pinned scopes with an English degree title and three Chinese detail fields', t => {
  const records = canaryRecords([...catalog, { ...catalog[0], id: 'unlisted' }])
  assert.equal(records.length, 4)
  assert.ok(records.every(row => row.fields.language === 'Chinese' && row.fields.description === undefined))
  const units = buildTranslationUnits(records, ['zh'])
  assert.equal(units.length, 3)
  assert.ok(units.every(unit => unit.locale === 'zh'))
  const titleUnits = buildTranslationUnits(records.filter(row => row.canaryLocale === 'en'), ['en'])
  assert.deepEqual(titleUnits.map(unit => [unit.field, unit.source]), [['title', '金融工程']])
  const root = mkdtempSync(join(tmpdir(), 'canary-absent-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.ok(inspectCanary(root, records).every(row => row.state === 'original_only'))
})

test('a changed source, withdrawn sample, incomplete record, or reassigned school stops the entire canary', () => {
  for (const changes of [{ fields: { requirements: 'Changed text' } }, { name: 'TEST 12' }, { status: 'linked' }, { schoolId: 'elsewhere' }]) {
    assert.throws(() => canaryRecords([{ ...catalog[0], ...changes }, ...catalog.slice(1)]), /translation_canary_source_changed/)
  }
  assert.throws(() => canaryRecords(catalog.slice(1)), /translation_canary_source_changed/)
})

test('a production observation requires the exact original and reviewed translation, or an explicit fallback', () => {
  const hash = text => createHash('sha256').update(text).digest('hex')
  const original = 'High school graduate', text = '高中毕业'
  const sample = { id: 'sicas-4074', locale: 'zh', field: 'requirements', sourceHash: hash(original), state: 'approved', translationHash: hash(text) }
  const body = { meta: { revision: 'a'.repeat(64) }, data: { id: sample.id, fields: { requirements: original } }, translations: { locale: 'zh', fields: { requirements: { text, method: 'minimax' } } } }
  assert.ok(matchesPublicSample(sample, body))
  assert.equal(matchesPublicSample(sample, { ...body, meta: {} }), false)
  assert.equal(matchesPublicSample({ ...sample, sourceHash: hash('changed') }, body), false)
  assert.equal(matchesPublicSample({ ...sample, translationHash: hash('changed') }, body), false)
  assert.equal(matchesPublicSample({ ...sample, state: 'original_only' }, body), false)
  body.translations.fields = {}
  assert.ok(matchesPublicSample({ ...sample, state: 'original_only' }, body))
})

test('English programme titles require a scope-bound independent approval even for a two-character Chinese source', () => {
  const program = { id: 'official', slug: 'finance', universityId: 'school', name: { zh: '金融' }, degreeLevel: 'bachelor', teachingLanguages: ['Chinese'] }
  const school = { id: 'school', name: { en: 'Example University' } }
  const input = officialTitleSource(program, school)
  assert.ok(input)
  assert.equal(officialTitleSource(program, { ...school, id: 'other' }), null)
  const scope = translationScope(input, 'title'), source = input.name, text = 'Finance'
  const now = new Date().toISOString()
  const record = { schemaVersion: 1, version: 'v1', sourceHash: createHash('sha256').update(source).digest('hex'), key: translationKey(source, 'en'),
    targetLocale: 'en', text, method: 'minimax', model: REVIEW_MODEL, translatedAt: now, validation: 'passed', factPolicy: 'literal-v2' }
  const review = { policy: REVIEW_POLICY, model: REVIEW_MODEL, verdict: 'PASS', checkedAt: now, binding: reviewBinding(source, text, 'en', scope) }
  assert.equal(validatePublishedTranslation(record, source, 'en', scope), null)
  assert.equal(translationConflict(source, 'Finance金融', 'en', 'title'), 'untranslated_title')
  assert.ok(validatePublishedTranslation({ ...record, review }, source, 'en', scope))
  assert.equal(validatePublishedTranslation({ ...record, review }, source, 'en', { ...scope, school: 'other' }), null)
})

test('the official same-code bilingual catalogue rejects a near-neighbour major before a billable review', async t => {
  const root = mkdtempSync(join(tmpdir(), 'canary-title-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const row = canaryRecords(catalog).find(row => row.canaryLocale === 'en')
  const source = row.name, path = join(root, candidatePath(source, 'en'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, version: 'v1', sourceHash: createHash('sha256').update(source).digest('hex'),
    key: translationKey(source, 'en'), targetLocale: 'en', text: 'Finance', method: 'minimax', model: REVIEW_MODEL,
    translatedAt: new Date().toISOString(), validation: 'passed', factPolicy: 'literal-v2' }))
  const outcome = await reviewTranslationBacklog({ root, records: [row], locales: ['en'], fields: ['title'], concurrency: 1,
    maxCalls: 1, deadline: Date.now() + 120000, checkpoint: () => true, quota: () => assert.fail('unnecessary quota probe') })
  assert.equal(outcome.revise, 1)
  assert.equal(outcome.modelCalls, 0)
})

const manualEnvironment = { CANARY_RETRY_LEGACY_FAILED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ID: '45031634614', GITHUB_RUN_ATTEMPT: '1' }
const pinnedTexts = ['博士学位申请者应持有硕士学位及HSK证书（级别为3或以上）。', '高中毕业',
  '1. 申请表 2. 个人简历 3. 护照扫描件 4. 高中毕业证书 5. 高中成绩单', 'Financial Engineering']
function retryFixture(t, rows = canaryRecords(catalog)) {
  const root = mkdtempSync(join(tmpdir(), 'canary-retry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const entries = rows.map((row, index) => {
    const locale = row.canaryLocale, field = locale === 'en' ? 'title' : Object.hasOwn(row.fields, 'materials') ? 'materials' : 'requirements'
    const source = field === 'title' ? row.name : row.fields[field], text = pinnedTexts[index]
    const scope = translationScope(row, field), binding = reviewBinding(source, text, locale, scope)
    const path = join(root, candidatePath(source, locale))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, version: 'v1', key: translationKey(source, locale),
      sourceHash: createHash('sha256').update(source).digest('hex'), targetLocale: locale, text, method: 'minimax', model: REVIEW_MODEL,
      translatedAt: '2026-11-18T04:31:43.073Z', validation: 'passed', factPolicy: 'literal-v2' }))
    const journal = join(root, 'translations/review-reservations', REVIEW_POLICY, locale, binding + '.json')
    const retryJournal = join(root, 'translations/review-retries', CANARY_REVIEW_CONTRACT, locale, binding + '.json')
    return { row, source, text, locale, field, scope, binding, journal, retryJournal }
  })
  const saveLegacy = (entry, state = 'failed', extra = {}) => {
    const bytes = JSON.stringify({ binding: entry.binding, checkedAt: '2026-11-18T04:32:07.222Z', state, ...extra }) + '\n'
    mkdirSync(dirname(entry.journal), { recursive: true }); writeFileSync(entry.journal, bytes)
    return bytes
  }
  const options = { root, records: rows, locales: ['en', 'zh'], maxCalls: 4, concurrency: 1, deadline: Date.now() + 120000,
    checkpoint: () => true, key: 'test-only', quota: async () => ({ allow: true, remainingPercent: 80 }), environment: manualEnvironment }
  return { root, entries, saveLegacy, options }
}

test('explicit manual canary retry reviews four pinned fields once while preserving three legacy failed journals', async t => {
  const { entries, options, root, saveLegacy } = retryFixture(t)
  const originals = new Map(entries.filter(entry => entry.field !== 'materials').map(entry => [entry.journal, saveLegacy(entry)]))
  let calls = 0
  const run = () => reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: async input => {
    calls++
    const entry = entries.find(entry => entry.source === input.source && entry.locale === input.locale)
    const reserved = JSON.parse(readFileSync(originals.has(entry.journal) ? entry.retryJournal : entry.journal))
    assert.equal(reserved.state, 'reserved')
    if (originals.has(entry.journal)) {
      assert.equal(reserved.canaryRetry.contract, CANARY_REVIEW_CONTRACT)
      assert.equal(reserved.canaryRetry.legacyJournalSha256, createHash('sha256').update(originals.get(entry.journal)).digest('hex'))
      assert.equal(readFileSync(entry.journal, 'utf8'), originals.get(entry.journal))
    }
    return { verdict: 'PASS', model: REVIEW_MODEL, issue: null, sourceQuote: '', targetQuote: '', usage: { inputTokens: 10, outputTokens: 5 } }
  } })
  const result = await run()
  assert.equal(result.modelCalls, 4); assert.equal(result.approved, 4); assert.equal(calls, 4)
  assert.ok(inspectCanary(root, options.records).every(entry => entry.state === 'approved'))
  for (const [path, bytes] of originals) assert.equal(readFileSync(path, 'utf8'), bytes)
  assert.equal((await run()).modelCalls, 0); assert.equal(calls, 4)
})

test('automatic runs and invalid manual contexts cannot opt into legacy retries', async t => {
  const { entries, options, saveLegacy } = retryFixture(t, canaryRecords(catalog).slice(0, 1))
  const original = saveLegacy(entries[0])
  const review = () => assert.fail('unauthorized canary retry')
  assert.equal((await reviewTranslationBacklog({ ...options, review })).modelCalls, 0)
  for (const changed of [{ GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_RUN_ID: '' },
    { GITHUB_RUN_ATTEMPT: '' }, { CANARY_RETRY_LEGACY_FAILED: 'false' }]) {
    const environment = { ...manualEnvironment, ...changed }
    assert.throws(() => manualCanaryRetryContext(environment), /translation_canary_retry_manual_main_required/)
    await assert.rejects(() => reviewTranslationBacklog({ ...options, review, environment, retryLegacyFailedCanary: true }), /translation_canary_retry_manual_main_required/)
  }
  assert.equal(readFileSync(entries[0].journal, 'utf8'), original)
  assert.equal(existsSync(entries[0].retryJournal), false)
})

test('retry eligibility excludes all other states, new diagnostic failures, and changed pinned identities or sources', async t => {
  for (const state of ['unknown', 'reserved', 'PASS', 'REVISE', 'BLOCK', 'failed']) {
    const { entries, options, saveLegacy } = retryFixture(t, canaryRecords(catalog).slice(0, 1))
    const extra = state === 'failed' ? { outcome: 'rejected', code: 'translation_review_schema_invalid' } : {}
    const original = saveLegacy(entries[0], state, extra)
    const result = await reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: () => assert.fail('protected state was replayed') })
    assert.equal(result.modelCalls, 0); assert.equal(readFileSync(entries[0].journal, 'utf8'), original)
    assert.equal(existsSync(entries[0].retryJournal), false)
  }
  const pinned = canaryRecords(catalog)[0]
  for (const changed of [{ id: 'unlisted' }, { schoolId: 'other-school' },
    { fields: { ...pinned.fields, requirements: 'A different original requirement.' } },
    { fields: { language: 'Chinese', materials: pinned.fields.requirements } }]) {
    const { entries, options, saveLegacy } = retryFixture(t, [{ ...pinned, ...changed }])
    const original = saveLegacy(entries[0])
    const result = await reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: () => assert.fail('unpinned scope was replayed') })
    assert.equal(result.modelCalls, 0); assert.equal(readFileSync(entries[0].journal, 'utf8'), original)
  }
})

test('a versioned retry is never replayed after any sent, unresolved, or terminal result', async t => {
  for (const state of ['failed', 'unknown', 'reserved', 'PASS', 'REVISE', 'BLOCK', 'rate_limited']) {
    const { entries, options, saveLegacy } = retryFixture(t, canaryRecords(catalog).slice(0, 1)), entry = entries[0]
    const original = saveLegacy(entry), retryBytes = JSON.stringify({ state, binding: entry.binding, retryAt: '2026-11-18T00:00:00Z' })
    mkdirSync(dirname(entry.retryJournal), { recursive: true }); writeFileSync(entry.retryJournal, retryBytes)
    const result = await reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: () => assert.fail('second retry was sent') })
    assert.equal(result.modelCalls, 0); assert.equal(readFileSync(entry.journal, 'utf8'), original)
    assert.equal(readFileSync(entry.retryJournal, 'utf8'), retryBytes)
  }
})

test('a versioned no-send admission wait can resume once and failed intent checkpoint never bills', async t => {
  const { entries, options, saveLegacy } = retryFixture(t, canaryRecords(catalog).slice(0, 1)), entry = entries[0]
  const original = saveLegacy(entry)
  const waiting = await reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: async () => {
    throw new TranslationProviderError('translation_admission_wait', 'not_sent', '2026-11-18T00:00:00Z', true, undefined, 'model_capacity')
  } })
  assert.equal(waiting.modelCalls, 0)
  let calls = 0
  const run = () => reviewTranslationBacklog({ ...options, retryLegacyFailedCanary: true, review: async () => {
    calls++; throw new TranslationProviderError('translation_review_json_invalid', 'rejected')
  } })
  assert.equal((await run()).modelCalls, 1); assert.equal((await run()).modelCalls, 0); assert.equal(calls, 1)
  assert.equal(readFileSync(entry.journal, 'utf8'), original)
  const second = retryFixture(t, canaryRecords(catalog).slice(0, 1)); second.saveLegacy(second.entries[0])
  await assert.rejects(() => reviewTranslationBacklog({ ...second.options, retryLegacyFailedCanary: true,
    checkpoint: () => { throw new Error('push_failed') }, review: () => assert.fail('uncheckpointed retry billed') }), /push_failed/)
  assert.equal(JSON.parse(readFileSync(second.entries[0].retryJournal)).state, 'reserved')
  assert.equal((await reviewTranslationBacklog({ ...second.options, retryLegacyFailedCanary: true,
    review: () => assert.fail('reserved retry billed') })).modelCalls, 0)
})
