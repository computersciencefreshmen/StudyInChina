import assert from 'node:assert/strict'
import test from 'node:test'
import { registerOfficialSourceCandidates } from '../src/source-candidates'
import { handleFetch } from '../src/index'
import { captureSource } from '../src/capture'
import { claimJob,control,source } from '../src/repository'
import { BUDGET_POLICY_KEY } from '../../shared/background-budget'
import { canonical,digest } from '../src/util'
import { sourceCandidateFixture,candidateNow } from './source-candidates-fixture'

test('current accepted directory + exact approved school host registers only source/capture job and reuses content-hash authority',async()=>{
  const f=await sourceCandidateFixture();try{
    const before=JSON.stringify(await control(f.env)),result=await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow)
    assert.equal(result.registered,true);assert.equal(result.entries[0].disposition,'created');assert.equal(f.calls.length,4);assert.equal(f.messages.length,0)
    for(const call of f.calls){assert.equal(call.options?.redirect,'manual');assert.equal(new Headers(call.options?.headers).has('authorization'),false);assert.deepEqual([...new Headers(call.options?.headers).keys()],['accept'])}
    const rows=f.db.sqlite.prepare('SELECT * FROM maintenance_jobs').all();assert.equal(rows.length,1);assert.equal(rows[0].stage,'capture');assert.equal(rows[0].status,'queued')
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_record_targets').get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_target_sources').get()?.n,0)
    assert.equal(JSON.stringify(await control(f.env)),before)
    const next=f.request('second');next.urls[0].url='https://www.cup.edu.cn/overseas/2027/second.pdf'
    await registerOfficialSourceCandidates(f.env,next,f.fetcher,candidateNow);assert.equal(f.calls.length,4)
    assert.equal((await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow)).reused,true);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,2)
  }finally{f.db.sqlite.close()}
})

test('existing URL is a strict no-op for source, school associations, unknown attempts and old jobs',async()=>{
  const f=await sourceCandidateFixture();try{
    const input=f.request();input.urls[0].url='https://www.cup.edu.cn/old-guide.pdf'
    const id=await digest(input.urls[0].url)
    f.db.sqlite.prepare("INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at,failures,error_code) VALUES(?,?,'[\"www.cup.edu.cn\"]','current_guide','[\"current_guide\"]',0,168,'2027-01-01T00:00:00Z',7,'old_failure')").run(id,input.urls[0].url)
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(id,'uni-000')
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at,error_code) VALUES('old-job',?,'extract','unknown',?,?,?,'old_unknown')").run(id,new Date(candidateNow).toISOString(),new Date(candidateNow).toISOString(),new Date(candidateNow).toISOString())
    f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('old-key','old-attempt',?,'snapshot','primary','request','MiniMax-M3','unknown',?,'{}')").run(id,new Date(candidateNow).toISOString())
    const before=JSON.stringify(['maintenance_sources','maintenance_source_schools','maintenance_jobs','maintenance_model_attempts'].map(t=>f.db.sqlite.prepare(`SELECT * FROM ${t}`).all()))
    const result=await registerOfficialSourceCandidates(f.env,input,f.fetcher,candidateNow)
    assert.equal(result.entries[0].disposition,'reused');assert.equal(result.entries[0].captureJobId,null)
    assert.equal(JSON.stringify(['maintenance_sources','maintenance_source_schools','maintenance_jobs','maintenance_model_attempts'].map(t=>f.db.sqlite.prepare(`SELECT * FROM ${t}`).all())),before)
  }finally{f.db.sqlite.close()}
})

test('raw-school rows, shared CSC host, foreign/sibling hosts, unsafe URLs and more than five inputs cannot register',async()=>{
  for(const variant of ['raw-only','shared','foreign','sibling','ip','credentials','six'] as const){const f=await sourceCandidateFixture();try{
    const input=f.request(variant)
    if(variant==='raw-only')(f.files['universities.json'] as Array<{status:string}>)[0].status='draft'
    if(variant==='shared'){(f.files['universities.json'] as Array<{officialUrl:string}>)[0].officialUrl='https://www.csc.edu.cn/';input.urls[0].url='https://www.csc.edu.cn/2027.pdf'}
    if(variant==='foreign')input.urls[0].url='https://other.edu.cn/guide.pdf'
    if(variant==='sibling')input.urls[0].url='https://unreviewed.cup.edu.cn/guide.pdf'
    if(variant==='ip')input.urls[0].url='https://127.0.0.1/guide.pdf'
    if(variant==='credentials')input.urls[0].url+='?token=private'
    if(variant==='six')input.urls=Array.from({length:6},(_,i)=>({...input.urls[0],url:`https://www.cup.edu.cn/${i}.pdf`}))
    await assert.rejects(registerOfficialSourceCandidates(f.env,input,f.fetcher,candidateNow),/source_candidate_/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,0);assert.equal(f.messages.length,0)
  }finally{f.db.sqlite.close()}}
})

