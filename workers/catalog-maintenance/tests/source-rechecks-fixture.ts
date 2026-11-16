import { seed,setControls } from '../src/repository'
import { sourceRecheckOriginalJobSha256 } from '../src/source-rechecks'
import { digest } from '../src/util'
import { makeEnv,seedInput,TEST_CATALOG,TEST_GUARDS,TEST_SCOPE } from './fixture'

export async function recheckFixture(count=1){
  const f=makeEnv(),now=Date.now(),seedPlan=seedInput()
  for(let index=1;index<count;index++)seedPlan.schools[0].sourceSeeds.push({...seedPlan.schools[0].sourceSeeds[0],id:`official-test-${index}`,url:`https://test.edu.cn/catalog-${index}`})
  await seed(f.env,seedPlan,now)
  await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:false,canaryUniversityIds:['uni-000']},now)
  const sourceId=await digest('https://test.edu.cn/catalog'),originalJobId=await digest('old-held-capture'),iso=new Date(now-3600000).toISOString()
  const requests=[]
  for(let index=0;index<count;index++){
    const id=index?await digest(`https://test.edu.cn/catalog-${index}`):sourceId,jobId=index?await digest(`old-held-capture-${index}`):originalJobId
    f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at,attempt,error_code,enqueued_at) VALUES(?,?,'capture','held',10,?,?,?,4,'execution_failed',?)").run(jobId,id,iso,iso,iso,iso)
    f.db.sqlite.prepare("UPDATE maintenance_sources SET failures=1,error_code='execution_failed',last_attempt_at=?,due_at=? WHERE source_id=?").run(iso,new Date(now+86400000).toISOString(),id)
    requests.push({sourceId:id,originalJobId:jobId,originalJobSha256:await sourceRecheckOriginalJobSha256(f.db.sqlite.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').get(jobId))})
  }
  const original=f.db.sqlite.prepare('SELECT * FROM maintenance_jobs WHERE job_id=?').get(originalJobId)!,originalJobSha256=await sourceRecheckOriginalJobSha256(original)
  const input={operationId:'recheck-local-first',expectedRevision:1,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG,sources:requests}
  return{...f,now,input,sourceId,originalJobId,original,originalJobSha256}
}
