import assert from 'node:assert/strict'
import test from 'node:test'
import { captureSource,loadSnapshot } from '../src/capture'
import { seed,source } from '../src/repository'
import type { JobRow } from '../src/types'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

test('official JSON and structured JSON MIME bodies retain full text and queue identity plus field work',async()=>{
  for(const contentType of ['application/json; charset=utf-8','application/vnd.university.catalog+json']){
    const f=makeEnv(),sourceId=await digest('https://test.edu.cn/catalog'),body=JSON.stringify({audience:'International students',programs:[{name:'Computer  Science 计算机',degree:'Bachelor',note:'<a href="/not-an-html-link">literal JSON data</a>'}],padding:'x'.repeat(51000)},null,2),rawSha=await digest(body)
    try{
      await seed(f.env,{...seedInput(),recordTargets:[{recordId:'program-one',entityType:'program',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:'d'.repeat(64),identity:{name:{en:'Computer  Science'}},year:null,intake:null,fields:{durationMonths:null},reviewAfter:'2026-10-24'}]})
      const row=await source(f.env,sourceId);assert.ok(row);let accepted=false
      const result=await captureSource(f.env,{job_id:'json-capture',source_id:sourceId}as JobRow,row,async(input,init)=>{if(String(input).endsWith('/robots.txt'))return new Response('',{status:404});accepted=String((init?.headers as Record<string,string>).accept).includes('application/json');return new Response(body,{headers:{'content-type':contentType}})},async()=>{})
      assert.equal(result,'captured');assert.equal(accepted,true)
      const observed=await source(f.env,sourceId),snapshot=await loadSnapshot(f.env,observed!.snapshot_key!)
      assert.equal(snapshot.rawSha256,rawSha);assert.equal(snapshot.textSha256,rawSha);assert.ok(snapshot.textKey)
      assert.equal(await(await f.bucket.get(snapshot.rawKey))!.text(),body);assert.equal(await(await f.bucket.get(snapshot.textKey!))!.text(),body);assert.ok(body.length>50000)
      assert.deepEqual(snapshot.parserCandidates,[]);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_proposals').get()?.count,0)
      const stages=f.db.sqlite.prepare('SELECT stage FROM maintenance_jobs').all().map(value=>value.stage);assert.ok(stages.includes('extract'));assert.ok(stages.includes('maintain'))
      assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM maintenance_events WHERE kind='discovery_frontier'").get()?.count,0)
    }finally{f.db.sqlite.close()}
  }
})
test('unsupported binary bodies retain the explicit rich-document hold and never enter text extraction',async()=>{
  const f=makeEnv(),sourceId=await digest('https://test.edu.cn/catalog')
  try{
    await seed(f.env,seedInput());const row=await source(f.env,sourceId);assert.ok(row)
    const result=await captureSource(f.env,{job_id:'binary-capture',source_id:sourceId}as JobRow,row,async input=>String(input).endsWith('/robots.txt')?new Response('',{status:404}):new Response(new Uint8Array([0,255,19,65]),{headers:{'content-type':'application/octet-stream'}}),async()=>{})
    assert.equal(result,'rich-document');const observed=await source(f.env,sourceId),snapshot=await loadSnapshot(f.env,observed!.snapshot_key!)
    assert.equal(snapshot.textKey,null);assert.equal(snapshot.textSha256,null);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_jobs').get()?.count,0)
    assert.equal(f.db.sqlite.prepare('SELECT outcome FROM maintenance_observations').get()?.outcome,'rich_document_pending')
  }finally{f.db.sqlite.close()}
})
