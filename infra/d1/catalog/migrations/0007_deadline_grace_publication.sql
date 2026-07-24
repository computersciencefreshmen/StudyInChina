PRAGMA foreign_keys = ON;

-- Application opportunities remain public through the deadline plus 30 days.
-- All calendar boundaries use China Standard Time. Historical rows remain in
-- release tables; only current public projections are filtered.
DROP VIEW IF EXISTS deadline_application_windows;
CREATE VIEW deadline_application_windows AS
SELECT
  window.release_id,
  route.owner_record_id,
  window.application_window_id,
  window.closes_on,
  window.rolling,
  EXISTS (
    SELECT 1
    FROM record_field_status AS fact
    WHERE fact.release_id = window.release_id
      AND fact.record_id = window.application_window_id
      AND fact.field_path = 'closes_on'
      AND fact.field_status = 'known'
      AND fact.review_after >= date('now', '+8 hours')
  ) AS closes_on_is_current,
  EXISTS (
    SELECT 1
    FROM record_field_status AS fact
    WHERE fact.release_id = window.release_id
      AND fact.record_id = window.application_window_id
      AND fact.field_path = 'rolling'
      AND fact.field_status = 'known'
      AND fact.review_after >= date('now', '+8 hours')
  ) AS rolling_is_current
FROM application_windows AS window
JOIN application_routes AS route
  ON route.release_id = window.release_id
 AND route.application_route_id = window.application_route_id
JOIN catalog_records AS window_record
  ON window_record.release_id = window.release_id
 AND window_record.record_id = window.application_window_id
JOIN catalog_records AS route_record
  ON route_record.release_id = route.release_id
 AND route_record.record_id = route.application_route_id
JOIN current_release AS release
  ON release.release_id = window.release_id
WHERE window_record.gate_status = 'publishable'
  AND route_record.gate_status = 'publishable'
  AND EXISTS (
    SELECT 1
    FROM record_sources AS binding
    JOIN source_summaries AS source
      ON source.release_id = binding.release_id
     AND source.source_id = binding.source_id
    WHERE binding.release_id = window.release_id
      AND binding.record_id = window.application_window_id
  );

DROP VIEW IF EXISTS deadline_program_cycles;
CREATE VIEW deadline_program_cycles AS
SELECT cycle.*
FROM program_cycles AS cycle
JOIN current_catalog_records AS record
  ON record.release_id = cycle.release_id
 AND record.record_id = cycle.program_cycle_id
WHERE cycle.cycle_status = 'announced';

DROP VIEW IF EXISTS deadline_scholarship_cycles;
CREATE VIEW deadline_scholarship_cycles AS
SELECT cycle.*
FROM scholarship_cycles AS cycle
JOIN current_catalog_records AS record
  ON record.release_id = cycle.release_id
 AND record.record_id = cycle.scholarship_cycle_id
WHERE cycle.cycle_status = 'announced';

DROP VIEW IF EXISTS public_program_cycle_ids;
CREATE VIEW public_program_cycle_ids AS
SELECT cycle.release_id, cycle.program_cycle_id, cycle.program_id
FROM deadline_program_cycles AS cycle
WHERE NOT EXISTS (
    SELECT 1
    FROM deadline_application_windows AS window
    WHERE window.release_id = cycle.release_id
      AND window.owner_record_id = cycle.program_cycle_id
  )
  OR EXISTS (
    SELECT 1
    FROM deadline_application_windows AS window
    WHERE window.release_id = cycle.release_id
      AND window.owner_record_id = cycle.program_cycle_id
      AND (
        (window.rolling_is_current = 1 AND window.rolling = 1)
        OR window.closes_on_is_current = 0
        OR window.closes_on >= date('now', '+8 hours', '-30 days')
      )
  );

DROP VIEW IF EXISTS public_scholarship_cycle_ids;
CREATE VIEW public_scholarship_cycle_ids AS
SELECT cycle.release_id, cycle.scholarship_cycle_id, cycle.scholarship_id
FROM deadline_scholarship_cycles AS cycle
WHERE NOT EXISTS (
    SELECT 1
    FROM deadline_application_windows AS window
    WHERE window.release_id = cycle.release_id
      AND window.owner_record_id = cycle.scholarship_cycle_id
  )
  OR EXISTS (
    SELECT 1
    FROM deadline_application_windows AS window
    WHERE window.release_id = cycle.release_id
      AND window.owner_record_id = cycle.scholarship_cycle_id
      AND (
        (window.rolling_is_current = 1 AND window.rolling = 1)
        OR window.closes_on_is_current = 0
        OR window.closes_on >= date('now', '+8 hours', '-30 days')
      )
  );

