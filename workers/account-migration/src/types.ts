export type BucketAlias = 'snapshots' | 'releases' | 'backups'
export type ObjectMetadata = {
  http: Record<string, string>
  custom: Record<string, string>
}
export type Descriptor = { key: string; size: number; metadata: ObjectMetadata; metadataSha256: string }
export type CopyResult = Descriptor & {
  state: 'copied' | 'reused' | 'held' | 'error'
  code: string
  sha256: string | null
  receiptKey?: string
  receiptSha256?: string
}
export type MigrationObject = {
  key: string; size: number
  httpMetadata?: Record<string, string | Date | undefined>
  customMetadata?: Record<string, string>
}
export interface MigrationBucket {
  list(options: { limit: number; cursor?: string; include: string[] }): Promise<{
    objects: MigrationObject[]; truncated: boolean; cursor?: string
  }>
  get(key: string): Promise<(MigrationObject & { arrayBuffer(): Promise<ArrayBuffer> }) | null>
  put(key: string, value: ArrayBuffer | string, options: {
    onlyIf: { etagDoesNotMatch: string }
    httpMetadata?: Record<string, string | Date>
    customMetadata?: Record<string, string>
  }): Promise<unknown | null>
}
export type MigrationEnv = {
  MIGRATION_ROLE: 'source' | 'target'
  MIGRATION_ID: string
  MIGRATION_TRANSFER_TOKEN?: string
  SOURCE_FROZEN?: string
  SOURCE_URL?: string
  SOURCE_HOST?: string
  SNAPSHOTS_BUCKET: MigrationBucket
  RELEASES_BUCKET: MigrationBucket
  BACKUPS_BUCKET: MigrationBucket
}
