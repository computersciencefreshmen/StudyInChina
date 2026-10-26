import { z } from 'zod'
import { loadSnapshot } from './capture'
import { programPartitionInput } from './program-partitions'
import { MaintenanceError, type MaintenanceEnv } from './types'
import { canonical, digest, nowIso } from './util'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const registrationSchema = z.object({
  sourceId: hash, snapshotKey: z.string().min(1), rawSha256: hash,
  specs: z.array(z.unknown()).min(1).max(200),
}).strict()
const waiting = 'program_partition_waiting'

/** Persist the complete validated plan as inactive jobs. Existing completed,
 * unknown or active scopes are immutable, even when an older job ID was used. */
export async function registerProgramPartitions(env: MaintenanceEnv, input: {
  sourceId: string; snapshotKey: string; rawSha256: string; specs: unknown[];
}): Promise<{ inserted: number; reused: number; jobIds: string[] }> {
  const value = registrationSchema.safeParse(input)
  if (!value.success) throw new MaintenanceError('program_partition_registration_invalid')
  const { sourceId, snapshotKey, rawSha256, specs } = value.data
  const source = await env.PIPELINE_DB.prepare('SELECT enabled,raw_sha256,snapshot_key FROM maintenance_sources WHERE source_id=?')
    .bind(sourceId).first<{ enabled: number; raw_sha256: string; snapshot_key: string }>()
  if (!source?.enabled || source.raw_sha256 !== rawSha256 || source.snapshot_key !== snapshotKey)
    throw new MaintenanceError('program_partition_source_changed')
  const snapshot = await loadSnapshot(env, snapshotKey)
  if (snapshot.sourceId !== sourceId || snapshot.rawSha256 !== rawSha256 || !snapshot.textKey || !snapshot.textSha256)
    throw new MaintenanceError('program_partition_snapshot_binding_invalid')
  const object = await env.SNAPSHOTS_BUCKET.get(snapshot.textKey)
  if (!object || object.size !== undefined && object.size > 2 * 1024 * 1024)
    throw new MaintenanceError('captured_text_unavailable')
  const text = await object.text()
  if (await digest(text) !== snapshot.textSha256) throw new MaintenanceError('captured_text_checksum_mismatch')
  const plans: Array<{ target: string; jobId: string }> = []
  const targets = new Set<string>()
  // Validate every scope before the first write; a late invalid part must not
  // leave an apparently complete but only partly registered catalogue plan.
  for (const spec of specs) {
    const partition = await programPartitionInput(text, snapshot.textSha256, canonical(spec))
    if (!partition.metadata) throw new MaintenanceError('program_partition_invalid')
    const target = canonical(partition.metadata)
    if (targets.has(target)) throw new MaintenanceError('program_partition_duplicate_scope')
    targets.add(target)
    plans.push({ target, jobId: await digest(`program-partition-v1:${sourceId}:${rawSha256}:${partition.metadata.sha256}`) })
  }
  const existing = (await env.PIPELINE_DB.prepare("SELECT job_id,target_ids_json FROM maintenance_jobs WHERE source_id=? AND snapshot_sha256=? AND snapshot_key=? AND stage='extract'")
    .bind(sourceId, rawSha256, snapshotKey).all<{ job_id: string; target_ids_json: string | null }>()).results ?? []
  const byTarget = new Map<string, string>()
  for (const job of existing) {
    if (job.target_ids_json === null) continue
    try { byTarget.set(canonical(JSON.parse(job.target_ids_json)), job.job_id) } catch { /* Unrelated historical rows stay untouched. */ }
  }
  for (const plan of plans) if (existing.some(job => job.job_id === plan.jobId
    && (!job.target_ids_json || canonical(JSON.parse(job.target_ids_json)) !== plan.target)))
    throw new MaintenanceError('program_partition_job_identity_conflict')
  const at = nowIso(), guardId = crypto.randomUUID()
  const pending = plans.filter(plan => !byTarget.has(plan.target))
  if (!pending.length) return { inserted: 0, reused: plans.length, jobIds: plans.map(plan => byTarget.get(plan.target)!) }
  const results = await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards(guard_id,check_passed)
      SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM maintenance_sources WHERE source_id=? AND enabled=1 AND raw_sha256=? AND snapshot_key=?) THEN 1 ELSE 0 END`)
      .bind(guardId, sourceId, rawSha256, snapshotKey),
    ...pending.map(plan => env.PIPELINE_DB.prepare(`INSERT OR IGNORE INTO maintenance_jobs
      (job_id,source_id,stage,status,due_at,created_at,updated_at,snapshot_sha256,snapshot_key,target_ids_json,error_code)
      SELECT ?,?,'extract','held',?,?,?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE source_id=? AND snapshot_sha256=? AND snapshot_key=? AND stage='extract' AND target_ids_json=?)`)
      .bind(plan.jobId, sourceId, at, at, at, rawSha256, snapshotKey, plan.target, waiting, sourceId, rawSha256, snapshotKey, plan.target)),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guardId),
  ])
  if (results.length !== pending.length + 2 || results.some(result => !result.success))
    throw new MaintenanceError('program_partition_write_receipt_invalid')
  let inserted = 0
  for (const result of results.slice(1, -1)) {
    if (!result.success || !Number.isSafeInteger(result.meta?.changes) || result.meta!.changes! < 0 || result.meta!.changes! > 1)
      throw new MaintenanceError('program_partition_write_receipt_invalid')
    inserted += result.meta!.changes!
  }
  return { inserted, reused: plans.length - inserted, jobIds: plans.map(plan => byTarget.get(plan.target) ?? plan.jobId) }
}

/** The active-stage unique index is the final concurrency guard. This atomic
 * statement admits at most one waiting part per source and never reopens an
 * uncertain model request or changes a historical job. */
export async function promoteProgramPartitions(env: MaintenanceEnv, sourceIds: string[]): Promise<{ promoted: number; jobIds: string[] }> {
  const ids = z.array(hash).max(20).safeParse(sourceIds)
  if (!ids.success) throw new MaintenanceError('program_partition_sources_invalid')
  const jobIds: string[] = []
  for (const sourceId of new Set(ids.data)) {
    const at = nowIso()
    const promoted = await env.PIPELINE_DB.prepare(`UPDATE maintenance_jobs SET status='queued',error_code=NULL,due_at=?,updated_at=?,enqueued_at=NULL
      WHERE job_id=(SELECT j.job_id FROM maintenance_jobs j
        JOIN maintenance_sources s ON s.source_id=j.source_id
        WHERE j.source_id=? AND j.stage='extract' AND j.status='held' AND j.error_code=?
        AND j.lease_token IS NULL AND s.enabled=1 AND s.raw_sha256=j.snapshot_sha256 AND s.snapshot_key=j.snapshot_key
        AND NOT EXISTS(SELECT 1 FROM maintenance_jobs active WHERE active.source_id=j.source_id AND active.stage='extract' AND active.status IN('queued','running','retry'))
        AND NOT EXISTS(SELECT 1 FROM maintenance_jobs uncertain WHERE uncertain.source_id=j.source_id AND uncertain.stage='extract' AND uncertain.snapshot_sha256=j.snapshot_sha256 AND uncertain.status='unknown')
        AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts a WHERE a.source_id=j.source_id AND a.snapshot_sha256=j.snapshot_sha256 AND a.status IN('reserved','send_started','unknown'))
        ORDER BY j.created_at,j.job_id LIMIT 1)
      AND status='held' AND error_code=? AND lease_token IS NULL RETURNING job_id`)
      .bind(at, at, sourceId, waiting, waiting).first<{ job_id: string }>()
    if (promoted) jobIds.push(promoted.job_id)
  }
  return { promoted: jobIds.length, jobIds }
}
