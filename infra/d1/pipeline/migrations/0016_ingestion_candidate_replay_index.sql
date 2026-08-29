-- Speeds extractor-fingerprint replay checks for a saved source snapshot.
-- candidate_id keeps the index covering for the provenance join.
CREATE INDEX IF NOT EXISTS idx_ingestion_candidates_source_snapshot
  ON ingestion_candidates(source_id, snapshot_id, candidate_id);

PRAGMA optimize;
