import {
  STABLE_LOCALIZED_FIELDS,
  SUPPORTED_TARGET_LOCALES,
  TRANSLATABLE_RECORD_KINDS,
  TRANSLATION_SCHEMA_VERSION,
  type StableLocalizedField,
  type SupportedTargetLocale,
  type TranslatableRecordKind,
  type TranslationBatchRequest,
  type TranslationModelOutput,
} from './types'
import { LocalizationError } from './errors'

const PUBLIC_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/
const MODEL_ITEM_ID = /^[a-f0-9]{64}$/

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return [...new Set(value)]
}

export function isSupportedTargetLocale(value: string): value is SupportedTargetLocale {
  return (SUPPORTED_TARGET_LOCALES as readonly string[]).includes(value)
}

export function isStableLocalizedField(value: string): value is StableLocalizedField {
  return (STABLE_LOCALIZED_FIELDS as readonly string[]).includes(value)
}

export function parseBatchRequest(value: unknown): TranslationBatchRequest {
  if (!isObject(value)) {
    throw new LocalizationError('Batch request must be a JSON object', 'invalid_batch_request', false)
  }
  const allowedKeys = ['dryRun', 'institutionIds', 'limit', 'recordKinds', 'targetLocales']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new LocalizationError('Batch request contains unknown fields', 'invalid_batch_request', false)
  }

  const targetValues = value.targetLocales === undefined
    ? ['zh', 'en', 'ru']
    : uniqueStrings(value.targetLocales)
  if (
    !targetValues?.length
    || targetValues.length > SUPPORTED_TARGET_LOCALES.length
    || !targetValues.every(isSupportedTargetLocale)
  ) {
    throw new LocalizationError(
      'targetLocales must contain supported unique locale codes',
      'invalid_target_locales',
      false,
    )
  }

  const institutionIds = value.institutionIds === undefined
    ? []
    : uniqueStrings(value.institutionIds)
  if (
    institutionIds === null
    || institutionIds.length > 120
    || !institutionIds.every((item) => PUBLIC_ID.test(item))
  ) {
    throw new LocalizationError(
      'institutionIds must contain at most 120 stable public IDs',
      'invalid_institution_ids',
      false,
    )
  }

  const kindValues = value.recordKinds === undefined
    ? ['program', 'scholarship']
    : uniqueStrings(value.recordKinds)
  if (
    !kindValues?.length
    || !kindValues.every((kind) => (
      (TRANSLATABLE_RECORD_KINDS as readonly string[]).includes(kind)
    ))
  ) {
    throw new LocalizationError(
      'recordKinds contains an unsupported record type',
      'invalid_record_kinds',
      false,
    )
  }

  const limit = value.limit === undefined ? 120 : value.limit
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 1_000) {
    throw new LocalizationError('limit must be an integer from 1 to 1000', 'invalid_limit', false)
  }
  if (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') {
    throw new LocalizationError('dryRun must be a boolean', 'invalid_dry_run', false)
  }

  return {
    targetLocales: targetValues as SupportedTargetLocale[],
    institutionIds,
    recordKinds: kindValues as TranslatableRecordKind[],
    limit: Number(limit),
    dryRun: value.dryRun === true,
  }
}

export function parseTranslationModelOutput(
  value: unknown,
  expected: {
    sourceLocale: SupportedTargetLocale
    targetLocale: SupportedTargetLocale
    itemIds: string[]
  },
): TranslationModelOutput {
  if (
    !isObject(value)
    || !exactKeys(value, ['schemaVersion', 'sourceLocale', 'targetLocale', 'items'])
    || value.schemaVersion !== TRANSLATION_SCHEMA_VERSION
    || value.sourceLocale !== expected.sourceLocale
    || value.targetLocale !== expected.targetLocale
    || !Array.isArray(value.items)
    || value.items.length !== expected.itemIds.length
  ) {
    throw new LocalizationError(
      'Translation output does not match the strict envelope schema',
      'translation_output_schema_invalid',
      true,
    )
  }

  const expectedIds = new Set(expected.itemIds)
  const seen = new Set<string>()
  const items: TranslationModelOutput['items'] = []
  for (const item of value.items) {
    if (
      !isObject(item)
      || !exactKeys(item, ['id', 'translatedText'])
      || typeof item.id !== 'string'
      || !MODEL_ITEM_ID.test(item.id)
      || !expectedIds.has(item.id)
      || seen.has(item.id)
      || typeof item.translatedText !== 'string'
      || item.translatedText.trim().length === 0
      || item.translatedText.length > 20_000
    ) {
      throw new LocalizationError(
        'Translation output contains an invalid or unexpected item',
        'translation_output_schema_invalid',
        true,
      )
    }
    seen.add(item.id)
    items.push({ id: item.id, translatedText: item.translatedText.trim() })
  }
  if (seen.size !== expectedIds.size) {
    throw new LocalizationError(
      'Translation output omitted required items',
      'translation_output_schema_invalid',
      true,
    )
  }
  return {
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
    sourceLocale: expected.sourceLocale,
    targetLocale: expected.targetLocale,
    items,
  }
}

