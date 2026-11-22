import assert from 'node:assert/strict'
import test from 'node:test'
import { readIdentityAcceptances } from '../../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../../src/lib/data/field-verification-store'
import { directoryRevision } from '../../../src/lib/catalog/directory-revision'
import { readMaintenanceScope } from '../../../scripts/maintenance/scope-registry'
import { loadMaintenanceBundle } from '../../../scripts/maintenance/build-scope'
import { buildProgramCoverage } from '../../../scripts/maintenance/program-coverage'
import { refreshPublishedCoverage } from '../../../scripts/maintenance/refresh-published-coverage'
import { maintenanceClientFromEnvironment } from '../../../scripts/automation/catalog-maintenance-client'
import { observeCoverageRelease, readSchedulingCoverage, registerPublicCoverage, type PublicCoverageRelease } from '../src/public-coverage'
import { makeEnv, TEST_CATALOG } from './fixture'

test('the live release attests every school row while the native maintenance ledger remains pinned', async () => {
  const root = process.cwd(), scope = readMaintenanceScope(root), day = '2026-11-18', now = Date.parse(day+'T03:00:00Z')
  const { env, db, bucket } = makeEnv(), bundle = loadMaintenanceBundle(root)
  const identities = readIdentityAcceptances(undefined,{strictProjection:true}), fields = readFieldVerifications()
  const snapshot = await buildProgramCoverage(bundle,scope,day,identities,fields)
  const release: PublicCoverageRelease = { deploymentSha:'1'.repeat(40), directoryRevision:directoryRevision(bundle,day,identities,fields),
    evaluatedForDate:day,catalogBackend:'json',coverage:{sha256:snapshot.sha256,scopeRegistrySha256:scope.sha256,inputCatalogSha256:snapshot.inputCatalogSha256} }
  let live = release
  const fetcher: typeof fetch = async (url,opts) => {
    assert.equal(String(url),'https://studyinchina.vercel.app/api/v1/releases/current?view=school-coverage')
    assert.equal(opts?.redirect,'manual'); assert.equal(opts?.headers,undefined)
    return Response.json({data:live})
  }
  env.SCOPE_REGISTRY_SHA256 = scope.sha256
  db.sqlite.prepare('INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,enabled,models_enabled,seed_complete,targets_complete,updated_at) VALUES(1,?,?,?, ?,1,0,1,1,?)')
    .run(scope.sha256,TEST_CATALOG,'b'.repeat(64),'c'.repeat(64),day)
  const add = db.sqlite.prepare('INSERT INTO maintenance_schools(university_id,name_json,seed_json,scope_sha256) VALUES(?, ?, ?, ?)')
  for (const school of scope.schools) add.run(school.universityId,'{}','[]',scope.sha256)
  const originalControl = db.sqlite.prepare('SELECT * FROM maintenance_control').get()
  const client = maintenanceClientFromEnvironment({CATALOG_MAINTENANCE_URL:'https://coverage-fixture.example.workers.dev',
    CATALOG_MAINTENANCE_TOKEN:'fixture-credential-00000000000000000000000'},async (url,init) => {
    assert.equal(new URL(String(url)).pathname,'/coverage/published'); assert.equal(init?.method,'POST')
    return Response.json(await registerPublicCoverage(env,JSON.parse(String(init?.body)),now,fetcher))
  })
  try {
    const options = {root,commit:release.deploymentSha,client,today:day,fetcher}
    assert.equal((await refreshPublishedCoverage({...options,commit:'f'.repeat(40)})).reason,'deployment_wait')
    const first = await refreshPublishedCoverage(options), second = await refreshPublishedCoverage(options)
    assert.ok(first.refreshed && second.refreshed)
    assert.equal(first.reused,false)
    assert.equal(second.reused,true)
    assert.equal(bucket.objects.size,2)
    assert.deepEqual(await readSchedulingCoverage(env,TEST_CATALOG,scope.sha256,now,fetcher,release.deploymentSha),snapshot)
    assert.equal(await readSchedulingCoverage(env,TEST_CATALOG,scope.sha256,now,fetcher,'f'.repeat(40)),null)
    await assert.rejects(registerPublicCoverage(env,{release,coverage:{...snapshot,inputCatalogSha256:TEST_CATALOG}},now,fetcher),/public_coverage_release_changed/)
    assert.equal(await readSchedulingCoverage(env,TEST_CATALOG,scope.sha256,now+86400000,fetcher),null)
    live={...release,deploymentSha:'2'.repeat(40)}
    assert.equal(await readSchedulingCoverage(env,TEST_CATALOG,scope.sha256,now,fetcher),null)
    await assert.rejects(registerPublicCoverage(env,{release,coverage:snapshot},now,fetcher),/public_coverage_release_changed/)
    live={...release,coverage:{...release.coverage!,sha256:'0'.repeat(64)}}
    await assert.rejects(refreshPublishedCoverage(options),/public_coverage_projection_hash_mismatch/)
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM maintenance_control').get(),originalControl)
    assert.equal(db.sqlite.prepare('SELECT count(*) total FROM maintenance_events').get()?.total,0)
  } finally { db.sqlite.close() }
})

test('rejects redirects without asking the Workers fetch implementation to use its unsupported error mode', async () => {
  await assert.rejects(observeCoverageRelease(async (_url, options) => {
    assert.equal(options?.redirect, 'manual')
    return Response.redirect('https://other.example/releases/current')
  }), /public_coverage_release_unavailable/)
})
