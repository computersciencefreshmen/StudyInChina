import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { control, queueExtraction } from '../src/repository'
import { seedTargetFollowupJobs } from '../src/target-followup'
import type { MaintenanceEnv } from '../src/types'
import { followupFixture, now } from './target-followup-fixture'
type NativeBucket = { put(key: string, value: Uint8Array): Promise<unknown>; list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }> }

test('native D1/R2 commits the exact followup guard and rolls back new jobs for a late unknown or started send', { timeout: 30000 }, async () => {
  for (const mode of ['healthy', 'unknown', 'send_started']) {
    const f = await followupFixture(); await f.refresh()
    const mf = new Miniflare(convertV4MiniflareOptions({ name: 'target-followup-native', modules: true, script: 'export default {fetch(){throw Error("egress forbidden")}}', compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, d1Databases: { DB: 'followup-local-db' }, r2Buckets: ['BUCKET'] }))
    try {
      await mf.ready
      const native = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET') as unknown as NativeBucket
      for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) for (const statement of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8').replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await native.prepare(statement).run()
      for (const table of ['maintenance_schools', 'maintenance_sources', 'maintenance_source_schools', 'maintenance_control', 'maintenance_observations', 'maintenance_record_targets', 'maintenance_target_sources', 'maintenance_target_refreshes', 'maintenance_events']) {
        const statements = f.db.sqlite.prepare(`SELECT * FROM ${table}`).all().map(row => native.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)))
        if (statements.length) await native.batch(statements)
      }
      for (const [key, bytes] of f.bucket.objects) await bucket.put(key, bytes)
      let modelCalls = 0, queueCalls = 0, guardSql = '', guardParams: unknown[] = [], injected = false
      const env: MaintenanceEnv = { ...f.env, SNAPSHOTS_BUCKET: bucket as unknown as MaintenanceEnv['SNAPSHOTS_BUCKET'], MODEL_ADMISSION: { idFromName() { modelCalls++; throw Error('model_forbidden') }, get() { modelCalls++; throw Error('model_forbidden') } }, MAINTENANCE_QUEUE: { async send() { queueCalls++; throw Error('queue_forbidden') } }, PIPELINE_DB: {
        prepare(sql: string) { const statement = native.prepare(sql); assert.ok(Buffer.byteLength(sql) <= 100000); if (!sql.startsWith('INSERT INTO maintenance_transaction_guards')) return statement; return { bind(...values: unknown[]) { assert.ok(values.length <= 100); guardSql = sql; guardParams = values; return statement.bind(...values) } } },
        async batch(statements: unknown[]) {
          if (mode !== 'healthy' && !injected) { injected = true; await native.prepare('INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('late-key', 'late-attempt', f.ids[0], 'a'.repeat(64), 'primary', 'b'.repeat(64), 'MiniMax-M3', mode, new Date(now).toISOString(), '{}').run() }
          return native.batch(statements as Parameters<typeof native.batch>[0])
        },
      } as unknown as MaintenanceEnv['PIPELINE_DB'] }
      const cfg = (await control(env))!, drain = () => seedTargetFollowupJobs(env, cfg, (row, sha, key, scope) => queueExtraction(env, row, sha, key, now, scope), now)
      if (mode === 'healthy') { assert.deepEqual(await drain(), { sources: 1, pending: 0 }); assert.equal((await native.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='maintain'").first<{ n: number }>())!.n, 2); assert.deepEqual(await drain(), { sources: 0, pending: 0 }) }
      else { await assert.rejects(drain()); assert.equal((await native.prepare('SELECT COUNT(*) n FROM maintenance_jobs').first<{ n: number }>())!.n, 0); assert.equal((await native.prepare('SELECT status FROM maintenance_model_attempts').first<{ status: string }>())!.status, mode); assert.equal((await bucket.list({ prefix: 'maintenance/target-followup/progress/' })).objects.length, 0) }
      assert.ok(guardParams.length > 20 && guardParams.length <= 100, `guard bindings ${guardParams.length} in ${mode}`)
      assert.equal((await native.prepare(`EXPLAIN ${guardSql}`).bind(...guardParams).all()).success, true)
      assert.equal((await native.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').first<{ n: number }>())!.n, 0)
      assert.equal((await native.prepare('SELECT checked_at FROM maintenance_observations').first<{ checked_at: string }>())!.checked_at, new Date(now).toISOString())
      assert.equal(modelCalls, 0); assert.equal(queueCalls, 0)
    } finally { await mf.dispose(); f.db.sqlite.close() }
  }
})
