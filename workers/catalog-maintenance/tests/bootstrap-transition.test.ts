import assert from 'node:assert/strict'
import test from 'node:test'
import manifest from '../../../content/maintenance/head-reconciliation-2026-11-10.v1.json'
import { runCloudTick } from '../src/runtime'
import { control, seed, setControls } from '../src/repository'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { canonical, digest } from '../src/util'
import { makeEnv, seedInput } from './fixture'

/** Start with the already-restored old cohort; these are retained resume/seed identities. */
async function restoredOldBootstrap() {
  let networkCalls = 0
  const f = makeEnv(async () => { networkCalls++; throw new Error('unexpected_network') })
  f.env.SCOPE_REGISTRY_SHA256 = manifest.scopeRegistrySha256
  await seed(f.env, { ...seedInput(), scopeRegistrySha256: manifest.scopeRegistrySha256, inputCatalogSha256: manifest.oldInputCatalogSha256 })
  const initial = await control(f.env); assert.ok(initial)
  await setControls(f.env, { expectedRevision: initial.revision, legacyGuardSha256: initial.legacy_guard_sha256,
    enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  const cfg = await control(f.env); assert.ok(cfg)
  const originalControl = { ...cfg, revision: 1, targets_complete: 1, scope_sha256: manifest.scopeRegistrySha256,
    seed_sha256: manifest.seedSha256, legacy_guard_sha256: manifest.legacyGuardSha256, input_catalog_sha256: manifest.oldInputCatalogSha256 }
  const proof = { phase: 'resume', manifestSha256: manifest.sha256, createdAt: '2026-11-10T10:00:00.000Z',
    originalControl, pausedRevision: 2, reconciledRevision: 4, restoredRevision: 6 }
  const sha256 = await digest(canonical(proof)), objectKey = `maintenance/reconciliation/${manifest.operationId}/resume/${sha256}.json`
  await f.bucket.put(objectKey, canonical(proof))
  f.db.sqlite.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').run(`${manifest.operationId}:resume`, 'native_git_head_resume', proof.createdAt, canonical({ proof, sha256, objectKey }))
  f.db.sqlite.prepare('UPDATE maintenance_control SET revision=6,input_catalog_sha256=?,seed_sha256=?,legacy_guard_sha256=?')
    .run(manifest.newInputCatalogSha256, manifest.seedSha256, manifest.legacyGuardSha256)
  const envelopeSha256 = 'e'.repeat(64)
  const pointer = { format: 'studyinchina.pending-bootstrap', version: 1,
    envelopeKey: `maintenance/bootstrap-pending/envelopes/${envelopeSha256}.json`, envelopeSha256,
    seedSha256: manifest.seedSha256, scopeRegistrySha256: manifest.scopeRegistrySha256,
    activation: { canaryUniversityIds: ['uni-000'], modelsEnabled: true } }
  const savePointer = () => f.bucket.put('maintenance/bootstrap-pending/initial.v1.json', canonical(pointer))
  await savePointer()
  // Deployment pins may move before the additive CAS or its migration exists.
  f.env.SCOPE_REGISTRY_SHA256 = EXISTING_SCHOOLS_V2_SHA256
  f.env.SCOPE_SCHOOL_COUNT = '295'
  f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED = 'true'
  f.db.sqlite.exec('DROP TABLE maintenance_scope_upgrades')
  return { ...f, pointer, savePointer, resumeObjectKey: objectKey, networkCalls: () => networkCalls }
}

test('a real cloud tick settles the verified old bootstrap cohort under the fixed new pin before completed lineage exists', async () => {
  const f = await restoredOldBootstrap()
  try {
    const tick = await runCloudTick(f.env)
    assert.equal(tick.state, 'running'); assert.equal(tick.code, 'bounded_scheduler_completed'); assert.ok((tick.queued ?? 0) > 0)
    assert.ok(tick.receiptSha256); assert.equal((await control(f.env))?.scope_sha256, manifest.scopeRegistrySha256)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get()?.n, 272)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
    assert.ok(f.messages.some(message => !message.scopeUpgradeSha256)); assert.equal(f.networkCalls(), 0)
  } finally { f.db.sqlite.close() }
})

for (const corruption of ['foreign-scope', 'mismatched-seed', 'missing-resume-archive'] as const) {
  test(`the transition tick rejects ${corruption} without scheduling or enabling the larger scope`, async () => {
    const f = await restoredOldBootstrap()
    try {
      if (corruption === 'foreign-scope') f.pointer.scopeRegistrySha256 = 'f'.repeat(64)
      if (corruption === 'mismatched-seed') f.pointer.seedSha256 = 'd'.repeat(64)
      if (corruption === 'missing-resume-archive') f.bucket.objects.delete(f.resumeObjectKey)
      await f.savePointer()
      const tick = await runCloudTick(f.env)
      assert.equal(tick.state, 'error'); assert.equal(tick.code, 'pending_bootstrap_pointer_invalid')
      assert.equal(f.messages.length, 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n, 0)
      assert.equal((await control(f.env))?.scope_sha256, manifest.scopeRegistrySha256)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get()?.n, 272)
      assert.equal(f.networkCalls(), 0)
    } finally { f.db.sqlite.close() }
  })
}
