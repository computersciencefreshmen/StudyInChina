import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { withAutomationHeartbeat } from '../../workers/shared/automation-heartbeat'
import { buildCatalogSeeds, readCatalogBundle } from '../../scripts/automation/build-catalog-seeds'

function heartbeatFixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE automation_service_runs (service_name TEXT PRIMARY KEY, last_started_at TEXT, last_succeeded_at TEXT, last_error_code TEXT, updated_at TEXT)')
  const database = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ run: async () => sqlite.prepare(sql).run(...values as (string | number | null)[]) }) }) }
  return { sqlite, database }
}

describe('durable automation heartbeat', () => {
  it('records a success only after the callback finishes', async () => {
    const { sqlite, database } = heartbeatFixture()
    try {
      expect(await withAutomationHeartbeat(database, 'ingestion', async () => {
        expect(sqlite.prepare('SELECT last_succeeded_at FROM automation_service_runs').get()?.last_succeeded_at).toBeNull()
        return 42
      })).toBe(42)
      expect(sqlite.prepare('SELECT last_succeeded_at FROM automation_service_runs').get()?.last_succeeded_at).toBeTruthy()
    } finally { sqlite.close() }
  })
  it('preserves the last success and sanitizes failure details', async () => {
    const { sqlite, database } = heartbeatFixture()
    try {
      await withAutomationHeartbeat(database, 'publisher', async () => undefined)
      const failure = Object.assign(new Error('Bearer secret'), { code: 'token=secret' })
      await expect(withAutomationHeartbeat(database, 'publisher', async () => { throw failure })).rejects.toBe(failure)
      const state = sqlite.prepare('SELECT * FROM automation_service_runs').get()
      expect(state?.last_succeeded_at).toBeTruthy()
      expect(state?.last_error_code).toBe('scheduler_failed')
      expect(JSON.stringify(state)).not.toContain('secret')
    } finally { sqlite.close() }
  })
  it('does not let an older run erase a newer failure', async () => {
    const { sqlite, database } = heartbeatFixture()
    try {
      await withAutomationHeartbeat(database, 'ingestion', async () => {
        await expect(withAutomationHeartbeat(database, 'ingestion', async () => { throw Object.assign(new Error('failed'), { code: 'queue_down' }) }, () => new Date('2026-09-16T00:01:00Z'))).rejects.toThrow()
      }, () => new Date('2026-09-16T00:00:00Z'))
      const state = sqlite.prepare('SELECT * FROM automation_service_runs').get()
      expect(state?.last_error_code).toBe('queue_down')
      expect(state?.last_succeeded_at).toBeNull()
    } finally { sqlite.close() }
  })
})

