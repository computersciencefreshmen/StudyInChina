import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { D1PreparedStatement } from '../../publisher/src/types'
import { canonicalJson, scopeContentSha256, type MaintenanceScope } from '../../../scripts/maintenance/contracts'
import { continueTargetRefresh, seed, sourceSchools, enqueueDue, setControls, control } from '../src/repository'
import { processScopeUpgrade, registerScopeUpgradeRequest, resumePendingScopeUpgrade, scopeUpgradeStatus, validateScopeUpgrade, SCOPE_UPGRADE_SCHEMA, type ScopeUpgrade } from '../src/scope-upgrade'
import { scopeUpgradeLineage } from '../src/scope-config'
import { digest } from '../src/util'
import { makeEnv, TEST_CATALOG, TEST_GUARDS } from './fixture'

async function fixture(sourcesPerNewSchool = 1) {
  const f = makeEnv()
  const schools = Array.from({ length: 272 }, (_, n) => ({ universityId: `uni-old-${n}`, name: { en: `School ${n}` },
    originalStatus: 'verified' as const, officialHosts: [`old${n}.edu.cn`], sourceSeeds: [] }))
  const old = { format: 'studyinchina.maintenance-scope' as const, formatVersion: 1 as const, scopeId: 'old',
    createdAt: '2026-11-01T00:00:00.000Z', expectedSchoolCount: 272 as const, inputCatalogSha256: TEST_CATALOG, schools }
  const previousScope: MaintenanceScope = { ...old, sha256: await scopeContentSha256(old) }
  const added = Array.from({ length: 23 }, (_, n) => ({ universityId: `uni-new-${n}`, name: { en: `New ${n}` },
    originalStatus: 'verified' as const, officialHosts: [`new${n}.edu.cn`], sourceSeeds: Array.from({ length: sourcesPerNewSchool }, (_, s) => ({
      id: `seed-new-${n}-${s}`, universityId: `uni-new-${n}`, url: `https://new${n}.edu.cn/catalog-${s}`,
      allowedHosts: [`new${n}.edu.cn`], sourceCategory: 'undergraduate_catalog' as const, entityType: 'program' as const,
      enabled: true, registration: 'catalogue_official' as const,
    })) }))
  const next = { ...old, formatVersion: 2 as const, scopeId: 'existing295', expectedSchoolCount: 295 as const,
    parentScopeSha256: previousScope.sha256, schools: [...structuredClone(schools), ...added] }
  const nextScope: MaintenanceScope = { ...next, sha256: await scopeContentSha256(next) }
  f.env.SCOPE_REGISTRY_SHA256 = previousScope.sha256
  await seed(f.env, { scopeRegistrySha256: previousScope.sha256, inputCatalogSha256: TEST_CATALOG, schools,
    legacyGuards: { artifactSha256: TEST_GUARDS, entries: [] } })
  f.db.sqlite.prepare('UPDATE maintenance_control SET enabled=1,models_enabled=1,revision=3').run()
  f.env.SCOPE_REGISTRY_SHA256 = nextScope.sha256; f.env.SCOPE_SCHOOL_COUNT = '295'
  const upgrade: ScopeUpgrade = { format: 'studyinchina.maintenance-scope-upgrade', version: 1, expectedRevision: 3,
    inputCatalogSha256: TEST_CATALOG, legacyGuardSha256: TEST_GUARDS, previousScope, nextScope }
  const text = canonicalJson(upgrade), hash = await digest(text)
  await f.bucket.put(`maintenance/scope-upgrades/uploads/${hash}.json`, text)
  return { ...f, upgrade, hash }
}

