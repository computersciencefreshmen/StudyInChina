import {
  CORE_TARGET_LOCALES,
  SUPPORTED_TARGET_LOCALES,
  type LocalizationEnv,
  type SupportedTargetLocale,
  type TranslationLimits,
} from './types'

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

export function translationLimits(environment: LocalizationEnv): TranslationLimits {
  return {
    enabled: !['0', 'false', 'off'].includes(
      (environment.TRANSLATION_ENABLED ?? 'true').trim().toLowerCase(),
    ),
    batchItems: boundedInteger(environment.TRANSLATION_BATCH_ITEMS, 20, 1, 50),
    batchCharacters: boundedInteger(
      environment.TRANSLATION_BATCH_CHARACTERS,
      30_000,
      1_000,
      100_000,
    ),
    scheduleItems: boundedInteger(environment.TRANSLATION_SCHEDULE_ITEMS, 120, 1, 1_000),
    maxAttempts: boundedInteger(environment.TRANSLATION_MAX_ATTEMPTS, 4, 1, 10),
    monthlyApiCalls: boundedInteger(
      environment.TRANSLATION_MONTHLY_API_CALLS,
      20_000,
      1,
      1_000_000,
    ),
    monthlyInputCharacters: boundedInteger(
      environment.TRANSLATION_MONTHLY_INPUT_CHARACTERS,
      100_000_000,
      10_000,
      2_000_000_000,
    ),
    timeoutMs: boundedInteger(environment.MINIMAX_TIMEOUT_MS, 30_000, 5_000, 60_000),
    maxOutputTokens: boundedInteger(
      environment.MINIMAX_MAX_OUTPUT_TOKENS,
      8_192,
      256,
      16_384,
    ),
  }
}

export function configuredTargetLocales(environment: LocalizationEnv): SupportedTargetLocale[] {
  const raw = environment.TRANSLATION_DEFAULT_TARGETS
  if (!raw?.trim()) return [...CORE_TARGET_LOCALES]
  const supported = new Set<string>(SUPPORTED_TARGET_LOCALES)
  const values = [...new Set(
    raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  )]
  return values.length > 0 && values.every((value) => supported.has(value))
    ? values as SupportedTargetLocale[]
    : [...CORE_TARGET_LOCALES]
}

