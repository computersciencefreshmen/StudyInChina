-- Fail-closed, single-statement catalog release activation.
--
-- A publisher inserts one activation request only after the compatibility
-- envelope has been uploaded to R2. The trigger validates the immutable
-- release metadata and all six public row counts before changing any public
-- state. SQLite executes the INSERT and every trigger statement atomically:
-- a failed check rolls back the request and leaves the previous release live.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS release_activation_requests (
  request_id TEXT PRIMARY KEY CHECK (length(trim(request_id)) > 0),
  release_id TEXT NOT NULL UNIQUE
    REFERENCES catalog_releases(release_id) ON DELETE RESTRICT,
  expected_content_sha256 TEXT NOT NULL CHECK (
    length(expected_content_sha256) = 64
    AND expected_content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  expected_counts_json TEXT NOT NULL CHECK (
    json_valid(expected_counts_json)
    AND json_type(expected_counts_json) = 'object'
    AND COALESCE(json_type(expected_counts_json, '$.sources') = 'integer', 0)
    AND COALESCE(json_type(expected_counts_json, '$.cities') = 'integer', 0)
    AND COALESCE(json_type(expected_counts_json, '$.universities') = 'integer', 0)
    AND COALESCE(json_type(expected_counts_json, '$.programs') = 'integer', 0)
    AND COALESCE(json_type(expected_counts_json, '$.admissionCycles') = 'integer', 0)
    AND COALESCE(json_type(expected_counts_json, '$.scholarships') = 'integer', 0)
    AND json_extract(expected_counts_json, '$.sources') >= 0
    AND json_extract(expected_counts_json, '$.cities') >= 0
    AND json_extract(expected_counts_json, '$.universities') >= 0
    AND json_extract(expected_counts_json, '$.programs') >= 0
    AND json_extract(expected_counts_json, '$.admissionCycles') >= 0
    AND json_extract(expected_counts_json, '$.scholarships') >= 0
  ),
  actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
  requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
  previous_release_id TEXT
    REFERENCES catalog_releases(release_id) ON DELETE RESTRICT,
  completed_at TEXT CHECK (completed_at IS NULL OR julianday(completed_at) IS NOT NULL)
);

CREATE TRIGGER IF NOT EXISTS trg_release_activation_request
AFTER INSERT ON release_activation_requests
BEGIN
  SELECT RAISE(ABORT, 'release must be ready and validated before activation')
  WHERE NOT EXISTS (
    SELECT 1
    FROM catalog_releases
    WHERE release_id = NEW.release_id
      AND release_status = 'ready'
      AND validated_at IS NOT NULL
  );

  SELECT RAISE(ABORT, 'release compatibility envelope checksum mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM catalog_releases
    WHERE release_id = NEW.release_id
      AND content_sha256 = NEW.expected_content_sha256
  );

  SELECT RAISE(ABORT, 'activation request counts do not match release metadata')
  WHERE EXISTS (
    SELECT 1
    FROM catalog_releases
    WHERE release_id = NEW.release_id
      AND (
        json_extract(counts_json, '$.sources')
          <> json_extract(NEW.expected_counts_json, '$.sources')
        OR json_extract(counts_json, '$.cities')
          <> json_extract(NEW.expected_counts_json, '$.cities')
        OR json_extract(counts_json, '$.universities')
          <> json_extract(NEW.expected_counts_json, '$.universities')
        OR json_extract(counts_json, '$.programs')
          <> json_extract(NEW.expected_counts_json, '$.programs')
        OR json_extract(counts_json, '$.admissionCycles')
          <> json_extract(NEW.expected_counts_json, '$.admissionCycles')
        OR json_extract(counts_json, '$.scholarships')
          <> json_extract(NEW.expected_counts_json, '$.scholarships')
      )
  );

  SELECT RAISE(ABORT, 'catalog row counts do not match validated release counts')
  WHERE (SELECT count(*) FROM source_summaries WHERE release_id = NEW.release_id)
      <> json_extract(NEW.expected_counts_json, '$.sources')
    OR (SELECT count(*) FROM locations
        WHERE release_id = NEW.release_id AND location_type = 'city')
      <> json_extract(NEW.expected_counts_json, '$.cities')
    OR (SELECT count(*) FROM institutions WHERE release_id = NEW.release_id)
      <> json_extract(NEW.expected_counts_json, '$.universities')
    OR (SELECT count(*) FROM programs WHERE release_id = NEW.release_id)
      <> json_extract(NEW.expected_counts_json, '$.programs')
    OR (SELECT count(*) FROM program_cycles WHERE release_id = NEW.release_id)
      <> json_extract(NEW.expected_counts_json, '$.admissionCycles')
    OR (SELECT count(*) FROM scholarships WHERE release_id = NEW.release_id)
      <> json_extract(NEW.expected_counts_json, '$.scholarships');

  UPDATE release_activation_requests
  SET previous_release_id = (
    SELECT current_release_id FROM release_pointer WHERE singleton_id = 1
  )
  WHERE request_id = NEW.request_id;

  INSERT OR IGNORE INTO release_audit_log (
    id, release_id, action, actor, detail_json, occurred_at
  )
  SELECT
    'audit-retire-' || current_release_id || '-for-' || NEW.release_id,
    current_release_id,
    'retired',
    NEW.actor,
    json_object('replacementReleaseId', NEW.release_id),
    NEW.requested_at
  FROM release_pointer
  WHERE singleton_id = 1
    AND current_release_id IS NOT NULL
    AND current_release_id <> NEW.release_id;

  UPDATE catalog_releases
  SET release_status = 'retired'
  WHERE release_status = 'active'
    AND release_id <> NEW.release_id;

  UPDATE catalog_releases
  SET release_status = 'active', activated_at = NEW.requested_at
  WHERE release_id = NEW.release_id
    AND release_status = 'ready';

  UPDATE release_pointer
  SET current_release_id = NEW.release_id,
      updated_at = NEW.requested_at,
      updated_by = NEW.actor
  WHERE singleton_id = 1;

  INSERT OR IGNORE INTO release_audit_log (
    id, release_id, action, actor, detail_json, occurred_at
  ) VALUES (
    'audit-activate-' || NEW.release_id,
    NEW.release_id,
    'activated',
    NEW.actor,
    json_object(
      'contentSha256', NEW.expected_content_sha256,
      'counts', json(NEW.expected_counts_json),
      'activationRequestId', NEW.request_id
    ),
    NEW.requested_at
  );

  UPDATE release_activation_requests
  SET completed_at = NEW.requested_at
  WHERE request_id = NEW.request_id;
END;

