-- Fixed additive indexes for automatic source enrollment and ownership guards.
-- Keep expressions identical to the production predicates; no trust rule changes.
CREATE INDEX IF NOT EXISTS idx_ingestion_sources_url_owner
  ON ingestion_sources (
    json_extract(manifest_json, '$.officialUrl'),
    json_extract(manifest_json, '$.institutionId'),
    enabled, source_id
  );

CREATE INDEX IF NOT EXISTS idx_ingestion_sources_school_source
  ON ingestion_sources (json_extract(manifest_json, '$.institutionId'), source_id);

CREATE INDEX IF NOT EXISTS idx_source_discoveries_pending_due
  ON source_discoveries (
    discovery_status, source_role, julianday(updated_at), institution_id, discovery_id
  )
  WHERE registered_source_id IS NULL;
