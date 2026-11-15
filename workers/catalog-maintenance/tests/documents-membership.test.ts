import assert from 'node:assert/strict'
import test from 'node:test'
import { listPendingDocuments } from '../src/documents'
import type { MaintenanceEnv } from '../src/types'
import { documentMembershipFixture } from './documents-membership-fixture'

for(const count of [99,100,225,295,0]as const)test(`${count||'empty'} canary membership stays within two SQL bindings and preserves shared/outside school semantics`,async()=>{
  const f=await documentMembershipFixture(count)
  try{
    let selectionBindings:unknown[]=[],selectionSql=''
    const env={...f.env,PIPELINE_DB:{prepare(sql:string){const statement=f.db.prepare(sql);if(!sql.includes('ORDER BY s.last_success_at'))return statement;selectionSql=sql;return{bind(...values:unknown[]){selectionBindings=values;assert.ok(values.length<=2);return statement.bind(...values)}}},batch:f.db.batch.bind(f.db)}}as MaintenanceEnv
    const before=f.db.sqlite.prepare('SELECT * FROM maintenance_control').get(),result=await listPendingDocuments(env)
    assert.deepEqual(result.documents.map(d=>d.sourceId),f.docs.filter(d=>!count||d.name!=='outside').map(d=>d.sourceId))
    assert.equal(selectionBindings.length,count?2:1)
    if(count){assert.deepEqual(JSON.parse(String(selectionBindings[0])),f.canary);assert.ok(selectionSql.includes('IN(SELECT value FROM json_each(?))'))}
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_control').get(),before)
    assert.equal(f.messages.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_jobs').get()?.n,0)
    assert.equal((await listPendingDocuments(env,1)).documents[0].sourceId,f.docs[count?1:0].sourceId)
  }finally{f.db.sqlite.close()}
})

test('document selection retains enabled/raw/snapshot/pending/exact-derivative/failure exclusions without renewing acquisition',async()=>{
  for(const reason of ['disabled','raw-null','snapshot-null','no-pending','derivative','failure','snapshot-source','snapshot-raw','not-pdf']as const){
    const f=await documentMembershipFixture(225),document=f.docs[1]
    try{
      if(reason==='disabled')f.db.sqlite.prepare('UPDATE maintenance_sources SET enabled=0 WHERE source_id=?').run(document.sourceId)
      if(reason==='raw-null')f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=NULL WHERE source_id=?').run(document.sourceId)
      if(reason==='snapshot-null')f.db.sqlite.prepare('UPDATE maintenance_sources SET snapshot_key=NULL WHERE source_id=?').run(document.sourceId)
      if(reason==='no-pending')f.db.sqlite.prepare('DELETE FROM maintenance_observations WHERE source_id=?').run(document.sourceId)
      if(reason==='derivative')f.db.sqlite.prepare("INSERT INTO maintenance_document_derivatives VALUES(?,?,?,?,?,?,'poppler',1,?)").run(document.sourceId,document.rawSha256,document.snapshotKey,document.rawKey,'text-key','text-sha',f.now)
      if(reason==='failure')f.db.sqlite.prepare('INSERT INTO maintenance_document_failures VALUES(?,?,?,?)').run(document.sourceId,document.rawSha256,'document_encrypted_not_supported',f.now)
      if(reason==='snapshot-source')await f.bucket.put(document.snapshotKey,JSON.stringify({...document.snapshot,sourceId:'f'.repeat(64)}))
      if(reason==='snapshot-raw')await f.bucket.put(document.snapshotKey,JSON.stringify({...document.snapshot,rawSha256:'f'.repeat(64)}))
      if(reason==='not-pdf')await f.bucket.put(document.snapshotKey,JSON.stringify({...document.snapshot,contentType:'text/html'}))
      const sourceBefore=f.db.sqlite.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').get(document.sourceId)
      assert.deepEqual((await listPendingDocuments(f.env)).documents.map(d=>d.sourceId),[f.docs[2].sourceId],reason)
      assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').get(document.sourceId),sourceBefore)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
    }finally{f.db.sqlite.close()}
  }
})
