-- StudyInChina ingestion/canonical domain model for Cloudflare D1.
-- This migration is intentionally re-runnable for disposable local databases.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'organization', 'location', 'campus', 'academic_unit',
    'program', 'program_cycle', 'application_route', 'application_window',
    'fee', 'requirement', 'required_document',
    'scholarship', 'scholarship_cycle', 'scholarship_coverage'
  )),
  slug TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'draft' CHECK (workflow_status IN (
    'draft', 'validated', 'applied', 'published', 'stale',
    'quarantined', 'archived', 'rejected'
  )),
  review_after TEXT CHECK (
    review_after IS NULL OR (date(review_after) IS NOT NULL AND review_after = date(review_after))
  ),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  archived_at TEXT,
  UNIQUE (kind, slug)
);

CREATE TABLE IF NOT EXISTS record_slugs (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  valid_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  PRIMARY KEY (record_id, slug),
  CHECK ((is_current = 1 AND valid_to IS NULL) OR is_current = 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_record_slugs_current
  ON record_slugs(record_id)
  WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS organizations (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  organization_type TEXT NOT NULL CHECK (organization_type IN (
    'university', 'college', 'government', 'scholarship_provider',
    'language_center', 'research_institute', 'other'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%')
);

CREATE TABLE IF NOT EXISTS organization_domains (
  organization_id TEXT NOT NULL REFERENCES organizations(record_id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain = lower(domain) AND instr(domain, '/') = 0),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, domain)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_primary_domain
  ON organization_domains(organization_id)
  WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS locations (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  parent_location_id TEXT REFERENCES locations(record_id) ON DELETE RESTRICT,
  location_type TEXT NOT NULL CHECK (location_type IN (
    'country', 'province', 'municipality', 'city', 'district'
  )),
  country_code TEXT NOT NULL DEFAULT 'CN' CHECK (
    length(country_code) = 2 AND country_code = upper(country_code)
  ),
  region_code TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS localized_content (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 15),
  field_name TEXT NOT NULL,
  text_value TEXT NOT NULL CHECK (length(trim(text_value)) > 0),
  translation_status TEXT NOT NULL DEFAULT 'draft' CHECK (translation_status IN (
    'draft', 'machine', 'reviewed', 'published'
  )),
  source_locale TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_id, locale, field_name)
);

CREATE TABLE IF NOT EXISTS institutions (
  record_id TEXT PRIMARY KEY REFERENCES organizations(record_id) ON DELETE RESTRICT,
  city_id TEXT NOT NULL REFERENCES locations(record_id) ON DELETE RESTRICT,
  institution_type TEXT NOT NULL CHECK (institution_type IN (
    'comprehensive', 'normal', 'medical', 'language', 'engineering',
    'finance', 'arts', 'vocational', 'other'
  )),
  ministry_code TEXT,
  admissions_url TEXT NOT NULL CHECK (admissions_url LIKE 'https://%'),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1))
);

CREATE TABLE IF NOT EXISTS campuses (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  city_id TEXT NOT NULL REFERENCES locations(record_id) ON DELETE RESTRICT,
  official_url TEXT CHECK (official_url IS NULL OR official_url LIKE 'https://%')
);

CREATE TABLE IF NOT EXISTS academic_units (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  parent_unit_id TEXT REFERENCES academic_units(record_id) ON DELETE RESTRICT,
  official_url TEXT CHECK (official_url IS NULL OR official_url LIKE 'https://%')
);

CREATE TABLE IF NOT EXISTS programs (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  academic_unit_id TEXT REFERENCES academic_units(record_id) ON DELETE SET NULL,
  parent_program_id TEXT REFERENCES programs(record_id) ON DELETE RESTRICT,
  program_type TEXT NOT NULL CHECK (program_type IN (
    'degree', 'language', 'foundation', 'exchange', 'visiting',
    'short_term', 'other'
  )),
  degree_level TEXT CHECK (degree_level IS NULL OR degree_level IN (
    'bachelor', 'master', 'doctorate'
  )),
  credential_type TEXT,
  attendance_mode TEXT NOT NULL DEFAULT 'full_time' CHECK (attendance_mode IN (
    'full_time', 'part_time', 'hybrid'
  )),
  delivery_mode TEXT NOT NULL DEFAULT 'on_campus' CHECK (delivery_mode IN (
    'on_campus', 'online', 'hybrid'
  )),
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  duration_max INTEGER CHECK (duration_max IS NULL OR duration_max > 0),
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN (
    'days', 'weeks', 'months', 'semesters', 'academic_years'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  CHECK (
    (program_type = 'degree' AND degree_level IS NOT NULL)
    OR (program_type <> 'degree' AND degree_level IS NULL)
  ),
  CHECK (duration_max IS NULL OR duration_min IS NOT NULL),
  CHECK (duration_max IS NULL OR duration_max >= duration_min),
  CHECK ((duration_min IS NULL AND duration_unit IS NULL) OR duration_unit IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS disciplines (
  code TEXT PRIMARY KEY,
  parent_code TEXT REFERENCES disciplines(code) ON DELETE RESTRICT,
  name_en TEXT NOT NULL,
  name_zh TEXT
);

CREATE TABLE IF NOT EXISTS program_disciplines (
  program_id TEXT NOT NULL REFERENCES programs(record_id) ON DELETE CASCADE,
  discipline_code TEXT NOT NULL REFERENCES disciplines(code) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (program_id, discipline_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_primary_discipline
  ON program_disciplines(program_id)
  WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 15),
  name_en TEXT NOT NULL,
  name_zh TEXT
);

CREATE TABLE IF NOT EXISTS program_teaching_languages (
  program_id TEXT NOT NULL REFERENCES programs(record_id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN (
    'primary', 'secondary', 'bilingual', 'support'
  )),
  PRIMARY KEY (program_id, language_code, role)
);

CREATE TABLE IF NOT EXISTS program_cycles (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  program_id TEXT NOT NULL REFERENCES programs(record_id) ON DELETE RESTRICT,
  academic_year TEXT NOT NULL CHECK (
    length(academic_year) = 9
    AND academic_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
  ),
  intake_code TEXT NOT NULL CHECK (intake_code IN (
    'spring', 'summer', 'autumn', 'winter', 'other'
  )),
  sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
  starts_on TEXT CHECK (
    starts_on IS NULL OR (date(starts_on) IS NOT NULL AND starts_on = date(starts_on))
  ),
  ends_on TEXT CHECK (
    ends_on IS NULL OR (date(ends_on) IS NOT NULL AND ends_on = date(ends_on))
  ),
  cycle_status TEXT NOT NULL DEFAULT 'announced' CHECK (cycle_status IN (
    'announced', 'cancelled', 'completed', 'archived'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  UNIQUE (program_id, academic_year, intake_code, sequence),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS application_routes (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  owner_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  route_type TEXT NOT NULL CHECK (route_type IN (
    'university_portal', 'government_portal', 'email', 'paper',
    'nomination', 'other'
  )),
  access_mode TEXT NOT NULL CHECK (access_mode IN (
    'public_individual', 'nomination_only', 'invitation_only', 'both', 'unknown'
  )),
  apply_url TEXT CHECK (apply_url IS NULL OR apply_url LIKE 'https://%'),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  UNIQUE (owner_record_id, route_type, apply_url)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_primary_application_route
  ON application_routes(owner_record_id)
  WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS application_windows (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  application_route_id TEXT NOT NULL REFERENCES application_routes(record_id) ON DELETE CASCADE,
  round_label TEXT,
  opens_on TEXT CHECK (
    opens_on IS NULL OR (date(opens_on) IS NOT NULL AND opens_on = date(opens_on))
  ),
  closes_on TEXT CHECK (
    closes_on IS NULL OR (date(closes_on) IS NOT NULL AND closes_on = date(closes_on))
  ),
  rolling INTEGER NOT NULL DEFAULT 0 CHECK (rolling IN (0, 1)),
  CHECK (closes_on IS NULL OR opens_on IS NULL OR closes_on >= opens_on),
  CHECK (rolling = 0 OR closes_on IS NULL)
);

CREATE TABLE IF NOT EXISTS fee_items (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  owner_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE RESTRICT,
  fee_type TEXT NOT NULL CHECK (fee_type IN (
    'tuition', 'application', 'accommodation', 'insurance', 'deposit', 'other'
  )),
  amount_min_minor INTEGER CHECK (amount_min_minor IS NULL OR amount_min_minor >= 0),
  amount_max_minor INTEGER CHECK (amount_max_minor IS NULL OR amount_max_minor >= 0),
  currency_code TEXT CHECK (
    currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code))
  ),
  currency_exponent INTEGER NOT NULL DEFAULT 2 CHECK (currency_exponent BETWEEN 0 AND 4),
  billing_period TEXT CHECK (billing_period IS NULL OR billing_period IN (
    'one_time', 'program', 'academic_year', 'semester', 'month', 'week', 'day', 'other'
  )),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  value_status TEXT NOT NULL DEFAULT 'unknown' CHECK (value_status IN (
    'confirmed', 'reference', 'unknown', 'withheld'
  )),
  CHECK (amount_max_minor IS NULL OR amount_min_minor IS NOT NULL),
  CHECK (amount_max_minor IS NULL OR amount_max_minor >= amount_min_minor),
  CHECK ((amount_min_minor IS NULL AND currency_code IS NULL) OR currency_code IS NOT NULL),
  CHECK (value_status <> 'confirmed' OR amount_min_minor IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS requirements (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  owner_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN (
    'nationality', 'age', 'education', 'gpa', 'language_test', 'health',
    'passport', 'work_experience', 'nomination', 'portfolio', 'other'
  )),
  comparator TEXT CHECK (comparator IS NULL OR comparator IN (
    'eq', 'neq', 'gte', 'lte', 'between', 'in', 'not_in', 'present'
  )),
  value_json TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  applies_to_json TEXT CHECK (applies_to_json IS NULL OR json_valid(applies_to_json)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS required_documents (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  owner_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'passport', 'photo', 'diploma', 'transcript', 'language_certificate',
    'study_plan', 'recommendation', 'health_form', 'police_clearance',
    'financial_proof', 'portfolio', 'nomination_letter', 'other'
  )),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  copies INTEGER CHECK (copies IS NULL OR copies > 0),
  notarization_required INTEGER CHECK (notarization_required IS NULL OR notarization_required IN (0, 1)),
  translation_required INTEGER CHECK (translation_required IS NULL OR translation_required IN (0, 1))
);

CREATE TABLE IF NOT EXISTS scholarships (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  provider_organization_id TEXT NOT NULL REFERENCES organizations(record_id) ON DELETE RESTRICT,
  scheme_type TEXT NOT NULL CHECK (scheme_type IN (
    'government', 'university', 'province', 'city', 'foundation', 'other'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%')
);

CREATE TABLE IF NOT EXISTS scholarship_cycles (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  scholarship_id TEXT NOT NULL REFERENCES scholarships(record_id) ON DELETE RESTRICT,
  academic_year TEXT NOT NULL CHECK (
    length(academic_year) = 9
    AND academic_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
  ),
  intake_code TEXT NOT NULL DEFAULT 'other' CHECK (intake_code IN (
    'spring', 'summer', 'autumn', 'winter', 'other'
  )),
  sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
  cycle_status TEXT NOT NULL DEFAULT 'announced' CHECK (cycle_status IN (
    'announced', 'cancelled', 'completed', 'archived'
  )),
  institution_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (institution_scope IN ('all', 'listed', 'unknown')),
  program_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (program_scope IN ('all', 'listed', 'unknown')),
  degree_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (degree_scope IN ('all', 'listed', 'unknown')),
  nationality_scope TEXT NOT NULL DEFAULT 'unknown' CHECK (nationality_scope IN ('all', 'listed', 'unknown')),
  UNIQUE (scholarship_id, academic_year, intake_code, sequence)
);

CREATE TABLE IF NOT EXISTS scholarship_coverage_items (
  record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  coverage_type TEXT NOT NULL CHECK (coverage_type IN (
    'tuition', 'accommodation', 'insurance', 'stipend', 'travel', 'other'
  )),
  coverage_mode TEXT NOT NULL CHECK (coverage_mode IN (
    'full', 'partial', 'fixed', 'waiver', 'none', 'unknown', 'withheld'
  )),
  amount_min_minor INTEGER CHECK (amount_min_minor IS NULL OR amount_min_minor >= 0),
  amount_max_minor INTEGER CHECK (amount_max_minor IS NULL OR amount_max_minor >= 0),
  currency_code TEXT CHECK (
    currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code))
  ),
  currency_exponent INTEGER NOT NULL DEFAULT 2 CHECK (currency_exponent BETWEEN 0 AND 4),
  period TEXT CHECK (period IS NULL OR period IN (
    'one_time', 'program', 'academic_year', 'semester', 'month', 'week', 'day', 'other'
  )),
  max_duration INTEGER CHECK (max_duration IS NULL OR max_duration > 0),
  max_duration_unit TEXT CHECK (max_duration_unit IS NULL OR max_duration_unit IN (
    'days', 'weeks', 'months', 'semesters', 'academic_years'
  )),
  CHECK (amount_max_minor IS NULL OR amount_min_minor IS NOT NULL),
  CHECK (amount_max_minor IS NULL OR amount_max_minor >= amount_min_minor),
  CHECK ((amount_min_minor IS NULL AND currency_code IS NULL) OR currency_code IS NOT NULL),
  CHECK ((max_duration IS NULL AND max_duration_unit IS NULL) OR max_duration_unit IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_institutions (
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions(record_id) ON DELETE RESTRICT,
  inclusion TEXT NOT NULL DEFAULT 'include' CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (scholarship_cycle_id, institution_id)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_programs (
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(record_id) ON DELETE RESTRICT,
  inclusion TEXT NOT NULL DEFAULT 'include' CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (scholarship_cycle_id, program_id)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_degree_levels (
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  degree_level TEXT NOT NULL CHECK (degree_level IN ('bachelor', 'master', 'doctorate')),
  inclusion TEXT NOT NULL DEFAULT 'include' CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (scholarship_cycle_id, degree_level)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_disciplines (
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  discipline_code TEXT NOT NULL REFERENCES disciplines(code) ON DELETE RESTRICT,
  inclusion TEXT NOT NULL DEFAULT 'include' CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (scholarship_cycle_id, discipline_code)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_nationalities (
  scholarship_cycle_id TEXT NOT NULL REFERENCES scholarship_cycles(record_id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  inclusion TEXT NOT NULL DEFAULT 'include' CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (scholarship_cycle_id, country_code)
);

-- SQLite cannot express a foreign key constrained to selected record kinds.
-- These triggers preserve that invariant in D1 and in local SQLite.
CREATE TRIGGER IF NOT EXISTS trg_application_route_owner_insert
BEFORE INSERT ON application_routes
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'application route owner must be a program or scholarship cycle');
END;

CREATE TRIGGER IF NOT EXISTS trg_application_route_owner_update
BEFORE UPDATE OF owner_record_id ON application_routes
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'application route owner must be a program or scholarship cycle');
END;

CREATE TRIGGER IF NOT EXISTS trg_requirement_owner_insert
BEFORE INSERT ON requirements
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program', 'program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'requirement owner has an unsupported kind');
END;

CREATE TRIGGER IF NOT EXISTS trg_required_document_owner_insert
BEFORE INSERT ON required_documents
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program', 'program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'required document owner has an unsupported kind');
END;
