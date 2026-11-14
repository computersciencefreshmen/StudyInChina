import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as WorkerResponse } from 'miniflare'
import { universitySchema } from '../../../src/lib/data/schema'
import { identityFingerprint } from '../../../src/lib/data/identity-acceptance'
import { candidateCommit, sourceCandidateFixture } from './source-candidates-fixture'

// Read the real deployment settings. In particular, do not add nodejs_compat to
// make the test pass: the published compatibility date must provide the module.
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')) as {compatibility_date:string;compatibility_flags?:string[]}
const bundledRuntimeDate=(createRequire(import.meta.url)('workerd') as {compatibilityDate:string}).compatibilityDate
test('workerd uses real directory identity hashing and commits only bounded capture candidates in native D1/R2',{timeout:30000},async context=>{
  const compatibilityDate=process.env.MINIFLARE_WORKERD_PATH?config.compatibility_date:[config.compatibility_date,bundledRuntimeDate].sort()[0]
  context.diagnostic(`production date=${config.compatibility_date}; tested runtime date=${compatibilityDate}; flags=${JSON.stringify(config.compatibility_flags??[])}`)
  const f=await sourceCandidateFixture(),university=universitySchema.parse((f.files['universities.json']as unknown[])[0])
  university.reviewAfter='2025-11-14';university.verifiedAt='2025-01-01'
  ;(f.files['universities.json']as unknown[])[0]=university
  // A stale identity requires actual createHash inside selectDiscoveryData.
  f.files['identity-acceptances.json']={schemaVersion:1,entries:[{entityType:'university',recordId:university.id,identitySha256:identityFingerprint('university',university),sourceIds:university.sourceIds,acceptedAt:'2026-11-14T00:00:00Z',reviewer:'local-reviewed-fixture',receiptPath:'fixtures/identity.json',receiptSha256:'a'.repeat(64)}]}
  const bundled=await build({stdin:{contents:`
    import { handleFetch } from './index'
    let queueCalls=0,modelCalls=0
    export default {async fetch(request,env){
      if(new URL(request.url).pathname==='/test-counts')return Response.json({queueCalls,modelCalls})
      const db={prepare:sql=>env.PIPELINE_DB.prepare(sql),async batch(statements){
        if(request.headers.has('x-test-late-pause'))await env.PIPELINE_DB.prepare('UPDATE maintenance_control SET enabled=0').run()
        return env.PIPELINE_DB.batch(statements)
      }}
      return handleFetch(request,{...env,PIPELINE_DB:db,MAINTENANCE_QUEUE:{async send(){queueCalls++;throw Error('queue_forbidden')}},MODEL_ADMISSION:{idFromName(){modelCalls++;throw Error('model_forbidden')}}})
    }}
  `,sourcefile:'source-candidates-native-entry.ts',resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'browser',external:['node:crypto'],target:'es2022',write:false})
  const requests:Array<{url:string;headers:string[]}>=[]
  const mf=new Miniflare(convertV4MiniflareOptions({name:'source-candidates-native',modules:true,script:bundled.outputFiles[0].text,compatibilityDate,compatibilityFlags:config.compatibility_flags??[],host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},bindings:{MAINTENANCE_ADMIN_TOKEN:'native-candidate-test-only',MAINTENANCE_ENABLED:'true',SCOPE_REGISTRY_SHA256:f.env.SCOPE_REGISTRY_SHA256!,SCOPE_SCHOOL_COUNT:'295'},d1Databases:{PIPELINE_DB:'source-candidates-local'},r2Buckets:{SNAPSHOTS_BUCKET:'source-candidates-local'},outboundService:async request=>{
    const url=new URL(request.url);requests.push({url:request.url,headers:[...request.headers.keys()]})
    assert.equal(url.origin,'https://raw.githubusercontent.com');assert.equal(url.pathname.startsWith(`/computersciencefreshmen/StudyInChina/${candidateCommit}/content/data/`),true)
    assert.equal(request.headers.has('authorization'),false);assert.equal(request.headers.has('x-api-key'),false)
    const name=url.pathname.split('/').at(-1)!;assert.ok(Object.hasOwn(f.files,name))
    return new WorkerResponse(JSON.stringify(f.files[name]),{headers:{'content-type':'application/json'}})
  }}))
  try{
    await mf.ready
    const db=await mf.getD1Database('PIPELINE_DB')
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
    for(const table of ['maintenance_schools','maintenance_sources','maintenance_source_schools','maintenance_control','maintenance_exports','maintenance_events']){
      const statements=f.db.sqlite.prepare(`SELECT * FROM ${table}`).all().map(row=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)))
      if(statements.length)await db.batch(statements)
    }
    const headers={authorization:'Bearer native-candidate-test-only','content-type':'application/json'},input=f.request()
    const response=await mf.dispatchFetch('https://worker/source-candidates',{method:'POST',headers,body:JSON.stringify(input)})
    const result=await response.json()as {registered?:boolean;error?:string;entries:Array<{sourceId:string;captureJobId:string}>}
    assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.registered,true);assert.equal(requests.length,4)
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM maintenance_jobs WHERE stage='capture' AND status='queued'").first('n'),1)
    for(const table of ['maintenance_model_attempts','maintenance_record_targets','maintenance_target_sources'])assert.equal(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first('n'),0)
    assert.equal(await db.prepare('SELECT revision FROM maintenance_control').first('revision'),1)
    // Replay is a proven no-op even if the immutable authority is now cached.
    assert.equal((await mf.dispatchFetch('https://worker/source-candidates',{method:'POST',headers,body:JSON.stringify(input)})).status,200)
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_jobs').first('n'),1);assert.equal(requests.length,4)
    const raced={...input,operationId:'candidate-native-race',urls:Array.from({length:5},(_,i)=>({url:`https://www.cup.edu.cn/${i}.pdf`,categories:['current_guide']}))}
    const late=await mf.dispatchFetch('https://worker/source-candidates',{method:'POST',headers:{...headers,'x-test-late-pause':'1'},body:JSON.stringify(raced)})
    assert.equal(late.status,409);assert.equal((await late.json()as {error:string}).error,'source_candidate_commit_conflict')
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_jobs').first('n'),1)
    assert.equal(await db.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='official_source_candidates_registered'").first('n'),1)
    assert.equal(await db.prepare('SELECT enabled FROM maintenance_control').first('enabled'),0)
    assert.deepEqual(await mf.dispatchFetch('https://worker/test-counts').then(r=>r.json()),{queueCalls:0,modelCalls:0})
    assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').first('n'),0)
  }finally{await mf.dispose();f.db.sqlite.close()}
})
