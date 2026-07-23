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

export interface QueueProducer<T> {
  send(body: T, options?: { delaySeconds?: number }): Promise<void>
}

export type PromotionJob = {
  version: 1
  candidateId: string
  requestedAt: string
}

export type PromotionFailure = {
  version: 1
  job: PromotionJob
  failedAt: string
  attempt: number
  code: string
  message: string
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

export interface PublisherEnv {
  PIPELINE_DB: D1Database
  PROMOTION_QUEUE: QueueProducer<PromotionJob>
  PUBLISHER_DLQ: QueueProducer<PromotionFailure>
  SCHEDULE_BATCH_LIMIT?: string
  MAX_QUEUE_ATTEMPTS?: string
}

export type PromotionResult = {
  candidateId: string
  status: 'applied' | 'already-applied' | 'quarantined' | 'busy'
  publicationJobId?: string
  reasonCode?: string
}