DROP VIEW IF EXISTS current_application_windows;
DROP VIEW IF EXISTS current_application_routes;
DROP VIEW IF EXISTS current_program_cycles;
DROP VIEW IF EXISTS current_scholarship_coverage;
DROP VIEW IF EXISTS current_scholarship_cycles;
DROP VIEW IF EXISTS current_programs;
DROP VIEW IF EXISTS current_scholarships;
DROP VIEW IF EXISTS current_search_documents;
DROP VIEW IF EXISTS current_record_field_statuses;
DROP VIEW IF EXISTS current_record_fields;

CREATE VIEW current_record_fields AS
SELECT status.*
FROM record_field_status AS status
JOIN current_catalog_records AS record
  ON record.release_id = status.release_id
 AND record.record_id = status.record_id
WHERE status.field_status = 'known'
  AND status.review_after >= date('now', '+8 hours');

CREATE VIEW current_record_field_statuses AS
SELECT
  status.release_id,
  status.record_id,
  status.field_path,
  status.locale,
  CASE
    WHEN status.field_status = 'known'
      AND status.review_after < date('now', '+8 hours') THEN 'stale'
    ELSE status.field_status
  END AS field_status,
  status.required_for_publish,
  CASE
    WHEN status.field_status = 'known'
      AND status.review_after >= date('now', '+8 hours') THEN status.value_json
    ELSE NULL
  END AS value_json,
  status.verified_at,
  status.review_after
FROM record_field_status AS status
JOIN current_catalog_records AS record
  ON record.release_id = status.release_id
 AND record.record_id = status.record_id;

CREATE VIEW current_programs AS
SELECT
  program.release_id,
  program.program_id,
  program.institution_id,
  program.academic_unit_id,
  program.parent_program_id,
  program.program_type,
  program.degree_level,
  program.credential_type,
  program.attendance_mode,
  program.delivery_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = program.release_id
      AND fact.record_id = program.program_id
      AND fact.field_path IN ('duration_min', 'durationMonths')
  ) THEN program.duration_min END AS duration_min,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = program.release_id
      AND fact.record_id = program.program_id
      AND fact.field_path IN ('duration_max', 'durationMonthsMax')
  ) THEN program.duration_max END AS duration_max,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = program.release_id
      AND fact.record_id = program.program_id
      AND fact.field_path = 'duration_unit'
  ) THEN program.duration_unit END AS duration_unit,
  program.official_url
FROM programs AS program
JOIN current_catalog_records AS record
  ON record.release_id = program.release_id
 AND record.record_id = program.program_id
JOIN current_institutions AS institution
  ON institution.release_id = program.release_id
 AND institution.institution_id = program.institution_id
WHERE EXISTS (
    SELECT 1
    FROM public_program_cycle_ids AS visible_cycle
    WHERE visible_cycle.release_id = program.release_id
      AND visible_cycle.program_id = program.program_id
  )
  AND (
    program.program_type NOT IN ('exchange', 'visiting', 'short_term')
    OR EXISTS (
      SELECT 1
      FROM public_program_cycle_ids AS visible_cycle
      JOIN application_routes AS route
        ON route.release_id = visible_cycle.release_id
       AND route.owner_record_id = visible_cycle.program_cycle_id
      JOIN current_catalog_records AS route_record
        ON route_record.release_id = route.release_id
       AND route_record.record_id = route.application_route_id
      JOIN current_record_fields AS access_fact
        ON access_fact.release_id = route.release_id
       AND access_fact.record_id = route.application_route_id
       AND access_fact.field_path = 'access_mode'
      WHERE visible_cycle.release_id = program.release_id
        AND visible_cycle.program_id = program.program_id
        AND route.access_mode IN ('public_individual', 'both')
    )
  );

CREATE VIEW current_program_cycles AS
SELECT
  cycle.release_id,
  cycle.program_cycle_id,
  cycle.program_id,
  cycle.academic_year,
  cycle.intake_code,
  cycle.sequence,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.program_cycle_id
      AND fact.field_path = 'starts_on'
  ) THEN cycle.starts_on END AS starts_on,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.program_cycle_id
      AND fact.field_path = 'ends_on'
  ) THEN cycle.ends_on END AS ends_on,
  cycle.cycle_status,
  cycle.official_url
