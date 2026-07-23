-- Source discovery, entity extraction, stable identity, and catalogue reconciliation.
-- Candidates remain private until they pass the existing canonical publication gates.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_discoveries (
  discovery_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  discovered_from_source_id TEXT NOT NULL
    REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  discovered_from_snapshot_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL CHECK (canonical_url LIKE 'https://%'),
  url_sha256 TEXT NOT NULL CHECK (
    length(url_sha256) = 64 AND url_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_role TEXT NOT NULL CHECK (source_role IN (
    'admissions_home', 'program_catalog', 'program_detail',
    'scholarship_catalog', 'scholarship_detail',
    'application_portal', 'pagination', 'other'
  )),
  link_text TEXT CHECK (link_text IS NULL OR length(link_text) <= 1000),
  discovery_context_json TEXT CHECK (
    discovery_context_json IS NULL OR (
      json_valid(discovery_context_json)
      AND json_type(discovery_context_json) = 'object'
    )
  ),
  discovery_status TEXT NOT NULL DEFAULT 'discovered' CHECK (discovery_status IN (
    'discovered', 'queued', 'registered', 'ignored', 'rejected', 'stale'
  )),
  registered_source_id TEXT REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  discovered_at TEXT NOT NULL CHECK (julianday(discovered_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK (julianday(last_seen_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (discovered_from_snapshot_id, discovered_from_source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT,
  UNIQUE (institution_id, canonical_url),
  UNIQUE (institution_id, url_sha256),
  CHECK (last_seen_at >= discovered_at),
  CHECK (discovery_status <> 'registered' OR registered_source_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS extracted_entity_candidates (
  candidate_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'program', 'program_cycle', 'scholarship', 'scholarship_cycle'
  )),
  entity_key TEXT NOT NULL CHECK (
    length(trim(entity_key)) BETWEEN 1 AND 512
    AND entity_key = lower(trim(entity_key))
  ),
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  source_discovery_id TEXT REFERENCES source_discoveries(discovery_id) ON DELETE RESTRICT,
  ingestion_job_id TEXT REFERENCES ingestion_jobs(job_id) ON DELETE RESTRICT,
  extractor TEXT NOT NULL CHECK (length(trim(extractor)) BETWEEN 1 AND 100),
  candidate_status TEXT NOT NULL DEFAULT 'extracted' CHECK (candidate_status IN (
    'extracted', 'validated', 'quarantined', 'registered', 'rejected', 'superseded'
  )),
  facts_json TEXT NOT NULL CHECK (
    json_valid(facts_json) AND json_type(facts_json) = 'object'
  ),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND json_array_length(evidence_json) > 0
  ),
  issues_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  entity_sha256 TEXT NOT NULL CHECK (
    length(entity_sha256) = 64 AND entity_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  confidence_ppm INTEGER CHECK (
    confidence_ppm IS NULL OR confidence_ppm BETWEEN 0 AND 1000000
  ),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  processed_at TEXT CHECK (processed_at IS NULL OR julianday(processed_at) IS NOT NULL),
  registered_at TEXT CHECK (registered_at IS NULL OR julianday(registered_at) IS NOT NULL),
  FOREIGN KEY (snapshot_id, source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT,
  UNIQUE (snapshot_id, institution_id, entity_type, entity_key),
  CHECK (candidate_status = 'extracted' OR processed_at IS NOT NULL),
  CHECK (candidate_status <> 'registered' OR registered_at IS NOT NULL),
  CHECK (registered_at IS NULL OR processed_at IS NULL OR registered_at >= processed_at)
);

CREATE TABLE IF NOT EXISTS entity_extraction_runs (
  snapshot_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  extractor TEXT NOT NULL CHECK (length(trim(extractor)) BETWEEN 1 AND 100),
  extraction_status TEXT NOT NULL CHECK (extraction_status IN (
    'completed', 'quarantined'
  )),
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
  issues_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  completed_at TEXT NOT NULL CHECK (julianday(completed_at) IS NOT NULL),
  PRIMARY KEY (snapshot_id, extractor),
  FOREIGN KEY (snapshot_id, source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS entity_registry (
  registry_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'program', 'program_cycle', 'scholarship', 'scholarship_cycle'
  )),
  entity_key TEXT NOT NULL CHECK (
    length(trim(entity_key)) BETWEEN 1 AND 512
    AND entity_key = lower(trim(entity_key))
  ),
  identity_sha256 TEXT NOT NULL CHECK (
    length(identity_sha256) = 64 AND identity_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  registry_status TEXT NOT NULL DEFAULT 'pending' CHECK (registry_status IN (
    'pending', 'active', 'merged', 'retired', 'rejected'
  )),
  canonical_record_id TEXT REFERENCES records(id) ON DELETE RESTRICT,
  first_candidate_id TEXT NOT NULL
    REFERENCES extracted_entity_candidates(candidate_id) ON DELETE RESTRICT,
  latest_candidate_id TEXT NOT NULL
    REFERENCES extracted_entity_candidates(candidate_id) ON DELETE RESTRICT,
  merged_into_registry_id TEXT REFERENCES entity_registry(registry_id) ON DELETE RESTRICT,
  first_seen_at TEXT NOT NULL CHECK (julianday(first_seen_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK (julianday(last_seen_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (institution_id, entity_type, entity_key),
  CHECK (last_seen_at >= first_seen_at),
  CHECK (registry_status <> 'active' OR canonical_record_id IS NOT NULL),
  CHECK (
    (registry_status = 'merged'
      AND merged_into_registry_id IS NOT NULL
      AND merged_into_registry_id <> registry_id)
    OR (registry_status <> 'merged' AND merged_into_registry_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS catalog_reconciliation_items (
  reconciliation_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  catalog_item_key TEXT NOT NULL CHECK (
    length(trim(catalog_item_key)) BETWEEN 1 AND 512
  ),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'program', 'program_cycle', 'scholarship', 'scholarship_cycle'
  )),
  entity_key TEXT CHECK (
    entity_key IS NULL OR (
      length(trim(entity_key)) BETWEEN 1 AND 512
      AND entity_key = lower(trim(entity_key))
    )
  ),
  candidate_id TEXT REFERENCES extracted_entity_candidates(candidate_id) ON DELETE RESTRICT,
  registry_id TEXT REFERENCES entity_registry(registry_id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK (disposition IN (
    'pending', 'published', 'not_individual_application',
    'discontinued', 'officially_not_published', 'unparseable'
  )),
  reason_code TEXT CHECK (
    reason_code IS NULL OR length(trim(reason_code)) BETWEEN 1 AND 100
  ),
  reason_detail TEXT CHECK (reason_detail IS NULL OR length(reason_detail) <= 2000),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND json_array_length(evidence_json) > 0
  ),
  first_seen_at TEXT NOT NULL CHECK (julianday(first_seen_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK (julianday(last_seen_at) IS NOT NULL),
  reconciled_at TEXT CHECK (reconciled_at IS NULL OR julianday(reconciled_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id, source_id)
    REFERENCES ingestion_snapshots(snapshot_id, source_id) ON DELETE RESTRICT,
  UNIQUE (snapshot_id, entity_type, catalog_item_key),
  CHECK (last_seen_at >= first_seen_at),
  CHECK (
    (disposition = 'pending' AND reconciled_at IS NULL)
    OR (disposition <> 'pending' AND reconciled_at IS NOT NULL)
  ),
  CHECK (disposition IN ('pending', 'published') OR reason_code IS NOT NULL),
  CHECK (
    disposition <> 'published'
    OR (entity_key IS NOT NULL AND candidate_id IS NOT NULL AND registry_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_source_discoveries_work_queue
  ON source_discoveries(discovery_status, source_role, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_source_discoveries_institution
  ON source_discoveries(institution_id, source_role, discovery_status);
CREATE INDEX IF NOT EXISTS idx_source_discoveries_registered_source
  ON source_discoveries(registered_source_id) WHERE registered_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entity_candidates_validation_queue
  ON extracted_entity_candidates(candidate_status, entity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_entity_candidates_institution
  ON extracted_entity_candidates(institution_id, entity_type, entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_candidates_source_snapshot
  ON extracted_entity_candidates(source_id, snapshot_id, candidate_status);
CREATE INDEX IF NOT EXISTS idx_entity_candidates_content_hash
  ON extracted_entity_candidates(entity_sha256, entity_type);

CREATE INDEX IF NOT EXISTS idx_entity_registry_lookup
  ON entity_registry(institution_id, entity_type, registry_status, entity_key);
CREATE INDEX IF NOT EXISTS idx_entity_registry_identity
  ON entity_registry(institution_id, entity_type, identity_sha256);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_registry_canonical_record
  ON entity_registry(canonical_record_id) WHERE canonical_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entity_registry_latest_seen
  ON entity_registry(registry_status, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_catalog_reconciliation_progress
  ON catalog_reconciliation_items(institution_id, snapshot_id, disposition);
CREATE INDEX IF NOT EXISTS idx_catalog_reconciliation_open
  ON catalog_reconciliation_items(source_id, last_seen_at, entity_type)
  WHERE disposition = 'pending';
CREATE INDEX IF NOT EXISTS idx_catalog_reconciliation_candidate
  ON catalog_reconciliation_items(candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_reconciliation_registry
  ON catalog_reconciliation_items(registry_id) WHERE registry_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_entity_registry_record_kind_insert
BEFORE INSERT ON entity_registry
WHEN NEW.canonical_record_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.canonical_record_id AND kind = NEW.entity_type
)
BEGIN
  SELECT RAISE(ABORT, 'entity registry canonical record kind must match entity type');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_registry_record_kind_update
BEFORE UPDATE OF canonical_record_id, entity_type ON entity_registry
WHEN NEW.canonical_record_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.canonical_record_id AND kind = NEW.entity_type
)
BEGIN
  SELECT RAISE(ABORT, 'entity registry canonical record kind must match entity type');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_candidate_payload_immutable
BEFORE UPDATE OF institution_id, entity_type, entity_key, source_id, snapshot_id,
  source_discovery_id, ingestion_job_id, extractor, facts_json, evidence_json, entity_sha256
ON extracted_entity_candidates
WHEN
  NEW.institution_id IS NOT OLD.institution_id
  OR NEW.entity_type IS NOT OLD.entity_type
  OR NEW.entity_key IS NOT OLD.entity_key
  OR NEW.source_id IS NOT OLD.source_id
  OR NEW.snapshot_id IS NOT OLD.snapshot_id
  OR NEW.source_discovery_id IS NOT OLD.source_discovery_id
  OR NEW.ingestion_job_id IS NOT OLD.ingestion_job_id
  OR NEW.extractor IS NOT OLD.extractor
  OR NEW.facts_json IS NOT OLD.facts_json
  OR NEW.evidence_json IS NOT OLD.evidence_json
  OR NEW.entity_sha256 IS NOT OLD.entity_sha256
BEGIN
  SELECT RAISE(ABORT, 'extracted entity candidate payload is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_registry_candidate_identity_insert
BEFORE INSERT ON entity_registry
WHEN
  NOT EXISTS (
    SELECT 1 FROM extracted_entity_candidates
    WHERE candidate_id = NEW.first_candidate_id
      AND institution_id = NEW.institution_id
      AND entity_type = NEW.entity_type
      AND entity_key = NEW.entity_key
  )
  OR NOT EXISTS (
    SELECT 1 FROM extracted_entity_candidates
    WHERE candidate_id = NEW.latest_candidate_id
      AND institution_id = NEW.institution_id
      AND entity_type = NEW.entity_type
      AND entity_key = NEW.entity_key
  )
BEGIN
  SELECT RAISE(ABORT, 'entity registry candidates must match its stable identity');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_registry_candidate_identity_update
BEFORE UPDATE OF institution_id, entity_type, entity_key,
  first_candidate_id, latest_candidate_id
ON entity_registry
WHEN
  NOT EXISTS (
    SELECT 1 FROM extracted_entity_candidates
    WHERE candidate_id = NEW.first_candidate_id
      AND institution_id = NEW.institution_id
      AND entity_type = NEW.entity_type
      AND entity_key = NEW.entity_key
  )
  OR NOT EXISTS (
    SELECT 1 FROM extracted_entity_candidates
    WHERE candidate_id = NEW.latest_candidate_id
      AND institution_id = NEW.institution_id
      AND entity_type = NEW.entity_type
      AND entity_key = NEW.entity_key
  )
BEGIN
  SELECT RAISE(ABORT, 'entity registry candidates must match its stable identity');
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_reconciliation_identity_insert
BEFORE INSERT ON catalog_reconciliation_items
WHEN
  (
    NEW.candidate_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM extracted_entity_candidates
      WHERE candidate_id = NEW.candidate_id
        AND institution_id = NEW.institution_id
        AND entity_type = NEW.entity_type
        AND source_id = NEW.source_id
        AND snapshot_id = NEW.snapshot_id
        AND (NEW.entity_key IS NULL OR entity_key = NEW.entity_key)
        AND (NEW.disposition <> 'published' OR candidate_status = 'registered')
    )
  )
  OR (
    NEW.registry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM entity_registry
      WHERE registry_id = NEW.registry_id
        AND institution_id = NEW.institution_id
        AND entity_type = NEW.entity_type
        AND entity_key = NEW.entity_key
        AND (NEW.disposition <> 'published' OR registry_status = 'active')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reconciliation references must match its catalogue item');
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_reconciliation_identity_update
BEFORE UPDATE OF institution_id, source_id, snapshot_id, entity_type,
  entity_key, candidate_id, registry_id, disposition
ON catalog_reconciliation_items
WHEN
  (
    NEW.candidate_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM extracted_entity_candidates
      WHERE candidate_id = NEW.candidate_id
        AND institution_id = NEW.institution_id
        AND entity_type = NEW.entity_type
        AND source_id = NEW.source_id
        AND snapshot_id = NEW.snapshot_id
        AND (NEW.entity_key IS NULL OR entity_key = NEW.entity_key)
        AND (NEW.disposition <> 'published' OR candidate_status = 'registered')
    )
  )
  OR (
    NEW.registry_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM entity_registry
      WHERE registry_id = NEW.registry_id
        AND institution_id = NEW.institution_id
        AND entity_type = NEW.entity_type
        AND entity_key = NEW.entity_key
        AND (NEW.disposition <> 'published' OR registry_status = 'active')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reconciliation references must match its catalogue item');
END;

PRAGMA optimize;
