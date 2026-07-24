-- Resumable, source-backed official entity materialization batches.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS materialization_batches (
  batch_id TEXT PRIMARY KEY CHECK (
    length(batch_id) = 64 AND batch_id NOT GLOB '*[^0-9a-f]*'
  ),
  materializer_version TEXT NOT NULL CHECK (
    length(trim(materializer_version)) BETWEEN 1 AND 100
  ),
  package_digest TEXT NOT NULL CHECK (
    length(package_digest) = 64 AND package_digest NOT GLOB '*[^0-9a-f]*'
  ),
  batch_purpose TEXT NOT NULL DEFAULT 'catalog_entities' CHECK (
    batch_purpose IN ('catalog_entities', 'dependencies')
  ),
  batch_status TEXT NOT NULL DEFAULT 'prepared' CHECK (batch_status IN (
    'prepared', 'reserving', 'reserved', 'importing', 'applied', 'failed',
    'superseded'
  )),
  provenance_status TEXT NOT NULL DEFAULT 'unknown' CHECK (provenance_status IN (
    'unknown', 'fixture', 'derived_only', 'complete'
  )),
  expected_chunks INTEGER NOT NULL DEFAULT 0 CHECK (expected_chunks >= 0),
  expected_records INTEGER NOT NULL CHECK (expected_records > 0),
  expected_programs INTEGER NOT NULL CHECK (expected_programs >= 0),
  expected_scholarships INTEGER NOT NULL CHECK (expected_scholarships >= 0),
  expected_organizations INTEGER NOT NULL DEFAULT 0 CHECK (
    expected_organizations >= 0
  ),
  expected_locations INTEGER NOT NULL DEFAULT 0 CHECK (
    expected_locations >= 0
  ),
  expected_claims INTEGER NOT NULL CHECK (expected_claims > 0),
  expected_canonical_fields INTEGER NOT NULL CHECK (
    expected_canonical_fields > 0
  ),
  expected_evidence_fragments INTEGER NOT NULL CHECK (
    expected_evidence_fragments > 0
  ),
  expected_source_documents INTEGER NOT NULL CHECK (
    expected_source_documents > 0
  ),
  manifest_json TEXT NOT NULL CHECK (
    json_valid(manifest_json) AND json_type(manifest_json) = 'object'
  ),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  started_at TEXT CHECK (
    started_at IS NULL OR julianday(started_at) IS NOT NULL
  ),
  completed_at TEXT CHECK (
    completed_at IS NULL OR julianday(completed_at) IS NOT NULL
  ),
  error_code TEXT,
  error_detail TEXT,
  superseded_by_batch_id TEXT
    REFERENCES materialization_batches(batch_id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  CHECK (
    expected_records = expected_programs + expected_scholarships
      + expected_organizations + expected_locations
  ),
  CHECK (
    (
      batch_purpose = 'catalog_entities'
      AND expected_organizations = 0
      AND expected_locations = 0
    )
    OR
    (
      batch_purpose = 'dependencies'
      AND expected_programs = 0
      AND expected_scholarships = 0
      AND expected_organizations > 0
      AND expected_locations > 0
    )
  ),
  CHECK (batch_status <> 'applied' OR (
    provenance_status = 'complete'
    AND expected_chunks > 0
    AND completed_at IS NOT NULL
  )),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (batch_status = 'superseded' AND superseded_by_batch_id IS NOT NULL)
    OR (batch_status <> 'superseded' AND superseded_by_batch_id IS NULL)
  ),
  CHECK (superseded_by_batch_id IS NULL OR superseded_by_batch_id <> batch_id)
);

