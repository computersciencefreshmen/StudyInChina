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
          let owner
          const statistics = { reads: [], writes: 0, deletes: 0, lists: 0 }
          const tracked = store => ({
            get: key => { statistics.reads.push(key); return store.get(key) },
            put: (key, value) => { statistics.writes++; return store.put(key, value) },
            delete: key => { statistics.deletes++; return store.delete(key) },
            list: options => { statistics.lists++; return store.list(options) }
          })
          const fixtureWrappedStorage = {
            ...tracked(state.storage),
            transaction: async callback => {
              // Suspend a real cleanup operation before its native transaction;
              // concurrent migration diagnostics must observe its actual counter.
              if (owner.fixturePauseNextTransaction) {
                owner.fixturePauseNextTransaction = false
                owner.fixtureTransactionBlocked = true
                await new Promise(resolve => { owner.fixtureReleaseTransaction = resolve })
                owner.fixtureTransactionBlocked = false
              }
              return state.storage.transaction(txn => callback(tracked(txn)))
            }
          }
          super({ storage: fixtureWrappedStorage }, runtimeEnv)
          owner = this
          this.fixtureStorage = state.storage
          this.fixtureEnv = runtimeEnv
          this.fixtureStatistics = statistics
        }
        async fetch(request) {
          const path = new URL(request.url).pathname
          if (path.startsWith('/test/')) {
            if (!authorized(request, this.fixtureEnv)) return new Response(null, {status:401})
            if (path === '/test/seed') {
              for (const entry of await request.json()) await this.fixtureStorage.put(entry.key, entry.value)
              return Response.json({ok:true})
            }
            if (path === '/test/read-private-state') return Response.json({entries:[...await this.fixtureStorage.list()]})
            if (path === '/test/storage-statistics') return Response.json(this.fixtureStatistics)
            if (path === '/test/reset-storage-statistics') {
              this.fixtureStatistics.reads.length = 0
              this.fixtureStatistics.writes = this.fixtureStatistics.deletes = this.fixtureStatistics.lists = 0
              return Response.json({ok:true})
            }
            if (path === '/test/activate') {
              for (const key of ['MODEL_STATE_MIGRATION_ID','MODEL_STATE_MIGRATION_ROLE','MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID','MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']) delete this.fixtureEnv[key]
              this.fixtureEnv.MAINTENANCE_ENABLED = 'true'
              return Response.json({ok:true})
            }
            if (path === '/test/pause-transaction') { this.fixturePauseNextTransaction = true; return Response.json({ok:true}) }
            if (path === '/test/transaction-state') return Response.json({blocked:this.fixtureTransactionBlocked === true})
            if (path === '/test/resume-transaction') { this.fixtureReleaseTransaction?.(); return Response.json({ok:true}) }
          }
          return super.fetch(request)
        }
      }
      export default {
        async fetch(request, env) {
          const path = new URL(request.url).pathname
          if (path.startsWith('/test/')) {
            if (!authorized(request, env)) return new Response(null, {status:401})
            const targetPath = path === '/test/model' ? '/model/run' : path === '/test/release' ? '/fetch/release' : path === '/test/fetch' ? '/fetch/acquire' : path
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
    await db.prepare(`INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256)
      VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?)`).bind(sourceId, 'https://runtime-test.edu.cn/catalog', '["runtime-test.edu.cn"]', new Date().toISOString(), snapshotSha256, 'f'.repeat(64)).run()
    await db.prepare('INSERT INTO maintenance_source_schools(source_id,university_id) VALUES(?,?)').bind(sourceId, 'runtime-school').run()
    return { mf, db, bucket, outbound }
  } catch (error) { await mf.dispose(); throw error }
}

test('real workerd private gate inspection reads only a frozen source gate without writes, requests, models or export progress', { timeout: 120000 }, async () => {
  const script = await bundle(), source = await runtime(script, 'source'), target = await runtime(script, 'target')
  const path = '/model-state-migration/gate-inspection', headers = { authorization: `Bearer ${admin}` }
  const read = (mf: Miniflare) => mf.dispatchFetch('https://migration.test' + path, { headers })
  try {
    const gate = { fetches: [{ token: 'PRIVATE-NATIVE-ORIGINAL-PERMIT', expiresAt: Number.MAX_SAFE_INTEGER }], models: [],
      nextHost: { 'PRIVATE-NON-HOST-KEY': Date.now() + 60000 }, successes: 0, cooldownUntil: 0, modelLimit: 2,
      unknownExtension: { privateValue: 'PRIVATE-ORIGINAL-GATE-CONTENT' } }
    const lock = { version: 1, migrationId, sourceAccountId, targetAccountId, role: 'source', phase: 'frozen', frozenAt: new Date(Date.now() - 121000).toISOString(), pages: [],
      states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false }
    await post(source.mf, '/test/seed', [{ key: '__model_state_migration_v1', value: lock }, { key: 'gate', value: gate },
      { key: `request:${'7'.repeat(64)}`, value: { private: 'PRIVATE-REQUEST-MUST-NOT-BE-READ-OR-RETURNED' } }])
    const before = await (await post(source.mf, '/test/read-private-state', {})).json()
    await post(source.mf, '/test/reset-storage-statistics', {})
    assert.equal((await source.mf.dispatchFetch('https://migration.test' + path)).status, 401)
    assert.equal((await post(source.mf, path, {})).status, 503)
    assert.equal((await read(target.mf)).status, 409)
    const response = await read(source.mf), result = await response.json() as Record<string, unknown>
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(result.canonicalGateJson, canonical(gate)); assert.equal(result.gateSha256, await digest(canonical(gate)))
    assert.equal(result.gateByteLength, new TextEncoder().encode(String(result.canonicalGateJson)).length)
    assert.equal(result.cutoverReady, false); assert.equal(result.modelCalls, false); assert.equal(result.mutation, false); assert.equal(result.sourceUnlocked, false)
    assert.equal(JSON.stringify(result).includes('PRIVATE-REQUEST-MUST-NOT-BE-READ'), false)
    const stats = await (await post(source.mf, '/test/storage-statistics', {})).json()
    assert.deepEqual(stats, { reads: ['__model_state_migration_v1', 'gate'], writes: 0, deletes: 0, lists: 0 })
    assert.deepEqual(await (await post(source.mf, '/test/read-private-state', {})).json(), before)
    const summary = await source.mf.dispatchFetch('https://migration.test/model-state-migration/ledger-summary', { headers })
    assert.equal(summary.status, 409); assert.equal((await summary.json() as { error: string }).error, 'non_temporal_recovery_gate_schema_unknown')
    const exported = await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })
    assert.equal(exported.status, 409); assert.equal((await exported.json() as { error: string }).error, 'model_state_migration_inflight')
    assert.deepEqual(await (await post(source.mf, '/test/read-private-state', {})).json(), before)
    const afterStats = await (await post(source.mf, '/test/storage-statistics', {})).json() as { writes: number; deletes: number }
    assert.equal(afterStats.writes, 0); assert.equal(afterStats.deletes, 0)
    assert.deepEqual(source.outbound, []); assert.deepEqual(target.outbound, [])
    assert.equal((await source.bucket.list({ prefix: '' })).objects.length, 0)
    assert.equal((await source.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
  } finally { await target.mf.dispose(); await source.mf.dispose() }
})

test('real workerd releases a frozen legacy handoff mutex, preserves all auxiliary/request bytes and keeps target business fenced', { timeout: 120000 }, async () => {
  const script = await bundle(), source = await runtime(script, 'source'), target = await runtime(script, 'target')
  try {
    const at = Date.now(), batchId = 'offline-native-legacy-test'
    const fence = { batchId, phase: 'held_for_handoff', tokenSha256: 'a'.repeat(64), scopeRegistrySha256: scope, inputCatalogSha256: 'b'.repeat(64),
      acquiredAt: new Date(at - 86400000).toISOString(), manifestSha256: 'c'.repeat(64), releaseRequestedAt: new Date(at - 3600000).toISOString(), epoch: 18,
      retiredManifests: ['d'.repeat(64)], sourceManifestHistory: ['e'.repeat(64)], rowsStarted: false }
    const gate = { fetches: [{ token: 'PRIVATE-NATIVE-HANDOFF-TOKEN', kind: 'handoff', batchId, manifestSha256: fence.manifestSha256, expiresAt: Number.MAX_SAFE_INTEGER }],
      models: [], nextHost: {}, successes: 6, cooldownUntil: at + 60000, modelLimit: 2, offlineFence: fence }
    const lock = { version: 1, migrationId, sourceAccountId, targetAccountId, role: 'source', phase: 'frozen', frozenAt: new Date(at - 121000).toISOString(), pages: [],
      states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false }
    const originals = [{ key: 'gate', value: gate }, { key: `offline-fence:${batchId}`, value: fence }, { key: `offline-adoption:${batchId}`, value: {} },
      ...['completed', 'unknown', 'send_started', 'known_failed'].map((state, i) => ({ key: `request:${String(i + 1).repeat(64)}`, value: { state, attemptId: `native-legacy-${i}`, requestSha256: 'f'.repeat(64) } }))]
    await post(source.mf, '/test/seed', [{ key: '__model_state_migration_v1', value: lock }, ...originals])
    const privateBefore = await (await post(source.mf, '/test/read-private-state', {})).json()
    await post(source.mf, '/test/reset-storage-statistics', {})
    const headers = { authorization: `Bearer ${admin}` }, inspectUrl = 'https://migration.test/model-state-migration/storage-inspection?pageIndex=0'
    assert.equal((await source.mf.dispatchFetch(inspectUrl)).status, 401)
    const inspection = await source.mf.dispatchFetch(inspectUrl, { headers }), inspected = await inspection.json() as Record<string, unknown>
    assert.equal(inspection.status, 200); assert.equal(inspected.entryCount, 8); assert.equal(inspected.requestCount, 4); assert.equal(inspected.auxiliaryEntryCount, 2)
    assert.equal(inspected.pageSha256, await digest(String(inspected.pageBytes))); assert.equal(inspected.cutoverReady, false)
    assert.deepEqual(await (await post(source.mf, '/test/read-private-state', {})).json(), privateBefore)
    const readStats = await (await post(source.mf, '/test/storage-statistics', {})).json() as { writes: number; deletes: number }
    assert.equal(readStats.writes, 0); assert.equal(readStats.deletes, 0)
    assert.equal((await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })).status, 409)
    const generic = await post(source.mf, '/model-state-migration/non-temporal-fetch-permit-recovery', { migrationId, operationId: 'valid-native-generic-must-reject-handoff',
      expectedGateSha256: await digest(canonical(gate)), expectedRequestLedgerSha256: 'f'.repeat(64), expectedNonTemporalSlots: { fetch: 1, model: 0 }, observedAt: inspected.observedAt,
      operator: { operatorId: 'native-root', decision: 'retire_non_temporal_fetch_slots_preserve_requests', reason: 'The known handoff is not a generic fetch.', reviewedAt: new Date().toISOString() } })
    assert.equal(generic.status, 409); assert.equal((await generic.json() as { error: string }).error, 'non_temporal_recovery_gate_schema_unknown')
    const body = { migrationId, operationId: 'native-root-reviewed-handoff-operation-v1', expectedGateSha256: await digest(canonical(gate)), expectedLedgerSha256: inspected.ledgerSha256,
      expectedFenceSha256: await digest(canonical(fence)), expectedHistorySha256: await digest(canonical(fence)), expectedTokenSha256: fence.tokenSha256, batchId, manifestSha256: fence.manifestSha256,
      observedAt: inspected.observedAt, operator: { operatorId: 'native-independent-root', decision: 'release_quiescent_handoff_operation_preserve_intent', reason: 'Quiescent legacy coordination only; preserve unknown outcomes and held intent.', reviewedAt: new Date().toISOString() } }
    const path = '/model-state-migration/handoff-operation-recovery'
    const response = await post(source.mf, path, body), receipt = await response.json() as Record<string, unknown>
    assert.equal(response.status, 200, JSON.stringify(receipt)); assert.equal(receipt.intentCompleted, false); assert.equal(receipt.modelCalls, false)
    assert.equal((await (await post(source.mf, path, body)).json() as { reused: boolean }).reused, true)
    const after = await (await post(source.mf, '/test/read-private-state', {})).json() as { entries: Array<[string, unknown]> }, afterMap = new Map(after.entries)
    for (const entry of originals.filter(e => e.key !== 'gate')) assert.deepEqual(afterMap.get(entry.key), entry.value)
    const recoveredGate = afterMap.get('gate') as Record<string, unknown>
    assert.deepEqual(recoveredGate.offlineFence, fence); assert.deepEqual(recoveredGate.fetches, [])
    assert.equal((recoveredGate.offlineHandoffOperationRecovery as Record<string, unknown>).originalGateJson, canonical(gate))
    const exportedResponse = await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 }), exported = await exportedResponse.json() as Record<string, unknown>
    assert.equal(exportedResponse.status, 200); assert.equal((exported.manifest as Record<string, unknown>).auxiliaryEntryCount, 2)
    assert.equal((await post(target.mf, '/model-state-migration/import', { migrationId, ...exported })).status, 200)
    assert.equal((await post(target.mf, '/model-state-migration/finalize', { migrationId, manifestSha256: exported.manifestSha256 })).status, 200)
    const imported = await (await post(target.mf, '/test/read-private-state', {})).json() as { entries: Array<[string, unknown]> }, importedMap = new Map(imported.entries)
    for (const [key, value] of afterMap) if (key !== '__model_state_migration_v1') assert.deepEqual(importedMap.get(key), value)
    await post(target.mf, '/test/activate', {}); await post(target.mf, '/test/reset-storage-statistics', {})
    for (const [route, value] of [['/test/model', input('2'.repeat(64))], ['/test/fetch', { host: 'official.edu.cn' }]] as const) {
      const blocked = await post(target.mf, route, value)
      assert.equal(blocked.status, 429); assert.match((await blocked.json() as { error: string }).error, /offline_fenced/)
    }
    const finalStats = await (await post(target.mf, '/test/storage-statistics', {})).json() as { writes: number }
    assert.equal(finalStats.writes, 0); assert.deepEqual(source.outbound, []); assert.deepEqual(target.outbound, [])
    assert.equal((await source.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
    assert.equal((await target.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
  } finally { await target.mf.dispose(); await source.mf.dispose() }
})
function post(mf: Miniflare, path: string, body: unknown) {
  return mf.dispatchFetch(`https://migration.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
function input(key: string): ModelRequest { return { reservationKey: key, sourceId, snapshotSha256, universityIds: ['runtime-school'], payload, pass: 'primary', lane: 'expansion' } }

test('real workerd migrates private DO history across namespaces, verifies real R2 evidence and never replays spent/unknown calls', { timeout: 120000 }, async t => {
  const script = await bundle(), source = await runtime(script, 'source')
  let target: Awaited<ReturnType<typeof runtime>> | undefined
  try {
    target = await runtime(script, 'target')
    await t.test('native read-only diagnostics distinguish long future permits from a real suspended cleanup operation', async () => {
      const future = Date.now() + 86400000, old = Date.now() - 60000
      const gate = { fetches: [{ token: 'PRIVATE-FUTURE-FETCH', host: 'PRIVATE.edu.cn', expiresAt: future }],
        models: [{ token: 'PRIVATE-FUTURE-MODEL', expiresAt: future + 1000 }], nextHost: {}, successes: 0, cooldownUntil: 0, modelLimit: 1 }
      await post(source.mf, '/test/seed', [{ key: 'gate', value: gate }])
      const freeze = await post(source.mf, '/model-state-migration/freeze', { migrationId }), observed = await freeze.json() as Record<string, unknown>
      assert.equal(freeze.status, 409); assert.equal(observed.activeOperations, 0)
      assert.equal(observed.activeFetchPermitCount, 1); assert.equal(observed.activeModelPermitCount, 1)
      assert.equal(observed.latestPermitExpiresAt, new Date(future + 1000).toISOString())
      assert.ok(Math.abs(Date.parse(String(observed.serverTime)) - Date.now()) < 10000)
      const readStatus = () => source.mf.dispatchFetch('https://migration.test/model-state-migration/status', { headers: { authorization: `Bearer ${admin}` } })
      const status = await (await readStatus()).json() as Record<string, unknown>
      assert.equal(status.activeFetchPermitCount, 1); assert.equal(status.activeModelPermitCount, 1)
      const sentinel = { ...gate, fetches: [{ token: 'PRIVATE-SENTINEL', expiresAt: Number.MAX_VALUE }] }
      await post(source.mf, '/test/seed', [{ key: 'gate', value: sentinel }])
      const sentinelSha = await digest(canonical(sentinel))
      for (const response of [await readStatus(), await post(source.mf, '/model-state-migration/freeze', { migrationId })]) {
        const observed = await response.json() as Record<string, unknown>
        assert.ok([200, 409].includes(response.status)); assert.equal(observed.activeOperations, 0)
        assert.equal(observed.activeFetchPermitCount, 1); assert.equal(observed.activeModelPermitCount, 1)
        assert.equal(observed.latestPermitExpiresAt, null); assert.equal(observed.maxPermitExpiryMilliseconds, Number.MAX_VALUE)
        assert.equal(observed.unrepresentablePermitExpiryCount, 1); assert.equal(observed.gateSha256, sentinelSha)
        assert.equal(JSON.stringify(observed).includes('PRIVATE-SENTINEL'), false)
      }
      const sentinelExport = await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })
      assert.equal(sentinelExport.status, 409); assert.equal((await sentinelExport.json() as { error: string }).error, 'model_state_migration_inflight')
      assert.equal((await (await readStatus()).json() as Record<string, unknown>).gateSha256, sentinelSha)
      const expired = { ...gate, fetches: [{ token: 'PRIVATE-EXPIRED-FETCH', expiresAt: old }], models: [] }
      await post(source.mf, '/test/seed', [{ key: 'gate', value: expired }])
      await post(source.mf, '/test/pause-transaction', {})
      const pending = post(source.mf, '/test/release', { token: 'unrelated-cleanup' })
      try {
        let blocked = false
        for (let i = 0; i < 100; i++) {
          blocked = (await (await post(source.mf, '/test/transaction-state', {})).json() as { blocked: boolean }).blocked
          if (blocked) break
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.equal(blocked, true, 'a real ModelAdmission operation must be suspended')
        const waiting = await post(source.mf, '/model-state-migration/freeze', { migrationId }), busy = await waiting.json() as Record<string, unknown>
        assert.equal(waiting.status, 409); assert.equal(busy.activeOperations, 1)
        assert.equal(busy.activeFetchPermitCount, 0); assert.equal(busy.activeModelPermitCount, 0)
        assert.equal(busy.latestPermitExpiresAt, new Date(old).toISOString())
        const busyStatus = await (await readStatus()).json() as Record<string, unknown>
        assert.equal(busyStatus.activeOperations, 1)
        assert.equal((await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })).status, 409)
        for (const value of ['PRIVATE-FUTURE-FETCH', 'PRIVATE-FUTURE-MODEL', 'PRIVATE.edu.cn', 'PRIVATE-EXPIRED-FETCH']) assert.equal(JSON.stringify([observed, status, busy, busyStatus]).includes(value), false)
      } finally { await post(source.mf, '/test/resume-transaction', {}) }
      assert.equal((await pending).status, 200)
      const drained = await post(source.mf, '/model-state-migration/freeze', { migrationId }), done = await drained.json() as Record<string, unknown>
      assert.equal(drained.status, 200); assert.equal(done.activeOperations, 0)
      assert.equal(done.activeFetchPermitCount, 0); assert.equal(done.activeModelPermitCount, 0); assert.equal(done.latestPermitExpiresAt, null)
    })
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

test('real workerd retires only a reviewed non-temporal FETCH slot and migrates the complete private audit and unchanged requests', { timeout: 120000 }, async t => {
  const script = await bundle(), source = await runtime(script, 'source'), target = await runtime(script, 'target')
  try {
    const at = Date.now(), frozenAt = new Date(at - 121000).toISOString()
    const gate = { fetches: [{ token: 'PRIVATE-NON-TEMPORAL-FETCH', host: 'private.edu.cn', expiresAt: Number.MAX_SAFE_INTEGER }, { token: 'PRIVATE-EXPIRED-FETCH', expiresAt: at - 1000 }],
      models: [{ token: 'PRIVATE-EXPIRED-MODEL', lane: 'maintenance', expiresAt: at - 1000 }], nextHost: { 'private.edu.cn': at + 50000 }, successes: 5, cooldownUntil: at + 50000, modelLimit: 1 }
    const lock = { version: 1, migrationId, sourceAccountId, targetAccountId, role: 'source', phase: 'frozen', frozenAt, pages: [],
      states: { send_started: 0, completed: 0, unknown: 0, known_failed: 0 }, entryCount: 0, requestCount: 0, gatePresent: false }
    const output = { facts: 'PRIVATE-ORIGINAL-PAID-EVIDENCE', exact: { zh: '原始事实', amount: 0 } }
    const artifact = canonical({ attemptId: 'native-original-1', output }), artifactSha256 = await digest(artifact), artifactKey = `maintenance/models/${'1'.repeat(64)}/${artifactSha256}.json`
    await source.bucket.put(artifactKey, artifact); await target.bucket.put(artifactKey, artifact)
    const requestSha256 = await digest(payload)
    const requests = ['completed', 'unknown', 'send_started', 'known_failed'].map((state, index) => ({ key: `request:${String(index + 1).repeat(64)}`,
      value: { state, attemptId: `native-original-${index + 1}`, requestSha256, attemptCount: 4,
        ...(state === 'known_failed' ? { retryable: true, notBefore: at + 3600000 } : {}),
        ...(state === 'completed' ? { result: { attemptId: 'native-original-1', output, artifactKey, artifactSha256, reused: false } } : {}) } }))
    await post(source.mf, '/test/seed', [{ key: '__model_state_migration_v1', value: lock }, { key: 'gate', value: gate }, ...requests])
    const summary = async () => {
      const response = await source.mf.dispatchFetch('https://migration.test/model-state-migration/ledger-summary', { headers: { authorization: `Bearer ${admin}` } })
      assert.equal(response.status, 200); return await response.json() as Record<string, unknown>
    }
    const endpoint = '/model-state-migration/non-temporal-fetch-permit-recovery'
    const operatorBody = (s: Record<string, unknown>) => ({ migrationId, operationId: 'native-root-reviewed-fetch-retirement', expectedGateSha256: s.gateSha256,
      expectedRequestLedgerSha256: s.requestLedgerSha256, expectedNonTemporalSlots: { fetch: 1, model: 0 }, observedAt: s.observedAt,
      operator: { operatorId: 'independent-local-native-test', decision: 'retire_non_temporal_fetch_slots_preserve_requests', reason: 'Observed MAX_SAFE non-temporal FETCH; all paid request outcomes remain intact.', reviewedAt: new Date().toISOString() } })
    let before: Record<string, unknown>, body: ReturnType<typeof operatorBody>, result: Record<string, unknown>
    await t.test('a temporal future model slot and an unrepresentable model slot both hold before mutation', async () => {
      for (const expiresAt of [Date.now() + 60000, Number.MAX_SAFE_INTEGER]) {
        await post(source.mf, '/test/seed', [{ key: 'gate', value: { ...gate, models: [{ token: 'PRIVATE-MODEL-HOLD', expiresAt }] } }])
        const s = await summary(); assert.equal(s.eligible, false)
        const denied = await post(source.mf, endpoint, operatorBody(s)); assert.equal(denied.status, 409)
        const error = await denied.json() as { error: string }
        assert.match(error.error, /normal_permits_active|model_permit_requires_separate_review/)
      }
      await post(source.mf, '/test/seed', [{ key: 'gate', value: gate }])
    })
    await t.test('only explicit authenticated fresh gate and full-ledger CAS can retire the anomalous FETCH', async () => {
      before = await summary(); assert.equal(before.complete, true); assert.equal(before.eligible, true); assert.equal(before.requestCount, 4)
      assert.equal(before.gateSha256, await digest(canonical(gate)))
      const unauthenticated = await source.mf.dispatchFetch('https://migration.test' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(operatorBody(before)) })
      assert.equal(unauthenticated.status, 401)
      const wrong = await post(source.mf, endpoint, { ...operatorBody(before), expectedRequestLedgerSha256: '0'.repeat(64) }); assert.equal(wrong.status, 409)
      assert.equal((await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })).status, 409)
      body = operatorBody(await summary())
      const response = await post(source.mf, endpoint, body); result = await response.json() as Record<string, unknown>
      assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.reused, false); assert.equal(result.requestLedgerSha256, before.requestLedgerSha256)
      assert.deepEqual(result.retiredSlots, { fetch: 1, model: 0 }); assert.equal(result.sourceUnlocked, false)
      const repeat = await post(source.mf, endpoint, body); assert.equal(repeat.status, 200); assert.equal((await repeat.json() as { reused: boolean }).reused, true)
      const after = await summary(); assert.equal(after.requestLedgerSha256, before.requestLedgerSha256); assert.equal(after.recoveryRecorded, true)
      for (const marker of ['PRIVATE-', 'private.edu.cn', 'request:', '原始事实']) assert.equal(JSON.stringify([before, result, after]).includes(marker), false)
    })
    await t.test('existing full DO migration preserves gate audit, every request value, model counters and source freeze', async () => {
      const exportedResponse = await post(source.mf, '/model-state-migration/export', { migrationId, pageIndex: 0 })
      assert.equal(exportedResponse.status, 200)
      const exported = await exportedResponse.json() as { pageBytes: string; pageSha256: string; manifest: unknown; manifestSha256: string }
      const entries = (JSON.parse(exported.pageBytes) as { entries: Array<{ key: string; value: unknown }> }).entries
      assert.deepEqual(entries.filter(entry => entry.key.startsWith('request:')), requests)
      const exportedGate = entries.find(entry => entry.key === 'gate')!.value as Record<string, unknown>, audit = exportedGate.nonTemporalFetchPermitRecovery as Record<string, unknown>
      assert.equal(audit.originalGateJson, canonical(gate)); assert.equal(audit.originalGateSha256, before.gateSha256)
      assert.equal(audit.beforeRequestLedgerSha256, before.requestLedgerSha256); assert.equal(audit.afterRequestLedgerSha256, before.requestLedgerSha256)
      assert.deepEqual(exportedGate.models, gate.models); assert.equal(exportedGate.modelLimit, gate.modelLimit); assert.equal(exportedGate.cooldownUntil, gate.cooldownUntil); assert.equal(exportedGate.successes, gate.successes)
      assert.deepEqual(audit.removedSlots, [{ kind: 'fetch', index: 0, permit: gate.fetches[0] }])
      assert.equal((await post(target.mf, '/model-state-migration/import', { migrationId, ...exported })).status, 200)
      assert.equal((await post(target.mf, '/model-state-migration/finalize', { migrationId, manifestSha256: exported.manifestSha256 })).status, 200)
      const targetRaw = await (await post(target.mf, '/test/read-private-state', {})).json() as { entries: Array<[string, unknown]> }
      const values = new Map(targetRaw.entries)
      assert.deepEqual(values.get('gate'), exportedGate)
      for (const request of requests) assert.deepEqual(values.get(request.key), request.value)
      assert.equal((await post(source.mf, endpoint, body)).status, 409, 'an exported namespace cannot be changed by a recovery retry')
      await post(source.mf, '/test/activate', {}); await post(target.mf, '/test/activate', {})
      assert.equal((await post(source.mf, '/test/model', input('2'.repeat(64)))).status, 409)
      for (const key of ['2', '3']) {
        const replay = await post(target.mf, '/test/model', input(key.repeat(64))); assert.equal(replay.status, 409)
        assert.equal((await replay.json() as { error: string }).error, 'prior_model_outcome_requires_review')
      }
      assert.deepEqual(source.outbound, []); assert.deepEqual(target.outbound, [])
      assert.equal((await source.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
      assert.equal((await target.db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first<{ n: number }>())?.n, 0)
    })
  } finally { await target.mf.dispose(); await source.mf.dispose() }
})
