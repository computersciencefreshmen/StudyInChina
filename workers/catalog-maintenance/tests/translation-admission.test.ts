import assert from 'node:assert/strict'
import test from 'node:test'
import { seed, setControls } from '../src/repository'
import { gateRequest } from '../src/util'
import { makeEnv, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

test('translation shares active model count, account cooldown and protects unknowns after lease release', async () => {
  let pct = 5
  const f = makeEnv(async () => quotaResponse(pct))
  try {
    await seed(f.env, seedInput())
    await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: false, canaryUniversityIds: ['uni-000'] })
    const acquire = (k: string) => gateRequest(f.env, '/translation/acquire', { requestSha256: k.repeat(64) })
    const settle = (k: string, permit: string, outcome: string) => gateRequest(f.env, '/translation/settle', { requestSha256: k.repeat(64), permit, outcome, retrySeconds: 90 })
    assert.equal((await (await acquire('1')).json() as { error: string }).error, 'translation_lane_disabled')
    f.env.TRANSLATION_ADMISSION_ENABLED = 'true'
    const enabled = f.env.MAINTENANCE_ENABLED
    f.env.MAINTENANCE_ENABLED = 'false'
    assert.equal((await (await acquire('1')).json() as { error: string }).error, 'model_lane_disabled')
    f.env.MAINTENANCE_ENABLED = enabled
    assert.equal((await acquire('1')).status, 429)
    pct = 95
    const first = await (await acquire('1')).json() as { permit: string }, second = await (await acquire('2')).json() as { permit: string }
    assert.ok(first.permit); assert.ok(second.permit)
    assert.equal((await (await gateRequest(f.env, '/status', {})).json() as { activeModels: number }).activeModels, 2)
    assert.equal((await acquire('3')).status, 429)
    assert.equal((await settle('1', first.permit, 'unknown')).status, 200)
    assert.equal((await acquire('1')).status, 409)
    assert.equal((await settle('2', second.permit, 'rate_limited')).status, 200)
    assert.equal((await acquire('3')).status, 429)
    const status = await (await gateRequest(f.env, '/status', {})).json() as { activeModels: number; cooldownUntil: string }
    assert.equal(status.activeModels, 0); assert.ok(Date.parse(status.cooldownUntil) > Date.now())
  } finally { f.db.sqlite.close() }
})
