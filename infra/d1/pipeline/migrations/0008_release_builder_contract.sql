-- Explicit publication metadata required by the fail-closed Catalog release builder.
-- These sidecar tables avoid assigning public meaning to values that the canonical
-- ingestion schema cannot currently express.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publication_source_metadata (
  source_id TEXT PRIMARY KEY
    REFERENCES source_documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  publisher TEXT NOT NULL CHECK (length(trim(publisher)) > 0),
  reviewed_by TEXT NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  reviewed_at TEXT NOT NULL CHECK (julianday(reviewed_at) IS NOT NULL),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS canonical_public_status (
  subject_record_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  catalog_field_status TEXT NOT NULL CHECK (catalog_field_status IN (
    'officially_not_announced', 'not_applicable', 'source_unavailable',
    'conflict', 'stale'
  )),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  reviewed_by TEXT NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  reviewed_at TEXT NOT NULL CHECK (julianday(reviewed_at) IS NOT NULL),
  PRIMARY KEY (subject_record_id, field_path, locale),
  FOREIGN KEY (subject_record_id, field_path, locale)
    REFERENCES canonical_fields(subject_record_id, field_path, locale)
    ON DELETE CASCADE
);

-- Binds a publication job to the exact immutable private-R2 artifact selected
-- for it. A retry must consume this artifact instead of rebuilding from newer
-- mutable Pipeline rows.
CREATE TABLE IF NOT EXISTS release_build_snapshots (
  publication_job_id TEXT PRIMARY KEY
    REFERENCES publication_jobs(id) ON DELETE RESTRICT,
  catalog_release_id TEXT NOT NULL UNIQUE,
  artifact_format_version INTEGER NOT NULL CHECK (artifact_format_version > 0),
  artifact_key TEXT NOT NULL UNIQUE CHECK (length(trim(artifact_key)) > 0),
  content_sha256 TEXT NOT NULL UNIQUE CHECK (
    length(content_sha256) = 64
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  counts_json TEXT NOT NULL CHECK (
    json_valid(counts_json) AND json_type(counts_json) = 'object'
  ),
  captured_at TEXT NOT NULL CHECK (julianday(captured_at) IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_release_build_snapshots_release
  ON release_build_snapshots(catalog_release_id, captured_at);

CREATE TRIGGER IF NOT EXISTS trg_release_build_snapshot_job_insert
BEFORE INSERT ON release_build_snapshots
WHEN NOT EXISTS (
  SELECT 1
  FROM publication_jobs job
  WHERE job.id = NEW.publication_job_id
    AND job.catalog_release_id = NEW.catalog_release_id
)
BEGIN
  SELECT RAISE(ABORT, 'release build snapshot must match its publication job');
END;
