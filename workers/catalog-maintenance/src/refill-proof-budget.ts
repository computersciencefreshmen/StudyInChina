import type { MaintenanceEnv, BucketObject } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, record } from './util'

export const REFILL_PROOF_ATTEMPTS=8,REFILL_PROOF_TIME_MS=8000
const CACHE_BYTES=16*1024*1024,SCAN_BYTES=32768
type Lane='maintenance'|'programme'|'award'|'future'
type Hint={format:'studyinchina.refill-scan-hint';version:1;epochSha256:string;observedAt:number;offsets:Record<Lane,number>;visited:Array<{id:string;stamp:string;lane:Lane}>}
export const proofDeadline=(error:unknown)=>error instanceof MaintenanceError&&error.code==='refill_dispatch_selection_deadline'
/** Invocation-local read reuse only. Neither dispatch nor actual model
 * admission receives this environment. Every caller still verifies the bytes. */
export function refillProofBudget(env:MaintenanceEnv){
 const start=performance.now(),deadline=start+REFILL_PROOF_TIME_MS
 const counts={attempts:0,r2Reads:0,r2CacheHits:0,timedOut:false}
 let cacheBytes=0,stopped=false
 const cache=new Map<string,Promise<BucketObject|null>>()
 const check=()=>{if(stopped||performance.now()>=deadline){counts.timedOut=true;stopped=true;throw new MaintenanceError('refill_dispatch_selection_deadline')}}
 const timed=async<T>(work:()=>Promise<T>):Promise<T>=>{
  check();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{stopped=true;counts.timedOut=true;reject(new MaintenanceError('refill_dispatch_selection_deadline'))},Math.max(1,deadline-performance.now()))})])}
  finally{if(timer!==undefined)clearTimeout(timer)}
 }
 const bucket:MaintenanceEnv['SNAPSHOTS_BUCKET']={
  get:async key=>timed(async()=>{
   check();const found=cache.get(key);if(found){counts.r2CacheHits++;return found}
   counts.r2Reads++
   const loading=(async()=>{
    const object=await env.SNAPSHOTS_BUCKET.get(key);check();if(!object)return null
    // Retain no more than16MiB. Oversized/unknown-size objects keep the original
    // bounded reader's validation and are never accumulated in this cache.
    if(object.size===undefined||object.size>CACHE_BYTES-cacheBytes){
     cache.delete(key)
     // Other callers may already await this Promise. Atomically consume the
     // original once; later readers get their own stream, never its used body.
     let original:BucketObject|null=object
     const fresh=async()=>{check();if(original){const value=original;original=null;return value}counts.r2Reads++;const value=await env.SNAPSHOTS_BUCKET.get(key);check();if(!value)throw new MaintenanceError('refill_dispatch_artifact_unavailable');return value}
     return{size:object.size,etag:object.etag,text:async()=>(await fresh()).text(),arrayBuffer:async()=>(await fresh()).arrayBuffer()}
    }
    cacheBytes+=object.size
    const body=new Uint8Array(await object.arrayBuffer());check()
    if(body.length!==object.size)throw new MaintenanceError('refill_dispatch_artifact_size_changed')
    return{size:body.length,etag:object.etag,text:async()=>{check();return new TextDecoder().decode(body)},arrayBuffer:async()=>{check();return body.slice().buffer}}
   })()
   cache.set(key,loading);return loading
  }),
  put:(key,body,options)=>{cache.delete(key);return timed(()=>env.SNAPSHOTS_BUCKET.put(key,body,options))},
 }
 const database:MaintenanceEnv['PIPELINE_DB']={
  prepare(sql){check();const statement=env.PIPELINE_DB.prepare(sql)
   const wrap=(current:typeof statement):typeof statement=>({bind(...values){check();return wrap(current.bind(...values))},first:()=>timed(()=>current.first()),all:()=>timed(()=>current.all()),run:()=>{throw new MaintenanceError('refill_dispatch_selection_write_forbidden')}})
   return wrap(statement)
  },batch:()=>{throw new MaintenanceError('refill_dispatch_selection_write_forbidden')},
 }
 return{env:{...env,SNAPSHOTS_BUCKET:bucket,PIPELINE_DB:database},timed,check,counts,
  attempt(){check();if(counts.attempts>=REFILL_PROOF_ATTEMPTS)return false;counts.attempts++;return true},
  diagnostics:()=>({...counts,cachedBytes:cacheBytes,elapsedMs:Math.ceil(performance.now()-start)}),
 }
}

