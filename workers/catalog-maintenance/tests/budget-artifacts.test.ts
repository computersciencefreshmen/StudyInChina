import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import { BUDGET_OBSERVATION_KEY, BUDGET_POLICY_KEY } from '../../shared/background-budget'
import { makeEnv } from './fixture'

const privateKeys = [BUDGET_POLICY_KEY, BUDGET_OBSERVATION_KEY,
  `maintenance/runtime/budget-observations/${'a'.repeat(64)}.json`,
  'maintenance/runtime/budget-observations/nested/private.json', 'maintenance/runtime/budget-observations/']

for (const key of privateKeys) test('private budget artifacts are rejected before any R2 access with a fixed secret-free 403', async () => {
  const f = makeEnv()
  let reads = 0
  try {
    await f.bucket.put(key, '{"accountId":"private-account-fixture","usageMicroDollars":4321987}')
    f.env.SNAPSHOTS_BUCKET.get = async () => { reads++; throw new Error('private artifacts must not be read') }
    const query = new URLSearchParams({ key })
    const response = await handleFetch(new Request(`https://maintenance.test/artifacts?${query}`, {
      headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` },
    }), f.env)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { ok: false, error: 'budget_artifact_private' })
    assert.equal(reads, 0)
  } finally { f.db.sqlite.close() }
})

test('an existing publication artifact remains readable through the authenticated artifact endpoint', async () => {
  const f = makeEnv(), key = 'maintenance/exports/published-candidate.json', contents = '{"format":"published-fixture"}'
  let reads = 0
  try {
    await f.bucket.put(key, contents)
    const get = f.bucket.get.bind(f.bucket)
    f.env.SNAPSHOTS_BUCKET.get = async requested => { reads++; assert.equal(requested, key); return get(requested) }
    const response = await handleFetch(new Request(`https://maintenance.test/artifacts?${new URLSearchParams({ key })}`, {
      headers: { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}` },
    }), f.env)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    assert.equal(await response.text(), contents)
    assert.equal(reads, 1)
  } finally { f.db.sqlite.close() }
})

test('the private-artifact guard preserves the existing authentication boundary', async () => {
  const f = makeEnv()
  let reads = 0
  try {
    f.env.SNAPSHOTS_BUCKET.get = async () => { reads++; throw new Error('unauthenticated R2 access') }
    const response = await handleFetch(new Request(`https://maintenance.test/artifacts?${new URLSearchParams({ key: BUDGET_POLICY_KEY })}`), f.env)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' })
    assert.equal(reads, 0)
  } finally { f.db.sqlite.close() }
})
