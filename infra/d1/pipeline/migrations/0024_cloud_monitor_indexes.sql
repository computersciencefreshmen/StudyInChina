-- Read-only cloud monitoring uses bounded time ranges, never a whole ledger per refresh.
CREATE INDEX IF NOT EXISTS maintenance_model_attempt_started ON maintenance_model_attempts(started_at,model,status);
CREATE INDEX IF NOT EXISTS maintenance_job_updated ON maintenance_jobs(updated_at,job_id);
CREATE INDEX IF NOT EXISTS maintenance_event_kind_observed ON maintenance_events(kind,observed_at,event_id);
