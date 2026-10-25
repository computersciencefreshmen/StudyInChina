import type { D1Database, QueueMessageBatch, QueueProducer } from '../../publisher/src/types'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'

export type MaintenanceMessage = { version: 1; jobId: string;seedSha256?:string;targetRefreshSha256?:string;bootstrapUploadSha256?:string;bootstrapSeedSha256?:string;discoveryManifestSha256?:string;discoveryOffset?:number;offlineHandoffBatchId?:string;offlineHandoffSha256?:string }
export type MaintenanceBatch = QueueMessageBatch<MaintenanceMessage>
export interface BucketObject { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; size?: number;etag?:string }
export interface Bucket {
  get(key: string): Promise<BucketObject | null>
  put(key: string, body: string | ArrayBuffer | Uint8Array|ReadableStream<Uint8Array>, options?: { onlyIf?: { etagDoesNotMatch?: string;etagMatches?:string }; httpMetadata?: { contentType?: string } }): Promise<unknown>
}
export interface DurableStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  transaction<T>(body: (txn: DurableStorage) => Promise<T>): Promise<T>
}
export interface DurableState { storage: DurableStorage }
export interface DurableNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
export type MaintenanceEnv = {
  PIPELINE_DB: D1Database; SNAPSHOTS_BUCKET: Bucket;
  MAINTENANCE_QUEUE: QueueProducer<MaintenanceMessage>; MODEL_ADMISSION: DurableNamespace;
  MAINTENANCE_ADMIN_TOKEN?: string; MINIMAX_SUBSCRIPTION_KEY?: string;
  MAINTENANCE_ENABLED?: string; MINIMAX_MODEL?: string; MINIMAX_ANTHROPIC_BASE?: string;
  SCOPE_REGISTRY_SHA256?: string; MINIMAX_CREDIT_FALLBACK_DISABLED?: string;
  USER_AGENT?: string; FETCH_CONCURRENCY?: string; MODEL_CONCURRENCY?: string;
}
export type Control = {
  singleton: number; scope_sha256: string; input_catalog_sha256: string; seed_sha256: string;
  legacy_guard_sha256: string; enabled: number; models_enabled: number; seed_complete: number; targets_complete:number;canary_json:string; revision: number; updated_at: string
  seed_offset:number;seed_total:number;seed_plan_sha256:string|null
}
export type SourceRow = {
  source_id: string; url: string; allowed_hosts_json: string; category: string;
  categories_json?:string
  enabled: number; interval_hours: number; due_at: string; last_attempt_at: string | null;
  last_success_at: string | null; raw_sha256: string | null; canonical_sha256: string | null;
  snapshot_key: string | null; etag: string | null; failures: number; error_code: string | null
  discovery_depth:number
}
export type JobRow = {
  job_id: string; source_id: string; stage: 'capture' | 'extract' | 'award' | 'maintain';
  status: 'queued' | 'running' | 'retry' | 'done' | 'held' | 'unknown';
  priority: number; due_at: string; created_at: string; updated_at: string; attempt: number;
  lease_token: string | null; lease_until: string | null;
  snapshot_sha256: string | null; snapshot_key: string | null; error_code: string | null
  target_ids_json:string|null
}
export type SchoolRow = { university_id: string; name_json: string; seed_json: string }
export type RecordTarget = MaintenanceRecordTarget
export type LegacyGuard = {
  id: string; universityId: string | null; sourceId: string | null; recordId: string | null;
  fields: string[] | '*'; state: 'stop' | 'unknown' | 'consumed'; artifactSha256: string; reason: string
  snapshotSha256?:string|null
}
export type ModelRequest = {
  reservationKey: string; sourceId: string; universityIds: string[]; snapshotSha256: string;
  pass: 'primary' | 'independent-review'; payload: string; lane: 'maintenance' | 'expansion'; recordIds?: string[]
}
export type ModelResult = {
  attemptId: string; output: unknown; artifactKey: string; artifactSha256: string; reused: boolean
}
export class MaintenanceError extends Error {
  constructor(readonly code: string, readonly retryAfter: number | null = null) { super(code) }
}
