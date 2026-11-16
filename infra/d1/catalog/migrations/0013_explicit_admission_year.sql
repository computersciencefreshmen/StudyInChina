-- Preserve a source-declared single admission year without manufacturing an
-- academic-year range. Existing consecutive ranges remain byte-for-byte intact.
-- D1 applies migrations atomically. Keep foreign keys enabled: no table has a
-- foreign key to program_cycles; cycle children reference catalog_records.
-- legacy_alter_table preserves existing view/trigger SQL while the replacement
-- takes the original table name. Both pragmas are supported by D1.
PRAGMA foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

CREATE TABLE IF NOT EXISTS program_cycles_admission_year_v2 (
  release_id TEXT NOT NULL,
  program_cycle_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  academic_year TEXT NOT NULL CHECK (
    (length(academic_year) = 4
      AND academic_year GLOB '[0-9][0-9][0-9][0-9]')
    OR
    (length(academic_year) = 9
      AND academic_year GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'
      AND CAST(substr(academic_year, 6, 4) AS INTEGER)
        = CAST(substr(academic_year, 1, 4) AS INTEGER) + 1)
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

INSERT INTO program_cycles_admission_year_v2 (
  release_id, program_cycle_id, program_id, academic_year, intake_code,
  sequence, starts_on, ends_on, cycle_status, official_url
)
SELECT
  release_id, program_cycle_id, program_id, academic_year, intake_code,
  sequence, starts_on, ends_on, cycle_status, official_url
FROM program_cycles;

DROP TABLE program_cycles;
ALTER TABLE program_cycles_admission_year_v2 RENAME TO program_cycles;

CREATE INDEX IF NOT EXISTS idx_program_cycles_program_year_intake
  ON program_cycles(release_id, program_id, academic_year, intake_code);
CREATE INDEX IF NOT EXISTS idx_program_cycles_status
  ON program_cycles(release_id, cycle_status, academic_year);

PRAGMA legacy_alter_table = OFF;
