import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { canaryRecords, inspectCanary, matchesPublicSample } from './translation-canary.mjs'
import { createHash } from 'node:crypto'
import { buildTranslationUnits } from './run-program-translations.mjs'
import { officialTitleSource, reviewBinding, translationConflict, translationScope, validatePublishedTranslation, REVIEW_MODEL, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'
import { translationKey } from '../../src/lib/program-translation-contract.ts'
import { candidatePath, reviewTranslationBacklog } from './review-program-translations.mjs'

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
