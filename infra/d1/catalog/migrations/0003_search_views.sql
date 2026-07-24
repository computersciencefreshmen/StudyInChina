-- FTS5 search projection and fail-closed current-release views.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_documents (
  search_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 15),
  record_kind TEXT NOT NULL CHECK (record_kind IN (
    'organization', 'location', 'program', 'program_cycle',
    'scholarship', 'scholarship_cycle'
  )),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL DEFAULT '',
  filter_text TEXT NOT NULL DEFAULT '',
  UNIQUE (release_id, record_id, locale),
  FOREIGN KEY (release_id, record_id)
    REFERENCES catalog_records(release_id, record_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title,
  body,
  filter_text,
  content = 'search_documents',
  content_rowid = 'search_rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_search_documents_insert
AFTER INSERT ON search_documents
BEGIN
  INSERT INTO search_fts(rowid, title, body, filter_text)
  VALUES (NEW.search_rowid, NEW.title, NEW.body, NEW.filter_text);
END;

CREATE TRIGGER IF NOT EXISTS trg_search_documents_delete
AFTER DELETE ON search_documents
BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, filter_text)
  VALUES ('delete', OLD.search_rowid, OLD.title, OLD.body, OLD.filter_text);
END;

CREATE TRIGGER IF NOT EXISTS trg_search_documents_update
AFTER UPDATE ON search_documents
BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, filter_text)
  VALUES ('delete', OLD.search_rowid, OLD.title, OLD.body, OLD.filter_text);
  INSERT INTO search_fts(rowid, title, body, filter_text)
  VALUES (NEW.search_rowid, NEW.title, NEW.body, NEW.filter_text);
END;

-- Safe when the migration is re-applied locally; it also repairs a missing index.
INSERT INTO search_fts(search_fts) VALUES ('rebuild');

DROP VIEW IF EXISTS current_release;
CREATE VIEW current_release AS
SELECT r.*
FROM release_pointer p
JOIN catalog_releases r ON r.release_id = p.current_release_id
WHERE p.singleton_id = 1
  AND r.release_status = 'active';

DROP VIEW IF EXISTS current_catalog_records;
CREATE VIEW current_catalog_records AS
SELECT cr.*
FROM catalog_records cr
JOIN current_release rel ON rel.release_id = cr.release_id
WHERE cr.gate_status = 'publishable';

DROP VIEW IF EXISTS current_record_fields;
CREATE VIEW current_record_fields AS
SELECT fs.*
FROM record_field_status fs
JOIN current_catalog_records cr
  ON cr.release_id = fs.release_id AND cr.record_id = fs.record_id
WHERE fs.field_status = 'known'
  AND fs.review_after >= date('now');

DROP VIEW IF EXISTS current_localized_content;
CREATE VIEW current_localized_content AS
SELECT lc.*
FROM localized_content lc
JOIN current_catalog_records cr
  ON cr.release_id = lc.release_id AND cr.record_id = lc.record_id;

DROP VIEW IF EXISTS current_locations;
CREATE VIEW current_locations AS
SELECT l.*
FROM locations l
JOIN current_catalog_records cr
  ON cr.release_id = l.release_id AND cr.record_id = l.location_id;

DROP VIEW IF EXISTS current_organizations;
CREATE VIEW current_organizations AS
SELECT o.*
FROM organizations o
JOIN current_catalog_records cr
  ON cr.release_id = o.release_id AND cr.record_id = o.organization_id;

DROP VIEW IF EXISTS current_institutions;
CREATE VIEW current_institutions AS
SELECT i.*
FROM institutions i
JOIN current_catalog_records cr
  ON cr.release_id = i.release_id AND cr.record_id = i.institution_id
JOIN current_organizations o
  ON o.release_id = i.release_id AND o.organization_id = i.institution_id
JOIN current_locations city
  ON city.release_id = i.release_id AND city.location_id = i.city_id;

DROP VIEW IF EXISTS current_programs;
CREATE VIEW current_programs AS
SELECT
  p.release_id,
  p.program_id,
  p.institution_id,
  p.academic_unit_id,
  p.parent_program_id,
  p.program_type,
  p.degree_level,
  p.credential_type,
  p.attendance_mode,
  p.delivery_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id AND f.field_path = 'duration_min'
  ) THEN p.duration_min END AS duration_min,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id AND f.field_path = 'duration_max'
  ) THEN p.duration_max END AS duration_max,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id AND f.field_path = 'duration_unit'
  ) THEN p.duration_unit END AS duration_unit,
  p.official_url
FROM programs p
JOIN current_catalog_records cr
  ON cr.release_id = p.release_id AND cr.record_id = p.program_id
JOIN current_institutions i
  ON i.release_id = p.release_id AND i.institution_id = p.institution_id
