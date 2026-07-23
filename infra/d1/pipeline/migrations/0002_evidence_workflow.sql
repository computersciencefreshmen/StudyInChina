-- Evidence, field-level provenance, ingestion, review, and audit workflow.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  canonical_url TEXT NOT NULL UNIQUE CHECK (canonical_url LIKE 'https://%'),
  publisher_organization_id TEXT REFERENCES organizations(record_id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'institution', 'program', 'admissions', 'scholarship', 'government',
    'application_portal', 'city', 'other'
  )),
  authority_level TEXT NOT NULL CHECK (authority_level IN (
    'primary_official', 'secondary_official', 'discovery_only'
  )),
  official INTEGER NOT NULL DEFAULT 0 CHECK (official IN (0, 1)),
  language_code TEXT NOT NULL DEFAULT 'other',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  fetch_cadence_minutes INTEGER CHECK (fetch_cadence_minutes IS NULL OR fetch_cadence_minutes >= 60),
  robots_policy TEXT NOT NULL DEFAULT 'unknown' CHECK (robots_policy IN (
    'enforce', 'blocked', 'unknown'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (authority_level = 'discovery_only' OR official = 1)
);

CREATE TABLE IF NOT EXISTS source_fetches (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'succeeded', 'not_modified', 'soft_failed', 'hard_failed'
  )),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  etag TEXT,
  last_modified TEXT,
  content_type TEXT,
  content_length INTEGER CHECK (content_length IS NULL OR content_length >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  artifact_uri TEXT,
  parser_key TEXT,
  parser_version TEXT,
  error_code TEXT,
  error_detail TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  CHECK (completed_at IS NULL OR completed_at >= requested_at),
  CHECK (status NOT IN ('succeeded', 'not_modified', 'soft_failed', 'hard_failed') OR completed_at IS NOT NULL),
  CHECK (status <> 'succeeded' OR (sha256 IS NOT NULL AND artifact_uri IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS source_fragments (
  id TEXT PRIMARY KEY,
  fetch_id TEXT NOT NULL REFERENCES source_fetches(id) ON DELETE CASCADE,
  locator_type TEXT NOT NULL CHECK (locator_type IN (
    'css', 'xpath', 'json_pointer', 'pdf_page', 'pdf_region', 'text_offset', 'manual'
  )),
  locator TEXT NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  text_excerpt TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_definitions (
  record_kind TEXT NOT NULL,
  field_path TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN (
    'string', 'localized_string', 'integer', 'decimal_minor', 'boolean',
    'date', 'url', 'identifier', 'json'
  )),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
  required_for_publish INTEGER NOT NULL DEFAULT 0 CHECK (required_for_publish IN (0, 1)),
  max_age_days INTEGER CHECK (max_age_days IS NULL OR max_age_days > 0),
  validation_profile TEXT,
  PRIMARY KEY (record_kind, field_path)
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  subject_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  field_path TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  value_type TEXT NOT NULL CHECK (value_type IN (
    'string', 'localized_string', 'integer', 'decimal_minor', 'boolean',
    'date', 'url', 'identifier', 'json'
  )),
  raw_value_text TEXT,
  normalized_value_json TEXT CHECK (
    normalized_value_json IS NULL OR json_valid(normalized_value_json)
  ),
  source_published_on TEXT CHECK (
    source_published_on IS NULL
    OR (date(source_published_on) IS NOT NULL AND source_published_on = date(source_published_on))
  ),
  valid_from TEXT CHECK (
    valid_from IS NULL OR (date(valid_from) IS NOT NULL AND valid_from = date(valid_from))
  ),
  valid_to TEXT CHECK (
    valid_to IS NULL OR (date(valid_to) IS NOT NULL AND valid_to = date(valid_to))
  ),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  extraction_method TEXT NOT NULL CHECK (extraction_method IN (
    'manual', 'selector', 'api', 'pdf', 'ocr', 'llm', 'legacy_import'
  )),
  extractor_version TEXT NOT NULL,
  claim_status TEXT NOT NULL DEFAULT 'candidate' CHECK (claim_status IN (
    'candidate', 'validated', 'accepted', 'rejected', 'superseded', 'quarantined'
  )),
  provenance_precision TEXT NOT NULL DEFAULT 'field' CHECK (provenance_precision IN (
    'field', 'record_legacy'
  )),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (claim_status <> 'accepted' OR normalized_value_json IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  fragment_id TEXT NOT NULL REFERENCES source_fragments(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'primary' CHECK (evidence_role IN (
    'primary', 'corroborating', 'conflicting'
  )),
  PRIMARY KEY (claim_id, fragment_id)
);

CREATE TABLE IF NOT EXISTS canonical_fields (
  subject_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  field_status TEXT NOT NULL CHECK (field_status IN (
    'accepted', 'unknown', 'withheld', 'expired'
  )),
  claim_id TEXT REFERENCES claims(id) ON DELETE RESTRICT,
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  verified_at TEXT,
  review_after TEXT CHECK (
    review_after IS NULL OR (date(review_after) IS NOT NULL AND review_after = date(review_after))
  ),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subject_record_id, field_path, locale),
  CHECK (
    (field_status = 'accepted'
      AND claim_id IS NOT NULL
      AND value_json IS NOT NULL
      AND verified_at IS NOT NULL
      AND review_after IS NOT NULL)
    OR
    (field_status IN ('unknown', 'withheld', 'expired') AND value_json IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS record_versions (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  change_set_id TEXT,
  changed_by TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (record_id, version)
);

CREATE TABLE IF NOT EXISTS crawl_targets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES source_documents(id) ON DELETE CASCADE,
  parser_key TEXT NOT NULL,
  parser_config_json TEXT CHECK (parser_config_json IS NULL OR json_valid(parser_config_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100,
  host_rate_limit_per_minute INTEGER NOT NULL DEFAULT 6 CHECK (host_rate_limit_per_minute > 0),
  next_run_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  crawl_target_id TEXT NOT NULL REFERENCES crawl_targets(id) ON DELETE RESTRICT,
  fetch_id TEXT REFERENCES source_fetches(id) ON DELETE RESTRICT,
  run_status TEXT NOT NULL CHECK (run_status IN (
    'queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'
  )),
  started_at TEXT,
  finished_at TEXT,
  claims_created INTEGER NOT NULL DEFAULT 0 CHECK (claims_created >= 0),
  anomalies_created INTEGER NOT NULL DEFAULT 0 CHECK (anomalies_created >= 0),
  metrics_json TEXT CHECK (metrics_json IS NULL OR json_valid(metrics_json)),
  error_detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE IF NOT EXISTS change_sets (
  id TEXT PRIMARY KEY,
  ingestion_run_id TEXT REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
  subject_record_id TEXT REFERENCES records(id) ON DELETE RESTRICT,
  proposed_public_id TEXT,
  base_row_version INTEGER CHECK (base_row_version IS NULL OR base_row_version > 0),
  change_status TEXT NOT NULL DEFAULT 'extracted' CHECK (change_status IN (
    'extracted', 'validated', 'quarantined', 'applied', 'superseded'
  )),
  max_risk TEXT NOT NULL DEFAULT 'low' CHECK (max_risk IN (
    'low', 'medium', 'high', 'critical'
  )),
  diff_json TEXT NOT NULL CHECK (json_valid(diff_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  CHECK (subject_record_id IS NOT NULL OR proposed_public_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS change_set_claims (
  change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
  PRIMARY KEY (change_set_id, claim_id)
);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  claim_id TEXT REFERENCES claims(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocker')),
  anomaly_status TEXT NOT NULL DEFAULT 'open' CHECK (anomaly_status IN (
    'open', 'quarantined', 'resolved'
  )),
  observed_json TEXT CHECK (observed_json IS NULL OR json_valid(observed_json)),
  expected_json TEXT CHECK (expected_json IS NULL OR json_valid(expected_json)),
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  CHECK (anomaly_status <> 'resolved' OR resolved_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS publication_jobs (
  id TEXT PRIMARY KEY,
  catalog_release_id TEXT NOT NULL UNIQUE,
  job_status TEXT NOT NULL DEFAULT 'queued' CHECK (job_status IN (
    'queued', 'building', 'validated', 'published', 'failed', 'cancelled'
  )),
  source_change_set_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(source_change_set_ids_json) AND json_type(source_change_set_ids_json) = 'array'
  ),
  expected_counts_json TEXT CHECK (expected_counts_json IS NULL OR json_valid(expected_counts_json)),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  error_detail TEXT
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  event_status TEXT NOT NULL DEFAULT 'pending' CHECK (event_status IN (
    'pending', 'processing', 'delivered', 'failed', 'dead_letter'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_type TEXT NOT NULL CHECK (actor_type IN (
    'system', 'worker', 'migration', 'release'
  )),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  correlation_id TEXT,
  detail TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_canonical_field_accepted_insert
BEFORE INSERT ON canonical_fields
WHEN NEW.field_status = 'accepted' AND NOT EXISTS (
  SELECT 1 FROM claims
  WHERE id = NEW.claim_id AND subject_record_id = NEW.subject_record_id AND claim_status = 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'accepted canonical field requires an accepted claim for the same record');
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_field_accepted_update
BEFORE UPDATE ON canonical_fields
WHEN NEW.field_status = 'accepted' AND NOT EXISTS (
  SELECT 1 FROM claims
  WHERE id = NEW.claim_id AND subject_record_id = NEW.subject_record_id AND claim_status = 'accepted'
)
BEGIN
  SELECT RAISE(ABORT, 'accepted canonical field requires an accepted claim for the same record');
END;

CREATE TRIGGER IF NOT EXISTS trg_claim_acceptance_requires_official_evidence
BEFORE UPDATE OF claim_status ON claims
WHEN NEW.claim_status = 'accepted' AND NOT EXISTS (
  SELECT 1
  FROM claim_evidence ce
  JOIN source_fragments sf ON sf.id = ce.fragment_id
  JOIN source_fetches f ON f.id = sf.fetch_id
  JOIN source_documents s ON s.id = f.source_id
  WHERE ce.claim_id = NEW.id
    AND ce.evidence_role IN ('primary', 'corroborating')
    AND s.official = 1
    AND s.authority_level IN ('primary_official', 'secondary_official')
)
BEGIN
  SELECT RAISE(ABORT, 'accepted claim requires official evidence');
END;

CREATE TRIGGER IF NOT EXISTS trg_fee_owner_insert
BEFORE INSERT ON fee_items
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program_cycle', 'application_route', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'fee owner has an unsupported kind');
END;

CREATE TRIGGER IF NOT EXISTS trg_requirement_owner_update
BEFORE UPDATE OF owner_record_id ON requirements
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program', 'program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'requirement owner has an unsupported kind');
END;

CREATE TRIGGER IF NOT EXISTS trg_required_document_owner_update
BEFORE UPDATE OF owner_record_id ON required_documents
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program', 'program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'required document owner has an unsupported kind');
END;
