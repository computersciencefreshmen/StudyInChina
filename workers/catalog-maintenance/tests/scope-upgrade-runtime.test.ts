import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { canonical, digest } from '../src/util'

test('real workerd unblocks an expired lease behind the scope gate without changing control or replaying model jobs',async()=>{
  const previousScope=JSON.parse(readFileSync('content/maintenance/scope-272.v1.json','utf8'))
  const nextScope=JSON.parse(readFileSync('content/maintenance/scope-295.v2.json','utf8'))
  const now=Date.parse('2026-11-13T04:44:36.480Z'),catalog='b'.repeat(64),guards='c'.repeat(64)
  const upgrade={format:'studyinchina.maintenance-scope-upgrade',version:1,expectedRevision:7,inputCatalogSha256:catalog,
    legacyGuardSha256:guards,previousScope,nextScope,recordTargets:[]}
  const text=canonical(upgrade),hash=await digest(text)
  const bundled=await build({stdin:{contents:`
    import {processScopeUpgrade,scopeUpgradeStatus} from './scope-upgrade'
    export default {async fetch(request,env){return Response.json(new URL(request.url).pathname==='/process'
      ?await processScopeUpgrade(env,'${hash}',${now}):await scopeUpgradeStatus(env,'${hash}'))}}
  `,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false})
  const mf=new Miniflare(convertV4MiniflareOptions({name:'scope-upgrade-lease-recovery-test',modules:true,script:bundled.outputFiles[0].text,
    compatibilityDate:'2026-09-18',host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},
    bindings:{SCOPE_REGISTRY_SHA256:nextScope.sha256,SCOPE_SCHOOL_COUNT:'295',MAINTENANCE_ENABLED:'true',NATIVE_HEAD_RECONCILIATION_REQUIRED:'true'},
    d1Databases:{PIPELINE_DB:'scope-recovery-test'},r2Buckets:{SNAPSHOTS_BUCKET:'scope-recovery-test'},
    outboundService:()=>{throw new Error('Unexpected outbound network in scope recovery test')},
  }))
  try{
    await mf.ready
    const db=await mf.getD1Database('PIPELINE_DB')
    // The V4-to-legacy option bridge loses the bucket proxy's static type.
    const bucket=await mf.getR2Bucket('SNAPSHOTS_BUCKET') as unknown as {put(key:string,value:string):Promise<unknown>}
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql']){
      const sql=readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8')
      for(const statement of sql.replace(/^--.*$/gm,'').split(';').map(row=>row.trim()).filter(Boolean))await db.prepare(statement).run()
    }
    await db.prepare(`INSERT INTO maintenance_control(singleton,scope_sha256,input_catalog_sha256,seed_sha256,legacy_guard_sha256,
      enabled,models_enabled,seed_complete,targets_complete,revision,updated_at) VALUES(1,?,?,?,?,1,1,1,1,8,?)`)
      .bind(previousScope.sha256,catalog,'d'.repeat(64),guards,new Date(now).toISOString()).run()
    await db.batch(previousScope.schools.map((school:{universityId:string})=>db.prepare('INSERT INTO maintenance_schools VALUES(?,?,?,?,NULL)')
      .bind(school.universityId,'{}','{}',previousScope.sha256)))
    await db.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at) VALUES('old','https://example.edu/catalog','[\"example.edu\"]','undergraduate_catalog',1,168,?)")
      .bind(new Date(now).toISOString()).run()
    for(const [id,stage,status,lease]of [['expired-capture','capture','running','2026-11-11T03:00:00Z'],['expired-model','maintain','running','2026-11-11T03:00:00Z'],['prior-unknown','extract','unknown',null]]){
      await db.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,lease_token,lease_until) VALUES(?,'old',?,?,?,?,?,?,?)")
        .bind(id,stage,status,new Date(now).toISOString(),new Date(now).toISOString(),new Date(now).toISOString(),lease?'lease':null,lease).run()
    }
    await db.prepare("INSERT INTO maintenance_events VALUES('same-head','targets_revalidated',?,?)")
      .bind(new Date(now).toISOString(),canonical({fromRevision:7,toRevision:8,inputCatalogSha256:catalog})).run()
    await bucket.put(`maintenance/scope-upgrades/uploads/${hash}.json`,text)
    await bucket.put('maintenance/scope-upgrades/pending.json',canonical({format:'studyinchina.pending-scope-upgrade',version:1,upgradeSha256:hash,
      expectedRevision:7,inputCatalogSha256:catalog,previousScopeSha256:previousScope.sha256,nextScopeSha256:nextScope.sha256}))
    const before=await(await mf.dispatchFetch('https://scope.test/status')).json() as {canSupersede:boolean}
    assert.equal(before.canSupersede,false)
    const controlBefore=await db.prepare('SELECT * FROM maintenance_control').first()
    const result=await(await mf.dispatchFetch('https://scope.test/process')).json() as {state:string}
    assert.equal(result.state,'waiting_for_automatic_head_reconciliation')
    const after=await(await mf.dispatchFetch('https://scope.test/status')).json() as {canSupersede:boolean}
    assert.equal(after.canSupersede,true)
    assert.deepEqual(await db.prepare('SELECT * FROM maintenance_control').first(),controlBefore)
    const jobs=(await db.prepare('SELECT job_id,status,lease_token,lease_until FROM maintenance_jobs ORDER BY job_id').all()).results
    assert.deepEqual(jobs,[{job_id:'expired-capture',status:'retry',lease_token:null,lease_until:null},
      {job_id:'expired-model',status:'unknown',lease_token:null,lease_until:null},{job_id:'prior-unknown',status:'unknown',lease_token:null,lease_until:null}])
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').first())?.n,0)
  }finally{await mf.dispose()}
})
