import { DOMAIN_TABLE_FOR_KIND, SEARCHABLE_KINDS } from './catalog-schema'
import {
  canonicalJsonText,
  isoDate,
  parseJson,
  ReleaseValidationError,
  sha256,
  sortRows,
  stableJson,
  tableDigests,
} from './artifact'
import type {
  D1Database,
  ReleaseArtifact,
  ReleaseCounts,
  ReleaseQueueJob,
  ReleaseTableName,
  SqlRow,
  SqlValue,
} from './types'
import { RELEASE_TABLES } from './types'

type RawRow = Record<string, unknown>

type PipelineRecord = {
  internalId: string
  publicId: string
  kind: string
  slug: string | null
  rowVersion: number
  updatedAt: string
}

export const ELIGIBLE_RECORD_FILTER = `record.workflow_status IN ('applied', 'published')
  AND NOT EXISTS (
    SELECT 1
    FROM materialization_batch_record_intents AS pending_intent
    JOIN materialization_batches AS intent_batch
      ON intent_batch.batch_id = pending_intent.batch_id
    WHERE pending_intent.record_id = record.id
      AND intent_batch.batch_status NOT IN ('applied', 'superseded')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM materialization_batch_records AS pending_batch_record
    JOIN materialization_batches AS pending_batch
      ON pending_batch.batch_id = pending_batch_record.batch_id
    WHERE pending_batch_record.record_id = record.id
      AND pending_batch.batch_status NOT IN ('applied', 'superseded')
  )`

function fail(code: string, message: string): never {
  throw new ReleaseValidationError(code, message)
}

function stringValue(row: RawRow, key: string, label: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_pipeline_value', `${label}.${key} must be a non-empty string`)
  }
  return value
}

function nullableString(row: RawRow, key: string, label: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    return fail('invalid_pipeline_value', `${label}.${key} must be a string or null`)
  }
  return value
}

function numberValue(row: RawRow, key: string, label: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid_pipeline_value', `${label}.${key} must be a finite number`)
  }
  return value
}

function nullableNumber(row: RawRow, key: string, label: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('invalid_pipeline_value', `${label}.${key} must be a finite number or null`)
  }
  return value
}


function publicId(
  records: Map<string, PipelineRecord>,
  internalId: string,
  label: string,
): string {
  const record = records.get(internalId)
  if (!record) {
    return fail('relationship_not_publishable', `${label} references excluded record ${internalId}`)
  }
  return record.publicId
}

function optionalPublicId(
  records: Map<string, PipelineRecord>,
  internalId: string | null,
  label: string,
): string | null {
  return internalId === null ? null : publicId(records, internalId, label)
}

function rowWithRelease(releaseId: string, values: Record<string, SqlValue>): SqlRow {
  return { release_id: releaseId, ...values }
}

function emptyTables(): Record<ReleaseTableName, SqlRow[]> {
  const tables = {} as Record<ReleaseTableName, SqlRow[]>
  for (const table of RELEASE_TABLES) {
    tables[table] = []
  }
  return tables
}

function fieldKey(recordId: string, fieldPath: string, locale: string): string {
  return `${recordId}\u0000${fieldPath}\u0000${locale}`
}

function localizedKey(recordId: string, fieldName: string, locale: string): string {
  return `${recordId}\u0000${fieldName}\u0000${locale}`
}

function asComparableDomainValue(value: unknown, valueType: string): unknown {
  if (value === null || value === undefined) return null
  if (valueType === 'boolean' && typeof value === 'number') return value === 1
  if (valueType === 'json' && typeof value === 'string') return parseJson(value, 'domain JSON')
  return value
}

function assertCanonicalMatchesProjection(
  canonicalValue: unknown,
  valueType: string,
  domainValue: unknown,
  label: string,
): void {
  if (stableJson(canonicalValue) !== stableJson(asComparableDomainValue(domainValue, valueType))) {
    fail('canonical_projection_mismatch', `${label} differs from its canonical field`)
  }
}

function strictJsonColumn(row: RawRow, key: string, label: string): string | null {
  const value = nullableString(row, key, label)
  return value === null ? null : canonicalJsonText(value, `${label}.${key}`)
}

