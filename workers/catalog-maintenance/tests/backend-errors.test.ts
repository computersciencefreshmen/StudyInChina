import assert from 'node:assert/strict'
import test from 'node:test'
import { backendErrorKind,isDailyD1QuotaError } from '../src/backend-errors'
import { runtimeStatus,runCloudTick } from '../src/runtime'
import { rolloutStatus } from '../src/rollout'
import { listSchoolProgress } from '../src/school-progress'
import { gateRequest,digest } from '../src/util'
import { makeEnv } from './fixture'

test('only explicit exhausted daily D1 allowances are quota waits; generic 7500 and SQL errors are not',()=>{
  for(const message of ['D1_ERROR 7500 daily read quota exceeded','D1 daily quota exceeded 7500',"Your account has exceeded D1's maximum account-level limit for reads per day."]){assert.equal(isDailyD1QuotaError(new Error(message)),true,message);assert.equal(backendErrorKind(new Error(message)),'daily_quota')}
  for(const message of ['D1_ERROR 7500','D1_ERROR: no such table: maintenance_sources (7500)','D1_ERROR: syntax error near SELECT (7500)','D1_ERROR: too many queries (7500)','D1 daily maintenance query failed'])assert.equal(isDailyD1QuotaError(new Error(message)),false,message)
})
test('status keeps bounded redacted fixed-SQL error details private behind a checksum diagnostic reference',async()=>{
  const f=makeEnv(),message=`D1_ERROR: no such table: maintenance_sources (7500) ${f.env.MAINTENANCE_ADMIN_TOKEN} ${f.env.MINIMAX_SUBSCRIPTION_KEY} Bearer other-private-token ${'x'.repeat(2000)}`
  try{
    f.env.PIPELINE_DB={prepare(){throw new Error(message)},async batch(){throw new Error(message)}}
    const status=await runtimeStatus(f.env);assert.equal(status.backend.state,'backend_unavailable');assert.equal(status.backend.errorKind,'sql_error');assert.equal(status.backend.retryAt,null);assert.ok(status.backend.diagnosticKey)
    const object=await f.bucket.get(status.backend.diagnosticKey!),text=await object!.text(),diagnostic=JSON.parse(text)
    assert.equal(await digest(text),status.backend.diagnosticSha256);assert.ok(diagnostic.message.length<=1200);assert.match(diagnostic.message,/no such table/)
    for(const secret of [f.env.MAINTENANCE_ADMIN_TOKEN!,f.env.MINIMAX_SUBSCRIPTION_KEY!,'other-private-token']){assert.equal(text.includes(secret),false);assert.equal(JSON.stringify(status).includes(secret),false)}
    assert.equal(JSON.stringify(status).includes('no such table'),false);assert.equal(diagnostic.operation,'fixed-status-sql')
  }finally{f.db.sqlite.close()}
})
test('generic 7500 does not masquerade as a daily quota wait in tick, rollout, admission or school status',async()=>{
  const f=makeEnv(),error=new Error('D1_ERROR: no such table: maintenance_control (7500)')
  try{
    f.env.PIPELINE_DB={prepare(){throw error},async batch(){throw error}}
    const tick=await runCloudTick(f.env);assert.equal(tick.state,'error');assert.equal(tick.code,'backend_unavailable');assert.equal(tick.retryAt,null)
    assert.equal((await rolloutStatus(f.env)).backendState,'backend_unavailable');assert.equal((await listSchoolProgress(f.env)).backendState,'unavailable')
    const response=await gateRequest(f.env,'/model/run',{reservationKey:'a'.repeat(64),sourceId:'b'.repeat(64),snapshotSha256:'c'.repeat(64),pass:'primary',lane:'maintenance',payload:'not sent',universityIds:['uni-000']});assert.equal(response.status,400);assert.notEqual((await response.json()).error,'quota_backend_wait')
  }finally{f.db.sqlite.close()}
})
