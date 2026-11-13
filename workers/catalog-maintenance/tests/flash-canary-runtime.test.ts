import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { canonical, digest } from '../src/util'
import { FLASH_MODEL } from '../src/flash-canary'
import type { CapturedSnapshot } from '../src/capture'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'

const admin = 'flash-native-test-admin-not-a-real-secret', sourceId = 'd'.repeat(64), rawSha = 'e'.repeat(64), scope = 'a'.repeat(64)
const text = 'International students applying to Computer Science. Autumn 2027 admissions. Application deadline: 2027-09-30.'
type NativeBucket = { put(key: string, body: string): Promise<unknown>; get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null> }

test('real workerd field engine completes the two-pass Flash profile through native DO, D1 and R2 with no external networking', { timeout: 120000 }, async t => {
  const textSha = await digest(text), snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha}.json`
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: 'https://runtime-test.edu.cn/catalog', finalUrl: 'https://runtime-test.edu.cn/catalog', checkedAt: new Date().toISOString(),
    contentType: 'text/plain', rawSha256: rawSha, rawKey: `maintenance/raw/${rawSha}`, textKey: `maintenance/text/${textSha}`, textSha256: textSha, canonicalSha256: textSha, parserCandidates: [] }
  const target: MaintenanceRecordTarget = { recordId: 'cycle-computer-science', universityId: 'runtime-school', entityType: 'admission-cycle', sourceIds: [sourceId], recordScopeSha256: 'f'.repeat(64),
    identity: { programId: 'prog-computer-science', name: { en: 'Computer Science' }, degreeLevel: 'bachelor' }, year: '2027-2028', intake: 'autumn', reviewAfter: '2026-11-14', fields: {} }
  const config = { version: 1, id: 'native-flash-canary-2026', sourceId, snapshotSha256: rawSha, textSha256: textSha, recordIds: [target.recordId] }
  const bundled = await build({ stdin: { sourcefile: 'native-flash-trial-entry.ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts', contents: `
    import { ModelAdmission } from './admission'
    import { maintainFields } from './field-updates'
    import { source } from './repository'
    import { authorized } from './util'
    export { ModelAdmission }
    export default { async fetch(request, env) {
      if (!authorized(request, env)) return new Response(null, {status:401})
      if (new URL(request.url).pathname !== '/test/field-job') return new Response(null, {status:404})
      const snapshot = ${JSON.stringify(snapshot)}, target = ${JSON.stringify(target)}
      const row = await source(env, snapshot.sourceId)
      const job = {job_id:'native-flash-field-job',source_id:snapshot.sourceId,stage:'maintain',snapshot_sha256:snapshot.rawSha256,snapshot_key:${JSON.stringify(snapshotKey)}}
      return Response.json(await maintainFields(env, job, row, snapshot, [target]))
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const calls: Array<{ url: string; body: string }> = []
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'native-flash-canary-test', modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false },
    bindings: { MAINTENANCE_ADMIN_TOKEN: admin, MINIMAX_SUBSCRIPTION_KEY: 'native-flash-fake-subscription-not-a-real-key', MINIMAX_MODEL: 'MiniMax-M3',
      MINIMAX_ANTHROPIC_BASE: 'https://api.minimaxi.com/anthropic', MAINTENANCE_ENABLED: 'true', MINIMAX_FLASH_CANARY: canonical(config), MINIMAX_CREDIT_FALLBACK_DISABLED: 'false',
      // The production native-head guard remains unchanged; this isolated
      // transport fixture uses its existing explicit deployment opt-out.
      NATIVE_HEAD_RECONCILIATION_REQUIRED: 'false', SCOPE_REGISTRY_SHA256: scope },
    durableObjects: { MODEL_ADMISSION: { className: 'ModelAdmission', useSQLite: true } }, d1Databases: { PIPELINE_DB: 'native-flash-db' }, r2Buckets: { SNAPSHOTS_BUCKET: 'native-flash-r2' },
    outboundService: async request => {
      const body = await request.text(); calls.push({ url: request.url, body })
      if (request.url === 'https://api.minimax.cn/v1/token_plan/remains') {
        const now = Date.now(), hour = 3600000
        return WorkerResponse.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general', current_interval_status: 1,
          current_interval_remaining_percent: 80, start_time: now - hour, end_time: now + 4 * hour, current_weekly_status: 3 }] })
      }
      if (request.url === 'https://api.minimaxi.com/anthropic/v1/messages') return WorkerResponse.json({ model: FLASH_MODEL, stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: 'test-only reasoning' }, { type: 'text', text: JSON.stringify({ records: [{ recordId: target.recordId, year: target.year, intake: target.intake,
          applicabilityQuote: 'International students applying to Computer Science.', scopeQuote: 'Autumn 2027 admissions.', patches: [{ fieldPath: 'closesOn', value: '2027-09-30', factStatus: 'known', quote: 'Application deadline: 2027-09-30.' }] }] }) }], usage: { input_tokens: 3, output_tokens: 7 } })
      return new WorkerResponse('unexpected test destination', { status: 500 })
    },
  }))
  try {
    await mf.ready
    const db = await mf.getD1Database('PIPELINE_DB'), bucket = await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as NativeBucket
    for (const migration of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const sql = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${migration}`, import.meta.url), 'utf8')
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    await db.prepare("INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,canary_json,updated_at) VALUES(1,?,?,?,?,1,1,1,1,'[]',?)")
      .bind(scope, 'b'.repeat(64), 'c'.repeat(64), 'f'.repeat(64), new Date().toISOString()).run()
    await db.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?,?,?,?)').bind('runtime-school', '{"en":"Runtime Test"}', '{}', scope).run()
    await db.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,snapshot_key) VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?)")
      .bind(sourceId, snapshot.sourceUrl, '["runtime-test.edu.cn"]', new Date().toISOString(), rawSha, snapshotKey).run()
    await db.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').bind(sourceId, 'runtime-school').run()
    await db.prepare('INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(`admission-cycle:${target.recordId}`, target.recordId, target.entityType, target.universityId, target.recordScopeSha256, target.year, target.intake, '{}', canonical(target)).run()
    await db.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').bind(`admission-cycle:${target.recordId}`, sourceId).run()
    await bucket.put(snapshotKey, canonical(snapshot)); await bucket.put(snapshot.textKey!, text)
    const run = () => mf.dispatchFetch('https://native.test/test/field-job', { method: 'POST', headers: { authorization: `Bearer ${admin}` } })
    await t.test('native transaction list and field admission produce exactly two Flash attempts', async () => {
      const response = await run(), result = await response.json() as { proposals: unknown[]; held: unknown[] }
      assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.proposals.length, 1); assert.deepEqual(result.held, [])
      assert.equal(calls.length, 4); const modelCalls = calls.filter(call => call.body)
      assert.equal(modelCalls.length, 2)
      for (const call of modelCalls) { const wire = JSON.parse(call.body); assert.equal(wire.model, FLASH_MODEL); assert.deepEqual(wire.thinking, { type: 'adaptive' }); assert.deepEqual(wire.output_config, { effort: 'low' }); assert.equal(wire.temperature, undefined) }
    })
    await t.test('real SQL and R2 preserve actual model/profile/body hashes and only independently quoted fields', async () => {
      const rows = (await db.prepare('SELECT model,status,quota_json,output_key FROM maintenance_model_attempts ORDER BY rowid').all<{ model: string; status: string; quota_json: string; output_key: string }>()).results
      const sent = calls.filter(call => call.body)
      assert.equal(rows.length, 2)
      for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i].model, FLASH_MODEL); assert.equal(rows[i].status, 'completed')
        const profile = JSON.parse(rows[i].quota_json).modelProfile; assert.equal(profile.providerRequestSha256, await digest(sent[i].body))
        const artifact = JSON.parse(await (await bucket.get(rows[i].output_key))!.text())
        assert.equal(artifact.modelProfile.responseModel, FLASH_MODEL); assert.equal(artifact.modelProfile.profileSha256, profile.profileSha256)
      }
    })
    await t.test('a repeated normal job reuses both original reservations without quota or model requests', async () => {
      const count = calls.length, result = await (await run()).json() as { proposals: unknown[] }
      assert.equal(result.proposals.length, 1); assert.equal(calls.length, count)
    })
  } finally { await mf.dispose() }
})
