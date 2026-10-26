import { describe, expect, it } from 'vitest'
import { OFFLINE_TABLES, offlineHandoffSchema, type OfflineHandoff } from '../../workers/catalog-maintenance/src/offline-handoff-contract'
import { assertOfflineSuperset } from '../../workers/catalog-maintenance/src/offline-superset'
import { MaintenanceError } from '../../workers/catalog-maintenance/src/types'

const hash = 'a'.repeat(64), source = 'b'.repeat(64), snapshot = 'c'.repeat(64), stamp = '2026-10-25T07:00:00.000Z'
function fixture(): OfflineHandoff {
  const tableRows = Object.fromEntries(Object.keys(OFFLINE_TABLES).map(key => [key, []])) as unknown as OfflineHandoff['tableRows']
  tableRows.maintenance_sources.push({ source_id: source, url: 'https://example.edu.cn/catalog', allowed_hosts_json: '["example.edu.cn"]',
    category: 'undergraduate_catalog', categories_json: '["undergraduate_catalog"]', enabled: 1, interval_hours: 168, due_at: stamp,
    last_attempt_at: stamp, last_success_at: stamp, raw_sha256: null, canonical_sha256: null, snapshot_key: null, etag: null, failures: 0, error_code: null, discovery_depth: 0 })
  tableRows.maintenance_source_schools.push({ source_id: source, university_id: 'uni-first' }, { source_id: source, university_id: 'uni-second' })
  tableRows.maintenance_jobs.push({ job_id: 'old-job', source_id: source, stage: 'extract', status: 'held', priority: 0,
    due_at: stamp, created_at: stamp, updated_at: stamp, attempt: 1, lease_token: null, lease_until: null,
    snapshot_sha256: null, snapshot_key: null, error_code: 'unresolved_model', enqueued_at: null, target_ids_json: null })
  tableRows.maintenance_model_attempts.push({ reservation_key: hash, attempt_id: 'old-attempt', source_id: source, snapshot_sha256: snapshot,
    pass: 'primary', request_sha256: hash, model: 'MiniMax-M3', status: 'unknown', started_at: stamp, completed_at: null,
    output_key: null, output_sha256: null, usage_json: null, quota_json: '{}', error_code: 'request_unknown' })
  return offlineHandoffSchema.parse({ format: 'studyinchina.offline-maintenance-handoff', version: 1, batchId: 'same-offline-batch',
    scopeRegistrySha256: hash, inputCatalogSha256: hash, seedSha256: hash, legacyGuardSha256: hash,
    artifacts: [{ objectKey: `maintenance/frontiers/${hash}.json`, sha256: hash, byteLength: 20 }], tableRows,
    requestReservations: [{ reservationKey: hash, state: 'unknown', attemptId: 'old-attempt', requestSha256: hash, attemptCount: 1 }] })
}
function rejected(current: OfflineHandoff, prior: OfflineHandoff) {
  expect(() => assertOfflineSuperset(current, prior)).toThrow('offline_handoff_superset_invalid')
  try { assertOfflineSuperset(current, prior) } catch (error) {
    expect(error).toBeInstanceOf(MaintenanceError)
    expect((error as MaintenanceError).retryAfter).toBeNull()
  }
}

describe('offline batch immutable append-only continuation', () => {
  it('accepts exact retained history with reordered rows/keys and genuinely added evidence', () => {
    const prior = fixture(), current = structuredClone(prior)
    current.tableRows.maintenance_source_schools.reverse()
    current.tableRows.maintenance_source_schools.push({ source_id: source, university_id: 'uni-third' })
    current.tableRows.maintenance_sources.push({ ...current.tableRows.maintenance_sources[0], source_id: 'd'.repeat(64), url: 'https://example.edu.cn/next' })
    current.artifacts.unshift({ objectKey: `maintenance/frontiers/${snapshot}.json`, sha256: snapshot, byteLength: 10 })
    current.tableRows.maintenance_jobs.push({ ...current.tableRows.maintenance_jobs[0], job_id: 'new-job' })
    expect(offlineHandoffSchema.safeParse(current).success).toBe(true)
    const before = JSON.stringify(current)
    expect(() => assertOfflineSuperset(current, prior)).not.toThrow()
    expect(JSON.stringify(current)).toBe(before)
  })
  it('rejects changing any of the five immutable batch/scope/catalogue/history pins', () => {
    const prior = fixture()
    for (const key of ['batchId', 'scopeRegistrySha256', 'inputCatalogSha256', 'seedSha256', 'legacyGuardSha256'] as const) {
      const current = structuredClone(prior)
      current[key] = key === 'batchId' ? 'different-batch' : 'f'.repeat(64)
      rejected(current, prior)
    }
  })
  it('requires exact full old row values rather than larger row counts', () => {
    const prior = fixture(), current = structuredClone(prior)
    current.tableRows.maintenance_jobs[0].status = 'queued'
    current.tableRows.maintenance_jobs.push({ ...prior.tableRows.maintenance_jobs[0], job_id: 'added-job' })
    rejected(current, prior)
    const sourceChanged = structuredClone(prior)
    sourceChanged.tableRows.maintenance_sources[0].due_at = '2026-10-26T07:00:00.000Z'
    rejected(sourceChanged, prior)
  })
  it('preserves every composite primary-key row and rejects substituted or duplicate keys', () => {
    const prior = fixture(), current = structuredClone(prior)
    current.tableRows.maintenance_source_schools[1].university_id = 'uni-substitute'
    rejected(current, prior)
    const duplicate = structuredClone(prior)
    duplicate.tableRows.maintenance_source_schools.push({ ...duplicate.tableRows.maintenance_source_schools[0] })
    rejected(duplicate, prior)
  })
  it('retains every immutable artifact key, hash and size even if new artifacts replace the count', () => {
    const prior = fixture()
    for (const edit of ['remove', 'hash', 'size', 'key'] as const) {
      const current = structuredClone(prior)
      if (edit === 'remove') current.artifacts = []
      if (edit === 'hash') current.artifacts[0].sha256 = snapshot
      if (edit === 'size') current.artifacts[0].byteLength++
      if (edit === 'key') current.artifacts[0].objectKey = `maintenance/frontiers/${snapshot}.json`
      rejected(current, prior)
    }
  })
  it('never removes an unknown reservation or rewrites its attempt, outcome, retry or request metadata', () => {
    const prior = fixture()
    const edits: Array<(value: OfflineHandoff) => void> = [
      value => { value.requestReservations = [] },
      value => { value.requestReservations[0].state = 'completed' },
      value => { value.requestReservations[0].attemptId = 'new-attempt' },
      value => { value.requestReservations[0].requestSha256 = snapshot },
      value => { value.requestReservations[0].retryable = true },
      value => { value.requestReservations[0].attemptCount = 2 },
      value => { value.tableRows.maintenance_model_attempts[0].status = 'completed' },
    ]
    for (const edit of edits) { const current = structuredClone(prior); edit(current); rejected(current, prior) }
  })
})
