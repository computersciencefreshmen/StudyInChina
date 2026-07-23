-- Release-scoped program, admission-cycle, and scholarship projections.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS programs (
  release_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  academic_unit_id TEXT,
  parent_program_id TEXT,
  program_type TEXT NOT NULL CHECK (program_type IN (
    'degree', 'language', 'foundation', 'exchange', 'visiting',
    'short_term', 'other'
  )),
  degree_level TEXT CHECK (degree_level IS NULL OR degree_level IN (
    'bachelor', 'master', 'doctorate'
  )),
  credential_type TEXT,
  attendance_mode TEXT NOT NULL CHECK (attendance_mode IN (
    'full_time', 'part_time', 'hybrid'
  )),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN (
    'on_campus', 'online', 'hybrid'
  )),
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  duration_max INTEGER CHECK (duration_max IS NULL OR duration_max > 0),
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN (
    'days', 'weeks', 'months', 'semesters', 'academic_years'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, program_id),
  FOREIGN KEY (release_id, program_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, institution_id)
    REFERENCES institutions(release_id, institution_id) ON DELETE RESTRICT,
  FOREIGN KEY (release_id, academic_unit_id)
    REFERENCES academic_units(release_id, academic_unit_id) ON DELETE SET NULL,
  FOREIGN KEY (release_id, parent_program_id)
    REFERENCES programs(release_id, program_id) ON DELETE RESTRICT,
  CHECK (
    (program_type = 'degree' AND degree_level IS NOT NULL)
    OR (program_type <> 'degree' AND degree_level IS NULL)
  ),
  CHECK (duration_max IS NULL OR duration_min IS NOT NULL),
  CHECK (duration_max IS NULL OR duration_max >= duration_min),
  CHECK ((duration_min IS NULL AND duration_unit IS NULL) OR duration_unit IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS disciplines (
  release_id TEXT NOT NULL REFERENCES catalog_releases(release_id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  parent_code TEXT,
  name_en TEXT NOT NULL,
  name_zh TEXT,
  PRIMARY KEY (release_id, code),
  FOREIGN KEY (release_id, parent_code)
    REFERENCES disciplines(release_id, code) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS program_disciplines (
  release_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (release_id, program_id, discipline_code),
  FOREIGN KEY (release_id, program_id)
    REFERENCES programs(release_id, program_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, discipline_code)
    REFERENCES disciplines(release_id, code) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_program_primary_discipline
  ON program_disciplines(release_id, program_id)
  WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS languages (
  release_id TEXT NOT NULL REFERENCES catalog_releases(release_id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 15),
  name_en TEXT NOT NULL,
  name_zh TEXT,
  PRIMARY KEY (release_id, code)
);

CREATE TABLE IF NOT EXISTS program_teaching_languages (
  release_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  language_code TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN (
    'primary', 'secondary', 'bilingual', 'support'
  )),
  PRIMARY KEY (release_id, program_id, language_code, role),
  FOREIGN KEY (release_id, program_id)
    REFERENCES programs(release_id, program_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, language_code)
    REFERENCES languages(release_id, code) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS program_cycles (
  release_id TEXT NOT NULL,
  program_cycle_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
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
  cycle_status TEXT NOT NULL CHECK (cycle_status IN (
    'announced', 'cancelled', 'completed', 'archived'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, program_cycle_id),
  UNIQUE (release_id, program_id, academic_year, intake_code, sequence),
  FOREIGN KEY (release_id, program_cycle_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, program_id)
    REFERENCES programs(release_id, program_id) ON DELETE RESTRICT,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS application_routes (
  release_id TEXT NOT NULL,
  application_route_id TEXT NOT NULL,
  owner_record_id TEXT NOT NULL,
  route_type TEXT NOT NULL CHECK (route_type IN (
    'university_portal', 'government_portal', 'email', 'paper',
    'nomination', 'other'
  )),
  access_mode TEXT NOT NULL CHECK (access_mode IN (
    'public_individual', 'nomination_only', 'invitation_only', 'both', 'unknown'
  )),
  apply_url TEXT CHECK (apply_url IS NULL OR apply_url LIKE 'https://%'),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (release_id, application_route_id),
  UNIQUE (release_id, owner_record_id, route_type, apply_url),
  FOREIGN KEY (release_id, application_route_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, owner_record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_primary_application_route
  ON application_routes(release_id, owner_record_id)
  WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS application_windows (
  release_id TEXT NOT NULL,
  application_window_id TEXT NOT NULL,
  application_route_id TEXT NOT NULL,
  round_label TEXT,
  opens_on TEXT CHECK (
    opens_on IS NULL OR (date(opens_on) IS NOT NULL AND opens_on = date(opens_on))
  ),
  closes_on TEXT CHECK (
    closes_on IS NULL OR (date(closes_on) IS NOT NULL AND closes_on = date(closes_on))
  ),
  rolling INTEGER NOT NULL DEFAULT 0 CHECK (rolling IN (0, 1)),
  PRIMARY KEY (release_id, application_window_id),
  FOREIGN KEY (release_id, application_window_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, application_route_id)
    REFERENCES application_routes(release_id, application_route_id) ON DELETE CASCADE,
  CHECK (closes_on IS NULL OR opens_on IS NULL OR closes_on >= opens_on),
  CHECK (rolling = 0 OR closes_on IS NULL)
);

CREATE TABLE IF NOT EXISTS fee_items (
  release_id TEXT NOT NULL,
  fee_id TEXT NOT NULL,
  owner_record_id TEXT NOT NULL,
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
  value_status TEXT NOT NULL CHECK (value_status IN ('confirmed', 'reference')),
  PRIMARY KEY (release_id, fee_id),
  FOREIGN KEY (release_id, fee_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, owner_record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  CHECK (amount_max_minor IS NULL OR amount_min_minor IS NOT NULL),
  CHECK (amount_max_minor IS NULL OR amount_max_minor >= amount_min_minor),
  CHECK (amount_min_minor IS NOT NULL AND currency_code IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS requirements (
  release_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  owner_record_id TEXT NOT NULL,
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
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, requirement_id),
  FOREIGN KEY (release_id, requirement_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, owner_record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS required_documents (
  release_id TEXT NOT NULL,
  required_document_id TEXT NOT NULL,
  owner_record_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'passport', 'photo', 'diploma', 'transcript', 'language_certificate',
    'study_plan', 'recommendation', 'health_form', 'police_clearance',
    'financial_proof', 'portfolio', 'nomination_letter', 'other'
  )),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  copies INTEGER CHECK (copies IS NULL OR copies > 0),
  notarization_required INTEGER CHECK (notarization_required IS NULL OR notarization_required IN (0, 1)),
  translation_required INTEGER CHECK (translation_required IS NULL OR translation_required IN (0, 1)),
  PRIMARY KEY (release_id, required_document_id),
  FOREIGN KEY (release_id, required_document_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, owner_record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scholarships (
  release_id TEXT NOT NULL,
  scholarship_id TEXT NOT NULL,
  provider_organization_id TEXT NOT NULL,
  scheme_type TEXT NOT NULL CHECK (scheme_type IN (
    'government', 'university', 'province', 'city', 'foundation', 'other'
  )),
  official_url TEXT NOT NULL CHECK (official_url LIKE 'https://%'),
  PRIMARY KEY (release_id, scholarship_id),
  FOREIGN KEY (release_id, scholarship_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, provider_organization_id)
    REFERENCES organizations(release_id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scholarship_cycles (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  scholarship_id TEXT NOT NULL,
  academic_year TEXT NOT NULL CHECK (
    length(academic_year) = 9
    AND academic_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
  ),
  intake_code TEXT NOT NULL CHECK (intake_code IN (
    'spring', 'summer', 'autumn', 'winter', 'other'
  )),
  sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
  cycle_status TEXT NOT NULL CHECK (cycle_status IN (
    'announced', 'cancelled', 'completed', 'archived'
  )),
  institution_scope TEXT NOT NULL CHECK (institution_scope IN ('all', 'listed')),
  program_scope TEXT NOT NULL CHECK (program_scope IN ('all', 'listed')),
  degree_scope TEXT NOT NULL CHECK (degree_scope IN ('all', 'listed')),
  nationality_scope TEXT NOT NULL CHECK (nationality_scope IN ('all', 'listed')),
  PRIMARY KEY (release_id, scholarship_cycle_id),
  UNIQUE (release_id, scholarship_id, academic_year, intake_code, sequence),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, scholarship_id)
    REFERENCES scholarships(release_id, scholarship_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scholarship_coverage_items (
  release_id TEXT NOT NULL,
  coverage_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  coverage_type TEXT NOT NULL CHECK (coverage_type IN (
    'tuition', 'accommodation', 'insurance', 'stipend', 'travel', 'other'
  )),
  coverage_mode TEXT NOT NULL CHECK (coverage_mode IN (
    'full', 'partial', 'fixed', 'waiver', 'none'
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
  PRIMARY KEY (release_id, coverage_id),
  FOREIGN KEY (release_id, coverage_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE,
  CHECK (amount_max_minor IS NULL OR amount_min_minor IS NOT NULL),
  CHECK (amount_max_minor IS NULL OR amount_max_minor >= amount_min_minor),
  CHECK ((amount_min_minor IS NULL AND currency_code IS NULL) OR currency_code IS NOT NULL),
  CHECK ((max_duration IS NULL AND max_duration_unit IS NULL) OR max_duration_unit IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_institutions (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  inclusion TEXT NOT NULL CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (release_id, scholarship_cycle_id, institution_id),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, institution_id)
    REFERENCES institutions(release_id, institution_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_programs (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  inclusion TEXT NOT NULL CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (release_id, scholarship_cycle_id, program_id),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, program_id)
    REFERENCES programs(release_id, program_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_degree_levels (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  degree_level TEXT NOT NULL CHECK (degree_level IN ('bachelor', 'master', 'doctorate')),
  inclusion TEXT NOT NULL CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (release_id, scholarship_cycle_id, degree_level),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_disciplines (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  inclusion TEXT NOT NULL CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (release_id, scholarship_cycle_id, discipline_code),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE,
  FOREIGN KEY (release_id, discipline_code)
    REFERENCES disciplines(release_id, code) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS scholarship_cycle_nationalities (
  release_id TEXT NOT NULL,
  scholarship_cycle_id TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2 AND country_code = upper(country_code)),
  inclusion TEXT NOT NULL CHECK (inclusion IN ('include', 'exclude')),
  PRIMARY KEY (release_id, scholarship_cycle_id, country_code),
  FOREIGN KEY (release_id, scholarship_cycle_id)
    REFERENCES scholarship_cycles(release_id, scholarship_cycle_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_programs_institution_type_degree
  ON programs(release_id, institution_id, program_type, degree_level);
CREATE INDEX IF NOT EXISTS idx_program_cycles_program_year_intake
  ON program_cycles(release_id, program_id, academic_year, intake_code);
CREATE INDEX IF NOT EXISTS idx_program_cycles_status
  ON program_cycles(release_id, cycle_status, academic_year);
CREATE INDEX IF NOT EXISTS idx_application_routes_owner_access
  ON application_routes(release_id, owner_record_id, access_mode);
CREATE INDEX IF NOT EXISTS idx_application_windows_dates
  ON application_windows(release_id, application_route_id, opens_on, closes_on);
CREATE INDEX IF NOT EXISTS idx_fee_items_owner_type_amount
  ON fee_items(release_id, owner_record_id, fee_type, amount_min_minor);
CREATE INDEX IF NOT EXISTS idx_requirements_owner_type
  ON requirements(release_id, owner_record_id, requirement_type);
CREATE INDEX IF NOT EXISTS idx_required_documents_owner_type
  ON required_documents(release_id, owner_record_id, document_type);
CREATE INDEX IF NOT EXISTS idx_scholarships_provider_type
  ON scholarships(release_id, provider_organization_id, scheme_type);
CREATE INDEX IF NOT EXISTS idx_scholarship_cycles_scheme_year
  ON scholarship_cycles(release_id, scholarship_id, academic_year, intake_code);
CREATE INDEX IF NOT EXISTS idx_scholarship_coverage_cycle_type
  ON scholarship_coverage_items(release_id, scholarship_cycle_id, coverage_type);

CREATE TRIGGER IF NOT EXISTS trg_catalog_application_route_owner_insert
BEFORE INSERT ON application_routes
WHEN NOT EXISTS (
  SELECT 1 FROM catalog_records
  WHERE release_id = NEW.release_id
    AND record_id = NEW.owner_record_id
    AND record_kind IN ('program_cycle', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'application route owner must be a program or scholarship cycle');
END;
