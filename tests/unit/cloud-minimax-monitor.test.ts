import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { handleAdminMiniMaxMonitor, readCloudLedger, CLOUD_USAGE_SQL } from '../../workers/catalog-api/src/admin-minimax-monitor'
import api from '../../workers/catalog-api/src/index'
import type { CatalogApiEnv, D1PreparedStatement } from '../../workers/catalog-api/src/types'
import { cloudMiniMaxSchema } from '../../src/lib/admin/cloud-minimax-contract'
import { canonicalJson } from '../../scripts/maintenance/contracts'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'

const token = 'test-cloud-telemetry-credential-not-a-real-token'
const request = (auth = true, method = 'GET') => new Request('https://api.test/internal/v1/admin-minimax-monitor', { method, headers: auth ? { authorization: `Bearer ${token}` } : {} })
function fixture(indexes = true) {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync('infra/d1/pipeline/migrations/0019_catalog_maintenance.sql', 'utf8'))
  if (indexes) db.exec(readFileSync('infra/d1/pipeline/migrations/0024_cloud_monitor_indexes.sql', 'utf8'))
  db.exec("INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,'scope','catalog','seed','guard',1,1,1,1,'[]','2026-11-14T08:00:00Z'); INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES('university','{}','{}','scope')")
  const prepare = vi.fn((sql: string) => {
    let values: unknown[] = []
    const s: D1PreparedStatement = { bind(...args) { values = args; return s }, async first<T>() { return db.prepare(sql).get(...values as never[]) as T ?? null }, async all<T>() { return { success: true, results: db.prepare(sql).all(...values as never[]) as T[] } } }; return s
  })
  const objects = new Map<string, string>()
  const get = vi.fn(async (key: string) => { const text = objects.get(key); return text === undefined ? null : { body: null, text: async () => text, size: new TextEncoder().encode(text).length } })
  const readQuota = vi.fn(async () => cloudSnapshot().quota)
  const env: CatalogApiEnv = { CATALOG_DB: { prepare: () => { throw new Error('catalog database must not be queried') } }, PIPELINE_DB: { prepare }, RELEASES_BUCKET: { get }, SOURCE_SNAPSHOTS: { get }, MAINTENANCE_MONITOR: { readQuota }, ADMIN_TELEMETRY_TOKEN: token }
  function add(id: string, time: string, model = 'MiniMax-M3', status = 'completed', usage: unknown = null) {
    db.prepare('INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json,usage_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, id, 'source', 'raw', 'primary', 'payload-sha', model, status, time, '{"private":"never expose"}', typeof usage === 'string' ? usage : JSON.stringify(usage))
  }
  return { db, env, prepare, get, objects, readQuota, add }
}

