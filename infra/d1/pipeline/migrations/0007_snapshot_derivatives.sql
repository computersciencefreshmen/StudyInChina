PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingestion_snapshot_derivatives (
  snapshot_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  derivative_kind TEXT NOT NULL CHECK (derivative_kind IN ('document_text')),
  r2_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, derivative_kind),
  FOREIGN KEY (snapshot_id, source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_derivatives_source_created
  ON ingestion_snapshot_derivatives(source_id, created_at DESC);