test('old/unpublished/wrong catalogue, disabled gate, missing native proof and outside canary hold before candidate insertion',async()=>{
  for(const mode of ['unpublished','catalog','oldscope','disabled','native','canary','budget','source'] as const){const f=await sourceCandidateFixture();try{
    const input=f.request(mode)
    if(mode==='unpublished')f.db.sqlite.exec("UPDATE maintenance_exports SET status='applied'")
    if(mode==='catalog')input.inputCatalogSha256='a'.repeat(64)
    if(mode==='oldscope')f.env.SCOPE_SCHOOL_COUNT='272'
    if(mode==='disabled')f.env.MAINTENANCE_ENABLED='false'
    if(mode==='native')f.env.NATIVE_HEAD_RECONCILIATION_REQUIRED='true'
    if(mode==='canary')input.universityId='uni-010'
    if(mode==='budget')await f.bucket.put(BUDGET_POLICY_KEY,'{}')
    if(mode==='source')f.env.MODEL_STATE_MIGRATION_ROLE='source'
    await assert.rejects(registerOfficialSourceCandidates(f.env,input,f.fetcher,candidateNow))
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,0);assert.equal(f.calls.length,0)
  }finally{f.db.sqlite.close()}}
})

test('redirect/404/malformed/oversized/incomplete authority and corrupted immutable cache fail closed without fetching a submitted URL',async()=>{
  for(const mode of ['redirect','missing','invalid','oversized','incomplete','cache'] as const){const f=await sourceCandidateFixture();try{
    const input=f.request(mode)
    let fetcher=f.fetcher
    if(mode==='redirect')fetcher=async()=>new Response(null,{status:302,headers:{location:'https://credential-recipient.invalid/'}})
    if(mode==='missing')fetcher=async()=>new Response('missing',{status:404})
    if(mode==='invalid')fetcher=async()=>new Response('{malformed')
    if(mode==='oversized')fetcher=async()=>new Response('x'.repeat(2*1024*1024+1))
    if(mode==='incomplete')fetcher=async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('truncated public Git response'))}}))
    if(mode==='cache'){
      await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow)
      const raw=[...f.bucket.objects.keys()].find(k=>k.startsWith('maintenance/source-candidates/git-files/'))!;await f.bucket.put(raw,'changed')
    }
    await assert.rejects(registerOfficialSourceCandidates(f.env,input,fetcher,candidateNow),/source_candidate_/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,mode==='cache'?1:0)
  }finally{f.db.sqlite.close()}}
})

test('all five bounded URLs register atomically; domain ambiguity and altered publication cache never authorize a new candidate',async()=>{
  const healthy=await sourceCandidateFixture();try{
    const input=healthy.request();input.urls=Array.from({length:5},(_,i)=>({url:`https://www.cup.edu.cn/guide-${i}.pdf`,categories:['current_guide','university_scholarship']}))
    const result=await registerOfficialSourceCandidates(healthy.env,input,healthy.fetcher,candidateNow)
    assert.equal(result.entries.length,5);assert.equal(healthy.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,5);assert.equal(healthy.messages.length,0)
    for(const entry of result.entries)assert.equal(healthy.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_source_schools WHERE source_id=?').get(entry.sourceId)?.n,1)
  }finally{healthy.db.sqlite.close()}
  for(const mode of ['ambiguous','cache-binding'] as const){const f=await sourceCandidateFixture();try{
    if(mode==='ambiguous')(f.files['universities.json']as Array<{officialUrl:string}>)[1].officialUrl='https://different.cup.edu.cn/'
    if(mode==='cache-binding'){
      await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow)
      const key=[...f.bucket.objects.keys()].find(k=>k.startsWith('maintenance/source-candidates/directory-cache/'))!,object=await f.bucket.get(key)
      const manifest=JSON.parse(await object!.text());manifest.sourceCommit='a'.repeat(40);await f.bucket.put(key,canonical(manifest))
    }
    const input=f.request(mode);input.urls[0].url='https://www.cup.edu.cn/not-authorized.pdf'
    await assert.rejects(registerOfficialSourceCandidates(f.env,input,f.fetcher,candidateNow),mode==='ambiguous'?/ownership_ambiguous/:/cache_binding_invalid/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,mode==='cache-binding'?1:0)
  }finally{f.db.sqlite.close()}}
})

