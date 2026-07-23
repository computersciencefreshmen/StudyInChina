PRAGMA foreign_keys = ON;

-- Public metadata needs every explicit status, while value-bearing projections
-- continue to read only current `known` facts from current_record_fields.
DROP VIEW IF EXISTS current_record_field_statuses;

-- A public identity without any registered official source cannot satisfy the
-- API's mandatory official entry link and is therefore withheld as a record.
DROP VIEW IF EXISTS current_catalog_records;
CREATE VIEW current_catalog_records AS
SELECT record.*
FROM catalog_records AS record
JOIN current_release AS release
  ON release.release_id = record.release_id
WHERE record.gate_status = 'publishable'
  AND EXISTS (
    SELECT 1
    FROM record_sources AS binding
    JOIN source_summaries AS source
      ON source.release_id = binding.release_id
     AND source.source_id = binding.source_id
    WHERE binding.release_id = record.release_id
      AND binding.record_id = record.record_id
  );

CREATE VIEW current_record_field_statuses AS
SELECT
  status.release_id,
  status.record_id,
  status.field_path,
  status.locale,
  CASE
    WHEN status.field_status = 'known' AND status.review_after < date('now') THEN 'stale'
    ELSE status.field_status
  END AS field_status,
  status.required_for_publish,
  CASE
    WHEN status.field_status = 'known' AND status.review_after >= date('now')
      THEN status.value_json
    ELSE NULL
  END AS value_json,
  status.verified_at,
  status.review_after
FROM record_field_status AS status
JOIN current_catalog_records AS record
  ON record.release_id = status.release_id
 AND record.record_id = status.record_id;
