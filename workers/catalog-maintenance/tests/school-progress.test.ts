import assert from 'node:assert/strict'
import test from 'node:test'
import { seed } from '../src/repository'
import { listSchoolProgress, submitSchoolReconciliation } from '../src/school-progress'
import { canonical, digest } from '../src/util'
import { handleFetch } from '../src/index'
import { makeEnv, seedInput, TEST_SCOPE } from './fixture'
import type { SchoolReconciliation } from '../../../scripts/maintenance/reconciliation'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'

const now = Date.parse('2026-10-24T04:00:00.000Z'), checkedAt = '2026-10-24T02:00:00.000Z'
const url = 'https://test.edu.cn/catalog'

async function fixture(captured = true) {
  const f = makeEnv(), sourceId = await digest(url), raw = 'Official international undergraduate catalogue: Program A.'
  const rawSha256 = await digest(raw), rawKey = `maintenance/snapshots/${sourceId}/${rawSha256}.bin`
  const snapshotKey = `maintenance/snapshots/${sourceId}/${rawSha256}.json`
  const target: MaintenanceRecordTarget = { recordId: 'program-a', entityType: 'program', universityId: 'uni-000',
    sourceIds: [sourceId], recordScopeSha256: 'd'.repeat(64), identity: { name: { en: 'Program A' }, universityId: 'uni-000' },
    year: null, intake: null, fields: {}, reviewAfter: '2026-10-31' }
  await seed(f.env, { ...seedInput(), recordTargets: [target] })
  if (captured) {
    await f.bucket.put(rawKey, raw)
    await f.bucket.put(snapshotKey, canonical({ version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt,
      rawSha256, rawKey, textKey: null, textSha256: null, canonicalSha256: rawSha256, contentType: 'text/plain', parserCandidates: [] }))
    f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('observation-a', 'capture-a', sourceId, checkedAt, url, 200, rawSha256, rawSha256, snapshotKey, 'text/plain', 'captured', 1)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET last_attempt_at=?,last_success_at=?,raw_sha256=?,snapshot_key=? WHERE source_id=?')
      .run(checkedAt, checkedAt, rawSha256, snapshotKey, sourceId)
  }
  const report: SchoolReconciliation = {
    universityId: 'uni-000', scope: 'full_official_catalog',
    categories: [{ category: 'undergraduate_catalog', status: 'captured' },
      ...(['masters_catalog', 'doctoral_catalog', 'non_degree_catalog'] as const).map(category => ({
        category, status: 'officially_not_provided' as const, evidenceUrl: url, note: 'Official catalogue explicitly provides undergraduate study only.' }))],
    catalogs: [{ sourceId, category: 'undergraduate_catalog', url, snapshotSha256: rawSha256,
      expectedRows: 1, expectedPages: 1, capturedPages: [1], expectedAttachments: [], capturedAttachments: [] }],
    entries: [{ sourceId, officialKey: 'major-a', status: 'published', recordId: 'program-a' }],
  }
  const humanReceipt = async (change: Record<string, unknown> = {}) => {
    const body = { format: 'studyinchina.school-reconciliation-human-review', version: 1, universityId: 'uni-000',
      scopeRegistrySha256: TEST_SCOPE, observedReportSha256: await digest(canonical(report)),
      observedCatalogs: report.catalogs.map(({ sourceId, url, snapshotSha256 }) => ({ sourceId, url, snapshotSha256 })),
      reviewer: { id: 'human-fixture-reviewer', kind: 'human' }, method: 'independent-human-review', decision: 'accept',
      reviewedAt: '2026-10-24T03:00:00.000Z', ...change }
    const text = canonical(body), sha256 = await digest(text), objectKey = `maintenance/reconciliations/human-reviews/${sha256}.json`
    await f.bucket.put(objectKey, text)
    return { objectKey, sha256 }
  }
  return { ...f, sourceId, rawSha256, rawKey, snapshotKey, report, humanReceipt, target }
}

test('all 272 seeded schools start pending, with no invented observations or completed catalogue', async () => {
  const f = await fixture(false)
  try {
    const progress = await listSchoolProgress(f.env, now)
    assert.equal(progress.schools.length, 272)
    assert.equal(progress.seededSchoolCount, 272)
    assert.deepEqual(progress.counts, { schools: 272, attempted: 0, observed: 0, reconciled: 0 })
    assert.ok(progress.schools.every(school => school.firstInspectionStatus === 'pending' && school.reconciliation.status === 'pending' && school.snapshots.length === 0))
  } finally { f.db.sqlite.close() }
})