async function loadPipelineTables(database: D1Database): Promise<{
  records: RawRow[]
  canonicalFields: RawRow[]
  evidence: RawRow[]
  localized: RawRow[]
  domain: Record<string, RawRow[]>
}> {
  const recordSql = `SELECT record.id, record.public_id, record.kind, record.slug,
                            record.row_version, record.updated_at
                       FROM records record
                      WHERE ${ELIGIBLE_RECORD_FILTER}
                      ORDER BY record.id`
  const queries: Array<{ label: string; sql: string }> = [
    { label: 'eligible records', sql: recordSql },
    {
      label: 'canonical fields',
      sql: `SELECT field.subject_record_id, field.field_path, field.locale,
            field.field_status, field.claim_id, field.value_json,
            field.verified_at, field.review_after,
            definition.value_type, definition.required_for_publish,
            public_status.catalog_field_status
       FROM canonical_fields field
       JOIN records record ON record.id = field.subject_record_id
       LEFT JOIN field_definitions definition
         ON definition.record_kind = record.kind
        AND definition.field_path = field.field_path
       LEFT JOIN canonical_public_status public_status
         ON public_status.subject_record_id = field.subject_record_id
        AND public_status.field_path = field.field_path
        AND public_status.locale = field.locale
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY field.subject_record_id, field.field_path, field.locale`,
    },
    {
      label: 'official evidence',
      sql: `SELECT field.subject_record_id, field.field_path, field.locale, field.claim_id,
            evidence.evidence_role,
            source.id AS source_internal_id, source.public_id AS source_public_id,
            source.canonical_url, source.source_kind, source.authority_level,
            source.official, source.language_code,
            fetch.completed_at AS checked_at,
            metadata.title AS source_title, metadata.publisher AS source_publisher
       FROM canonical_fields field
       JOIN records record ON record.id = field.subject_record_id
       JOIN claims claim ON claim.id = field.claim_id
       JOIN claim_evidence evidence ON evidence.claim_id = claim.id
       JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
       JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
       JOIN source_documents source ON source.id = fetch.source_id
       LEFT JOIN publication_source_metadata metadata ON metadata.source_id = source.id
      WHERE ${ELIGIBLE_RECORD_FILTER}
        AND field.field_status = 'accepted'
        AND claim.claim_status = 'accepted'
      ORDER BY field.subject_record_id, field.field_path, field.locale,
               source.id, evidence.evidence_role, fragment.id`,
    },
    {
      label: 'localized content',
      sql: `SELECT content.record_id, content.locale, content.field_name, content.text_value,
            content.translation_status, content.source_locale
       FROM localized_content content
       JOIN records record ON record.id = content.record_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY content.record_id, content.locale, content.field_name`,
    },
  ]

  const oneToOneTables = [
    'organizations', 'locations', 'institutions', 'campuses', 'academic_units',
    'programs', 'program_cycles', 'application_routes', 'application_windows',
    'fee_items', 'requirements', 'required_documents', 'scholarships',
    'scholarship_cycles', 'scholarship_coverage_items',
  ]
  for (const table of oneToOneTables) {
    queries.push({
      label: table,
      sql: `SELECT domain.*
         FROM ${table} domain
         JOIN records record ON record.id = domain.record_id
        WHERE ${ELIGIBLE_RECORD_FILTER}
        ORDER BY domain.record_id`,
    })
  }

  const relationQueries: Record<string, string> = {
    disciplines: 'SELECT * FROM disciplines ORDER BY code',
    program_disciplines: `SELECT relation.* FROM program_disciplines relation
      JOIN records record ON record.id = relation.program_id
      WHERE ${ELIGIBLE_RECORD_FILTER} ORDER BY relation.program_id, relation.discipline_code`,
    languages: 'SELECT * FROM languages ORDER BY code',
    program_teaching_languages: `SELECT relation.* FROM program_teaching_languages relation
      JOIN records record ON record.id = relation.program_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.program_id, relation.language_code, relation.role`,
    scholarship_cycle_institutions: `SELECT relation.* FROM scholarship_cycle_institutions relation
      JOIN records record ON record.id = relation.scholarship_cycle_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.scholarship_cycle_id, relation.institution_id`,
    scholarship_cycle_programs: `SELECT relation.* FROM scholarship_cycle_programs relation
      JOIN records record ON record.id = relation.scholarship_cycle_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.scholarship_cycle_id, relation.program_id`,
    scholarship_cycle_degree_levels: `SELECT relation.* FROM scholarship_cycle_degree_levels relation
      JOIN records record ON record.id = relation.scholarship_cycle_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.scholarship_cycle_id, relation.degree_level`,
    scholarship_cycle_disciplines: `SELECT relation.* FROM scholarship_cycle_disciplines relation
      JOIN records record ON record.id = relation.scholarship_cycle_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.scholarship_cycle_id, relation.discipline_code`,
    scholarship_cycle_nationalities: `SELECT relation.* FROM scholarship_cycle_nationalities relation
      JOIN records record ON record.id = relation.scholarship_cycle_id
      WHERE ${ELIGIBLE_RECORD_FILTER}
      ORDER BY relation.scholarship_cycle_id, relation.country_code`,
    field_definitions: `SELECT record_kind, field_path, value_type, required_for_publish
      FROM field_definitions ORDER BY record_kind, field_path`,
  }
  for (const [label, sql] of Object.entries(relationQueries)) {
    queries.push({ label, sql })
  }

  const results = await database.batch<RawRow>(
    queries.map(({ sql }) => database.prepare(sql)),
  )
  if (results.length !== queries.length) {
    fail('pipeline_snapshot_incomplete', 'D1 returned an incomplete transactional snapshot')
  }
  for (const [index, result] of results.entries()) {
    if (!result.success) {
      throw new Error(
        `${queries[index].label} query failed: ${result.error ?? 'unknown D1 error'}`,
      )
    }
  }

  const rows = (index: number): RawRow[] => results[index].results ?? []
  const records = rows(0)
  if (records.length === 0) {
    fail('empty_release', 'Pipeline has no applied or published records; refusing an empty cutover')
  }
  const canonicalFields = rows(1)
  const evidence = rows(2)
  const localized = rows(3)
  const domain: Record<string, RawRow[]> = {}
  let resultIndex = 4
  for (const table of oneToOneTables) domain[table] = rows(resultIndex++)
  for (const table of Object.keys(relationQueries)) domain[table] = rows(resultIndex++)

  return { records, canonicalFields, evidence, localized, domain }
}

