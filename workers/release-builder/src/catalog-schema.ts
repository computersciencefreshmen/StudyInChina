import type { ReleaseTableName } from './types'

export const CATALOG_COLUMNS: Record<ReleaseTableName, readonly string[]> = {
  catalog_records: [
    'release_id', 'record_id', 'record_kind', 'slug', 'gate_status',
    'verified_at', 'review_after', 'content_sha256',
  ],
  record_field_status: [
    'release_id', 'record_id', 'field_path', 'locale', 'field_status',
    'required_for_publish', 'value_json', 'verified_at', 'review_after',
  ],
  source_summaries: [
    'release_id', 'source_id', 'url', 'title', 'publisher', 'source_kind',
    'language_code', 'authority_level', 'checked_at',
  ],
  record_sources: [
    'release_id', 'record_id', 'field_path', 'locale', 'source_id', 'evidence_role',
  ],
  localized_content: [
    'release_id', 'record_id', 'locale', 'field_name', 'text_value',
    'translation_status', 'source_locale',
  ],
  locations: [
    'release_id', 'location_id', 'parent_location_id', 'location_type',
    'country_code', 'region_code', 'latitude', 'longitude',
  ],
  organizations: ['release_id', 'organization_id', 'organization_type', 'official_url'],
  institutions: [
    'release_id', 'institution_id', 'city_id', 'institution_type',
    'admissions_url', 'featured',
  ],
  campuses: ['release_id', 'campus_id', 'institution_id', 'city_id', 'official_url'],
  academic_units: [
    'release_id', 'academic_unit_id', 'institution_id', 'parent_unit_id', 'official_url',
  ],
  programs: [
    'release_id', 'program_id', 'institution_id', 'academic_unit_id',
    'parent_program_id', 'program_type', 'degree_level', 'credential_type',
    'attendance_mode', 'delivery_mode', 'duration_min', 'duration_max',
    'duration_unit', 'official_url',
  ],
  disciplines: ['release_id', 'code', 'parent_code', 'name_en', 'name_zh'],
  program_disciplines: [
    'release_id', 'program_id', 'discipline_code', 'is_primary',
  ],
  languages: ['release_id', 'code', 'name_en', 'name_zh'],
  program_teaching_languages: [
    'release_id', 'program_id', 'language_code', 'role',
  ],
  program_cycles: [
    'release_id', 'program_cycle_id', 'program_id', 'academic_year', 'intake_code',
    'sequence', 'starts_on', 'ends_on', 'cycle_status', 'official_url',
  ],
  application_routes: [
    'release_id', 'application_route_id', 'owner_record_id', 'route_type',
    'access_mode', 'apply_url', 'is_primary',
  ],
  application_windows: [
    'release_id', 'application_window_id', 'application_route_id', 'round_label',
    'opens_on', 'closes_on', 'rolling',
  ],
  fee_items: [
    'release_id', 'fee_id', 'owner_record_id', 'fee_type', 'amount_min_minor',
    'amount_max_minor', 'currency_code', 'currency_exponent', 'billing_period',
    'mandatory', 'value_status',
  ],
  requirements: [
    'release_id', 'requirement_id', 'owner_record_id', 'requirement_type',
    'comparator', 'value_json', 'required', 'applies_to_json', 'sort_order',
  ],
  required_documents: [
    'release_id', 'required_document_id', 'owner_record_id', 'document_type',
    'required', 'copies', 'notarization_required', 'translation_required',
  ],
  scholarships: [
    'release_id', 'scholarship_id', 'provider_organization_id', 'scheme_type',
    'official_url',
  ],
  scholarship_cycles: [
    'release_id', 'scholarship_cycle_id', 'scholarship_id', 'academic_year',
    'intake_code', 'sequence', 'cycle_status', 'institution_scope', 'program_scope',
    'degree_scope', 'nationality_scope',
  ],
  scholarship_coverage_items: [
    'release_id', 'coverage_id', 'scholarship_cycle_id', 'coverage_type',
    'coverage_mode', 'amount_min_minor', 'amount_max_minor', 'currency_code',
    'currency_exponent', 'period', 'max_duration', 'max_duration_unit',
  ],
  scholarship_cycle_institutions: [
    'release_id', 'scholarship_cycle_id', 'institution_id', 'inclusion',
  ],
  scholarship_cycle_programs: [
    'release_id', 'scholarship_cycle_id', 'program_id', 'inclusion',
  ],
  scholarship_cycle_degree_levels: [
    'release_id', 'scholarship_cycle_id', 'degree_level', 'inclusion',
  ],
  scholarship_cycle_disciplines: [
    'release_id', 'scholarship_cycle_id', 'discipline_code', 'inclusion',
  ],
  scholarship_cycle_nationalities: [
    'release_id', 'scholarship_cycle_id', 'country_code', 'inclusion',
  ],
  search_documents: [
    'release_id', 'record_id', 'locale', 'record_kind', 'title', 'body', 'filter_text',
  ],
}

export const DOMAIN_TABLE_FOR_KIND: Record<string, ReleaseTableName> = {
  organization: 'organizations',
  location: 'locations',
  campus: 'campuses',
  academic_unit: 'academic_units',
  program: 'programs',
  program_cycle: 'program_cycles',
  application_route: 'application_routes',
  application_window: 'application_windows',
  fee: 'fee_items',
  requirement: 'requirements',
  required_document: 'required_documents',
  scholarship: 'scholarships',
  scholarship_cycle: 'scholarship_cycles',
  scholarship_coverage: 'scholarship_coverage_items',
}

export const SEARCHABLE_KINDS = new Set([
  'organization',
  'location',
  'program',
  'program_cycle',
  'scholarship',
  'scholarship_cycle',
])
