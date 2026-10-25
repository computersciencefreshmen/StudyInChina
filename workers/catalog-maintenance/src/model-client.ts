import type { MaintenanceEnv, ModelRequest, ModelResult } from './types'
import { MaintenanceError } from './types'
import { gateRequest, HASH, record } from './util'

/** All producer engines share the same account gate, STOP ledger and reservation protocol. */
export async function runGuardedModelRequest(env:MaintenanceEnv,input:ModelRequest):Promise<ModelResult> {
  const response=await gateRequest(env,'/model/run',input),result=record(await response.json())
  if(!response.ok||result?.ok!==true)throw new MaintenanceError(String(result?.error??'model_admission_unavailable'),response.status===429?Math.min(7*86400,Number(result?.retryAfter)||300):null)
  if(typeof result.attemptId!=='string'||typeof result.artifactKey!=='string'||!HASH.test(String(result.artifactSha256)))throw new MaintenanceError('model_result_receipt_invalid')
  return result as unknown as ModelResult
}
