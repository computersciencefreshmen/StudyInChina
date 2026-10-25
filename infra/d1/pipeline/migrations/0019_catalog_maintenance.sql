-- A durable maintenance queue, separate from factual acceptance and public releases.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS maintenance_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1), scope_sha256 TEXT NOT NULL,
  input_catalog_sha256 TEXT NOT NULL, seed_sha256 TEXT NOT NULL,
  legacy_guard_sha256 TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  models_enabled INTEGER NOT NULL DEFAULT 0 CHECK(models_enabled IN(0,1)),
  seed_complete INTEGER NOT NULL DEFAULT 0 CHECK(seed_complete IN(0,1)),
  targets_complete INTEGER NOT NULL DEFAULT 0 CHECK(targets_complete IN(0,1)),
  seed_offset INTEGER NOT NULL DEFAULT 0,seed_total INTEGER NOT NULL DEFAULT 0,
  seed_plan_sha256 TEXT,
  canary_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(canary_json)),
  revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_schools (
  university_id TEXT PRIMARY KEY, name_json TEXT NOT NULL, seed_json TEXT NOT NULL,
  scope_sha256 TEXT NOT NULL, last_attempt_at TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_sources (
  source_id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, allowed_hosts_json TEXT NOT NULL,
  category TEXT NOT NULL,categories_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(categories_json)), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
  interval_hours INTEGER NOT NULL CHECK(interval_hours BETWEEN 1 AND 2160),
  due_at TEXT NOT NULL, last_attempt_at TEXT, last_success_at TEXT,
  raw_sha256 TEXT, canonical_sha256 TEXT, snapshot_key TEXT, etag TEXT,
  failures INTEGER NOT NULL DEFAULT 0, error_code TEXT
  ,discovery_depth INTEGER NOT NULL DEFAULT 0 CHECK(discovery_depth BETWEEN 0 AND 2)
);
CREATE TABLE IF NOT EXISTS maintenance_source_schools (
  source_id TEXT NOT NULL REFERENCES maintenance_sources(source_id),
  university_id TEXT NOT NULL REFERENCES maintenance_schools(university_id),
  PRIMARY KEY(source_id,university_id)
);
CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES maintenance_sources(source_id),
  stage TEXT NOT NULL CHECK(stage IN('capture','extract','award','maintain')),
  status TEXT NOT NULL CHECK(status IN('queued','running','retry','done','held','unknown')),
  priority INTEGER NOT NULL DEFAULT 10, due_at TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until TEXT, snapshot_sha256 TEXT, snapshot_key TEXT,
  error_code TEXT, enqueued_at TEXT, target_ids_json TEXT,
  CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS maintenance_jobs_due ON maintenance_jobs(status,due_at,priority);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_jobs_active_source_stage
  ON maintenance_jobs(source_id,stage) WHERE stage IN('capture','extract','award') AND status IN('queued','running','retry');
CREATE TABLE IF NOT EXISTS maintenance_observations (
  observation_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, source_id TEXT NOT NULL,
  checked_at TEXT NOT NULL, final_url TEXT NOT NULL, http_status INTEGER NOT NULL,
  raw_sha256 TEXT, canonical_sha256 TEXT, snapshot_key TEXT, content_type TEXT,
  outcome TEXT NOT NULL, candidate_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS maintenance_robots (
  host TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_document_derivatives (
  source_id TEXT NOT NULL, raw_sha256 TEXT NOT NULL, snapshot_key TEXT NOT NULL,
  raw_key TEXT NOT NULL, text_key TEXT NOT NULL, text_sha256 TEXT NOT NULL,
  parser TEXT NOT NULL CHECK(parser IN('poppler','tesseract')),page_count INTEGER NOT NULL,
  processed_at TEXT NOT NULL,PRIMARY KEY(source_id,raw_sha256)
);
CREATE TABLE IF NOT EXISTS maintenance_document_failures (
  source_id TEXT NOT NULL,raw_sha256 TEXT NOT NULL,reason TEXT NOT NULL,
  reported_at TEXT NOT NULL,PRIMARY KEY(source_id,raw_sha256)
);
CREATE TABLE IF NOT EXISTS maintenance_legacy_guards (
  guard_id TEXT PRIMARY KEY, university_id TEXT, source_id TEXT, record_id TEXT,
  scope_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('stop','unknown','consumed')),
  artifact_sha256 TEXT NOT NULL, reason TEXT NOT NULL
  ,snapshot_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_model_attempts (
  reservation_key TEXT NOT NULL, attempt_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL, pass TEXT NOT NULL,
  request_sha256 TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL
    CHECK(status IN('reserved','send_started','completed','known_failed','unknown')),
  started_at TEXT NOT NULL, completed_at TEXT, output_key TEXT, output_sha256 TEXT,
  usage_json TEXT, quota_json TEXT NOT NULL, error_code TEXT
);
CREATE INDEX IF NOT EXISTS maintenance_model_attempt_scope ON maintenance_model_attempts(reservation_key,started_at);
CREATE TABLE IF NOT EXISTS maintenance_proposals (
  proposal_id TEXT PRIMARY KEY, university_id TEXT NOT NULL REFERENCES maintenance_schools(university_id),
  source_id TEXT NOT NULL, snapshot_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('ready','held','exported','consumed')),
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  created_at TEXT NOT NULL, export_id TEXT, acknowledgement_sha256 TEXT
);
CREATE INDEX IF NOT EXISTS maintenance_proposals_ready ON maintenance_proposals(status,created_at);
CREATE TABLE IF NOT EXISTS maintenance_record_targets (
  target_id TEXT PRIMARY KEY, record_id TEXT NOT NULL, entity_type TEXT NOT NULL
    CHECK(entity_type IN('program','admission-cycle','scholarship')),
  university_id TEXT NOT NULL REFERENCES maintenance_schools(university_id),
  record_scope_sha256 TEXT NOT NULL, academic_year TEXT, intake TEXT,
  fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
  target_json TEXT NOT NULL CHECK(json_valid(target_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1))
);
CREATE TABLE IF NOT EXISTS maintenance_target_sources (
  target_id TEXT NOT NULL REFERENCES maintenance_record_targets(target_id),
  source_id TEXT NOT NULL REFERENCES maintenance_sources(source_id),
  PRIMARY KEY(target_id,source_id)
);
CREATE TABLE IF NOT EXISTS maintenance_target_refreshes (
  refresh_sha256 TEXT PRIMARY KEY,input_catalog_sha256 TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,total_operations INTEGER NOT NULL,
  completed_operations INTEGER NOT NULL DEFAULT 0,expected_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN('staged','completed','superseded')),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_exports (
  batch_id TEXT PRIMARY KEY, input_catalog_sha256 TEXT NOT NULL, scope_sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('prepared','applied','published','rejected')),
  acknowledgement_sha256 TEXT, acknowledgement_json TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_events (
  event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, observed_at TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK(json_valid(details_json))
);
-- First/last statements of an atomic D1 batch fence stale read/modify/write plans.
CREATE TABLE IF NOT EXISTS maintenance_transaction_guards (
  guard_id TEXT PRIMARY KEY, check_passed INTEGER NOT NULL CHECK(check_passed=1)
);
