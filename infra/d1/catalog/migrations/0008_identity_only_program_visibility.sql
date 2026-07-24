PRAGMA foreign_keys = ON;

-- A verified program identity remains discoverable while the university has
-- not announced a current admission cycle. Announced cycles still obey the
-- deadline-plus-30-days projection from migration 0007. Non-degree mobility
-- and short-term opportunities remain fail-closed without a currently visible
-- public-individual application route.
DROP VIEW IF EXISTS current_programs;
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
WHERE (
    EXISTS (
      SELECT 1
      FROM public_program_cycle_ids AS visible_cycle
      WHERE visible_cycle.release_id = program.release_id
        AND visible_cycle.program_id = program.program_id
    )
    OR NOT EXISTS (
      SELECT 1
      FROM program_cycles AS announced_cycle
      WHERE announced_cycle.release_id = program.release_id
        AND announced_cycle.program_id = program.program_id
        AND announced_cycle.cycle_status = 'announced'
    )
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

PRAGMA optimize;
