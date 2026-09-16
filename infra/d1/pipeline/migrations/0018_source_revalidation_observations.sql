-- A repeated complete official response is a new observation of immutable bytes.
-- Never rewrite ingestion_snapshots.fetched_at or refresh on a 304 alone.
CREATE TABLE IF NOT EXISTS ingestion_source_observations (
  observation_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES ingestion_jobs(job_id) ON DELETE RESTRICT,
  observed_at TEXT NOT NULL CHECK (julianday(observed_at) IS NOT NULL),
  http_status INTEGER NOT NULL CHECK (http_status = 200),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  final_url TEXT NOT NULL CHECK (final_url LIKE 'https://%'),
  proof_kind TEXT NOT NULL CHECK (proof_kind = 'complete-body-sha256'),
  UNIQUE (job_id),
  FOREIGN KEY (snapshot_id, source_id) REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_source_observations_latest
  ON ingestion_source_observations(source_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS ingestion_candidate_observations (
  candidate_id TEXT PRIMARY KEY REFERENCES ingestion_candidates(candidate_id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL REFERENCES ingestion_source_observations(observation_id) ON DELETE RESTRICT,
  original_candidate_id TEXT NOT NULL REFERENCES ingestion_candidates(candidate_id) ON DELETE RESTRICT,
  UNIQUE (observation_id, original_candidate_id)
);
CREATE TRIGGER IF NOT EXISTS trg_observation_matches_snapshot
BEFORE INSERT ON ingestion_source_observations
WHEN NOT EXISTS (
  SELECT 1 FROM ingestion_snapshots snapshot
  JOIN ingestion_jobs job ON job.job_id = NEW.job_id AND job.source_id = NEW.source_id
  WHERE snapshot.snapshot_id = NEW.snapshot_id AND snapshot.source_id = NEW.source_id
    AND snapshot.raw_sha256 = NEW.body_sha256 AND snapshot.byte_length = NEW.byte_length
    AND snapshot.final_url = NEW.final_url AND julianday(NEW.observed_at) >= julianday(snapshot.fetched_at)
)
BEGIN SELECT RAISE(ABORT, 'observation requires a matching complete official response'); END;
CREATE TRIGGER IF NOT EXISTS trg_observation_immutable_update
BEFORE UPDATE ON ingestion_source_observations
BEGIN SELECT RAISE(ABORT, 'source observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_observation_immutable_delete
BEFORE DELETE ON ingestion_source_observations
BEGIN SELECT RAISE(ABORT, 'source observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_candidate_observation_binding
BEFORE INSERT ON ingestion_candidate_observations
WHEN NOT EXISTS (
  SELECT 1 FROM ingestion_candidates fresh
  JOIN ingestion_source_observations observation ON observation.observation_id = NEW.observation_id
  JOIN ingestion_candidates original ON original.candidate_id = NEW.original_candidate_id
  JOIN candidate_promotions promotion ON promotion.candidate_id = original.candidate_id
  WHERE fresh.candidate_id = NEW.candidate_id
    AND fresh.source_id = observation.source_id AND fresh.snapshot_id = observation.snapshot_id
    AND original.source_id = fresh.source_id AND original.snapshot_id = fresh.snapshot_id
    AND original.candidate_status = 'applied' AND promotion.promotion_status = 'applied'
    AND original.facts_json = fresh.facts_json AND original.extractor = fresh.extractor
    AND original.gate_status = fresh.gate_status
)
BEGIN SELECT RAISE(ABORT, 'observation binding requires an applied matching original'); END;
CREATE TRIGGER IF NOT EXISTS trg_candidate_observation_immutable_update
BEFORE UPDATE ON ingestion_candidate_observations
BEGIN SELECT RAISE(ABORT, 'candidate observation bindings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_candidate_observation_immutable_delete
BEFORE DELETE ON ingestion_candidate_observations
BEGIN SELECT RAISE(ABORT, 'candidate observation bindings are immutable'); END;

-- Recheck source currency inside the same transaction that commits publication.
CREATE TRIGGER IF NOT EXISTS trg_observed_candidate_apply_current_source
BEFORE UPDATE OF promotion_status ON candidate_promotions
WHEN NEW.promotion_status = 'applied'
  AND EXISTS (SELECT 1 FROM ingestion_candidate_observations WHERE candidate_id = NEW.candidate_id)
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_candidate_observations binding
    JOIN ingestion_source_observations observation ON observation.observation_id = binding.observation_id
    JOIN ingestion_sources source ON source.source_id = observation.source_id
    WHERE binding.candidate_id = NEW.candidate_id AND source.enabled = 1
      AND COALESCE(json_extract(source.manifest_json, '$.enabled'), 0) = 1
      AND source.raw_sha256 = observation.body_sha256
  )
BEGIN SELECT RAISE(ABORT, 'renewal source changed or was disabled before commit'); END;
