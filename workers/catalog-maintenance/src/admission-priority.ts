import { readCoverageSnapshot } from './coverage'
import type { Control, MaintenanceEnv } from './types'
import { getTodayDate } from '../../../src/lib/data/freshness'
import { nowIso } from './util'

/** Raw target reviewAfter is not proof of current facts. Only a current bound
 * coverage snapshot supplies the review-date branch, conservatively per school.
 * Explicit priority-zero work remains urgent when that snapshot is unavailable.
 * Coverage does not expose scholarship or partial-field review dates; those
 * scopes need explicit urgency rather than inferred current facts. */
export async function hasUrgentMaintenance(env: MaintenanceEnv, cfg: Control, now = Date.now()): Promise<boolean> {
  if (!cfg.targets_complete) return false
  const instant = nowIso(now)
  const exists = async (reviewSchools: string[]) => Boolean(await env.PIPELINE_DB.prepare(`
    SELECT 1 present FROM maintenance_jobs j
    JOIN maintenance_sources s ON s.source_id=j.source_id AND s.enabled=1
    WHERE j.stage='maintain' AND j.due_at<=? ${reviewSchools.length ? '' : 'AND j.priority<=0'}
      AND (j.status IN('queued','retry') OR (j.status='running' AND j.lease_token IS NOT NULL AND length(j.lease_token)>0 AND j.lease_until>?))
      AND j.snapshot_key IS NOT NULL AND length(j.snapshot_key)>0 AND length(j.snapshot_sha256)=64
      AND (s.raw_sha256 IS NULL OR s.raw_sha256=j.snapshot_sha256)
      AND CASE WHEN json_valid(j.target_ids_json) THEN COALESCE(json_extract(j.target_ids_json,'$.kind'),'')<>'cycle-discovery' ELSE 0 END
      AND EXISTS(
        SELECT 1 FROM json_each(CASE WHEN json_valid(j.target_ids_json) THEN
          CASE WHEN json_type(j.target_ids_json)='array' THEN j.target_ids_json
            WHEN json_type(j.target_ids_json,'$.targets')='array' THEN json_extract(j.target_ids_json,'$.targets') ELSE '[]' END ELSE '[]' END) pin
        JOIN maintenance_record_targets t ON t.target_id=json_extract(CASE WHEN pin.type='object' THEN pin.value ELSE '{}' END,'$.id') AND t.record_scope_sha256=json_extract(CASE WHEN pin.type='object' THEN pin.value ELSE '{}' END,'$.sha256') AND t.active=1
        JOIN maintenance_target_sources x ON x.target_id=t.target_id AND x.source_id=j.source_id
        JOIN maintenance_schools u ON u.university_id=t.university_id AND u.scope_sha256=?
        JOIN maintenance_source_schools ss ON ss.source_id=j.source_id AND ss.university_id=t.university_id
        WHERE (json_array_length(?)=0 OR EXISTS(SELECT 1 FROM json_each(?) c WHERE c.value=t.university_id))
          AND (j.priority<=0 OR EXISTS(SELECT 1 FROM json_each(?) r WHERE r.value=t.university_id))
        LIMIT 1)
    LIMIT 1`).bind(instant, instant, cfg.scope_sha256, cfg.canary_json, cfg.canary_json, JSON.stringify(reviewSchools)).first<{ present: number }>())
  // The common explicit deadline path needs no R2 coverage read.
  if (await exists([])) return true
  const coverage = await readCoverageSnapshot(env, cfg.input_catalog_sha256, cfg.scope_sha256, now)
  if (!coverage) return false
  const today = getTodayDate(new Date(now)), limit = getTodayDate(new Date(now + 7 * 86400000))
  const reviewSchools = coverage.schools.filter(school => school.currentProgramCount > 0 && school.reviewAfter
    && school.reviewAfter >= today && school.reviewAfter <= limit).map(school => school.universityId)
  return reviewSchools.length > 0 && await exists(reviewSchools)
}
