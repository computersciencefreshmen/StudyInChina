-- Query-path indexes and remaining fail-closed guards for the pipeline database.

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_records_kind_status_review
  ON records(kind, workflow_status, review_after);
CREATE INDEX IF NOT EXISTS idx_records_updated_at
  ON records(updated_at);
CREATE INDEX IF NOT EXISTS idx_localized_content_locale_record
  ON localized_content(locale, record_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent_type
  ON locations(parent_location_id, location_type);
CREATE INDEX IF NOT EXISTS idx_institutions_city
  ON institutions(city_id);
CREATE INDEX IF NOT EXISTS idx_campuses_institution
  ON campuses(institution_id);
CREATE INDEX IF NOT EXISTS idx_academic_units_institution_parent
  ON academic_units(institution_id, parent_unit_id);
CREATE INDEX IF NOT EXISTS idx_programs_institution_type_degree
  ON programs(institution_id, program_type, degree_level);
CREATE INDEX IF NOT EXISTS idx_programs_academic_unit
  ON programs(academic_unit_id);
CREATE INDEX IF NOT EXISTS idx_program_cycles_program_year_intake
  ON program_cycles(program_id, academic_year, intake_code);
CREATE INDEX IF NOT EXISTS idx_program_cycles_status
  ON program_cycles(cycle_status, academic_year);
CREATE INDEX IF NOT EXISTS idx_application_routes_owner_access
  ON application_routes(owner_record_id, access_mode);
CREATE INDEX IF NOT EXISTS idx_application_windows_route_dates
  ON application_windows(application_route_id, opens_on, closes_on);
CREATE INDEX IF NOT EXISTS idx_fee_items_owner_type
  ON fee_items(owner_record_id, fee_type);
CREATE INDEX IF NOT EXISTS idx_requirements_owner_type
  ON requirements(owner_record_id, requirement_type);
CREATE INDEX IF NOT EXISTS idx_required_documents_owner_type
  ON required_documents(owner_record_id, document_type);
CREATE INDEX IF NOT EXISTS idx_scholarships_provider_type
  ON scholarships(provider_organization_id, scheme_type);
CREATE INDEX IF NOT EXISTS idx_scholarship_cycles_scheme_year
  ON scholarship_cycles(scholarship_id, academic_year, intake_code);
CREATE INDEX IF NOT EXISTS idx_scholarship_cycles_status
  ON scholarship_cycles(cycle_status, academic_year);
CREATE INDEX IF NOT EXISTS idx_scholarship_coverage_cycle_type
  ON scholarship_coverage_items(scholarship_cycle_id, coverage_type);

CREATE INDEX IF NOT EXISTS idx_source_documents_active_authority
  ON source_documents(active, authority_level, source_kind);
CREATE INDEX IF NOT EXISTS idx_source_documents_publisher
  ON source_documents(publisher_organization_id);
CREATE INDEX IF NOT EXISTS idx_source_fetches_source_requested
  ON source_fetches(source_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_fetches_status_requested
  ON source_fetches(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_source_fragments_fetch
  ON source_fragments(fetch_id);
CREATE INDEX IF NOT EXISTS idx_claims_subject_field_status
  ON claims(subject_record_id, field_path, locale, claim_status);
CREATE INDEX IF NOT EXISTS idx_claims_status_discovered
  ON claims(claim_status, discovered_at);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_fragment
  ON claim_evidence(fragment_id);
CREATE INDEX IF NOT EXISTS idx_canonical_fields_status_review
  ON canonical_fields(field_status, review_after);
CREATE INDEX IF NOT EXISTS idx_record_versions_record_changed
  ON record_versions(record_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_crawl_targets_due
  ON crawl_targets(next_run_at, priority)
  WHERE enabled = 1 AND lease_owner IS NULL;
CREATE INDEX IF NOT EXISTS idx_crawl_targets_lease
  ON crawl_targets(lease_expires_at)
  WHERE lease_owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_target_created
  ON ingestion_runs(crawl_target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status
  ON ingestion_runs(run_status, created_at);
CREATE INDEX IF NOT EXISTS idx_change_sets_status_risk
  ON change_sets(change_status, max_risk, created_at);
CREATE INDEX IF NOT EXISTS idx_change_sets_subject
  ON change_sets(subject_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_open
  ON anomalies(severity, created_at)
  WHERE anomaly_status = 'open';
CREATE INDEX IF NOT EXISTS idx_anomalies_change_set
  ON anomalies(change_set_id, anomaly_status);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_status
  ON publication_jobs(job_status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_events(available_at, created_at)
  WHERE event_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_outbox_lease
  ON outbox_events(lease_expires_at)
  WHERE event_status = 'processing';
CREATE INDEX IF NOT EXISTS idx_audit_log_subject
  ON audit_log(subject_type, subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation
  ON audit_log(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_claim_insert_accepted_requires_official_evidence
BEFORE INSERT ON claims
WHEN NEW.claim_status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'claims must be inserted as candidates and accepted after evidence is attached');
END;

CREATE TRIGGER IF NOT EXISTS trg_claim_status_transition
BEFORE UPDATE OF claim_status ON claims
WHEN NOT (
  NEW.claim_status = OLD.claim_status
  OR (OLD.claim_status = 'candidate' AND NEW.claim_status IN (
    'validated', 'rejected', 'quarantined', 'superseded'
  ))
  OR (OLD.claim_status = 'validated' AND NEW.claim_status IN (
    'accepted', 'rejected', 'quarantined', 'superseded'
  ))
  OR (OLD.claim_status IN ('accepted', 'rejected', 'quarantined')
      AND NEW.claim_status = 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid claim status transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_fee_owner_update
BEFORE UPDATE OF owner_record_id ON fee_items
WHEN NOT EXISTS (
  SELECT 1 FROM records
  WHERE id = NEW.owner_record_id AND kind IN ('program_cycle', 'application_route', 'scholarship_cycle')
)
BEGIN
  SELECT RAISE(ABORT, 'fee owner has an unsupported kind');
END;

-- A blocker can only be resolved with an actor and resolution time.
CREATE TRIGGER IF NOT EXISTS trg_blocker_resolution_audit
BEFORE UPDATE OF anomaly_status ON anomalies
WHEN OLD.severity = 'blocker'
  AND NEW.anomaly_status = 'resolved'
  AND (NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL OR length(trim(NEW.resolved_by)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'resolving a blocker requires resolved_at and resolved_by');
END;

PRAGMA optimize;
