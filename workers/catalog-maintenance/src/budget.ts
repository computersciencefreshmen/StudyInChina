import { BUDGET_POLICY_KEY, BUDGET_OBSERVATION_KEY, budgetCanonicalJson, budgetPolicySha256,
  validateBudgetPolicy, parseBudgetObservation, readBackgroundBudgetGate,
  type BudgetPolicy, type BudgetObservation } from '../../shared/background-budget'
import { readCloudflareBillingUsage } from './billing-usage'
import { MaintenanceError, type MaintenanceEnv } from './types'
import { digest, nowIso, record } from './util'

const options={httpMetadata:{contentType:'application/json'}}
const CACHE_MS=3600000

async function read(env:MaintenanceEnv,key:string){
  const object=await env.SNAPSHOTS_BUCKET.get(key)
  if(!object)return null
  if(object.size!==undefined&&object.size>4096)throw new MaintenanceError('budget_artifact_unavailable')
  const text=await object.text()
  if(new TextEncoder().encode(text).byteLength>4096)throw new MaintenanceError('budget_artifact_unavailable')
  return{object,text,value:JSON.parse(text)as unknown}
}
async function policy(env:MaintenanceEnv):Promise<BudgetPolicy|null>{
  const saved=await read(env,BUDGET_POLICY_KEY)
  return saved?validateBudgetPolicy(saved.value):null
}
async function immutable(env:MaintenanceEnv,key:string,text:string){
  const old=await read(env,key)
  if(old){if(old.text!==text)throw new MaintenanceError('budget_receipt_conflict');return}
  await env.SNAPSHOTS_BUCKET.put(key,text,{...options,onlyIf:{etagDoesNotMatch:'*'}})
  if((await read(env,key))?.text!==text)throw new MaintenanceError('budget_receipt_unconfirmed')
}

/** Public workflow output contains policy amounts supplied by the owner, not
 * actual account spending or the private financial API response. */
export async function budgetStatus(env:MaintenanceEnv,now=Date.now()){
  return{format:'studyinchina.cloudflare-budget-state',version:1,observedAt:nowIso(now),
    ...await readBackgroundBudgetGate(env.SNAPSHOTS_BUCKET,now),baseUsd:5,targetUsd:10,pauseAtUsd:9,
    billingTokenConfigured:Boolean(env.CLOUDFLARE_BILLING_READ_TOKEN),modelCallsPerformed:false,operatorFlagsChanged:false}
}
export async function configureBudget(env:MaintenanceEnv,value:unknown,now=Date.now()){
  const input=record(value)
  if(!input||Object.keys(input).length!==4||typeof input.accountId!=='string'||!/^[a-f0-9]{32}$/iu.test(input.accountId)
    ||input.baseUsd!==5||input.targetUsd!==10||input.pauseAtUsd!==9)throw new MaintenanceError('budget_configuration_invalid')
  const content:Omit<BudgetPolicy,'sha256'>={format:'studyinchina.cloudflare-budget-policy',version:1,
    accountId:input.accountId.toLowerCase(),baseMicroDollars:5000000,totalMicroDollars:10000000,
    pauseAtMicroDollars:9000000,maxAgeSeconds:7200}
  const configured:BudgetPolicy={...content,sha256:await budgetPolicySha256(content)}
  await immutable(env,BUDGET_POLICY_KEY,budgetCanonicalJson(configured))
  return{...await budgetStatus(env,now),configured:true,policySha256:configured.sha256}
}

/** Refresh actual official rated usage once an hour. Unknown is never zero.
 * A threshold pause remains sticky across periods until an explicit resume
 * obtains a fresh under-threshold observation. Existing operator flags remain
 * independent, so a budget refresh cannot undo an operator's manual pause. */
