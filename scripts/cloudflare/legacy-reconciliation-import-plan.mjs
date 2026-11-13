import { createHash } from 'node:crypto'

// This single historical reconciliation imports provenance and candidates, not
// its abandoned queue. Table and column identifiers never come from the caller.
const TABLES = {
  maintenance_sources: {
    keys: ['source_id'],
    columns: ['source_id','url','allowed_hosts_json','category','categories_json','enabled','interval_hours','due_at','last_attempt_at','last_success_at','raw_sha256','canonical_sha256','snapshot_key','etag','failures','error_code','discovery_depth'],
  },
  maintenance_source_schools: { keys: ['source_id','university_id'], columns: ['source_id','university_id'] },
  maintenance_model_attempts: {
    keys: ['attempt_id'],
    columns: ['reservation_key','attempt_id','source_id','snapshot_sha256','pass','request_sha256','model','status','started_at','completed_at','output_key','output_sha256','usage_json','quota_json','error_code'],
  },
  maintenance_document_derivatives: {
    keys: ['source_id','raw_sha256'],
    columns: ['source_id','raw_sha256','snapshot_key','raw_key','text_key','text_sha256','parser','page_count','processed_at'],
  },
  maintenance_proposals: {
    keys: ['proposal_id'],
    columns: ['proposal_id','university_id','source_id','snapshot_sha256','status','proposal_json','created_at','export_id','acknowledgement_sha256'],
  },
}
const CATEGORY_MERGES = new Set([
  '0ce2737c2561b9dc7c653d427f242a6f2516fe265c8f929e03b0a60a8446238c',
  'f46c802b7ac35f19f572192d983565fe7414ff645ec75444724b6b949b6516a2',
])
const SOURCE_IDENTITY = ['source_id','url','allowed_hosts_json','category','enabled','interval_hours','discovery_depth']
const COUNTS = { maintenance_sources: 93, maintenance_source_schools: 93, maintenance_model_attempts: 171, maintenance_document_derivatives: 18, maintenance_proposals: 150 }
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex')
const same = (a,b) => canonical(a) === canonical(b)
const fail = code => { throw Error('legacy_import_' + code) }
const quote = s => '"' + s + '"'
function shape(table, row) {
  const schema = TABLES[table]
  if (!schema || !row || typeof row !== 'object' || Object.keys(row).length !== schema.columns.length
    || schema.columns.some(c => !Object.hasOwn(row,c) || row[c] !== null && !['string','number'].includes(typeof row[c])
      || typeof row[c] === 'number' && (!Number.isFinite(row[c]) || Object.is(row[c],-0)))) fail('fixed_row_schema_invalid')
  if (schema.keys.some(c => typeof row[c] !== 'string' || !row[c])) fail('primary_key_invalid')
  return schema
}
export function readStatement(table, row) {
  const schema = shape(table,row)
  return { sql: `SELECT ${schema.columns.map(quote).join(',')} FROM ${quote(table)} WHERE ${schema.keys.map(k => quote(k)+' IS ?').join(' AND ')}`, params: schema.keys.map(k=>row[k]) }
}
// Bound parameters carry data. Full-row CAS protects both an interrupted retry
// and a concurrent change; callers must verify exact after-values after a write.
export function writeStatement(operation) {
  const {table,before,after} = operation, schema = shape(table,after)
  if (before === null) return {
    sql: `INSERT INTO ${quote(table)} (${schema.columns.map(quote).join(',')}) SELECT ${schema.columns.map(()=>'?').join(',')} WHERE NOT EXISTS (SELECT 1 FROM ${quote(table)} WHERE ${schema.keys.map(k=>quote(k)+' IS ?').join(' AND ')})`,
    params: [...schema.columns.map(c=>after[c]),...schema.keys.map(k=>after[k])],
  }
  shape(table,before)
  if (schema.keys.some(k=>before[k]!==after[k])) fail('primary_key_rewrite')
  return { sql: `UPDATE ${quote(table)} SET ${schema.columns.map(c=>quote(c)+'=?').join(',')} WHERE ${schema.columns.map(c=>quote(c)+' IS ?').join(' AND ')}`,
    params: [...schema.columns.map(c=>after[c]),...schema.columns.map(c=>before[c])] }
}
export async function buildImportPlan({manifest, classification, readRow, findAttempts}) {
  if (manifest?.batchId !== 'offline-d242a859-d2b9-42d6-b2bc-e26584294097' || !manifest.tableRows
    || !Array.isArray(classification) || classification.length !== 150) fail('pinned_batch_required')
  const decisions = new Map(classification.map(v=>[v.proposalId,v]))
  if (decisions.size !== 150) fail('duplicate_classification')
  const operations=[], preserved=[], categoryMerges=[]
  const outcomes={completed:0,unknown:0,known_failed:0}, proposals={ready:0,held:0}
  for (const [table,schema] of Object.entries(TABLES)) {
    const rows=manifest.tableRows[table]
    if (!Array.isArray(rows) || rows.length !== COUNTS[table]) fail('historical_count_changed')
    const keys = new Set()
    for (const original of rows) {
      shape(table,original)
      const key=canonical(schema.keys.map(c=>original[c])); if(keys.has(key))fail('duplicate_historical_key');keys.add(key)
      const before=await readRow(table,original) ?? null
      if(before)shape(table,before)
      let after={...original}
      if(table==='maintenance_sources' && before && !same(before,original)) {
        if(SOURCE_IDENTITY.some(c=>!same(before[c],original[c])))fail('source_identity_conflict')
        for(const c of ['last_attempt_at','last_success_at']) if(before[c]!==null && (original[c]===null || original[c]<before[c]))fail('newer_source_evidence_present')
        if(before.categories_json!==original.categories_json) {
          const old=JSON.parse(before.categories_json),next=JSON.parse(original.categories_json)
          if(!CATEGORY_MERGES.has(original.source_id) || !Array.isArray(old) || !Array.isArray(next)
            || old.some(c=>!next.includes(c)) || next.some(c=>typeof c!=='string') || new Set(next).size!==next.length)fail('unreviewed_source_categories')
          categoryMerges.push({sourceId:original.source_id,beforeSha256:fingerprint(old),afterSha256:fingerprint(next)})
        }
      } else if(table==='maintenance_proposals') {
        const decision=decisions.get(original.proposal_id)
        if(!decision || decision.originalRowSha256!==fingerprint(original)
          || !['new_identity','already_present','locale_name_conflict','originally_held'].includes(decision.disposition))fail('proposal_classification_invalid')
        if(original.status==='held') { if(decision.disposition!=='originally_held')fail('held_proposal_promoted') }
        else if(original.status!=='ready' || decision.disposition==='originally_held') fail('proposal_state_invalid')
        after.status=decision.disposition==='new_identity'?'ready':'held'
        proposals[after.status]++
      }
      if(table==='maintenance_model_attempts') {
        if(!Object.hasOwn(outcomes,original.status))fail('nonterminal_historical_attempt')
        outcomes[original.status]++
        const collisions=await findAttempts(original.reservation_key,original.request_sha256)
        if(!Array.isArray(collisions) || collisions.some(row=>!same(row,original)))fail('request_history_collision')
      }
      if(before && table!=='maintenance_sources' && !same(before,after))fail('existing_row_conflict')
      const operation={table,before,after,originalRowSha256:fingerprint(original)}
      if(before && same(before,after))preserved.push({table,keySha256:fingerprint(schema.keys.map(k=>after[k])),rowSha256:fingerprint(after),row:after})
      else operations.push(operation)
    }
  }
  if(!same(outcomes,{completed:165,unknown:3,known_failed:3}) || !same(proposals,{ready:67,held:83}))fail('reviewed_classification_changed')
  const archiveOnly=['maintenance_jobs','maintenance_observations'].map(table=>({table,count:manifest.tableRows[table]?.length,rowsSha256:fingerprint(manifest.tableRows[table])}))
  if(archiveOnly[0].count!==425 || archiveOnly[1].count!==85)fail('archive_history_changed')
  const content={format:'studyinchina.legacy-reconciliation-import-plan',version:1,batchId:manifest.batchId,
    operations,preserved,categoryMerges,archiveOnly,outcomes,proposals,publicWrites:false,modelCalls:false}
  return {...content,sha256:fingerprint(content)}
}

