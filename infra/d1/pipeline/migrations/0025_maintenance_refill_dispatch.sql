-- Additive dispatch ownership only. Never changes jobs, model outcomes or reservations.
CREATE TABLE IF NOT EXISTS maintenance_refill_dispatches (
  dispatch_token TEXT NOT NULL,
  job_id TEXT NOT NULL,
  epoch_sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('model','capture')),
  stage TEXT NOT NULL CHECK(stage IN('capture','extract','award','maintain')),
  scope_sha256 TEXT NOT NULL,
  input_catalog_sha256 TEXT NOT NULL,
  control_revision INTEGER NOT NULL,
  fence_json TEXT NOT NULL CHECK(json_valid(fence_json)),
  candidate_json TEXT NOT NULL CHECK(json_valid(candidate_json)),
  candidate_sha256 TEXT NOT NULL,
  job_json TEXT NOT NULL CHECK(json_valid(job_json)),
  status TEXT NOT NULL CHECK(status IN('prepared','sent','unconfirmed','observed','not_sent')),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  observed_at TEXT,
  resolution TEXT CHECK(resolution IS NULL OR resolution IN('job_progress','received_not_started')),
  PRIMARY KEY(dispatch_token,job_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_refill_active_job
  ON maintenance_refill_dispatches(job_id) WHERE status IN('prepared','sent','unconfirmed');
CREATE TABLE IF NOT EXISTS maintenance_refill_fairness (
  scope_sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('model','capture')),
  revision INTEGER NOT NULL DEFAULT 0,
  slot_offset INTEGER NOT NULL DEFAULT 0,
  expansion_offset INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope_sha256,kind)
);
-- Source-first bounded probes and stage-separated due reservoirs; no full fact scans.
CREATE INDEX IF NOT EXISTS maintenance_refill_model_source_state ON maintenance_model_attempts(source_id,status);
CREATE INDEX IF NOT EXISTS maintenance_refill_job_stage_due ON maintenance_jobs(stage,status,due_at,job_id);
CREATE INDEX IF NOT EXISTS maintenance_job_snapshot_stage ON maintenance_jobs(source_id,snapshot_sha256,stage);
CREATE INDEX IF NOT EXISTS maintenance_model_source_snapshot ON maintenance_model_attempts(source_id,snapshot_sha256);
