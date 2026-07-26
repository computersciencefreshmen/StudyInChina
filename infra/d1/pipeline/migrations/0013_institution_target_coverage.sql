-- Versioned institution target cohorts and source-category coverage.
-- This layer lets Pipeline track institutions before canonical records exist.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS institution_target_cohorts (
  cohort_id TEXT PRIMARY KEY,
  title_zh TEXT NOT NULL CHECK (length(trim(title_zh)) > 0),
  official_page_url TEXT NOT NULL CHECK (official_page_url LIKE 'https://%'),
  official_attachment_url TEXT NOT NULL CHECK (official_attachment_url LIKE 'https://%'),
  official_institution_count INTEGER NOT NULL CHECK (official_institution_count > 0),
  content_sha256 TEXT NOT NULL CHECK (
    length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  published_on TEXT NOT NULL CHECK (
    date(published_on) IS NOT NULL AND published_on = date(published_on)
  ),
  checked_on TEXT NOT NULL CHECK (
    date(checked_on) IS NOT NULL AND checked_on = date(checked_on)
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS institution_targets (
  target_id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL
    REFERENCES institution_target_cohorts(cohort_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  official_name_zh TEXT NOT NULL CHECK (length(trim(official_name_zh)) > 0),
  catalog_institution_id TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'registered' CHECK (onboarding_status IN (
    'registered', 'source_discovery', 'sources_registered',
    'entity_onboarding', 'catalog_ready'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cohort_id, ordinal),
  UNIQUE (cohort_id, official_name_zh),
  UNIQUE (cohort_id, catalog_institution_id)
);

CREATE TABLE IF NOT EXISTS institution_target_source_coverage (
  target_id TEXT NOT NULL
    REFERENCES institution_targets(target_id) ON DELETE CASCADE,
  source_category TEXT NOT NULL CHECK (source_category IN (
    'international_admissions_home',
    'undergraduate_catalog',
    'masters_catalog',
    'doctoral_catalog',
    'non_degree_catalog',
    'current_guide',
    'dates_deadlines',
    'fees',
    'eligibility_language',
    'application_portal',
    'university_scholarship',
    'faculty_scholarship',
    'government_scholarship',
    'program_detail',
    'contacts',
    'catalog_anchor'
  )),
  coverage_status TEXT NOT NULL DEFAULT 'discovery_pending' CHECK (coverage_status IN (
    'discovery_pending', 'discovered', 'registered', 'parser_pending',
    'source_unavailable', 'officially_not_provided'
  )),
  official_url TEXT CHECK (official_url IS NULL OR official_url LIKE 'https://%'),
  registered_source_id TEXT
    REFERENCES ingestion_sources(source_id) ON DELETE RESTRICT,
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  checked_at TEXT CHECK (checked_at IS NULL OR julianday(checked_at) IS NOT NULL),
  next_check_at TEXT CHECK (next_check_at IS NULL OR julianday(next_check_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_id, source_category),
  CHECK (
    coverage_status <> 'discovered'
    OR (official_url IS NOT NULL AND checked_at IS NOT NULL)
  ),
  CHECK (
    coverage_status NOT IN ('registered', 'parser_pending')
    OR (official_url IS NOT NULL AND registered_source_id IS NOT NULL AND checked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_institution_targets_onboarding
  ON institution_targets(onboarding_status, cohort_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_target_source_coverage_queue
  ON institution_target_source_coverage(coverage_status, next_check_at, source_category);

CREATE INDEX IF NOT EXISTS idx_target_source_coverage_source
  ON institution_target_source_coverage(registered_source_id)
  WHERE registered_source_id IS NOT NULL;

CREATE VIEW IF NOT EXISTS institution_target_coverage_summary AS
SELECT
  target.target_id,
  target.cohort_id,
  target.ordinal,
  target.official_name_zh,
  target.catalog_institution_id,
  target.onboarding_status,
  COUNT(coverage.source_category) AS required_category_count,
  SUM(CASE WHEN coverage.coverage_status = 'discovery_pending' THEN 1 ELSE 0 END)
    AS discovery_pending_count,
  SUM(CASE WHEN coverage.coverage_status = 'discovered' THEN 1 ELSE 0 END)
    AS discovered_count,
  SUM(CASE WHEN coverage.coverage_status IN ('registered', 'parser_pending') THEN 1 ELSE 0 END)
    AS registered_count,
  SUM(CASE WHEN coverage.coverage_status IN (
    'discovered', 'registered', 'parser_pending',
    'source_unavailable', 'officially_not_provided'
  ) THEN 1 ELSE 0 END) AS reconciled_category_count
FROM institution_targets AS target
LEFT JOIN institution_target_source_coverage AS coverage
  ON coverage.target_id = target.target_id
GROUP BY
  target.target_id,
  target.cohort_id,
  target.ordinal,
  target.official_name_zh,
  target.catalog_institution_id,
  target.onboarding_status;

PRAGMA optimize;
