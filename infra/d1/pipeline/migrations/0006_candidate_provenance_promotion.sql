-- Immutable extraction provenance and the automatic candidate-to-publication bridge.
-- Promotion is entirely machine gated; unsafe or unmapped candidates are isolated.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingestion_candidate_provenance (
  candidate_id TEXT PRIMARY KEY REFERENCES ingestion_candidates(candidate_id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL CHECK (length(trim(schema_version)) > 0),
  model_name TEXT,
  prompt_fingerprint TEXT CHECK (
    prompt_fingerprint IS NULL OR (
      length(prompt_fingerprint) = 64 AND prompt_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  extractor_fingerprint TEXT NOT NULL CHECK (
    length(extractor_fingerprint) = 64 AND extractor_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  primary_extraction_json TEXT CHECK (
    primary_extraction_json IS NULL OR (
      json_valid(primary_extraction_json) AND json_type(primary_extraction_json) = 'object'
    )
  ),
  secondary_extraction_json TEXT CHECK (
    secondary_extraction_json IS NULL OR (
      json_valid(secondary_extraction_json) AND json_type(secondary_extraction_json) = 'object'
    )
  ),
  field_evidence_json TEXT NOT NULL CHECK (
    json_valid(field_evidence_json) AND json_type(field_evidence_json) = 'array'
  ),
  contains_critical INTEGER NOT NULL CHECK (contains_critical IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_source_bindings (
  source_id TEXT PRIMARY KEY REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotion_field_mappings (
  source_id TEXT NOT NULL REFERENCES promotion_source_bindings(source_id) ON DELETE CASCADE,
  candidate_field_path TEXT NOT NULL CHECK (length(trim(candidate_field_path)) > 0),
  subject_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  canonical_field_path TEXT NOT NULL CHECK (length(trim(canonical_field_path)) > 0),
  locale TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, candidate_field_path),
  UNIQUE (source_id, subject_record_id, canonical_field_path, locale)
);

CREATE TABLE IF NOT EXISTS candidate_promotions (
  candidate_id TEXT PRIMARY KEY REFERENCES ingestion_candidates(candidate_id) ON DELETE RESTRICT,
  promotion_status TEXT NOT NULL CHECK (promotion_status IN (
    'applying', 'applied', 'quarantined'
  )),
  promotion_token TEXT,
  lease_expires_at TEXT,
  change_set_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(change_set_ids_json) AND json_type(change_set_ids_json) = 'array'
  ),
  publication_job_id TEXT REFERENCES publication_jobs(id) ON DELETE RESTRICT,
  error_code TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  CHECK (
    (promotion_status = 'applying' AND promotion_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (promotion_status = 'applied' AND publication_job_id IS NOT NULL AND applied_at IS NOT NULL)
    OR (promotion_status = 'quarantined' AND error_code IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS promotion_isolations (
  candidate_id TEXT PRIMARY KEY REFERENCES ingestion_candidates(candidate_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  isolated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_promotions_status
  ON candidate_promotions(promotion_status, lease_expires_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_promotion_field_targets
  ON promotion_field_mappings(subject_record_id, canonical_field_path, locale);

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_provenance_insert
BEFORE INSERT ON ingestion_candidate_provenance
WHEN (
  SELECT extractor FROM ingestion_candidates WHERE candidate_id = NEW.candidate_id
) = 'minimax-dual' AND (
  NEW.model_name IS NULL
  OR length(trim(NEW.model_name)) = 0
  OR NEW.prompt_fingerprint IS NULL
  OR NEW.primary_extraction_json IS NULL
  OR NEW.secondary_extraction_json IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'ingestion candidate requires complete immutable provenance');
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_provenance_immutable
BEFORE UPDATE ON ingestion_candidate_provenance
BEGIN
  SELECT RAISE(ABORT, 'ingestion candidate provenance is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_payload_immutable
BEFORE UPDATE OF source_id, snapshot_id, extractor, gate_status, facts_json, issues_json
ON ingestion_candidates
WHEN
  NEW.source_id IS NOT OLD.source_id
  OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.extractor IS NOT OLD.extractor
  OR NEW.gate_status IS NOT OLD.gate_status
  OR NEW.facts_json IS NOT OLD.facts_json
  OR NEW.issues_json IS NOT OLD.issues_json
BEGIN
  SELECT RAISE(ABORT, 'ingestion candidate payload is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_promotion_source_binding_official_insert
BEFORE INSERT ON promotion_source_bindings
WHEN NOT EXISTS (
  SELECT 1 FROM source_documents
  WHERE id = NEW.source_document_id
    AND official = 1
    AND active = 1
    AND authority_level IN ('primary_official', 'secondary_official')
)
BEGIN
  SELECT RAISE(ABORT, 'promotion source binding requires an active official source');
END;

CREATE TRIGGER IF NOT EXISTS trg_promotion_source_binding_official_update
BEFORE UPDATE OF source_document_id, enabled ON promotion_source_bindings
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1 FROM source_documents
  WHERE id = NEW.source_document_id
    AND official = 1
    AND active = 1
    AND authority_level IN ('primary_official', 'secondary_official')
)
BEGIN
  SELECT RAISE(ABORT, 'enabled promotion source binding requires an active official source');
END;

CREATE TRIGGER IF NOT EXISTS trg_promotion_field_mapping_known_insert
BEFORE INSERT ON promotion_field_mappings
WHEN NOT EXISTS (
  SELECT 1
  FROM records r
  JOIN field_definitions f
    ON f.record_kind = r.kind
   AND f.field_path = NEW.canonical_field_path
  WHERE r.id = NEW.subject_record_id
)
BEGIN
  SELECT RAISE(ABORT, 'promotion mapping requires a known canonical field definition');
END;

CREATE TRIGGER IF NOT EXISTS trg_promotion_field_mapping_known_update
BEFORE UPDATE OF subject_record_id, canonical_field_path, enabled ON promotion_field_mappings
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1
  FROM records r
  JOIN field_definitions f
    ON f.record_kind = r.kind
   AND f.field_path = NEW.canonical_field_path
  WHERE r.id = NEW.subject_record_id
)
BEGIN
  SELECT RAISE(ABORT, 'enabled promotion mapping requires a known canonical field definition');
END;

CREATE TRIGGER IF NOT EXISTS trg_candidate_promotion_apply_gate
BEFORE UPDATE OF promotion_status ON candidate_promotions
WHEN NEW.promotion_status = 'applied' AND NOT EXISTS (
  SELECT 1
  FROM ingestion_candidates c
  JOIN ingestion_candidate_provenance provenance
    ON provenance.candidate_id = c.candidate_id
  WHERE c.candidate_id = NEW.candidate_id
    AND c.candidate_status IN ('validated', 'applied')
    AND (
      c.gate_status = 'dual-pass'
      OR (c.gate_status = 'rule-pass' AND provenance.contains_critical = 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'candidate is not eligible for automatic promotion');
END;

CREATE TRIGGER IF NOT EXISTS trg_candidate_promotion_transition
BEFORE UPDATE OF promotion_status ON candidate_promotions
WHEN NOT (
  NEW.promotion_status = OLD.promotion_status
  OR (OLD.promotion_status = 'applying' AND NEW.promotion_status IN ('applied', 'quarantined'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid candidate promotion transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_applied_candidate_cannot_be_isolated
BEFORE INSERT ON promotion_isolations
WHEN EXISTS (
  SELECT 1 FROM candidate_promotions
  WHERE candidate_id = NEW.candidate_id AND promotion_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'an applied candidate cannot be isolated');
END;

CREATE TRIGGER IF NOT EXISTS trg_ingestion_candidate_applied_requires_promotion
BEFORE UPDATE OF candidate_status ON ingestion_candidates
WHEN NEW.candidate_status = 'applied' AND NOT EXISTS (
  SELECT 1 FROM candidate_promotions
  WHERE candidate_id = NEW.candidate_id AND promotion_status = 'applied'
)
BEGIN
  SELECT RAISE(ABORT, 'applied candidate requires a completed automatic promotion');
END;

CREATE TRIGGER IF NOT EXISTS trg_record_version_matches_current_record
BEFORE INSERT ON record_versions
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.record_id AND row_version = NEW.version
)
BEGIN
  SELECT RAISE(ABORT, 'record version must match the atomically updated record');
END;

PRAGMA optimize;