describe('read-only cloud MiniMax monitor', () => {
  it('authenticates before D1, R2 or RPC, supports only GET, and honors migration freeze', async () => {
    const f = fixture()
    try {
      expect((await api.fetch(request(false), f.env)).status).toBe(403)
      expect((await api.fetch(request(true, 'POST'), f.env)).status).toBe(405)
      expect(f.prepare).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.readQuota).not.toHaveBeenCalled()
      f.env.ACCOUNT_MIGRATION_FROZEN = 'true'; expect((await api.fetch(request(), f.env)).status).toBe(503)
      expect(f.prepare).not.toHaveBeenCalled(); expect(f.readQuota).not.toHaveBeenCalled()
    } finally { f.db.close() }
  })
  it('uses real SQL, Shanghai midnight and original started_at to distinguish new from imported history, with exact token/cache semantics', async () => {
    const f = fixture()
    try {
      f.add('old-import', '2026-11-01T00:00:00.000Z', 'MiniMax-M3', 'completed', { input_tokens: 999999 })
      f.add('yesterday', '2026-11-13T15:59:59.999Z', 'MiniMax-M3', 'completed', { input_tokens: 50, output_tokens: 2 })
      f.add('midnight', '2026-11-13T16:00:00.000Z', 'MiniMax-M3', 'completed', { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 })
      f.add('flash', '2026-11-14T07:00:00.000Z', 'MiniMax-M3.1-Flash', 'unknown')
      f.add('failed', '2026-11-14T07:01:00.000Z', 'MiniMax-M3.1-Flash', 'known_failed', { input_tokens: 20, output_tokens: 8192, providerResponse: { private: 'never expose' } })
      f.add('zero-valid', '2026-11-14T07:02:00.000Z', 'MiniMax-M3', 'completed', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 })
      f.add('future', '2026-11-14T09:00:00.000Z', 'MiniMax-M3', 'completed', { input_tokens: 100000 })
      const value = await readCloudLedger(f.env, cloudSnapshot().quota, CLOUD_NOW), today = value.periods.find(p => p.id === 'today')!
      expect(today.totals).toMatchObject({ attempts: 4, completed: 2, unknown: 1, knownFailed: 1, tokens: { input: 120, output: 8199, cacheRead: 40, cacheWrite: 10, unknownUsageAttempts: 1 } })
      expect(today.models.find(m => m.model === 'MiniMax-M3.1-Flash')?.attempts).toBe(2)
      expect(value.periods.find(p => p.id === 'recent-seven-days')?.totals.attempts).toBe(5)
      expect(value.periods.find(p => p.id === 'five-hour')?.totals.attempts).toBe(3)
      expect(value.periods.some(p => p.id === 'weekly'), 'unlimited weekly quota has no fabricated weekly period').toBe(false)
      expect(JSON.stringify(value)).not.toContain('never expose'); expect(value.recentAttempts).toHaveLength(5)
      expect(value.recentAttempts.some(a => a.attemptId === 'future' || a.attemptId === 'old-import')).toBe(false)
      const windows = JSON.stringify([{ id: 'today', startAt: '2026-11-13T16:00:00.000Z', endAt: new Date(CLOUD_NOW).toISOString() }])
      const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${CLOUD_USAGE_SQL}`).all(windows).map(r => String(r.detail)).join('\n')
      expect(plan).toContain('SEARCH maintenance_model_attempts USING INDEX maintenance_model_attempt_started')
      expect(plan).not.toContain('SCAN maintenance_model_attempts')
    } finally { f.db.close() }
  })
  it('does not silently turn missing, malformed or negative usage into zero; explicitly reported zero is retained', async () => {
    const f = fixture()
    try {
      f.add('malformed', '2026-11-14T07:00:00.000Z', 'MiniMax-M3', 'unknown', '{broken')
      f.add('invalid', '2026-11-14T07:01:00.000Z', 'MiniMax-M3', 'known_failed', { input_tokens: -1, output_tokens: 1.5 })
      let value = await readCloudLedger(f.env, cloudSnapshot().quota, CLOUD_NOW)
      expect(value.periods[0].totals.tokens).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null, unknownUsageAttempts: 2 })
      f.add('zero', '2026-11-14T07:02:00.000Z', 'MiniMax-M3', 'completed', { input_tokens: 0, output_tokens: 0 })
      value = await readCloudLedger(f.env, cloudSnapshot().quota, CLOUD_NOW)
      expect(value.periods[0].totals.tokens).toMatchObject({ input: 0, output: 0, unknownUsageAttempts: 2 })
    } finally { f.db.close() }
  })
  it('coalesces authenticated refreshes, marks previous observations stale on D1 failure, and makes no writes', async () => {
    const f = fixture()
    try {
      f.add('one', '2026-11-14T07:00:00.000Z')
      const responses = await Promise.all(Array.from({ length: 8 }, () => handleAdminMiniMaxMonitor(request(), f.env, CLOUD_NOW)))
      const value = cloudMiniMaxSchema.parse(await responses[0].json())
      expect(value.ledgerState).toBe('fresh'); expect(value.ledger?.observedAt).toBe(new Date(CLOUD_NOW).toISOString())
      expect(f.prepare.mock.calls.filter(([sql]) => sql === CLOUD_USAGE_SQL)).toHaveLength(1)
      expect(f.prepare.mock.calls.every(([sql]) => /^SELECT|^WITH/.test(sql))).toBe(true)
      f.env.PIPELINE_DB = { prepare: () => { throw new Error('private SQL error') } }
      const failed = await (await handleAdminMiniMaxMonitor(request(), f.env, CLOUD_NOW + 46_000)).json()
      expect(failed.ledgerState).toBe('stale'); expect(failed.ledger.observedAt).toBe(value.ledger?.observedAt)
      expect(JSON.stringify(failed)).not.toContain('private SQL error')
      expect(responses[0].headers.get('cache-control')).toBe('private, no-store'); expect(responses[0].headers.get('access-control-allow-origin')).toBeNull()
    } finally { f.db.close() }
  })
  it('missing binding, missing indexes or quota RPC failure do not break other admin capabilities or invent zero', async () => {
    const f = fixture(false)
    try {
      f.readQuota.mockRejectedValue(new Error('private provider error'))
      let value = await (await handleAdminMiniMaxMonitor(request(), f.env, CLOUD_NOW)).json()
      expect(value.ledger).toBeNull(); expect(value.ledgerState).toBe('unavailable'); expect(value.quota.state).toBe('unknown')
      expect(JSON.stringify(value)).not.toContain('private provider error')
      const env = { ...f.env, PIPELINE_DB: undefined, MAINTENANCE_MONITOR: undefined }
      value = await (await handleAdminMiniMaxMonitor(request(), env, CLOUD_NOW)).json()
      expect(value.code).toBe('binding_missing'); expect(value.ledger).toBeNull(); expect(value.quota.fiveHour).toBeNull()
    } finally { f.db.close() }
  })
  it('accepts coverage only when actual hash, catalog, complete school set and counters all match', async () => {
    const f = fixture()
    try {
      // The production coverage schema binds distinct concrete IDs, not language duplicates.
      const content = { format: 'studyinchina.school-program-coverage', version: 1, scopeRegistrySha256: 'a'.repeat(64), inputCatalogSha256: 'b'.repeat(64), evaluatedOn: '2026-11-14', schools: [{ universityId: 'university', rawProgramCount: 1, directoryProgramCount: 1, currentProgramCount: 1, minimumProgramCount: 5, gap: 4, coverageBand: 'one', countedProgramIds: ['program'], directoryScholarshipCount: 0, currentScholarshipCount: 0, reviewAfter: null }] }
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(content)))), n => n.toString(16).padStart(2, '0')).join('')
      f.db.prepare('UPDATE maintenance_control SET scope_sha256=?,input_catalog_sha256=?').run(content.scopeRegistrySha256, content.inputCatalogSha256)
      f.db.prepare('UPDATE maintenance_schools SET scope_sha256=?').run(content.scopeRegistrySha256)
      f.db.prepare("INSERT INTO maintenance_events VALUES('coverage','coverage_snapshot','2026-11-14T08:00:00Z',?)").run(JSON.stringify({ sha256, ...content, schools: undefined }))
      f.objects.set(`maintenance/coverage/${sha256}.json`, JSON.stringify({ ...content, sha256 }))
      expect((await readCloudLedger(f.env, cloudSnapshot().quota, CLOUD_NOW)).coverage).toMatchObject({ one: 1, fivePlus: 0, currentPrograms: 1, stale: false })
      f.objects.set(`maintenance/coverage/${sha256}.json`, JSON.stringify({ ...content, schools: [], sha256 }))
      expect((await readCloudLedger(f.env, cloudSnapshot().quota, CLOUD_NOW)).coverage).toBeNull()
    } finally { f.db.close() }
  })
})