test('real failed attempts and captured source observations drive separate first-check states', async () => {
  const f = await fixture(false)
  try {
    f.db.sqlite.prepare('UPDATE maintenance_sources SET last_attempt_at=?,failures=1,error_code=? WHERE source_id=?').run(checkedAt, 'source_http_503', f.sourceId)
    const failed = (await listSchoolProgress(f.env, now)).schools[0]
    assert.equal(failed.firstInspectionStatus, 'in_progress'); assert.equal(failed.failedSourceCount, 1)
    assert.equal(failed.capturedSourceCount, 0); assert.equal(failed.lastAttemptAt, checkedAt)
    assert.equal(failed.reconciliation.status, 'pending')
  } finally { f.db.sqlite.close() }
  const captured = await fixture()
  try {
    const result = (await listSchoolProgress(captured.env, now)).schools[0]
    assert.equal(result.firstInspectionStatus, 'observed'); assert.equal(result.capturedSourceCount, 1)
    assert.equal(result.snapshots[0].snapshotKey, captured.snapshotKey)
    assert.equal(result.snapshots[0].rawSha256, captured.rawSha256)
    assert.equal(result.reconciliation.status, 'pending'); assert.ok(result.nextDueAt)
  } finally { captured.db.sqlite.close() }
})

test('a count-perfect model report is persisted with checksum but cannot complete without independent human proof', async () => {
  const f = await fixture()
  try {
    const result = await submitSchoolReconciliation(f.env, { report: f.report }, now)
    assert.equal(result.status, 'in_progress')
    assert.deepEqual(result.blockers, ['independent_human_review_required'])
    assert.equal(await digest(await (await f.bucket.get(result.reportKey))!.arrayBuffer()), result.sha256)
    const event = f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='school_reconciliation_report'").get()
    assert.equal(JSON.parse(String(event?.details_json)).sha256, result.sha256)
    assert.equal((await listSchoolProgress(f.env, now)).counts.reconciled, 0)
  } finally { f.db.sqlite.close() }
})

test('only checksum-bound human review of actual catalogues and every mapped row can complete', async () => {
  const f = await fixture()
  try {
    const result = await submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt() }, now)
    assert.equal(result.status, 'complete'); assert.deepEqual(result.blockers, [])
    const progress = await listSchoolProgress(f.env, now)
    assert.equal(progress.counts.reconciled, 1); assert.equal(progress.schools[0].reconciliation.status, 'complete')
  } finally { f.db.sqlite.close() }
})

test('HTTP school progress and reconciliation routes retain the admin authentication boundary', async () => {
  const f = await fixture()
  try {
    assert.equal((await handleFetch(new Request('https://worker/schools'), f.env)).status, 401)
    assert.equal((await handleFetch(new Request('https://worker/reconciliations', { method: 'POST' }), f.env)).status, 401)
    const headers = { authorization: `Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`, 'content-type': 'application/json' }
    const response = await handleFetch(new Request('https://worker/schools', { headers }), f.env)
    assert.equal(response.status, 200); assert.equal((await response.json()).schools.length, 272)
    const submitted = await handleFetch(new Request('https://worker/reconciliations', { method: 'POST', headers,
      body: JSON.stringify({ report: f.report }) }), f.env)
    assert.equal(submitted.status, 200); assert.equal((await submitted.json()).status, 'in_progress')
  } finally { f.db.sqlite.close() }
})

test('human proof rejects model reviewers, changed observed hash, future checks and unreviewed rows', async () => {
  for (const change of [
    { reviewer: { id: 'minimax-review', kind: 'human' } },
    { observedReportSha256: '0'.repeat(64) },
    { reviewedAt: '2027-01-01T00:00:00.000Z' },
    { reviewedAt: '2026-10-24T01:00:00.000Z' },
    { observedCatalogs: [] },
  ]) {
    const f = await fixture()
    try {
      await assert.rejects(submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt(change) }, now))
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='school_reconciliation_report'").get()?.count, 0)
    } finally { f.db.sqlite.close() }
  }
})

test('catalogues require the exact school-source association, observed URL and raw hash', async () => {
  for (const change of ['school', 'url', 'hash', 'absence'] as const) {
    const f = await fixture()
    try {
      if (change === 'school') f.report.universityId = 'uni-001'
      if (change === 'url') f.report.catalogs[0].url = 'https://test.edu.cn/another'
      if (change === 'hash') f.report.catalogs[0].snapshotSha256 = '0'.repeat(64)
      if (change === 'absence') f.report.categories[1].evidenceUrl = 'https://another.edu.cn/claimed-absence'
      await assert.rejects(submitSchoolReconciliation(f.env, { report: f.report }, now), /reconciliation_(catalog_observation_mismatch|absence_evidence_not_captured)/)
    } finally { f.db.sqlite.close() }
  }
})

test('missing or altered R2 bytes cannot back a report despite a D1 observation', async () => {
  for (const change of ['missing', 'raw', 'metadata'] as const) {
    const f = await fixture()
    try {
      if (change === 'missing') f.bucket.objects.delete(f.snapshotKey)
      if (change === 'raw') await f.bucket.put(f.rawKey, 'tampered')
      if (change === 'metadata') await f.bucket.put(f.snapshotKey, canonical({ sourceId: 'other' }))
      await assert.rejects(submitSchoolReconciliation(f.env, { report: f.report }, now), /reconciliation_(artifact_unavailable|raw_checksum_mismatch|snapshot_binding_invalid)/)
    } finally { f.db.sqlite.close() }
  }
})

