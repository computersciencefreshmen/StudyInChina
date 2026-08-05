-- Keep only the active Catalog release and its two newest rollback releases.
-- Immutable release artifacts remain in private R2; this table is the durable
-- D1 tombstone proving which version was removed from the query database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS release_retention_audit (
  release_id TEXT PRIMARY KEY,
  data_version INTEGER NOT NULL CHECK (data_version > 0),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64
    AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  counts_json TEXT NOT NULL CHECK (
    json_valid(counts_json) AND json_type(counts_json) = 'object'
  ),
  normalized_artifact_key TEXT NOT NULL CHECK (
    normalized_artifact_key = 'releases/' || release_id || '/catalog-release.v1.json'
  ),
  compatibility_artifact_key TEXT NOT NULL CHECK (
    compatibility_artifact_key = 'releases/' || release_id || '/compat-envelope.json'
  ),
  activated_at TEXT NOT NULL CHECK (julianday(activated_at) IS NOT NULL),
  purged_at TEXT NOT NULL CHECK (julianday(purged_at) IS NOT NULL),
  actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
  reason TEXT NOT NULL CHECK (reason = 'catalog_release_retention')
);

CREATE INDEX IF NOT EXISTS idx_release_retention_purged_at
  ON release_retention_audit(purged_at DESC, release_id);

CREATE TRIGGER IF NOT EXISTS trg_release_retention_candidate_guard
BEFORE INSERT ON release_retention_audit
BEGIN
  SELECT RAISE(ABORT, 'only a retired release can be purged by retention')
  WHERE NOT EXISTS (
    SELECT 1 FROM catalog_releases release
    WHERE release.release_id = NEW.release_id
      AND release.release_status = 'retired'
      AND release.activated_at IS NOT NULL
      AND release.content_sha256 = NEW.content_sha256
      AND release.data_version = NEW.data_version
  );

  SELECT RAISE(ABORT, 'current Catalog release is retention-protected')
  WHERE EXISTS (
    SELECT 1 FROM release_pointer pointer
    WHERE pointer.singleton_id = 1
      AND pointer.current_release_id = NEW.release_id
  );

  -- Two newer retired versions plus the active version form the three-release
  -- safety window. Ties are ordered deterministically by data_version.
  SELECT RAISE(ABORT, 'two newer rollback releases must exist before purge')
  WHERE (
    SELECT count(*)
    FROM catalog_releases candidate
    JOIN catalog_releases newer
      ON newer.release_status = 'retired'
     AND (
       newer.activated_at > candidate.activated_at
       OR (
         newer.activated_at = candidate.activated_at
         AND newer.data_version > candidate.data_version
       )
     )
    WHERE candidate.release_id = NEW.release_id
      AND candidate.release_status = 'retired'
  ) < 2;
END;

CREATE TRIGGER IF NOT EXISTS trg_release_retention_audit_immutable_update
BEFORE UPDATE ON release_retention_audit
BEGIN
  SELECT RAISE(ABORT, 'release retention audit is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_retention_audit_immutable_delete
BEFORE DELETE ON release_retention_audit
BEGIN
  SELECT RAISE(ABORT, 'release retention audit is immutable');
END;

-- Published compatibility metadata remains immutable during normal operation.
-- A guarded retention tombstone is the sole authorization for deletion after
-- the release has aged outside the rollback window.
DROP TRIGGER IF EXISTS trg_release_compatibility_artifact_immutable_delete;

CREATE TRIGGER trg_release_compatibility_artifact_immutable_delete
BEFORE DELETE ON release_compatibility_artifacts
WHEN EXISTS (
  SELECT 1 FROM catalog_releases
  WHERE release_id = OLD.release_id
    AND release_status IN ('active', 'retired')
)
AND NOT EXISTS (
  SELECT 1 FROM release_retention_audit
  WHERE release_id = OLD.release_id
)
BEGIN
  SELECT RAISE(ABORT, 'published release compatibility artifact is immutable');
END;
