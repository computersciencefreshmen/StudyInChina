import assert from 'node:assert/strict'
import test from 'node:test'
import { storeSicasEvidence } from '../src/provider-evidence'
import { handleFetch } from '../src/index'
import type { MaintenanceEnv } from '../src/types'
import { digest } from '../src/util'

test('source archive verifies origin, bytes, digest and storage namespace and requires maintenance auth', async () => {
  const original = new TextEncoder().encode('<p>真实专业</p>'), hash = await digest(original)
  const sourceUrl = 'https://www.sicas.com.cn/School/58/School/42/Finance'
  const path = `https://maintenance.test/provider-evidence/sicas/${hash}`
  const req = (source = sourceUrl) => new Request(path, {
    method: 'POST', body: original, headers: { 'content-type': 'application/octet-stream', 'x-source-url': source } })
  const writes: string[] = []
  const env = { MAINTENANCE_ADMIN_TOKEN: 'sample-admin-for-local-test-only',
    SNAPSHOTS_BUCKET: { get: async () => null, put: async (key: string, data: Uint8Array, options: { onlyIf: unknown }) => {
      assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' }); assert.deepEqual(data, original); writes.push(key)
    } } } as unknown as MaintenanceEnv
  assert.equal((await handleFetch(req(), env)).status, 401)
  assert.equal((await storeSicasEvidence(req('https://elsewhere.invalid/data'), env, hash)).status, 400)
  assert.equal((await storeSicasEvidence(req(), env, '1'.repeat(64))).status, 422)
  assert.equal(writes.length, 0)
  const receipt = await storeSicasEvidence(req(), env, hash)
  assert.deepEqual(await receipt.json(), { stored: true, sourceUrl, sha256: hash, bytes: original.length })
  assert.deepEqual(writes, [`maintenance/provider-evidence/sicas/${hash.slice(0, 2)}/${hash}.bin`])
})
