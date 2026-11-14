import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { seed, setControls } from '../src/repository'
import type { Bucket } from '../src/types'
import { makeEnv, seedInput, TEST_GUARDS, TEST_SCOPE } from './fixture'

test('native D1/R2 dispatches64 within Paid query/parameter budgets and a cached quota wait sends nothing', { timeout: 30000 }, async t => {
  const now = Date.parse('2026-11-14T04:00:00.000Z'), f = makeEnv(), input = seedInput()
  for (let i = 0; i < 96; i++) input.schools[i].sourceSeeds = [{ id: `official-${i}`, url: `https://university-${i}.edu.cn/programs`, allowedHosts: [`university-${i}.edu.cn`], sourceCategory: 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' }]
  await seed(f.env, input, now)
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: false, canaryUniversityIds: ['uni-000'] }, now)
  await setControls(f.env, { expectedRevision: 1, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: false, canaryUniversityIds: [] }, now)
  const bundled = await build({ stdin: { contents: `
    import { runCloudTick } from './runtime'
    Date.now = () => ${now}
    export default { async fetch(request, env) {
      let prepared = 0, maxBindings = 0
      const sends = [], db = env.PIPELINE_DB
      const counted = { prepare(sql) {
        prepared++
        const statement = db.prepare(sql), bind = statement.bind.bind(statement)
        statement.bind = (...values) => { maxBindings = Math.max(maxBindings, values.length); return bind(...values) }
        return statement
      }, batch: statements => db.batch(statements) }
      const tick = await runCloudTick({ ...env, PIPELINE_DB: counted, MAINTENANCE_QUEUE: { async send(message) { sends.push(message) } } })
      return Response.json({ tick, sends, prepared, maxBindings })
    } }
  `, sourcefile: 'bounded-dispatch-runtime-entry.ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })
  let egress = 0
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'bounded-dispatch64', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, bindings: { MAINTENANCE_ENABLED: 'true', SCOPE_REGISTRY_SHA256: TEST_SCOPE, TICK_JOB_LIMIT: '64', MODEL_CONCURRENCY: '4' }, d1Databases: { PIPELINE_DB: 'bounded-dispatch64-db' }, r2Buckets: { SNAPSHOTS_BUCKET: 'bounded-dispatch64-bucket' }, outboundService: async () => { egress++; return new WorkerResponse('external access forbidden', { status: 502 }) } }))
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB'), bucket = await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as Pick<Bucket, 'put'>
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const sql = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8')
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    // Seed the real D1 binding outside the measured scheduler invocation.
    for (const table of ['maintenance_control', 'maintenance_schools', 'maintenance_sources', 'maintenance_source_schools']) {
      const rows = f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()
      const operations = rows.map(row => db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)))
      for (let offset = 0; offset < operations.length; offset += 32) await db.batch(operations.slice(offset, offset + 32))
    }
    const response = await mf.dispatchFetch('https://worker/tick')
    assert.equal(response.status, 200)
    const result = await response.json() as { tick: { state: string; queued: number | null }; sends: Array<{ jobId: string }>; prepared: number; maxBindings: number }
    assert.equal(result.tick.state, 'running'); assert.equal(result.tick.queued, 64); assert.equal(result.sends.length, 64)
    assert.equal(new Set(result.sends.map(message => message.jobId)).size, 64)
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='capture'").first('n'), 64)
    assert.equal(await db.prepare('SELECT COUNT(DISTINCT university_id) n FROM maintenance_source_schools x JOIN maintenance_jobs j ON x.source_id=j.source_id').first('n'), 64)
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first('n'), 0)
    assert.ok(result.prepared <= 160 && result.prepared < 1000, `Paid query budget: ${result.prepared}`)
    assert.ok(result.maxBindings <= 100)
    t.diagnostic(`native D1 prepared statements=${result.prepared}, maximum bindings=${result.maxBindings}, egress=${egress}`)
    await bucket.put('maintenance/runtime/d1-quota-wait.v1.json', JSON.stringify({ format: 'studyinchina.d1-quota-wait', version: 1, observedAt: new Date(now).toISOString(), retryAt: '2026-11-15T00:00:00.000Z' }))
    const held = await mf.dispatchFetch('https://worker/tick').then(r => r.json()) as typeof result
    assert.equal(held.tick.state, 'quota_wait'); assert.equal(held.tick.queued, null); assert.equal(held.sends.length, 0); assert.equal(held.prepared, 0)
    assert.equal(await db.prepare('SELECT revision FROM maintenance_control').first('revision'), 2)
    assert.equal(egress, 0)
  } finally { f.db.sqlite.close(); await mf.dispose() }
})
