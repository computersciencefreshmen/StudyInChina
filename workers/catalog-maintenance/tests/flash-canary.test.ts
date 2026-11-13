import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelAdmission } from '../src/admission'
import { handleModelStateMigration } from '../src/model-state-migration'
import { FLASH_MODEL } from '../src/flash-canary'
import { maintainFields } from '../src/field-updates'
import { seed, setControls, source } from '../src/repository'
import type { CapturedSnapshot } from '../src/capture'
import type { JobRow, ModelRequest, ModelResult } from '../src/types'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { canonical, digest, gateRequest } from '../src/util'
import { makeEnv, MemoryStorage, quotaResponse, seedInput, TEST_GUARDS } from './fixture'

const text = 'International students applying to Computer Science. Autumn 2027 admissions. Application deadline: 2027-09-30.'
const evidence = () => ({ records: [{ recordId: 'cycle-computer-science', year: '2027-2028', intake: 'autumn',
  applicabilityQuote: 'International students applying to Computer Science.', scopeQuote: 'Autumn 2027 admissions.',
  patches: [{ fieldPath: 'closesOn', value: '2027-09-30', factStatus: 'known', quote: 'Application deadline: 2027-09-30.' }] }] })
class Storage extends MemoryStorage {
  async list<T>(options: { startAfter?: string; limit: number }): Promise<Map<string, T>> {
    return new Map([...this.values].filter(([key]) => options.startAfter === undefined || key > options.startAfter)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, options.limit).map(([key, value]) => [key, structuredClone(value) as T]))
  }
}
async function fixture(sourceText = text) {
  const f = makeEnv(), storage = new Storage(), requests: Array<{ body: string; parsed: Record<string, unknown> }> = []
  const mode = { status: 200, lost: false, reportedModel: FLASH_MODEL as string, quota: 80, onQuota: undefined as (() => Promise<void>) | undefined }
  let quotaCalls = 0
  const provider: typeof fetch = async (url, init) => {
    if (String(url).includes('token_plan')) { quotaCalls++; await mode.onQuota?.(); return quotaResponse(mode.quota) }
    const body = String(init?.body), parsed = JSON.parse(body) as Record<string, unknown>; requests.push({ body, parsed })
    if (mode.lost) throw new Error('fake lost provider reply')
    if (mode.status !== 200) return Response.json({ error: 'test-only' }, { status: mode.status, headers: { 'retry-after': '60' } })
    return Response.json({ model: parsed.model === FLASH_MODEL ? mode.reportedModel : parsed.model, content: [{ type: 'thinking', thinking: 'test-only hidden reasoning' }, { type: 'text', text: JSON.stringify(evidence()) }],
      stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } })
  }
  const admission = new ModelAdmission({ storage }, f.env, provider)
  f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => admission.fetch(request) }) }
  await seed(f.env, seedInput()); await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  const sourceId = await digest('https://test.edu.cn/catalog'), rawSha = await digest(`original bytes:${sourceText}`), textSha = await digest(sourceText)
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: 'https://test.edu.cn/catalog', finalUrl: 'https://test.edu.cn/catalog', checkedAt: new Date().toISOString(), contentType: 'text/plain',
    rawSha256: rawSha, rawKey: `maintenance/raw/${rawSha}`, textKey: `maintenance/text/${textSha}`, textSha256: textSha, canonicalSha256: textSha, parserCandidates: [] }
  const snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha}.json`
  await f.bucket.put(snapshotKey, canonical(snapshot)); await f.bucket.put(snapshot.textKey!, sourceText)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=? WHERE source_id=?').run(rawSha, textSha, snapshotKey, sourceId)
  const target: MaintenanceRecordTarget = { recordId: 'cycle-computer-science', entityType: 'admission-cycle', universityId: 'uni-000', sourceIds: [sourceId],
    recordScopeSha256: 'f'.repeat(64), identity: { programId: 'prog-computer-science', name: { en: 'Computer Science' }, degreeLevel: 'bachelor' }, year: '2027-2028', intake: 'autumn', reviewAfter: '2026-11-14', fields: {} }
  f.db.sqlite.prepare('INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(`admission-cycle:${target.recordId}`, target.recordId, target.entityType, target.universityId, target.recordScopeSha256, target.year, target.intake, '{}', canonical(target))
  f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').run(`admission-cycle:${target.recordId}`, sourceId)
  const cfg = { version: 1, id: 'flash-canary-local-fixture', sourceId, snapshotSha256: rawSha, textSha256: textSha, recordIds: [target.recordId] }
  f.env.MINIMAX_FLASH_CANARY = canonical(cfg)
  const row = (await source(f.env, sourceId))!, job = { job_id: 'flash-field-job', source_id: sourceId, stage: 'maintain', snapshot_sha256: rawSha, snapshot_key: snapshotKey } as JobRow
  const run = () => maintainFields(f.env, job, row, snapshot, [target])
  const inputs: ModelRequest[] = []
  await maintainFields(f.env, job, row, snapshot, [target], async (_env, request) => { inputs.push(request); return { attemptId: `dry-${request.pass}`, output: evidence(), artifactKey: 'maintenance/models/test-dry.json', artifactSha256: 'c'.repeat(64), reused: false } })
  return { ...f, storage, requests, mode, sourceId, rawSha, textSha, snapshot, target, cfg, run, inputs, quotaCalls: () => quotaCalls }
}
async function errorCode(response: Response) { return (await response.json() as { error?: string }).error }
async function oldEvidence(f: Awaited<ReturnType<typeof fixture>>, historicalText = 'A separate historical official document.', payloadSha = '9'.repeat(64), sqlOnly = false) {
  const sourceId = await digest('https://test.edu.cn/historical-alias'), rawSha = await digest(`old wrapper:${historicalText}`)
  const textSha = await digest(historicalText), snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha}.json`, key = '8'.repeat(64)
  const prior = { state: 'unknown', attemptId: 'unrelated-known-history', requestSha256: payloadSha }
  const snapshot: CapturedSnapshot = { ...f.snapshot, sourceId, rawSha256: rawSha, rawKey: `maintenance/raw/${rawSha}`,
    sourceUrl: 'https://test.edu.cn/historical-alias', textKey: `maintenance/text/${textSha}`, textSha256: textSha, canonicalSha256: textSha }
  await f.bucket.put(snapshotKey, canonical(snapshot)); await f.bucket.put(snapshot.textKey!, historicalText)
  if (!sqlOnly) await f.storage.put(`request:${key}`, prior)
  f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,'MiniMax-M3','unknown',?,'{}')")
    .run(key, prior.attemptId, sourceId, rawSha, 'primary', prior.requestSha256, new Date().toISOString())
  return { key, prior, sourceId, rawSha, snapshotKey, snapshot }
}

