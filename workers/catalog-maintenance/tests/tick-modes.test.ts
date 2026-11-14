import assert from 'node:assert/strict'
import test from 'node:test'
import { control, enqueueDue, seed, setControls } from '../src/repository'
import { runCloudTick, registerBootstrapRequest } from '../src/runtime'
import { handleFetch, processMessage } from '../src/index'
import { BUDGET_POLICY_KEY } from '../../shared/background-budget'
import { digest } from '../src/util'
import { makeEnv, seedInput, TEST_CATALOG, TEST_GUARDS, TEST_SCOPE } from './fixture'
import { requestIsolatedTick } from '../../../scripts/automation/catalog-maintenance-client'

const canary = ['uni-000','uni-001','uni-002','uni-003','uni-004']
async function ready() {
  const f = makeEnv(), input = seedInput()
  f.env.TICK_JOB_LIMIT = '32'
  for (let i = 0; i < 40; i++) input.schools[i].sourceSeeds = [{ id: `source-${i}`, url: `https://school-${i}.edu.cn/catalog`, allowedHosts: [`school-${i}.edu.cn`], sourceCategory: 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' }]
  await seed(f.env, input)
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: canary })
  await setControls(f.env, { expectedRevision: 1, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: [] })
  return { ...f, input }
}
function dataWrites(f: ReturnType<typeof makeEnv>) {
  const statements: string[] = [], prepare = f.db.prepare.bind(f.db)
  f.db.prepare = sql => { if (/^(?:INSERT|UPDATE|DELETE)/i.test(sql.trim())) statements.push(sql); return prepare(sql) }
  return statements
}

test('dispatch-only ignores all administrative pointers and dispatches at most 32 ordinary jobs without altering controls', async () => {
  const f = await ready()
  try {
    for (const key of ['maintenance/scope-upgrades/pending.json','maintenance/bootstrap-pending/initial.v1.json','maintenance/bootstrap-pending/upload.v1.json']) await f.bucket.put(key, 'invalid administrative pointer must never be read')
    const before = JSON.stringify(await control(f.env)), writes = dataWrites(f), get = f.bucket.get.bind(f.bucket)
    f.bucket.get = async key => { assert.ok(!key.startsWith('maintenance/scope-upgrades/') && !key.startsWith('maintenance/bootstrap-pending/') && !key.startsWith('maintenance/runtime/budget-queue-holds/')); return get(key) }
    const result = await runCloudTick(f.env, 'dispatch_only')
    assert.equal(result.mode, 'dispatch_only'); assert.equal(result.state, 'running'); assert.equal(result.queued, 32); assert.equal(f.messages.length, 32)
    assert.ok(f.messages.every(message => Object.keys(message).sort().join(',') === 'jobId,version'))
    assert.equal(JSON.stringify(await control(f.env)), before)
    assert.ok(writes.every(sql => /^(?:INSERT(?: OR IGNORE)? INTO maintenance_jobs|UPDATE maintenance_jobs|INSERT INTO maintenance_events)/i.test(sql.trim())), writes.join('\n'))
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count, 0)
  } finally { f.db.sqlite.close() }
})

test('dispatch-only fresh incomplete control never queues seed or staged targets, including readiness changing between reads', async () => {
  for (const field of ['seed_complete', 'targets_complete'] as const) {
    const f = await ready()
    try {
      f.db.sqlite.prepare("INSERT INTO maintenance_target_refreshes VALUES(?,?,?,1,0,1,'staged',?)").run('e'.repeat(64), TEST_CATALOG, 'f'.repeat(64), new Date().toISOString())
      const prepare = f.db.prepare.bind(f.db); let controlReads = 0
      f.db.prepare = sql => { if (sql === 'SELECT * FROM maintenance_control WHERE singleton=1' && ++controlReads === 2) f.db.sqlite.exec(`UPDATE maintenance_control SET ${field}=0`); return prepare(sql) }
      const result = await runCloudTick(f.env, 'dispatch_only')
      assert.equal(result.code, 'administrative_continuation_required'); assert.equal(result.state, 'waiting_for_seed'); assert.equal(result.queued, 0); assert.equal(f.messages.length, 0)
      assert.equal(field === 'seed_complete' ? result.seedComplete : result.targetsComplete, false)
      const direct = await enqueueDue(f.env, Date.now(), 'dispatch_only'); assert.equal(direct.queued, 0)
      assert.equal((await control(f.env))!.revision, 2)
    } finally { f.db.sqlite.close() }
  }
  const empty = makeEnv()
  try { assert.equal((await runCloudTick(empty.env, 'dispatch_only')).queued, 0); assert.equal(empty.messages.length, 0); assert.equal(await control(empty.env), null) } finally { empty.db.sqlite.close() }
})

test('administrative-only never dispatches a ready source or overwrites ordinary health/soak observations', async () => {
  const f = await ready()
  try {
    const ordinary = await runCloudTick(f.env, 'dispatch_only'), before = new Map([...f.bucket.objects].filter(([key]) => /maintenance\/runtime\/(?:latest|days\/|first-eligible)/.test(key)).map(([key, bytes]) => [key, Buffer.from(bytes).toString('hex')]))
    f.messages.length = 0
    const result = await runCloudTick(f.env, 'administrative_only')
    assert.equal(result.mode, 'administrative_only'); assert.equal(result.code, 'administrative_no_work'); assert.equal(result.queued, 0); assert.equal(f.messages.length, 0)
    assert.ok(result.receiptKey.startsWith('maintenance/runtime/administrative-ticks/')); assert.ok(ordinary.receiptKey.startsWith('maintenance/runtime/ticks/'))
    for (const [key, bytes] of before) assert.equal(Buffer.from(f.bucket.objects.get(key)!).toString('hex'), bytes)
    assert.equal((await enqueueDue(f.env, Date.now(), 'administrative_only')).queued, 0)
  } finally { f.db.sqlite.close() }
})

