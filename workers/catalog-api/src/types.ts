export type D1Result<T = Record<string, unknown>> = {
  success: boolean
  results?: T[]
  error?: string
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement
}

export interface R2ObjectBody {
  body: ReadableStream<Uint8Array> | null
  size?: number
  text?(): Promise<string>
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
}

export type CatalogApiEnv = {
  CATALOG_DB: D1Database
  RELEASES_BUCKET: R2Bucket
  CATALOG_API_TOKEN?: string
}

export type ActiveReleaseRow = {
  release_id: string
  data_date: string
  generated_at: string
  counts_json: string
  content_sha256: string
  compatibility_artifact_key: string | null
  compatibility_content_sha256: string | null
  compatibility_byte_length: number | null
}
