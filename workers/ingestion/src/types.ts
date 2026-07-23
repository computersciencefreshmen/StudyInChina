export const INGESTION_SERVICE_VERSION = '1.0.0'

export type SourceEntityType =
  | 'university'
  | 'program'
  | 'program-cycle'
  | 'scholarship'
  | 'scholarship-cycle'

export type SourceCategory =
  | 'international_admissions_home'
  | 'undergraduate_catalog'
  | 'masters_catalog'
  | 'doctoral_catalog'
  | 'non_degree_catalog'
  | 'current_guide'
  | 'dates_deadlines'
  | 'fees'
  | 'eligibility_language'
  | 'application_portal'
  | 'university_scholarship'
  | 'faculty_scholarship'
  | 'government_scholarship'
  | 'program_detail'
  | 'contacts'
  | 'catalog_anchor'

export type FieldValueType =
  | 'string'
  | 'number'
  | 'money'
  | 'boolean'
  | 'date'
  | 'string-array'
  | 'object'

export type ExtractionField = {
  path: string
  type: FieldValueType
  required?: boolean
  nullable?: boolean
  critical?: boolean
}

export type RegexExtractionRule = {
  kind: 'regex'
  fieldPath: string
  pattern: string
  flags?: string
  captureGroup?: number
}

export type JsonPointerExtractionRule = {
  kind: 'json-pointer'
  fieldPath: string
  pointer: string
}

export type ExtractionRule = RegexExtractionRule | JsonPointerExtractionRule

export type SourceManifestV1 = {
  version: 1
  id: string
  institutionId: string
  entityType: SourceEntityType
  sourceCategory: SourceCategory
  officialUrl: string
  allowedHosts: string[]
  allowedRedirectHosts?: string[]
  enabled: boolean
  schedule: {
    intervalHours: number
    jitterMinutes?: number
  }
  fetch: {
    timeoutMs?: number
    maxBytes?: number
    accept?: string
    renderMode?: 'http' | 'browser'
    browserWaitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
    browserWaitForSelector?: string
    documentConversion?: 'auto' | 'disabled'
  }
  robots: {
    mode: 'enforce' | 'blocked'
  }
  canonicalization?: {
    ignorePatterns?: string[]
    collapseWhitespace?: boolean
  }
  extraction: {
    mode: 'rules-only' | 'rules-then-minimax' | 'minimax'
    schemaVersion: string
    fields: ExtractionField[]
    rules?: ExtractionRule[]
    minimaxModel?: string
  }
}

export type SourceState = {
  manifest: SourceManifestV1
  etag: string | null
  lastModified: string | null
  rawSha256: string | null
  canonicalSha256: string | null
  nextFetchAt: string | null
  consecutiveFailures: number
}

export type IngestionJob = {
  version: 1
  jobId: string
  sourceId: string
  reason: 'scheduled' | 'discovery' | 'manual' | 'retry'
  scheduledAt: string
}

export type IngestionFailure = {
  version: 1
  failureId: string
  job: IngestionJob
  failedAt: string
  attempt: number
  code: string
  message: string
  retryable: boolean
}

export type Evidence = {
  quote: string
  locator?: string
}

export type ExtractionFact = {
  fieldPath: string
  value: unknown
  evidence: Evidence
}

export type ExtractionEnvelope = {
  schemaVersion: string
  sourceId: string
  facts: ExtractionFact[]
}

export type CandidateFieldEvidence = {
  fieldPath: string
  primary: Evidence
  secondary: Evidence | null
}

export type CandidateProvenance = {
  schemaVersion: string
  model: string | null
  promptFingerprint: string | null
  extractorFingerprint: string
  primaryExtraction: ExtractionEnvelope | null
  secondaryExtraction: ExtractionEnvelope | null
  fieldEvidence: CandidateFieldEvidence[]
  containsCritical: boolean
}

export type ExtractionCandidate = {
  candidateId: string
  sourceId: string
  snapshotId: string
  extractor: 'rules' | 'minimax-dual'
  gateStatus: 'rule-pass' | 'dual-pass' | 'quarantined'
  facts: ExtractionFact[]
  issues: string[]
  provenance: CandidateProvenance
  createdAt: string
}

export type ExtractedEntityCandidate = {
  candidateId: string
  discoveryId: string
  registryId: string
  reconciliationId: string
  institutionId: string
  entityType: 'program' | 'scholarship'
  entityKey: string
  sourceId: string
  snapshotId: string
  ingestionJobId: string
  extractor: string
  officialUrl: string
  urlSha256: string
  identitySha256: string
  entitySha256: string
  facts: Record<string, unknown>
  evidence: Array<{
    fieldPath: string
    quote: string
    locator: string | null
    officialUrl: string
  }>
  createdAt: string
}

export type QuarantineTask = {
  version: 1
  quarantineId: string
  sourceId: string
  snapshotId: string
  snapshotKey: string
  sourceUrl: string
  previousCanonicalSha256: string | null
  canonicalSha256: string
  reason: string
  issues: string[]
  createdAt: string
}

export type SnapshotRecord = {
  snapshotId: string
  sourceId: string
  r2Key: string
  rawSha256: string
  canonicalSha256: string
  contentType: string
  byteLength: number
  finalUrl: string
  fetchedAt: string
  etag: string | null
  lastModified: string | null
  derivative?: {
    kind: 'document_text'
    r2Key: string
    contentSha256: string
    contentType: 'text/plain; charset=utf-8'
    byteLength: number
  }
}

export interface D1Result<T = Record<string, unknown>> {
  success: boolean
  results?: T[]
  error?: string
  meta?: {
    changes?: number
    duration?: number
    rows_read?: number
    rows_written?: number
  }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<Array<D1Result<T>>>
}

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>
  customMetadata?: Record<string, string>
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  head(key: string): Promise<unknown | null>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
  delete(key: string): Promise<void>
}

export interface QueueProducer<T> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>
  sendBatch?(
    messages: Array<{ body: T; delaySeconds?: number }>,
  ): Promise<void>
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

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
  noRetry?(): void
}

export interface IngestionEnv {
  INGESTION_DB: D1Database
  SNAPSHOTS_BUCKET: R2Bucket
  INGESTION_QUEUE: QueueProducer<IngestionJob>
  INGESTION_DLQ: QueueProducer<IngestionFailure>
  QUARANTINE_QUEUE: QueueProducer<QuarantineTask>
  BROWSER?: import('./rich-content').BrowserRunBinding
  AI?: import('./rich-content').WorkersAiBinding
  INGESTION_ADMIN_TOKEN?: string
  USER_AGENT?: string
  SCHEDULE_BATCH_LIMIT?: string
  MAX_QUEUE_ATTEMPTS?: string
  DEFAULT_FETCH_TIMEOUT_MS?: string
  DEFAULT_MAX_BYTES?: string
  MINIMAX_API_URL?: string
  MINIMAX_API_KEY?: string
  MINIMAX_MODEL?: string
  MINIMAX_TIMEOUT_MS?: string
  MINIMAX_MAX_INPUT_CHARS?: string
  MINIMAX_MAX_OUTPUT_TOKENS?: string
  INFRA_FORECAST_CNY?: string
  DOCUMENT_CONVERSION_TIMEOUT_MS?: string
  DOCUMENT_MAX_TEXT_CHARACTERS?: string
}

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>
