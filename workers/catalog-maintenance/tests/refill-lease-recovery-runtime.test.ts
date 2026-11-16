import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import type {MaintenanceEnv} from '../src/types'
import {refillFixture} from './refill-dispatch-fixture'
import {verifyIdleLeaseRecovery} from './refill-lease-recovery-fixture'
import {canonical} from '../src/util'

test('native D1/R2 watchdog recovery survives coordinator reconstruction, frees proven capture retries and retains unknown model permits',{timeout:30000},async()=>{
 const f=await refillFixture(3),mf=new Miniflare(convertV4MiniflareOptions({name:'refill-lease-native',modules:true,script:'export default {fetch(){throw Error("egress_forbidden")}}',compatibilityDate:'2026-09-18',host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},d1Databases:{DB:'local'},r2Buckets:['BUCKET']}))
 try{
  await mf.ready
  const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET')as unknown as MaintenanceEnv['SNAPSHOTS_BUCKET']
  for(const file of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql','0025_maintenance_refill_dispatch.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${file}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
  for(const table of ['maintenance_schools','maintenance_sources','maintenance_source_schools','maintenance_control','maintenance_record_targets','maintenance_target_sources','maintenance_jobs']){
   const rows=f.db.sqlite.prepare(`SELECT * FROM ${table}`).all();if(!rows.length)continue
   const columns=Object.keys(rows[0]),size=Math.floor(100/columns.length),statements=[]
   for(let at=0;at<rows.length;at+=size){const group=rows.slice(at,at+size),values=group.flatMap(row=>columns.map(k=>row[k]));assert.ok(values.length<=100);statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES${group.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')}`).bind(...values));if(statements.length===8)await db.batch(statements.splice(0))}if(statements.length)await db.batch(statements)
  }
  for(const[key,value]of f.bucket.objects)await bucket.put(key,value)
  const recoverySql:Array<{sql:string;values:unknown[]}>=[]
  const env={...f.env,SNAPSHOTS_BUCKET:bucket,PIPELINE_DB:{prepare(sql:string){const statement=db.prepare(sql);return{bind(...values:unknown[]){assert.ok(values.length<=100);if(sql.startsWith('UPDATE maintenance_jobs SET status=CASE'))recoverySql.push({sql,values});return statement.bind(...values)},first:statement.first.bind(statement)}},batch:db.batch.bind(db)}}as unknown as MaintenanceEnv
  const captures=f.jobs.filter(j=>j.stage==='capture').slice(0,2),model=f.jobs.find(j=>j.sourceId===f.ids[2]&&j.stage==='extract')!
  let inserted=false
  await verifyIdleLeaseRecovery(env,{capture:captures.map(j=>j.jobId),model:model.jobId},async()=>{
   if(!inserted){inserted=true;await db.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('original','original',?,'raw','primary','request','MiniMax-M3','send_started','2026-11-16T03:59:00Z','{}')").bind(model.sourceId).run()}
   return canonical((await db.prepare('SELECT * FROM maintenance_model_attempts').all()).results)
  })
  assert.ok(recoverySql.length>=2)
  for(const query of recoverySql){assert.match(query.sql,/LIMIT 64/);assert.equal((await db.prepare(`EXPLAIN ${query.sql}`).bind(...query.values).all()).success,true)}
  assert.equal(await db.prepare("SELECT status FROM maintenance_model_attempts WHERE attempt_id='original'").first('status'),'send_started')
 }finally{await mf.dispose();f.db.sqlite.close()}
})
