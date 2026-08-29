import { sha256Hex, stableJson } from './hash'
import { validateManifest } from './security'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  SourceManifestV1,
} from './types'

const REGISTRAR_VERSION = 'entity-promotion-mapping-registrar/v1'
const MAX_MAPPINGS = 100

type ValueTransform = 'identity' | 'major_to_minor_2'
type SourceFieldType = SourceManifestV1['extraction']['fields'][number]['type']

export type EntityPromotionFieldMapping = {
  candidateFieldPath: string
  targetRecordId: string
  canonicalFieldPath: string
  locale?: string
  valueTransform?: ValueTransform
}

export type EntityPromotionMappingResult = {
  status: 'registered' | 'already-registered'
  candidateId: string
  sourceId: string
  rootRecordId: string
  mappings: number
  inserted: number
  planSha256: string
}

type MaterializedContextRow = {
  candidate_id: string
  source_id: string
  candidate_status: string
  entity_type: string
  registry_id: string
  registry_status: string
  registry_record_id: string | null
  decision_status: string
  decision_record_id: string | null
  root_workflow_status: string | null
  manifest_json: string
  binding_enabled: number | null
  source_official: number | null
  source_active: number | null
  source_authority: string | null
}

type TargetRow = {
  record_id: string
  record_kind: string
  workflow_status: string
  value_type: string
  risk_class: string
  max_age_days: number | null
}

type ExistingMappingRow = {
  candidate_field_path: string
  subject_record_id: string
  canonical_field_path: string
  locale: string
  value_transform: ValueTransform
  enabled: number
}

const ALLOWED_TARGETS: Readonly<Record<string, ReadonlySet<string>>> = {
  program: new Set([
    'duration_min',
    'duration_max',
    'duration_unit',
    'teaching_languages',
  ]),
  program_cycle: new Set([
    'academic_year',
    'intake_code',
    'starts_on',
    'ends_on',
    'cycle_status',
    'official_url',
  ]),
  scholarship_cycle: new Set([
    'academic_year',
    'intake_code',
    'cycle_status',
    'deadline',
  ]),
  application_route: new Set([
    'route_type',
    'access_mode',
    'apply_url',
  ]),
  application_window: new Set([
    'round_label',
    'opens_on',
    'closes_on',
    'rolling',
  ]),
  fee: new Set([
    'amount_min_minor',
    'amount_max_minor',
    'currency_code',
    'billing_period',
    'value_status',
  ]),
  requirement: new Set([
    'requirement_type',
    'comparator',
    'value_json',
    'required',
    'applies_to_json',
  ]),
}

function ensureSuccess(result: D1Result, operation: string): void {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.error ?? 'unknown D1 error'}`)
  }
}

function ensureBatch(results: D1Result[], operation: string): void {
  for (const result of results) ensureSuccess(result, operation)
}

function statement(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): D1PreparedStatement {
  return database.prepare(sql).bind(...values)
}

function isoTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('registeredAt must be an ISO timestamp')
  }
  return parsed.toISOString()
}

function normalizeText(value: string, label: string, maximum = 200): string {
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`)
  }
  return normalized
}

function normalizeLocale(value: string | undefined): string {
  if (value === undefined || value === '') return ''
  const normalized = value.trim()
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/u.test(normalized)) {
    throw new Error(`invalid mapping locale ${value}`)
  }
  return normalized
}

function normalizeMappings(
  mappings: EntityPromotionFieldMapping[],
): Required<EntityPromotionFieldMapping>[] {
  if (mappings.length < 1 || mappings.length > MAX_MAPPINGS) {
    throw new Error(`mapping plan must contain 1-${MAX_MAPPINGS} fields`)
  }
  const normalized = mappings.map((mapping, index) => ({
    candidateFieldPath: normalizeText(
      mapping.candidateFieldPath,
      `mappings[${index}].candidateFieldPath`,
    ),
    targetRecordId: normalizeText(
      mapping.targetRecordId,
      `mappings[${index}].targetRecordId`,
    ),
    canonicalFieldPath: normalizeText(
      mapping.canonicalFieldPath,
      `mappings[${index}].canonicalFieldPath`,
    ),
    locale: normalizeLocale(mapping.locale),
    valueTransform: mapping.valueTransform ?? 'identity',
  })).sort((left, right) => (
    left.candidateFieldPath.localeCompare(right.candidateFieldPath, 'en')
  ))
  const paths = new Set<string>()
  const targets = new Set<string>()
  for (const mapping of normalized) {
    if (paths.has(mapping.candidateFieldPath)) {
      throw new Error(`duplicate candidate mapping ${mapping.candidateFieldPath}`)
    }
    paths.add(mapping.candidateFieldPath)
    const target = [
      mapping.targetRecordId,
      mapping.canonicalFieldPath,
      mapping.locale,
    ].join('\u0000')
    if (targets.has(target)) {
      throw new Error(`duplicate canonical mapping target ${mapping.canonicalFieldPath}`)
    }
    targets.add(target)
  }
  return normalized
}

