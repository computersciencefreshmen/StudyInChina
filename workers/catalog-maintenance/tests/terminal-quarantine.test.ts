import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { handleFetch } from '../src/index'
import { control, seed } from '../src/repository'
import { evaluateRollout, rolloutStatus } from '../src/rollout'
import { canonical, digest, gateRequest } from '../src/util'
import { MODEL_STATE_MIGRATION_KEY } from '../src/model-state-migration'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../src/scope-config'
import { noReplayReason, readUnknownJobDisposition, reviewedTerminalQuarantine, TERMINAL_QUARANTINE_POLICY as policy } from '../src/reviewed-terminal-quarantine'
import type { ModelRequest } from '../src/types'
import { makeEnv, seedInput, TEST_CATALOG } from './fixture'

const now = Date.now(), first = Array.from({ length: 5 }, (_, index) => `uni-${String(index).padStart(3, '0')}`)
const original = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/terminal-quarantine/${name}.gz`, import.meta.url)))

async function fixture() {
  let network = 0
  const f = makeEnv(async () => { network++; throw new Error('No provider request is permitted by this suite') })
  f.env.SCOPE_REGISTRY_SHA256 = EXISTING_SCHOOLS_V2_SHA256; f.env.SCOPE_SCHOOL_COUNT = '295'; f.env.MAINTENANCE_ENABLED = 'false'
  Object.assign(f.env, { MODEL_STATE_MIGRATION_ID: policy.migrationId, MODEL_STATE_MIGRATION_ROLE: 'target',
    MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: policy.sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: policy.targetAccountId })
  const input = seedInput(); input.scopeRegistrySha256 = EXISTING_SCHOOLS_V2_SHA256
  for (let index = 272; index < 295; index++) input.schools.push({ universityId: `uni-${String(index).padStart(3, '0')}`, name: { en: `University ${index}` }, sourceSeeds: [] })
  for (let i = 0; i < 5; i++) input.schools[i].sourceSeeds = [{ id: `canary-${i}`, url: `https://test.edu.cn/${i}`, allowedHosts: ['test.edu.cn'], sourceCategory: 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' }]
  for (const [i, subject] of policy.jobs.entries()) input.schools[0].sourceSeeds.push({ id: `quarantined-${i}`, url: subject.sourceUrl,
    allowedHosts: [new URL(subject.sourceUrl).hostname], sourceCategory: 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' })
  await seed(f.env, input, now)
  const previousScope = 'c1703d2dd6b70ae533e7817e1e11393dbc6319672ba6ab97b01f0d2e66f53316'
  const scopeReceipt = canonical({ format: 'studyinchina.maintenance-scope-upgrade-receipt', version: 1, previousScopeSha256: previousScope,
    nextScopeSha256: EXISTING_SCHOOLS_V2_SHA256, outcome: 'completed', legacyGuardsPreserved: true, expectedSchoolCount: 295 })
  const scopeReceiptSha = await digest(scopeReceipt), scopeReceiptKey = `maintenance/scope-upgrades/receipts/${scopeReceiptSha}.json`
  await f.bucket.put(scopeReceiptKey, scopeReceipt)
  f.db.sqlite.prepare("INSERT INTO maintenance_scope_upgrades(upgrade_sha256,previous_scope_sha256,next_scope_sha256,expected_revision,paused_revision,input_catalog_sha256,legacy_guard_sha256,original_canary_json,original_enabled,original_models_enabled,plan_key,plan_sha256,total_operations,completed_operations,status,receipt_key,receipt_sha256,created_at) VALUES(?,?,?,0,1,?,?,'[]',1,1,?,?,0,0,'completed',?,?,?)")
    .run('f'.repeat(64), previousScope, EXISTING_SCHOOLS_V2_SHA256, TEST_CATALOG, 'c'.repeat(64), 'maintenance/test-plan.json', 'f'.repeat(64), scopeReceiptKey, scopeReceiptSha, new Date(now - 3000).toISOString())
  f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1,canary_json=?').run(canonical(first))
  for (const subject of policy.jobs) {
    const j = subject.job, columns = Object.keys(j)
    f.db.sqlite.prepare(`INSERT INTO maintenance_jobs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(j))
    const raw = original(`${j.snapshot_sha256}.bin`), text = original(`${subject.textSha256}.txt`), snapshot = original(`${j.snapshot_sha256}.snapshot.json`)
    assert.equal(await digest(raw), j.snapshot_sha256); assert.equal(await digest(text), subject.textSha256); assert.equal(await digest(snapshot), subject.snapshotObjectSha256)
    await f.bucket.put(subject.rawKey, raw); await f.bucket.put(subject.textKey, text); await f.bucket.put(j.snapshot_key, snapshot)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=? WHERE source_id=?').run(j.snapshot_sha256, subject.textSha256, j.snapshot_key, j.source_id)
    f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`observation-${j.job_id}`, `captured-${j.job_id}`, j.source_id,
      j.created_at, subject.sourceUrl, 200, j.snapshot_sha256, subject.textSha256, j.snapshot_key, 'text/html', 'captured', 0)
  }
  const states = { send_started: 1, completed: 1, unknown: 2, known_failed: 0 }, manifestSha256 = await digest('test-only-full-finalized-do-manifest')
  const finalized = { manifestSha256, finalizedAt: new Date(now - 1000).toISOString(), pageCount: 1, importedPages: 1, entryCount: 5, requestCount: 4, states }
  await f.storage.put(MODEL_STATE_MIGRATION_KEY, { version: 1, migrationId: policy.migrationId, sourceAccountId: policy.sourceAccountId, targetAccountId: policy.targetAccountId,
    role: 'target', phase: 'finalized', frozenAt: new Date(now - 2000).toISOString(), pages: [{ index: 0 }], gatePresent: true, ...finalized })
  for (let index = 0; index < 4; index++) await f.storage.put(`request:${String(index).repeat(64)}`, { state: index < 2 ? 'unknown' : index === 2 ? 'send_started' : 'completed', attemptId: `preserved-${index}`, requestSha256: String(index).repeat(64) })
  const relay = { format: 'studyinchina.model-state-migration-report', version: 1, migrationId: policy.migrationId, state: 'finalized', code: null,
    sourceFrozen: true, targetFinalized: true, manifestSha256, pageCount: 1, entryCount: 5, requestCount: 4, states, modelCallsPerformed: false, controlsChanged: false }
  const relayBytes = canonical(relay), relaySha = await digest(relayBytes), relayReport = { objectKey: `maintenance/terminal-quarantine/evidence/${relaySha}.json`, sha256: relaySha }
  await f.bucket.put(relayReport.objectKey, relayBytes)
  const prepareInput = { phase: 'prepare', expectedRevision: 0, scopeRegistrySha256: EXISTING_SCHOOLS_V2_SHA256, relayReport }
  const prepared = async () => reviewedTerminalQuarantine(f.env, prepareInput, now)
  const approve = (p: Awaited<ReturnType<typeof prepared>>) => {
    assert.ok('evidence' in p && p.evidence)
    return { phase: 'register', evidence: p.evidence, evidenceSha256: p.evidenceSha256,
      review: { operatorId: 'test-reviewed-operator', decision: 'quarantine_preserve_unknown_no_replay', reviewedAt: new Date(now).toISOString() } }
  }
  const register = async () => { const p = await prepared(); const body = approve(p); return { body, result: await reviewedTerminalQuarantine(f.env, body, now) } }
  const activate = () => { f.env.MAINTENANCE_ENABLED = 'true'; delete f.env.MODEL_STATE_MIGRATION_ROLE; delete f.env.MODEL_STATE_MIGRATION_ID; delete f.env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID; delete f.env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID }
  const inspectAndPublish = async () => {
    for (let i = 0; i < 5; i++) {
      const url = `https://test.edu.cn/${i}`, sourceId = await digest(url), raw = `Official captured source for canary ${i}`, rawSha = await digest(raw)
      const rawKey = `maintenance/snapshots/${sourceId}/${rawSha}.bin`, snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha}.json`, checkedAt = new Date(now - 5000).toISOString()
      await f.bucket.put(rawKey, raw); await f.bucket.put(snapshotKey, canonical({ version: 1, sourceId, sourceUrl: url, rawSha256: rawSha, rawKey }))
      f.db.sqlite.prepare('UPDATE maintenance_sources SET last_attempt_at=?,last_success_at=?,raw_sha256=?,snapshot_key=? WHERE source_id=?').run(checkedAt, checkedAt, rawSha, snapshotKey, sourceId)
      f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`canary-${i}`, `capture-${i}`, sourceId, checkedAt, url, 200, rawSha, rawSha, snapshotKey, 'text/plain', 'captured', 0)
    }
    const ack = { batchId: 'published-existing-catalogue', outcome: 'published', acceptedProposalIds: ['previously-published'], heldProposalIds: [], unchangedProposalIds: [],
      sourceCommit: 'd'.repeat(40), deploymentId: 'dpl_existingVerifiedProduction', stableProofSha256: 'e'.repeat(64) }, text = canonical(ack)
    f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES(?,?,?,?,?,?,'published',?,?)").run(ack.batchId, TEST_CATALOG, EXISTING_SCHOOLS_V2_SHA256, 'maintenance/existing-export.json', 'f'.repeat(64), new Date(now - 5000).toISOString(), await digest(text), text)
  }
  return { ...f, prepared, approve, register, activate, inspectAndPublish, prepareInput, relayReport, network: () => network,
    events: () => Number(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='reviewed_terminal_quarantine'").get()!.count) }
}

test('fixed audited bytes prepare without mutation, then one immutable CAS disposition preserves every unknown and DO reservation', async () => {
  const f = await fixture()
  try {
    const beforeJobs = f.db.sqlite.prepare('SELECT * FROM maintenance_jobs ORDER BY job_id').all(), beforeDo = structuredClone(f.storage.values), beforeControl = await control(f.env)
    const p = await f.prepared(); assert.equal(p.phase, 'prepared'); assert.equal(f.events(), 0)
    const body = f.approve(p), result = await reviewedTerminalQuarantine(f.env, body, now)
    assert.ok(result.phase === 'registered'); assert.equal(result.quarantinedUnknown, 3); assert.equal(result.totalUnknown, 3); assert.equal(result.unresolvedUnknown, 0)
    assert.equal(f.events(), 1); assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs ORDER BY job_id').all(), beforeJobs)
    assert.deepEqual(f.storage.values, beforeDo); assert.deepEqual(await control(f.env), beforeControl); assert.equal(f.network(), 0)
    f.activate(); f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1').run()
    const repeated = await reviewedTerminalQuarantine(f.env, body, now); assert.ok(repeated.phase === 'registered'); assert.equal(repeated.reused, true); assert.equal(f.events(), 1)
    assert.deepEqual((await readUnknownJobDisposition(f.env, await control(f.env), now)).summary.importedDoStates, { send_started: 1, completed: 1, unknown: 2, known_failed: 0 })
  } finally { f.db.sqlite.close() }
})

test('missing or nonfinal DO proof cannot register; SQL absence never establishes an unsent model', async () => {
  const f = await fixture()
  try {
    const lock = await f.storage.get<Record<string, unknown>>(MODEL_STATE_MIGRATION_KEY); await f.storage.put(MODEL_STATE_MIGRATION_KEY, { ...lock, phase: 'importing' })
    await assert.rejects(f.prepared(), /finalized_do_required/); assert.equal(f.events(), 0)
    await f.storage.put(MODEL_STATE_MIGRATION_KEY, lock); f.env.MAINTENANCE_ENABLED = 'true'
    await assert.rejects(f.prepared(), /migration_freeze_required/); assert.equal(f.network(), 0)
  } finally { f.db.sqlite.close() }
})

test('raw, snapshot, relay and approved payload tampering are rejected before a disposition commit', async () => {
  for (const kind of ['raw', 'snapshot', 'relay', 'payload'] as const) {
    const f = await fixture()
    try {
      const p = await f.prepared(), subject = policy.jobs[0]
      if (kind === 'raw') await f.bucket.put(subject.rawKey, 'changed source bytes')
      if (kind === 'snapshot') await f.bucket.put(subject.job.snapshot_key, '{}')
      if (kind === 'relay') await f.bucket.put(f.relayReport.objectKey, '{}')
      const body = f.approve(p)
      if (kind === 'payload') body.evidence.inputCatalogSha256 = '0'.repeat(64)
      await assert.rejects(reviewedTerminalQuarantine(f.env, body, now), /quarantine/)
      assert.equal(f.events(), 0); assert.equal(f.network(), 0)
    } finally { f.db.sqlite.close() }
  }
})

test('a revision or last-job target payload race rolls the complete registration batch back', async () => {
  for (const race of ['revision', 'target'] as const) {
    const f = await fixture()
    try {
      const body = f.approve(await f.prepared()), put = f.bucket.put.bind(f.bucket); let once = true
      f.bucket.put = async (key, value, options) => {
        if (once && key.startsWith('maintenance/terminal-quarantine/proofs/')) { once = false
          if (race === 'revision') f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1').run()
          else f.db.sqlite.prepare("UPDATE maintenance_jobs SET target_ids_json='[]' WHERE job_id=?").run(policy.jobs.at(-1)!.job.job_id)
        }
        return put(key, value, options)
      }
      await assert.rejects(reviewedTerminalQuarantine(f.env, body, now), /CHECK|constraint/i)
      assert.equal(f.events(), 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_transaction_guards').get()!.count, 0)
      assert.equal((await readUnknownJobDisposition(f.env, await control(f.env), now)).summary.quarantinedUnknown, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('an original no-output audit changing before commit is not accepted as a quarantine', async () => {
  const f = await fixture()
  try {
    const body = f.approve(await f.prepared()), batch = f.db.batch.bind(f.db); let once = true
    f.db.batch = async statements => {
      if (once) { once = false
        f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,? ,?,?,'primary',?,'MiniMax-M3','completed',?,'{}')")
          .run('f'.repeat(64), 'late-completed-output', policy.jobs[0].job.source_id, policy.jobs[0].job.snapshot_sha256, 'e'.repeat(64), new Date(now).toISOString())
      }
      return batch(statements)
    }
    await assert.rejects(reviewedTerminalQuarantine(f.env, body, now), /CHECK|constraint/i); assert.equal(f.events(), 0)
  } finally { f.db.sqlite.close() }
})

test('three quarantined unknowns permit genuine rollout while a fourth unknown or SQL model unknown still holds it', async () => {
  const f = await fixture()
  try {
    await f.inspectAndPublish(); f.env.MAINTENANCE_ENABLED = 'true'
    assert.ok((await rolloutStatus(f.env, now)).reasons.includes('job_outcome_unknown'))
    f.env.MAINTENANCE_ENABLED = 'false'; await f.register(); f.activate()
    const ready = await rolloutStatus(f.env, now); assert.equal(ready.state, 'eligible'); assert.equal(ready.unknownJobDisposition?.totalUnknown, 3)
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES(?,?,'extract','unknown',?,?,?)")
      .run('4'.repeat(64), policy.jobs[0].job.source_id, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString())
    const fourth = await rolloutStatus(f.env, now); assert.equal(fourth.state, 'holding'); assert.equal(fourth.unknownJobDisposition?.quarantinedUnknown, 3); assert.equal(fourth.unknownJobDisposition?.unresolvedUnknown, 1)
    f.db.sqlite.prepare('DELETE FROM maintenance_jobs WHERE job_id=?').run('4'.repeat(64))
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,? ,?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')")
      .run('3'.repeat(64), 'unrelated-unknown-model', await digest('https://test.edu.cn/0'), '2'.repeat(64), '1'.repeat(64), new Date(now).toISOString())
    assert.ok((await rolloutStatus(f.env, now)).reasons.includes('model_outcome_unresolved'))
    f.db.sqlite.prepare('DELETE FROM maintenance_model_attempts WHERE attempt_id=?').run('unrelated-unknown-model')
    const result = await evaluateRollout(f.env, { expectedRevision: 0 }, now); assert.equal(result.advanced, true)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_jobs WHERE status='unknown'").get()!.count, 3)
    assert.equal(f.network(), 0)
  } finally { f.db.sqlite.close() }
})

test('a fourth unknown, changed job tuple or changed commit racing the rollout decision aborts its atomic canary update', async () => {
  for (const race of ['fourth', 'target', 'deleted', 'status', 'commit'] as const) {
    const f = await fixture()
    try {
    await f.register(); await f.inspectAndPublish(); f.activate()
    const batch = f.db.batch.bind(f.db); let once = true
    f.db.batch = async statements => {
      if (once) { once = false
        if (race === 'fourth') f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES(?,?,'extract','unknown',?,?,?)")
          .run('4'.repeat(64), policy.jobs[0].job.source_id, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString())
        else if (race === 'target') f.db.sqlite.prepare("UPDATE maintenance_jobs SET target_ids_json='[]' WHERE job_id=?").run(policy.jobs.at(-1)!.job.job_id)
        else if (race === 'deleted') f.db.sqlite.prepare('DELETE FROM maintenance_jobs WHERE job_id=?').run(policy.jobs.at(-1)!.job.job_id)
        else if (race === 'status') f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='held' WHERE job_id=?").run(policy.jobs.at(-1)!.job.job_id)
        else f.db.sqlite.prepare("UPDATE maintenance_events SET details_json='{}' WHERE kind='reviewed_terminal_quarantine'").run()
      }
      return batch(statements)
    }
    const result = await evaluateRollout(f.env, { expectedRevision: 0 }, now)
    assert.equal(result.advanced, false); assert.deepEqual(JSON.parse((await control(f.env))!.canary_json), first)
    } finally { f.db.sqlite.close() }
  }
})

test('a missing scope-upgrade receipt cannot register or carry a waiver across registry versions', async () => {
  const f = await fixture()
  try {
    f.db.sqlite.prepare('DELETE FROM maintenance_scope_upgrades').run()
    await assert.rejects(f.prepared(), /scope_lineage_invalid/); assert.equal(f.events(), 0)
  } finally { f.db.sqlite.close() }
})

test('corrupt committed evidence or changed scope removes the waiver without removing the permanent deny policy', async () => {
  const f = await fixture()
  try {
    const { result } = await f.register(); assert.ok('proofKey' in result)
    await f.bucket.put(result.proofKey, '{}')
    assert.equal((await readUnknownJobDisposition(f.env, await control(f.env), now)).summary.unresolvedUnknown, 3)
    f.env.SCOPE_REGISTRY_SHA256 = '9'.repeat(64); f.db.sqlite.prepare('UPDATE maintenance_control SET scope_sha256=?').run(f.env.SCOPE_REGISTRY_SHA256)
    assert.equal((await readUnknownJobDisposition(f.env, await control(f.env), now)).summary.state, 'scope_mismatch')
    const j = policy.jobs[0].job
    assert.equal(await noReplayReason(f.env, { sourceId: j.source_id, snapshotSha256: j.snapshot_sha256 } as ModelRequest, { raw_sha256: null }), 'terminal_quarantine_no_replay')
  } finally { f.db.sqlite.close() }
})

test('new request IDs, passes, payloads and new URL/raw aliases cannot escape the common admission NO_REPLAY boundary', async () => {
  const f = await fixture()
  try {
    f.activate()
    const aliasUrl = 'https://test.edu.cn/alias', aliasId = await digest(aliasUrl), rawSha = 'a'.repeat(64)
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,raw_sha256,canonical_sha256) VALUES(?,?,?,'undergraduate_catalog',1,24,?,?,?)")
      .run(aliasId, aliasUrl, '["test.edu.cn"]', new Date(now).toISOString(), rawSha, policy.jobs[1].textSha256)
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(aliasId, first[0])
    for (const [i, subject] of [...policy.jobs, { job: { source_id: aliasId, snapshot_sha256: rawSha } }].entries()) {
      const request: ModelRequest = { sourceId: subject.job.source_id, snapshotSha256: subject.job.snapshot_sha256, reservationKey: await digest(`different-model-contract-date-${i}`),
        pass: i % 2 ? 'primary' : 'independent-review', payload: canonical({ arbitrary: i, textSha256: '0'.repeat(64) }), recordIds: [], universityIds: [first[0]], lane: 'expansion' }
      const before = structuredClone(f.storage.values), response = await gateRequest(f.env, '/model/run', request)
      assert.equal(response.status, 409); assert.equal((await response.json()).error, 'terminal_quarantine_no_replay'); assert.deepEqual(f.storage.values, before)
    }
    assert.equal(f.network(), 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()!.count, 0)
  } finally { f.db.sqlite.close() }
})

test('administrative endpoints authenticate first, bound input and never expose raw original or model content', async () => {
  const f = await fixture()
  try {
    assert.equal((await handleFetch(new Request('https://worker/job-dispositions'), f.env)).status, 401)
    const headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }
    const tooLarge = await handleFetch(new Request('https://worker/job-dispositions', { method: 'POST', headers, body: JSON.stringify({ phase: 'prepare', data: 'x'.repeat(33 * 1024) }) }), f.env)
    assert.equal(tooLarge.status, 409); assert.equal(f.events(), 0)
    const observed = await handleFetch(new Request('https://worker/job-dispositions', { headers }), f.env)
    const value = await observed.json(); assert.equal(value.totalUnknown, 3); assert.equal(value.quarantinedUnknown, 0); assert.equal(value.replayAllowed, false)
    assert.equal(f.network(), 0)
  } finally { f.db.sqlite.close() }
})