export async function applyImportPlan(plan, query) {
  const {sha256,...content}=plan
  if(plan.format!=='studyinchina.legacy-reconciliation-import-plan' || plan.version!==1 || fingerprint(content)!==sha256
    || plan.publicWrites!==false || plan.modelCalls!==false || !Array.isArray(plan.operations) || plan.operations.length>525)fail('plan_invalid')
  let applied=0,reused=0
  for(const op of plan.operations) {
    const observed=(await query(readStatement(op.table,op.after)))[0]??null
    if(same(observed,op.after)){reused++;continue}
    if(!same(observed,op.before))fail('fresh_row_conflict')
    await query(writeStatement(op))
    const after=(await query(readStatement(op.table,op.after)))[0]??null
    if(!same(after,op.after))fail('write_readback_conflict')
    applied++
  }
  for(const preserved of plan.preserved??[]) {
    const schema=shape(preserved.table,preserved.row)
    if(fingerprint(schema.keys.map(k=>preserved.row[k]))!==preserved.keySha256 || fingerprint(preserved.row)!==preserved.rowSha256)fail('preserved_row_proof_invalid')
    const observed=(await query(readStatement(preserved.table,preserved.row)))[0]??null
    if(!same(observed,preserved.row))fail('preserved_row_readback_conflict')
  }
  // Final readback also catches deletion or change of an earlier imported row
  // while later chunks were written. The caller keeps the backend disabled.
  for(const operation of plan.operations) {
    const observed=(await query(readStatement(operation.table,operation.after)))[0]??null
    if(!same(observed,operation.after))fail('final_row_readback_conflict')
  }
  return {applied,reused,operationCount:plan.operations.length,preservedCount:plan.preserved?.length??0,planSha256:sha256,modelCalls:false,publicWrites:false}
}