FROM program_cycles AS cycle
JOIN public_program_cycle_ids AS visible_cycle
  ON visible_cycle.release_id = cycle.release_id
 AND visible_cycle.program_cycle_id = cycle.program_cycle_id
JOIN current_programs AS program
  ON program.release_id = cycle.release_id
 AND program.program_id = cycle.program_id;

CREATE VIEW current_scholarships AS
SELECT scholarship.*
FROM scholarships AS scholarship
JOIN current_catalog_records AS record
  ON record.release_id = scholarship.release_id
 AND record.record_id = scholarship.scholarship_id
JOIN current_organizations AS provider
  ON provider.release_id = scholarship.release_id
 AND provider.organization_id = scholarship.provider_organization_id
WHERE EXISTS (
    SELECT 1
    FROM public_scholarship_cycle_ids AS visible_cycle
    WHERE visible_cycle.release_id = scholarship.release_id
      AND visible_cycle.scholarship_id = scholarship.scholarship_id
  )
  OR (
    NOT EXISTS (
      SELECT 1
      FROM scholarship_cycles AS any_cycle
      WHERE any_cycle.release_id = scholarship.release_id
        AND any_cycle.scholarship_id = scholarship.scholarship_id
        AND any_cycle.cycle_status = 'announced'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM record_field_status AS deadline
      WHERE deadline.release_id = scholarship.release_id
        AND deadline.record_id = scholarship.scholarship_id
        AND deadline.field_path = 'deadline'
        AND deadline.field_status = 'known'
        AND deadline.review_after >= date('now', '+8 hours')
        AND date(json_extract(deadline.value_json, '$')) < date('now', '+8 hours', '-30 days')
    )
  );

CREATE VIEW current_scholarship_cycles AS
SELECT
  cycle.release_id,
  cycle.scholarship_cycle_id,
  cycle.scholarship_id,
  cycle.academic_year,
  cycle.intake_code,
  cycle.sequence,
  cycle.cycle_status,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.scholarship_cycle_id
      AND fact.field_path = 'institution_scope'
  ) THEN cycle.institution_scope END AS institution_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.scholarship_cycle_id
      AND fact.field_path = 'program_scope'
  ) THEN cycle.program_scope END AS program_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.scholarship_cycle_id
      AND fact.field_path = 'degree_scope'
  ) THEN cycle.degree_scope END AS degree_scope,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = cycle.release_id
      AND fact.record_id = cycle.scholarship_cycle_id
      AND fact.field_path = 'nationality_scope'
  ) THEN cycle.nationality_scope END AS nationality_scope
FROM scholarship_cycles AS cycle
JOIN public_scholarship_cycle_ids AS visible_cycle
  ON visible_cycle.release_id = cycle.release_id
 AND visible_cycle.scholarship_cycle_id = cycle.scholarship_cycle_id
JOIN current_scholarships AS scholarship
  ON scholarship.release_id = cycle.release_id
 AND scholarship.scholarship_id = cycle.scholarship_id;

CREATE VIEW current_scholarship_coverage AS
SELECT
  coverage.release_id,
  coverage.coverage_id,
  coverage.scholarship_cycle_id,
  coverage.coverage_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'coverage_mode'
  ) THEN coverage.coverage_mode END AS coverage_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'amount_min_minor'
  ) THEN coverage.amount_min_minor END AS amount_min_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'amount_max_minor'
  ) THEN coverage.amount_max_minor END AS amount_max_minor,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'currency_code'
  ) THEN coverage.currency_code END AS currency_code,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'currency_exponent'
  ) THEN coverage.currency_exponent END AS currency_exponent,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'period'
  ) THEN coverage.period END AS period,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'max_duration'
  ) THEN coverage.max_duration END AS max_duration,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = coverage.release_id
      AND fact.record_id = coverage.coverage_id
      AND fact.field_path = 'max_duration_unit'
  ) THEN coverage.max_duration_unit END AS max_duration_unit
FROM scholarship_coverage_items AS coverage
JOIN current_catalog_records AS record
  ON record.release_id = coverage.release_id
 AND record.record_id = coverage.coverage_id
JOIN current_scholarship_cycles AS cycle
  ON cycle.release_id = coverage.release_id
 AND cycle.scholarship_cycle_id = coverage.scholarship_cycle_id;