WHERE p.program_type NOT IN ('exchange', 'visiting', 'short_term')
   OR EXISTS (
     SELECT 1
     FROM program_cycles pc
     JOIN current_catalog_records cycle_record
       ON cycle_record.release_id = pc.release_id
      AND cycle_record.record_id = pc.program_cycle_id
     JOIN application_routes ar
       ON ar.release_id = pc.release_id
      AND ar.owner_record_id = pc.program_cycle_id
     JOIN current_catalog_records route_record
       ON route_record.release_id = ar.release_id
      AND route_record.record_id = ar.application_route_id
     WHERE pc.release_id = p.release_id
       AND pc.program_id = p.program_id
       AND pc.cycle_status = 'announced'
       AND ar.access_mode IN ('public_individual', 'both')
   );

DROP VIEW IF EXISTS current_program_cycles;
CREATE VIEW current_program_cycles AS
SELECT
  pc.release_id,
  pc.program_cycle_id,
  pc.program_id,
  pc.academic_year,
  pc.intake_code,
  pc.sequence,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = pc.release_id AND f.record_id = pc.program_cycle_id AND f.field_path = 'starts_on'
  ) THEN pc.starts_on END AS starts_on,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = pc.release_id AND f.record_id = pc.program_cycle_id AND f.field_path = 'ends_on'
  ) THEN pc.ends_on END AS ends_on,
  pc.cycle_status,
  pc.official_url
FROM program_cycles pc
JOIN current_catalog_records cr
  ON cr.release_id = pc.release_id AND cr.record_id = pc.program_cycle_id
JOIN current_programs p
  ON p.release_id = pc.release_id AND p.program_id = pc.program_id
WHERE pc.cycle_status = 'announced';

DROP VIEW IF EXISTS current_application_routes;
CREATE VIEW current_application_routes AS
SELECT ar.*
FROM application_routes ar
JOIN current_catalog_records cr
  ON cr.release_id = ar.release_id AND cr.record_id = ar.application_route_id
WHERE EXISTS (
  SELECT 1 FROM current_program_cycles pc
  WHERE pc.release_id = ar.release_id AND pc.program_cycle_id = ar.owner_record_id
)
OR EXISTS (
  SELECT 1 FROM scholarship_cycles sc
  JOIN current_catalog_records scr
    ON scr.release_id = sc.release_id AND scr.record_id = sc.scholarship_cycle_id
  WHERE sc.release_id = ar.release_id
    AND sc.scholarship_cycle_id = ar.owner_record_id
    AND sc.cycle_status = 'announced'
);

DROP VIEW IF EXISTS current_application_windows;
CREATE VIEW current_application_windows AS
SELECT
  visible.*,
  CASE
    WHEN visible.rolling = 1 THEN 'rolling'
    WHEN visible.opens_on IS NULL AND visible.closes_on IS NULL THEN 'not_announced'
    WHEN visible.closes_on IS NOT NULL AND visible.closes_on < date('now') THEN 'closed'
    WHEN visible.opens_on IS NOT NULL AND visible.opens_on > date('now') THEN 'upcoming'
    ELSE 'open'
  END AS application_state
FROM (
  SELECT
    aw.release_id,
    aw.application_window_id,
    aw.application_route_id,
    aw.round_label,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id AND f.field_path = 'opens_on'
    ) THEN aw.opens_on END AS opens_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id AND f.field_path = 'closes_on'
    ) THEN aw.closes_on END AS closes_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id AND f.field_path = 'rolling'
    ) THEN aw.rolling END AS rolling
  FROM application_windows aw
) visible
JOIN current_catalog_records cr
  ON cr.release_id = visible.release_id AND cr.record_id = visible.application_window_id
JOIN current_application_routes ar
  ON ar.release_id = visible.release_id AND ar.application_route_id = visible.application_route_id;

DROP VIEW IF EXISTS current_fee_items;
CREATE VIEW current_fee_items AS
SELECT
  f.release_id,
  f.fee_id,
  f.owner_record_id,
  f.fee_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields rf
    WHERE rf.release_id = f.release_id AND rf.record_id = f.fee_id AND rf.field_path = 'amount_min_minor'
  ) THEN f.amount_min_minor END AS amount_min_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields rf
    WHERE rf.release_id = f.release_id AND rf.record_id = f.fee_id AND rf.field_path = 'amount_max_minor'
  ) THEN f.amount_max_minor END AS amount_max_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields rf
    WHERE rf.release_id = f.release_id AND rf.record_id = f.fee_id AND rf.field_path = 'currency_code'
  ) THEN f.currency_code END AS currency_code,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields rf
    WHERE rf.release_id = f.release_id AND rf.record_id = f.fee_id AND rf.field_path = 'currency_exponent'
  ) THEN f.currency_exponent END AS currency_exponent,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields rf
    WHERE rf.release_id = f.release_id AND rf.record_id = f.fee_id AND rf.field_path = 'billing_period'
  ) THEN f.billing_period END AS billing_period,
  f.mandatory,
  f.value_status
FROM fee_items f
JOIN current_catalog_records cr
  ON cr.release_id = f.release_id AND cr.record_id = f.fee_id
WHERE f.value_status IN ('confirmed', 'reference');

