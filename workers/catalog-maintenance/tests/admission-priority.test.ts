import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { hasUrgentMaintenance } from '../src/admission-priority'
import { control, seed, setControls } from '../src/repository'
import { publishCoverageSnapshot, type CoverageSnapshot } from '../src/coverage'
import { canonical, digest, gateRequest } from '../src/util'
import type { ModelRequest, RecordTarget } from '../src/types'
import { makeEnv, seedInput, quotaResponse, TEST_CATALOG, TEST_GUARDS, TEST_SCOPE } from './fixture'

const now = Date.parse('2026-11-12T04:00:00Z'), today = '2026-11-12', snapshot = 'd'.repeat(64), scope = 'e'.repeat(64)
async function fixture(priority = 1, status = 'queued') {
  const f = makeEnv(), sourceId = await digest('https://test.edu.cn/catalog')
  const target: RecordTarget = { recordId: 'program-one', entityType: 'program', universityId: 'uni-000', sourceIds: [sourceId],
    recordScopeSha256: scope, identity: { name: { en: 'Physics' } }, year: null, intake: null, fields: { durationMonths: 48 }, reviewAfter: '2026-11-13' }
  await seed(f.env, { ...seedInput(), recordTargets: [target] }, now)
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] }, now)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run(snapshot, sourceId)
  f.db.sqlite.prepare(`INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json,lease_token,lease_until)
    VALUES('maintenance-one',?,'maintain',?,?,?,?,?,?,?,?,?,?)`).run(sourceId, status, priority, new Date(now - 1000).toISOString(), new Date(now).toISOString(), new Date(now).toISOString(),
      snapshot, 'maintenance/snapshots/test.json', canonical([{ id: 'program:program-one', sha256: scope }]), status === 'running' ? 'valid-owner' : null, status === 'running' ? new Date(now + 60000).toISOString() : null)
  const cfg = (await control(f.env))!
  return { ...f, cfg, sourceId, urgent: () => hasUrgentMaintenance(f.env, cfg, now) }
}
async function coverage(f: Awaited<ReturnType<typeof fixture>>, reviewAfter: string | null = '2026-11-13', options: Partial<CoverageSnapshot> = {}, currentFacts = true) {
  const content = { format: 'studyinchina.school-program-coverage' as const, version: 1 as const, scopeRegistrySha256: TEST_SCOPE,
    inputCatalogSha256: TEST_CATALOG, evaluatedOn: today, schools: seedInput().schools.map((school, index) => ({ universityId: school.universityId,
      rawProgramCount: index === 0 ? 1 : 0, directoryProgramCount: index === 0 ? 1 : 0, currentProgramCount: index === 0 && currentFacts ? 1 : 0,
      minimumProgramCount: 5 as const, gap: index === 0 && currentFacts ? 4 : 5, coverageBand: index === 0 && currentFacts ? 'one' as const : 'zero' as const,
      countedProgramIds: index === 0 && currentFacts ? ['program-one'] : [], directoryScholarshipCount: 0, currentScholarshipCount: 0, reviewAfter: index === 0 ? reviewAfter : null })), ...options }
  const value = { ...content, sha256: await digest(canonical(content)) }
  await publishCoverageSnapshot(f.env, value, now)
  return value
}

test('a nonurgent backlog with a near raw record date does not reserve quota without current coverage evidence', async () => {
  const f = await fixture()
  try { assert.equal(await f.urgent(), false) } finally { f.db.sqlite.close() }
})
for (const status of ['queued', 'retry', 'running']) test(`explicit urgent ${status} work reserves quota without a coverage snapshot`, async () => {
  const f = await fixture(0, status)
  try { assert.equal(await f.urgent(), true) } finally { f.db.sqlite.close() }
})
for (const change of ['future', 'held', 'unknown', 'done', 'disabled-source', 'outside-canary', 'foreign-scope', 'inactive-target', 'changed-pin', 'missing-source-binding', 'unassociated-school', 'expired-lease', 'missing-lease', 'old-snapshot', 'missing-snapshot', 'pending-targets', 'malformed-pins', 'scalar-pins', 'cycle-discovery'] as const) {
  test(`explicit priority zero cannot reserve quota for ${change}`, async () => {
    const f = await fixture(0, change.includes('lease') ? 'running' : 'queued')
    try {
      const db = f.db.sqlite
      if (change === 'future') db.prepare('UPDATE maintenance_jobs SET due_at=?').run(new Date(now + 1000).toISOString())
      if (['held', 'unknown', 'done'].includes(change)) db.prepare('UPDATE maintenance_jobs SET status=?').run(change)
      if (change === 'disabled-source') db.exec('UPDATE maintenance_sources SET enabled=0')
      if (change === 'outside-canary') f.cfg.canary_json = '["uni-001"]'
      if (change === 'foreign-scope') db.prepare('UPDATE maintenance_schools SET scope_sha256=? WHERE university_id=?').run('f'.repeat(64), 'uni-000')
      if (change === 'inactive-target') db.exec('UPDATE maintenance_record_targets SET active=0')
      if (change === 'changed-pin') db.prepare('UPDATE maintenance_jobs SET target_ids_json=?').run(canonical([{ id: 'program:program-one', sha256: 'f'.repeat(64) }]))
      if (change === 'missing-source-binding') db.exec('DELETE FROM maintenance_target_sources')
      if (change === 'unassociated-school') db.exec('DELETE FROM maintenance_source_schools')
      if (change === 'expired-lease') db.prepare('UPDATE maintenance_jobs SET lease_until=?').run(new Date(now).toISOString())
      if (change === 'missing-lease') db.exec('UPDATE maintenance_jobs SET lease_token=NULL,lease_until=NULL')
      if (change === 'old-snapshot') db.prepare('UPDATE maintenance_sources SET raw_sha256=?').run('f'.repeat(64))
      if (change === 'missing-snapshot') db.exec('UPDATE maintenance_jobs SET snapshot_key=NULL')
      if (change === 'pending-targets') f.cfg.targets_complete = 0
      if (change === 'malformed-pins') db.prepare('UPDATE maintenance_jobs SET target_ids_json=?').run('invalid json')
      if (change === 'scalar-pins') db.prepare('UPDATE maintenance_jobs SET target_ids_json=?').run('["not a target pin",0,null]')
      if (change === 'cycle-discovery') db.prepare('UPDATE maintenance_jobs SET target_ids_json=?').run(canonical({ kind: 'cycle-discovery', targets: [{ id: 'program:program-one', sha256: scope }] }))
      assert.equal(await f.urgent(), false)
    } finally { f.db.sqlite.close() }
  })
}