test('adds 23 schools with CAS, preserves original seed/guards/unknown usage/old exports and pauses for target refresh', async () => {
  const f = await fixture(), before = f.db.sqlite.prepare('SELECT seed_sha256 FROM maintenance_control').get() as { seed_sha256: string }
  f.db.sqlite.prepare("INSERT INTO maintenance_legacy_guards VALUES('old-stop',NULL,NULL,NULL,'\"*\"','unknown',?,'old unknown',NULL)").run(TEST_GUARDS)
  f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('old-key','old-attempt','source','snapshot','primary','request','MiniMax-M3','unknown','2026-11-01','{}')").run()
  f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES('old-export',?,?,'old/key',?,'2026-11-01','published',NULL,NULL)").run(TEST_CATALOG, f.upgrade.previousScope.sha256, 'd'.repeat(64))
  let result = await processScopeUpgrade(f.env, f.hash)
  while (!result.completed) result = await processScopeUpgrade(f.env, f.hash)
  const cfg = f.db.sqlite.prepare('SELECT * FROM maintenance_control').get() as Record<string, unknown>
  assert.equal(cfg.scope_sha256, f.upgrade.nextScope.sha256); assert.equal(cfg.seed_sha256, before.seed_sha256)
  assert.equal(cfg.enabled, 0); assert.equal(cfg.models_enabled, 0); assert.equal(cfg.targets_complete, 0); assert.equal(cfg.revision, 5)
  assert.equal((f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get() as { n: number }).n, 295)
  assert.equal((f.db.sqlite.prepare('SELECT state FROM maintenance_legacy_guards').get() as { state: string }).state, 'unknown')
  assert.equal((f.db.sqlite.prepare('SELECT status FROM maintenance_model_attempts').get() as { status: string }).status, 'unknown')
  assert.equal((f.db.sqlite.prepare('SELECT scope_sha256 FROM maintenance_exports').get() as { scope_sha256: string }).scope_sha256, f.upgrade.previousScope.sha256)
  assert.equal(await scopeUpgradeLineage(f.env, f.upgrade.previousScope.sha256, f.upgrade.nextScope.sha256), true)
  assert.equal((await processScopeUpgrade(f.env, f.hash)).reused, true)
  assert.equal((await scopeUpgradeStatus(f.env, f.hash)).originalEnabled, true)
  f.db.sqlite.close()
})

test('pending exports prevent the initial pause or any additions', async () => {
  const f = await fixture()
  f.db.sqlite.prepare("INSERT INTO maintenance_exports VALUES('pending',?,?,'key',?,'2026-11-01','prepared',NULL,NULL)").run(TEST_CATALOG, f.upgrade.previousScope.sha256, 'd'.repeat(64))
  await assert.rejects(processScopeUpgrade(f.env, f.hash))
  assert.equal((f.db.sqlite.prepare('SELECT revision FROM maintenance_control').get() as { revision: number }).revision, 3)
  assert.equal((f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get() as { n: number }).n, 272)
  f.db.sqlite.close()
})

