-- Deterministic value transforms for explicit, operator-owned field mappings.
--
-- Extractors keep money in the major unit printed by the official source
-- (for example CNY 30,000). The canonical fee model stores decimal minor
-- units. Keeping the conversion on the trusted mapping -- never in the model
-- prompt -- preserves verbatim evidence while preventing a 100x value error.
-- A companion table keeps this migration repeatable on both SQLite and D1;
-- SQLite has no portable ADD COLUMN IF NOT EXISTS form.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS promotion_field_mapping_transforms (
  source_id TEXT NOT NULL,
  candidate_field_path TEXT NOT NULL,
  value_transform TEXT NOT NULL DEFAULT 'identity' CHECK (
    value_transform IN ('identity', 'major_to_minor_2')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, candidate_field_path),
  FOREIGN KEY (source_id, candidate_field_path)
    REFERENCES promotion_field_mappings(source_id, candidate_field_path)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_promotion_mapping_transforms_value
  ON promotion_field_mapping_transforms(value_transform, source_id);

PRAGMA optimize;
