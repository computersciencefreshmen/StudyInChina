import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import worker, { handleFetch, handleQueue } from '../src/index'
import type { MaintenanceBatch } from '../src/types'
import { makeEnv } from './fixture'

const protocol = [
  ['GET', '/model-state-migration/status'], ['GET', '/model-state-migration/gate-inspection'], ['GET', '/model-state-migration/ledger-summary'],
  ['POST', '/model-state-migration/freeze'], ['POST', '/model-state-migration/export'], ['POST', '/model-state-migration/import'],
  ['POST', '/model-state-migration/finalize'], ['POST', '/model-state-migration/non-temporal-fetch-permit-recovery'],
] as const
const databases: Array<ReturnType<typeof makeEnv>['db']> = []
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close() })
function fixture() {
  const f = makeEnv(); databases.push(f.db)
  const effects = { d1: 0, r2: 0, provider: 0, queue: 0, admission: [] as string[] }
  const blocked = (kind: 'd1' | 'r2' | 'queue') => () => { effects[kind]++; throw Error(`Frozen source touched ${kind}`) }
  f.env.PIPELINE_DB = { prepare: blocked('d1'), batch: blocked('d1') }
  f.env.SNAPSHOTS_BUCKET = { get: blocked('r2'), put: blocked('r2'), list: blocked('r2'), delete: blocked('r2') }
  f.env.MAINTENANCE_QUEUE = { send: blocked('queue') }
  f.env.MODEL_STATE_MIGRATION_ROLE = 'source'
  f.env.MODEL_STATE_MIGRATION_ID = 'source-entry-freeze-local-test'
  f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: async request => {
    effects.admission.push(new URL(request.url).pathname)
    return Response.json({ ok: true, protocolReached: true })
  } }) }
  const headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }
  const request = (method: string, path: string, authenticated = true, body = '{}') => handleFetch(new Request('https://worker' + path,
    { method, ...(authenticated ? { headers } : {}), ...(method === 'GET' || method === 'HEAD' ? {} : { body }) }), f.env)
  return { ...f, effects, request }
}
const noStorage = (f: ReturnType<typeof fixture>) => {
  assert.equal(f.effects.d1, 0); assert.equal(f.effects.r2, 0); assert.equal(f.effects.provider, 0); assert.equal(f.effects.queue, 0)
}

test('source auth and exact protocol allowlist precede all ordinary HTTP reads, writes, budget checks and backend recovery', async () => {
  const f = fixture()
  const routes = [
    ['POST', '/tick'], ['POST', '/budget/check'], ['POST', '/backend/recheck'], ['POST', '/budget'], ['POST', '/budget/resume'],
    ['GET', '/budget'], ['GET', '/quota'], ['GET', '/control'], ['POST', '/controls'], ['POST', '/head-reconcile'], ['POST', '/head-reconcile-targets'],
    ['GET', '/status'], ['GET', '/schools'], ['GET', '/health'], ['GET', '/artifacts?key=maintenance/runtime/private.json'],
    ['POST', '/scope-upgrades'], ['GET', '/scope-upgrades'], ['GET', '/job-dispositions'], ['POST', '/job-dispositions'],
    ['POST', '/rollout'], ['GET', '/rollout'], ['POST', '/ack'], ['POST', '/seed'], ['POST', '/bootstrap'], ['POST', '/coverage'],
    ['POST', '/targets'], ['POST', '/documents'], ['GET', '/documents'], ['POST', '/reconciliations'], ['POST', '/exports'],
    ['GET', '/exports/private'], ['GET', '/publications'], ['GET', '/proposals'], ['GET', '/unknown-route'],
    ...protocol.map(([method, path]) => [method === 'GET' ? 'POST' : 'GET', path]),
    ['GET', '/model-state-migration/status/'], ['POST', '/model-state-migration/export/'], ['HEAD', '/model-state-migration/status'],
  ]
  for (const [method, path] of routes) {
    const response = await f.request(method, path, true, 'invalid JSON must not be read')
    assert.equal(response.status, 503, `${method} ${path}`)
    assert.deepEqual(await response.json(), { ok: false, error: 'account_migration_frozen' })
  }
  assert.equal((await f.request('POST', '/tick', false)).status, 401)
  assert.equal((await f.request('GET', '/health', false)).status, 401)
  assert.deepEqual(f.effects.admission, []); noStorage(f)
})

test('all eight exact migration protocol methods remain reachable without pre-protocol D1, R2 or provider effects', async () => {
  const f = fixture()
  for (const [method, path] of protocol) {
    assert.equal((await f.request(method, path, false)).status, 401)
    const response = await f.request(method, path)
    assert.equal(response.status, 200, `${method} ${path}`)
    assert.equal((await response.json() as { protocolReached: boolean }).protocolReached, true)
  }
  assert.deepEqual(f.effects.admission, protocol.map(([, path]) => path)); noStorage(f)
})

test('source Queue retries every message for one hour without budget storage, acknowledgement or job mutation', async () => {
  const f = fixture(), retries: Array<[number, number]> = []; let acknowledged = 0
  const messages = [{ version: 1, jobId: 'a'.repeat(64) }, { version: 1, discoveryManifestSha256: 'b'.repeat(64), discoveryOffset: 7 },
    { version: 1, reconciliationTargetsUpload: { private: 'unchanged' } }]
  const before = structuredClone(messages)
  const batch = { messages: messages.map((body, index) => ({ body, attempts: 99, ack: () => { acknowledged++ }, retry: ({ delaySeconds }: { delaySeconds: number }) => { retries.push([index, delaySeconds]) } })) } as unknown as MaintenanceBatch
  await handleQueue(batch, f.env)
  assert.deepEqual(retries, [[0, 3600], [1, 3600], [2, 3600]]); assert.equal(acknowledged, 0)
  assert.deepEqual(messages, before); assert.deepEqual(f.effects.admission, []); noStorage(f)
})

test('source scheduled entry returns without scheduling or any storage/provider side effect', async () => {
  const f = fixture()
  await worker.scheduled({}, f.env)
  noStorage(f); assert.deepEqual(f.effects.admission, [])
})

test('target and ordinary environments retain public health and their existing HTTP dispatch', async () => {
  for (const role of ['target', undefined] as const) {
    const f = fixture(); f.env.MODEL_STATE_MIGRATION_ROLE = role
    assert.equal((await f.request('GET', '/health', false)).status, 200)
    const response = await f.request('GET', '/unknown-route')
    assert.equal(response.status, 404); assert.equal((await response.json() as { error: string }).error, 'not_found')
    noStorage(f)
  }
})