test('published official rows must map to an active program with the exact parent and official source', async () => {
  for (const change of ['inactive', 'parent', 'source', 'record'] as const) {
    const f = await fixture()
    try {
      if (change === 'inactive') f.db.sqlite.prepare('UPDATE maintenance_record_targets SET active=0').run()
      if (change === 'parent') {
        f.target.identity.universityId = 'uni-001'
        f.db.sqlite.prepare('UPDATE maintenance_record_targets SET target_json=?').run(canonical(f.target))
      }
      if (change === 'source') f.db.sqlite.prepare('DELETE FROM maintenance_target_sources').run()
      if (change === 'record') f.report.entries[0].recordId = 'not-a-published-target'
      await assert.rejects(submitSchoolReconciliation(f.env, { report: f.report }, now), /reconciliation_published_target_parent_mismatch/)
    } finally { f.db.sqlite.close() }
  }
})

test('human approval does not waive missing pages, limited scope or duplicate row mappings', async () => {
  const f = await fixture()
  try {
    f.report.catalogs[0].expectedPages = 2
    const result = await submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt() }, now)
    assert.equal(result.status, 'in_progress'); assert.ok(result.blockers.includes(`${f.sourceId}:pages_incomplete`))
    f.report.scope = 'limited_official_catalog'; f.report.limitationNote = 'Only one faculty.'
    f.report.catalogs[0].expectedPages = 1
    const limited = await submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt() }, now)
    assert.equal(limited.status, 'in_progress'); assert.ok(limited.blockers.includes('full_school_catalog_scope_required'))
    f.report.entries.push({ ...f.report.entries[0], officialKey: 'duplicate-map' })
    await assert.rejects(submitSchoolReconciliation(f.env, { report: f.report }, now), /reconciliation_duplicate_published_mapping/)
  } finally { f.db.sqlite.close() }
})

test('a changed active catalogue, target refresh or newer source observation invalidates prior completeness', async () => {
  for (const change of ['catalogue', 'source', 'targets'] as const) {
    const f = await fixture()
    try {
      await submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt() }, now)
      if (change === 'catalogue') f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run('9'.repeat(64))
      else if (change === 'targets') f.db.sqlite.prepare('UPDATE maintenance_control SET targets_complete=0').run()
      else f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('observation-b', 'capture-b', f.sourceId, '2026-10-24T03:30:00.000Z', url, 200, '8'.repeat(64), '8'.repeat(64), 'next-snapshot', 'text/plain', 'captured', 1)
      const progress = await listSchoolProgress(f.env, now)
      assert.equal(progress.counts.reconciled, 0)
      assert.deepEqual(progress.schools[0].reconciliation.blockers, ['catalogue_or_source_changed_since_reconciliation'])
    } finally { f.db.sqlite.close() }
  }
})

test('corrupted stored proof fails closed when reading progress', async () => {
  const f = await fixture()
  try {
    const result = await submitSchoolReconciliation(f.env, { report: f.report, reviewReceipt: await f.humanReceipt() }, now)
    await f.bucket.put(result.reportKey, '{"evaluation":{"status":"complete"}}')
    assert.equal((await listSchoolProgress(f.env, now)).counts.reconciled, 0)
  } finally { f.db.sqlite.close() }
})

test('D1 quota fallback retains all 272 fixed schools with unknown actual progress and no completion', async () => {
  const f = makeEnv()
  try {
    const envelope = { seed: seedInput() }, body = canonical(envelope), hash = await digest(body)
    const key = `maintenance/bootstrap-pending/envelopes/${hash}.json`
    await f.bucket.put(key, body)
    await f.bucket.put('maintenance/bootstrap-pending/initial.v1.json', canonical({ scopeRegistrySha256: TEST_SCOPE, envelopeSha256: hash, envelopeKey: key }))
    const env = { ...f.env, PIPELINE_DB: { ...f.env.PIPELINE_DB, prepare() { throw new Error('D1 daily quota exceeded 7500') } } }
    const progress = await listSchoolProgress(env, now)
    assert.equal(progress.backendState, 'quota_wait'); assert.equal(progress.schools.length, 272)
    assert.equal(progress.seededSchoolCount, null); assert.equal(progress.counts.reconciled, null)
    assert.ok(progress.schools.every(school => school.firstInspectionStatus === 'unknown' && school.capturedSourceCount === null && school.reconciliation.status === 'pending'))
    await f.bucket.put(key, body + ' ')
    await assert.rejects(listSchoolProgress(env, now), /school_progress_bootstrap_checksum_invalid/)
  } finally { f.db.sqlite.close() }
})