export async function checkBudget(env:MaintenanceEnv,fetcher:typeof fetch=fetch,now=Date.now(),resume=false){
  let configured:BudgetPolicy|null
  try{configured=await policy(env)}catch{return{...await budgetStatus(env,now),allowed:false,state:'unknown',cached:false,code:'budget_policy_invalid'}}
  if(!configured)return{...await budgetStatus(env,now),cached:false}
  let previous:Awaited<ReturnType<typeof read>>
  let prior:BudgetObservation|null=null
  try{
    previous=await read(env,BUDGET_OBSERVATION_KEY)
    if(previous){prior=parseBudgetObservation(previous.value);if(prior.policySha256!==configured.sha256)prior=null}
  }catch{return{...await budgetStatus(env,now),allowed:false,state:'unknown',cached:false,code:'budget_observation_invalid'}}
  const age=prior?now-Date.parse(prior.observedAt):Infinity
  if(!resume&&prior&&prior.state!=='unknown'&&age>=0&&age<CACHE_MS)
    return{...await budgetStatus(env,now),cached:true}
  const billing=await readCloudflareBillingUsage({CLOUDFLARE_ACCOUNT_ID:configured.accountId,
    CLOUDFLARE_BILLING_READ_TOKEN:env.CLOUDFLARE_BILLING_READ_TOKEN},fetcher,now)
  for(let attempt=0;attempt<3;attempt++){
    // Re-read before the CAS: a slower low-spend response must not undo a
    // concurrently observed pause or a newer observation.
    let current:Awaited<ReturnType<typeof read>>,latest:BudgetObservation|null=null
    try{
      current=await read(env,BUDGET_OBSERVATION_KEY)
      if(current){latest=parseBudgetObservation(current.value);if(latest.policySha256!==configured.sha256)latest=null}
    }catch{return{...await budgetStatus(env,now),allowed:false,state:'unknown',cached:false,code:'budget_observation_invalid'}}
    if(latest&&Date.parse(latest.observedAt)>now)return{...await budgetStatus(env,now),cached:false,code:'budget_observation_newer'}
    const sticky=latest?.state==='paused'
    if(sticky&&billing.state==='unknown')return{...await budgetStatus(env,now),cached:false,billingCode:billing.code}
    const total=billing.state==='observed'?configured.baseMicroDollars+billing.usageMicroDollars:null
    const threshold=total!==null&&total>=configured.pauseAtMicroDollars
    const state:BudgetObservation['state']=threshold||sticky&&!resume?'paused':billing.state==='observed'?'ready':'unknown'
    const code=threshold?'budget_threshold_reached':sticky&&!resume?'budget_resume_required':billing.state==='observed'?'budget_within_target':billing.code
    const observation:BudgetObservation={format:'studyinchina.cloudflare-budget-observation',version:1,
      policySha256:configured.sha256,state,observedAt:nowIso(now),
      periodStart:billing.state==='observed'?billing.periodStart:null,periodEnd:null,
      usageMicroDollars:billing.state==='observed'?billing.usageMicroDollars:null,totalMicroDollars:total,code}
    const text=budgetCanonicalJson(observation),receiptSha256=await digest(text)
    const receiptKey=`maintenance/runtime/budget-observations/${receiptSha256}.json`
    try{
      await immutable(env,receiptKey,text)
      if(current&&!current.object.etag)throw new MaintenanceError('budget_etag_unavailable')
      const saved=await env.SNAPSHOTS_BUCKET.put(BUDGET_OBSERVATION_KEY,text,{...options,
        onlyIf:current?.object.etag?{etagMatches:current.object.etag}:{etagDoesNotMatch:'*'}})
      if(saved===null)continue
      if((await read(env,BUDGET_OBSERVATION_KEY))?.text!==text)continue
      return{...await budgetStatus(env,now),cached:false,receiptKey,receiptSha256,
        ...(billing.state==='unknown'?{billingCode:billing.code}:{})}
    }catch{return{...await budgetStatus(env,now),allowed:false,state:'unknown',cached:false,code:'budget_observation_not_persisted'}}
  }
  return{...await budgetStatus(env,now),allowed:false,state:'unknown',cached:false,code:'budget_observation_conflict'}
}
export async function resumeBudget(env:MaintenanceEnv,value:unknown,fetcher:typeof fetch=fetch,now=Date.now()){
  const input=record(value)
  if(!input||Object.keys(input).length!==1||input.reason!=='operator-confirmed-budget-resume')throw new MaintenanceError('budget_resume_reason_invalid')
  return checkBudget(env,fetcher,now,true)
}
