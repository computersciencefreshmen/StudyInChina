import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { buildFixtureFinalReceipt, buildLegacyReconciliationFixture, FIXTURE_NOW, fixtureBinding, fixtureEnv, fixtureGuard } from './legacy-reconciliation-fixture'
import { canonical } from '../src/util'

const admin = 'test-native-reconciliation-admin-no-real-secret'
async function bundle() {
  return (await build({ stdin: { contents: `
    import {ModelAdmission} from './admission'
    import {handleFetch} from './index'
    import {handleLegacyReconciliation} from './legacy-reconciliation-do'
    import {MODEL_STATE_MIGRATION_KEY} from './model-state-migration'
    export class FixtureAdmission extends ModelAdmission {
      constructor(state,env){super(state,env);this.fixtureStorage=state.storage;this.fixtureEnv=env}
      async fetch(request){const path=new URL(request.url).pathname
        if(path.startsWith('/test/')){
          if(request.headers.get('authorization')!=='Bearer '+this.fixtureEnv.MAINTENANCE_ADMIN_TOKEN)return new Response(null,{status:401})
          if(path==='/test/seed'){for(const e of await request.json())await this.fixtureStorage.put(e.key,e.value);return Response.json({ok:true})}
          if(path==='/test/read')return Response.json([...await this.fixtureStorage.list()])
          if(path==='/test/protocol'){
            const {phase,body}=await request.json()
            // Trusted fixture-only injection. Production routes below always
            // use the real immutable registration reader, tested as rejection.
            try{return Response.json(await handleLegacyReconciliation(this.fixtureStorage,this.fixtureEnv,${JSON.stringify(fixtureBinding)},MODEL_STATE_MIGRATION_KEY,
              '/model-state-migration/reconciliation-'+phase,body,()=>0,${FIXTURE_NOW},async()=>(${JSON.stringify(fixtureGuard)})))}catch(error){return Response.json({code:error.code??error.message},{status:409})}
          }
        }return super.fetch(request)
      }
    }
    export default {fetch(request,env){const path=new URL(request.url).pathname;if(path.startsWith('/test/'))return env.MODEL_ADMISSION.get(env.MODEL_ADMISSION.idFromName('subscription-account-v1')).fetch(request);return handleFetch(request,env)}}
  `, sourcefile: 'legacy-reconciliation-native-fixture.ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false })).outputFiles[0].text
}

test('real workerd/D1/R2: native conditional promotion, 171 exact cache adoptions and final event close intent only after last verification; no egress', { timeout: 120000 }, async () => {
  const data = await buildLegacyReconciliationFixture(), outbound: string[] = []
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'legacy-reconciliation-native', modules: true, script: await bundle(), compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { ...fixtureEnv, MAINTENANCE_ADMIN_TOKEN: admin, MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_SUBSCRIPTION_KEY: 'test-no-real-key' },
    durableObjects: { MODEL_ADMISSION: { className: 'FixtureAdmission', useSQLite: true } }, d1Databases: { PIPELINE_DB: 'legacy-native-test' }, r2Buckets: { SNAPSHOTS_BUCKET: 'legacy-native-test-bucket' },
    outboundService: async request => { outbound.push(request.url); return new WorkerResponse('unexpected provider call', { status: 500 }) } }))
  const headers = { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }
  const dispatch = (path: string, body?: unknown) => mf.dispatchFetch('https://fixture.test' + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  type Result = { nextOffset: number | null; promotedCount: number; adoptedCount: number; finalized: boolean; adoptedLedgerSha256: string | null; code?: string }
  const body = (offset = 0, extra = {}) => ({ migrationId: fixtureBinding.migrationId, reconciliationSha256: data.sha, offset, ...extra })
  const call = async (phase: string, offset = 0, extra = {}) => { const response = await dispatch('/test/protocol', { phase, body: body(offset, extra) }); const result = await response.json() as Result; assert.equal(response.status, 200, JSON.stringify(result)); return result }
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB'), bucket = await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as {
      put(key: string, value: string): Promise<unknown>; get(key: string): Promise<{ text(): Promise<string> } | null> }
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      for (const statement of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8').replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    for (let offset = 0; offset < data.sql.length; offset += 40) await db.batch(data.sql.slice(offset, offset + 40).map(item => db.prepare(item.sql).bind(...item.values)))
    for (const [key, value] of data.objects) await bucket.put(key, value)
    assert.equal((await dispatch('/test/seed', data.entries)).status, 200)
    const before = await db.prepare('SELECT * FROM maintenance_model_attempts ORDER BY attempt_id').all()
    // Actual production HTTP -> admission -> model-state-migration -> protocol.
    const history = await dispatch('/model-state-migration/reconciliation-promote', body())
    assert.equal(history.status, 200, await history.text())
    const first = await dispatch('/model-state-migration/reconciliation-promote', body())
    assert.equal(first.status, 200); assert.equal((await first.json() as Result).promotedCount, 8)
    const firstArtifact = data.manifest.artifacts[0]
    assert.equal(await (await bucket.get(firstArtifact.objectKey))!.text(), data.objects.find(([key]) => key.endsWith(`/blobs/${firstArtifact.sha256}.bin`))![1])
    let promoted = await call('promote'); while (promoted.nextOffset !== null) promoted = await call('promote', promoted.nextOffset)
    // Production endpoint cannot use the fixture's injected verifier.
    const unregistered = await dispatch('/model-state-migration/reconciliation-adopt', body())
    assert.equal(unregistered.status, 409)
    assert.equal((await unregistered.json() as { error: string }).error, 'legacy_model_guard_package_mismatch')
    let adopted = await call('adopt'); while (adopted.nextOffset !== null) adopted = await call('adopt', adopted.nextOffset)
    assert.equal(adopted.adoptedCount, 171); assert.ok(adopted.adoptedLedgerSha256)
    const final = await buildFixtureFinalReceipt(data.p, data.sha, adopted.adoptedLedgerSha256!)
    await bucket.put(final.objectKey, final.text)
    await db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(final.eventId, 'legacy_offline_reconciliation', new Date(FIXTURE_NOW).toISOString(), final.text).run()
    let result = await call('finalize', 0, { receiptSha256: final.receiptSha })
    const partial = new Map(await (await dispatch('/test/read')).json() as Array<[string, Record<string, unknown>]>)
    assert.ok(partial.get('gate')?.offlineFence); assert.equal(result.finalized, false)
    while (result.nextOffset !== null) result = await call('finalize', result.nextOffset, { receiptSha256: final.receiptSha })
    assert.equal(result.finalized, true)
    const all = new Map(await (await dispatch('/test/read')).json() as Array<[string, Record<string, unknown>]>)
    assert.equal(all.get('gate')?.offlineFence, undefined); assert.ok(all.get('gate')?.legacyOfflineReconciliation)
    assert.equal(all.get(`legacy-reconciliation-archive:${data.sha}`)?.originalGateJson, canonical(data.gate))
    for (const item of data.auxiliary) assert.deepEqual(all.get(item.key), item.value)
    for (const r of data.manifest.requestReservations.filter(r => r.state === 'known_failed')) assert.equal(all.get(`request:${r.reservationKey}`)?.retryable, false)
    assert.equal(all.size, data.entries.length + 171 + 2)
    assert.deepEqual((await db.prepare('SELECT * FROM maintenance_model_attempts ORDER BY attempt_id').all()).results, before.results)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='offline_handoff_applied'").first<{ n: number }>())?.n, 0)
    assert.deepEqual(outbound, [])
  } finally { await mf.dispose() }
})
