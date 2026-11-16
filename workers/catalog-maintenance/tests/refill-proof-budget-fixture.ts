import {canonical,digest} from '../src/util'
import {normalizeEvidenceText} from '../../ingestion/src/rules'
import {refillFixture,refillNow} from './refill-dispatch-fixture'

/** Same production parser contract as an operator-prepared permanent proof,
 * backed by actual synthetic unknown SQL rows and complete official artifacts. */
export async function installUnknownProof(f:Awaited<ReturnType<typeof refillFixture>>){
 const sourceId=f.ids.at(-1)!,job=f.jobs.find(j=>j.sourceId===sourceId&&j.stage==='extract')!
 f.db.sqlite.prepare("UPDATE maintenance_jobs SET status='unknown',attempt=1,error_code='model_outcome_unknown' WHERE job_id=?").run(job.jobId)
 const source=f.db.sqlite.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').get(sourceId)!,snapshot=JSON.parse(await(await f.bucket.get(String(source.snapshot_key)))!.text())
 const reservationKey=await digest('performance-protected-reservation'),requestSha256=await digest('performance-protected-payload')
 f.db.sqlite.prepare("INSERT INTO maintenance_model_attempts(reservation_key,attempt_id,source_id,snapshot_sha256,pass,request_sha256,model,status,started_at,quota_json) VALUES(?,'performance-unknown',?,?,'primary',?,'MiniMax-M3','unknown',?,'{}')").run(reservationKey,sourceId,source.raw_sha256,requestSha256,new Date(refillNow).toISOString())
 const ref=async(key:string)=>{const bytes=new Uint8Array(await(await f.bucket.get(key))!.arrayBuffer());return{key,sha256:await digest(bytes),bytes:bytes.length}}
 const text=await ref(snapshot.textKey),full=await(await f.bucket.get(snapshot.textKey))!.text()
 const attempt={...f.db.sqlite.prepare('SELECT * FROM maintenance_model_attempts').get()!},stored={...f.db.sqlite.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').get(job.jobId)!}
 const jobFields=['job_id','source_id','stage','status','priority','attempt','created_at','updated_at','due_at','lease_token','lease_until','snapshot_sha256','snapshot_key','error_code','target_ids_json']
 const proof={format:'studyinchina.runtime-model-no-replay-proof',version:1,operationId:'performance-proof-001',scopeSha256:f.env.SCOPE_REGISTRY_SHA256,revision:2,inputCatalogSha256:'b'.repeat(64),observedAt:new Date(refillNow).toISOString(),attempts:[attempt],jobs:[Object.fromEntries(jobFields.map(k=>[k,stored[k]]))],subjects:[{sourceId,url:source.url,rawSha256:source.raw_sha256,snapshot:await ref(String(source.snapshot_key)),raw:await ref(snapshot.rawKey),text,textAliases:[...new Set([text.sha256,await digest(normalizeEvidenceText(full))])],schoolIds:[`uni-${String(f.ids.length-1).padStart(3,'0')}`]}],requests:[{key:`request:${reservationKey}`,sha256:await digest('unknown-request')}],gateSha256:'a'.repeat(64),unknownOutcomesChanged:false,modelCallsPerformed:false}
 const body=canonical(proof),sha=await digest(body),key=`maintenance/runtime-model-guards/proofs/${sha}.json`
 await f.bucket.put(key,body);await f.bucket.put('maintenance/runtime-model-guards/index.v1.json',canonical({format:'studyinchina.runtime-model-no-replay-index',version:1,proofs:[sha]}))
 return{sourceId,key}
}