test('newer manual pause fences a partially applied plan; no automatic control restore or replay', async () => {
  const f = await fixture(16)
  await uploadFixture(f, f.upgrade)
  const result = await processScopeUpgrade(f.env, f.hash)
  assert.equal(result.completed, false)
  f.db.sqlite.prepare('UPDATE maintenance_control SET revision=revision+1,enabled=0,models_enabled=0').run()
  const schoolCount = f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get()
  assert.equal((await processScopeUpgrade(f.env, f.hash)).state, 'handed_off')
  assert.deepEqual(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_schools').get(), schoolCount)
  assert.equal(await scopeUpgradeLineage(f.env, f.upgrade.previousScope.sha256, f.upgrade.nextScope.sha256), false)
  assert.equal(await resumePendingScopeUpgrade(f.env), false)
  assert.equal((await scopeUpgradeStatus(f.env, f.hash)).status, 'handed_off')
  assert.equal(await f.bucket.get(`maintenance/scope-upgrades/finished/${f.hash}.json`), null)
  f.db.sqlite.close()
})

test('partial scope upgrade followed by manual unrestricted resume isolates new-only sources and limits shared-source context to committed schools',async()=>{
  const f=await fixture(16), now=Date.now()
  try{
    let interrupted=false
    const batch=f.db.batch.bind(f.db)
    f.db.batch=async<T>(statements:D1PreparedStatement[])=>{
      const result=await batch<T>(statements)
      const linked=f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_source_schools x JOIN maintenance_schools s ON s.university_id=x.university_id WHERE s.scope_sha256=?').get(f.upgrade.nextScope.sha256)?.n
      if(!interrupted&&Number(linked)>=2){interrupted=true;throw new Error('simulated_worker_stop_before_scope_commit')}
      return result
    }
    // Stop after a real association chunk commits, before the separate scope-pointer CAS.
    await assert.rejects(async()=>{while(!interrupted)await processScopeUpgrade(f.env,f.hash)},/simulated_worker_stop_before_scope_commit/u)
    f.db.batch=batch
    assert.equal((await control(f.env))?.scope_sha256,f.upgrade.previousScope.sha256)
    const links=f.db.sqlite.prepare('SELECT x.source_id,x.university_id FROM maintenance_source_schools x JOIN maintenance_schools s ON s.university_id=x.university_id WHERE s.scope_sha256=? ORDER BY x.source_id LIMIT 2').all(f.upgrade.nextScope.sha256)as Array<{source_id:string;university_id:string}>
    const oldId=f.upgrade.previousScope.schools[0].universityId,sharedId=links[0].source_id,newOnlyId=links[1].source_id
    // A source can belong to an already committed school and a not-yet-committed school.
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(sharedId,oldId)
    assert.deepEqual((await sourceSchools(f.env,sharedId)).map(row=>row.university_id),[oldId])
    assert.deepEqual(await sourceSchools(f.env,newOnlyId),[])
    f.env.SCOPE_REGISTRY_SHA256=f.upgrade.previousScope.sha256;f.env.SCOPE_SCHOOL_COUNT='272'
    const cfg=(await control(f.env))!
    await setControls(f.env,{expectedRevision:cfg.revision,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:[]},now)
    assert.equal((await processScopeUpgrade(f.env,f.hash)).state,'handed_off')
    const at=new Date(now-60000).toISOString()
    // Migration insertion timestamps may be later than the scheduler's pinned
    // clock. Make both sources explicitly due so this tests scope isolation,
    // independently of machine speed, clock resolution or UTC tick boundaries.
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=? WHERE source_id IN(?,?)').run(at,sharedId,newOnlyId)
    for(const sourceId of [sharedId,newOnlyId])for(const stage of ['extract','award'])f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',1,?,?,?)")
      .run(`${sourceId}-${stage}`,sourceId,stage,at,at,at)
    f.messages.length=0
    const result=await enqueueDue(f.env,now)
    assert.ok(result.queued>0)
    const selected=f.messages.map(message=>f.db.sqlite.prepare('SELECT source_id,stage FROM maintenance_jobs WHERE job_id=?').get(message.jobId)as {source_id:string;stage:string})
    assert.ok(selected.some(row=>row.source_id===sharedId&&row.stage==='capture'))
    assert.ok(selected.some(row=>row.source_id===sharedId&&row.stage==='extract'))
    assert.ok(selected.every(row=>row.source_id===sharedId),'new-only sources cannot capture or enter the extraction/award pool')
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE source_id=? AND stage='capture'").get(newOnlyId)?.n,0)
  }finally{f.db.sqlite.close()}
})

test('changing an original source/host or removing an original school never qualifies as additive upgrade', async () => {
  const f = await fixture(), changed = structuredClone(f.upgrade)
  changed.nextScope.schools[0].officialHosts = ['attacker.example']
  changed.nextScope.sha256 = await scopeContentSha256(changed.nextScope)
  await assert.rejects(validateScopeUpgrade(changed), /original_school_changed/u)
  const removed = structuredClone(f.upgrade); removed.nextScope.schools[0] = structuredClone(removed.nextScope.schools[272])
  removed.nextScope.sha256 = await scopeContentSha256(removed.nextScope)
  await assert.rejects(validateScopeUpgrade(removed))
  f.db.sqlite.close()
})

test('fixed schema self-install is exactly additive migration 0021', () => {
  const normalize = (sql: string) => sql.replace(/--.*$/gmu, '').replace(/\s+/gu, ' ').trim()
  assert.equal(normalize(SCOPE_UPGRADE_SCHEMA), normalize(readFileSync(new URL('../../../infra/d1/pipeline/migrations/0021_maintenance_scope_upgrades.sql', import.meta.url), 'utf8')))
})

test('quota-time upload survives local shutdown and existing cloud tick finishes targets and original controls', async () => {
  const f = await fixture(), upgrade = { ...f.upgrade, recordTargets: [] }, text = canonicalJson(upgrade), hash = await digest(text)
  const database = f.env.PIPELINE_DB
  let databaseCalls = 0
  f.env.PIPELINE_DB = { prepare() { databaseCalls++; throw new Error('D1 daily read quota exceeded') },
    async batch() { databaseCalls++; throw new Error('D1 daily read quota exceeded') } }
  const request = new Request('https://service.example/scope-upgrades', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(text).length), 'x-maintenance-upgrade-sha256': hash }, body: text })
  assert.equal((await registerScopeUpgradeRequest(f.env, request)).pending, true)
  assert.equal(databaseCalls, 0)
  assert.equal(await resumePendingScopeUpgrade(f.env), true)
  await assert.rejects(processScopeUpgrade(f.env, hash), /quota/u)
  assert.equal((await scopeUpgradeStatus(f.env, hash)).status, 'quota_wait')
  // A new cloud invocation has only the persisted bucket/database/queue state.
  f.env.PIPELINE_DB = database
  let result = await processScopeUpgrade(f.env, hash)
  while (!result.completed) result = await processScopeUpgrade(f.env, hash)
  await processScopeUpgrade(f.env, hash)
  const refresh = f.messages.find(message => message.targetRefreshSha256)
  assert.ok(refresh?.targetRefreshSha256)
  await continueTargetRefresh(f.env, refresh.targetRefreshSha256, false)
  await processScopeUpgrade(f.env, hash)
  assert.equal(await resumePendingScopeUpgrade(f.env), false)
  const cfg = f.db.sqlite.prepare('SELECT enabled,models_enabled,targets_complete,revision FROM maintenance_control').get()
  assert.deepEqual({ ...cfg }, { enabled: 1, models_enabled: 1, targets_complete: 1, revision: 7 })
  f.db.sqlite.close()
})