test('compatible object-shaped field pins work, while cycle discovery is never treated as urgent maintenance', async () => {
  const f = await fixture(0)
  try {
    const pins = [{ id: 'program:program-one', sha256: scope }]
    f.db.sqlite.prepare('UPDATE maintenance_jobs SET target_ids_json=?').run(canonical({ kind: 'fields', targets: pins }))
    assert.equal(await f.urgent(), true)
    f.db.sqlite.prepare('UPDATE maintenance_jobs SET priority=2,target_ids_json=?').run(canonical({ kind: 'cycle-discovery', targets: pins }))
    await coverage(f); assert.equal(await f.urgent(), false)
  } finally { f.db.sqlite.close() }
})

for (const date of ['2026-11-12', '2026-11-19']) test(`bound current programme coverage protects review date ${date} without explicit priority zero`, async () => {
  const f = await fixture()
  try { await coverage(f, date); assert.equal(await f.urgent(), true) } finally { f.db.sqlite.close() }
})
for (const change of ['expired-review', 'later-review', 'no-review', 'yesterday', 'wrong-catalog', 'wrong-scope', 'empty-current-facts', 'tampered'] as const) {
  test(`nonurgent work cannot reserve quota through ${change} coverage`, async () => {
    const f = await fixture()
    try {
      const value = await coverage(f, change === 'expired-review' ? '2026-11-11' : change === 'later-review' ? '2026-11-20' : change === 'no-review' ? null : '2026-11-13',
        change === 'yesterday' ? { evaluatedOn: '2026-11-11' } : change === 'wrong-catalog' ? { inputCatalogSha256: 'a'.repeat(64) } : change === 'wrong-scope' ? { scopeRegistrySha256: '9'.repeat(64) } : {}, change !== 'empty-current-facts')
      if (change === 'tampered') await f.bucket.put(`maintenance/coverage/${value.sha256}.json`, canonical({ ...value, evaluatedOn: '2026-11-11' }))
      assert.equal(await f.urgent(), false)
    } finally { f.db.sqlite.close() }
  })
}

test('real admission releases the old blanket 20% reserve but preserves explicit urgent reserve and the 5% floor', async () => {
  const originalClock = Date.now; Date.now = () => now
  try {
    for (const [remaining, priority, expected] of [[15, 1, 'allowed'], [15, 0, 'maintenance_quota_reserved'], [5, 1, 'quota_exhausted_or_overflow_margin']] as const) {
      const f = await fixture(priority); let sends = 0
      f.env.MINIMAX_CREDIT_FALLBACK_DISABLED = 'false'
      // Recreate the same real shared gate with only its provider transport mocked.
      const { ModelAdmission } = await import('../src/admission')
      const gate = new ModelAdmission({ storage: f.storage }, f.env, async url => {
        if (String(url).includes('token_plan')) return quotaResponse(remaining, 80)
        sends++; return Response.json({ content: [{ type: 'text', text: '{"programs":[]}' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' })
      })
      f.env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => gate.fetch(request) }) }
      const request: ModelRequest = { reservationKey: await digest(`request-${remaining}-${priority}`), sourceId: f.sourceId, universityIds: ['uni-000'], snapshotSha256: snapshot,
        pass: 'primary', payload: 'Exact test evidence', lane: 'expansion', recordIds: [] }
      try {
        const response = await gateRequest(f.env, '/model/run', request), result = await response.json()
        assert.equal(response.ok, expected === 'allowed'); assert.equal(sends, expected === 'allowed' ? 1 : 0)
        if (expected !== 'allowed') assert.equal(result.error, expected)
      } finally { f.db.sqlite.close() }
    }
  } finally { Date.now = originalClock }
})

test('the urgency selector uses bounded existence checks instead of a full-backlog count', () => {
  const source = readFileSync(new URL('../src/admission-priority.ts', import.meta.url), 'utf8')
  assert.match(source, /SELECT 1 present/u); assert.match(source, /LIMIT 1/u); assert.doesNotMatch(source, /COUNT\(\*\)/u)
})
