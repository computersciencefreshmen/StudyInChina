import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { HASH } from './util'
import type { MaterialEngine } from './material-batch-contract'
type MaterialJobEnv=MaintenanceEnv&{MODEL_BATCH_CONTRACT_VERSION?:string}
const stageFor=(engine:MaterialEngine)=>engine==='program'?'extract':engine==='scholarship'?'award':'maintain'
const purposeFor=(engine:MaterialEngine)=>engine==='cycles'?'cycle-discovery':engine==='fields'?'field-maintenance':'identity'

/** Choose once per logical purpose. A configuration change is not a new paid
 * request: both v1 and v2 histories retain their original job/profile binding. */
function history(engine:MaterialEngine,sourceId:string,snapshotSha256:string){
  const stage=stageFor(engine),purpose=purposeFor(engine)
  // Classify purpose before filtering it: malformed/unknown maintain envelopes
  // cannot disappear from the cycle query and masquerade as a fresh scope.
  const sql=`WITH jobs AS (
    SELECT target_ids_json,CASE WHEN json_valid(target_ids_json) THEN target_ids_json ELSE 'null' END body
    FROM maintenance_jobs WHERE source_id=? AND snapshot_sha256=? AND stage=?
  ), classified AS (
    SELECT *,CASE WHEN ?<>'maintain' THEN 'identity'
      WHEN json_type(body)='array' THEN 'field-maintenance'
      WHEN json_type(body)='object' AND json_extract(body,'$.kind') IN('field-maintenance','cycle-discovery') THEN json_extract(body,'$.kind') ELSE NULL END purpose FROM jobs
  ), history AS (
    SELECT purpose,CASE
      WHEN target_ids_json IS NOT NULL AND NOT json_valid(target_ids_json) THEN 0
      WHEN json_type(body)='null' AND ?<>'maintain' THEN 1
      WHEN json_type(body)='array' AND ?='maintain' THEN 1
      WHEN json_type(body)='object' AND json_extract(body,'$.kind')='cycle-discovery'
        AND json_type(body,'$.contractVersion') IS NULL AND json_type(body,'$.targets')='array'
        AND (SELECT COUNT(*) FROM json_each(body))=2 THEN 1
      WHEN json_type(body)='object' AND json_type(body,'$.contractVersion')='integer' AND json_extract(body,'$.contractVersion')=2
        AND ((?<>'maintain' AND json_extract(body,'$.kind')='identity' AND (SELECT COUNT(*) FROM json_each(body))=2)
          OR (?='maintain' AND purpose IS NOT NULL AND json_type(body,'$.targets')='array' AND (SELECT COUNT(*) FROM json_each(body))=3
            AND json_array_length(body,'$.targets') BETWEEN 1 AND CASE WHEN purpose='cycle-discovery' THEN 5 ELSE 8 END)) THEN 2
      ELSE 0 END version FROM classified
  ), summary AS (SELECT COALESCE(MAX(version=1 AND purpose=?),0) v1,COALESCE(MAX(version=2 AND purpose=?),0) v2,
    COALESCE(MAX(version=0 AND (purpose=? OR purpose IS NULL)),0) invalid FROM history)`
  return{sql,bindings:[sourceId,snapshotSha256,stage,stage,stage,stage,stage,stage,purpose,purpose,purpose]}
}
const orphanSql=`SELECT 1 FROM maintenance_model_attempts a WHERE a.source_id=? AND a.snapshot_sha256=?
  AND NOT EXISTS(SELECT 1 FROM maintenance_jobs j WHERE j.source_id=a.source_id AND j.snapshot_sha256=a.snapshot_sha256 AND j.stage IN('extract','award','maintain')) LIMIT 1`
export async function materialJobVersion(env:MaterialJobEnv,sourceId:string,snapshotSha256:string,engine:MaterialEngine):Promise<1|2>{
  if(!HASH.test(sourceId)||!HASH.test(snapshotSha256))throw new MaintenanceError('material_batch_source_binding_invalid')
  const query=history(engine,sourceId,snapshotSha256),result=await env.PIPELINE_DB.prepare(`${query.sql} SELECT * FROM summary`).bind(...query.bindings).first<{v1:number;v2:number;invalid:number}>()
  if(!result||result.invalid||result.v1&&result.v2)throw new MaintenanceError('material_batch_history_requires_review')
  if(result.v1)return 1
  if(result.v2)return 2
  // An imported model reservation with no surviving job is not a fresh scope.
  const orphan=await env.PIPELINE_DB.prepare(orphanSql).bind(sourceId,snapshotSha256).first()
  if(orphan)throw new MaintenanceError('material_batch_orphan_history_requires_review')
  return env.MODEL_BATCH_CONTRACT_VERSION==='2'?2:1
}

/** Must execute before ANY material inserts in the same D1 atomic batch. This
 * closes a mixed-version rolling-deploy race after the optimistic version read. */
export function materialJobVersionGuard(env:MaintenanceEnv,guardId:string,sourceId:string,snapshotSha256:string,engine:MaterialEngine,version:1|2){
  const query=history(engine,sourceId,snapshotSha256)
  return env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(${query.sql}
    SELECT CASE WHEN invalid=0 AND NOT(v1 AND v2) AND ((?=1 AND v2=0) OR (?=2 AND v1=0))
      AND (v1 OR v2 OR NOT EXISTS(${orphanSql})) THEN 1 ELSE 0 END FROM summary))`)
    .bind(guardId,...query.bindings,version,version,sourceId,snapshotSha256)
}
