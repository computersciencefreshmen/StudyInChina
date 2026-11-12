import assert from 'node:assert/strict'
import test from 'node:test'
import type { D1PreparedStatement, D1Result } from '../../publisher/src/types'
import type { RecordTarget } from '../src/types'
import { continueTargetRefresh, control, seed, setControls } from '../src/repository'
import { canonical, digest } from '../src/util'
import { makeEnv, seedInput, TEST_CATALOG, TEST_GUARDS, TEST_SCOPE } from './fixture'

async function fixture() {
  const f = makeEnv()
  await seed(f.env, seedInput())
  await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: ['uni-000'] })
  const sourceId = await digest('https://test.edu.cn/catalog')
  const targets: RecordTarget[] = Array.from({ length: 4129 }, (_, index) => ({
    recordId: `international-programme-${String(index).padStart(5, '0')}`, entityType: 'program', universityId: 'uni-000',
    recordScopeSha256: index.toString(16).padStart(64, '0'), sourceIds: [sourceId], year: null, intake: null,
    identity: { name: { en: `International Computer Science and Information Engineering ${index}`,
      zh: `计算机科学、信息工程与国际跨学科研究专业 ${index}`, ru: `Международная программа компьютерных наук и информационной инженерии ${index}`,
      de: `Internationaler Studiengang Informatik und Informationstechnik ${index}`, fr: `Programme international en informatique et ingénierie de l’information ${index}`,
      es: `Programa internacional de ciencias de la computación e ingeniería de la información ${index}` },
      degreeLevel: 'master', universityId: 'uni-000', teachingLanguages: ['English', 'Chinese'] },
    fields: { durationMonths: 24, durationMonthsMax: null, durationText: null, applyUrl: `https://test.edu.cn/apply/programme-${index}`,
      languageRequirements: null, 'supplementaryDetails.faculty': null, 'supplementaryDetails.qualification': null,
      'supplementaryDetails.languagePolicy': null, 'supplementaryDetails.curriculumHighlights': null,
      'supplementaryDetails.eligibility': null, 'supplementaryDetails.applicationMaterials': null, 'supplementaryDetails.campus': null },
    reviewAfter: '2027-01-31',
  }))
  const refreshSha256 = await digest(canonical({ inputCatalogSha256: TEST_CATALOG, recordTargets: targets }))
  const plan = canonical({ refreshSha256, inputCatalogSha256: TEST_CATALOG, expectedCount: targets.length, operations: [] })
  await f.bucket.put(`maintenance/target-refresh/${refreshSha256}.json`, plan)
  await f.bucket.put(`maintenance/target-refresh/revalidate/${refreshSha256}.json`, canonical({ scopeRegistrySha256: TEST_SCOPE,
    inputCatalogSha256: TEST_CATALOG, recordTargets: targets }))
  f.db.sqlite.prepare("INSERT INTO maintenance_target_refreshes VALUES(?,?,?,?,?,?,'completed',?)")
    .run(refreshSha256, TEST_CATALOG, await digest(plan), 0, 0, targets.length, new Date().toISOString())
  const insert = f.db.sqlite.prepare('INSERT INTO maintenance_record_targets VALUES(?,?,?,?,?,?,?,?,?,1)')
  const bindSource = f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)')
  f.db.sqlite.exec('BEGIN IMMEDIATE')
  for (const target of targets) {
    const id = `${target.entityType}:${target.recordId}`
    insert.run(id, target.recordId, target.entityType, target.universityId, target.recordScopeSha256, target.year, target.intake,
      JSON.stringify(target.fields), canonical(target))
    bindSource.run(id, sourceId)
  }
  f.db.sqlite.exec('COMMIT')
  f.db.sqlite.prepare('UPDATE maintenance_control SET targets_complete=0').run()
  const storedBytes = Number(f.db.sqlite.prepare('SELECT SUM(length(CAST(target_json AS BLOB))) n FROM maintenance_record_targets').get()?.n)
  assert.ok(storedBytes > 3_000_000, `fixture must exceed the real D1 single-value limit: ${storedBytes}`)

  const prepare = f.db.prepare.bind(f.db), batch = f.db.batch.bind(f.db), manifestSizes: number[] = [], manifestIds: string[] = []
  let beforeBatch: (() => void) | undefined, batchCalls = 0, batchStatements = 0
  f.db.prepare = sql => {
    assert.ok(Buffer.byteLength(sql) <= 100_000, 'D1 statement length limit')
    const statement = prepare(sql), bind = statement.bind.bind(statement)
    statement.bind = (...values: unknown[]) => {
      assert.ok(values.length <= 100, 'D1 bound parameter count')
      for (const value of values) if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= 2_000_000, 'D1 single-value size limit')
      if (sql.includes('json_each(?) m LEFT JOIN maintenance_record_targets')) {
        const manifest = values[1]
        assert.equal(typeof manifest, 'string')
        manifestSizes.push(Buffer.byteLength(manifest as string))
        manifestIds.push(...(JSON.parse(manifest as string) as Array<{ target_id: string }>).map(row => row.target_id))
      }
      return bind(...values)
    }
    return statement
  }
  f.db.batch = async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    batchCalls++; batchStatements += statements.length
    const hook = beforeBatch; beforeBatch = undefined; hook?.()
    return batch<T>(statements)
  }
  return { ...f, targets, refreshSha256, storedBytes, manifestSizes, manifestIds, beforeBatch: (hook: () => void) => { beforeBatch = hook },
    batchCalls: () => batchCalls, batchStatements: () => batchStatements,
    restore: () => continueTargetRefresh(f.env, refreshSha256, false) }
}

