PRAGMA foreign_keys = ON;

-- Operational failures are separate from evidence/conflict decisions. These rows
-- control scheduling only and can never approve a candidate or canonical field.
CREATE TABLE IF NOT EXISTS automation_retry_state (
  task_kind TEXT NOT NULL CHECK (task_kind IN ('entity_materialization', 'candidate_promotion')),
  task_id TEXT NOT NULL,
  failure_count INTEGER NOT NULL CHECK (failure_count >= 1),
  next_attempt_at TEXT NOT NULL CHECK (julianday(next_attempt_at) IS NOT NULL),
  last_attempt_at TEXT NOT NULL CHECK (julianday(last_attempt_at) IS NOT NULL),
  last_error TEXT NOT NULL,
  PRIMARY KEY (task_kind, task_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_retry_due
  ON automation_retry_state(task_kind, next_attempt_at);

CREATE TABLE IF NOT EXISTS automation_service_runs (
  service_name TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_succeeded_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  CHECK (last_started_at IS NULL OR julianday(last_started_at) IS NOT NULL),
  CHECK (last_succeeded_at IS NULL OR julianday(last_succeeded_at) IS NOT NULL),
  CHECK (julianday(updated_at) IS NOT NULL)
);
