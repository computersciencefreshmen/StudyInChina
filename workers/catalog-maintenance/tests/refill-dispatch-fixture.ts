import {readFileSync} from 'node:fs'
import {seed,setControls} from '../src/repository'
import {canonical,digest} from '../src/util'
import type {RecordTarget} from '../src/types'
import {makeEnv,seedInput,TEST_GUARDS} from './fixture'
export const refillNow=Date.parse('2026-11-16T04:00:00.000Z')
export async function refillFixture(schools=12){
  const f=makeEnv(),input=seedInput(),iso=new Date(refillNow).toISOString()
  f.db.sqlite.exec(readFileSync(new URL('../../../infra/d1/pipeline/migrations/0025_maintenance_refill_dispatch.sql',import.meta.url),'utf8'))
  for(let i=0;i<schools;i++)input.schools[i].sourceSeeds=[{id:`refill-${i}`,url:`https://refill-${i}.edu.cn/catalogue`,allowedHosts:[`refill-${i}.edu.cn`],sourceCategory:'current_guide',enabled:true,registration:'catalogue_official'}]
  await seed(f.env,input,refillNow)
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:input.schools.slice(0,5).map(s=>s.universityId)},refillNow)
  await setControls(f.env,{expectedRevision:1,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:[]},refillNow)
  const ids:string[]=[],jobs:{jobId:string;sourceId:string;stage:string}[]=[]
  for(let i=0;i<schools;i++){
    const url=input.schools[i].sourceSeeds[0].url,id=await digest(url),raw=`Official source original ${i}`,full=`Official normalized complete source text ${i}`,rawSha=await digest(raw),textSha=await digest(full),rawKey=`maintenance/snapshots/${id}/${rawSha}.bin`,snapshotKey=`maintenance/snapshots/${id}/${rawSha}.json`,textKey=`maintenance/text/${id}/${textSha}.txt`
    ids.push(id);await f.bucket.put(rawKey,raw);await f.bucket.put(textKey,full);await f.bucket.put(snapshotKey,canonical({version:1,sourceId:id,sourceUrl:url,finalUrl:url,checkedAt:iso,rawSha256:rawSha,rawKey,textKey,textSha256:textSha,canonicalSha256:textSha,contentType:'text/plain',parserCandidates:[]}))
    f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=?,last_success_at=?,due_at=? WHERE source_id=?').run(rawSha,textSha,snapshotKey,iso,new Date(refillNow+7*86400000).toISOString(),id)
    const target:RecordTarget={recordId:`refill-program-${i}`,entityType:'program',universityId:input.schools[i].universityId,sourceIds:[id],recordScopeSha256:await digest(`scope-${i}`),identity:{name:{en:`Real fixture programme ${i}`},degreeLevel:'bachelor',teachingLanguages:[]},year:null,intake:null,fields:{durationMonths:null},reviewAfter:'2027-12-01'}
    const tid=`program:${target.recordId}`
    f.db.sqlite.prepare('INSERT INTO maintenance_record_targets(target_id,record_id,entity_type,university_id,record_scope_sha256,fields_json,target_json) VALUES(?,?,?,?,?,?,?)').run(tid,target.recordId,target.entityType,target.universityId,target.recordScopeSha256,canonical(target.fields),canonical(target));f.db.sqlite.prepare('INSERT INTO maintenance_target_sources VALUES(?,?)').run(tid,id)
    for(const stage of ['capture','extract','award','maintain']){
      const jobId=await digest(`refill-${i}-${stage}`),pins=stage==='maintain'?canonical([{id:tid,sha256:target.recordScopeSha256}]):null
      f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json) VALUES(?,?,?,'queued',10,?,?,?,?,?,?)").run(jobId,id,stage,iso,iso,iso,stage==='capture'?null:rawSha,stage==='capture'?null:snapshotKey,pins)
      jobs.push({jobId,sourceId:id,stage})
    }
  }
  return{...f,ids,jobs}
}
