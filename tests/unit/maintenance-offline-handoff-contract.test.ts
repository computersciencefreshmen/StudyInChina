import { mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SqliteD1 } from '../../scripts/maintenance/local-runtime'
import { OFFLINE_TABLES, offlineArtifactKeySchema, offlineHandoffSchema, type OfflineHandoff } from '../../workers/catalog-maintenance/src/offline-handoff-contract'

const hash = 'a'.repeat(64), source = 'b'.repeat(64), snapshot = 'c'.repeat(64), stamp = '2026-10-25T00:00:00.000Z'
function fixture(): OfflineHandoff {
  const rows = Object.fromEntries(Object.keys(OFFLINE_TABLES).map(table => [table, []])) as unknown as OfflineHandoff['tableRows']
  rows.maintenance_sources.push({ source_id: source, url: 'https://example.edu.cn/catalog', allowed_hosts_json: '["example.edu.cn"]',
    category: 'undergraduate_catalog', categories_json: '["undergraduate_catalog"]', enabled: 1, interval_hours: 168, due_at: stamp,
    last_attempt_at: stamp, last_success_at: stamp, raw_sha256: null, canonical_sha256: null, snapshot_key: null, etag: null, failures: 0, error_code: null, discovery_depth: 0 })
  rows.maintenance_source_schools.push({ source_id: source, university_id: 'uni-fixture' })
  rows.maintenance_model_attempts.push({ reservation_key: hash, attempt_id: 'attempt-one', source_id: source, snapshot_sha256: snapshot,
    pass: 'primary', request_sha256: hash, model: 'MiniMax-M3', status: 'send_started', started_at: stamp, completed_at: null,
    output_key: null, output_sha256: null, usage_json: null, quota_json: '{}', error_code: null })
  return { format: 'studyinchina.offline-maintenance-handoff', version: 1, batchId: 'offline-fixture', scopeRegistrySha256: hash,
    inputCatalogSha256: hash, seedSha256: hash, legacyGuardSha256: hash, artifacts: [], tableRows: rows,
    requestReservations: [{ reservationKey: hash, state: 'send_started', attemptId: 'attempt-one', requestSha256: hash, attemptCount: 1 }] }
}

describe('offline handoff strict data boundary', () => {
  it('pins every allowed full column list and primary key to the actual production migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'maintenance-handoff-contract-')), db = new SqliteD1(join(root, 'pipeline.sqlite'))
    try {
      for (const [table, spec] of Object.entries(OFFLINE_TABLES)) {
        const columns = db.sqlite.prepare(`PRAGMA table_info(${table})`).all()
        expect(columns.map(column => column.name)).toEqual([...spec.columns])
        expect(columns.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => column.name)).toEqual([...spec.primaryKeys])
      }
    } finally {
      db.close()
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('maintenance-handoff-contract-')) throw new Error('Unexpected cleanup target')
      await rm(root, { recursive: true, force: true })
    }
  })
  it('preserves unresolved attempts as durable no-replay reservations rather than inventing completed results', () => {
    const input = fixture()
    expect(offlineHandoffSchema.safeParse(input).success).toBe(true)
    input.requestReservations[0].state = 'unknown'
    expect(offlineHandoffSchema.safeParse(input).success).toBe(true)
    input.requestReservations[0].retryable = true
    expect(offlineHandoffSchema.safeParse(input).success).toBe(false)
  })
  it('rejects control tables, arbitrary SQL, unknown columns and incomplete rows', () => {
    const base = fixture()
    for (const input of [
      { ...base, sql: 'DROP TABLE maintenance_control' },
      { ...base, tableRows: { ...base.tableRows, maintenance_control: [] } },
      { ...base, tableRows: { ...base.tableRows, maintenance_sources: [{ ...base.tableRows.maintenance_sources[0], modelEnabled: 1 }] } },
      { ...base, tableRows: { ...base.tableRows, maintenance_sources: [{ source_id: source }] } },
    ]) expect(offlineHandoffSchema.safeParse(input).success).toBe(false)
  })
  it('rejects missing, duplicate, stale-attempt and altered-scope reservation metadata', () => {
    const missing = fixture(); missing.requestReservations = []; expect(offlineHandoffSchema.safeParse(missing).success).toBe(false)
    const duplicate = fixture(); duplicate.requestReservations.push(duplicate.requestReservations[0]); expect(offlineHandoffSchema.safeParse(duplicate).success).toBe(false)
    const changed = fixture(); changed.requestReservations[0].requestSha256 = 'd'.repeat(64); expect(offlineHandoffSchema.safeParse(changed).success).toBe(false)
    const newer = fixture(); newer.tableRows.maintenance_model_attempts.push({ ...newer.tableRows.maintenance_model_attempts[0], attempt_id: 'attempt-two', started_at: '2026-10-25T00:01:00.000Z' })
    expect(offlineHandoffSchema.safeParse(newer).success).toBe(false)
    const sourceMismatch = fixture(); sourceMismatch.tableRows.maintenance_model_attempts[0].source_id = 'e'.repeat(64)
    expect(offlineHandoffSchema.safeParse(sourceMismatch).success).toBe(false)
  })
  it('requires a completed immutable output and matching artifact checksum before accepting completed cache state', () => {
    const input = fixture(), attempt = input.tableRows.maintenance_model_attempts[0], objectKey = `maintenance/models/${hash}/${hash}.json`
    attempt.status = 'completed'; attempt.completed_at = stamp; attempt.output_key = objectKey; attempt.output_sha256 = hash
    input.requestReservations[0].state = 'completed'
    expect(offlineHandoffSchema.safeParse(input).success).toBe(false)
    input.artifacts.push({ objectKey, sha256: hash, byteLength: 100 })
    expect(offlineHandoffSchema.safeParse(input).success).toBe(true)
    input.artifacts[0].sha256 = 'f'.repeat(64)
    expect(offlineHandoffSchema.safeParse(input).success).toBe(false)
  })
  it('allows only safe evidence/cache artifact namespaces and bounds artifact bytes', () => {
    for (const objectKey of [`maintenance/frontiers/${hash}.json`, `maintenance/frontier-checkpoints/${hash}/5.json`, `maintenance/discovery-lineage/${source}.json`, `maintenance/extraction-cache/catalog/${hash}.json`]) expect(offlineArtifactKeySchema.safeParse(objectKey).success).toBe(true)
    for (const objectKey of ['maintenance/runtime/control.json', 'maintenance/bootstrap/raw.json', 'maintenance/offline-handoffs/override.json', 'maintenance/models/../../control.json']) expect(offlineArtifactKeySchema.safeParse(objectKey).success).toBe(false)
    const input = fixture(); input.artifacts.push({ objectKey: `maintenance/frontiers/${hash}.json`, sha256: hash, byteLength: 10 * 1024 * 1024 + 1 })
    expect(offlineHandoffSchema.safeParse(input).success).toBe(false)
  })
})