describe('automatic official seed enrollment', () => {
  const original = readCatalogBundle('content/data')
  it('covers known institutions without mutating any evidence timestamps', () => {
    const before = JSON.stringify(original)
    const result = buildCatalogSeeds(original)
    expect(result.summary.institutions).toBe(original.universities.filter(row => row.status !== 'draft').length)
    expect(result.summary.sources).toBeGreaterThan(1000)
    expect(JSON.stringify(original)).toBe(before)
    expect(/\bDELETE\b|\bcanonical_fields\b|\bverifiedAt\b/.test(result.sql)).toBe(false)
  })
  it('rejects local targets and untrusted source references', () => {
    const bundle = structuredClone(original)
    const school = bundle.universities[0]
    school.officialUrl = 'https://127.0.0.1/admin'
    school.admissionsUrl = 'http://localhost/private'
    bundle.sources.push({ ...bundle.sources[0], id: 'not-official', url: 'https://attacker.example/', official: false })
    school.sourceIds.push('not-official')
    const result = buildCatalogSeeds(bundle)
    expect(result.excluded.length).toBeGreaterThanOrEqual(2)
    expect(result.manifests.some(row => /localhost|127\.0\.0\.1|attacker\.example/.test(row.officialUrl))).toBe(false)
  })
  it('does not recursively attribute shared third-party official pages to a university', () => {
    const result = buildCatalogSeeds(original)
    expect(result.manifests.filter(row => new URL(row.officialUrl).hostname.endsWith('chinese.cn')).every(row => row.sourceCategory === 'contacts')).toBe(true)
    expect(result.summary.captureOnly).toBeGreaterThan(0)
  })
  it('upgrades only an exact active v1 seed once without rescheduling an already-v2 seed', () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec('CREATE TABLE ingestion_sources(source_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,enabled INTEGER,next_fetch_at TEXT,created_at TEXT,updated_at TEXT)')
      const bundle = { ...original, universities: original.universities.slice(0, 1) }
      const generatedAt = '2026-09-16T10:00:00.000Z'
      const result = buildCatalogSeeds(bundle, generatedAt)
      const current = result.manifests[0]
      const legacy = structuredClone(current)
      legacy.extraction.schemaVersion = 'auto-seed-v1'
      legacy.extraction.fields[0].required = true
      sqlite.prepare('INSERT INTO ingestion_sources VALUES(?,?,?,?,?,?)').run(current.id, JSON.stringify(legacy), 1, '2026-09-20', '2026-09-01', '2026-09-01')
      sqlite.exec(result.sql)
      const upgraded = sqlite.prepare('SELECT * FROM ingestion_sources WHERE source_id=?').get(current.id)!
      expect(JSON.parse(String(upgraded.manifest_json))).toEqual(current)
      expect(upgraded.enabled).toBe(1)
      expect(upgraded.created_at).toBe('2026-09-01')
      expect(upgraded.next_fetch_at).toBe(generatedAt)
      expect(upgraded.updated_at).toBe(generatedAt)
      expect(JSON.parse(String(upgraded.manifest_json)).extraction.fields[0].required).toBe(false)
      sqlite.exec(buildCatalogSeeds(bundle, '2026-09-17T10:00:00.000Z').sql)
      expect(sqlite.prepare('SELECT * FROM ingestion_sources WHERE source_id=?').get(current.id)).toEqual(upgraded)
    } finally { sqlite.close() }
  })
  it('preserves disabled, customized and non-byte-identical v1 rows in real SQLite', () => {
    const bundle = { ...original, universities: original.universities.slice(0, 1) }
    const result = buildCatalogSeeds(bundle, '2026-09-16T10:00:00.000Z')
    const current = result.manifests[0]
    const legacy = structuredClone(current)
    legacy.extraction.schemaVersion = 'auto-seed-v1'
    legacy.extraction.fields[0].required = true
    const customized = structuredClone(legacy)
    customized.extraction.rules![0] = { kind: 'regex', fieldPath: 'title', pattern: '<h1>([^<]+)</h1>', flags: 'i', captureGroup: 1 }
    const variants = [
      { label: 'database-disabled', enabled: 0, json: JSON.stringify(legacy) },
      { label: 'manifest-disabled', enabled: 1, json: JSON.stringify({ ...legacy, enabled: false }) },
      { label: 'custom-extraction', enabled: 1, json: JSON.stringify(customized) },
      { label: 'same-meaning-different-bytes', enabled: 1, json: JSON.stringify(legacy, null, 2) },
      { label: 'custom-schedule', enabled: 1, json: JSON.stringify({ ...legacy, schedule: { intervalHours: 24, jitterMinutes: 0 } }) },
    ]
    for (const variant of variants) {
      const sqlite = new DatabaseSync(':memory:')
      try {
        sqlite.exec('CREATE TABLE ingestion_sources(source_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,enabled INTEGER,next_fetch_at TEXT,created_at TEXT,updated_at TEXT)')
        sqlite.prepare('INSERT INTO ingestion_sources VALUES(?,?,?,?,?,?)').run(current.id, variant.json, variant.enabled, '2026-09-20', '2026-09-01', '2026-09-01')
        const before = sqlite.prepare('SELECT * FROM ingestion_sources WHERE source_id=?').get(current.id)
        sqlite.exec(result.sql)
        sqlite.exec(result.sql)
        expect(sqlite.prepare('SELECT * FROM ingestion_sources WHERE source_id=?').get(current.id), variant.label).toEqual(before)
      } finally { sqlite.close() }
    }
  })
  it('imports idempotently and preserves an existing refined manifest', () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec('CREATE TABLE ingestion_sources(source_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,enabled INTEGER,next_fetch_at TEXT,created_at TEXT,updated_at TEXT)')
      const bundle = { ...original, universities: original.universities.slice(0, 1) }
      const result = buildCatalogSeeds(bundle)
      const first = result.manifests[0]
      const refined = { ...first, id: 'refined-source', extraction: { ...first.extraction, schemaVersion: 'refined-v2' } }
      sqlite.prepare('INSERT INTO ingestion_sources(source_id,manifest_json,enabled) VALUES(?,?,1)').run(refined.id, JSON.stringify(refined))
      sqlite.exec(result.sql)
      const count = sqlite.prepare('SELECT count(*) AS n FROM ingestion_sources').get()?.n
      sqlite.exec(result.sql)
      expect(sqlite.prepare('SELECT count(*) AS n FROM ingestion_sources').get()?.n).toBe(count)
      expect(sqlite.prepare('SELECT manifest_json FROM ingestion_sources WHERE source_id=?').get(refined.id)?.manifest_json).toBe(JSON.stringify(refined))
    } finally { sqlite.close() }
  })
})