CREATE VIEW current_application_routes AS
SELECT
  route.release_id,
  route.application_route_id,
  route.owner_record_id,
  route.route_type,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = route.release_id
      AND fact.record_id = route.application_route_id
      AND fact.field_path = 'access_mode'
  ) THEN route.access_mode END AS access_mode,
  CASE WHEN EXISTS (
    SELECT 1 FROM current_record_fields AS fact
    WHERE fact.release_id = route.release_id
      AND fact.record_id = route.application_route_id
      AND fact.field_path = 'apply_url'
  ) THEN route.apply_url END AS apply_url,
  route.is_primary
FROM application_routes AS route
JOIN current_catalog_records AS record
  ON record.release_id = route.release_id
 AND record.record_id = route.application_route_id
WHERE EXISTS (
  SELECT 1 FROM current_program_cycles AS cycle
  WHERE cycle.release_id = route.release_id
    AND cycle.program_cycle_id = route.owner_record_id
)
OR EXISTS (
  SELECT 1 FROM current_scholarship_cycles AS cycle
  WHERE cycle.release_id = route.release_id
    AND cycle.scholarship_cycle_id = route.owner_record_id
);

CREATE VIEW current_application_windows AS
SELECT
  visible.*,
  CASE
    WHEN visible.rolling = 1 THEN 'rolling'
    WHEN visible.opens_on IS NULL AND visible.closes_on IS NULL THEN 'not_announced'
    WHEN visible.closes_on IS NOT NULL
      AND visible.closes_on < date('now', '+8 hours') THEN 'closed'
    WHEN visible.opens_on IS NOT NULL
      AND visible.opens_on > date('now', '+8 hours') THEN 'upcoming'
    ELSE 'open'
  END AS application_state
FROM (
  SELECT
    window.release_id,
    window.application_window_id,
    window.application_route_id,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields AS fact
      WHERE fact.release_id = window.release_id
        AND fact.record_id = window.application_window_id
        AND fact.field_path = 'round_label'
    ) THEN window.round_label END AS round_label,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields AS fact
      WHERE fact.release_id = window.release_id
        AND fact.record_id = window.application_window_id
        AND fact.field_path = 'opens_on'
    ) THEN window.opens_on END AS opens_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields AS fact
      WHERE fact.release_id = window.release_id
        AND fact.record_id = window.application_window_id
        AND fact.field_path = 'closes_on'
    ) THEN window.closes_on END AS closes_on,
    CASE WHEN EXISTS (
      SELECT 1 FROM current_record_fields AS fact
      WHERE fact.release_id = window.release_id
        AND fact.record_id = window.application_window_id
        AND fact.field_path = 'rolling'
    ) THEN window.rolling END AS rolling
  FROM application_windows AS window
) AS visible
JOIN current_catalog_records AS record
  ON record.release_id = visible.release_id
 AND record.record_id = visible.application_window_id
JOIN current_application_routes AS route
  ON route.release_id = visible.release_id
 AND route.application_route_id = visible.application_route_id;

CREATE VIEW current_search_documents AS
SELECT document.*
FROM search_documents AS document
JOIN current_catalog_records AS record
  ON record.release_id = document.release_id
 AND record.record_id = document.record_id
WHERE (document.record_kind NOT IN ('program', 'program_cycle', 'scholarship', 'scholarship_cycle'))
   OR (document.record_kind = 'program' AND EXISTS (
     SELECT 1 FROM current_programs AS program
     WHERE program.release_id = document.release_id
       AND program.program_id = document.record_id
   ))
   OR (document.record_kind = 'program_cycle' AND EXISTS (
     SELECT 1 FROM current_program_cycles AS cycle
     WHERE cycle.release_id = document.release_id
       AND cycle.program_cycle_id = document.record_id
   ))
   OR (document.record_kind = 'scholarship' AND EXISTS (
     SELECT 1 FROM current_scholarships AS scholarship
     WHERE scholarship.release_id = document.release_id
       AND scholarship.scholarship_id = document.record_id
   ))
   OR (document.record_kind = 'scholarship_cycle' AND EXISTS (
     SELECT 1 FROM current_scholarship_cycles AS cycle
     WHERE cycle.release_id = document.release_id
       AND cycle.scholarship_cycle_id = document.record_id
   ));

PRAGMA optimize;
