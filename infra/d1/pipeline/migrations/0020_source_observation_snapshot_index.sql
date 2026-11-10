-- Revalidation looks up the latest complete-body receipt for one immutable
-- snapshot. Keep the source-leading index used by other observation readers.
CREATE INDEX IF NOT EXISTS idx_source_observations_snapshot_latest
  ON ingestion_source_observations(snapshot_id, observed_at DESC);
