export interface HeartbeatDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> }
  }
}

/** Records only scheduler progress; success does not imply every source is verified. */
export async function withAutomationHeartbeat<T>(
  database: HeartbeatDatabase,
  service: string,
  work: () => Promise<T>,
  now: () => Date = () => new Date(),
): Promise<T> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(service)) throw new Error('Invalid automation service')
  const startedAt = now().toISOString()
  await database.prepare(`
    INSERT INTO automation_service_runs (service_name, last_started_at, last_succeeded_at, last_error_code, updated_at)
    VALUES (?, ?, NULL, NULL, ?)
    ON CONFLICT(service_name) DO UPDATE SET last_started_at = excluded.last_started_at,
      last_error_code = NULL, updated_at = excluded.updated_at
    WHERE excluded.last_started_at >= automation_service_runs.last_started_at
  `).bind(service, startedAt, startedAt).run()
  try {
    const result = await work()
    const succeededAt = now().toISOString()
    await database.prepare(`
      UPDATE automation_service_runs SET last_succeeded_at = ?, last_error_code = NULL, updated_at = ?
      WHERE service_name = ? AND last_started_at = ?
    `).bind(succeededAt, succeededAt, service, startedAt).run()
    return result
  } catch (error) {
    // Error messages can include source content, query text or credentials. Store only a bounded code.
    const candidate = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const code = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(candidate) ? candidate : 'scheduler_failed'
    try {
      await database.prepare(`
        UPDATE automation_service_runs SET last_error_code = ?, updated_at = ?
        WHERE service_name = ? AND last_started_at = ?
      `).bind(code, now().toISOString(), service, startedAt).run()
    } catch { /* Preserve the original failure; the missing success still makes health fail. */ }
    throw error
  }
}
