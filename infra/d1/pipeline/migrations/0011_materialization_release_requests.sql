-- Atomic, idempotent Catalog release requests for verified materialization pairs.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS materialization_release_requests (
  request_id TEXT PRIMARY KEY CHECK (
    length(request_id) BETWEEN 1 AND 200
    AND request_id GLOB '[a-z0-9]*'
    AND request_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  catalog_batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE RESTRICT
    CHECK (
      length(catalog_batch_id) = 64
      AND catalog_batch_id NOT GLOB '*[^0-9a-f]*'
    ),
  dependency_batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE RESTRICT
    CHECK (
      length(dependency_batch_id) = 64
      AND dependency_batch_id NOT GLOB '*[^0-9a-f]*'
    ),
  publication_job_id TEXT NOT NULL UNIQUE
    REFERENCES publication_jobs(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
    CHECK (
    length(publication_job_id) BETWEEN 1 AND 200
    AND publication_job_id GLOB '[a-z0-9]*'
    AND publication_job_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  catalog_release_id TEXT NOT NULL UNIQUE CHECK (
    length(catalog_release_id) BETWEEN 1 AND 200
    AND catalog_release_id GLOB '[a-z0-9]*'
    AND catalog_release_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  outbox_event_id TEXT NOT NULL UNIQUE
    REFERENCES outbox_events(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
    CHECK (
    length(outbox_event_id) BETWEEN 1 AND 200
    AND outbox_event_id GLOB '[a-z0-9]*'
    AND outbox_event_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND COALESCE(json_type(payload_json, '$.version') = 'integer', 0)
    AND json_extract(payload_json, '$.version') = 1
    AND COALESCE(json_type(
      payload_json, '$.materializationRequestId'
    ) = 'text', 0)
    AND json_extract(
      payload_json, '$.materializationRequestId'
    ) = request_id
    AND COALESCE(json_type(
      payload_json, '$.publicationJobId'
    ) = 'text', 0)
    AND json_extract(payload_json, '$.publicationJobId') = publication_job_id
    AND COALESCE(json_type(
      payload_json, '$.catalogReleaseId'
    ) = 'text', 0)
    AND json_extract(payload_json, '$.catalogReleaseId') = catalog_release_id
    AND COALESCE(json_type(
      payload_json, '$.catalogBatchId'
    ) = 'text', 0)
    AND json_extract(payload_json, '$.catalogBatchId') = catalog_batch_id
    AND COALESCE(json_type(
      payload_json, '$.dependencyBatchId'
    ) = 'text', 0)
    AND json_extract(
      payload_json, '$.dependencyBatchId'
    ) = dependency_batch_id
  ),
  requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (
    julianday(created_at) IS NOT NULL
  ),
  UNIQUE (catalog_batch_id, dependency_batch_id),
  CHECK (catalog_batch_id <> dependency_batch_id)
);

CREATE INDEX IF NOT EXISTS idx_materialization_release_requests_batches
  ON materialization_release_requests(
    catalog_batch_id, dependency_batch_id, requested_at
  );

-- One caller INSERT is the transaction boundary. Every validation and both
-- downstream inserts run in that statement; RAISE(ABORT) rolls all of it back.
CREATE TRIGGER IF NOT EXISTS trg_materialization_release_request_insert
AFTER INSERT ON materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'materialization release payload contract mismatch')
  WHERE (
    (SELECT COUNT(*) FROM json_each(NEW.payload_json)) <> 6
    OR EXISTS (
      SELECT 1
      FROM json_each(NEW.payload_json)
      WHERE key NOT IN (
        'version',
        'materializationRequestId',
        'publicationJobId',
        'catalogReleaseId',
        'catalogBatchId',
        'dependencyBatchId'
      )
    )
  );

  SELECT RAISE(ABORT, 'catalog materialization batch is not release-ready')
  WHERE NOT EXISTS (
    SELECT 1
    FROM materialization_batches batch
    WHERE batch.batch_id = NEW.catalog_batch_id
      AND batch.batch_purpose = 'catalog_entities'
      AND batch.batch_status = 'applied'
      AND batch.provenance_status = 'complete'
      AND batch.completed_at IS NOT NULL
      AND batch.expected_programs >= 1000
      AND batch.expected_scholarships >= 50
      AND batch.expected_organizations = 0
      AND batch.expected_locations = 0
      AND batch.expected_records = (
        batch.expected_programs + batch.expected_scholarships
      )
      AND julianday(NEW.requested_at) >= julianday(batch.completed_at)
  );

  SELECT RAISE(ABORT, 'dependency materialization batch is not release-ready')
  WHERE NOT EXISTS (
    SELECT 1
    FROM materialization_batches batch
    WHERE batch.batch_id = NEW.dependency_batch_id
      AND batch.batch_purpose = 'dependencies'
      AND batch.batch_status = 'applied'
      AND batch.provenance_status = 'complete'
      AND batch.completed_at IS NOT NULL
      AND batch.expected_programs = 0
      AND batch.expected_scholarships = 0
      AND batch.expected_organizations > 0
      AND batch.expected_locations > 0
      AND batch.expected_records = (
        batch.expected_organizations + batch.expected_locations
      )
      AND julianday(NEW.requested_at) >= julianday(batch.completed_at)
  );

  SELECT RAISE(ABORT, 'catalog materialization mappings are incomplete')
  WHERE EXISTS (
    SELECT 1
    FROM materialization_batches batch
    WHERE batch.batch_id = NEW.catalog_batch_id
      AND (
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         WHERE mapped.batch_id = batch.batch_id) <> batch.expected_records
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN records record ON record.id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND record.workflow_status IN ('applied', 'published')
        ) <> batch.expected_records
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN programs program ON program.record_id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND mapped.record_kind = 'program'
        ) <> batch.expected_programs
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN scholarships scholarship
           ON scholarship.record_id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND mapped.record_kind = 'scholarship'
        ) <> batch.expected_scholarships
      )
  );

  SELECT RAISE(ABORT, 'dependency materialization mappings are incomplete')
  WHERE EXISTS (
    SELECT 1
    FROM materialization_batches batch
    WHERE batch.batch_id = NEW.dependency_batch_id
      AND (
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         WHERE mapped.batch_id = batch.batch_id) <> batch.expected_records
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN records record ON record.id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND record.workflow_status IN ('applied', 'published')
        ) <> batch.expected_records
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN organizations organization
           ON organization.record_id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND mapped.record_kind = 'organization'
        ) <> batch.expected_organizations
        OR
        (SELECT COUNT(*)
         FROM materialization_batch_records mapped
         JOIN locations location ON location.record_id = mapped.record_id
         WHERE mapped.batch_id = batch.batch_id
           AND mapped.record_kind = 'location'
        ) <> batch.expected_locations
      )
  );

  SELECT RAISE(
    ABORT,
    'catalog program institution is absent from dependency batch'
  )
  WHERE EXISTS (
    SELECT 1
    FROM materialization_batch_records catalog_record
    JOIN programs program ON program.record_id = catalog_record.record_id
    WHERE catalog_record.batch_id = NEW.catalog_batch_id
      AND catalog_record.record_kind = 'program'
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records dependency_record
        JOIN organizations organization
          ON organization.record_id = dependency_record.record_id
        WHERE dependency_record.batch_id = NEW.dependency_batch_id
          AND dependency_record.record_kind = 'organization'
          AND dependency_record.record_id = program.institution_id
      )
  );

  SELECT RAISE(
    ABORT,
    'catalog scholarship provider is absent from dependency batch'
  )
  WHERE EXISTS (
    SELECT 1
    FROM materialization_batch_records catalog_record
    JOIN scholarships scholarship
      ON scholarship.record_id = catalog_record.record_id
    WHERE catalog_record.batch_id = NEW.catalog_batch_id
      AND catalog_record.record_kind = 'scholarship'
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records dependency_record
        JOIN organizations organization
          ON organization.record_id = dependency_record.record_id
        WHERE dependency_record.batch_id = NEW.dependency_batch_id
          AND dependency_record.record_kind = 'organization'
          AND dependency_record.record_id =
            scholarship.provider_organization_id
      )
  );

  SELECT RAISE(
    ABORT,
    'catalog institution city is absent from dependency batch'
  )
  WHERE EXISTS (
    SELECT 1
    FROM materialization_batch_records catalog_record
    JOIN programs program ON program.record_id = catalog_record.record_id
    JOIN institutions institution
      ON institution.record_id = program.institution_id
    WHERE catalog_record.batch_id = NEW.catalog_batch_id
      AND catalog_record.record_kind = 'program'
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records dependency_record
        JOIN locations location
          ON location.record_id = dependency_record.record_id
        WHERE dependency_record.batch_id = NEW.dependency_batch_id
          AND dependency_record.record_kind = 'location'
          AND dependency_record.record_id = institution.city_id
      )
  );

  SELECT RAISE(ABORT, 'materialization release downstream identity collision')
  WHERE EXISTS (
    SELECT 1
    FROM publication_jobs job
    WHERE job.id = NEW.publication_job_id
      OR job.catalog_release_id = NEW.catalog_release_id
  )
  OR EXISTS (
    SELECT 1
    FROM outbox_events event
    WHERE event.id = NEW.outbox_event_id
      OR (
        event.event_type = 'catalog.release.requested'
        AND event.aggregate_id = NEW.publication_job_id
      )
  );

  INSERT INTO publication_jobs (
    id,
    catalog_release_id,
    job_status,
    source_change_set_ids_json,
    expected_counts_json,
    created_at
  )
  SELECT
    NEW.publication_job_id,
    NEW.catalog_release_id,
    'queued',
    '[]',
    json_object(
      'programs', catalog.expected_programs,
      'scholarships', catalog.expected_scholarships,
      'organizations', dependency.expected_organizations,
      'locations', dependency.expected_locations,
      'catalogBatchId', NEW.catalog_batch_id,
      'dependencyBatchId', NEW.dependency_batch_id
    ),
    NEW.requested_at
  FROM materialization_batches catalog
  JOIN materialization_batches dependency
    ON dependency.batch_id = NEW.dependency_batch_id
  WHERE catalog.batch_id = NEW.catalog_batch_id;

  INSERT INTO outbox_events (
    id,
    event_type,
    aggregate_id,
    payload_json,
    event_status,
    attempt_count,
    available_at,
    created_at
  ) VALUES (
    NEW.outbox_event_id,
    'catalog.release.requested',
    NEW.publication_job_id,
    NEW.payload_json,
    'pending',
    0,
    NEW.requested_at,
    NEW.requested_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_release_request_update
BEFORE UPDATE ON materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'materialization release request is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_release_request_delete
BEFORE DELETE ON materialization_release_requests
BEGIN
  SELECT RAISE(ABORT, 'materialization release request is immutable');
END;
