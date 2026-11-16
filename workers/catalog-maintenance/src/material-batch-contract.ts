import type { JobRow } from './types'
import { MaintenanceError } from './types'
import { canonical,digest,HASH,record } from './util'

export type MaterialEngine='program'|'scholarship'|'fields'|'cycles'
export type MaterialPin={id:string;sha256:string}
export const MATERIAL_BATCH_LIMITS={program:10,scholarship:10,fields:8,cycles:5}as const
const kind=(engine:MaterialEngine)=>engine==='cycles'?'cycle-discovery':engine==='fields'?'field-maintenance':'identity'
/** Version selection belongs to creation of a genuinely new logical job. Never
 * retrofit an existing v1 job or use a v2 key to retry an old paid scope. */
export function materialBatchEnvelope(engine:MaterialEngine,pins:MaterialPin[]=[]){
  return{kind:kind(engine),contractVersion:2,...(engine==='fields'||engine==='cycles'?{targets:pins}:{})}
}
export async function materialBatchJobId(input:{engine:MaterialEngine;sourceId:string;snapshotSha256:string;createdAt:string;pins?:MaterialPin[];version:1|2}):Promise<string>{
  const{engine,sourceId,snapshotSha256,createdAt,version}=input,pins=input.pins??[]
  if(engine==='fields')return digest(`maintain:${sourceId}:${snapshotSha256}:${createdAt.slice(0,10)}:${canonical(pins)}:fields-v${version}`)
  if(engine==='cycles')return digest(`cycle-discovery:${sourceId}:${snapshotSha256}:${canonical(pins)}:v${version}`)
  return digest(`${engine==='program'?'extract':'award'}:${sourceId}:${snapshotSha256}:identity-v${version}`)
}
export async function readMaterialBatchContract(job:JobRow,engine:MaterialEngine,targets?:ReadonlyArray<{entityType:string;recordId:string;recordScopeSha256:string}>):Promise<1|2>{
  if(!job.target_ids_json)return 1
  let value:unknown;try{value=JSON.parse(job.target_ids_json)}catch{throw new MaintenanceError('material_batch_contract_invalid')}
  const scope=record(value)
  if(!scope||scope.contractVersion===undefined)return 1
  const hasTargets=engine==='fields'||engine==='cycles'
  if(scope.contractVersion!==2||scope.kind!==kind(engine)||Object.keys(scope).sort().join(',')!==(hasTargets?'contractVersion,kind,targets':'contractVersion,kind'))throw new MaintenanceError('material_batch_contract_invalid')
  const pins=hasTargets?scope.targets:[]
  if(!Array.isArray(pins)||hasTargets&&(!pins.length||pins.length>MATERIAL_BATCH_LIMITS[engine])||pins.some(pin=>!record(pin)||Object.keys(pin).sort().join(',')!=='id,sha256'||typeof pin.id!=='string'||!pin.id||!HASH.test(String(pin.sha256)))||new Set(pins.map(pin=>pin.id)).size!==pins.length)throw new MaintenanceError('material_batch_contract_invalid')
  if(!job.snapshot_sha256||!HASH.test(job.snapshot_sha256)||!job.created_at||!Number.isFinite(Date.parse(job.created_at))
    ||job.stage!==(engine==='fields'||engine==='cycles'?'maintain':engine==='program'?'extract':'award')
    ||job.job_id!==await materialBatchJobId({engine,sourceId:job.source_id,snapshotSha256:job.snapshot_sha256,createdAt:job.created_at,pins,version:2}))throw new MaintenanceError('material_batch_job_binding_invalid')
  if(hasTargets&&targets&&(targets.length!==pins.length||targets.some(target=>!pins.some(pin=>pin.id===`${target.entityType}:${target.recordId}`&&pin.sha256===target.recordScopeSha256))))throw new MaintenanceError('material_batch_target_scope_changed')
  return 2
}
