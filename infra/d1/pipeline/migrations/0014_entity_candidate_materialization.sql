-- Deterministic promotion of source-backed directory entities into canonical records.
-- This is intentionally separate from promotion_field_mappings: one catalogue source
-- can discover many entities with the same candidate field names.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entity_materialization_decisions (
  candidate_id TEXT PRIMARY KEY
    REFERENCES extracted_entity_candidates(candidate_id) ON DELETE RESTRICT,
  registry_id TEXT NOT NULL
    REFERENCES entity_registry(registry_id) ON DELETE RESTRICT,
  decision_status TEXT NOT NULL CHECK (decision_status IN (
    'materialized', 'quarantined', 'conflict'
  )),
  canonical_record_id TEXT REFERENCES records(id) ON DELETE RESTRICT,
  reason_code TEXT CHECK (
    reason_code IS NULL OR length(trim(reason_code)) BETWEEN 1 AND 100
  ),
  issues_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  confidence_ppm INTEGER CHECK (
    confidence_ppm IS NULL OR confidence_ppm BETWEEN 0 AND 1000000
  ),
  materializer_version TEXT NOT NULL CHECK (
    length(trim(materializer_version)) BETWEEN 1 AND 100
  ),
  decided_at TEXT NOT NULL CHECK (julianday(decided_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (
      decision_status = 'materialized'
      AND canonical_record_id IS NOT NULL
      AND reason_code IS NULL
      AND json_array_length(issues_json) = 0
    )
    OR (
      decision_status IN ('quarantined', 'conflict')
      AND canonical_record_id IS NULL
      AND reason_code IS NOT NULL
      AND json_array_length(issues_json) > 0
    )
  )
);

CREATE TABLE IF NOT EXISTS entity_candidate_field_mappings (
  candidate_id TEXT NOT NULL
    REFERENCES entity_materialization_decisions(candidate_id) ON DELETE RESTRICT,
  candidate_field_path TEXT NOT NULL CHECK (
    length(trim(candidate_field_path)) BETWEEN 1 AND 200
  ),
  registry_id TEXT NOT NULL
    REFERENCES entity_registry(registry_id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL
    REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  subject_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  canonical_field_path TEXT NOT NULL CHECK (
    length(trim(canonical_field_path)) BETWEEN 1 AND 200
  ),
  locale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    candidate_id, candidate_field_path, canonical_field_path, locale
  ),
  UNIQUE (
    candidate_id, subject_record_id, canonical_field_path, locale
  )
);

CREATE TABLE IF NOT EXISTS entity_materialization_release_requests (
  request_id TEXT PRIMARY KEY CHECK (
    length(request_id) BETWEEN 1 AND 200
    AND request_id GLOB '[a-z0-9]*'
    AND request_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  release_window TEXT NOT NULL UNIQUE CHECK (
    date(release_window) IS NOT NULL AND release_window = date(release_window)
  ),
  publication_job_id TEXT NOT NULL UNIQUE
    REFERENCES publication_jobs(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  catalog_release_id TEXT NOT NULL UNIQUE CHECK (
    length(catalog_release_id) BETWEEN 1 AND 200
    AND catalog_release_id GLOB '[a-z0-9]*'
    AND catalog_release_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  outbox_event_id TEXT NOT NULL UNIQUE
    REFERENCES outbox_events(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  candidate_ids_json TEXT NOT NULL CHECK (
    json_valid(candidate_ids_json)
    AND json_type(candidate_ids_json) = 'array'
    AND json_array_length(candidate_ids_json) > 0
  ),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND json_extract(payload_json, '$.version') = 1
    AND json_extract(payload_json, '$.entityMaterializationRequestId')
      = request_id
    AND json_extract(payload_json, '$.publicationJobId') = publication_job_id
    AND json_extract(payload_json, '$.catalogReleaseId') = catalog_release_id
    AND json_extract(payload_json, '$.releaseWindow') = release_window
    AND json_extract(payload_json, '$.candidateIds') = candidate_ids_json
  ),
  requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (release_window = date(requested_at))
);

CREATE INDEX IF NOT EXISTS idx_entity_materialization_decisions_status
  ON entity_materialization_decisions(decision_status, decided_at);

CREATE INDEX IF NOT EXISTS idx_entity_candidate_field_mapping_target
  ON entity_candidate_field_mappings(
    subject_record_id, canonical_field_path, locale
  );

CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_decision_identity_insert
BEFORE INSERT ON entity_materialization_decisions
WHEN NOT EXISTS (
  SELECT 1
  FROM extracted_entity_candidates candidate
  JOIN entity_registry registry
    ON registry.registry_id = NEW.registry_id
   AND registry.institution_id = candidate.institution_id
   AND registry.entity_type = candidate.entity_type
   AND registry.entity_key = candidate.entity_key
  WHERE candidate.candidate_id = NEW.candidate_id
    AND (
      (
        NEW.decision_status = 'materialized'
        AND candidate.candidate_status = 'registered'
        AND registry.registry_status = 'active'
        AND registry.canonical_record_id = NEW.canonical_record_id
        AND EXISTS (
          SELECT 1 FROM records record
          WHERE record.id = NEW.canonical_record_id
            AND record.kind = candidate.entity_type
            AND record.workflow_status IN ('applied', 'published')
        )
      )
      OR (
        NEW.decision_status IN ('quarantined', 'conflict')
        AND candidate.candidate_status = 'quarantined'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'entity materialization decision does not match candidate state');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_decision_immutable_update
BEFORE UPDATE ON entity_materialization_decisions
BEGIN
  SELECT RAISE(ABORT, 'entity materialization decision is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_decision_immutable_delete
BEFORE DELETE ON entity_materialization_decisions
BEGIN
  SELECT RAISE(ABORT, 'entity materialization decision is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_candidate_field_mapping_insert
BEFORE INSERT ON entity_candidate_field_mappings
WHEN NOT EXISTS (
  SELECT 1
  FROM entity_materialization_decisions decision
  JOIN extracted_entity_candidates candidate
    ON candidate.candidate_id = decision.candidate_id
  JOIN entity_registry registry
    ON registry.registry_id = decision.registry_id
  JOIN records record ON record.id = decision.canonical_record_id
  JOIN field_definitions definition
    ON definition.record_kind = record.kind
   AND definition.field_path = NEW.canonical_field_path
  WHERE decision.candidate_id = NEW.candidate_id
    AND decision.decision_status = 'materialized'
    AND decision.registry_id = NEW.registry_id
    AND decision.canonical_record_id = NEW.subject_record_id
    AND candidate.source_id = NEW.source_id
    AND candidate.candidate_status = 'registered'
    AND registry.registry_status = 'active'
    AND registry.canonical_record_id = NEW.subject_record_id
)
BEGIN
  SELECT RAISE(ABORT, 'entity candidate field mapping lacks a materialized identity');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_candidate_field_mapping_immutable_update
BEFORE UPDATE ON entity_candidate_field_mappings
BEGIN
  SELECT RAISE(ABORT, 'entity candidate field mapping is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_candidate_field_mapping_immutable_delete
BEFORE DELETE ON entity_candidate_field_mappings
BEGIN
  SELECT RAISE(ABORT, 'entity candidate field mapping is immutable');
END;

-- The insert is the transaction boundary. It validates the complete candidate
-- cohort and creates one Release Builder outbox event for the UTC day.
CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_release_request_insert
AFTER INSERT ON entity_materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'entity materialization release candidate list is invalid')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.candidate_ids_json)
    WHERE type <> 'text' OR length(trim(value)) = 0
  )
  OR (
    SELECT COUNT(*) FROM json_each(NEW.candidate_ids_json)
  ) <> (
    SELECT COUNT(DISTINCT value) FROM json_each(NEW.candidate_ids_json)
  );

  SELECT RAISE(ABORT, 'entity materialization release contains an unsafe candidate')
  WHERE EXISTS (
    SELECT 1
    FROM json_each(NEW.candidate_ids_json) requested
    LEFT JOIN entity_materialization_decisions decision
      ON decision.candidate_id = requested.value
     AND decision.decision_status = 'materialized'
    LEFT JOIN extracted_entity_candidates candidate
      ON candidate.candidate_id = requested.value
     AND candidate.candidate_status = 'registered'
    LEFT JOIN entity_registry registry
      ON registry.registry_id = decision.registry_id
     AND registry.registry_status = 'active'
     AND registry.canonical_record_id = decision.canonical_record_id
    LEFT JOIN records record
      ON record.id = decision.canonical_record_id
     AND record.workflow_status IN ('applied', 'published')
    WHERE decision.candidate_id IS NULL
      OR candidate.candidate_id IS NULL
      OR registry.registry_id IS NULL
      OR record.id IS NULL
      OR julianday(NEW.requested_at) < julianday(decision.decided_at)
  );

  SELECT RAISE(ABORT, 'entity materialization release downstream identity collision')
  WHERE EXISTS (
    SELECT 1 FROM publication_jobs job
    WHERE job.id = NEW.publication_job_id
      OR job.catalog_release_id = NEW.catalog_release_id
  )
  OR EXISTS (
    SELECT 1 FROM outbox_events event
    WHERE event.id = NEW.outbox_event_id
      OR (
        event.event_type = 'catalog.release.requested'
        AND event.aggregate_id = NEW.publication_job_id
      )
  );

  INSERT INTO publication_jobs (
    id, catalog_release_id, job_status, source_change_set_ids_json,
    expected_counts_json, created_at
  ) VALUES (
    NEW.publication_job_id, NEW.catalog_release_id, 'queued', '[]',
    json_object(
      'entityCandidates', json_array_length(NEW.candidate_ids_json),
      'releaseWindow', NEW.release_window
    ),
    NEW.requested_at
  );

  INSERT INTO outbox_events (
    id, event_type, aggregate_id, payload_json, event_status,
    attempt_count, available_at, created_at
  ) VALUES (
    NEW.outbox_event_id, 'catalog.release.requested',
    NEW.publication_job_id, NEW.payload_json, 'pending', 0,
    NEW.requested_at, NEW.requested_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_release_request_update
BEFORE UPDATE ON entity_materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'entity materialization release request is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_materialization_release_request_delete
BEFORE DELETE ON entity_materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'entity materialization release request is immutable');
END;

PRAGMA optimize;
