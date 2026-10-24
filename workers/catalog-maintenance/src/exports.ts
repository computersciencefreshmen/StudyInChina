import { exportContentSha256, maintenanceCandidateExportSchema, type CandidateExport, type MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { control, event } from './repository'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, ID, nowIso, record } from './util'

type ExportRow={batch_id:string;input_catalog_sha256:string;scope_sha256:string;object_key:string;sha256:string;created_at:string;status:'prepared'|'applied'|'published'|'rejected';acknowledgement_sha256:string|null;acknowledgement_json:string|null}
export async function readExport(env:MaintenanceEnv,id:string):Promise<CandidateExport> {
  if(!ID.test(id))throw new MaintenanceError('invalid_export_id')
  const row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_exports WHERE batch_id=?').bind(id).first<ExportRow>()
  if(!row)throw new MaintenanceError('export_not_found')
  const object=await env.SNAPSHOTS_BUCKET.get(row.object_key)
  if(!object||object.size!==undefined&&object.size>4*1024*1024)throw new MaintenanceError('export_artifact_unavailable')
  const batch=maintenanceCandidateExportSchema.parse(JSON.parse(await object.text()))
  if(batch.sha256!==row.sha256||await exportContentSha256(batch)!==row.sha256)throw new MaintenanceError('export_checksum_mismatch')
  return batch
}
export async function prepareExport(env:MaintenanceEnv,value:unknown):Promise<{batchId:string;sha256:string;proposalCount:number;reused:boolean}> {
  const raw=record(value),limit=raw?.limit??50
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>100)throw new MaintenanceError('invalid_export_limit')
  const cfg=await control(env)
  if(!cfg?.seed_complete)throw new MaintenanceError('seed_not_ready')
  const pending=await env.PIPELINE_DB.prepare("SELECT batch_id FROM maintenance_exports WHERE status='prepared' ORDER BY created_at LIMIT 1").first<{batch_id:string}>()
  if(pending){const batch=await readExport(env,pending.batch_id);return{batchId:batch.batchId,sha256:batch.sha256,proposalCount:batch.proposals.length,reused:true}}
  await env.PIPELINE_DB.prepare("UPDATE maintenance_proposals SET status='held' WHERE status='ready' AND EXISTS(SELECT 1 FROM maintenance_sources s WHERE s.source_id=maintenance_proposals.source_id AND s.raw_sha256 IS NOT NULL AND s.raw_sha256<>maintenance_proposals.snapshot_sha256)").run()
  const available=(await env.PIPELINE_DB.prepare("SELECT proposal_id,proposal_json FROM maintenance_proposals WHERE status='ready' ORDER BY created_at,proposal_id LIMIT 1000").all<{proposal_id:string;proposal_json:string}>()).results??[]
  if(!available.length)throw new MaintenanceError('no_ready_proposals')
  const rows:typeof available=[],schools=new Set<string>()
  for(const row of available){const proposal=JSON.parse(row.proposal_json)as MaintenanceProposal;if(!schools.has(proposal.universityId)&&schools.size>=20)continue;schools.add(proposal.universityId);rows.push(row);if(rows.length>=Number(limit))break}
  const last=await env.PIPELINE_DB.prepare('SELECT MAX(created_at) created_at FROM maintenance_exports').first<{created_at:string|null}>()
  const urgent=rows.some(row=>{const proposal=JSON.parse(row.proposal_json)as MaintenanceProposal,patches=record(proposal.fields)?.patches;return proposal.operation==='patch'&&Date.now()-Date.parse(proposal.source.checkedAt)<=3*86400000&&Array.isArray(patches)&&patches.some(value=>{const patch=record(value);if(!patch||!['deadline','closesOn'].includes(String(patch.fieldPath))||typeof patch.value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(patch.value))return false;const cutoff=Date.parse(`${patch.value}T23:59:59+08:00`),remaining=cutoff-Date.now();return remaining>=0&&remaining<=7*86400000})})
  if(last?.created_at&&Date.now()-Date.parse(last.created_at)<2*3600000&&!urgent)throw new MaintenanceError('export_cadence_wait')
  const batchId=`maintenance-${crypto.randomUUID()}`,createdAt=nowIso(),proposals=rows.map(r=>JSON.parse(r.proposal_json)as MaintenanceProposal)
  const content:Omit<CandidateExport,'sha256'>={format:'studyinchina.maintenance-candidate-export',formatVersion:1,batchId,inputCatalogSha256:cfg.input_catalog_sha256,scopeRegistrySha256:cfg.scope_sha256,createdAt,proposals}
  const batch=maintenanceCandidateExportSchema.parse({...content,sha256:await exportContentSha256(content)})
  const objectKey=`maintenance/exports/${batchId}/${batch.sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(objectKey,canonical(batch),{httpMetadata:{contentType:'application/json'}})
  const guardId=crypto.randomUUID()
  const selectedIds=JSON.stringify(rows.map(row=>row.proposal_id))
  const statements=[env.PIPELINE_DB.prepare("INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND input_catalog_sha256=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM maintenance_exports WHERE status='prepared') AND (SELECT COUNT(*) FROM maintenance_proposals p JOIN json_each(?) chosen ON chosen.value=p.proposal_id LEFT JOIN maintenance_sources s ON s.source_id=p.source_id WHERE p.status='ready' AND (s.raw_sha256 IS NULL OR s.raw_sha256=p.snapshot_sha256))=? THEN 1 ELSE 0 END))").bind(guardId,cfg.input_catalog_sha256,cfg.revision,selectedIds,rows.length),env.PIPELINE_DB.prepare("INSERT INTO maintenance_exports(batch_id,input_catalog_sha256,scope_sha256,object_key,sha256,created_at,status) VALUES(?,?,?,?,?,?,'prepared')").bind(batchId,cfg.input_catalog_sha256,cfg.scope_sha256,objectKey,batch.sha256,createdAt),
    ...rows.map(row=>env.PIPELINE_DB.prepare("UPDATE maintenance_proposals SET status='exported',export_id=? WHERE proposal_id=? AND status='ready' AND EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=?)").bind(batchId,row.proposal_id,batchId))]
  statements.push(env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId))
  const results=await env.PIPELINE_DB.batch(statements)
  if(results.some(result=>result.meta?.changes!==1))throw new MaintenanceError('export_claim_conflict')
  await event(env,'export_prepared',{batchId,sha256:batch.sha256,proposalCount:proposals.length})
  return{batchId,sha256:batch.sha256,proposalCount:proposals.length,reused:false}
}
export async function acknowledge(env:MaintenanceEnv,value:unknown) {
  const raw=record(value)
  if(!raw||!ID.test(String(raw.batchId))||!['applied','published','rejected'].includes(String(raw.outcome))||!HASH.test(String(raw.receiptSha256))||!HASH.test(String(raw.newInputCatalogSha256))||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(String(raw.sourceCommit))||!Array.isArray(raw.acceptedProposalIds)||!Array.isArray(raw.heldProposalIds)||[...raw.acceptedProposalIds,...raw.heldProposalIds].some(id=>typeof id!=='string'||!ID.test(id)))throw new MaintenanceError('invalid_acknowledgement')
  const row=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_exports WHERE batch_id=?').bind(raw.batchId).first<ExportRow>(),cfg=await control(env)
  if(!row||!cfg)throw new MaintenanceError('export_not_found')
  const batch=await readExport(env,row.batch_id),accepted=raw.acceptedProposalIds as string[],held=raw.heldProposalIds as string[],ids=[...accepted,...held]
  if(new Set(ids).size!==ids.length||ids.length!==batch.proposals.length||ids.some(id=>!batch.proposals.some(proposal=>proposal.id===id)))throw new MaintenanceError('acknowledgement_partition_mismatch')
  const ack={batchId:row.batch_id,outcome:String(raw.outcome),receiptSha256:String(raw.receiptSha256),sourceCommit:String(raw.sourceCommit),newInputCatalogSha256:String(raw.newInputCatalogSha256),acceptedProposalIds:[...accepted].sort(),heldProposalIds:[...held].sort(),deploymentId:typeof raw.deploymentId==='string'?raw.deploymentId:null,stableProofSha256:typeof raw.stableProofSha256==='string'?raw.stableProofSha256:null}
  if(ack.outcome==='published'&&(!ack.deploymentId||!/^dpl_[a-zA-Z0-9]{1,100}$/.test(ack.deploymentId)||!HASH.test(ack.stableProofSha256??'')))throw new MaintenanceError('stable_publication_proof_required')
  const sha256=await digest(canonical(ack))
  if(row.acknowledgement_sha256===sha256)return{ok:true,reused:true,outcome:row.status}
  if(ack.outcome==='published') {
    const prior=row.acknowledgement_json?record(JSON.parse(row.acknowledgement_json)):null
    if(row.status!=='applied'||!prior||prior.receiptSha256!==ack.receiptSha256||prior.sourceCommit!==ack.sourceCommit||prior.newInputCatalogSha256!==ack.newInputCatalogSha256||canonical(prior.acceptedProposalIds)!==canonical(ack.acceptedProposalIds)||canonical(prior.heldProposalIds)!==canonical(ack.heldProposalIds))throw new MaintenanceError('published_ack_must_match_applied_commit')
  } else if(row.status!=='prepared'||cfg.input_catalog_sha256!==row.input_catalog_sha256)throw new MaintenanceError('acknowledgement_base_or_state_conflict')
  if(ack.outcome==='rejected'&&(accepted.length||ack.newInputCatalogSha256!==row.input_catalog_sha256))throw new MaintenanceError('rejected_export_cannot_change_catalogue')
  const guardId=crypto.randomUUID()
  const statements=[env.PIPELINE_DB.prepare('INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_exports WHERE batch_id=? AND status=?) AND EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND input_catalog_sha256=?) THEN 1 ELSE 0 END))').bind(guardId,row.batch_id,row.status,cfg.revision,cfg.input_catalog_sha256),env.PIPELINE_DB.prepare('UPDATE maintenance_exports SET status=?,acknowledgement_sha256=?,acknowledgement_json=? WHERE batch_id=? AND status=?').bind(ack.outcome,sha256,canonical(ack),row.batch_id,row.status)]
  if(ack.outcome!=='published') {
    for(const id of accepted)statements.push(env.PIPELINE_DB.prepare("UPDATE maintenance_proposals SET status='consumed',acknowledgement_sha256=? WHERE proposal_id=? AND export_id=? AND status='exported'").bind(sha256,id,row.batch_id))
    for(const id of held)statements.push(env.PIPELINE_DB.prepare("UPDATE maintenance_proposals SET status='held',acknowledgement_sha256=? WHERE proposal_id=? AND export_id=? AND status='exported'").bind(sha256,id,row.batch_id))
    statements.push(env.PIPELINE_DB.prepare('UPDATE maintenance_control SET input_catalog_sha256=?,targets_complete=CASE WHEN ?=\'applied\' THEN 0 ELSE targets_complete END,revision=revision+1,updated_at=? WHERE singleton=1 AND input_catalog_sha256=? AND revision=?').bind(ack.newInputCatalogSha256,ack.outcome,nowIso(),row.input_catalog_sha256,cfg.revision))
  }
  statements.push(env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId))
  const results=await env.PIPELINE_DB.batch(statements)
  if(results.some(result=>result.meta?.changes!==1))throw new MaintenanceError('acknowledgement_write_conflict')
  await event(env,`export_${ack.outcome}`,{batchId:row.batch_id,acknowledgementSha256:sha256,sourceCommit:ack.sourceCommit,deploymentId:ack.deploymentId,stableProofSha256:ack.stableProofSha256})
  return{ok:true,reused:false,outcome:ack.outcome,acknowledgementSha256:sha256}
}