test('administrative-only retains the real bootstrap continuation and activation, but sends no extra ordinary batch', async () => {
  const f = makeEnv(), input = seedInput()
  try {
    const body = JSON.stringify({ seed: input, activation: { canaryUniversityIds: canary, modelsEnabled: true } }), hash = await digest(body)
    await registerBootstrapRequest(f.env, new Request('https://worker/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-maintenance-bootstrap-sha256': hash, 'x-maintenance-scope-sha256': TEST_SCOPE, 'x-maintenance-canary-ids': canary.join(','), 'x-maintenance-models-enabled': 'true' }, body }))
    f.messages.length = 0
    assert.equal((await runCloudTick(f.env, 'dispatch_only')).queued, 0)
    assert.equal((await runCloudTick(f.env, 'administrative_only')).code, 'pending_bootstrap_validation_queued')
    await processMessage(f.env, f.messages.shift()!)
    assert.equal((await runCloudTick(f.env, 'administrative_only')).code, 'pending_bootstrap_seed_queued')
    for (let i = 0; f.messages.length && i < 16; i++) await processMessage(f.env, f.messages.shift()!)
    assert.equal((await control(f.env))!.enabled, 0)
    assert.equal((await runCloudTick(f.env, 'dispatch_only')).queued, 0)
    assert.equal((await control(f.env))!.enabled, 0)
    const activated = await runCloudTick(f.env, 'administrative_only')
    assert.equal(activated.queued, 0); assert.equal(f.messages.length, 0); assert.equal((await control(f.env))!.enabled, 1)
    assert.deepEqual(JSON.parse((await control(f.env))!.canary_json), canary)
  } finally { f.db.sqlite.close() }
})

test('both isolated modes retain budget holds and operator pauses without model calls', async () => {
  for (const mode of ['dispatch_only', 'administrative_only'] as const) {
    const f = await ready()
    try {
      await setControls(f.env, { expectedRevision: 2, legacyGuardSha256: TEST_GUARDS, enabled: false, modelsEnabled: false })
      const before = JSON.stringify(await control(f.env))
      assert.equal((await runCloudTick(f.env, mode)).queued, 0); assert.equal(JSON.stringify(await control(f.env)), before)
      await f.bucket.put(BUDGET_POLICY_KEY, '{}')
      assert.equal((await runCloudTick(f.env, mode)).state, 'budget_wait'); assert.equal(f.messages.length, 0)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('authenticated tick service enforces exact bounded modes and keeps the old empty-body full path', async () => {
  const f = await ready(), url = 'https://worker/tick', headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }
  try {
    const modes=await handleFetch(new Request(url,{headers}),f.env)
    assert.equal(modes.status,200);assert.deepEqual((await modes.json()).modes,['full','dispatch_only','administrative_only'])
    assert.equal((await handleFetch(new Request(url, { method: 'POST', body: '{"mode":"dispatch_only"}' }), f.env)).status, 401)
    for (const body of [{ mode: 'bad' }, { mode: ['dispatch_only'] }, { mode: 'dispatch_only', enabled: true }, null, 'dispatch_only']) {
      const response = await handleFetch(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), f.env)
      assert.equal(response.status, 409); assert.equal((await response.json()).error, 'tick_mode_invalid')
    }
    const administrative = await handleFetch(new Request(url, { method: 'POST', headers, body: '{"mode":"administrative_only"}' }), f.env)
    assert.equal(administrative.status, 200); assert.equal((await administrative.json()).queued, 0)
    const pathOnly=await handleFetch(new Request(url+'/administrative',{method:'POST',headers,body:'{}'}),f.env)
    assert.equal((await pathOnly.json()).mode,'administrative_only')
    const mismatched=await handleFetch(new Request(url+'/dispatch',{method:'POST',headers,body:'{"mode":"full"}'}),f.env)
    assert.equal(mismatched.status,409);assert.equal(f.messages.length,0)
    const legacy = await handleFetch(new Request(url, { method: 'POST', headers, body: '{}' }), f.env)
    assert.equal(legacy.status, 200); const full = await legacy.json(); assert.equal(full.queued, 32); assert.equal(full.mode, undefined)
  } finally { f.db.sqlite.close() }
})

test('a mixed-version capability GET followed by a legacy router cannot start an actual pending bootstrap', async () => {
  const f=makeEnv(), input=seedInput()
  try{
    const body=JSON.stringify({seed:input,activation:{canaryUniversityIds:canary,modelsEnabled:true}}),hash=await digest(body)
    await registerBootstrapRequest(f.env,new Request('https://worker/bootstrap',{method:'POST',headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),'x-maintenance-bootstrap-sha256':hash,'x-maintenance-scope-sha256':TEST_SCOPE,'x-maintenance-canary-ids':canary.join(','),'x-maintenance-models-enabled':'true'},body}))
    f.messages.length=0
    for(const mode of ['dispatch_only','administrative_only'] as const){
      await assert.rejects(requestIsolatedTick({async json(path,method){
        if(!method)return{format:'studyinchina.maintenance-tick-modes',version:1,modes:['dispatch_only','administrative_only']}
        // Preserve the real old full behavior if the client ever regresses to
        // its old URL: it would enqueue this verified raw bootstrap upload.
        if(path==='/tick')return runCloudTick(f.env)
        throw new Error('maintenance_http_404')
      }},mode),/maintenance_http_404/)
      assert.equal(f.messages.length,0);assert.equal(await control(f.env),null)
    }
  }finally{f.db.sqlite.close()}
})
