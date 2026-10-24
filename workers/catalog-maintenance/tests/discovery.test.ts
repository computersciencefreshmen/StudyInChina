import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverSourceLinks,parseDiscoveryFrontier,processDiscoveryFrontier } from '../src/discovery'
import { queueExtraction,recordTargets,seed,source } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

test('the complete frontier retains pagination, unquoted PDF attachments and every excluded link',async()=>{
  const f=makeEnv();await seed(f.env,seedInput());const row=await source(f.env,await digest('https://test.edu.cn/catalog'));assert.ok(row)
  const html='<a href="/next?page=2">下一页</a><a href=/guide.pdf>下载</a>'+Array.from({length:8},(_,i)=>`<a href="/program/${i}">Program ${i}</a>`).join('')+'<a href="https://elsewhere.example/program">Program outside</a><a href="/privacy">Privacy</a><a>No link</a>'
  const frontier=parseDiscoveryFrontier(html,row,new URL(row.url),['test.edu.cn'],'d'.repeat(64));assert.equal(frontier.links.length,10);assert.equal(frontier.links[0].priority,0);assert.equal(frontier.links[1].priority,1);assert.equal(frontier.missed.length,3);assert.ok(frontier.missed.some(link=>link.reason==='outside_approved_https_hosts'));f.db.sqlite.close()
})
test('five-link continuations register all links and preserve parent programme scope for future-cycle discovery',async()=>{
  const f=makeEnv(),id=await digest('https://test.edu.cn/catalog'),raw='d'.repeat(64)
  await seed(f.env,{...seedInput(),recordTargets:[{recordId:'program-parent',entityType:'program',universityId:'uni-000',sourceIds:[id],recordScopeSha256:'e'.repeat(64),identity:{name:{en:'Computer Science'},degreeLevel:'bachelor'},year:null,intake:null,fields:{durationMonths:null},reviewAfter:'2026-10-24'}]})
  f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=? WHERE source_id=?').run(raw,id)
  const parent=await source(f.env,id);assert.ok(parent)
  const html=Array.from({length:12},(_,i)=>`<a href="/program/${i}">Program ${i}</a>`).join('')
  await discoverSourceLinks(f.env,parent,html,new URL(parent.url),['test.edu.cn'],raw)
  let batches=0
  while(f.messages.length){const message=f.messages.shift()!;assert.ok(message.discoveryManifestSha256);await processDiscoveryFrontier(f.env,message.discoveryManifestSha256,message.discoveryOffset??0);batches++}
  assert.equal(batches,3);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_sources').get()?.count,13)
  const childId=await digest('https://test.edu.cn/program/0'),targets=await recordTargets(f.env,childId);assert.equal(targets.length,1);assert.equal(targets[0].recordId,'program-parent');assert.ok(targets[0].sourceIds.includes(childId))
  const child=await source(f.env,childId);assert.ok(child);await queueExtraction(f.env,child,raw,`maintenance/snapshots/${childId}/${raw}.json`)
  // Models remain disabled; candidate scope inheritance itself never verifies facts.
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count,0)
  const notes=f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='discovery_frontier_batch'").all();assert.equal(notes.length,3);assert.ok(notes.every(row=>JSON.parse(String(row.details_json)).catalogueComplete===false));f.db.sqlite.close()
})
test('a depth-limited source still saves its full frontier without calling it complete',async()=>{
  const f=makeEnv();await seed(f.env,seedInput());const row=await source(f.env,await digest('https://test.edu.cn/catalog'));assert.ok(row);row.discovery_depth=2
  await discoverSourceLinks(f.env,row,'<a href="/program/one">Programme one</a>',new URL(row.url),['test.edu.cn'],'d'.repeat(64));assert.equal(f.messages.length,0)
  const event=f.db.sqlite.prepare("SELECT details_json FROM maintenance_events WHERE kind='discovery_frontier'").get();assert.ok(event);const data=JSON.parse(String(event.details_json));assert.equal(data.discovered,1);assert.equal(data.depthLimitReached,true);assert.equal(data.catalogueComplete,false);assert.ok(await f.bucket.get(data.manifestKey));f.db.sqlite.close()
})