export async function buildArtifactFromPipeline(
  database: D1Database,
  job: ReleaseQueueJob,
  capturedAt: Date,
): Promise<{ artifact: ReleaseArtifact; text: string; contentSha256: string }> {
  const raw = await loadPipelineTables(database)
  const releaseId = job.catalogReleaseId
  const generatedAt = capturedAt.toISOString()
  const dataDate = generatedAt.slice(0, 10)
  const records = new Map<string, PipelineRecord>()
  const publicIds = new Set<string>()
  for (const [index, row] of raw.records.entries()) {
    const label = `records[${index}]`
    const record: PipelineRecord = {
      internalId: stringValue(row, 'id', label),
      publicId: stringValue(row, 'public_id', label),
      kind: stringValue(row, 'kind', label),
      slug: nullableString(row, 'slug', label),
      rowVersion: numberValue(row, 'row_version', label),
      updatedAt: stringValue(row, 'updated_at', label),
    }
    if (records.has(record.internalId) || publicIds.has(record.publicId)) {
      fail('duplicate_record_identity', `duplicate Pipeline identity ${record.publicId}`)
    }
    records.set(record.internalId, record)
    publicIds.add(record.publicId)
  }

  const tables = emptyTables()
  const rawDomainByRecord = new Map<string, RawRow>()
  const domainCountByRecord = new Map<string, number>()
  for (const [table, rows] of Object.entries(raw.domain)) {
    if (!(table in {
      organizations: 1, locations: 1, institutions: 1, campuses: 1,
      academic_units: 1, programs: 1, program_cycles: 1, application_routes: 1,
      application_windows: 1, fee_items: 1, requirements: 1,
      required_documents: 1, scholarships: 1, scholarship_cycles: 1,
      scholarship_coverage_items: 1,
    })) continue
    for (const row of rows) {
      const id = stringValue(row, 'record_id', table)
      if (table !== 'institutions') {
        domainCountByRecord.set(id, (domainCountByRecord.get(id) ?? 0) + 1)
        rawDomainByRecord.set(id, row)
      }
    }
  }
  for (const record of records.values()) {
    const expected = DOMAIN_TABLE_FOR_KIND[record.kind]
    if (!expected || domainCountByRecord.get(record.internalId) !== 1) {
      fail(
        'domain_projection_incomplete',
        `${record.publicId} (${record.kind}) does not have exactly one ${expected ?? 'known'} domain row`,
      )
    }
  }

  const mapId = (value: string, label: string) => publicId(records, value, label)
  const mapOptionalId = (value: string | null, label: string) => optionalPublicId(records, value, label)

  for (const row of raw.domain.locations) {
    const label = `locations.${stringValue(row, 'record_id', 'locations')}`
    tables.locations.push(rowWithRelease(releaseId, {
      location_id: mapId(stringValue(row, 'record_id', label), label),
      parent_location_id: mapOptionalId(nullableString(row, 'parent_location_id', label), label),
      location_type: stringValue(row, 'location_type', label),
      country_code: stringValue(row, 'country_code', label),
      region_code: nullableString(row, 'region_code', label),
      latitude: nullableNumber(row, 'latitude', label),
      longitude: nullableNumber(row, 'longitude', label),
    }))
  }
  for (const row of raw.domain.organizations) {
    const label = `organizations.${stringValue(row, 'record_id', 'organizations')}`
    tables.organizations.push(rowWithRelease(releaseId, {
      organization_id: mapId(stringValue(row, 'record_id', label), label),
      organization_type: stringValue(row, 'organization_type', label),
      official_url: stringValue(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.institutions) {
    const label = `institutions.${stringValue(row, 'record_id', 'institutions')}`
    tables.institutions.push(rowWithRelease(releaseId, {
      institution_id: mapId(stringValue(row, 'record_id', label), label),
      city_id: mapId(stringValue(row, 'city_id', label), label),
      institution_type: stringValue(row, 'institution_type', label),
      admissions_url: stringValue(row, 'admissions_url', label),
      featured: numberValue(row, 'featured', label),
    }))
  }
  for (const row of raw.domain.campuses) {
    const label = `campuses.${stringValue(row, 'record_id', 'campuses')}`
    tables.campuses.push(rowWithRelease(releaseId, {
      campus_id: mapId(stringValue(row, 'record_id', label), label),
      institution_id: mapId(stringValue(row, 'institution_id', label), label),
      city_id: mapId(stringValue(row, 'city_id', label), label),
      official_url: nullableString(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.academic_units) {
    const label = `academic_units.${stringValue(row, 'record_id', 'academic_units')}`
    tables.academic_units.push(rowWithRelease(releaseId, {
      academic_unit_id: mapId(stringValue(row, 'record_id', label), label),
      institution_id: mapId(stringValue(row, 'institution_id', label), label),
      parent_unit_id: mapOptionalId(nullableString(row, 'parent_unit_id', label), label),
      official_url: nullableString(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.programs) {
    const label = `programs.${stringValue(row, 'record_id', 'programs')}`
    tables.programs.push(rowWithRelease(releaseId, {
      program_id: mapId(stringValue(row, 'record_id', label), label),
      institution_id: mapId(stringValue(row, 'institution_id', label), label),
      academic_unit_id: mapOptionalId(nullableString(row, 'academic_unit_id', label), label),
      parent_program_id: mapOptionalId(nullableString(row, 'parent_program_id', label), label),
      program_type: stringValue(row, 'program_type', label),
      degree_level: nullableString(row, 'degree_level', label),
      credential_type: nullableString(row, 'credential_type', label),
      attendance_mode: stringValue(row, 'attendance_mode', label),
      delivery_mode: stringValue(row, 'delivery_mode', label),
      duration_min: nullableNumber(row, 'duration_min', label),
      duration_max: nullableNumber(row, 'duration_max', label),
      duration_unit: nullableString(row, 'duration_unit', label),
      official_url: stringValue(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.disciplines) {
    const label = `disciplines.${stringValue(row, 'code', 'disciplines')}`
    tables.disciplines.push(rowWithRelease(releaseId, {
      code: stringValue(row, 'code', label),
      parent_code: nullableString(row, 'parent_code', label),
      name_en: stringValue(row, 'name_en', label),
      name_zh: nullableString(row, 'name_zh', label),
    }))
  }
  for (const row of raw.domain.program_disciplines) {
    const label = 'program_disciplines'
    tables.program_disciplines.push(rowWithRelease(releaseId, {
      program_id: mapId(stringValue(row, 'program_id', label), label),
      discipline_code: stringValue(row, 'discipline_code', label),
      is_primary: numberValue(row, 'is_primary', label),
    }))
  }
  for (const row of raw.domain.languages) {
    const label = `languages.${stringValue(row, 'code', 'languages')}`
    tables.languages.push(rowWithRelease(releaseId, {
      code: stringValue(row, 'code', label),
      name_en: stringValue(row, 'name_en', label),
      name_zh: nullableString(row, 'name_zh', label),
    }))
  }
  for (const row of raw.domain.program_teaching_languages) {
    const label = 'program_teaching_languages'
    tables.program_teaching_languages.push(rowWithRelease(releaseId, {
      program_id: mapId(stringValue(row, 'program_id', label), label),
      language_code: stringValue(row, 'language_code', label),
      role: stringValue(row, 'role', label),
    }))
  }
  for (const row of raw.domain.program_cycles) {
    const label = `program_cycles.${stringValue(row, 'record_id', 'program_cycles')}`
    tables.program_cycles.push(rowWithRelease(releaseId, {
      program_cycle_id: mapId(stringValue(row, 'record_id', label), label),
      program_id: mapId(stringValue(row, 'program_id', label), label),
      academic_year: stringValue(row, 'academic_year', label),
      intake_code: stringValue(row, 'intake_code', label),
      sequence: numberValue(row, 'sequence', label),
      starts_on: nullableString(row, 'starts_on', label),
      ends_on: nullableString(row, 'ends_on', label),
      cycle_status: stringValue(row, 'cycle_status', label),
      official_url: stringValue(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.application_routes) {
    const label = `application_routes.${stringValue(row, 'record_id', 'application_routes')}`
    tables.application_routes.push(rowWithRelease(releaseId, {
      application_route_id: mapId(stringValue(row, 'record_id', label), label),
      owner_record_id: mapId(stringValue(row, 'owner_record_id', label), label),
      route_type: stringValue(row, 'route_type', label),
      access_mode: stringValue(row, 'access_mode', label),
      apply_url: nullableString(row, 'apply_url', label),
      is_primary: numberValue(row, 'is_primary', label),
    }))
  }
  for (const row of raw.domain.application_windows) {
    const label = `application_windows.${stringValue(row, 'record_id', 'application_windows')}`
    tables.application_windows.push(rowWithRelease(releaseId, {
      application_window_id: mapId(stringValue(row, 'record_id', label), label),
      application_route_id: mapId(stringValue(row, 'application_route_id', label), label),
      round_label: nullableString(row, 'round_label', label),
      opens_on: nullableString(row, 'opens_on', label),
      closes_on: nullableString(row, 'closes_on', label),
      rolling: numberValue(row, 'rolling', label),
    }))
  }
  for (const row of raw.domain.fee_items) {
    const label = `fee_items.${stringValue(row, 'record_id', 'fee_items')}`
    const valueStatus = stringValue(row, 'value_status', label)
    if (!['confirmed', 'reference'].includes(valueStatus)) {
      fail('unpublishable_domain_value', `${label}.value_status=${valueStatus} cannot enter Catalog`)
    }
    tables.fee_items.push(rowWithRelease(releaseId, {
      fee_id: mapId(stringValue(row, 'record_id', label), label),
      owner_record_id: mapId(stringValue(row, 'owner_record_id', label), label),
      fee_type: stringValue(row, 'fee_type', label),
      amount_min_minor: nullableNumber(row, 'amount_min_minor', label),
      amount_max_minor: nullableNumber(row, 'amount_max_minor', label),
      currency_code: nullableString(row, 'currency_code', label),
      currency_exponent: numberValue(row, 'currency_exponent', label),
      billing_period: nullableString(row, 'billing_period', label),
      mandatory: numberValue(row, 'mandatory', label),
      value_status: valueStatus,
    }))
  }
  for (const row of raw.domain.requirements) {
    const label = `requirements.${stringValue(row, 'record_id', 'requirements')}`
    tables.requirements.push(rowWithRelease(releaseId, {
      requirement_id: mapId(stringValue(row, 'record_id', label), label),
      owner_record_id: mapId(stringValue(row, 'owner_record_id', label), label),
      requirement_type: stringValue(row, 'requirement_type', label),
      comparator: nullableString(row, 'comparator', label),
      value_json: strictJsonColumn(row, 'value_json', label),
      required: numberValue(row, 'required', label),
      applies_to_json: strictJsonColumn(row, 'applies_to_json', label),
      sort_order: numberValue(row, 'sort_order', label),
    }))
  }
  for (const row of raw.domain.required_documents) {
    const label = `required_documents.${stringValue(row, 'record_id', 'required_documents')}`
    tables.required_documents.push(rowWithRelease(releaseId, {
      required_document_id: mapId(stringValue(row, 'record_id', label), label),
      owner_record_id: mapId(stringValue(row, 'owner_record_id', label), label),
      document_type: stringValue(row, 'document_type', label),
      required: numberValue(row, 'required', label),
      copies: nullableNumber(row, 'copies', label),
      notarization_required: nullableNumber(row, 'notarization_required', label),
      translation_required: nullableNumber(row, 'translation_required', label),
    }))
  }
  for (const row of raw.domain.scholarships) {
    const label = `scholarships.${stringValue(row, 'record_id', 'scholarships')}`
    tables.scholarships.push(rowWithRelease(releaseId, {
      scholarship_id: mapId(stringValue(row, 'record_id', label), label),
      provider_organization_id: mapId(stringValue(row, 'provider_organization_id', label), label),
      scheme_type: stringValue(row, 'scheme_type', label),
      official_url: stringValue(row, 'official_url', label),
    }))
  }
  for (const row of raw.domain.scholarship_cycles) {
    const label = `scholarship_cycles.${stringValue(row, 'record_id', 'scholarship_cycles')}`
    const scopes = ['institution_scope', 'program_scope', 'degree_scope', 'nationality_scope']
      .map((field) => [field, stringValue(row, field, label)] as const)
    for (const [field, value] of scopes) {
      if (!['all', 'listed'].includes(value)) {
        fail('unpublishable_domain_value', `${label}.${field}=${value} cannot enter Catalog`)
      }
    }
    tables.scholarship_cycles.push(rowWithRelease(releaseId, {
      scholarship_cycle_id: mapId(stringValue(row, 'record_id', label), label),
      scholarship_id: mapId(stringValue(row, 'scholarship_id', label), label),
      academic_year: stringValue(row, 'academic_year', label),
      intake_code: stringValue(row, 'intake_code', label),
      sequence: numberValue(row, 'sequence', label),
      cycle_status: stringValue(row, 'cycle_status', label),
      institution_scope: scopes[0][1],
      program_scope: scopes[1][1],
      degree_scope: scopes[2][1],
      nationality_scope: scopes[3][1],
    }))
  }
  for (const row of raw.domain.scholarship_coverage_items) {
    const label = `scholarship_coverage_items.${stringValue(row, 'record_id', 'coverage')}`
    const coverageMode = stringValue(row, 'coverage_mode', label)
    if (!['full', 'partial', 'fixed', 'waiver', 'none'].includes(coverageMode)) {
      fail('unpublishable_domain_value', `${label}.coverage_mode=${coverageMode} cannot enter Catalog`)
    }
    tables.scholarship_coverage_items.push(rowWithRelease(releaseId, {
      coverage_id: mapId(stringValue(row, 'record_id', label), label),
      scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', label), label),
      coverage_type: stringValue(row, 'coverage_type', label),
      coverage_mode: coverageMode,
      amount_min_minor: nullableNumber(row, 'amount_min_minor', label),
      amount_max_minor: nullableNumber(row, 'amount_max_minor', label),
      currency_code: nullableString(row, 'currency_code', label),
      currency_exponent: numberValue(row, 'currency_exponent', label),
      period: nullableString(row, 'period', label),
      max_duration: nullableNumber(row, 'max_duration', label),
      max_duration_unit: nullableString(row, 'max_duration_unit', label),
    }))
  }

  const relationMappings: Array<{
    source: string
    target: ReleaseTableName
    values: (row: RawRow) => Record<string, SqlValue>
  }> = [
    {
      source: 'scholarship_cycle_institutions', target: 'scholarship_cycle_institutions',
      values: (row) => ({
        scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', 'scope'), 'scope'),
        institution_id: mapId(stringValue(row, 'institution_id', 'scope'), 'scope'),
        inclusion: stringValue(row, 'inclusion', 'scope'),
      }),
    },
    {
      source: 'scholarship_cycle_programs', target: 'scholarship_cycle_programs',
      values: (row) => ({
        scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', 'scope'), 'scope'),
        program_id: mapId(stringValue(row, 'program_id', 'scope'), 'scope'),
        inclusion: stringValue(row, 'inclusion', 'scope'),
      }),
    },
    {
      source: 'scholarship_cycle_degree_levels', target: 'scholarship_cycle_degree_levels',
      values: (row) => ({
        scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', 'scope'), 'scope'),
        degree_level: stringValue(row, 'degree_level', 'scope'),
        inclusion: stringValue(row, 'inclusion', 'scope'),
      }),
    },
    {
      source: 'scholarship_cycle_disciplines', target: 'scholarship_cycle_disciplines',
      values: (row) => ({
        scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', 'scope'), 'scope'),
        discipline_code: stringValue(row, 'discipline_code', 'scope'),
        inclusion: stringValue(row, 'inclusion', 'scope'),
      }),
    },
    {
      source: 'scholarship_cycle_nationalities', target: 'scholarship_cycle_nationalities',
      values: (row) => ({
        scholarship_cycle_id: mapId(stringValue(row, 'scholarship_cycle_id', 'scope'), 'scope'),
        country_code: stringValue(row, 'country_code', 'scope'),
        inclusion: stringValue(row, 'inclusion', 'scope'),
      }),
    },
  ]
  for (const mapping of relationMappings) {
    for (const row of raw.domain[mapping.source]) {
      tables[mapping.target].push(rowWithRelease(releaseId, mapping.values(row)))
    }
  }

  const localizedByKey = new Map<string, RawRow>()
  for (const row of raw.localized) {
    const label = 'localized_content'
    const status = stringValue(row, 'translation_status', label)
    if (!['reviewed', 'published'].includes(status)) continue
    const internalId = stringValue(row, 'record_id', label)
    const fieldName = stringValue(row, 'field_name', label)
    const locale = stringValue(row, 'locale', label)
    localizedByKey.set(localizedKey(internalId, fieldName, locale), row)
    tables.localized_content.push(rowWithRelease(releaseId, {
      record_id: mapId(internalId, label),
      locale,
      field_name: fieldName,
      text_value: stringValue(row, 'text_value', label),
      translation_status: status,
      source_locale: nullableString(row, 'source_locale', label),
    }))
  }

  const officialEvidence = new Map<string, RawRow[]>()
  const sources = new Map<string, SqlRow>()
  const sourceCheckedAt = new Map<string, string>()
  const recordSources = new Map<string, SqlRow>()
  for (const row of raw.evidence) {
    const role = stringValue(row, 'evidence_role', 'evidence')
    const official = numberValue(row, 'official', 'evidence')
    const authority = stringValue(row, 'authority_level', 'evidence')
    if (
      !['primary', 'corroborating'].includes(role)
      || official !== 1
      || !['primary_official', 'secondary_official'].includes(authority)
    ) continue
    const internalRecordId = stringValue(row, 'subject_record_id', 'evidence')
    const path = stringValue(row, 'field_path', 'evidence')
    const locale = nullableString(row, 'locale', 'evidence') ?? ''
    const key = fieldKey(internalRecordId, path, locale)
    officialEvidence.set(key, [...(officialEvidence.get(key) ?? []), row])

    const sourceInternalId = stringValue(row, 'source_internal_id', 'evidence')
    const sourcePublicId = stringValue(row, 'source_public_id', 'evidence')
    const title = nullableString(row, 'source_title', 'evidence')
    const publisher = nullableString(row, 'source_publisher', 'evidence')
    if (!title?.trim() || !publisher?.trim()) {
      fail(
        'source_publication_metadata_missing',
        `official source ${sourcePublicId} lacks reviewed title or publisher metadata`,
      )
    }
    const checkedAt = stringValue(row, 'checked_at', 'evidence')
    if ((sourceCheckedAt.get(sourceInternalId) ?? '') < checkedAt) {
      sourceCheckedAt.set(sourceInternalId, checkedAt)
    }
    sources.set(sourceInternalId, rowWithRelease(releaseId, {
      source_id: sourcePublicId,
      url: stringValue(row, 'canonical_url', 'evidence'),
      title,
      publisher,
      source_kind: stringValue(row, 'source_kind', 'evidence'),
      language_code: stringValue(row, 'language_code', 'evidence'),
      authority_level: authority,
      checked_at: checkedAt,
    }))
    const publicRecordId = mapId(internalRecordId, 'evidence')
    const bindingKey = `${publicRecordId}\u0000${path}\u0000${locale}\u0000${sourcePublicId}`
    recordSources.set(bindingKey, rowWithRelease(releaseId, {
      record_id: publicRecordId,
      field_path: path,
      locale,
      source_id: sourcePublicId,
      evidence_role: role,
    }))
  }
  for (const [internalSourceId, source] of sources) {
    source.checked_at = sourceCheckedAt.get(internalSourceId) ?? source.checked_at
    tables.source_summaries.push(source)
  }
  tables.record_sources.push(...recordSources.values())

  const definitionByKindPath = new Map<string, RawRow>()
  const requiredByKind = new Map<string, Set<string>>()
  for (const row of raw.domain.field_definitions) {
    const kind = stringValue(row, 'record_kind', 'field definition')
    const path = stringValue(row, 'field_path', 'field definition')
    definitionByKindPath.set(`${kind}\u0000${path}`, row)
    if (numberValue(row, 'required_for_publish', 'field definition') === 1) {
      const paths = requiredByKind.get(kind) ?? new Set<string>()
      paths.add(path)
      requiredByKind.set(kind, paths)
    }
  }

  const knownPathsByRecord = new Map<string, Set<string>>()
  const freshnessByRecord = new Map<string, { verified: string[]; review: string[] }>()
  for (const [index, row] of raw.canonicalFields.entries()) {
    const label = `canonical_fields[${index}]`
    const internalId = stringValue(row, 'subject_record_id', label)
    const record = records.get(internalId)
    if (!record) fail('record_missing', `${label} references an excluded record`)
    const path = stringValue(row, 'field_path', label)
    const locale = nullableString(row, 'locale', label) ?? ''
    const definition = definitionByKindPath.get(`${record.kind}\u0000${path}`)
    if (!definition) {
      fail('field_definition_missing', `${record.kind}.${path} has no field definition`)
    }
    const required = numberValue(definition, 'required_for_publish', label)
    const valueType = stringValue(definition, 'value_type', label)
    const pipelineStatus = stringValue(row, 'field_status', label)
    let catalogStatus: string
    let valueJson: string | null = null
    let verifiedAt: string | null = null
    let reviewAfter: string | null = null

    if (pipelineStatus === 'accepted') {
      const rawValue = nullableString(row, 'value_json', label)
      const rawVerified = nullableString(row, 'verified_at', label)
      const rawReview = nullableString(row, 'review_after', label)
      if (rawValue === null || rawVerified === null || rawReview === null) {
        fail('accepted_field_incomplete', `${record.publicId}.${path} lacks value or freshness`)
      }
      const canonicalValue = parseJson(rawValue, `${record.publicId}.${path}`)
      valueJson = stableJson(canonicalValue)
      verifiedAt = isoDate(rawVerified, `${record.publicId}.${path}.verified_at`)
      reviewAfter = isoDate(rawReview, `${record.publicId}.${path}.review_after`)
      if (verifiedAt > dataDate) {
        fail('future_verification', `${record.publicId}.${path} was verified after the snapshot date`)
      }
      catalogStatus = reviewAfter >= dataDate ? 'known' : 'stale'
      if (!(officialEvidence.get(fieldKey(internalId, path, locale))?.length)) {
        fail('official_evidence_missing', `${record.publicId}.${path} lacks official field evidence`)
      }
      if (catalogStatus === 'known') {
        const paths = knownPathsByRecord.get(internalId) ?? new Set<string>()
        paths.add(path)
        knownPathsByRecord.set(internalId, paths)
        const freshness = freshnessByRecord.get(internalId) ?? { verified: [], review: [] }
        freshness.verified.push(verifiedAt)
        freshness.review.push(reviewAfter)
        freshnessByRecord.set(internalId, freshness)

        const localizedFieldName = path.startsWith('localized.') ? path.slice(10) : path
        const localizedRow = locale
          ? localizedByKey.get(localizedKey(internalId, localizedFieldName, locale))
          : undefined
        if (locale || valueType === 'localized_string') {
          if (!localizedRow) {
            fail(
              'localized_projection_missing',
              `${record.publicId}.${path}[${locale}] has no reviewed public localization`,
            )
          }
          assertCanonicalMatchesProjection(
            canonicalValue,
            valueType,
            stringValue(localizedRow, 'text_value', label),
            `${record.publicId}.${path}[${locale}]`,
          )
        } else {
          const domainRow = rawDomainByRecord.get(internalId)
          if (domainRow && Object.hasOwn(domainRow, path) && !path.endsWith('_id')) {
            assertCanonicalMatchesProjection(
              canonicalValue,
              valueType,
              domainRow[path],
              `${record.publicId}.${path}`,
            )
          }
        }
      } else {
        valueJson = null
      }
    } else if (['unknown', 'withheld', 'expired'].includes(pipelineStatus)) {
      const explicit = nullableString(row, 'catalog_field_status', label)
      if (pipelineStatus === 'expired') {
        catalogStatus = 'stale'
      } else if (explicit && [
        'officially_not_announced', 'not_applicable', 'source_unavailable', 'conflict', 'stale',
      ].includes(explicit)) {
        catalogStatus = explicit
      } else {
        fail(
          'public_field_status_missing',
          `${record.publicId}.${path} cannot map ${pipelineStatus} without canonical_public_status`,
        )
      }
    } else {
      fail('invalid_field_status', `${record.publicId}.${path} has unsupported ${pipelineStatus}`)
    }

    if (required === 1 && catalogStatus !== 'known') {
      fail('required_field_not_publishable', `${record.publicId}.${path} is required but ${catalogStatus}`)
    }
    tables.record_field_status.push(rowWithRelease(releaseId, {
      record_id: record.publicId,
      field_path: path,
      locale,
      field_status: catalogStatus,
      required_for_publish: required,
      value_json: valueJson,
      verified_at: catalogStatus === 'known' ? verifiedAt : null,
      review_after: catalogStatus === 'known' ? reviewAfter : null,
    }))
  }

  for (const record of records.values()) {
    const known = knownPathsByRecord.get(record.internalId) ?? new Set<string>()
    for (const requiredPath of requiredByKind.get(record.kind) ?? []) {
      if (!known.has(requiredPath)) {
        fail('required_field_missing', `${record.publicId}.${requiredPath} is required but not current`)
      }
    }
    const freshness = freshnessByRecord.get(record.internalId)
    if (!freshness?.verified.length || !freshness.review.length) {
      fail('record_evidence_missing', `${record.publicId} has no current canonical field evidence`)
    }
    const verifiedAt = [...freshness.verified].sort().at(-1) as string
    const reviewAfter = [...freshness.review].sort()[0]
    if (reviewAfter < verifiedAt) {
      fail('record_freshness_invalid', `${record.publicId} has an incoherent freshness window`)
    }
    const recordContent = {
      identity: { publicId: record.publicId, kind: record.kind, slug: record.slug },
      domain: Object.fromEntries(
        RELEASE_TABLES.filter((table) => table !== 'catalog_records')
          .map((table) => [table, tables[table].filter((row) => Object.values(row).includes(record.publicId))])
          .filter(([, rows]) => (rows as SqlRow[]).length > 0),
      ),
    }
    tables.catalog_records.push(rowWithRelease(releaseId, {
      record_id: record.publicId,
      record_kind: record.kind,
      slug: record.slug,
      gate_status: 'publishable',
      verified_at: verifiedAt,
      review_after: reviewAfter,
      content_sha256: await sha256(stableJson(recordContent)),
    }))
  }

  const knownName = new Set(
    tables.record_field_status
      .filter((row) => row.field_status === 'known' && ['name', 'localized.name'].includes(String(row.field_path)))
      .map((row) => `${row.record_id}\u0000${row.locale}`),
  )
  for (const row of tables.localized_content) {
    if (row.field_name !== 'name') continue
    const record = [...records.values()].find((candidate) => candidate.publicId === row.record_id)
    if (!record || !SEARCHABLE_KINDS.has(record.kind)) continue
    if (!knownName.has(`${row.record_id}\u0000${row.locale}`)) continue
    tables.search_documents.push(rowWithRelease(releaseId, {
      record_id: String(row.record_id),
      locale: String(row.locale),
      record_kind: record.kind,
      title: String(row.text_value),
      body: '',
      filter_text: '',
    }))
  }

  for (const table of RELEASE_TABLES) tables[table] = sortRows(tables[table])
  const counts: ReleaseCounts = {
    sources: tables.source_summaries.length,
    cities: tables.locations.filter((row) => row.location_type === 'city').length,
    universities: tables.institutions.length,
    programs: tables.programs.length,
    admissionCycles: tables.program_cycles.length,
    scholarships: tables.scholarships.length,
  }
  const versionSeed = await sha256(stableJson({ releaseId, generatedAt, tables }))
  const dataVersion = Number(BigInt(`0x${versionSeed.slice(0, 13)}`)) + 1
  const artifact: ReleaseArtifact = {
    format: 'studyinchina.catalog.release',
    formatVersion: 1,
    manifest: {
      releaseId,
      dataVersion,
      schemaVersion: 1,
      dataDate,
      generatedAt,
      sourcePipelineRunId: job.publicationJobId,
      counts,
    },
    tableDigests: await tableDigests(tables),
    tables,
  }
  const text = stableJson(artifact)
  return { artifact, text, contentSha256: await sha256(text) }
}
