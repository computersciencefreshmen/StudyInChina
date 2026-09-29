export const OPERATIONS_QUERIES = {
  heartbeats: `SELECT service_name, last_started_at, last_succeeded_at, last_error_code, updated_at FROM automation_service_runs`,
  jobs: `SELECT COUNT(CASE WHEN status IN ('queued','running','retrying') THEN 1 END) AS active_count,
    MIN(CASE WHEN status IN ('queued','running','retrying') THEN scheduled_at END) AS oldest_active_at,
    COUNT(CASE WHEN status = 'running' AND datetime(updated_at) < datetime(?1) THEN 1 END) AS stuck_count,
    COUNT(CASE WHEN status = 'failed' AND datetime(completed_at) >= datetime(?2) THEN 1 END) AS failed_recent_count,
    COUNT(CASE WHEN status = 'failed' AND attempt >= 4 AND datetime(completed_at) >= datetime(?2) THEN 1 END) AS exhausted_recent_count
    FROM ingestion_jobs`,
  sources: `SELECT COUNT(*) AS enabled_count,
    COUNT(CASE WHEN next_fetch_at IS NULL OR datetime(next_fetch_at) <= datetime(?1) THEN 1 END) AS due_count,
    COUNT(CASE WHEN (next_fetch_at IS NULL AND datetime(created_at) < datetime(?2)) OR datetime(next_fetch_at) < datetime(?2) THEN 1 END) AS overdue_count,
    COUNT(CASE WHEN consecutive_failures >= 4 THEN 1 END) AS repeatedly_failed_count
    FROM ingestion_sources WHERE enabled = 1`,
  outbox: `SELECT COUNT(CASE WHEN event_status IN ('pending','processing','failed') THEN 1 END) AS pending_count,
    MIN(CASE WHEN event_status IN ('pending','processing','failed') THEN created_at END) AS oldest_pending_at,
    COUNT(CASE WHEN event_status = 'dead_letter' THEN 1 END) AS dead_letter_count,
    COUNT(CASE WHEN event_status = 'processing' AND datetime(lease_expires_at) < datetime(?1) THEN 1 END) AS expired_lease_count
    FROM outbox_events WHERE event_type = 'catalog.release.requested'`,
  entities: `SELECT COUNT(*) AS pending_count, MIN(candidate.created_at) AS oldest_pending_at
    FROM extracted_entity_candidates candidate
    LEFT JOIN entity_materialization_decisions decision ON decision.candidate_id = candidate.candidate_id
    WHERE candidate.candidate_status IN ('validated','registered') AND decision.candidate_id IS NULL`,
  retries: `SELECT COUNT(*) AS pending_count,
    COUNT(CASE WHEN failure_count >= 4 THEN 1 END) AS repeatedly_failed_count,
    COUNT(CASE WHEN datetime(next_attempt_at) < datetime(?1) THEN 1 END) AS overdue_count
    FROM automation_retry_state`,
  evidence: `SELECT COUNT(*) AS overdue_count FROM records
    WHERE workflow_status IN ('validated','applied','published') AND review_after < ?1`,
} as const

export function operationsParameters(now: Date): Record<keyof typeof OPERATIONS_QUERIES, string[]> {
  const iso = now.toISOString()
  return {
    heartbeats: [], jobs: [new Date(+now - 7200000).toISOString(), new Date(+now - 86400000).toISOString()],
    sources: [iso, new Date(+now - 86400000).toISOString()], outbox: [iso], entities: [],
    retries: [new Date(+now - 7200000).toISOString()], evidence: [new Date(+now + 28800000).toISOString().slice(0, 10)],
  }
}
