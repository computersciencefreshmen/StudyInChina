export type SqlValue = string | number | null
export type SqlRow = Record<string, SqlValue>

export interface D1Result<T = Record<string, unknown>> {
  success: boolean
  results?: T[]
  error?: string
  meta?: { changes?: number }
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
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
}

export interface QueueProducer<T> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>
}

export interface QueueMessage<T> {
  id: string
  body: T
  attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export interface QueueMessageBatch<T> {
  messages: Array<QueueMessage<T>>
}

export interface ScheduledControllerLike {
  scheduledTime: number
  cron: string
}

export type ReleaseQueueJob = {
  version: 1
  outboxEventId: string
  publicationJobId: string
  catalogReleaseId: string
  requestedAt: string
}

export type ReleaseFailure = {
  version: 1
  job: ReleaseQueueJob
  failedAt: string
  attempt: number
  code: string
  message: string
}

export interface ReleaseBuilderEnv {
  PIPELINE_DB: D1Database
  CATALOG_DB: D1Database
  RELEASE_ARTIFACTS: R2Bucket
  RELEASE_QUEUE: QueueProducer<ReleaseQueueJob>
  RELEASE_BUILDER_DLQ: QueueProducer<ReleaseFailure>
  SCHEDULE_BATCH_LIMIT?: string
  PIPELINE_PAGE_SIZE?: string
  CATALOG_WRITE_BATCH_SIZE?: string
  MAX_QUEUE_ATTEMPTS?: string
  EVENT_LEASE_SECONDS?: string
}

export type ReleaseCounts = {
  sources: number
  cities: number
  universities: number
  programs: number
  admissionCycles: number
  scholarships: number
}

export type ReleaseManifest = {
  releaseId: string
  dataVersion: number
  schemaVersion: 1
  dataDate: string
  generatedAt: string
  sourcePipelineRunId: string
  counts: ReleaseCounts
}

export const RELEASE_TABLES = [
  'catalog_records',
  'record_field_status',
  'source_summaries',
  'record_sources',
  'localized_content',
  'locations',
  'organizations',
  'institutions',
  'campuses',
  'academic_units',
  'programs',
  'disciplines',
  'program_disciplines',
  'languages',
  'program_teaching_languages',
  'program_cycles',
  'application_routes',
  'application_windows',
  'fee_items',
  'requirements',
  'required_documents',
  'scholarships',
  'scholarship_cycles',
  'scholarship_coverage_items',
  'scholarship_cycle_institutions',
  'scholarship_cycle_programs',
  'scholarship_cycle_degree_levels',
  'scholarship_cycle_disciplines',
  'scholarship_cycle_nationalities',
  'search_documents',
] as const

export type ReleaseTableName = (typeof RELEASE_TABLES)[number]

export type ReleaseArtifact = {
  format: 'studyinchina.catalog.release'
  formatVersion: 1
  manifest: ReleaseManifest
  tableDigests: Record<ReleaseTableName, string>
  tables: Record<ReleaseTableName, SqlRow[]>
}

export type BuildResult = {
  publicationJobId: string
  releaseId: string
  status: 'published' | 'already-published' | 'busy'
  contentSha256?: string
  artifactKey?: string
}
