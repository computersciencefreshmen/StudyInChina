import { declineRefillDispatch, observeRefillDispatch, readRefillDispatchStatus } from './refill-dispatch'
import { REFILL_DISPATCH_TOKEN } from './refill-contract'
import { MaintenanceError, type MaintenanceEnv, type MaintenanceMessage } from './types'
import { HASH } from './util'

/** A Queue acknowledgement is safe only after a durable, bound delivery proof.
 * Pausing before claim is not a business failure and cannot reset model state. */
export async function closeRefillDeliveryBeforeClaim(env:MaintenanceEnv,message:MaintenanceMessage,reason:string):Promise<void>{
  if(!message.refill)return
  const {dispatchToken,epochSha256}=message.refill
  if(!HASH.test(message.jobId)||!REFILL_DISPATCH_TOKEN.test(dispatchToken)||!HASH.test(epochSha256))throw new MaintenanceError('invalid_refill_message')
  const result=await declineRefillDispatch(env,{jobId:message.jobId,dispatchToken,epochSha256,reason})
  if(result.declined)return
  // Duplicates may arrive after another consumer has started or finished. The
  // dispatcher checks actual D1 progress; a callback alone is never evidence.
  await observeRefillDispatch(env,dispatchToken,message.jobId)
  const row=(await readRefillDispatchStatus(env,dispatchToken)).entries.find(row=>row.jobId===message.jobId&&row.epochSha256===epochSha256)
  if(row?.status==='not_sent'||row?.status==='observed'&&(row.resolution==='job_progress'||row.resolution==='received_not_started'&&row.receivedNotStartedReceiptSha256))return
  throw new MaintenanceError('refill_wait_delivery_close_unproven',60)
}