async function uploadFixture(f: Awaited<ReturnType<typeof fixture>>, upgrade: ScopeUpgrade, supersedes?: string) {
  const text = canonicalJson(upgrade), hash = await digest(text)
  await registerScopeUpgradeRequest(f.env, new Request('https://service.example/scope-upgrades', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(text).length),
      'x-maintenance-upgrade-sha256': hash, 'x-maintenance-expected-revision': String(upgrade.expectedRevision),
      'x-maintenance-previous-scope-sha256': upgrade.previousScope.sha256, 'x-maintenance-input-catalog-sha256': upgrade.inputCatalogSha256,
      ...(supersedes ? { 'x-maintenance-supersedes-sha256': supersedes } : {}) }, body: text }))
  return hash
}

test('only a proven automatic revision chain may supersede an entirely unstaged intent; immutable old bytes survive', async () => {
  const f = await fixture(), oldHash = await uploadFixture(f, f.upgrade), nextHead = 'e'.repeat(64)
  f.db.sqlite.prepare('UPDATE maintenance_control SET revision=5,input_catalog_sha256=?').run(nextHead)
  f.db.sqlite.prepare("INSERT INTO maintenance_events VALUES('ack','control_revision_advanced','2026-11-11',?)").run(canonicalJson({ fromRevision: 3, toRevision: 4, previousInputCatalogSha256: TEST_CATALOG, inputCatalogSha256: nextHead }))
  f.db.sqlite.prepare("INSERT INTO maintenance_events VALUES('targets','targets_refreshed','2026-11-11',?)").run(canonicalJson({ fromRevision: 4, toRevision: 5, inputCatalogSha256: nextHead }))
  assert.equal((await scopeUpgradeStatus(f.env, oldHash)).canSupersede, true)
  const newHash = await uploadFixture(f, { ...f.upgrade, expectedRevision: 5, inputCatalogSha256: nextHead }, oldHash)
  assert.ok(await f.bucket.get(`maintenance/scope-upgrades/uploads/${oldHash}.json`))
  assert.ok(await f.bucket.get(`maintenance/scope-upgrades/superseded/${oldHash}/${newHash}.json`))
  await assert.rejects(processScopeUpgrade(f.env, oldHash), /superseded_intent/u)
  assert.equal((await processScopeUpgrade(f.env, newHash)).completed, true)
  f.db.sqlite.close()
})

test('manual revisions or any staged SQL plan cannot be superseded automatically', async () => {
  const f = await fixture(), oldHash = await uploadFixture(f, f.upgrade)
  f.db.sqlite.prepare('UPDATE maintenance_control SET revision=4,enabled=0,models_enabled=0').run()
  assert.equal((await scopeUpgradeStatus(f.env, oldHash)).canSupersede, false)
  await assert.rejects(uploadFixture(f, { ...f.upgrade, expectedRevision: 4 }, oldHash), /supersede_not_proven/u)
  const pointer = await f.bucket.get('maintenance/scope-upgrades/pending.json')
  assert.equal(JSON.parse(await pointer!.text()).upgradeSha256, oldHash)
  f.db.sqlite.close()
})

test('only the exact absent upgrade table is a missing lineage; quota and other SQL failures propagate', async () => {
  const f = await fixture()
  f.db.sqlite.exec('DROP TABLE maintenance_scope_upgrades')
  assert.equal(await scopeUpgradeLineage(f.env, f.upgrade.previousScope.sha256, f.upgrade.nextScope.sha256), false)
  f.env.PIPELINE_DB = { prepare() { throw new Error('D1 daily read quota exceeded') }, async batch() { return [] } }
  await assert.rejects(scopeUpgradeLineage(f.env, f.upgrade.previousScope.sha256, f.upgrade.nextScope.sha256), /quota/u)
  f.db.sqlite.close()
})