test('normal field engine uses the original two keys, adaptive/low Flash wire and independently reviewed proposals', async () => {
  const f = await fixture()
  try {
    const result = await f.run(); assert.equal(result.proposals.length, 1); assert.equal(result.held.length, 0)
    assert.equal(f.requests.length, 2); assert.equal(f.quotaCalls(), 2)
    for (const request of f.requests) {
      assert.equal(request.parsed.model, FLASH_MODEL); assert.deepEqual(request.parsed.thinking, { type: 'adaptive' }); assert.deepEqual(request.parsed.output_config, { effort: 'low' })
      assert.equal(request.parsed.temperature, undefined)
    }
    const attempts = f.db.sqlite.prepare('SELECT reservation_key,model,quota_json,output_key FROM maintenance_model_attempts ORDER BY rowid').all() as Array<{ reservation_key: string; model: string; quota_json: string; output_key: string }>
    assert.deepEqual(attempts.map(row => row.reservation_key), f.inputs.map(input => input.reservationKey))
    for (let i = 0; i < attempts.length; i++) {
      assert.equal(attempts[i].model, FLASH_MODEL)
      const audit = JSON.parse(attempts[i].quota_json).modelProfile
      assert.equal(audit.providerRequestSha256, await digest(f.requests[i].body)); assert.equal(audit.effort, 'low')
      const artifact = JSON.parse(await (await f.bucket.get(attempts[i].output_key))!.text())
      assert.equal(artifact.model, FLASH_MODEL); assert.equal(artifact.modelProfile.responseModel, FLASH_MODEL)
      assert.equal(artifact.modelProfile.profileSha256, audit.profileSha256)
    }
    const gate = await f.storage.get<{ flashCanary: { calls: unknown[] } }>('gate'); assert.equal(gate?.flashCanary.calls.length, 2)
    assert.equal((await f.run()).proposals.length, 1); assert.equal(f.requests.length, 2, 'completed exact Flash outputs are reused')
  } finally { f.db.sqlite.close() }
})

