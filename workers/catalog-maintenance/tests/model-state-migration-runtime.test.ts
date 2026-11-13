import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import type { ModelRequest } from '../src/types'
import { canonical, digest } from '../src/util'

const migrationId = 'gmail-native-do-migration-test', sourceAccountId = '1'.repeat(32), targetAccountId = '2'.repeat(32)
const admin = 'migration-runtime-test-admin-not-a-real-secret', sourceId = 'd'.repeat(64), snapshotSha256 = 'e'.repeat(64), scope = 'a'.repeat(64)
const payload = 'Original private evidence; migration must not send it again.'
type RuntimeBucket = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  put(key: string, value: string | ArrayBuffer): Promise<unknown>
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string }> }>
}

async function bundle() {
  const built = await build({ stdin: {
    contents: `
      import { ModelAdmission } from './admission'
      import { handleFetch } from './index'
      import { authorized } from './util'
      // Only this bundled fixture exposes state seeding/activation. The production
      // Worker routes do not contain these endpoints or export raw storage.
      export class TestAdmission extends ModelAdmission {
        constructor(state, env) {
          const runtimeEnv = { ...env }
          super(state, runtimeEnv)
          this.fixtureStorage = state.storage
          this.fixtureEnv = runtimeEnv
        }
        async fetch(request) {
          const path = new URL(request.url).pathname
          if (path.startsWith('/test/')) {
            if (!authorized(request, this.fixtureEnv)) return new Response(null, {status:401})
            if (path === '/test/seed') {
              for (const entry of await request.json()) await this.fixtureStorage.put(entry.key, entry.value)
              return Response.json({ok:true})
            }
            if (path === '/test/activate') {
              for (const key of ['MODEL_STATE_MIGRATION_ID','MODEL_STATE_MIGRATION_ROLE','MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID','MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete this.fixtureEnv[key]
              this.fixtureEnv.MAINTENANCE_ENABLED = 'true'
              return Response.json({ok:true})
            }
          }
          return super.fetch(request)
        }
      }
      export default {
        async fetch(request, env) {
          const path = new URL(request.url).pathname
          if (path.startsWith('/test/')) {
            if (!authorized(request, env)) return new Response(null, {status:401})
            const targetPath = path === '/test/model' ? '/model/run' : path
            return env.MODEL_ADMISSION.get(env.MODEL_ADMISSION.idFromName('subscription-account-v1'))
              .fetch(new Request('https://admission.internal' + targetPath, request))
          }
          return handleFetch(request, env)
        }
      }
    `,
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), sourcefile: 'model-migration-runtime-entry.ts', loader: 'ts',
  }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })
  return built.outputFiles[0].text
}
async function runtime(script: string, role: 'source' | 'target') {
  const outbound: string[] = []
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: `model-state-migration-${role}`, modules: true, script, compatibilityDate: '2026-09-18',
    host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { MAINTENANCE_ADMIN_TOKEN: admin, MINIMAX_SUBSCRIPTION_KEY: 'test-only-subscription-not-a-real-key',
      MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_ANTHROPIC_BASE: 'https://api.minimaxi.com/anthropic', MAINTENANCE_ENABLED: 'false',
      NATIVE_HEAD_RECONCILIATION_REQUIRED: 'false', SCOPE_REGISTRY_SHA256: scope,
      MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: role,
      MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: targetAccountId },
    durableObjects: { MODEL_ADMISSION: { className: 'TestAdmission', useSQLite: true } },
    d1Databases: { PIPELINE_DB: `migration-runtime-db-${role}` }, r2Buckets: { SNAPSHOTS_BUCKET: `migration-runtime-r2-${role}` },
    outboundService: async request => { outbound.push(request.url); return new WorkerResponse('No provider calls are permitted by this fixture', { status: 500 }) },
  }))
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB'), bucket = await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as RuntimeBucket
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const sql = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8')
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    await db.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
      enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,?,?,?,?,1,1,1,1,'[]',?)`)
      .bind(scope, 'b'.repeat(64), 'c'.repeat(64), 'f'.repeat(64), new Date().toISOString()).run()
    await db.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?,?,?,?)').bind('runtime-school', '{"en":"Runtime School"}', '{}', scope).run()
    await db.prepare(`INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256)
      VALUES(?,?,?,'undergraduate_catalog',1,24,?,?)`).bind(sourceId, 'https://runtime-test.edu.cn/catalog', '["runtime-test.edu.cn"]', new Date().toISOString(), snapshotSha256).run()
    await db.prepare('INSERT INTO maintenance_source_schools(source_id,university_id) VALUES(?,?)').bind(sourceId, 'runtime-school').run()
    return { mf, db, bucket, outbound }
  } catch (error) { await mf.dispose(); throw error }
}
function post(mf: Miniflare, path: string, body: unknown) {
  return mf.dispatchFetch(`https://migration.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
function input(key: string): ModelRequest { return { reservationKey: key, sourceId, snapshotSha256, universityIds: ['runtime-school'], payload, pass: 'primary', lane: 'expansion' } }

