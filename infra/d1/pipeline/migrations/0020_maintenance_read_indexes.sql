-- Bound repeated source scheduling/guard lookups without changing queue or STOP semantics.
-- The existing target binding primary key starts with target_id; scheduling uses source_id.
CREATE INDEX IF NOT EXISTS maintenance_target_sources_source
  ON maintenance_target_sources(source_id,target_id);
CREATE INDEX IF NOT EXISTS maintenance_sources_enabled_due
  ON maintenance_sources(enabled,due_at);
-- Include maintain jobs, which are outside the older partial active-source index.
CREATE INDEX IF NOT EXISTS maintenance_jobs_source_stage_status
  ON maintenance_jobs(source_id,stage,status);
-- Both OR arms must be indexed; null source guards still remain in the result.
CREATE INDEX IF NOT EXISTS maintenance_legacy_guards_source
  ON maintenance_legacy_guards(source_id);
CREATE INDEX IF NOT EXISTS maintenance_legacy_guards_snapshot
  ON maintenance_legacy_guards(snapshot_sha256);
-- Cross-contract retries must inspect unresolved attempts for these exact source bytes.
CREATE INDEX IF NOT EXISTS maintenance_model_attempts_source_snapshot_status
  ON maintenance_model_attempts(source_id,snapshot_sha256,status);
