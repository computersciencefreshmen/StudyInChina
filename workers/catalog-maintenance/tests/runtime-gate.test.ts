import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import { runtimeGate } from '../src/runtime'
import { seed, setControls } from '../src/repository'
import { makeEnv, seedInput, TEST_GUARDS } from './fixture'

test('authenticated runtime gate reads exactly one control checkpoint without aggregates, R2 or model admission', async () => {
  const f = makeEnv()
  try {
    await seed(f.env, seedInput())
    await setControls(f.env, { expectedRevision: 0, enabled: true, modelsEnabled: true, legacyGuardSha256: TEST_GUARDS, canaryUniversityIds: seedInput().schools.slice(0, 5).map(school => school.universityId) })
    const prepare = f.db.prepare.bind(f.db), sql: string[] = []
    f.db.prepare = value => { sql.push(value); return prepare(value) }
    f.bucket.get = async () => { throw new Error('runtime_gate_must_not_read_bucket') }
    f.env.MODEL_ADMISSION.get = () => { throw new Error('runtime_gate_must_not_read_admission') }
    const url = 'https://maintenance.internal/runtime-gate'
    assert.equal((await handleFetch(new Request(url), f.env)).status, 401)
    assert.equal(sql.length, 0)
    const response = await handleFetch(new Request(url, { headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` } }), f.env)
    assert.equal(response.status, 200)
    const body = await response.json() as Awaited<ReturnType<typeof runtimeGate>>
    assert.equal(body.format, 'studyinchina.cloud-maintenance-runtime-gate')
    assert.equal(body.fullHealthChecked, false)
    assert.equal(body.enabled, true)
    assert.equal(body.scopeMatches, true)
    assert.equal(body.control?.revision, 1)
    assert.equal(body.control?.seed_complete, 1)
    assert.equal(body.control?.targets_complete, 1)
    assert.equal(sql.length, 1)
    assert.match(sql[0], /^SELECT scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,revision FROM maintenance_control WHERE singleton=1$/)
    assert.deepEqual(Object.keys(body.control!).sort(), ['scope_sha256','input_catalog_sha256','seed_sha256','legacy_guard_sha256','enabled','models_enabled','seed_complete','targets_complete','revision'].sort())
    const plan = f.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql[0]}`).all()
    assert.ok(plan.some(row => /SEARCH maintenance_control USING INTEGER PRIMARY KEY/.test(String(row.detail))))
  } finally { f.db.sqlite.close() }
})

test('runtime gate keeps uninitialized, wrong-scope and deployment-disabled controls closed', async () => {
  const f = makeEnv()
  try {
    const empty = await runtimeGate(f.env)
    assert.equal(empty.backend.state, 'ready')
    assert.equal(empty.control, null)
    assert.equal(empty.enabled, false)
    await seed(f.env, seedInput())
    await setControls(f.env, { expectedRevision: 0, enabled: true, modelsEnabled: true, legacyGuardSha256: TEST_GUARDS, canaryUniversityIds: seedInput().schools.slice(0, 5).map(school => school.universityId) })
    f.env.SCOPE_REGISTRY_SHA256 = 'f'.repeat(64)
    const wrong = await runtimeGate(f.env)
    assert.equal(wrong.scopeMatches, false)
    assert.equal(wrong.enabled, false)
    f.env.SCOPE_REGISTRY_SHA256 = seedInput().scopeRegistrySha256
    f.env.MAINTENANCE_ENABLED = 'false'
    assert.equal((await runtimeGate(f.env)).enabled, false)
  } finally { f.db.sqlite.close() }
})

test('runtime gate distinguishes explicit daily quota from generic D1 and SQL errors', async () => {
  const f = makeEnv()
  try {
    for (const [message, expected] of [
      ['D1 free tier daily row read limit exceeded; reset midnight UTC', 'quota_wait'],
      ['D1_ERROR: error code 7500', 'backend_unavailable'],
      ['D1_ERROR: no such column: broken', 'backend_unavailable'],
    ]) {
      f.db.prepare = () => { throw new Error(message) }
      const body = await runtimeGate(f.env)
      assert.equal(body.backend.state, expected)
      assert.equal(body.enabled, false)
      assert.equal(body.control, null)
      assert.equal(body.fullHealthChecked, false)
      assert.equal(body.backend.retryAt !== null, expected === 'quota_wait')
      assert.equal(JSON.stringify(body).includes(message), false)
    }
  } finally { f.db.sqlite.close() }
})
