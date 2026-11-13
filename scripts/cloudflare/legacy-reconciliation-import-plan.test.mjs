import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {applyImportPlan,fingerprint,writeStatement,readStatement} from './legacy-reconciliation-import-plan.mjs'
const row={reservation_key:'a'.repeat(64),attempt_id:'original-unknown',source_id:'b'.repeat(64),snapshot_sha256:'c'.repeat(64),pass:'primary',request_sha256:'d'.repeat(64),model:'MiniMax-M3',status:'unknown',started_at:'2026-10-26T00:00:00.000Z',completed_at:null,output_key:null,output_sha256:null,usage_json:null,quota_json:'{}',error_code:'timeout'}
const makePlan=ops=>{const p={format:'studyinchina.legacy-reconciliation-import-plan',version:1,operations:ops,publicWrites:false,modelCalls:false};return{...p,sha256:fingerprint(p)}}
function harness(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE maintenance_model_attempts ('+Object.keys(row).map(k=>'"'+k+'" TEXT'+(k==='attempt_id'?' PRIMARY KEY':'')).join(',')+')')
  const query=async({sql,params})=>sql.startsWith('SELECT')?db.prepare(sql).all(...params).map(r=>({...r})):(db.prepare(sql).run(...params),[])
  return{db,query}
}
test('unknown is imported unchanged and an interrupted successful write resumes without a second write',async()=>{
  const{db,query}=harness();try{
    const plan=makePlan([{table:'maintenance_model_attempts',before:null,after:row,originalRowSha256:fingerprint(row)}])
    let writes=0,lost=true
    const network=async s=>{const result=await query(s);if(!s.sql.startsWith('SELECT')){writes++;if(lost){lost=false;throw Error('response_lost')}}return result}
    await assert.rejects(applyImportPlan(plan,network),/response_lost/)
    assert.equal(db.prepare('SELECT status FROM maintenance_model_attempts').get().status,'unknown')
    assert.equal((await applyImportPlan(plan,network)).reused,1)
    assert.equal(writes,1)
  }finally{db.close()}
})
test('fresh existing conflict stops before any write',async()=>{
  const{db,query}=harness();try{
    await query(writeStatement({table:'maintenance_model_attempts',before:null,after:{...row,request_sha256:'e'.repeat(64)}}))
    await assert.rejects(applyImportPlan(makePlan([{table:'maintenance_model_attempts',before:null,after:row}]),query),/fresh_row_conflict/)
    assert.equal(db.prepare('SELECT request_sha256 FROM maintenance_model_attempts').get().request_sha256,'e'.repeat(64))
  }finally{db.close()}
})
test('full-row CAS detects a change between fresh read and mutation',async()=>{
  const{db,query}=harness();try{
    const before={...row,status:'known_failed'};await query(writeStatement({table:'maintenance_model_attempts',before:null,after:before}))
    let reads=0
    const racing=async s=>{const r=await query(s);if(s.sql.startsWith('SELECT')&&++reads===1)db.prepare('UPDATE maintenance_model_attempts SET error_code=?').run('concurrent');return r}
    await assert.rejects(applyImportPlan(makePlan([{table:'maintenance_model_attempts',before,after:row}]),racing),/write_readback_conflict/)
    assert.equal(db.prepare('SELECT status FROM maintenance_model_attempts').get().status,'known_failed')
  }finally{db.close()}
})
test('data is bound verbatim; arbitrary identifiers and primary key rewrites reject',async()=>{
  const{db,query}=harness();try{
    const quoted={...row,error_code:"'; DROP TABLE maintenance_model_attempts; --"}
    await query(writeStatement({table:'maintenance_model_attempts',before:null,after:quoted}))
    assert.deepEqual((await query(readStatement('maintenance_model_attempts',quoted)))[0],quoted)
    assert.throws(()=>readStatement('maintenance_jobs',quoted),/schema_invalid/)
    assert.throws(()=>writeStatement({table:'maintenance_model_attempts',before:row,after:{...row,attempt_id:'different'}}),/primary_key_rewrite/)
  }finally{db.close()}
})
test('plan corruption rejects before queries',async()=>{
  const plan=makePlan([]);plan.operations.push({table:'anything'})
  await assert.rejects(applyImportPlan(plan,()=>assert.fail('unexpected database query')),/plan_invalid/)
})