for (const state of ['unknown', 'send_started']) test(`an old ${state} reservation never sends, even under a newly armed profile`, async () => {
  const f = await fixture()
  try {
    const input = f.inputs[0]
    await f.storage.put(`request:${input.reservationKey}`, { state, attemptId: 'legacy-uncertain', requestSha256: await digest(input.payload) })
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', input)), 'prior_model_outcome_requires_review'); assert.equal(f.requests.length, 0); assert.equal(f.quotaCalls(), 0)
  } finally { f.db.sqlite.close() }
})

test('completed M3 output stays reusable without enrolling or mixing a new review profile', async () => {
  const f = await fixture()
  try {
    const input = f.inputs[0], old: ModelResult = { attemptId: 'old-m3-completed', output: evidence(), artifactKey: 'maintenance/models/legacy.json', artifactSha256: 'b'.repeat(64), reused: false }
    await f.storage.put(`request:${input.reservationKey}`, { state: 'completed', attemptId: old.attemptId, requestSha256: await digest(input.payload), result: old })
    const cached = await (await gateRequest(f.env, '/model/run', input)).json() as ModelResult
    assert.equal(cached.reused, true); assert.equal(cached.attemptId, old.attemptId); assert.equal(cached.modelProfile, undefined)
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[1])), 'flash_canary_primary_required')
    assert.equal(f.requests.length, 0); assert.equal(f.quotaCalls(), 0)
  } finally { f.db.sqlite.close() }
})

test('unattributed DO history holds a new scope rather than guessing away an old outcome', async () => {
  const f = await fixture()
  try {
    await f.storage.put(`request:${'9'.repeat(64)}`, { state: 'unknown', attemptId: 'do-only-history', requestSha256: 'a'.repeat(64) })
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_history_unattributed'); assert.equal(f.requests.length, 0)
  } finally { f.db.sqlite.close() }
})

test('old SQL attempts for either the source or a raw-byte alias hold profile enrollment', async () => {
  for (const alias of [false, true]) {
    const f = await fixture()
    try {
      f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,?,?,?,?,?,'MiniMax-M3','unknown',?,'{}')")
        .run('8'.repeat(64), 'old-sql', alias ? '7'.repeat(64) : f.sourceId, f.rawSha, 'primary', 'a'.repeat(64), new Date().toISOString())
      assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_scope_has_history'); assert.equal(f.requests.length, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('a fully attributed unknown for unrelated evidence is retained without blocking a fresh scope', async () => {
  const f = await fixture()
  try {
    const { key, prior } = await oldEvidence(f)
    assert.equal((await f.run()).proposals.length, 1); assert.equal(f.requests.length, 2)
    assert.deepEqual(await f.storage.get(`request:${key}`), prior)
    assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts WHERE attempt_id=?').get(prior.attemptId)?.status, 'unknown')
  } finally { f.db.sqlite.close() }
})

for (const pass of [0, 1]) test(`a historical URL/raw alias of the ${pass === 0 ? 'primary' : 'review'} payload cannot enroll a new two-pass trial`, async () => {
  const f = await fixture()
  try {
    const historical = await oldEvidence(f, 'Different old text isolates the payload comparison.', await digest(f.inputs[pass].payload))
    await assert.rejects(f.run(), /flash_canary_scope_has_history/)
    assert.equal(f.requests.length, 0); assert.equal(f.quotaCalls(), 0)
    assert.deepEqual(await f.storage.get(`request:${historical.key}`), historical.prior)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get()?.n, 0)
    assert.equal((await f.storage.get<{ flashCanary?: unknown }>('gate'))?.flashCanary, undefined)
  } finally { f.db.sqlite.close() }
})

for (const sqlOnly of [false, true]) test(`historical attempted text survives a moved source pointer${sqlOnly ? ' without a DO copy' : ''} and blocks all Flash sends`, async () => {
  const f = await fixture()
  try {
    const old = await oldEvidence(f, text, '9'.repeat(64), sqlOnly)
    const changed = 'The source now serves a genuinely different document.', changedSha = await digest(changed), changedRaw = '6'.repeat(64)
    const changedKey = `maintenance/snapshots/${old.sourceId}/${changedRaw}.json`
    await f.bucket.put(changedKey, canonical({ ...old.snapshot, rawSha256: changedRaw, textSha256: changedSha, canonicalSha256: changedSha, textKey: `maintenance/text/${changedSha}` }))
    await f.bucket.put(`maintenance/text/${changedSha}`, changed)
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256,snapshot_key) VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?,?)")
      .run(old.sourceId, old.snapshot.sourceUrl, '["test.edu.cn"]', new Date().toISOString(), changedRaw, changedSha, changedKey)
    await assert.rejects(f.run(), /flash_canary_scope_has_history/)
    assert.equal(f.requests.length, 0); assert.equal(f.quotaCalls(), 0)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get()?.n, 0)
    if (!sqlOnly) assert.deepEqual(await f.storage.get(`request:${old.key}`), old.prior)
  } finally { f.db.sqlite.close() }
})

