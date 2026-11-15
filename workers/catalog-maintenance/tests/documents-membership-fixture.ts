import { seed } from '../src/repository'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

export async function documentMembershipFixture(count:99|100|225|295|0){
  const f=makeEnv(),input=seedInput(),now='2026-11-15T00:00:00.000Z'
  f.env.SCOPE_SCHOOL_COUNT='295'
  for(let i=272;i<295;i++)input.schools.push({universityId:`uni-${String(i).padStart(3,'0')}`,name:{en:`University ${i}`},sourceSeeds:[]})
  input.schools.forEach(s=>{s.sourceSeeds=[]})
  await seed(f.env,input,Date.parse(now))
  const canary=input.schools.slice(0,count).map(s=>s.universityId),inside=input.schools[(count||295)-1].universityId,outside='uni-outside-canary'
  f.db.sqlite.prepare('UPDATE maintenance_control SET canary_json=?').run(JSON.stringify(canary))
  f.db.sqlite.prepare('INSERT INTO maintenance_schools(university_id,scope_sha256,name_json,seed_json) VALUES(?,?,?,?)').run(outside,input.scopeRegistrySha256,'{}','{}')
  const docs=[]
  for(const [i,name]of ['outside','inside','shared'].entries()){
    const url=`https://documents.edu.cn/${name}.pdf`,sourceId=await digest(url),rawSha256=await digest(`pdf-${name}`),rawKey=`maintenance/snapshots/${sourceId}/${rawSha256}.bin`,snapshotKey=`maintenance/snapshots/${sourceId}/${rawSha256}.json`
    const snapshot={version:1,sourceId,sourceUrl:url,finalUrl:url,rawSha256,rawKey,checkedAt:now,contentType:'application/pdf'}
    f.db.sqlite.prepare('INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,enabled,interval_hours,due_at,last_success_at,raw_sha256,snapshot_key) VALUES(?,?,?,\'current_guide\',1,168,?,?,?,?)').run(sourceId,url,'["documents.edu.cn"]',now,`2026-11-15T00:00:0${i}.000Z`,rawSha256,snapshotKey)
    f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(sourceId,name==='outside'?outside:inside)
    if(name==='shared')f.db.sqlite.prepare('INSERT INTO maintenance_source_schools VALUES(?,?)').run(sourceId,outside)
    f.db.sqlite.prepare("INSERT INTO maintenance_observations(observation_id,job_id,source_id,checked_at,final_url,http_status,raw_sha256,snapshot_key,content_type,outcome) VALUES(?,?,?,?,?,200,?,?,?,'rich_document_pending')").run(`observation-${name}`,`capture-${name}`,sourceId,now,url,rawSha256,snapshotKey,'application/pdf')
    await f.bucket.put(snapshotKey,JSON.stringify(snapshot))
    docs.push({name,sourceId,rawSha256,rawKey,snapshotKey,snapshot})
  }
  return{...f,canary,docs,now}
}
