import assert from 'node:assert/strict'
import test from 'node:test'
import { tickJobLimit } from '../src/dispatch-config'
import { runCloudTick } from '../src/runtime'
import { enqueueDue, seed, setControls } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv, seedInput, TEST_GUARDS } from './fixture'

const start = Date.parse('2026-11-14T04:00:00.000Z'), schools = 48
async function fixture(value: string | undefined, models: boolean, count: 272 | 295 = 272) {
  let network = 0
  const f = makeEnv(async () => { network++; throw new Error('scheduler_must_not_contact_provider') }), input = seedInput()
  if (count === 295) { input.schools.push(...Array.from({ length: 23 }, (_, i) => ({ universityId: `uni-${272 + i}`, name: { en: `University ${272 + i}` }, sourceSeeds: [] }))); f.env.SCOPE_SCHOOL_COUNT = '295' }
  f.env.TICK_JOB_LIMIT = value
  for (let i = 0; i < schools; i++) input.schools[i].sourceSeeds = ['program', 'award'].map(kind => ({ id: `${kind}-${i}`, url: `https://university-${i}.edu.cn/${kind}`,
    allowedHosts: [`university-${i}.edu.cn`], sourceCategory: kind === 'award' ? 'scholarships' : 'undergraduate_catalog', enabled: true, registration: 'catalogue_official' }))
  await seed(f.env, input, start)
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] }, start)
  await setControls(f.env, { expectedRevision: 1, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: [] }, start)
  f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(start + (models ? 30 * 86400000 : -60000)).toISOString())
  if (models) for (let i = 0; i < schools; i++) for (const stage of ['maintain', 'extract', 'award']) {
    const sourceId = await digest(input.schools[i].sourceSeeds[stage === 'award' ? 1 : 0].url), id = await digest(`${stage}-${i}`), due = new Date(start - 60000).toISOString()
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',10,?,?,?)").run(id, sourceId, stage, due, due, due)
  }
  return { ...f, network: () => network }
}
function sent(f: Awaited<ReturnType<typeof fixture>>) {
  return f.messages.map(m => f.db.sqlite.prepare('SELECT stage,university_id FROM maintenance_jobs j JOIN maintenance_source_schools s ON s.source_id=j.source_id WHERE j.job_id=?').get(m.jobId) as { stage: string; university_id: string })
}

test('dispatch configuration admits only exact reviewed strings and otherwise preserves the eight-job default', () => {
  for (const value of [undefined, '', ' ', '0', '1', '7', '9', '15', '17', '31', '33', '9999999', '08', '+16', '16.0', '32.0', '3.2e1', '0x20', '16 ', '\n32', 'NaN', 'Infinity']) assert.equal(tickJobLimit({ TICK_JOB_LIMIT: value }), 8, String(value))
  assert.equal(tickJobLimit({ TICK_JOB_LIMIT: '8' }), 8); assert.equal(tickJobLimit({ TICK_JOB_LIMIT: '16' }), 16); assert.equal(tickJobLimit({ TICK_JOB_LIMIT: '32' }), 32)
})

test('the real cloud tick passes the same bound to capture creation and queue dispatch for both registry sizes', async t => {
  const originalNow = Date.now; Date.now = () => start
  try {
    for (const count of [272, 295] as const) for (const [value, limit] of [[undefined, 8], ['8', 8], ['16', 16], ['32', 32], ['32.0', 8]] as const) await t.test(`${count}:${String(value)}`, async () => {
      const f = await fixture(value, false, count)
      let calls = 0, maxBindings = 0
      const prepare = f.db.prepare.bind(f.db)
      f.db.prepare = sql => { calls++; const statement = prepare(sql), bind = statement.bind.bind(statement); statement.bind = (...values: unknown[]) => { maxBindings = Math.max(maxBindings, values.length); return bind(...values) }; return statement }
      try {
        const before = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()), tick = await runCloudTick(f.env)
        assert.equal(tick.state, 'running'); assert.equal(tick.queued, limit); assert.equal(f.messages.length, limit)
        assert.equal(new Set(f.messages.map(m => m.jobId)).size, limit)
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='capture'").get()?.n, limit)
        assert.equal(new Set(sent(f).map(j => j.university_id)).size, limit)
        assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get()), before)
        const event = JSON.parse(String(f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='scheduler_tick'").get()?.details_json))
        assert.equal(event.jobLimit, limit); assert.equal(event.queued, limit); assert.equal(event.discoveredDueSources, limit)
        assert.ok(calls < 128, `bounded ordinary tick used ${calls} D1 operations`); assert.ok(maxBindings <= 100)
        assert.equal(f.network(), 0); assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n, 0)
      } finally { f.db.sqlite.close() }
    })
  } finally { Date.now = originalNow }
})

