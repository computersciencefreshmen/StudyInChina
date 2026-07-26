-- Idempotent, cache-first machine translation workflow for stable localized text.
--
-- `localized_content` remains the canonical projection:
--   * official/original text keeps translation_status reviewed/published;
--   * generated text is written as legacy status `machine` with source_locale.
-- The more explicit `machine_generated` status lives in translation_targets and
-- translation_cache so machine output can never be confused with reviewed text.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS translation_runs (
  id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL CHECK (requested_by IN ('schedule', 'api', 'cli')),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  status TEXT NOT NULL CHECK (status IN (
    'planning', 'queued', 'dry_run', 'completed', 'deferred', 'failed'
  )),
  planned_jobs INTEGER NOT NULL DEFAULT 0 CHECK (planned_jobs >= 0),
  cache_hits INTEGER NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  skipped_current INTEGER NOT NULL DEFAULT 0 CHECK (skipped_current >= 0),
  error_code TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
  source_locale TEXT NOT NULL CHECK (length(source_locale) BETWEEN 2 AND 15),
  target_locale TEXT NOT NULL CHECK (target_locale IN (
    'zh', 'en', 'ru', 'de', 'es', 'fr', 'ar', 'pt'
  )),
  institution_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'completed', 'partial', 'deferred', 'failed'
  )),
  job_count INTEGER NOT NULL CHECK (job_count BETWEEN 1 AND 50),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_locale <> target_locale),
  CHECK (completed_count + failed_count <= job_count)
);

CREATE TABLE IF NOT EXISTS translation_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES translation_batches(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL,
  institution_id TEXT,
  field_name TEXT NOT NULL,
  source_locale TEXT NOT NULL CHECK (length(source_locale) BETWEEN 2 AND 15),
  target_locale TEXT NOT NULL CHECK (target_locale IN (
    'zh', 'en', 'ru', 'de', 'es', 'fr', 'ar', 'pt'
  )),
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  cache_key TEXT NOT NULL CHECK (
    length(cache_key) = 64 AND cache_key NOT GLOB '*[^0-9a-f]*'
  ),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'cached', 'succeeded', 'deferred',
    'failed', 'stale', 'cancelled'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (source_locale <> target_locale),
  UNIQUE (
    record_id, field_name, source_locale, target_locale,
    source_sha256, model, prompt_version
  )
);

CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key TEXT PRIMARY KEY CHECK (
    length(cache_key) = 64 AND cache_key NOT GLOB '*[^0-9a-f]*'
  ),
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_locale TEXT NOT NULL CHECK (length(source_locale) BETWEEN 2 AND 15),
  target_locale TEXT NOT NULL CHECK (target_locale IN (
    'zh', 'en', 'ru', 'de', 'es', 'fr', 'ar', 'pt'
  )),
  record_kind TEXT NOT NULL,
  field_name TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  translated_text TEXT NOT NULL CHECK (length(trim(translated_text)) > 0),
  translated_sha256 TEXT NOT NULL CHECK (
    length(translated_sha256) = 64 AND translated_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  translation_status TEXT NOT NULL DEFAULT 'machine_generated'
    CHECK (translation_status = 'machine_generated'),
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  CHECK (source_locale <> target_locale),
  UNIQUE (
    source_sha256, source_locale, target_locale,
    record_kind, field_name, model, prompt_version
  )
);

CREATE TABLE IF NOT EXISTS translation_targets (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  target_locale TEXT NOT NULL CHECK (target_locale IN (
    'zh', 'en', 'ru', 'de', 'es', 'fr', 'ar', 'pt'
  )),
  source_locale TEXT NOT NULL CHECK (length(source_locale) BETWEEN 2 AND 15),
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  cache_key TEXT NOT NULL REFERENCES translation_cache(cache_key) ON DELETE RESTRICT,
  translated_sha256 TEXT NOT NULL CHECK (
    length(translated_sha256) = 64 AND translated_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  translation_status TEXT NOT NULL DEFAULT 'machine_generated'
    CHECK (translation_status = 'machine_generated'),
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (record_id, field_name, target_locale),
  CHECK (source_locale <> target_locale)
);

CREATE TABLE IF NOT EXISTS translation_monthly_usage (
  month_key TEXT PRIMARY KEY CHECK (
    length(month_key) = 7
    AND month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
  ),
  api_calls INTEGER NOT NULL DEFAULT 0 CHECK (api_calls >= 0),
  input_characters INTEGER NOT NULL DEFAULT 0 CHECK (input_characters >= 0),
  output_characters INTEGER NOT NULL DEFAULT 0 CHECK (output_characters >= 0),
  translated_items INTEGER NOT NULL DEFAULT 0 CHECK (translated_items >= 0),
  cache_hits INTEGER NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_dispatch
  ON translation_jobs(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_scope
  ON translation_jobs(institution_id, target_locale, status);

CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup
  ON translation_cache(
    source_sha256, source_locale, target_locale,
    record_kind, field_name, model, prompt_version
  );

CREATE INDEX IF NOT EXISTS idx_translation_targets_source
  ON translation_targets(record_id, field_name, source_sha256);

CREATE INDEX IF NOT EXISTS idx_translation_batches_run
  ON translation_batches(run_id, status, created_at);
