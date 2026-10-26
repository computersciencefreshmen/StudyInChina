import assert from 'node:assert/strict'
import test from 'node:test'
import { handleFetch } from '../src/index'
import { seed,setControls } from '../src/repository'
import { digest,gateRequest } from '../src/util'
import { makeEnv,quotaResponse,seedInput,TEST_CATALOG,TEST_GUARDS,TEST_SCOPE } from './fixture'

const token='f'.repeat(64),acquire={batchId:'offline-batch-1',token,scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG}
const modelInput=async()=>({reservationKey:'1'.repeat(64),sourceId:await digest('https://test.edu.cn/catalog'),snapshotSha256:'2'.repeat(64),pass:'primary',lane:'maintenance',payload:'No external requests',universityIds:['uni-000']})
test('authenticated offline fence works without D1 and blocks both normal model and source admission',async()=>{
  const f=makeEnv();let reads=0
  try{
    f.env.PIPELINE_DB={prepare(){reads++;throw new Error('D1 daily quota exceeded')},async batch(){throw new Error('D1 unavailable')}}
    assert.equal((await handleFetch(new Request('https://worker/offline-fence'),f.env)).status,401)
    const response=await handleFetch(new Request('https://worker/offline-fence/acquire',{method:'POST',headers:{authorization:`Bearer ${f.env.MAINTENANCE_ADMIN_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(acquire)}),f.env)
    assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.fence.phase,'active');assert.equal(receipt.fence.tokenSha256,await digest(token));assert.equal(JSON.stringify(receipt).includes(token),false)
    const status=await(await gateRequest(f.env,'/offline-fence/status',{})).json();assert.equal(status.fence.batchId,acquire.batchId)
    assert.equal((await gateRequest(f.env,'/fetch/acquire',{host:'test.edu.cn'})).status,429)
    assert.equal((await gateRequest(f.env,'/model/run',await modelInput())).status,429);assert.equal(reads,0)
    assert.equal((await(await gateRequest(f.env,'/offline-fence/acquire',acquire)).json()).reused,true)
  }finally{f.db.sqlite.close()}
})
test('active or unreconciled expired permits prevent fence acquisition',async()=>{
  const f=makeEnv()
  try{
    const permit=await(await gateRequest(f.env,'/fetch/acquire',{host:'test.edu.cn'})).json()
    assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,409)
    await gateRequest(f.env,'/fetch/release',{token:permit.token});assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,200)
    const g=makeEnv();try{await g.storage.put('gate',{fetches:[],models:[{token:'unreconciled',expiresAt:Date.now()-1}],nextHost:{},successes:0,cooldownUntil:0,modelLimit:2});assert.equal((await gateRequest(g.env,'/offline-fence/acquire',acquire)).status,409)}finally{g.db.sqlite.close()}
  }finally{f.db.sqlite.close()}
})
test('batch identity, token, scope and immutable acknowledged manifest cannot be changed or used to unfence',async()=>{
  const f=makeEnv()
  try{
    assert.equal((await gateRequest(f.env,'/offline-fence/acquire',{...acquire,scopeRegistrySha256:'0'.repeat(64)})).status,409)
    await gateRequest(f.env,'/offline-fence/acquire',acquire)
    for(const change of [{batchId:'other-batch'},{token:'e'.repeat(64)},{inputCatalogSha256:'d'.repeat(64)}])assert.equal((await gateRequest(f.env,'/offline-fence/acquire',{...acquire,...change})).status,409)
    const release={batchId:acquire.batchId,token,manifestSha256:'3'.repeat(64),acknowledgedManifestSha256:'3'.repeat(64)}
    assert.equal((await gateRequest(f.env,'/offline-fence/release',{...release,token:'e'.repeat(64)})).status,409)
    assert.equal((await gateRequest(f.env,'/offline-fence/release',{...release,acknowledgedManifestSha256:'4'.repeat(64)})).status,400)
    const bound=await(await gateRequest(f.env,'/offline-fence/release',release)).json();assert.equal(bound.released,false);assert.equal(bound.fence.phase,'held_for_handoff')
    assert.equal((await gateRequest(f.env,'/offline-fence/release',{...release,manifestSha256:'4'.repeat(64),acknowledgedManifestSha256:'4'.repeat(64)})).status,409)
    assert.equal((await gateRequest(f.env,'/fetch/acquire',{host:'test.edu.cn'})).status,429);assert.equal((await gateRequest(f.env,'/model/run',await modelInput())).status,429)
  }finally{f.db.sqlite.close()}
})
test('a fence acquired during model quota preflight prevents the final pre-send admission transaction',async()=>{
  let calls=0
  const f=makeEnv(async input=>{if(String(input).includes('token_plan')){assert.equal((await gateRequest(f.env,'/offline-fence/acquire',acquire)).status,200);return quotaResponse()}calls++;throw new Error('must never send')})
  try{
    await seed(f.env,seedInput());await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']})
    assert.equal((await gateRequest(f.env,'/model/run',await modelInput())).status,429);assert.equal(calls,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM maintenance_model_attempts').get()?.count,0)
  }finally{f.db.sqlite.close()}
})
