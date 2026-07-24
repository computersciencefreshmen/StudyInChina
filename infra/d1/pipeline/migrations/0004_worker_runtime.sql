-- Runtime projection consumed directly by workers/ingestion/src/repository.ts.
-- Keep this contract narrow and stable. Runtime candidates are mapped into the
-- richer claims/change-set model only after deterministic validation.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingestion_sources (
  source_id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL CHECK (
    json_valid(manifest_json) AND json_type(manifest_json) = 'object'
  ),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  etag TEXT,
  last_modified TEXT,
  raw_sha256 TEXT CHECK (raw_sha256 IS NULL OR length(raw_sha256) = 64),
  canonical_sha256 TEXT CHECK (canonical_sha256 IS NULL OR length(canonical_sha256) = 64),
  next_fetch_at TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  job_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'retrying', 'completed', 'failed'
  )),
  reason TEXT NOT NULL CHECK (reason IN ('scheduled', 'discovery', 'manual', 'retry')),
  scheduled_at TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'not-modified', 'raw-duplicate', 'canonical-duplicate',
    'rule-pass', 'dual-pass', 'quarantined'
  )),
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  CHECK (status NOT IN ('completed', 'failed') OR completed_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ingestion_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  r2_key TEXT NOT NULL UNIQUE,
  raw_sha256 TEXT NOT NULL CHECK (length(raw_sha256) = 64),
  canonical_sha256 TEXT NOT NULL CHECK (length(canonical_sha256) = 64),
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  final_url TEXT NOT NULL CHECK (final_url LIKE 'https://%'),
  fetched_at TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  UNIQUE (source_id, raw_sha256),
  UNIQUE (snapshot_id, source_id)
);

CREATE TABLE IF NOT EXISTS ingestion_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  extractor TEXT NOT NULL CHECK (extractor IN ('rules', 'minimax-dual')),
  gate_status TEXT NOT NULL CHECK (gate_status IN (
    'rule-pass', 'dual-pass', 'quarantined'
  )),
  candidate_status TEXT NOT NULL DEFAULT 'extracted' CHECK (candidate_status IN (
    'extracted', 'validated', 'quarantined', 'applied'
  )),
  facts_json TEXT NOT NULL CHECK (
    json_valid(facts_json) AND json_type(facts_json) = 'array'
  ),
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  created_at TEXT NOT NULL,
  validated_at TEXT,
  applied_at TEXT,
  FOREIGN KEY (snapshot_id, source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT,
  CHECK (candidate_status <> 'validated' OR validated_at IS NOT NULL),
  CHECK (candidate_status <> 'applied' OR applied_at IS NOT NULL),
  CHECK (gate_status <> 'quarantined' OR candidate_status IN ('extracted', 'quarantined'))
);

CREATE TABLE IF NOT EXISTS ingestion_robots_cache (
  host TEXT PRIMARY KEY CHECK (
    host = lower(host)
    AND instr(host, '/') = 0
    AND instr(host, ':') = 0
  ),
  body TEXT,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > fetched_at),
  CHECK ((status_code = 200 AND body IS NOT NULL) OR status_code <> 200)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_sources_due
  ON ingestion_sources(next_fetch_at, source_id)
  WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_ingestion_sources_failures
  ON ingestion_sources(consecutive_failures, next_fetch_at)
  WHERE enabled = 1 AND consecutive_failures > 0;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source_active
  ON ingestion_jobs(source_id, status)
  WHERE status IN ('queued', 'running', 'retrying');
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_schedule
  ON ingestion_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_snapshots_source_fetched
  ON ingestion_snapshots(source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_snapshots_canonical_hash
  ON ingestion_snapshots(source_id, canonical_sha256);
CREATE INDEX IF NOT EXISTS idx_ingestion_candidates_pipeline
  ON ingestion_candidates(candidate_status, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_candidates_source
  ON ingestion_candidates(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_robots_cache_expiry
  ON ingestion_robots_cache(expires_at);

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_quarantine_insert
AFTER INSERT ON ingestion_candidates
WHEN NEW.gate_status = 'quarantined' AND NEW.candidate_status <> 'quarantined'
BEGIN
  UPDATE ingestion_candidates
  SET candidate_status = 'quarantined'
  WHERE candidate_id = NEW.candidate_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_validate_insert
AFTER INSERT ON ingestion_candidates
WHEN NEW.gate_status IN ('rule-pass', 'dual-pass')
  AND NEW.candidate_status = 'extracted'
BEGIN
  UPDATE ingestion_candidates
  SET candidate_status = 'validated',
      validated_at = COALESCE(validated_at, NEW.created_at)
  WHERE candidate_id = NEW.candidate_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_transition
BEFORE UPDATE OF candidate_status ON ingestion_candidates
WHEN NOT (
  NEW.candidate_status = OLD.candidate_status
  OR (OLD.candidate_status = 'extracted' AND NEW.candidate_status IN ('validated', 'quarantined'))
  OR (OLD.candidate_status = 'validated' AND NEW.candidate_status IN ('applied', 'quarantined'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid ingestion candidate transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_applied_gate
BEFORE UPDATE OF candidate_status ON ingestion_candidates
WHEN NEW.candidate_status = 'applied'
  AND (OLD.candidate_status <> 'validated' OR OLD.gate_status = 'quarantined')
BEGIN
  SELECT RAISE(ABORT, 'only a validated non-quarantined candidate can be applied');
END;

PRAGMA optimize;