CREATE TABLE IF NOT EXISTS materialization_batch_chunks (
  batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE CASCADE,
  chunk_number INTEGER NOT NULL CHECK (chunk_number > 0),
  package_digest TEXT NOT NULL CHECK (
    length(package_digest) = 64 AND package_digest NOT GLOB '*[^0-9a-f]*'
  ),
  chunk_sha256 TEXT NOT NULL CHECK (
    length(chunk_sha256) = 64 AND chunk_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  statement_count INTEGER NOT NULL CHECK (statement_count > 0),
  applied_at TEXT NOT NULL CHECK (julianday(applied_at) IS NOT NULL),
  PRIMARY KEY (batch_id, chunk_number),
  UNIQUE (batch_id, chunk_sha256)
);

CREATE TABLE IF NOT EXISTS materialization_batch_record_intents (
  batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL CHECK (length(trim(record_id)) > 0),
  record_kind TEXT NOT NULL CHECK (record_kind IN (
    'program', 'scholarship', 'organization', 'location'
  )),
  package_digest TEXT NOT NULL CHECK (
    length(package_digest) = 64 AND package_digest NOT GLOB '*[^0-9a-f]*'
  ),
  reserved_at TEXT NOT NULL CHECK (julianday(reserved_at) IS NOT NULL),
  PRIMARY KEY (batch_id, record_id)
);

CREATE TABLE IF NOT EXISTS materialization_batch_records (
  batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  record_kind TEXT NOT NULL CHECK (record_kind IN (
    'program', 'scholarship', 'organization', 'location'
  )),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  PRIMARY KEY (batch_id, record_id)
);

CREATE TABLE IF NOT EXISTS materialization_batch_source_artifacts (
  batch_id TEXT NOT NULL
    REFERENCES materialization_batches(batch_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL
    REFERENCES source_documents(id) ON DELETE RESTRICT,
  fetch_id TEXT NOT NULL REFERENCES source_fetches(id) ON DELETE RESTRICT,
  artifact_sha256 TEXT NOT NULL CHECK (
    length(artifact_sha256) = 64
    AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_uri TEXT NOT NULL CHECK (
    artifact_uri LIKE 'r2://studyinchina-source-snapshots/%'
    AND instr(artifact_uri, artifact_sha256) > 0
  ),
  content_type TEXT NOT NULL CHECK (length(trim(content_type)) > 0),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  captured_at TEXT NOT NULL CHECK (julianday(captured_at) IS NOT NULL),
  PRIMARY KEY (batch_id, source_id),
  UNIQUE (batch_id, fetch_id)
);

CREATE INDEX IF NOT EXISTS idx_materialization_batches_status
  ON materialization_batches(batch_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_materialization_batch_intents_record
  ON materialization_batch_record_intents(record_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_materialization_batch_records_record
  ON materialization_batch_records(record_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_materialization_batch_artifacts_fetch
  ON materialization_batch_source_artifacts(fetch_id, batch_id);

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_identity_immutable
BEFORE UPDATE OF
  batch_id, materializer_version, package_digest, batch_purpose,
  provenance_status, expected_chunks, expected_records, expected_programs,
  expected_scholarships, expected_organizations, expected_locations,
  expected_claims, expected_canonical_fields, expected_evidence_fragments,
  expected_source_documents, manifest_json, created_at
ON materialization_batches
WHEN NEW.batch_id <> OLD.batch_id
  OR NEW.materializer_version <> OLD.materializer_version
  OR NEW.package_digest <> OLD.package_digest
  OR NEW.batch_purpose <> OLD.batch_purpose
  OR NEW.provenance_status <> OLD.provenance_status
  OR NEW.expected_chunks <> OLD.expected_chunks
  OR NEW.expected_records <> OLD.expected_records
  OR NEW.expected_programs <> OLD.expected_programs
  OR NEW.expected_scholarships <> OLD.expected_scholarships
  OR NEW.expected_organizations <> OLD.expected_organizations
  OR NEW.expected_locations <> OLD.expected_locations
  OR NEW.expected_claims <> OLD.expected_claims
  OR NEW.expected_canonical_fields <> OLD.expected_canonical_fields
  OR NEW.expected_evidence_fragments <> OLD.expected_evidence_fragments
  OR NEW.expected_source_documents <> OLD.expected_source_documents
  OR NEW.manifest_json <> OLD.manifest_json
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'materialization batch package identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_manifest_identity_insert
BEFORE INSERT ON materialization_batches
WHEN COALESCE(
  json_extract(NEW.manifest_json, '$.format')
    = 'studyinchina.pipeline.materialization-batch'
  AND json_extract(NEW.manifest_json, '$.formatVersion') = 1
  AND json_extract(NEW.manifest_json, '$.batchId') = NEW.batch_id
  AND json_extract(NEW.manifest_json, '$.packageDigest') = NEW.package_digest
  AND json_extract(NEW.manifest_json, '$.batchPurpose') = NEW.batch_purpose
  AND json_extract(NEW.manifest_json, '$.materializerVersion')
    = NEW.materializer_version
  AND json_extract(NEW.manifest_json, '$.provenanceStatus')
    = NEW.provenance_status
  AND json_extract(NEW.manifest_json, '$.generatedAt') = NEW.created_at
  AND length(json_extract(NEW.manifest_json, '$.sourceManifestSha256')) = 64
  AND json_extract(NEW.manifest_json, '$.sourceManifestSha256')
    NOT GLOB '*[^0-9a-f]*'
  AND length(json_extract(NEW.manifest_json, '$.sourceSqlSha256')) = 64
  AND json_extract(NEW.manifest_json, '$.sourceSqlSha256')
    NOT GLOB '*[^0-9a-f]*'
  AND json_extract(NEW.manifest_json, '$.counts.records')
    = NEW.expected_records
  AND json_extract(NEW.manifest_json, '$.counts.programs')
    = NEW.expected_programs
  AND json_extract(NEW.manifest_json, '$.counts.scholarships')
    = NEW.expected_scholarships
  AND json_extract(NEW.manifest_json, '$.counts.organizations')
    = NEW.expected_organizations
  AND json_extract(NEW.manifest_json, '$.counts.locations')
    = NEW.expected_locations
  AND json_extract(NEW.manifest_json, '$.counts.claims')
    = NEW.expected_claims
  AND json_extract(NEW.manifest_json, '$.counts.canonicalFields')
    = NEW.expected_canonical_fields
  AND json_extract(NEW.manifest_json, '$.counts.sourceFragments')
    = NEW.expected_evidence_fragments
  AND json_extract(NEW.manifest_json, '$.counts.sourceDocuments')
    = NEW.expected_source_documents
  AND json_extract(NEW.manifest_json, '$.counts.programCycles') = 0
  AND json_extract(NEW.manifest_json, '$.counts.scholarshipCycles') = 0
  AND json_extract(NEW.manifest_json, '$.sourceArtifactCount')
    = NEW.expected_source_documents,
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'materialization database manifest identity mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_state_machine
BEFORE UPDATE OF batch_status ON materialization_batches
WHEN NEW.batch_status <> OLD.batch_status
  AND NOT (
    (OLD.batch_status = 'prepared' AND NEW.batch_status = 'reserving')
    OR (OLD.batch_status = 'reserving' AND NEW.batch_status = 'reserved')
    OR (OLD.batch_status = 'reserved' AND NEW.batch_status = 'importing')
    OR (OLD.batch_status = 'importing' AND NEW.batch_status = 'applied')
    OR (
      OLD.batch_status IN ('prepared', 'reserving', 'reserved', 'importing')
      AND NEW.batch_status = 'failed'
    )
    OR (OLD.batch_status = 'failed' AND NEW.batch_status = 'superseded')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid materialization batch state transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_supersede_guard
BEFORE UPDATE OF batch_status, superseded_by_batch_id ON materialization_batches
WHEN NEW.batch_status = 'superseded' AND (
  OLD.batch_status <> 'failed'
  OR NEW.superseded_by_batch_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM materialization_batches replacement
    WHERE replacement.batch_id = NEW.superseded_by_batch_id
      AND replacement.batch_status = 'applied'
      AND julianday(replacement.created_at) > julianday(OLD.created_at)
  )
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_record_intents old_intent
    WHERE old_intent.batch_id = OLD.batch_id
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_record_intents new_intent
        WHERE new_intent.batch_id = NEW.superseded_by_batch_id
          AND new_intent.record_id = old_intent.record_id
          AND new_intent.record_kind = old_intent.record_kind
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'failed materialization batch requires a complete applied replacement');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_superseder_immutable
BEFORE UPDATE OF superseded_by_batch_id ON materialization_batches
WHEN OLD.batch_status = 'superseded'
  AND NEW.superseded_by_batch_id <> OLD.superseded_by_batch_id
BEGIN
  SELECT RAISE(ABORT, 'materialization superseding batch is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_reservation_guard
BEFORE UPDATE OF batch_status ON materialization_batches
WHEN OLD.batch_status = 'reserving' AND NEW.batch_status = 'reserved' AND (
  (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id) <> NEW.expected_records
  OR (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.package_digest = NEW.package_digest) <> NEW.expected_records
  OR (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.record_kind = 'program') <> NEW.expected_programs
  OR (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.record_kind = 'scholarship') <> NEW.expected_scholarships
  OR (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.record_kind = 'organization') <> NEW.expected_organizations
  OR (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.record_kind = 'location') <> NEW.expected_locations
)
BEGIN
  SELECT RAISE(ABORT, 'materialization record reservation is incomplete');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_intent_guard_insert
BEFORE INSERT ON materialization_batch_record_intents
WHEN NOT EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id
    AND batch.package_digest = NEW.package_digest
    AND batch.batch_status IN ('reserving', 'reserved', 'importing')
)
OR EXISTS (
  SELECT 1 FROM materialization_batch_record_intents existing
  WHERE existing.batch_id = NEW.batch_id
    AND existing.record_id = NEW.record_id
    AND (
      existing.record_kind <> NEW.record_kind
      OR existing.package_digest <> NEW.package_digest
    )
)
OR EXISTS (
  SELECT 1
  FROM materialization_batch_record_intents existing
  JOIN materialization_batches batch ON batch.batch_id = existing.batch_id
  WHERE existing.record_id = NEW.record_id
    AND existing.batch_id <> NEW.batch_id
    AND batch.batch_status IN ('reserving', 'reserved', 'importing')
)
BEGIN
  SELECT RAISE(ABORT, 'materialization record intent conflicts with reservation');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_intent_immutable_update
BEFORE UPDATE ON materialization_batch_record_intents
BEGIN
  SELECT RAISE(ABORT, 'materialization record intent is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_intent_delete
BEFORE DELETE ON materialization_batch_record_intents
BEGIN
  SELECT RAISE(ABORT, 'materialization record intent is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_mapping_guard_insert
BEFORE INSERT ON materialization_batch_records
WHEN NOT EXISTS (
  SELECT 1
  FROM materialization_batches batch
  JOIN materialization_batch_record_intents intent
    ON intent.batch_id = batch.batch_id
   AND intent.record_id = NEW.record_id
  JOIN records record ON record.id = NEW.record_id
  WHERE batch.batch_id = NEW.batch_id
    AND batch.batch_status = 'importing'
    AND intent.package_digest = batch.package_digest
    AND intent.record_kind = NEW.record_kind
    AND record.kind = NEW.record_kind
)
OR EXISTS (
  SELECT 1 FROM materialization_batch_records existing
  WHERE existing.batch_id = NEW.batch_id
    AND existing.record_id = NEW.record_id
    AND existing.record_kind <> NEW.record_kind
)
BEGIN
  SELECT RAISE(ABORT, 'materialization mapping lacks a matching reserved intent');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_mapping_guard_update
BEFORE UPDATE ON materialization_batch_records
WHEN NOT EXISTS (
  SELECT 1
  FROM materialization_batches batch
  JOIN materialization_batch_record_intents intent
    ON intent.batch_id = batch.batch_id
   AND intent.record_id = NEW.record_id
  JOIN records record ON record.id = NEW.record_id
  WHERE batch.batch_id = NEW.batch_id
    AND batch.batch_status = 'importing'
    AND intent.package_digest = batch.package_digest
    AND intent.record_kind = NEW.record_kind
    AND record.kind = NEW.record_kind
)
BEGIN
  SELECT RAISE(ABORT, 'materialization mapping lacks a matching reserved intent');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_chunk_package_guard
BEFORE INSERT ON materialization_batch_chunks
WHEN NOT EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id
    AND batch.package_digest = NEW.package_digest
    AND batch.batch_status IN ('reserving', 'reserved', 'importing')
)
OR EXISTS (
  SELECT 1 FROM materialization_batch_chunks existing
  WHERE existing.batch_id = NEW.batch_id
    AND existing.chunk_number = NEW.chunk_number
    AND (
      existing.package_digest <> NEW.package_digest
      OR existing.chunk_sha256 <> NEW.chunk_sha256
      OR existing.statement_count <> NEW.statement_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'materialization chunk package digest mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_chunk_immutable_update
BEFORE UPDATE ON materialization_batch_chunks
BEGIN
  SELECT RAISE(ABORT, 'materialization chunk marker is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_artifact_fetch_match_insert
BEFORE INSERT ON materialization_batch_source_artifacts
WHEN NOT EXISTS (
  SELECT 1
  FROM source_fetches fetch
  WHERE fetch.id = NEW.fetch_id
    AND fetch.source_id = NEW.source_id
    AND fetch.status = 'succeeded'
    AND fetch.sha256 = NEW.artifact_sha256
    AND fetch.artifact_uri = NEW.artifact_uri
    AND fetch.content_type = NEW.content_type
    AND fetch.content_length = NEW.byte_length
    AND fetch.completed_at = NEW.captured_at
)
BEGIN
  SELECT RAISE(ABORT, 'materialization artifact does not match source fetch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_artifact_fetch_match_update
BEFORE UPDATE ON materialization_batch_source_artifacts
WHEN NOT EXISTS (
  SELECT 1
  FROM source_fetches fetch
  WHERE fetch.id = NEW.fetch_id
    AND fetch.source_id = NEW.source_id
    AND fetch.status = 'succeeded'
    AND fetch.sha256 = NEW.artifact_sha256
    AND fetch.artifact_uri = NEW.artifact_uri
    AND fetch.content_type = NEW.content_type
    AND fetch.content_length = NEW.byte_length
    AND fetch.completed_at = NEW.captured_at
)
BEGIN
  SELECT RAISE(ABORT, 'materialization artifact does not match source fetch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_applied_immutable
BEFORE UPDATE ON materialization_batches
WHEN OLD.batch_status = 'applied'
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_delete
BEFORE DELETE ON materialization_batches
BEGIN
  SELECT RAISE(ABORT, 'materialization batch audit row is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_applied_insert
BEFORE INSERT ON materialization_batches
WHEN NEW.batch_status = 'applied'
BEGIN
  SELECT RAISE(ABORT, 'materialization batch must pass the apply transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_chunk_applied_immutable_update
BEFORE UPDATE ON materialization_batch_chunks
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
OR EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch chunks are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_chunk_applied_immutable_delete
BEFORE DELETE ON materialization_batch_chunks
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch chunks are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_chunk_applied_immutable_insert
BEFORE INSERT ON materialization_batch_chunks
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch chunks are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_record_applied_immutable_update
BEFORE UPDATE ON materialization_batch_records
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
OR EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_record_applied_immutable_delete
BEFORE DELETE ON materialization_batch_records
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_record_applied_immutable_insert
BEFORE INSERT ON materialization_batch_records
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_artifact_applied_immutable_update
BEFORE UPDATE ON materialization_batch_source_artifacts
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
OR EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch artifacts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_artifact_applied_immutable_delete
BEFORE DELETE ON materialization_batch_source_artifacts
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = OLD.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch artifacts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_artifact_applied_immutable_insert
BEFORE INSERT ON materialization_batch_source_artifacts
WHEN EXISTS (
  SELECT 1 FROM materialization_batches batch
  WHERE batch.batch_id = NEW.batch_id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied materialization batch artifacts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_applied_fetch_immutable
BEFORE UPDATE OF source_id, status, sha256, artifact_uri, content_type,
  content_length, completed_at
ON source_fetches
WHEN EXISTS (
  SELECT 1
  FROM materialization_batch_source_artifacts artifact
  JOIN materialization_batches batch ON batch.batch_id = artifact.batch_id
  WHERE artifact.fetch_id = OLD.id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'source fetch belongs to an applied materialization batch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_applied_fetch_delete
BEFORE DELETE ON source_fetches
WHEN EXISTS (
  SELECT 1
  FROM materialization_batch_source_artifacts artifact
  JOIN materialization_batches batch ON batch.batch_id = artifact.batch_id
  WHERE artifact.fetch_id = OLD.id AND batch.batch_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'source fetch belongs to an applied materialization batch');
END;

CREATE TRIGGER IF NOT EXISTS trg_materialization_batch_apply_guard
BEFORE UPDATE OF batch_status ON materialization_batches
WHEN NEW.batch_status = 'applied'
BEGIN
  SELECT RAISE(ABORT, 'materialization batch is incomplete or unverified') WHERE (
    NEW.provenance_status <> 'complete'
  OR NEW.expected_chunks <= 0
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_chunks chunk
    WHERE chunk.batch_id = NEW.batch_id
      AND chunk.package_digest = NEW.package_digest
  ) <> NEW.expected_chunks
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND intent.package_digest = NEW.package_digest
  ) <> NEW.expected_records
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = NEW.batch_id
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records mapped
        WHERE mapped.batch_id = intent.batch_id
          AND mapped.record_id = intent.record_id
          AND mapped.record_kind = intent.record_kind
      )
  )
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    WHERE mapped.batch_id = NEW.batch_id
  ) <> NEW.expected_records
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND record.workflow_status IN ('validated', 'published')
  ) <> NEW.expected_records
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN programs program ON program.record_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'program'
      AND record.kind = 'program'
  ) <> NEW.expected_programs
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN scholarships scholarship ON scholarship.record_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'scholarship'
      AND record.kind = 'scholarship'
  ) <> NEW.expected_scholarships
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN organizations organization ON organization.record_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'organization'
      AND record.kind = 'organization'
  ) <> NEW.expected_organizations
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN locations location ON location.record_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'location'
      AND record.kind = 'location'
  ) <> NEW.expected_locations
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND claim.extractor_version = NEW.materializer_version
      AND claim.claim_status = 'accepted'
  ) <> NEW.expected_claims
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN canonical_fields canonical
      ON canonical.subject_record_id = mapped.record_id
    JOIN claims claim ON claim.id = canonical.claim_id
    WHERE mapped.batch_id = NEW.batch_id
      AND canonical.field_status = 'accepted'
      AND claim.extractor_version = NEW.materializer_version
      AND claim.claim_status = 'accepted'
  ) <> NEW.expected_canonical_fields
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_records mapped
    JOIN canonical_fields canonical
      ON canonical.subject_record_id = mapped.record_id
    JOIN claims claim ON claim.id = canonical.claim_id
    WHERE mapped.batch_id = NEW.batch_id
      AND canonical.field_status = 'accepted'
      AND claim.extractor_version = NEW.materializer_version
      AND claim.claim_status = 'accepted'
      AND NOT EXISTS (
        SELECT 1
        FROM claim_evidence evidence
        JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
        JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
        JOIN materialization_batch_source_artifacts artifact
          ON artifact.batch_id = NEW.batch_id
         AND artifact.fetch_id = fetch.id
        JOIN source_documents source ON source.id = fetch.source_id
        WHERE evidence.claim_id = claim.id
          AND evidence.evidence_role = 'primary'
          AND source.authority_level = 'primary_official'
          AND source.official = 1
      )
  )
  OR (
    SELECT COUNT(DISTINCT evidence.fragment_id)
    FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    JOIN claim_evidence evidence ON evidence.claim_id = claim.id
    JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
    JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
    JOIN materialization_batch_source_artifacts artifact
      ON artifact.batch_id = NEW.batch_id
     AND artifact.fetch_id = fetch.id
    JOIN source_documents source ON source.id = fetch.source_id
    WHERE mapped.batch_id = NEW.batch_id
      AND claim.extractor_version = NEW.materializer_version
      AND claim.claim_status = 'accepted'
      AND evidence.evidence_role = 'primary'
      AND source.authority_level = 'primary_official'
      AND source.official = 1
  ) <> NEW.expected_evidence_fragments
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    JOIN claim_evidence evidence ON evidence.claim_id = claim.id
    JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
    WHERE mapped.batch_id = NEW.batch_id
      AND claim.extractor_version = NEW.materializer_version
      AND claim.claim_status = 'accepted'
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_source_artifacts artifact
        WHERE artifact.batch_id = NEW.batch_id
          AND artifact.fetch_id = fragment.fetch_id
      )
  )
  OR (
    SELECT COUNT(*)
    FROM materialization_batch_source_artifacts artifact
    WHERE artifact.batch_id = NEW.batch_id
  ) <> NEW.expected_source_documents
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_source_artifacts artifact
    LEFT JOIN source_fetches fetch ON fetch.id = artifact.fetch_id
    WHERE artifact.batch_id = NEW.batch_id
      AND (
        fetch.id IS NULL
        OR fetch.source_id <> artifact.source_id
        OR fetch.status <> 'succeeded'
        OR fetch.sha256 <> artifact.artifact_sha256
        OR fetch.artifact_uri <> artifact.artifact_uri
        OR fetch.content_type <> artifact.content_type
        OR fetch.content_length <> artifact.byte_length
        OR fetch.completed_at <> artifact.captured_at
      )
  )
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_source_artifacts artifact
    WHERE artifact.batch_id = NEW.batch_id
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records mapped
        JOIN claims claim ON claim.subject_record_id = mapped.record_id
        JOIN claim_evidence evidence ON evidence.claim_id = claim.id
        JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
        WHERE mapped.batch_id = NEW.batch_id
          AND claim.extractor_version = NEW.materializer_version
          AND claim.claim_status = 'accepted'
          AND evidence.evidence_role = 'primary'
          AND fragment.fetch_id = artifact.fetch_id
      )
  )
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_records mapped
    JOIN program_cycles cycle ON cycle.program_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'program'
  )
  OR EXISTS (
    SELECT 1
    FROM materialization_batch_records mapped
    JOIN scholarship_cycles cycle ON cycle.scholarship_id = mapped.record_id
    WHERE mapped.batch_id = NEW.batch_id
      AND mapped.record_kind = 'scholarship'
  )
  );
  UPDATE records
  SET workflow_status = CASE
        WHEN workflow_status = 'published' THEN 'published'
        ELSE 'applied'
      END,
      row_version = row_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (
    SELECT record_id
    FROM materialization_batch_records
    WHERE batch_id = NEW.batch_id
  )
    AND workflow_status IN ('validated', 'published');
END;
