import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import test from 'node:test'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import type {MaintenanceEnv} from '../src/types'
import {selectRefillCandidates,dispatchRefillCandidates,readRefillDispatchStatus,declineRefillDispatch,observeRefillDispatch} from '../src/refill-dispatch'
import {claimJob} from '../src/repository'
import {refillFixture,refillNow} from './refill-dispatch-fixture'

test('native D1/R2 atomically claims bounded refill work, compiles full guards and rejects late unknown/target races without sending',{timeout:30000},async()=>{
 for(const mode of ['healthy','unknown','target','lost-send','decline']as const){
  const f=await refillFixture(5),mf=new Miniflare(convertV4MiniflareOptions({name:'refill-dispatch-native',modules:true,script:'export default {fetch(){throw Error("no egress")}}',compatibilityDate:'2026-09-18',host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},d1Databases:{DB:'refill-local'},r2Buckets:['BUCKET']}))
  try{
   await mf.ready;const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET')as unknown as MaintenanceEnv['SNAPSHOTS_BUCKET']
   for(const file of ['0019_catalog_maintenance.sql','0021_maintenance_scope_upgrades.sql','0025_maintenance_refill_dispatch.sql'])for(const sql of readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${file}`,import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
   for(const table of ['maintenance_schools','maintenance_sources','maintenance_source_schools','maintenance_control','maintenance_record_targets','maintenance_target_sources','maintenance_jobs']){
    const rows=f.db.sqlite.prepare(`SELECT * FROM ${table}`).all();if(!rows.length)continue;const columns=Object.keys(rows[0]),size=Math.floor(100/columns.length),statements=[]
    for(let at=0;at<rows.length;at+=size){const group=rows.slice(at,at+size),values=group.flatMap(row=>columns.map(k=>row[k]));assert.ok(values.length<=100);statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES${group.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')}`).bind(...values));if(statements.length===8)await db.batch(statements.splice(0))}if(statements.length)await db.batch(statements)
   }
   for(const [key,body]of f.bucket.objects)await bucket.put(key,body)
   let sends=0,modelCalls=0,injected=false,chosen:{jobId:string;sourceId:string}|null=null
   const guards:Array<{sql:string;values:unknown[]}>=[]
   const env={...f.env,SNAPSHOTS_BUCKET:bucket,MODEL_ADMISSION:{idFromName(){modelCalls++;throw Error('model_forbidden')}},MAINTENANCE_QUEUE:{async send(message:{jobId:string}){sends++;assert.equal(await db.prepare('SELECT status FROM maintenance_refill_dispatches WHERE job_id=?').bind(message.jobId).first('status'),'prepared');if(mode==='lost-send')throw Error('lost queue reply')}},PIPELINE_DB:{prepare(sql:string){const statement=db.prepare(sql);return{bind(...values:unknown[]){assert.ok(values.length<=100);assert.ok(Buffer.byteLength(sql)<=100000);if(sql.startsWith('INSERT INTO maintenance_transaction_guards'))guards.push({sql,values});return statement.bind(...values)},first:statement.first.bind(statement)}},async batch(statements:unknown[]){if(!injected&&chosen&&(mode==='unknown'||mode==='target')){injected=true;if(mode==='unknown')await db.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES('key','late',?,'raw','primary','request','MiniMax-M3','unknown','now','{}')").bind(chosen.sourceId).run();else await db.prepare('UPDATE maintenance_record_targets SET target_json=? WHERE target_id IN(SELECT target_id FROM maintenance_target_sources WHERE source_id=?)').bind('{}',chosen.sourceId).run()}return db.batch(statements as Parameters<typeof db.batch>[0])}}}as unknown as MaintenanceEnv
   const plan=await selectRefillCandidates(env,{kind:'model',limit:1,excludeJobIds:[],now:refillNow,allowExpansion:false});assert.equal(plan.candidates.length,1);chosen=plan.candidates[0]
   const dispatchToken=randomUUID(),result=await dispatchRefillCandidates(env,plan.fence!,plan.candidates,{dispatchToken,epochSha256:'e'.repeat(64),now:refillNow})
   if(mode==='healthy'){assert.equal(result.sent.length,1);assert.equal(sends,1);assert.equal((await readRefillDispatchStatus(env,dispatchToken)).entries[0].status,'sent');assert.ok(await claimJob(env,chosen.jobId,refillNow,{dispatchToken,epochSha256:'e'.repeat(64)}));assert.equal((await declineRefillDispatch(env,{jobId:chosen.jobId,dispatchToken,epochSha256:'e'.repeat(64),reason:'claim_rejected'})).declined,false);assert.equal(await observeRefillDispatch(env,dispatchToken,chosen.jobId),true)}
   else if(mode==='decline'){assert.equal(result.sent.length,1);assert.equal((await declineRefillDispatch(env,{jobId:chosen.jobId,dispatchToken,epochSha256:'e'.repeat(64),reason:'permit_denied'})).declined,true);assert.equal(await claimJob(env,chosen.jobId,refillNow,{dispatchToken,epochSha256:'e'.repeat(64)}),null);assert.equal((await readRefillDispatchStatus(env,dispatchToken)).entries[0].resolution,'received_not_started')}
   else if(mode==='lost-send'){assert.equal(result.unconfirmed.length,1);assert.equal(sends,1);assert.equal((await readRefillDispatchStatus(env,dispatchToken)).entries[0].status,'unconfirmed')}
   else{assert.equal(result.notSent.length,1);assert.equal(sends,0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_refill_dispatches').first('n'),0);assert.equal(await db.prepare('SELECT enqueued_at FROM maintenance_jobs WHERE job_id=?').bind(chosen.jobId).first('enqueued_at'),null)}
   assert.ok(guards.length>=2);for(const guard of guards)assert.equal((await db.prepare(`EXPLAIN ${guard.sql}`).bind(...guard.values).all()).success,true)
   assert.equal(await db.prepare('SELECT COUNT(*) n FROM maintenance_transaction_guards').first('n'),0);assert.equal(modelCalls,0)
   if(mode==='unknown')assert.equal(await db.prepare('SELECT status FROM maintenance_model_attempts').first('status'),'unknown')
  }finally{await mf.dispose();f.db.sqlite.close()}
 }
})
