import type { D1Database } from '../../publisher/src/types'

export type AutomationTaskKind = 'entity_materialization' | 'candidate_promotion'

/** Only recognizable infrastructure failures may be automatically retried. */
export function isRetryableInfrastructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|temporar|network|connection|fetch failed|overload|database is (?:locked|busy)|sqlite_(?:busy|locked|ioerr)|disk i\/o|rate.?limit|\b(?:429|502|503|504)\b|D1_(?:ERROR|EXEC_ERROR).*internal|internal server error/i.test(message)
}

export async function recordAutomationRetry(
  database: D1Database,
  kind: AutomationTaskKind,
  id: string,
  error: unknown,
  now: string,
): Promise<void> {
  const result = await database.prepare(`
    INSERT INTO automation_retry_state (
      task_kind, task_id, failure_count, next_attempt_at, last_attempt_at, last_error
    ) VALUES (?1, ?2, 1, strftime('%Y-%m-%dT%H:%M:%fZ', ?3, '+60 seconds'), ?3, ?4)
    ON CONFLICT(task_kind, task_id) DO UPDATE SET
      failure_count = automation_retry_state.failure_count + 1,
      next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?3,
        '+' || min(21600, 60 * (1 << min(automation_retry_state.failure_count, 9))) || ' seconds'),
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error
  `).bind(kind, id, now, (error instanceof Error ? error.message : String(error)).slice(0, 1_000)).run()
  if (!result.success) throw new Error(result.error ?? 'Could not persist automation retry')
}

export async function clearAutomationRetry(database: D1Database, kind: AutomationTaskKind, id: string): Promise<void> {
  const result = await database.prepare('DELETE FROM automation_retry_state WHERE task_kind = ?1 AND task_id = ?2')
    .bind(kind, id).run()
  if (!result.success) throw new Error(result.error ?? 'Could not clear automation retry')
}