for (const kind of ['missing-snapshot', 'wrong-binding', 'missing-text', 'wrong-text', 'conflicting-observation']) test(`unproven historical evidence holds the new trial: ${kind}`, async () => {
  const f = await fixture()
  try {
    const old = await oldEvidence(f)
    if (kind === 'missing-snapshot') f.bucket.objects.delete(old.snapshotKey)
    if (kind === 'wrong-binding') await f.bucket.put(old.snapshotKey, canonical({ ...old.snapshot, rawSha256: '5'.repeat(64) }))
    if (kind === 'missing-text') f.bucket.objects.delete(old.snapshot.textKey!)
    if (kind === 'wrong-text') await f.bucket.put(old.snapshot.textKey!, 'Different bytes than the stored hash')
    if (kind === 'conflicting-observation') f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('old-observation', 'old-job', old.sourceId, new Date().toISOString(), old.snapshot.sourceUrl, 200, old.rawSha, '4'.repeat(64), old.snapshotKey, 'text/plain', 'captured', 0)
    await assert.rejects(f.run(), /flash_canary_history_evidence_unproven/)
    assert.equal(f.requests.length, 0); assert.equal(f.quotaCalls(), 0)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_proposals').get()?.n, 0)
    assert.deepEqual(await f.storage.get(`request:${old.key}`), old.prior)
  } finally { f.db.sqlite.close() }
})

test('a history larger than the explicit proof bound holds rather than scanning a partial ledger', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 257; i++) await f.storage.put(`request:${i.toString(16).padStart(64, '0')}`, { state: 'unknown', attemptId: `old-${i}`, requestSha256: 'a'.repeat(64) })
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_history_unbounded'); assert.equal(f.requests.length, 0)
  } finally { f.db.sqlite.close() }
})

test('a changed history during quota refresh cannot race the atomic enrollment', async () => {
  const f = await fixture()
  try {
    f.mode.onQuota = async () => { await f.storage.put(`request:${'9'.repeat(64)}`, { state: 'send_started', attemptId: 'racing-history', requestSha256: 'a'.repeat(64) }) }
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_history_changed_or_busy'); assert.equal(f.requests.length, 0)
  } finally { f.db.sqlite.close() }
})

test('two failed send attempts exhaust the persistent trial and a new id cannot reset it', async () => {
  const f = await fixture(), original = Date.now; let time = Date.now(); Date.now = () => time
  try {
    f.mode.status = 429
    for (let i = 0; i < 2; i++) { assert.equal((await gateRequest(f.env, '/model/run', f.inputs[0])).status, 429); time += 61000 }
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_send_limit'); assert.equal(f.requests.length, 2)
    f.env.MINIMAX_FLASH_CANARY = canonical({ ...f.cfg, id: 'another-flash-trial-id' })
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_enrollment_conflict'); assert.equal(f.requests.length, 2)
    delete f.env.MINIMAX_FLASH_CANARY
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'flash_canary_scope_profile_required'); assert.equal(f.requests.length, 2)
  } finally { Date.now = original; f.db.sqlite.close() }
})

test('a lost Flash result remains unknown when configuration is rolled back', async () => {
  const f = await fixture()
  try {
    f.mode.lost = true
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'model_outcome_unknown')
    delete f.env.MINIMAX_FLASH_CANARY
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'prior_model_outcome_requires_review'); assert.equal(f.requests.length, 1)
  } finally { f.db.sqlite.close() }
})

