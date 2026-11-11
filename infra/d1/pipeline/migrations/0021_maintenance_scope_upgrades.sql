-- Append-only scope upgrade receipts. Existing requests, guards and exports are retained.
CREATE TABLE IF NOT EXISTS maintenance_scope_upgrades (
  upgrade_sha256 TEXT PRIMARY KEY, previous_scope_sha256 TEXT NOT NULL,
  next_scope_sha256 TEXT NOT NULL UNIQUE, expected_revision INTEGER NOT NULL,
  paused_revision INTEGER NOT NULL, input_catalog_sha256 TEXT NOT NULL,
  legacy_guard_sha256 TEXT NOT NULL, original_canary_json TEXT NOT NULL,
  original_enabled INTEGER NOT NULL CHECK(original_enabled IN(0,1)),
  original_models_enabled INTEGER NOT NULL CHECK(original_models_enabled IN(0,1)),
  plan_key TEXT NOT NULL, plan_sha256 TEXT NOT NULL, total_operations INTEGER NOT NULL,
  completed_operations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN('staged','completed')),
  receipt_key TEXT, receipt_sha256 TEXT, created_at TEXT NOT NULL
);
