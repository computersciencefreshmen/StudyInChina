-- A rollback changes only the publication pointer and release lifecycle state.
-- Published rows, artifacts and their original activation timestamps stay intact.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS release_pointer_revision (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT OR IGNORE INTO release_pointer_revision VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS trg_release_pointer_revision
AFTER UPDATE OF current_release_id ON release_pointer
WHEN OLD.current_release_id IS NOT NEW.current_release_id
BEGIN
  UPDATE release_pointer_revision SET revision = revision + 1 WHERE singleton_id = 1;
END;

CREATE TABLE IF NOT EXISTS admin_release_rollbacks (
  command_id TEXT PRIMARY KEY,
  -- Logical identities are retained after normal catalog retention purges rows.
  previous_release_id TEXT NOT NULL CHECK (length(previous_release_id) > 0),
  target_release_id TEXT NOT NULL CHECK (length(target_release_id) > 0),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  expected_content_sha256 TEXT NOT NULL CHECK (length(expected_content_sha256) = 64 AND expected_content_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_compatibility_sha256 TEXT NOT NULL CHECK (length(expected_compatibility_sha256) = 64 AND expected_compatibility_sha256 NOT GLOB '*[^0-9a-f]*'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 300),
  actor TEXT NOT NULL CHECK (length(trim(actor)) > 0),
  completed_at TEXT NOT NULL CHECK (julianday(completed_at) IS NOT NULL),
  CHECK (previous_release_id <> target_release_id)
);

CREATE TRIGGER IF NOT EXISTS trg_admin_release_rollback
AFTER INSERT ON admin_release_rollbacks
BEGIN
  SELECT RAISE(ABORT, 'release_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM release_pointer p JOIN release_pointer_revision r ON r.singleton_id = p.singleton_id
    WHERE p.singleton_id = 1 AND p.current_release_id = NEW.previous_release_id AND r.revision = NEW.expected_revision
  );
  SELECT RAISE(ABORT, 'release_not_available') WHERE NOT EXISTS (
    SELECT 1 FROM catalog_releases r JOIN release_compatibility_artifacts a ON a.release_id = r.release_id
    WHERE r.release_id = NEW.target_release_id AND r.release_status = 'retired'
      AND r.validated_at IS NOT NULL AND r.activated_at IS NOT NULL
      AND r.content_sha256 = NEW.expected_content_sha256
      AND a.content_sha256 = NEW.expected_compatibility_sha256
      AND a.artifact_key = 'releases/' || r.release_id || '/compat-envelope.json'
      AND NOT EXISTS (SELECT 1 FROM release_retention_audit WHERE release_id = r.release_id)
  );
  SELECT RAISE(ABORT, 'release_counts_invalid') WHERE EXISTS (
    SELECT 1 FROM catalog_releases r WHERE r.release_id = NEW.target_release_id AND (
      (SELECT count(*) FROM source_summaries WHERE release_id = r.release_id) <> json_extract(r.counts_json, '$.sources')
      OR (SELECT count(*) FROM locations WHERE release_id = r.release_id AND location_type = 'city') <> json_extract(r.counts_json, '$.cities')
      OR (SELECT count(*) FROM institutions WHERE release_id = r.release_id) <> json_extract(r.counts_json, '$.universities')
      OR (SELECT count(*) FROM programs WHERE release_id = r.release_id) <> json_extract(r.counts_json, '$.programs')
      OR (SELECT count(*) FROM program_cycles WHERE release_id = r.release_id) <> json_extract(r.counts_json, '$.admissionCycles')
      OR (SELECT count(*) FROM scholarships WHERE release_id = r.release_id) <> json_extract(r.counts_json, '$.scholarships')
    )
  );
  UPDATE catalog_releases SET release_status = 'retired' WHERE release_id = NEW.previous_release_id AND release_status = 'active';
  UPDATE catalog_releases SET release_status = 'active' WHERE release_id = NEW.target_release_id AND release_status = 'retired';
  UPDATE release_pointer SET current_release_id = NEW.target_release_id, updated_at = NEW.completed_at, updated_by = NEW.actor WHERE singleton_id = 1;
  INSERT INTO release_audit_log (id, release_id, action, actor, detail_json, occurred_at)
    VALUES ('admin-rollback-retire-' || NEW.command_id, NEW.previous_release_id, 'retired', NEW.actor,
      json_object('commandId', NEW.command_id, 'replacementReleaseId', NEW.target_release_id, 'reason', NEW.reason, 'operation', 'rollback'), NEW.completed_at);
  INSERT INTO release_audit_log (id, release_id, action, actor, detail_json, occurred_at)
    VALUES ('admin-rollback-activate-' || NEW.command_id, NEW.target_release_id, 'activated', NEW.actor,
      json_object('commandId', NEW.command_id, 'previousReleaseId', NEW.previous_release_id, 'reason', NEW.reason, 'operation', 'rollback'), NEW.completed_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_release_rollback_immutable_update BEFORE UPDATE ON admin_release_rollbacks
BEGIN SELECT RAISE(ABORT, 'rollback audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_admin_release_rollback_immutable_delete BEFORE DELETE ON admin_release_rollbacks
BEGIN SELECT RAISE(ABORT, 'rollback audit is immutable'); END;
