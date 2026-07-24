-- Immutable public catalog release core for Cloudflare D1.
-- The pipeline builds a complete release, validates it, marks it active, and
-- atomically switches release_pointer. Public queries never read a building release.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalog_releases (
  release_id TEXT PRIMARY KEY,
  data_version INTEGER NOT NULL UNIQUE CHECK (data_version > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  release_status TEXT NOT NULL DEFAULT 'building' CHECK (release_status IN (
    'building', 'ready', 'active', 'retired', 'failed'
  )),
  data_date TEXT NOT NULL CHECK (
    date(data_date) IS NOT NULL AND data_date = date(data_date)
  ),
  generated_at TEXT NOT NULL CHECK (
    julianday(generated_at) IS NOT NULL
    AND
    length(generated_at) >= 20
    AND substr(generated_at, 5, 1) = '-'
    AND substr(generated_at, 8, 1) = '-'
    AND substr(generated_at, 11, 1) = 'T'
  ),
  source_pipeline_run_id TEXT NOT NULL,
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  counts_json TEXT NOT NULL DEFAULT '{"sources":0,"cities":0,"universities":0,"programs":0,"admissionCycles":0,"scholarships":0}' CHECK (
    json_valid(counts_json)
    AND json_type(counts_json) = 'object'
    AND COALESCE(json_type(counts_json, '$.sources') = 'integer', 0)
    AND COALESCE(json_type(counts_json, '$.cities') = 'integer', 0)
    AND COALESCE(json_type(counts_json, '$.universities') = 'integer', 0)
    AND COALESCE(json_type(counts_json, '$.programs') = 'integer', 0)
    AND COALESCE(json_type(counts_json, '$.admissionCycles') = 'integer', 0)
    AND COALESCE(json_type(counts_json, '$.scholarships') = 'integer', 0)
    AND json_extract(counts_json, '$.sources') >= 0
    AND json_extract(counts_json, '$.cities') >= 0
    AND json_extract(counts_json, '$.universities') >= 0
    AND json_extract(counts_json, '$.programs') >= 0
    AND json_extract(counts_json, '$.admissionCycles') >= 0
    AND json_extract(counts_json, '$.scholarships') >= 0
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validated_at TEXT,
  activated_at TEXT,
  expires_at TEXT,
  CHECK (release_status NOT IN ('ready', 'active', 'retired') OR content_sha256 IS NOT NULL),
  CHECK (release_status <> 'active' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_single_active_release
  ON catalog_releases(release_status)
  WHERE release_status = 'active';

CREATE TABLE IF NOT EXISTS release_pointer (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  current_release_id TEXT REFERENCES catalog_releases(release_id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'migration'
);

INSERT OR IGNORE INTO release_pointer (
  singleton_id, current_release_id, updated_at, updated_by
) VALUES (1, NULL, CURRENT_TIMESTAMP, 'migration');

CREATE TABLE IF NOT EXISTS release_audit_log (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES catalog_releases(release_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'created', 'loaded', 'validated', 'activated', 'retired', 'failed', 'purged'
  )),
  actor TEXT NOT NULL,
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_records (
  release_id TEXT NOT NULL REFERENCES catalog_releases(release_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN (
    'organization', 'location', 'campus', 'academic_unit',
    'program', 'program_cycle', 'application_route', 'application_window',
    'fee', 'requirement', 'required_document',
    'scholarship', 'scholarship_cycle', 'scholarship_coverage'
  )),
  slug TEXT,
  gate_status TEXT NOT NULL CHECK (gate_status IN ('publishable', 'withheld')),
  verified_at TEXT CHECK (
    verified_at IS NULL OR (date(verified_at) IS NOT NULL AND verified_at = date(verified_at))
  ),
  review_after TEXT CHECK (
    review_after IS NULL OR (date(review_after) IS NOT NULL AND review_after = date(review_after))
  ),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  PRIMARY KEY (release_id, record_id),
  UNIQUE (release_id, record_kind, slug),
  CHECK (
    gate_status = 'withheld'
    OR (verified_at IS NOT NULL AND review_after IS NOT NULL AND review_after >= verified_at)
  )
);

CREATE TABLE IF NOT EXISTS record_field_status (
  release_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  field_status TEXT NOT NULL CHECK (field_status IN (
    'known', 'officially_not_announced', 'not_applicable',
    'source_unavailable', 'conflict', 'stale'
  )),
  required_for_publish INTEGER NOT NULL DEFAULT 0 CHECK (required_for_publish IN (0, 1)),
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  verified_at TEXT CHECK (
    verified_at IS NULL OR (date(verified_at) IS NOT NULL AND verified_at = date(verified_at))
  ),
  review_after TEXT CHECK (
    review_after IS NULL OR (date(review_after) IS NOT NULL AND review_after = date(review_after))
  ),
  PRIMARY KEY (release_id, record_id, field_path, locale),
  FOREIGN KEY (release_id, record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  CHECK (
    (field_status = 'known'
      AND value_json IS NOT NULL
      AND verified_at IS NOT NULL
      AND review_after IS NOT NULL
      AND review_after >= verified_at)
    OR
    (field_status IN (
      'officially_not_announced', 'not_applicable', 'source_unavailable',
      'conflict', 'stale'
    ) AND value_json IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS source_summaries (
  release_id TEXT NOT NULL REFERENCES catalog_releases(release_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL CHECK (url LIKE 'https://%'),
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'institution', 'program', 'admissions', 'scholarship', 'government',
    'application_portal', 'city', 'other'
  )),
  language_code TEXT NOT NULL,
  authority_level TEXT NOT NULL CHECK (authority_level IN (
    'primary_official', 'secondary_official'
  )),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (release_id, source_id)
);

CREATE TABLE IF NOT EXISTS record_sources (
  release_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_path TEXT NOT NULL DEFAULT '*',
  locale TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL DEFAULT 'primary' CHECK (evidence_role IN (
    'primary', 'corroborating'
  )),
  PRIMARY KEY (release_id, record_id, field_path, locale, source_id),
  FOREIGN KEY (release_id, record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, source_id)
    REFERENCES source_summaries(release_id, source_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS localized_content (
  release_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 15),
  field_name TEXT NOT NULL,
  text_value TEXT NOT NULL CHECK (length(trim(text_value)) > 0),
  translation_status TEXT NOT NULL CHECK (translation_status IN (
    'reviewed', 'published', 'fallback'
  )),
  source_locale TEXT,
  PRIMARY KEY (release_id, record_id, locale, field_name),
  FOREIGN KEY (release_id, record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  CHECK (translation_status <> 'fallback' OR source_locale IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS locations (
  release_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  parent_location_id TEXT,
  location_type TEXT NOT NULL CHECK (location_type IN (
    'country', 'province', 'municipality', 'city', 'district'
  )),
  country_code TEXT NOT NULL DEFAULT 'CN' CHECK (
    length(country_code) = 2 AND country_code = upper(country_code)
  ),
  region_code TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  PRIMARY KEY (release_id, location_id),
  FOREIGN KEY (release_id, location_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, parent_location_id)
    REFERENCES locations(release_id, location_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS organizations (
  release_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  organization_type TEXT NOT NULL CHECK (organization_type IN (
    'university', 'college', 'government', 'scholarship_provider',
    'language_center', 'research_institute', 'other'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, organization_id),
  FOREIGN KEY (release_id, organization_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS institutions (
  release_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  city_id TEXT NOT NULL,
  institution_type TEXT NOT NULL CHECK (institution_type IN (
    'comprehensive', 'normal', 'medical', 'language', 'engineering',
    'finance', 'arts', 'vocational', 'other'
  )),
  admissions_url TEXT NOT NULL CHECK (admissions_url LIKE 'https://%'),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  PRIMARY KEY (release_id, institution_id),
  FOREIGN KEY (release_id, institution_id)
    REFERENCES organizations(release_id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, city_id)
    REFERENCES locations(release_id, location_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS campuses (
  release_id TEXT NOT NULL,
  campus_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  city_id TEXT NOT NULL,
  official_url TEXT CHECK (official_url IS NULL OR official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, campus_id),
  FOREIGN KEY (release_id, campus_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, institution_id)
    REFERENCES institutions(release_id, institution_id) ON DELETE RESTRICT,
  FOREIGN KEY (release_id, city_id)
    REFERENCES locations(release_id, location_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS academic_units (
  release_id TEXT NOT NULL,
  academic_unit_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  parent_unit_id TEXT,
  official_url TEXT CHECK (official_url IS NULL OR official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, academic_unit_id),
  FOREIGN KEY (release_id, academic_unit_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, institution_id)
    REFERENCES institutions(release_id, institution_id) ON DELETE RESTRICT,
  FOREIGN KEY (release_id, parent_unit_id)
    REFERENCES academic_units(release_id, academic_unit_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_catalog_records_release_kind_gate_review
  ON catalog_records(release_id, record_kind, gate_status, review_after);
CREATE INDEX IF NOT EXISTS idx_catalog_records_release_slug
  ON catalog_records(release_id, slug);
CREATE INDEX IF NOT EXISTS idx_record_field_status_public
  ON record_field_status(release_id, record_id, field_status, review_after);
CREATE INDEX IF NOT EXISTS idx_record_sources_record
  ON record_sources(release_id, record_id, field_path);
CREATE INDEX IF NOT EXISTS idx_record_sources_source
  ON record_sources(release_id, source_id);
CREATE INDEX IF NOT EXISTS idx_localized_content_lookup
  ON localized_content(release_id, locale, record_id, field_name);
CREATE INDEX IF NOT EXISTS idx_locations_parent_type
  ON locations(release_id, parent_location_id, location_type);
CREATE INDEX IF NOT EXISTS idx_institutions_city
  ON institutions(release_id, city_id);

CREATE TRIGGER IF NOT EXISTS trg_release_pointer_active_insert
BEFORE INSERT ON release_pointer
WHEN NEW.current_release_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM catalog_releases
  WHERE release_id = NEW.current_release_id AND release_status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'release pointer target must be active');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_pointer_active_update
BEFORE UPDATE OF current_release_id ON release_pointer
WHEN NEW.current_release_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM catalog_releases
  WHERE release_id = NEW.current_release_id AND release_status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'release pointer target must be active');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_pointer_delete
BEFORE DELETE ON release_pointer
BEGIN
  SELECT RAISE(ABORT, 'release pointer singleton cannot be deleted');
END;