test('larger ready-job pools retain cross-school rotation, 70% expansion, 2:1 programme/award shares and actual send bounds', async t => {
  for (const limit of [16, 32] as const) await t.test(String(limit), async () => {
    const f = await fixture(String(limit), true)
    try {
      let maintenance = 0, program = 0, award = 0
      const initialSchools = new Set<string>()
      for (let i = 0; i < 30; i++) {
        f.messages.length = 0
        f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run()
        const result = await enqueueDue(f.env, start + i * 900000), jobs = sent(f)
        assert.equal(result.queued, limit); assert.equal(jobs.length, limit)
        assert.equal(new Set(jobs.map(j => j.university_id)).size, limit)
        if (i < 3) for (const j of jobs) initialSchools.add(j.university_id)
        maintenance += jobs.filter(j => j.stage === 'maintain').length
        program += jobs.filter(j => j.stage === 'extract').length
        award += jobs.filter(j => j.stage === 'award').length
      }
      assert.equal(initialSchools.size, schools, 'a larger reservoir must not keep refilling only the same schools')
      assert.equal(maintenance, limit * 9); assert.equal(program + award, limit * 21); assert.equal(program, 2 * award)
      assert.equal(f.network(), 0)
    } finally { f.db.sqlite.close() }
  })
})

test('empty shares are borrowed without exceeding32, and urgent work still precedes ordinary expansion', async () => {
  const f = await fixture('32', true)
  try {
    f.db.sqlite.prepare("DELETE FROM maintenance_jobs WHERE stage<>'award'").run()
    assert.equal((await enqueueDue(f.env, start)).queued, 32); assert.equal(sent(f).filter(j => j.stage === 'award').length, 32)
    const urgent = f.messages[0].jobId
    f.messages.length = 0; f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL,priority=10').run()
    f.db.sqlite.prepare('UPDATE maintenance_jobs SET priority=-1 WHERE job_id=?').run(urgent)
    assert.equal((await enqueueDue(f.env, start + 900000)).queued, 32)
    assert.equal(f.messages[0].jobId, urgent, 'urgent work outranks rotation age and normal lane shares')
    assert.equal(f.messages.length, 32); assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE status='running'").get()?.n, 0)
  } finally { f.db.sqlite.close() }
})

test('a32-job setting retains canary and model-disabled controls instead of forcing a full dispatch', async () => {
  const f = await fixture('32', true)
  try {
    const canary = Array.from({ length: 5 }, (_, i) => `uni-${String(i).padStart(3, '0')}`)
    await setControls(f.env, { expectedRevision: 2, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: canary }, start)
    assert.equal((await enqueueDue(f.env, start)).queued, 15)
    assert.ok(sent(f).every(j => canary.includes(j.university_id)))
    f.messages.length = 0
    f.db.sqlite.prepare('UPDATE maintenance_jobs SET enqueued_at=NULL').run()
    await setControls(f.env, { expectedRevision: 3, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: false, canaryUniversityIds: canary }, start)
    assert.equal((await enqueueDue(f.env, start + 900000)).queued, 0)
    assert.equal(f.messages.length, 0); assert.equal(f.network(), 0)
  } finally { f.db.sqlite.close() }
})