test('real workerd migrates private DO history across namespaces, verifies real R2 evidence and never replays spent/unknown calls', { timeout: 120000 }, async t => {
  const script = await bundle(), source = await runtime(script, 'source')
  let target: Awaited<ReturnType<typeof runtime>> | undefined
  try {
    target = await runtime(script, 'target')
    const requestSha256 = await digest(payload), output = { evidence: 'historical paid result' }
    const artifactBytes = canonical({ attemptId: 'old-completed', output }), artifactSha256 = await digest(artifactBytes)
    const artifactKey = `maintenance/models/${'1'.repeat(64)}/${artifactSha256}.json`
    await source.bucket.put(artifactKey, artifactBytes)
    // R2 is an independently copied dependency, not hidden inside a DO export.
    const sourceObject = await source.bucket.get(artifactKey); assert.ok(sourceObject)
    await target.bucket.put(artifactKey, await sourceObject.arrayBuffer())
    const result = { attemptId: 'old-completed', output, artifactKey, artifactSha256, reused: false }
    const originalGate = { fetches: [], models: [], nextHost: { 'old.edu.cn': Date.now() + 60000 }, successes: 6, cooldownUntil: Date.now() + 60000, modelLimit: 1 }
    const entries = [{ key: 'gate', value: originalGate },
      { key: `request:${'1'.repeat(64)}`, value: { state: 'completed', attemptId: 'old-completed', requestSha256, result } },
      { key: `request:${'2'.repeat(64)}`, value: { state: 'unknown', attemptId: 'old-unknown', requestSha256, attemptCount: 3, retryable: false, notBefore: 1234 } },
      { key: `request:${'3'.repeat(64)}`, value: { state: 'send_started', attemptId: 'old-crashed', requestSha256, attemptCount: 1 } },
      { key: `request:${'4'.repeat(64)}`, value: { state: 'known_failed', attemptId: 'old-429', requestSha256, attemptCount: 4, retryable: true, notBefore: Date.now() + 60000 } }]
    assert.equal((await post(source.mf, '/test/seed', entries)).status, 200)
    const req = { migrationId }
    await t.test('unauthenticated raw-state export is denied and target cannot execute while configured', async () => {
      assert.equal((await source.mf.dispatchFetch('https://migration.test/model-state-migration/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...req, pageIndex: 0 }) })).status, 401)
      assert.equal((await (await post(target!.mf, '/test/model', input('1'.repeat(64)))).json() as { error: string }).error, 'model_state_migration_locked')
    })
    assert.equal((await post(source.mf, '/model-state-migration/freeze', req)).status, 200)
    const response = await post(source.mf, '/model-state-migration/export', { ...req, pageIndex: 0 })
    const exported = await response.json() as { pageBytes: string; pageSha256: string; manifest: { entryCount: number; requestCount: number; states: unknown }; manifestSha256: string; nextPageIndex: null }
    assert.equal(response.status, 200, JSON.stringify(exported)); assert.equal(exported.nextPageIndex, null)
    await t.test('native SQLite-backed DO list exports exact canonical state with complete counts', async () => {
      assert.equal(exported.pageSha256, await digest(exported.pageBytes))
      assert.equal(exported.manifestSha256, await digest(canonical(exported.manifest)))
      assert.equal(exported.manifest.entryCount, 5); assert.equal(exported.manifest.requestCount, 4)
      assert.deepEqual(exported.manifest.states, { send_started: 1, completed: 1, unknown: 1, known_failed: 1 })
      assert.deepEqual(JSON.parse(exported.pageBytes).entries, entries)
      assert.equal(exported.pageBytes.includes('test-only-subscription-not-a-real-key'), false)
      assert.equal((await source.bucket.list({ prefix: 'maintenance/' })).objects.length, 1, 'migration never publishes raw state into R2')
    })
    const imported = { ...req, manifest: exported.manifest, manifestSha256: exported.manifestSha256, pageBytes: exported.pageBytes }
    assert.equal((await post(target.mf, '/model-state-migration/import', imported)).status, 200)
    assert.equal((await (await post(target.mf, '/model-state-migration/import', imported)).json() as { reused: boolean }).reused, true)
    assert.equal((await post(target.mf, '/model-state-migration/finalize', { ...req, manifestSha256: exported.manifestSha256 })).status, 200)
    assert.equal((await (await post(target.mf, '/test/model', input('1'.repeat(64)))).json() as { error: string }).error, 'model_state_migration_locked')
    assert.equal((await post(target.mf, '/test/activate', {})).status, 200)
    await t.test('completed results reuse exact migrated history and actual R2 bytes without quota/model requests', async () => {
      const replay = await post(target!.mf, '/test/model', input('1'.repeat(64))), body = await replay.json() as { reused: boolean; artifactKey: string; artifactSha256: string; output: unknown }
      assert.equal(replay.status, 200, JSON.stringify(body)); assert.equal(body.reused, true); assert.deepEqual(body.output, output)
      const object = await target!.bucket.get(body.artifactKey); assert.ok(object)
      assert.equal(await digest(await object.arrayBuffer()), body.artifactSha256)
    })
    await t.test('unknown and crash reservations remain protected, and definite429 retains its cooldown', async () => {
      for (const key of ['2', '3']) {
        const replay = await post(target!.mf, '/test/model', input(key.repeat(64)))
        assert.equal(replay.status, 409); assert.equal((await replay.json() as { error: string }).error, 'prior_model_outcome_requires_review')
      }
      const waiting = await post(target!.mf, '/test/model', input('4'.repeat(64)))
      assert.equal(waiting.status, 429); assert.equal((await waiting.json() as { error: string }).error, 'model_http_429')
    })
    assert.deepEqual(source.outbound, []); assert.deepEqual(target.outbound, [])
    assert.equal((await target.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
    assert.equal((await source.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
    const status = await source.mf.dispatchFetch('https://migration.test/model-state-migration/status', { headers: { authorization: `Bearer ${admin}` } })
    assert.equal((await status.json() as { state: string }).state, 'exported')
  } finally { await target?.mf.dispose(); await source.mf.dispose() }
})
