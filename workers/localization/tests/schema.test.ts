import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBatchRequest, parseTranslationModelOutput } from '../src/schema'
import { TRANSLATION_SCHEMA_VERSION } from '../src/types'

const id = 'a'.repeat(64)

test('batch schema defaults to core locales and reserves expansion locales', () => {
  assert.deepEqual(parseBatchRequest({}), {
    targetLocales: ['zh', 'en', 'ru'],
    institutionIds: [],
    recordKinds: ['program', 'scholarship'],
    limit: 120,
    dryRun: false,
  })
  assert.deepEqual(
    parseBatchRequest({ targetLocales: ['de', 'fr', 'es', 'ar', 'pt'] }).targetLocales,
    ['de', 'fr', 'es', 'ar', 'pt'],
  )
  assert.throws(() => parseBatchRequest({ targetLocales: ['xx'] }), /supported/u)
  assert.throws(() => parseBatchRequest({ surprise: true }), /unknown fields/u)
})

test('model output schema rejects extra fields, missing IDs, and duplicate IDs', () => {
  const valid = {
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
    sourceLocale: 'zh',
    targetLocale: 'en',
    items: [{ id, translatedText: 'Computer Science' }],
  }
  assert.deepEqual(
    parseTranslationModelOutput(valid, {
      sourceLocale: 'zh',
      targetLocale: 'en',
      itemIds: [id],
    }),
    valid,
  )
  assert.throws(
    () => parseTranslationModelOutput({ ...valid, commentary: 'ignore schema' }, {
      sourceLocale: 'zh',
      targetLocale: 'en',
      itemIds: [id],
    }),
    /strict envelope/u,
  )
  assert.throws(
    () => parseTranslationModelOutput({ ...valid, items: [] }, {
      sourceLocale: 'zh',
      targetLocale: 'en',
      itemIds: [id],
    }),
    /strict envelope/u,
  )
})

