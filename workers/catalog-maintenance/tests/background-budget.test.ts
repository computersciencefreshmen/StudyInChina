import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  BUDGET_POLICY_KEY,BUDGET_OBSERVATION_KEY,BACKGROUND_BUDGET_RETRY_SECONDS,budgetCanonicalJson,budgetPolicySha256,
  validateBudgetPolicy,parseBudgetObservation,readBackgroundBudgetGate,type BudgetPolicy,type BudgetObservation,type BudgetStateBucket,
} from '../../shared/background-budget'
import ingestion from '../../ingestion/src/index'
import localization from '../../localization/src/index'
import publisher from '../../publisher/src/index'
import materializer from '../../entity-materializer/src/index'
import releaseBuilder from '../../release-builder/src/index'
import type { IngestionEnv } from '../../ingestion/src/types'
import type { LocalizationEnv,TranslationQueueBatch } from '../../localization/src/types'
import type { PublisherEnv } from '../../publisher/src/types'
import type { EntityMaterializerEnv } from '../../entity-materializer/src/index'
import type { ReleaseBuilderEnv } from '../../release-builder/src/types'
import { SqliteD1 } from '../../entity-materializer/tests/sqlite-fixture'

const NOW=Date.parse('2026-11-13T08:00:00.000Z')
const accountId='1234567890abcdef1234567890abcdef'
class BudgetBucket implements BudgetStateBucket {
  readonly objects=new Map<string,string>()
  readonly reads:string[]=[]
  async get(key:string){
    this.reads.push(key)
    const text=this.objects.get(key)
    return text===undefined?null:{size:Buffer.byteLength(text),async text(){return text}}
  }
}
async function fixture(patch:Partial<BudgetObservation>={}) {
  const body:Omit<BudgetPolicy,'sha256'>={format:'studyinchina.cloudflare-budget-policy',version:1,accountId,
    baseMicroDollars:5000000,totalMicroDollars:10000000,pauseAtMicroDollars:9000000,maxAgeSeconds:7200}
  const policy:BudgetPolicy={...body,sha256:await budgetPolicySha256(body)}
  const observation:BudgetObservation={format:'studyinchina.cloudflare-budget-observation',version:1,policySha256:policy.sha256,
    state:'ready',observedAt:new Date(NOW).toISOString(),periodStart:'2026-11-01',periodEnd:null,
    usageMicroDollars:1000000,totalMicroDollars:6000000,code:'observed_below_threshold',...patch}
  const bucket=new BudgetBucket()
  bucket.objects.set(BUDGET_POLICY_KEY,JSON.stringify(policy));bucket.objects.set(BUDGET_OBSERVATION_KEY,JSON.stringify(observation))
  return{bucket,policy,observation}
}
test('only a missing policy or absent optional binding allows the unconfigured legacy path',async()=>{
  assert.deepEqual(await readBackgroundBudgetGate(undefined,NOW),{allowed:true,state:'unconfigured',code:'budget_unconfigured',policySha256:null})
  const bucket=new BudgetBucket()
  assert.equal((await readBackgroundBudgetGate(bucket,NOW)).allowed,true)
  assert.deepEqual(bucket.reads,[BUDGET_POLICY_KEY])
  for(const text of ['null','[]','{}','not json']){
    bucket.objects.set(BUDGET_POLICY_KEY,text)
    assert.equal((await readBackgroundBudgetGate(bucket,NOW)).allowed,false,text)
  }
})
test('policy SHA excludes its hash and uses canonical bytes compatible with the independent Node digest',async()=>{
  const {policy}=await fixture(),{sha256,...body}=policy
  const sorted=Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))
  assert.equal(sha256,createHash('sha256').update(JSON.stringify(sorted)).digest('hex'))
  assert.equal(await budgetPolicySha256(policy),sha256)
  assert.deepEqual(await validateBudgetPolicy(policy),policy)
  for(const patch of [{accountId:'bad'},{baseMicroDollars:0},{totalMicroDollars:11000000},{pauseAtMicroDollars:10000000},
    {maxAgeSeconds:7201},{version:2},{sha256:'f'.repeat(64)},{operatorEnabled:true}]){
    const content={...body,...patch}
    const candidate='sha256'in patch?{...policy,...patch}:
      {...content,sha256:createHash('sha256').update(budgetCanonicalJson(content)).digest('hex')}
    await assert.rejects(validateBudgetPolicy(candidate),/budget_policy_invalid/u)
  }
  assert.throws(()=>budgetCanonicalJson({unsupported:undefined}),/budget_canonical_value_invalid/u)
})
test('fresh ready data requires a confirmed billing period and base plus usage below the pause threshold',async()=>{
  for(const [usage,total,allowed]of [[0,5000000,true],[3999999,8999999,true],[4000000,9000000,false],[5000000,10000000,false]] as const){
    const f=await fixture({usageMicroDollars:usage,totalMicroDollars:total})
    assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,allowed)
  }
  for(const patch of [{periodStart:null},{periodStart:'2026-11-14'},{usageMicroDollars:null},{totalMicroDollars:null},
    {usageMicroDollars:1000000,totalMicroDollars:5000000},{policySha256:'f'.repeat(64)}]){
    const f=await fixture(patch)
    assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,false,JSON.stringify(patch))
  }
})
test('missing, malformed, unknown, future and stale observations fail closed with no state writes',async()=>{
  for(const patch of [{state:'unknown' as const,usageMicroDollars:null,totalMicroDollars:null},
    {observedAt:new Date(NOW+1).toISOString()},{observedAt:new Date(NOW-7200001).toISOString()}]){
    const f=await fixture(patch),before=[...f.bucket.objects]
    const result=await readBackgroundBudgetGate(f.bucket,NOW)
    assert.equal(result.allowed,false);assert.equal(result.state,'unknown')
    assert.deepEqual([...f.bucket.objects],before)
  }
  const f=await fixture({observedAt:new Date(NOW-7200000).toISOString()})
  assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,true,'the exact freshness boundary is valid')
  for(const text of [null,'null','{}','not json',JSON.stringify({...f.observation,observedAt:'2026-02-30T12:00:00.000Z'}),
    JSON.stringify({...f.observation,usageMicroDollars:-1}),JSON.stringify({...f.observation,usageMicroDollars:1.5}),
    JSON.stringify({...f.observation,periodEnd:'2026-12-01'}),JSON.stringify({...f.observation,code:'private bill $123'})]){
    if(text===null)f.bucket.objects.delete(BUDGET_OBSERVATION_KEY);else f.bucket.objects.set(BUDGET_OBSERVATION_KEY,text)
    assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,false)
  }
})
test('a paused observation remains stored and cannot be resumed by the read-only gate',async()=>{
  const f=await fixture({state:'paused',usageMicroDollars:0,totalMicroDollars:5000000}),before=[...f.bucket.objects]
  assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).state,'paused')
  assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,false)
  assert.equal((await readBackgroundBudgetGate(f.bucket,NOW+7200001)).allowed,false)
  assert.deepEqual([...f.bucket.objects],before)
  assert.equal(parseBudgetObservation(JSON.parse(f.bucket.objects.get(BUDGET_OBSERVATION_KEY)!)).state,'paused')
})
test('storage failures and oversized policy/observation bodies cannot enable work or leak billing details',async()=>{
  assert.equal((await readBackgroundBudgetGate({async get(){throw new Error(`private account ${accountId}`)}},NOW)).allowed,false)
  const f=await fixture({usageMicroDollars:3765432,totalMicroDollars:8765432,code:`private_${accountId}`})
  const safe=await readBackgroundBudgetGate(f.bucket,NOW)
  assert.deepEqual(Object.keys(safe).sort(),['allowed','code','policySha256','state'])
  assert.doesNotMatch(JSON.stringify(safe),new RegExp(`${accountId}|3765432|8765432|private_`))
  for(const key of [BUDGET_POLICY_KEY,BUDGET_OBSERVATION_KEY]){
    const bucket:BudgetStateBucket={async get(requested){
      if(requested===key)return{size:4097,async text(){throw new Error('oversized body must not be read')}}
      return f.bucket.get(requested)
    }}
    assert.equal((await readBackgroundBudgetGate(bucket,NOW)).allowed,false)
  }
  f.bucket.objects.set(BUDGET_OBSERVATION_KEY,'汉'.repeat(2000))
  assert.equal((await readBackgroundBudgetGate(f.bucket,NOW)).allowed,false,'limit counts UTF-8 bytes too')
})

