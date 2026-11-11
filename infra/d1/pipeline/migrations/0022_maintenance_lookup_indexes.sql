-- Reverse lookups observed in D1 Insights on 2026-11-11. These indexes avoid
-- repeatedly scanning all record targets and cross-school legacy guards.
CREATE INDEX IF NOT EXISTS maintenance_target_source_lookup
  ON maintenance_target_sources(source_id,target_id);
CREATE INDEX IF NOT EXISTS maintenance_target_record_lookup
  ON maintenance_record_targets(record_id,active);
CREATE INDEX IF NOT EXISTS maintenance_source_school_lookup
  ON maintenance_source_schools(university_id,source_id);
CREATE INDEX IF NOT EXISTS maintenance_observation_latest
  ON maintenance_observations(source_id,checked_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_guard_school_lookup
  ON maintenance_legacy_guards(university_id,record_id,source_id,snapshot_sha256);
CREATE INDEX IF NOT EXISTS maintenance_source_due_lookup
  ON maintenance_sources(enabled,due_at);