test('late pause/catalog/school/anchor/publication/history races roll back all candidates and never create a committed event',async()=>{
  for(const mode of ['pause','catalog','school','anchor','publication','history'] as const){const f=await sourceCandidateFixture();try{
    const input=f.request(mode),batch=f.db.batch.bind(f.db);let raced=false
    f.db.batch=async statements=>{if(!raced){raced=true
      if(mode==='pause')f.db.sqlite.exec('UPDATE maintenance_control SET enabled=0')
      if(mode==='catalog')f.db.sqlite.prepare('UPDATE maintenance_control SET input_catalog_sha256=?').run('a'.repeat(64))
      if(mode==='school')f.db.sqlite.prepare('UPDATE maintenance_schools SET seed_json=? WHERE university_id=?').run('{}','uni-000')
      if(mode==='anchor')f.db.sqlite.prepare('UPDATE maintenance_sources SET enabled=0 WHERE url=?').run('https://www.cup.edu.cn/')
      if(mode==='publication')f.db.sqlite.exec("UPDATE maintenance_exports SET status='rejected'")
      if(mode==='history')f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('late','late',?,'raw','primary','request','MiniMax-M3','unknown',?,'{}')").run(await digest(input.urls[0].url),new Date(candidateNow).toISOString())
    }return batch(statements)}
    await assert.rejects(registerOfficialSourceCandidates(f.env,input,f.fetcher,candidateNow),/source_candidate_commit_conflict/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,0);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM maintenance_events WHERE kind='official_source_candidates_registered'").get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').get()?.n,0)
  }finally{f.db.sqlite.close()}}
})

test('lost commit reply is proven by the immutable event; altered idempotency intent never sends again',async()=>{
  const f=await sourceCandidateFixture();try{
    const batch=f.db.batch.bind(f.db);let lost=false;f.db.batch=async<T>(statements:Parameters<typeof f.db.batch>[0])=>{const result=await batch<T>(statements);if(!lost){lost=true;throw Error('lost_reply')}return result}
    const result=await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow);assert.equal(result.registered,true)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,1)
    const changed=f.request();changed.urls[0].url='https://www.cup.edu.cn/different.pdf'
    await assert.rejects(registerOfficialSourceCandidates(f.env,changed,f.fetcher,candidateNow),/registration_conflict/)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,1)
  }finally{f.db.sqlite.close()}
})

test('authenticated API bounds requests and the frozen source refuses the new route before storage',async()=>{
  const f=await sourceCandidateFixture();try{
    const body=JSON.stringify(f.request()),url='https://worker/source-candidates',headers={authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`,'content-type':'application/json'}
    assert.equal((await handleFetch(new Request(url,{method:'POST',body}),f.env)).status,401)
    f.env.MODEL_STATE_MIGRATION_ROLE='source';f.env.PIPELINE_DB={prepare(){throw Error('source_storage_forbidden')},async batch(){throw Error('source_storage_forbidden')}}
    const response=await handleFetch(new Request(url,{method:'POST',headers,body}),f.env)
    assert.equal(response.status,503);assert.equal((await response.json()).error,'account_migration_frozen')
  }finally{f.db.sqlite.close()}
})

test('a registered candidate still obeys ordinary robots and never fetches its PDF when disallowed',async()=>{
  const f=await sourceCandidateFixture();try{
    const result=await registerOfficialSourceCandidates(f.env,f.request(),f.fetcher,candidateNow),entry=result.entries[0],job=await claimJob(f.env,entry.captureJobId!,candidateNow),row=await source(f.env,entry.sourceId)
    assert.ok(job&&row);let officialCalls=0
    const official:typeof fetch=async url=>{officialCalls++;assert.equal(new URL(String(url)).pathname,'/robots.txt');return new Response('User-agent: *\nDisallow: /overseas/',{status:200})}
    await assert.rejects(captureSource(f.env,job,row,official,async()=>{}),/robots_disallowed/);assert.equal(officialCalls,1)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_observations').get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
  }finally{f.db.sqlite.close()}
})