DROP VIEW IF EXISTS current_requirements;
CREATE VIEW current_requirements AS
SELECT
  req.release_id,
  req.requirement_id,
  req.owner_record_id,
  req.requirement_type,
  req.comparator,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = req.release_id AND f.record_id = req.requirement_id AND f.field_path = 'value_json'
  ) THEN req.value_json END AS value_json,
  req.required,
  req.applies_to_json,
  req.sort_order
FROM requirements req
JOIN current_catalog_records cr
  ON cr.release_id = req.release_id AND cr.record_id = req.requirement_id;

DROP VIEW IF EXISTS current_required_documents;
CREATE VIEW current_required_documents AS
SELECT doc.*
FROM required_documents doc
JOIN current_catalog_records cr
  ON cr.release_id = doc.release_id AND cr.record_id = doc.required_document_id;

DROP VIEW IF EXISTS current_scholarships;
CREATE VIEW current_scholarships AS
SELECT s.*
FROM scholarships s
JOIN current_catalog_records cr
  ON cr.release_id = s.release_id AND cr.record_id = s.scholarship_id
JOIN current_organizations provider
  ON provider.release_id = s.release_id
 AND provider.organization_id = s.provider_organization_id;

DROP VIEW IF EXISTS current_scholarship_cycles;
CREATE VIEW current_scholarship_cycles AS
SELECT
  sc.release_id,
  sc.scholarship_cycle_id,
  sc.scholarship_id,
  sc.academic_year,
  sc.intake_code,
  sc.sequence,
  sc.cycle_status,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = sc.release_id AND f.record_id = sc.scholarship_cycle_id AND f.field_path = 'institution_scope'
  ) THEN sc.institution_scope END AS institution_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = sc.release_id AND f.record_id = sc.scholarship_cycle_id AND f.field_path = 'program_scope'
  ) THEN sc.program_scope END AS program_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = sc.release_id AND f.record_id = sc.scholarship_cycle_id AND f.field_path = 'degree_scope'
  ) THEN sc.degree_scope END AS degree_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = sc.release_id AND f.record_id = sc.scholarship_cycle_id AND f.field_path = 'nationality_scope'
  ) THEN sc.nationality_scope END AS nationality_scope
FROM scholarship_cycles sc
JOIN current_catalog_records cr
  ON cr.release_id = sc.release_id AND cr.record_id = sc.scholarship_cycle_id
JOIN current_scholarships s
  ON s.release_id = sc.release_id AND s.scholarship_id = sc.scholarship_id
WHERE sc.cycle_status = 'announced';

DROP VIEW IF EXISTS current_scholarship_coverage;
CREATE VIEW current_scholarship_coverage AS
SELECT
  coverage.release_id,
  coverage.coverage_id,
  coverage.scholarship_cycle_id,
  coverage.coverage_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'coverage_mode'
  ) THEN coverage.coverage_mode END AS coverage_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'amount_min_minor'
  ) THEN coverage.amount_min_minor END AS amount_min_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'amount_max_minor'
  ) THEN coverage.amount_max_minor END AS amount_max_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'currency_code'
  ) THEN coverage.currency_code END AS currency_code,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'currency_exponent'
  ) THEN coverage.currency_exponent END AS currency_exponent,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'period'
  ) THEN coverage.period END AS period,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'max_duration'
  ) THEN coverage.max_duration END AS max_duration,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = coverage.release_id AND f.record_id = coverage.coverage_id AND f.field_path = 'max_duration_unit'
  ) THEN coverage.max_duration_unit END AS max_duration_unit
FROM scholarship_coverage_items coverage
JOIN current_catalog_records cr
  ON cr.release_id = coverage.release_id AND cr.record_id = coverage.coverage_id
JOIN current_scholarship_cycles sc
  ON sc.release_id = coverage.release_id
 AND sc.scholarship_cycle_id = coverage.scholarship_cycle_id;

DROP VIEW IF EXISTS current_source_summaries;
CREATE VIEW current_source_summaries AS
SELECT s.*
FROM source_summaries s
JOIN current_release rel ON rel.release_id = s.release_id;

DROP VIEW IF EXISTS current_record_sources;
CREATE VIEW current_record_sources AS
SELECT rs.*
FROM record_sources rs
JOIN current_catalog_records cr
  ON cr.release_id = rs.release_id AND cr.record_id = rs.record_id
JOIN current_source_summaries source
  ON source.release_id = rs.release_id AND source.source_id = rs.source_id;

DROP VIEW IF EXISTS current_search_documents;
CREATE VIEW current_search_documents AS
SELECT sd.*
FROM search_documents sd
JOIN current_catalog_records cr
  ON cr.release_id = sd.release_id AND cr.record_id = sd.record_id;

CREATE INDEX IF NOT EXISTS idx_search_documents_release_locale_kind
  ON search_documents(release_id, locale, record_kind);
CREATE INDEX IF NOT EXISTS idx_search_documents_release_record
  ON search_documents(release_id, record_id);

PRAGMA optimize;
