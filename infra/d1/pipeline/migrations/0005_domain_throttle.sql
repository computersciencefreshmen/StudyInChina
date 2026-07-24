-- Cross-isolate per-host lease. This is the authoritative politeness gate;
-- Queue max_concurrency is only a global capacity setting.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingestion_domain_leases (
  host TEXT PRIMARY KEY CHECK (
    host = lower(host)
    AND instr(host, '/') = 0
    AND instr(host, ':') = 0
    AND instr(host, '*') = 0
  ),
  lease_token TEXT,
  leased_until TEXT,
  last_request_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (lease_token IS NULL AND leased_until IS NULL)
    OR (lease_token IS NOT NULL AND leased_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ingestion_domain_leases_expiry
  ON ingestion_domain_leases(leased_until);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_jobs_one_active_per_source
  ON ingestion_jobs(source_id)
  WHERE status IN ('queued', 'running', 'retrying');

PRAGMA optimize;