function assertNotRestored(f: Awaited<ReturnType<typeof fixture>>, revision = 1) {
  const cfg = f.db.sqlite.prepare('SELECT revision,targets_complete FROM maintenance_control').get()
  assert.equal(cfg?.targets_complete, 0); assert.equal(cfg?.revision, revision)
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_revalidated'").get()?.n, 0)
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n, 0)
}

test('4129 complete targets restore through the Queue path with bounded UTF-8 manifests in one atomic batch', async () => {
  const f = await fixture()
  try {
    const before = (await control(f.env))!
    assert.equal((await f.restore()).targetsComplete, true)
    assert.equal(f.batchCalls(), 1); assert.ok(f.manifestSizes.length > 50)
    assert.ok(f.manifestSizes.every(size => size <= 64 * 1024))
    assert.deepEqual(f.manifestIds, f.targets.map(target => `${target.entityType}:${target.recordId}`))
    assert.equal(f.batchStatements(), f.manifestSizes.length + 4)
    const after = (await control(f.env))!
    assert.equal(after.targets_complete, 1); assert.equal(after.revision, before.revision + 1)
    for (const key of ['enabled', 'models_enabled', 'canary_json', 'scope_sha256', 'input_catalog_sha256', 'legacy_guard_sha256'] as const)
      assert.equal(after[key], before[key])
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n, 0)
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='targets_revalidated'").get()?.n, 1)
    const details = JSON.parse(String(f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='targets_revalidated'").get()?.details_json))
    assert.equal(details.fromRevision, before.revision); assert.equal(details.toRevision, after.revision)
    await f.restore()
    assert.equal(f.batchCalls(), 1); assert.equal((await control(f.env))?.revision, after.revision)
  } finally { f.db.sqlite.close() }
})

for (const change of ['last-row-json', 'last-row-scope', 'replacement-row', 'extra-row', 'operator-pause'] as const) {
  test(`late ${change} prevents restoration and rolls back every chunk guard`, async () => {
    const f = await fixture()
    try {
      const last = f.targets.at(-1)!, id = `${last.entityType}:${last.recordId}`
      f.beforeBatch(() => {
        if (change === 'last-row-json') f.db.sqlite.prepare("UPDATE maintenance_record_targets SET target_json=json_set(target_json,'$.identity.name.en','Changed after readback') WHERE target_id=?").run(id)
        if (change === 'last-row-scope') f.db.sqlite.prepare('UPDATE maintenance_record_targets SET record_scope_sha256=? WHERE target_id=?').run('f'.repeat(64), id)
        if (change === 'replacement-row') {
          f.db.sqlite.prepare("INSERT INTO maintenance_record_targets SELECT 'program:replacement','replacement',entity_type,university_id,record_scope_sha256,academic_year,intake,fields_json,target_json,1 FROM maintenance_record_targets WHERE target_id=?").run(id)
          f.db.sqlite.prepare('UPDATE maintenance_record_targets SET active=0 WHERE target_id=?').run(id)
        }
        if (change === 'extra-row') f.db.sqlite.prepare("INSERT INTO maintenance_record_targets VALUES('program:extra','extra','program','uni-000',?,NULL,NULL,'{}','{}',1)").run('e'.repeat(64))
        if (change === 'operator-pause') f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1,enabled=0,models_enabled=0').run()
      })
      await assert.rejects(f.restore(), /target_refresh_reuse_control_changed/)
      assert.equal(f.batchCalls(), 1)
      assertNotRestored(f, change === 'operator-pause' ? 2 : 1)
      if (change === 'operator-pause') assert.equal((await control(f.env))?.enabled, 0)
      assert.equal(f.db.sqlite.prepare('SELECT status FROM maintenance_target_refreshes WHERE refresh_sha256=?').get(f.refreshSha256)?.status, 'completed')
    } finally { f.db.sqlite.close() }
  })
}

test('an event-write failure rolls back the restored flag and revision, and an exact retry succeeds', async () => {
  const f = await fixture()
  try {
    f.db.sqlite.exec("CREATE TRIGGER fail_revalidation_event BEFORE INSERT ON maintenance_events WHEN NEW.kind='targets_revalidated' BEGIN SELECT RAISE(ABORT,'forced event failure'); END")
    await assert.rejects(f.restore(), /target_refresh_reuse_control_changed/)
    assertNotRestored(f)
    f.db.sqlite.exec('DROP TRIGGER fail_revalidation_event')
    await f.restore()
    assert.equal((await control(f.env))?.targets_complete, 1); assert.equal((await control(f.env))?.revision, 2)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n, 0)
  } finally { f.db.sqlite.close() }
})
