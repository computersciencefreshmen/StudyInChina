import assert from 'node:assert/strict'
import { CatalogRefillCoordinator, type RefillDependencies } from '../src/refill-coordinator'
import { REFILL_SINGLETON, type RefillEnv, type RefillStorage } from '../src/refill-contract'
import { control, claimJob, planDueCaptureJobs } from '../src/repository'
import { readRefillJobState, observeRefillDispatch } from '../src/refill-dispatch'
import { MemoryStorage } from './fixture'
import { refillNow } from './refill-dispatch-fixture'
import type { MaintenanceEnv } from '../src/types'

/** Real repository SQL and persisted coordinator state; no provider or Queue
 * dependency is permitted. Reconstructing the coordinator simulates eviction. */
export async function verifyIdleLeaseRecovery(env:MaintenanceEnv,ids:{capture:string[];model:string},attemptSnapshot:()=>Promise<string>){
  let now=refillNow,egress=0,alarm:number|null=null
  const storage=Object.assign(new MemoryStorage(),{async setAlarm(at:number){alarm=at},async deleteAlarm(){alarm=null},async getAlarm(){return alarm}})as RefillStorage
  const refillEnv=env as RefillEnv
  refillEnv.CONTINUOUS_REFILL_ENABLED='true';refillEnv.MAINTENANCE_ADMIN_TOKEN='a'.repeat(64)
  refillEnv.MAINTENANCE_QUEUE={async send(){egress++;throw Error('queue_forbidden')}}
  refillEnv.MODEL_ADMISSION={idFromName(){egress++;throw Error('model_forbidden')},get(){throw Error('model_forbidden')}}
  refillEnv.REFILL_COORDINATOR={idFromName:name=>name,get(){throw Error('unexpected_self_rpc')}}
  const deps:RefillDependencies={
    now:()=>now,
    gate:async()=>{const cfg=(await control(env))!;return{fence:{scopeSha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,revision:cfg.revision,canaryJson:cfg.canary_json},capture:true,model:true,reason:'local_ready',retryAt:now}},
    jobs:async(_env,jobs)=>(await Promise.all(jobs.map(id=>readRefillJobState(env,id)))).filter(row=>row!==null),
    select:async()=>({fence:(await deps.gate(refillEnv,now,false)).fence,candidates:[]}),
    dispatch:async()=>{egress++;throw Error('dispatch_forbidden')},plan:planDueCaptureJobs,
    observe:observeRefillDispatch,dispatchStatus:async()=>({entries:[]}),decline:async()=>{throw Error('decline_forbidden')},
  }
  let coordinator=new CatalogRefillCoordinator({storage,id:REFILL_SINGLETON},refillEnv,deps)
  const call=async(path:string,body?:unknown)=>{
    const response=await coordinator.fetch(new Request(`https://catalog-refill.internal${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${refillEnv.MAINTENANCE_ADMIN_TOKEN}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}))
    assert.equal(response.status,200);return response.json()as Promise<Record<string,unknown>>
  }
  // Create the epoch receipt before any lease expires: its normal no-op path
  // must still perform recovery when the next watchdog sees a lost consumer.
  await planDueCaptureJobs(env,now)
  const leases=[]as Array<{jobId:string;permitToken:string;attempt:number}>
  for(const jobId of [...ids.capture,ids.model]){
    const permit=await call('/acquire',{jobId});assert.equal(permit.allowed,true)
    const job=await claimJob(env,jobId,now);assert.ok(job)
    assert.equal((await call('/claimed',{jobId,permitToken:permit.permitToken,leaseToken:job.lease_token})).confirmed,true)
    leases.push({jobId,permitToken:String(permit.permitToken),attempt:job.attempt})
  }
  const before=await attemptSnapshot()
  // No completion callback arrives. An expired clock alone cannot free a
  // permit; only the existing D1 recovery policy may change job state.
  now+=600001
  coordinator=new CatalogRefillCoordinator({storage,id:REFILL_SINGLETON},refillEnv,deps)
  assert.equal((await call('/release',{jobId:ids.capture[0],permitToken:leases[0].permitToken})).released,false)
  await planDueCaptureJobs(env,now)
  for(const lease of leases){
    const job=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').bind(lease.jobId).first<{stage:string;status:string;attempt:number;due_at:string;lease_token:string|null;lease_until:string|null;enqueued_at:string|null;error_code:string}>();assert.ok(job)
    assert.equal(job.status,job.stage==='capture'?'retry':'unknown');assert.equal(job.attempt,lease.attempt)
    assert.equal(job.due_at,new Date(now+60000).toISOString());assert.equal(job.lease_token,null);assert.equal(job.lease_until,null);assert.equal(job.enqueued_at,null);assert.equal(job.error_code,'execution_lease_expired')
  }
  coordinator=new CatalogRefillCoordinator({storage,id:REFILL_SINGLETON},refillEnv,deps)
  assert.equal((await call('/release',leases[0])).released,true)
  const remaining=await storage.get<{outstanding:Record<string,unknown>}>('refill-v1')
  for(const id of ids.capture)assert.equal(remaining?.outstanding[id],undefined)
  assert.equal((await call('/release',leases.at(-1))).released,false)
  const status=await call('/status')
  assert.equal((status.capture as {inflight:number}).inflight,0)
  assert.equal((status.model as {inflight:number}).inflight,1)
  assert.equal((await call('/acquire',{jobId:ids.model})).allowed,false)
  assert.equal(await attemptSnapshot(),before)
  assert.equal(egress,0)
  // The protected model permit remains durable across another eviction.
  coordinator=new CatalogRefillCoordinator({storage,id:REFILL_SINGLETON},refillEnv,deps)
  assert.equal((await call('/status')).uncertainDeliveries,1)
}
