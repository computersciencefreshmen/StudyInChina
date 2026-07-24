-- Keep normalized releases and legacy frontend bundles as separate byte contracts.
-- If no lossless legacy projection exists, this row is absent and callers fail closed.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS release_compatibility_artifacts (
  release_id TEXT PRIMARY KEY
    REFERENCES catalog_releases(release_id) ON DELETE CASCADE,
  artifact_format TEXT NOT NULL
    CHECK (artifact_format = 'studyinchina.frontend.bundle.v1'),
  artifact_key TEXT NOT NULL UNIQUE CHECK (
    artifact_key = 'releases/' || release_id || '/compat-envelope.json'
  ),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  byte_length INTEGER NOT NULL CHECK (
    byte_length BETWEEN 2 AND 20971520
  ),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL)
);

CREATE TRIGGER IF NOT EXISTS trg_release_compatibility_artifact_immutable_update
BEFORE UPDATE ON release_compatibility_artifacts
BEGIN
  SELECT RAISE(ABORT, 'release compatibility artifact metadata is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_compatibility_artifact_immutable_delete
BEFORE DELETE ON release_compatibility_artifacts
WHEN EXISTS (
  SELECT 1 FROM catalog_releases
  WHERE release_id = OLD.release_id
    AND release_status IN ('active', 'retired')
)
BEGIN
  SELECT RAISE(ABORT, 'published release compatibility artifact is immutable');
END;

CREATE INDEX IF NOT EXISTS idx_release_compatibility_artifact_key
  ON release_compatibility_artifacts(artifact_key);

CREATE TRIGGER IF NOT EXISTS trg_release_activation_requires_compatibility
BEFORE INSERT ON release_activation_requests
WHEN NOT EXISTS (
  SELECT 1 FROM release_compatibility_artifacts
  WHERE release_id = NEW.release_id
)
BEGIN
  SELECT RAISE(ABORT, 'release compatibility artifact metadata is required');
END;