/** A scan hint authorizes nothing. A write precedes expensive reads so a slow
 * or invalid candidate cannot pin every future alarm to the same first page. */
export async function refillScanHint(env:MaintenanceEnv,epoch:unknown,now:number){
 const epochSha256=await digest(canonical(epoch)),key=`maintenance/refill-dispatch/scan/${epochSha256}.json`
 const empty=():Hint=>({format:'studyinchina.refill-scan-hint',version:1,epochSha256,observedAt:now,offsets:{maintenance:0,programme:0,award:0,future:0},visited:[]})
 const saved=await env.SNAPSHOTS_BUCKET.get(key);let hint=empty(),etag=saved?.etag
 if(saved&&saved.size!==undefined&&saved.size<=SCAN_BYTES){
  try{const text=await saved.text(),v=record(JSON.parse(text)),offsets=record(v?.offsets)
   if(new TextEncoder().encode(text).length<=SCAN_BYTES&&v?.format===hint.format&&v.version===1&&v.epochSha256===epochSha256&&typeof v.observedAt==='number'&&v.observedAt<=now&&now-v.observedAt<900000&&offsets&&Object.keys(hint.offsets).every(lane=>Number.isSafeInteger(offsets[lane])&&Number(offsets[lane])>=0&&Number(offsets[lane])<=1000000)&&Array.isArray(v.visited)&&v.visited.length<=104&&v.visited.every(row=>row&&typeof row.id==='string'&&row.id.length<=160&&/^[a-f0-9]{64}$/.test(String(row.stamp))&&Object.hasOwn(hint.offsets,row.lane)))hint=v as unknown as Hint
  }catch{/* A malformed scheduling hint is discarded, never accepted as proof. */}
 }
 const fingerprint=async(row:Record<string,unknown>)=>digest(canonical(row))
 const seen=(id:string,stamp:string)=>hint.visited.some(v=>v.id===id&&v.stamp===stamp)
 const write=async()=>{
  hint.observedAt=now;const text=canonical(hint);if(new TextEncoder().encode(text).length>SCAN_BYTES)throw new MaintenanceError('refill_dispatch_scan_hint_oversized')
  const result=await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  if(result===null)throw new MaintenanceError('refill_dispatch_scan_hint_conflict')
  // A sole writer normally needs one write; subsequent fallback writes fetch
  // the new ETag rather than pretending the previous token still applies.
  etag=(await env.SNAPSHOTS_BUCKET.get(key))?.etag
  if(!etag)throw new MaintenanceError('refill_dispatch_scan_hint_unconfirmed')
 }
 return{offsets:hint.offsets,fingerprint,seen,
  async visit(id:string,stamp:string,lane:Lane){hint.visited=[...hint.visited.filter(v=>v.id!==id),{id,stamp,lane}].slice(-104);await write()},
  async forget(id:string){hint.visited=hint.visited.filter(v=>v.id!==id);await write()},
  async page(lane:Lane,rows:Array<{id:string;stamp:string}>,size:number){
   if(rows.length&&rows.some(r=>!seen(r.id,r.stamp)))return
   if(!rows.length&&!hint.offsets[lane])return
   hint.offsets[lane]=rows.length===size?hint.offsets[lane]+size:0
   hint.visited=hint.visited.filter(v=>v.lane!==lane);await write()
  },
 }
}
