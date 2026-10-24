import { maintenanceProposalSchema,type MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { coalesceOperations,type SqlOperation } from './sql-plan'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical,nowIso } from './util'

/** Commit a complete bounded engine result atomically. Ten rows use only 70
 * bindings, so a 100-proposal catalogue consumes ten D1 queries, not 100. */
export async function persistProposals(env:MaintenanceEnv,proposals:MaintenanceProposal[],sourceId:string,snapshotSha256:string):Promise<void>{
  if(proposals.length>100)throw new MaintenanceError('proposal_batch_requires_partition')
  const ids=new Set<string>(),createdAt=nowIso(),operations:SqlOperation[]=[]
  for(const proposal of proposals){
    maintenanceProposalSchema.parse(proposal)
    if(ids.has(proposal.id)||proposal.source.id!==sourceId||proposal.source.snapshotSha256!==snapshotSha256)throw new MaintenanceError('proposal_batch_binding_invalid')
    ids.add(proposal.id)
    operations.push({sql:'INSERT OR IGNORE INTO maintenance_proposals(proposal_id,university_id,source_id,snapshot_sha256,status,proposal_json,created_at) VALUES(?,?,?,?,?,?,?)',values:[proposal.id,proposal.universityId,sourceId,snapshotSha256,proposal.status,canonical(proposal),createdAt]})
  }
  const grouped:SqlOperation[]=[]
  for(let offset=0;offset<operations.length;offset+=10)grouped.push(...coalesceOperations(operations.slice(offset,offset+10)))
  if(grouped.length)await env.PIPELINE_DB.batch(grouped.map(operation=>env.PIPELINE_DB.prepare(operation.sql).bind(...operation.values)))
}
