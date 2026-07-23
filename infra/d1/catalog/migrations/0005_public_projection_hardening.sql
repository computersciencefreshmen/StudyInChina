-- Fail-closed public projections. Raw release tables remain private and are
-- never queried by the public Worker.

PRAGMA foreign_keys = ON;

DROP VIEW IF EXISTS current_localized_content;
CREATE VIEW current_localized_content AS
SELECT lc.*
FROM localized_content lc
JOIN current_catalog_records cr
  ON cr.release_id = lc.release_id AND cr.record_id = lc.record_id
WHERE lc.field_name = 'name'
   OR EXISTS (
     SELECT 1
     FROM current_record_fields f
     WHERE f.release_id = lc.release_id
       AND f.record_id = lc.record_id
       AND f.field_path IN (lc.field_name, 'localized.' || lc.field_name)
   );

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
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id
      AND f.field_path IN ('duration_min', 'durationMonths')
  ) THEN p.duration_min END AS duration_min,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id
      AND f.field_path IN ('duration_max', 'durationMonthsMax')
  ) THEN p.duration_max END AS duration_max,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = p.release_id AND f.record_id = p.program_id
      AND f.field_path = 'duration_unit'
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
     JOIN current_record_fields access_field
       ON access_field.release_id = ar.release_id
      AND access_field.record_id = ar.application_route_id
      AND access_field.field_path = 'access_mode'
     WHERE pc.release_id = p.release_id
       AND pc.program_id = p.program_id
       AND pc.cycle_status = 'announced'
       AND ar.access_mode IN ('public_individual', 'both')
   );

DROP VIEW IF EXISTS current_program_disciplines;
CREATE VIEW current_program_disciplines AS
SELECT pd.*
FROM program_disciplines pd
JOIN current_programs p
  ON p.release_id = pd.release_id AND p.program_id = pd.program_id
WHERE EXISTS (
  SELECT 1 FROM current_record_fields f
  WHERE f.release_id = pd.release_id
    AND f.record_id = pd.program_id
    AND f.field_path IN ('discipline', 'disciplines')
);

DROP VIEW IF EXISTS current_program_teaching_languages;
CREATE VIEW current_program_teaching_languages AS
SELECT ptl.*
FROM program_teaching_languages ptl
JOIN current_programs p
  ON p.release_id = ptl.release_id AND p.program_id = ptl.program_id
WHERE EXISTS (
  SELECT 1 FROM current_record_fields f
  WHERE f.release_id = ptl.release_id
    AND f.record_id = ptl.program_id
    AND f.field_path IN ('teachingLanguages', 'teaching_languages')
);

DROP VIEW IF EXISTS current_application_routes;
CREATE VIEW current_application_routes AS
SELECT
  ar.release_id,
  ar.application_route_id,
  ar.owner_record_id,
  ar.route_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = ar.release_id
      AND f.record_id = ar.application_route_id
      AND f.field_path = 'access_mode'
  ) THEN ar.access_mode END AS access_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = ar.release_id
      AND f.record_id = ar.application_route_id
      AND f.field_path = 'apply_url'
  ) THEN ar.apply_url END AS apply_url,
  ar.is_primary
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
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id
        AND f.field_path = 'round_label'
    ) THEN aw.round_label END AS round_label,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id
        AND f.field_path = 'opens_on'
    ) THEN aw.opens_on END AS opens_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id
        AND f.field_path = 'closes_on'
    ) THEN aw.closes_on END AS closes_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields f
      WHERE f.release_id = aw.release_id AND f.record_id = aw.application_window_id
        AND f.field_path = 'rolling'
    ) THEN aw.rolling END AS rolling
  FROM application_windows aw
) visible
JOIN current_catalog_records cr
  ON cr.release_id = visible.release_id AND cr.record_id = visible.application_window_id
JOIN current_application_routes ar
  ON ar.release_id = visible.release_id AND ar.application_route_id = visible.application_route_id;

DROP VIEW IF EXISTS current_requirements;
CREATE VIEW current_requirements AS
SELECT
  req.release_id,
  req.requirement_id,
  req.owner_record_id,
  req.requirement_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = req.release_id AND f.record_id = req.requirement_id
      AND f.field_path = 'comparator'
  ) THEN req.comparator END AS comparator,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = req.release_id AND f.record_id = req.requirement_id
      AND f.field_path = 'value_json'
  ) THEN req.value_json END AS value_json,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = req.release_id AND f.record_id = req.requirement_id
      AND f.field_path = 'required'
  ) THEN req.required END AS required,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = req.release_id AND f.record_id = req.requirement_id
      AND f.field_path = 'applies_to_json'
  ) THEN req.applies_to_json END AS applies_to_json,
  req.sort_order
FROM requirements req
JOIN current_catalog_records cr
  ON cr.release_id = req.release_id AND cr.record_id = req.requirement_id;

DROP VIEW IF EXISTS current_required_documents;
CREATE VIEW current_required_documents AS
SELECT
  doc.release_id,
  doc.required_document_id,
  doc.owner_record_id,
  doc.document_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = doc.release_id AND f.record_id = doc.required_document_id
      AND f.field_path = 'required'
  ) THEN doc.required END AS required,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = doc.release_id AND f.record_id = doc.required_document_id
      AND f.field_path = 'copies'
  ) THEN doc.copies END AS copies,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = doc.release_id AND f.record_id = doc.required_document_id
      AND f.field_path = 'notarization_required'
  ) THEN doc.notarization_required END AS notarization_required,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields f
    WHERE f.release_id = doc.release_id AND f.record_id = doc.required_document_id
      AND f.field_path = 'translation_required'
  ) THEN doc.translation_required END AS translation_required
FROM required_documents doc
JOIN current_catalog_records cr
  ON cr.release_id = doc.release_id AND cr.record_id = doc.required_document_id;

-- Search only immutable identity titles until a field-aware indexer writes a
-- separately gated public token projection. This prevents a stale body/filter
-- value from leaking merely because an FTS query matched it.
DROP TRIGGER IF EXISTS trg_search_documents_insert;
DROP TRIGGER IF EXISTS trg_search_documents_delete;
DROP TRIGGER IF EXISTS trg_search_documents_update;

UPDATE search_documents SET body = '', filter_text = '';

CREATE TRIGGER trg_search_documents_insert
AFTER INSERT ON search_documents
BEGIN
  INSERT INTO search_fts(rowid, title, body, filter_text)
  VALUES (NEW.search_rowid, NEW.title, '', '');
END;

CREATE TRIGGER trg_search_documents_delete
AFTER DELETE ON search_documents
BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, filter_text)
  VALUES ('delete', OLD.search_rowid, OLD.title, '', '');
END;

CREATE TRIGGER trg_search_documents_update
AFTER UPDATE ON search_documents
BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, filter_text)
  VALUES ('delete', OLD.search_rowid, OLD.title, '', '');
  INSERT INTO search_fts(rowid, title, body, filter_text)
  VALUES (NEW.search_rowid, NEW.title, '', '');
END;

INSERT INTO search_fts(search_fts) VALUES ('rebuild');

DROP VIEW IF EXISTS current_search_documents;
CREATE VIEW current_search_documents AS
SELECT
  sd.search_rowid,
  sd.release_id,
  sd.record_id,
  sd.locale,
  sd.record_kind,
  sd.title,
  '' AS body,
  '' AS filter_text
FROM search_documents sd
JOIN current_catalog_records cr
  ON cr.release_id = sd.release_id AND cr.record_id = sd.record_id;

PRAGMA optimize;