function sourceTypeCanMap(
  sourceType: SourceFieldType,
  targetType: string,
  transform: ValueTransform,
): boolean {
  if (transform === 'major_to_minor_2') {
    return (sourceType === 'money' || sourceType === 'number')
      && targetType === 'decimal_minor'
  }
  if (sourceType === 'money') return false
  return {
    string: new Set(['string', 'localized_string', 'url', 'identifier']),
    number: new Set(['integer', 'decimal_minor']),
    boolean: new Set(['boolean']),
    date: new Set(['date']),
    'string-array': new Set(['json']),
    object: new Set(['json']),
  }[sourceType]?.has(targetType) ?? false
}

async function loadContext(
  database: D1Database,
  candidateId: string,
): Promise<MaterializedContextRow> {
  const row = await database.prepare(
    `SELECT candidate.candidate_id, candidate.source_id,
            candidate.candidate_status, candidate.entity_type,
            registry.registry_id, registry.registry_status,
            registry.canonical_record_id AS registry_record_id,
            decision.decision_status,
            decision.canonical_record_id AS decision_record_id,
            root.workflow_status AS root_workflow_status,
            source.manifest_json,
            binding.enabled AS binding_enabled,
            document.official AS source_official,
            document.active AS source_active,
            document.authority_level AS source_authority
       FROM extracted_entity_candidates candidate
       JOIN entity_registry registry
         ON registry.institution_id = candidate.institution_id
        AND registry.entity_type = candidate.entity_type
        AND registry.entity_key = candidate.entity_key
       JOIN entity_materialization_decisions decision
         ON decision.candidate_id = candidate.candidate_id
        AND decision.registry_id = registry.registry_id
       JOIN ingestion_sources source ON source.source_id = candidate.source_id
       LEFT JOIN records root ON root.id = decision.canonical_record_id
       LEFT JOIN promotion_source_bindings binding
         ON binding.source_id = candidate.source_id
       LEFT JOIN source_documents document
         ON document.id = binding.source_document_id
      WHERE candidate.candidate_id = ?1`,
  ).bind(candidateId).first<MaterializedContextRow>()
  if (!row) throw new Error(`materialized entity candidate ${candidateId} was not found`)
  return row
}

async function assertSingleEntitySource(
  database: D1Database,
  sourceId: string,
): Promise<void> {
  const result = await database.prepare(
    `SELECT COUNT(*) AS entity_count
       FROM (
         SELECT DISTINCT entity_type, entity_key
           FROM extracted_entity_candidates
          WHERE source_id = ?1
            AND candidate_status NOT IN ('rejected', 'superseded')
       )`,
  ).bind(sourceId).first<{ entity_count: number }>()
  if (Number(result?.entity_count ?? 0) !== 1) {
    throw new Error(
      `source ${sourceId} is not a single-entity source; candidate-scoped mappings are required`,
    )
  }
}

async function loadOwnedTarget(
  database: D1Database,
  rootRecordId: string,
  targetRecordId: string,
  canonicalFieldPath: string,
): Promise<TargetRow | null> {
  return database.prepare(
    `WITH owned(record_id) AS (
       SELECT ?1
       UNION
       SELECT record_id FROM program_cycles WHERE program_id = ?1
       UNION
       SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
       UNION
       SELECT route.record_id
         FROM application_routes route
        WHERE route.owner_record_id IN (
          SELECT record_id FROM program_cycles WHERE program_id = ?1
          UNION
          SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
        )
       UNION
       SELECT window.record_id
         FROM application_windows window
         JOIN application_routes route
           ON route.record_id = window.application_route_id
        WHERE route.owner_record_id IN (
          SELECT record_id FROM program_cycles WHERE program_id = ?1
          UNION
          SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
        )
       UNION
       SELECT fee.record_id
         FROM fee_items fee
        WHERE fee.owner_record_id IN (
          SELECT record_id FROM program_cycles WHERE program_id = ?1
          UNION
          SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
          UNION
          SELECT route.record_id
            FROM application_routes route
           WHERE route.owner_record_id IN (
             SELECT record_id FROM program_cycles WHERE program_id = ?1
             UNION
             SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
           )
        )
       UNION
       SELECT requirement.record_id
         FROM requirements requirement
        WHERE requirement.owner_record_id = ?1
           OR requirement.owner_record_id IN (
             SELECT record_id FROM program_cycles WHERE program_id = ?1
             UNION
             SELECT record_id FROM scholarship_cycles WHERE scholarship_id = ?1
           )
     )
     SELECT record.id AS record_id, record.kind AS record_kind,
            record.workflow_status, definition.value_type,
            definition.risk_class, definition.max_age_days
       FROM owned
       JOIN records record ON record.id = owned.record_id
       JOIN field_definitions definition
         ON definition.record_kind = record.kind
        AND definition.field_path = ?3
      WHERE record.id = ?2`,
  ).bind(rootRecordId, targetRecordId, canonicalFieldPath).first<TargetRow>()
}

