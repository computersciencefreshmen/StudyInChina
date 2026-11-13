export const BUDGET_POLICY_KEY='maintenance/runtime/cloudflare-budget-policy.v1.json'
export const BUDGET_OBSERVATION_KEY='maintenance/runtime/cloudflare-budget-observation.v1.json'
export const BACKGROUND_BUDGET_RETRY_SECONDS=3600

export type BudgetPolicy={
  format:'studyinchina.cloudflare-budget-policy';version:1;accountId:string;
  baseMicroDollars:number;totalMicroDollars:number;pauseAtMicroDollars:number;maxAgeSeconds:number;sha256:string
}
export type BudgetObservation={
  format:'studyinchina.cloudflare-budget-observation';version:1;policySha256:string;state:'ready'|'paused'|'unknown';
  observedAt:string;periodStart:string|null;periodEnd:null;usageMicroDollars:number|null;totalMicroDollars:number|null;code:string
}
export type BudgetStateBucket={get(key:string):Promise<{text():Promise<string>;size?:number}|null>}
export type BackgroundBudgetGate={allowed:boolean;state:'unconfigured'|'ready'|'paused'|'unknown';code:string;policySha256:string|null}

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)
const money=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
function exactKeys(value:Record<string,unknown>,keys:string[]) {return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))}
function instant(value:unknown):number|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value))return null
  const at=Date.parse(value)
  return Number.isFinite(at)&&new Date(at).toISOString().slice(0,19)===value.slice(0,19)?at:null
}
function period(value:unknown):boolean {
  if(value===null)return true
  if(typeof value!=='string')return false
  if(instant(value)!==null)return true
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(value))return false
  const at=Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value
}

/** Shared canonical form keeps the monitor and every reader on the same hash.
 * Invalid values get a fixed error; billing/account payloads never enter errors. */
export function budgetCanonicalJson(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value)
  if(Array.isArray(value))return`[${value.map(budgetCanonicalJson).join(',')}]`
  const row=object(value)
  if(row)return`{${Object.keys(row).sort().map(key=>`${JSON.stringify(key)}:${budgetCanonicalJson(row[key])}`).join(',')}}`
  throw new Error('budget_canonical_value_invalid')
}
export async function budgetPolicySha256(value:Omit<BudgetPolicy,'sha256'>):Promise<string> {
  const row={...value} as Record<string,unknown>
  delete row.sha256
  const bytes=new TextEncoder().encode(budgetCanonicalJson(row))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
}
export async function validateBudgetPolicy(value:unknown):Promise<BudgetPolicy> {
  const row=object(value)
  if(!row||!exactKeys(row,['format','version','accountId','baseMicroDollars','totalMicroDollars','pauseAtMicroDollars','maxAgeSeconds','sha256'])
    ||row.format!=='studyinchina.cloudflare-budget-policy'||row.version!==1||typeof row.accountId!=='string'||!/^[a-f0-9]{32}$/iu.test(row.accountId)
    ||row.baseMicroDollars!==5000000||row.totalMicroDollars!==10000000||row.pauseAtMicroDollars!==9000000||row.maxAgeSeconds!==7200||!hash(row.sha256))
    throw new Error('budget_policy_invalid')
  const policy=row as BudgetPolicy
  if(await budgetPolicySha256(policy)!==policy.sha256)throw new Error('budget_policy_invalid')
  return policy
}
/** Shape validation is separate from freshness so the monitor can preserve an
 * older paused observation. Only the reader below may authorize new work. */
export function parseBudgetObservation(value:unknown):BudgetObservation {
  const row=object(value)
  if(!row||!exactKeys(row,['format','version','policySha256','state','observedAt','periodStart','periodEnd','usageMicroDollars','totalMicroDollars','code'])
    ||row.format!=='studyinchina.cloudflare-budget-observation'||row.version!==1||!hash(row.policySha256)
    ||!['ready','paused','unknown'].includes(String(row.state))||instant(row.observedAt)===null||!period(row.periodStart)||row.periodEnd!==null
    ||row.usageMicroDollars!==null&&!money(row.usageMicroDollars)||row.totalMicroDollars!==null&&!money(row.totalMicroDollars)
    ||typeof row.code!=='string'||!/^[a-z][a-z0-9_]{0,79}$/u.test(row.code))throw new Error('budget_observation_invalid')
  return row as BudgetObservation
}

const missingArtifact=Symbol('budget_artifact_missing')
async function boundedJson(bucket:BudgetStateBucket,key:string) {
  const value=await bucket.get(key)
  if(!value)return missingArtifact
  if(value.size!==undefined&&value.size>4096)throw new Error('budget_artifact_invalid')
  const text=await value.text()
  if(new TextEncoder().encode(text).byteLength>4096)throw new Error('budget_artifact_invalid')
  return JSON.parse(text) as unknown
}
/** Read-only, fail-closed admission for background work. It never touches D1,
 * operator controls, reservations, models or the observation itself. */
export async function readBackgroundBudgetGate(bucket?:BudgetStateBucket,now=Date.now()):Promise<BackgroundBudgetGate> {
  const closed=(code:string,policySha256:string|null=null):BackgroundBudgetGate=>({allowed:false,state:'unknown',code,policySha256})
  const unconfigured:BackgroundBudgetGate={allowed:true,state:'unconfigured',code:'budget_unconfigured',policySha256:null}
  if(!bucket)return unconfigured
  let raw:unknown
  try{raw=await boundedJson(bucket,BUDGET_POLICY_KEY)}catch{return closed('budget_policy_unavailable')}
  if(raw===missingArtifact)return unconfigured
  let policy:BudgetPolicy
  try{policy=await validateBudgetPolicy(raw)}catch{return closed('budget_policy_invalid')}
  let observation:BudgetObservation
  try{
    raw=await boundedJson(bucket,BUDGET_OBSERVATION_KEY)
    if(raw===missingArtifact)return closed('budget_observation_missing',policy.sha256)
    observation=parseBudgetObservation(raw)
  }catch{return closed('budget_observation_invalid',policy.sha256)}
  if(observation.policySha256!==policy.sha256)return closed('budget_policy_changed',policy.sha256)
  const observed=instant(observation.observedAt)!
  if(!Number.isFinite(now)||observed>now)return closed('budget_observation_future',policy.sha256)
  if(now-observed>policy.maxAgeSeconds*1000)return closed('budget_observation_stale',policy.sha256)
  if(observation.periodStart!==null&&Date.parse(observation.periodStart)>observed)return closed('budget_period_invalid',policy.sha256)
  if(observation.state==='paused')return{allowed:false,state:'paused',code:'budget_paused',policySha256:policy.sha256}
  if(observation.state!=='ready')return closed('budget_observation_unknown',policy.sha256)
  if(observation.periodStart===null)return closed('budget_period_unconfirmed',policy.sha256)
  const usage=observation.usageMicroDollars,total=observation.totalMicroDollars
  if(usage===null||total===null||!Number.isSafeInteger(policy.baseMicroDollars+usage)||total!==policy.baseMicroDollars+usage)
    return closed('budget_total_unconfirmed',policy.sha256)
  if(total>=policy.pauseAtMicroDollars)return{allowed:false,state:'paused',code:'budget_threshold_reached',policySha256:policy.sha256}
  return{allowed:true,state:'ready',code:'budget_ready',policySha256:policy.sha256}
}
