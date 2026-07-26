export const LOCALIZATION_SERVICE_VERSION = '1.0.0'
export const TRANSLATION_SCHEMA_VERSION = 'studyinchina.translation.v1'
export const TRANSLATION_PROMPT_VERSION = 'studyinchina-translation-v1'

export const CORE_TARGET_LOCALES = ['zh', 'en', 'ru'] as const
export const RESERVED_TARGET_LOCALES = ['de', 'es', 'fr', 'ar', 'pt'] as const
export const SUPPORTED_TARGET_LOCALES = [
  ...CORE_TARGET_LOCALES,
  ...RESERVED_TARGET_LOCALES,
] as const

export type SupportedTargetLocale = typeof SUPPORTED_TARGET_LOCALES[number]
export type TranslationStatus = 'machine_generated'
export type LegacyLocalizedContentStatus = 'draft' | 'machine' | 'reviewed' | 'published'

export const STABLE_LOCALIZED_FIELDS = [
  'name',
  'summary',
  'overview',
  'description',
  'faculty',
  'qualification',
  'languagePolicy',
  'curriculumHighlights',
  'eligibility',
  'applicationMaterials',
  'campus',
  'province',
  'climate',
  'foodHighlights',
  'sights',
] as const

export type StableLocalizedField = typeof STABLE_LOCALIZED_FIELDS[number]

export const TRANSLATABLE_RECORD_KINDS = [
  'organization',
  'location',
  'campus',
  'academic_unit',
  'program',
  'scholarship',
] as const

export type TranslatableRecordKind = typeof TRANSLATABLE_RECORD_KINDS[number]

export type TranslationBatchRequest = {
  targetLocales: SupportedTargetLocale[]
  institutionIds: string[]
  recordKinds: TranslatableRecordKind[]
  limit: number
  dryRun: boolean
}

export type SourceCandidate = {
  recordId: string
  recordPublicId: string
  recordKind: TranslatableRecordKind
  institutionId: string | null
  fieldName: StableLocalizedField
  sourceLocale: SupportedTargetLocale
  sourceText: string
  targetLocale: SupportedTargetLocale
  targetStatus: LegacyLocalizedContentStatus | null
  targetSourceSha256: string | null
}

export type TranslationPlan = SourceCandidate & {
  sourceSha256: string
  cacheKey: string
  jobId: string
  model: string
  promptVersion: string
}

export type TranslationJob = TranslationPlan & {
  batchId: string
  status:
    | 'queued'
    | 'running'
    | 'cached'
    | 'succeeded'
    | 'deferred'
    | 'failed'
    | 'stale'
    | 'cancelled'
  attempts: number
}

export type TranslationCacheEntry = {
  cacheKey: string
  sourceSha256: string
  sourceLocale: SupportedTargetLocale
  targetLocale: SupportedTargetLocale
  recordKind: TranslatableRecordKind
  fieldName: StableLocalizedField
  model: string
  promptVersion: string
  translatedText: string
  translatedSha256: string
  translationStatus: TranslationStatus
}

export type TranslationQueueBatch = {
  version: 1
  batchId: string
  jobIds: string[]
  queuedAt: string
}

export type TranslationModelItem = {
  id: string
  fieldName: StableLocalizedField
  sourceText: string
}

export type TranslationModelOutput = {
  schemaVersion: typeof TRANSLATION_SCHEMA_VERSION
  sourceLocale: SupportedTargetLocale
  targetLocale: SupportedTargetLocale
  items: Array<{
    id: string
    translatedText: string
  }>
}

export type TranslationUsage = {
  monthKey: string
  apiCalls: number
  inputCharacters: number
  outputCharacters: number
  translatedItems: number
  cacheHits: number
}

export type TranslationLimits = {
  enabled: boolean
  batchItems: number
  batchCharacters: number
  scheduleItems: number
  maxAttempts: number
  monthlyApiCalls: number
  monthlyInputCharacters: number
  timeoutMs: number
  maxOutputTokens: number
}

export interface D1Result<T = Record<string, unknown>> {
  success: boolean
  results?: T[]
  meta?: { changes?: number }
  error?: string
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<Array<D1Result<T>>>
}

export interface QueueProducer<T> {
  send(message: T, options?: { delaySeconds?: number }): Promise<void>
}

export interface QueueMessage<T> {
  id: string
  body: T
  attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export interface QueueMessageBatch<T> {
  queue: string
  messages: Array<QueueMessage<T>>
}

export interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
  noRetry?(): void
}

export interface LocalizationEnv {
  PIPELINE_DB: D1Database
  LOCALIZATION_QUEUE: QueueProducer<TranslationQueueBatch>
  LOCALIZATION_ADMIN_TOKEN?: string
  MINIMAX_API_URL?: string
  MINIMAX_API_KEY?: string
  MINIMAX_MODEL?: string
  MINIMAX_TIMEOUT_MS?: string
  MINIMAX_MAX_OUTPUT_TOKENS?: string
  TRANSLATION_ENABLED?: string
  TRANSLATION_BATCH_ITEMS?: string
  TRANSLATION_BATCH_CHARACTERS?: string
  TRANSLATION_SCHEDULE_ITEMS?: string
  TRANSLATION_MAX_ATTEMPTS?: string
  TRANSLATION_MONTHLY_API_CALLS?: string
  TRANSLATION_MONTHLY_INPUT_CHARACTERS?: string
  TRANSLATION_DEFAULT_TARGETS?: string
}

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type BatchPlanResult = {
  runId: string
  dryRun: boolean
  plannedJobs: number
  queuedBatches: number
  skippedCurrent: number
  cacheEligible: number
}

