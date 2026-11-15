import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { convertV4MiniflareOptions,Miniflare } from 'miniflare'
import { listPendingDocuments } from '../src/documents'
import type { MaintenanceEnv } from '../src/types'
import { documentMembershipFixture } from './documents-membership-fixture'

test('native D1/R2 selects full 225/295 memberships and empty-all scope with <=2 bindings, outside exclusion and no writes',{timeout:30000},async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({name:'documents-membership-native',modules:true,script:'export default {fetch(){throw Error("no outbound")}}',compatibilityDate:'2026-09-18',host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},d1Databases:{DB:'document-membership-local'},r2Buckets:['BUCKET']}))
  try{
    await mf.ready
    const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET')as unknown as MaintenanceEnv['SNAPSHOTS_BUCKET']
    for(const name of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
    for(const count of [225,295,0]as const){
      const f=await documentMembershipFixture(count)
      try{
        for(const table of ['maintenance_source_schools','maintenance_sources','maintenance_schools','maintenance_control','maintenance_observations'])await db.prepare(`DELETE FROM ${table}`).run()
        for(const table of ['maintenance_schools','maintenance_sources','maintenance_source_schools','maintenance_control','maintenance_observations']){
          const statements=f.db.sqlite.prepare(`SELECT * FROM ${table}`).all().map(row=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)))
          if(statements.length)await db.batch(statements)
        }
        for(const [key,bytes]of f.bucket.objects)await bucket.put(key,bytes)
        let sql='',values:unknown[]=[],writes=0,modelCalls=0,queueCalls=0
        const env={...f.env,SNAPSHOTS_BUCKET:bucket,MODEL_ADMISSION:{idFromName(){modelCalls++;throw Error('model_forbidden')}},MAINTENANCE_QUEUE:{async send(){queueCalls++;throw Error('queue_forbidden')}},PIPELINE_DB:{prepare(query:string){const statement=db.prepare(query);assert.ok(/^\s*SELECT\b/.test(query));return{bind(...params:unknown[]){assert.ok(params.length<=100);if(query.includes('ORDER BY s.last_success_at')){sql=query;values=params}return statement.bind(...params)},first:statement.first.bind(statement)}},async batch(){writes++;throw Error('write_forbidden')}}}as unknown as MaintenanceEnv
        const result=await listPendingDocuments(env)
        assert.deepEqual(result.documents.map(d=>d.sourceId),f.docs.filter(d=>!count||d.name!=='outside').map(d=>d.sourceId))
        assert.equal(values.length,count?2:1)
        assert.equal((await db.prepare(`EXPLAIN ${sql}`).bind(...values).all()).success,true)
        for(const table of ['maintenance_jobs','maintenance_model_attempts','maintenance_document_derivatives','maintenance_document_failures'])assert.equal(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first('n'),0)
        assert.equal(modelCalls,0);assert.equal(queueCalls,0);assert.equal(writes,0)
      }finally{f.db.sqlite.close()}
    }
  }finally{await mf.dispose()}
})
