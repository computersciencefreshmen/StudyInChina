import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { D1Database, D1PreparedStatement, D1Result, IngestionEnv, SourceManifestV1 } from '../src/types'
import { sourceManifest } from './fixtures'

type SqlValue = string | number | bigint | null | Uint8Array
class Statement implements D1PreparedStatement {
  constructor(private database: DatabaseSync, private sql: string, private values: SqlValue[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.database, this.sql, values as SqlValue[]) }
  async first<T>() { return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: this.database.prepare(this.sql).all(...this.values) as T[] } }
  async run<T>(): Promise<D1Result<T>> { return { success: true, meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } } }
}
class SqliteD1 implements D1Database {
  constructor(private database: DatabaseSync) {}
  prepare(sql: string) { return new Statement(this.database, sql) }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.database.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run<T>())
      this.database.exec('COMMIT')
      return results
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
export const NOW = '2026-09-16T00:00:00.000Z'
export function discoveryDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const name of ['0001_domain', '0002_evidence_workflow', '0003_indexes_guards', '0004_worker_runtime', '0005_domain_throttle', '0006_candidate_provenance_promotion', '0007_snapshot_derivatives', '0008_release_builder_contract', '0009_entity_discovery_registry', '0018_source_revalidation_observations']) {
    database.exec(readFileSync(resolve(`infra/d1/pipeline/migrations/${name}.sql`), 'utf8'))
  }
  return database
}
export function discoveryEnvironment(database: DatabaseSync): IngestionEnv {
  return {
    INGESTION_DB: new SqliteD1(database),
    SNAPSHOTS_BUCKET: { async get() { return null }, async head() { return null }, async put() { return {} }, async delete() {} },
    INGESTION_QUEUE: { async send() {} }, INGESTION_DLQ: { async send() {} }, QUARANTINE_QUEUE: { async send() {} },
  }
}
export function seedDiscoveryInstitution(database: DatabaseSync, id = 'example-university') {
  database.prepare(`INSERT OR IGNORE INTO records (id, public_id, kind, slug) VALUES ('example-city','example-city','location','example-city'), (?,?,'organization',?)`).run(id, id, id)
  database.exec(`INSERT OR IGNORE INTO locations (record_id, location_type, country_code) VALUES ('example-city','city','CN')`)
  database.prepare(`INSERT OR IGNORE INTO organizations (record_id, organization_type, official_url) VALUES (?,'university','https://admissions.example.edu.cn')`).run(id)
  database.prepare(`INSERT OR IGNORE INTO institutions (record_id, city_id, institution_type, admissions_url) VALUES (?,'example-city','comprehensive','https://admissions.example.edu.cn')`).run(id)
}
export function seedDiscoverySource(database: DatabaseSync, overrides: Partial<SourceManifestV1> = {}) {
  const manifest = sourceManifest({
    sourceCategory: 'catalog_anchor',
    extraction: { mode: 'rules-only', schemaVersion: 'page-v1', fields: [{ path: 'title', type: 'string' }], rules: [{ kind: 'regex', fieldPath: 'title', pattern: '<title>([^<]+)</title>' }] },
    ...overrides,
  })
  seedDiscoveryInstitution(database, manifest.institutionId)
  database.prepare(`INSERT INTO ingestion_sources (source_id, manifest_json, enabled, next_fetch_at, created_at, updated_at) VALUES (?,?,?,NULL,?,?)`).run(manifest.id, JSON.stringify(manifest), manifest.enabled ? 1 : 0, NOW, NOW)
  return manifest
}
export function seedDiscoverySnapshot(database: DatabaseSync, manifest: SourceManifestV1) {
  const snapshotId = `snapshot-${manifest.id}`
  database.prepare(`INSERT INTO ingestion_snapshots (snapshot_id, source_id, r2_key, raw_sha256, canonical_sha256, content_type, byte_length, final_url, fetched_at) VALUES (?,?,? ,?,?,'text/html',100,?,?)`).run(snapshotId,manifest.id,`raw/${manifest.id}`, 'a'.repeat(64), 'b'.repeat(64), manifest.officialUrl, NOW)
  return snapshotId
}
export function seedDiscovery(database: DatabaseSync, manifest: SourceManifestV1, snapshotId: string, id: string, url = `https://admissions.example.edu.cn/${id}`, role = 'program_detail') {
  const hash = Buffer.from(id).toString('hex').slice(0,64).padEnd(64,'0')
  database.prepare(`INSERT INTO source_discoveries (discovery_id,institution_id,discovered_from_source_id,discovered_from_snapshot_id,canonical_url,url_sha256,source_role,link_text,discovery_status,discovered_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Official program','discovered',?,?,?,?)`).run(id,manifest.institutionId,manifest.id,snapshotId,url,hash,role,NOW,NOW,NOW,NOW)
}