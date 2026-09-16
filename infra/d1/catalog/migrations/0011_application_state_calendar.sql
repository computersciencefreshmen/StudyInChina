PRAGMA foreign_keys = ON;

-- A rolling flag never overrides an explicit opening or closing boundary.
-- A deadline alone proves that dates are published, not that applications opened.
-- Match the frontend's inclusive China-calendar admission state rules.
DROP VIEW IF EXISTS current_application_windows;
CREATE VIEW current_application_windows AS
SELECT
  visible.*,
  CASE
    WHEN visible.closes_on IS NOT NULL
      AND visible.closes_on < date('now', '+8 hours') THEN 'closed'
    WHEN visible.opens_on IS NOT NULL
      AND visible.opens_on > date('now', '+8 hours') THEN 'upcoming'
    WHEN visible.rolling = 1 THEN 'rolling'
    WHEN visible.opens_on IS NOT NULL THEN 'open'
    WHEN visible.closes_on IS NOT NULL THEN 'dates-published'
    ELSE 'not_announced'
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