function blockedEnvironment(bucket:BudgetStateBucket) {
  let dbCalls=0,sends=0
  const database={prepare(){dbCalls++;throw new Error('unexpected database before budget gate')},async batch(){dbCalls++;throw new Error('unexpected database batch')}}
  const producer={async send(){sends++;throw new Error('unexpected job dispatch while budget blocked')}}
  const environment={BUDGET_STATE_BUCKET:bucket,PIPELINE_DB:database,INGESTION_DB:database,CATALOG_DB:database,
    INGESTION_QUEUE:producer,INGESTION_DLQ:producer,QUARANTINE_QUEUE:producer,PROMOTION_QUEUE:producer,PUBLISHER_DLQ:producer,
    RELEASE_QUEUE:producer,RELEASE_BUILDER_DLQ:producer,LOCALIZATION_QUEUE:producer,TRANSLATION_ENABLED:'true',
    MINIMAX_MODEL:'MiniMax-M2.7',INGESTION_ADMIN_TOKEN:'test-only-budget-admin',LOCALIZATION_ADMIN_TOKEN:'test-only-budget-admin'}
  return{environment,dbCalls:()=>dbCalls,sends:()=>sends}
}
const controller={scheduledTime:NOW,cron:'*/15 * * * *'}
test('all five cron gates run before heartbeat, schema indexing or business queries',async context=>{
  context.mock.timers.enable({apis:['Date'],now:NOW})
  for(const worker of ['ingestion','localization','publisher','materializer','release'] as const){
    const {bucket}=await fixture({state:'paused'}),f=blockedEnvironment(bucket)
    if(worker==='ingestion')await ingestion.scheduled(controller,f.environment as unknown as IngestionEnv)
    if(worker==='localization')await localization.scheduled(controller,f.environment as unknown as LocalizationEnv)
    if(worker==='publisher')await publisher.scheduled(controller,f.environment as unknown as PublisherEnv)
    if(worker==='materializer')await materializer.scheduled(controller,f.environment as unknown as EntityMaterializerEnv)
    if(worker==='release')await releaseBuilder.scheduled(controller,f.environment as unknown as ReleaseBuilderEnv)
    assert.equal(f.dbCalls(),0,worker);assert.equal(f.sends(),0,worker)
    assert.equal(bucket.reads.length,2,worker)
  }
})
test('all four queue gates defer every message for one hour without ack, failure, lease or provider work',async context=>{
  context.mock.timers.enable({apis:['Date'],now:NOW})
  for(const worker of ['ingestion','localization','publisher','release'] as const){
    const {bucket}=await fixture({state:'paused'}),f=blockedEnvironment(bucket),delays:number[]=[]
    let acknowledged=0
    const batch={queue:'existing-queue',messages:[0,1].map(id=>({id:`held-${id}`,body:{unknownReservation:true},attempts:99,
      ack(){acknowledged++},retry(options?:{delaySeconds?:number}){delays.push(options?.delaySeconds??0)}}))}
    const before=JSON.stringify(batch.messages.map(message=>message.body))
    if(worker==='ingestion')await ingestion.queue(batch,f.environment as unknown as IngestionEnv)
    if(worker==='localization')await localization.queue(batch,f.environment as unknown as LocalizationEnv)
    if(worker==='publisher')await publisher.queue(batch,f.environment as unknown as PublisherEnv)
    if(worker==='release')await releaseBuilder.queue(batch,f.environment as unknown as ReleaseBuilderEnv)
    assert.deepEqual(delays,[BACKGROUND_BUDGET_RETRY_SECONDS,BACKGROUND_BUDGET_RETRY_SECONDS],worker)
    assert.equal(acknowledged,0,worker);assert.equal(f.dbCalls(),0,worker);assert.equal(f.sends(),0,worker)
    assert.equal(JSON.stringify(batch.messages.map(message=>message.body)),before)
    assert.equal(bucket.reads.length,2,'one shared gate read per batch, not per message')
  }
})
test('authenticated job creation and dry-run planning are blocked while authentication and public health remain independent',async context=>{
  context.mock.timers.enable({apis:['Date'],now:NOW})
  for(const worker of ['ingestion','localization'] as const){
    const {bucket}=await fixture({state:'paused'}),f=blockedEnvironment(bucket)
    const fetcher=(request:Request)=>worker==='ingestion'?ingestion.fetch(request,f.environment as unknown as IngestionEnv):localization.fetch(request,f.environment as unknown as LocalizationEnv)
    const url=worker==='ingestion'?'https://worker.test/enqueue':'https://worker.test/v1/batches'
    const body=worker==='ingestion'?{sourceId:'official-school'}:{dryRun:true,targetLocales:['en'],recordKinds:['program']}
    assert.equal((await fetcher(new Request(url,{method:'POST',body:JSON.stringify(body)}))).status,403)
    assert.equal(bucket.reads.length,0)
    const blocked=await fetcher(new Request(url,{method:'POST',headers:{authorization:'Bearer test-only-budget-admin','content-type':'application/json'},body:JSON.stringify(body)}))
    assert.equal(blocked.status,503);assert.equal(blocked.headers.get('retry-after'),'3600')
    assert.equal((await blocked.json() as {error:string}).error,'background_budget_blocked')
    assert.equal(f.dbCalls(),0);assert.equal(f.sends(),0)
    bucket.reads.length=0
    assert.equal((await fetcher(new Request('https://worker.test/health'))).status,200)
    assert.equal(bucket.reads.length,0)
  }
  assert.equal(publisher.fetch(new Request('https://worker.test/health')).status,200)
  assert.equal(materializer.fetch(new Request('https://worker.test/health')).status,200)
  assert.equal(releaseBuilder.fetch(new Request('https://worker.test/health')).status,200)
})
test('release readiness and localization GET summaries retain their original read-only paths while paused',async context=>{
  context.mock.timers.enable({apis:['Date'],now:NOW})
  const {bucket}=await fixture({state:'paused'})
  let reads=0
  const db={prepare(){reads++;return{bind(){return this},async first(){return null},async all(){return{success:true,results:[]}}}}}
  const ready=await releaseBuilder.fetch(new Request('https://worker.test/ready'),{CATALOG_DB:db,BUDGET_STATE_BUCKET:bucket} as unknown as ReleaseBuilderEnv)
  assert.equal(ready.status,503,'a missing release stays unready rather than becoming budget-blocked')
  const summary=await localization.fetch(new Request(`https://worker.test/v1/batches/${'a'.repeat(64)}`,{headers:{authorization:'Bearer test-only-budget-admin'}}),
    {PIPELINE_DB:db,BUDGET_STATE_BUCKET:bucket,LOCALIZATION_ADMIN_TOKEN:'test-only-budget-admin'} as unknown as LocalizationEnv)
  assert.equal(summary.status,404)
  assert.ok(reads>0);assert.equal(bucket.reads.length,0)
})