test('scope expansion, a different engine, changed captured bytes and overlong sources send no model requests', async () => {
  for (const kind of ['too-many', 'engine', 'text-drift', 'long', 'renamed-key']) {
    const f = await fixture(kind === 'long' ? text + ' '.repeat(12001) : text)
    try {
      let input = f.inputs[0]
      if (kind === 'too-many') f.env.MINIMAX_FLASH_CANARY = canonical({ ...f.cfg, recordIds: Array.from({ length: 6 }, (_, i) => `record-${i}`) })
      if (kind === 'engine') input = { ...input, payload: canonical({ ...JSON.parse(input.payload), task: 'primary-official-international-program-identities' }) }
      if (kind === 'text-drift') await f.bucket.put(f.snapshot.textKey!, 'changed official text')
      if (kind === 'renamed-key') input = { ...input, reservationKey: '6'.repeat(64) }
      assert.notEqual((await gateRequest(f.env, '/model/run', input)).status, 200, kind); assert.equal(f.requests.length, 0, kind)
    } finally { f.db.sqlite.close() }
  }
})

test('a missing or different provider-reported Flash model is protected as unknown', async () => {
  const f = await fixture()
  try {
    f.mode.reportedModel = 'MiniMax-M3'
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'model_outcome_unknown')
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'prior_model_outcome_requires_review'); assert.equal(f.requests.length, 1)
  } finally { f.db.sqlite.close() }
})

test('removing the trial keeps completed caches and unrelated normal M3 jobs usable', async () => {
  const f = await fixture()
  try {
    await f.run(); delete f.env.MINIMAX_FLASH_CANARY
    assert.equal((await (await gateRequest(f.env, '/model/run', f.inputs[0])).json() as ModelResult).reused, true)
    const otherId = await digest('https://test.edu.cn/other-evidence')
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256) VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?)")
      .run(otherId, 'https://test.edu.cn/other-evidence', '["test.edu.cn"]', new Date().toISOString(), '5'.repeat(64), await digest('ordinary M3 evidence'))
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(otherId, 'uni-000')
    const ordinary = { ...f.inputs[0], sourceId: otherId, snapshotSha256: '5'.repeat(64), reservationKey: '4'.repeat(64), recordIds: [], payload: 'ordinary M3 evidence' }
    assert.equal((await gateRequest(f.env, '/model/run', ordinary)).status, 200)
    const wire = f.requests.at(-1)!.parsed; assert.equal(wire.model, 'MiniMax-M3'); assert.deepEqual(wire.thinking, { type: 'disabled' }); assert.equal(wire.output_config, undefined)
    assert.equal(f.requests.length, 3)
  } finally { f.db.sqlite.close() }
})

test('the existing five-percent credit margin blocks Flash before reserving or sending', async () => {
  const f = await fixture()
  try {
    f.mode.quota = 5
    assert.equal(await errorCode(await gateRequest(f.env, '/model/run', f.inputs[0])), 'quota_exhausted_or_overflow_margin')
    assert.equal(f.requests.length, 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
    assert.equal((await f.storage.get<{ flashCanary?: unknown }>('gate'))?.flashCanary, undefined)
  } finally { f.db.sqlite.close() }
})

test('the complete model-state migration preserves enrollment and every Flash audit field', async () => {
  const f = await fixture()
  try {
    await f.run()
    const original = (await f.storage.get<{ flashCanary: unknown }>('gate'))!.flashCanary
    Object.assign(f.env, { MODEL_STATE_MIGRATION_ID: 'flash-audit-migration', MODEL_STATE_MIGRATION_ROLE: 'source', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: '1'.repeat(32), MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: '2'.repeat(32) })
    const body = { migrationId: 'flash-audit-migration' }
    assert.equal((await handleModelStateMigration(f.storage, f.env, '/model-state-migration/freeze', body, 0)).status, 200)
    const exported = await (await handleModelStateMigration(f.storage, f.env, '/model-state-migration/export', { ...body, pageIndex: 0 }, 0)).json()
    const targetStorage = new Storage(), env = { ...f.env, MAINTENANCE_ENABLED: 'false', MODEL_STATE_MIGRATION_ROLE: 'target' }
    assert.equal((await handleModelStateMigration(targetStorage, env, '/model-state-migration/import', { ...body, ...exported }, 0)).status, 200)
    assert.equal((await handleModelStateMigration(targetStorage, env, '/model-state-migration/finalize', { ...body, manifestSha256: exported.manifestSha256 }, 0)).status, 200)
    assert.deepEqual((await targetStorage.get<{ flashCanary: unknown }>('gate'))!.flashCanary, original)
    for (const input of f.inputs) assert.deepEqual(await targetStorage.get(`request:${input.reservationKey}`), await f.storage.get(`request:${input.reservationKey}`))
    assert.equal(f.requests.length, 2)
  } finally { f.db.sqlite.close() }
})