function sameMapping(
  existing: ExistingMappingRow,
  expected: Required<EntityPromotionFieldMapping>,
): boolean {
  return existing.subject_record_id === expected.targetRecordId
    && existing.canonical_field_path === expected.canonicalFieldPath
    && existing.locale === expected.locale
    && existing.value_transform === expected.valueTransform
}

export async function registerEntityPromotionFieldMappings(
  database: D1Database,
  candidateId: string,
  mappings: EntityPromotionFieldMapping[],
  registeredAt = new Date().toISOString(),
): Promise<EntityPromotionMappingResult> {
  const normalizedCandidateId = normalizeText(candidateId, 'candidateId', 512)
  const normalizedMappings = normalizeMappings(mappings)
  const timestamp = isoTimestamp(registeredAt)
  const context = await loadContext(database, normalizedCandidateId)
  const rootRecordId = context.decision_record_id
  if (
    context.candidate_status !== 'registered'
    || context.decision_status !== 'materialized'
    || context.registry_status !== 'active'
    || !rootRecordId
    || context.registry_record_id !== rootRecordId
    || !['applied', 'published'].includes(context.root_workflow_status ?? '')
  ) {
    throw new Error('promotion mappings require a registered, materialized entity identity')
  }
  if (
    context.binding_enabled !== 1
    || context.source_official !== 1
    || context.source_active !== 1
    || !['primary_official', 'secondary_official'].includes(
      context.source_authority ?? '',
    )
  ) {
    throw new Error('promotion mappings require an enabled official source binding')
  }

  const manifest = validateManifest(
    JSON.parse(context.manifest_json) as SourceManifestV1,
  )
  if (manifest.id !== context.source_id) {
    throw new Error('mapping source differs from its immutable manifest identity')
  }
  if (manifest.extraction.mode === 'rules-only') {
    throw new Error('entity fact mappings require dual model verification')
  }
  await assertSingleEntitySource(database, context.source_id)

  const manifestFields = new Map<string, SourceManifestV1['extraction']['fields'][number]>()
  for (const field of manifest.extraction.fields) {
    if (manifestFields.has(field.path)) {
      throw new Error(`manifest contains duplicate field ${field.path}`)
    }
    manifestFields.set(field.path, field)
  }
  const mappedPaths = normalizedMappings.map((mapping) => mapping.candidateFieldPath)
  const manifestPaths = [...manifestFields.keys()].sort((left, right) => (
    left.localeCompare(right, 'en')
  ))
  if (stableJson(mappedPaths) !== stableJson(manifestPaths)) {
    throw new Error('mapping plan must cover every manifest extraction field exactly')
  }

  for (const mapping of normalizedMappings) {
    const sourceField = manifestFields.get(mapping.candidateFieldPath)!
    if (sourceField.critical !== true) {
      throw new Error(`mapped field ${mapping.candidateFieldPath} must require dual verification`)
    }
    const target = await loadOwnedTarget(
      database,
      rootRecordId,
      mapping.targetRecordId,
      mapping.canonicalFieldPath,
    )
    if (!target) {
      throw new Error(
        `mapping target ${mapping.targetRecordId}.${mapping.canonicalFieldPath} is undefined or outside the entity tree`,
      )
    }
    if (!['applied', 'published'].includes(target.workflow_status)) {
      throw new Error(`mapping target ${target.record_id} is ${target.workflow_status}`)
    }
    if (!ALLOWED_TARGETS[target.record_kind]?.has(mapping.canonicalFieldPath)) {
      throw new Error(
        `canonical target ${target.record_kind}.${mapping.canonicalFieldPath} is not allowlisted`,
      )
    }
    if (!Number.isInteger(target.max_age_days) || Number(target.max_age_days) < 1) {
      throw new Error(
        `canonical target ${target.record_kind}.${mapping.canonicalFieldPath} lacks a freshness policy`,
      )
    }
    if (!sourceTypeCanMap(
      sourceField.type,
      target.value_type,
      mapping.valueTransform,
    )) {
      throw new Error(
        `source field ${mapping.candidateFieldPath} (${sourceField.type}) cannot map to ${target.value_type} with ${mapping.valueTransform}`,
      )
    }
    if (mapping.locale && target.value_type !== 'localized_string') {
      throw new Error(`locale is only valid for localized_string targets`)
    }
  }

  const existingResult = await database.prepare(
    `SELECT mapping.candidate_field_path, mapping.subject_record_id,
            mapping.canonical_field_path, mapping.locale,
            COALESCE(transform.value_transform, 'identity') AS value_transform,
            mapping.enabled
       FROM promotion_field_mappings mapping
       LEFT JOIN promotion_field_mapping_transforms transform
         ON transform.source_id = mapping.source_id
        AND transform.candidate_field_path = mapping.candidate_field_path
      WHERE mapping.source_id = ?1`,
  ).bind(context.source_id).all<ExistingMappingRow>()
  ensureSuccess(existingResult, 'load existing promotion mappings')
  const existingByPath = new Map(
    (existingResult.results ?? []).map((mapping) => (
      [mapping.candidate_field_path, mapping]
    )),
  )
  for (const existing of existingByPath.values()) {
    const expected = normalizedMappings.find((mapping) => (
      mapping.candidateFieldPath === existing.candidate_field_path
    ))
    if (!expected || !sameMapping(existing, expected)) {
      throw new Error(`existing mapping conflicts with the trusted plan for ${existing.candidate_field_path}`)
    }
  }

  const planSha256 = await sha256Hex(stableJson({
    candidateId: normalizedCandidateId,
    sourceId: context.source_id,
    rootRecordId,
    mappings: normalizedMappings,
  }))
  const alreadyRegistered = normalizedMappings.every((mapping) => (
    existingByPath.get(mapping.candidateFieldPath)?.enabled === 1
  ))
  if (alreadyRegistered) {
    return {
      status: 'already-registered',
      candidateId: normalizedCandidateId,
      sourceId: context.source_id,
      rootRecordId,
      mappings: normalizedMappings.length,
      inserted: 0,
      planSha256,
    }
  }

  const mappingStatements = normalizedMappings.map((mapping) => statement(
    database,
    `INSERT INTO promotion_field_mappings (
       source_id, candidate_field_path, subject_record_id,
       canonical_field_path, locale, enabled, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     ON CONFLICT(source_id, candidate_field_path) DO UPDATE SET
       enabled = 1, updated_at = excluded.updated_at
     WHERE promotion_field_mappings.subject_record_id = excluded.subject_record_id
       AND promotion_field_mappings.canonical_field_path = excluded.canonical_field_path
       AND promotion_field_mappings.locale = excluded.locale`,
    context.source_id,
    mapping.candidateFieldPath,
    mapping.targetRecordId,
    mapping.canonicalFieldPath,
    mapping.locale,
    timestamp,
  ))
  const transformStatements = normalizedMappings.map((mapping) => statement(
    database,
    `INSERT INTO promotion_field_mapping_transforms (
       source_id, candidate_field_path, value_transform, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(source_id, candidate_field_path) DO UPDATE SET
       updated_at = excluded.updated_at
     WHERE promotion_field_mapping_transforms.value_transform = excluded.value_transform`,
    context.source_id,
    mapping.candidateFieldPath,
    mapping.valueTransform,
    timestamp,
  ))
  const statements = [...mappingStatements, ...transformStatements]
  statements.push(statement(
    database,
    `INSERT OR IGNORE INTO audit_log (
       id, occurred_at, actor_type, actor_id, action,
       subject_type, subject_id, after_json, correlation_id, detail
     ) VALUES (?1, ?2, 'worker', ?3, 'entity_promotion_mappings_registered',
               'entity_candidate', ?4, ?5, ?4, ?6)`,
    `audit-entity-mapping-${planSha256}`,
    timestamp,
    REGISTRAR_VERSION,
    normalizedCandidateId,
    stableJson({
      sourceId: context.source_id,
      rootRecordId,
      planSha256,
      mappings: normalizedMappings,
    }),
    'Trusted single-entity mapping plan registered; values remain gated by Publisher evidence validation',
  ))
  const results = await database.batch(statements)
  ensureBatch(results, 'register entity promotion mappings')

  const inserted = results.slice(0, normalizedMappings.length).reduce(
    (total, result) => total + Number(result.meta?.changes ?? 0),
    0,
  )
  return {
    status: 'registered',
    candidateId: normalizedCandidateId,
    sourceId: context.source_id,
    rootRecordId,
    mappings: normalizedMappings.length,
    inserted,
    planSha256,
  }
}