test('localization can rediscover a never-started queued job after budget recovery without resetting attempts or starting a model',async context=>{
  context.mock.timers.enable({apis:['Date'],now:NOW})
  const sqlite=new DatabaseSync(':memory:'),db=new SqliteD1(sqlite),f=await fixture(),messages:TranslationQueueBatch[]=[]
  try{
    sqlite.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,public_id TEXT,kind TEXT,workflow_status TEXT);
      CREATE TABLE localized_content(record_id TEXT,locale TEXT,field_name TEXT,text_value TEXT,translation_status TEXT,source_locale TEXT,updated_at TEXT);
      CREATE TABLE programs(record_id TEXT,institution_id TEXT);CREATE TABLE scholarships(record_id TEXT,provider_organization_id TEXT);
      CREATE TABLE organizations(record_id TEXT);`)
    sqlite.exec(readFileSync('infra/d1/pipeline/migrations/0012_localization_pipeline.sql','utf8'))
    sqlite.exec("INSERT INTO records VALUES('program','public-program','program','published'); INSERT INTO programs VALUES('program',NULL);")
    sqlite.prepare("INSERT INTO localized_content VALUES('program','zh','name','计算机科学','reviewed','zh',?)").run(new Date(NOW).toISOString())
    const env:LocalizationEnv={PIPELINE_DB:db,BUDGET_STATE_BUCKET:f.bucket,LOCALIZATION_QUEUE:{async send(body){messages.push(body)}},
      TRANSLATION_ENABLED:'true',TRANSLATION_DEFAULT_TARGETS:'en',MINIMAX_MODEL:'MiniMax-M2.7'}
    await localization.scheduled(controller,env)
    assert.equal(messages.length,1)
    const first=sqlite.prepare('SELECT id,batch_id,status,attempts FROM translation_jobs').get()!
    f.bucket.objects.set(BUDGET_OBSERVATION_KEY,JSON.stringify({...f.observation,state:'paused'}))
    const retried:number[]=[]
    await localization.queue({queue:'existing-localization',messages:[{id:'paused-message',body:messages[0],attempts:4,
      ack(){assert.fail('paused work is not complete')},retry(options){retried.push(options?.delaySeconds??0)}}]},env)
    assert.deepEqual(retried,[3600]);assert.deepEqual(sqlite.prepare('SELECT id,batch_id,status,attempts FROM translation_jobs').get(),first)
    await localization.scheduled(controller,env);assert.equal(messages.length,1)
    f.bucket.objects.set(BUDGET_OBSERVATION_KEY,JSON.stringify(f.observation))
    await localization.scheduled(controller,env)
    assert.equal(messages.length,2)
    const after=sqlite.prepare('SELECT id,batch_id,status,attempts FROM translation_jobs').get()!
    assert.equal(after.id,first.id);assert.equal(after.status,'queued');assert.equal(after.attempts,0)
    assert.notEqual(after.batch_id,first.batch_id,'the existing scheduler places the same durable job in a new batch')
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM translation_jobs').get()?.n,1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM translation_cache').get()?.n,0,'planning does not contact a model')
  }finally{sqlite.close()}
})
