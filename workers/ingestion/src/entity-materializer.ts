export {
  registerEntityPromotionFieldMappings,
  type EntityPromotionFieldMapping,
  type EntityPromotionMappingResult,
} from './entity-promotion-mappings'

import { sha256Hex, stableJson } from './hash'
import { assertSafeSourceUrl, validateManifest } from './security'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  SourceCategory,
  SourceManifestV1,
} from './types'

const MATERIALIZER_VERSION = 'entity-candidate-materializer/v1'
const DEFAULT_MINIMUM_CONFIDENCE_PPM = 980_000
const DEFAULT_REVIEW_DAYS = 30
const MAX_EVIDENCE_QUOTE_LENGTH = 1_000

class RetryableSourceConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableSourceConfigurationError'
  }
}

type EntityKind = 'program' | 'scholarship'
type DegreeLevel = 'bachelor' | 'master' | 'doctorate'
type ProgramType =
  | 'degree'
  | 'language'
  | 'foundation'
  | 'exchange'
  | 'visiting'
  | 'short_term'
  | 'other'
type SchemeType =
  | 'government'
  | 'university'
  | 'province'
  | 'city'
  | 'foundation'
  | 'other'
type LocatorType =
  | 'css'
  | 'xpath'
  | 'json_pointer'
  | 'pdf_page'
  | 'pdf_region'
  | 'text_offset'
  | 'manual'

type CandidateRow = {
  candidate_id: string
  institution_id: string
  entity_type: EntityKind
  entity_key: string
  source_id: string
  snapshot_id: string
  candidate_status: string
  facts_json: string
  evidence_json: string
  issues_json: string
  entity_sha256: string
  confidence_ppm: number | null
  created_at: string
  processed_at: string | null
  registered_at: string | null
  registry_id: string
  identity_sha256: string
  registry_status: string
  canonical_record_id: string | null
  reconciliation_id: string
  reconciliation_disposition: string
  manifest_json: string
  r2_key: string
  raw_sha256: string
  content_type: string
  byte_length: number
  final_url: string
  fetched_at: string
  source_document_id: string | null
  source_document_url: string | null
  source_document_official: number | null
  source_document_active: number | null
  source_document_authority: string | null
  source_document_publisher: string | null
}

type ExistingDecisionRow = {
  decision_status: 'materialized' | 'quarantined' | 'conflict'
  registry_id: string
  canonical_record_id: string | null
  reason_code: string | null
  issues_json: string
}

type ExistingRecordRow = {
  id: string
  public_id: string
  kind: string
  row_version: number
  workflow_status: string
}

type Evidence = {
  fieldPath: string
  quote: string
  locator: string | null
  officialUrl: string
}

type NormalizedCandidate = {
  row: CandidateRow
  manifest: SourceManifestV1
  name: string
  nameLocale: 'en' | 'zh'
  officialUrl: string
  checkedAt: string
  reviewAfter: string
  programType: ProgramType | null
  degreeLevel: DegreeLevel | null
  schemeType: SchemeType | null
  providerOrganizationId: string | null
  evidence: Evidence[]
  recordId: string
  slug: string
}

type CanonicalFact = {
  candidateFieldPath: string
  fieldPath: string
  locale: string
  valueType: 'localized_string' | 'url' | 'string'
  value: string
  riskClass: 'medium' | 'high' | 'critical'
  requiredForPublish: 0 | 1
  validationProfile: string
}

export type EntityMaterializationOptions = {
  minimumConfidencePpm?: number
  reviewDays?: number
  decidedAt?: string
}

export type EntityMaterializationResult = {
  candidateId: string
  registryId: string
  status:
    | 'materialized'
    | 'already-materialized'
    | 'quarantined'
    | 'conflict'
    | 'pending'
  recordId: string | null
  mappedFields: number
  reasonCode?: string
  issues?: string[]
}

export type EntityReleaseRequestResult = {
  status: 'requested' | 'already-requested'
  requestId: string
  releaseWindow: string
  publicationJobId: string
  catalogReleaseId: string
  outboxEventId: string
  candidateIds: string[]
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

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`)
  }
  return parsed as Record<string, unknown>
}

function parseArray(value: string, label: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`)
  return parsed
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be an ISO timestamp`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return date.toISOString()
}

function addReviewDays(checkedAt: string, reviewDays: number): string {
  const date = new Date(checkedAt)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + reviewDays)
  return date.toISOString().slice(0, 10)
}

function normalizedNameKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 380)
}

function nameLocale(value: string): 'en' | 'zh' {
  const han = value.match(/[\p{Script=Han}]/gu)?.length ?? 0
  const letters = value.match(/[\p{L}]/gu)?.length ?? 0
  return han > 0 && han * 2 >= Math.max(letters, 1) ? 'zh' : 'en'
}

function programIdentity(
  rawDegreeLevel: unknown,
  sourceCategory: SourceCategory,
): { programType: ProgramType; degreeLevel: DegreeLevel | null } {
  if (rawDegreeLevel === 'bachelor'
    || rawDegreeLevel === 'master'
    || rawDegreeLevel === 'doctorate') {
    return { programType: 'degree', degreeLevel: rawDegreeLevel }
  }
  if (rawDegreeLevel === 'language') {
    return { programType: 'language', degreeLevel: null }
  }
  if (rawDegreeLevel === 'foundation') {
    return { programType: 'foundation', degreeLevel: null }
  }
  if (rawDegreeLevel !== null && rawDegreeLevel !== undefined) {
    throw new Error(`unsupported degreeLevel ${String(rawDegreeLevel)}`)
  }
  const categoryLevels: Partial<Record<SourceCategory, DegreeLevel>> = {
    undergraduate_catalog: 'bachelor',
    masters_catalog: 'master',
    doctoral_catalog: 'doctorate',
  }
  const degreeLevel = categoryLevels[sourceCategory] ?? null
  return degreeLevel
    ? { programType: 'degree', degreeLevel }
    : { programType: 'other', degreeLevel: null }
}

function scholarshipScheme(sourceCategory: SourceCategory): SchemeType {
  if (sourceCategory === 'government_scholarship') return 'government'
  if (
    sourceCategory === 'university_scholarship'
    || sourceCategory === 'faculty_scholarship'
  ) return 'university'
  return 'other'
}

function locatorType(locator: string | null): LocatorType {
  if (!locator) return 'manual'
  if (locator.startsWith('css:')) return 'css'
  if (locator.startsWith('xpath:')) return 'xpath'
  if (locator.startsWith('json:') || locator.startsWith('/')) return 'json_pointer'
  if (/^page\s+\d+/iu.test(locator) || locator.startsWith('pdf:page=')) {
    return 'pdf_page'
  }
  return 'manual'
}

function normalizedEvidence(value: unknown, allowedHosts: string[]): Evidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('evidence_json must contain at least one evidence item')
  }
  const evidence = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`evidence_json[${index}] must be an object`)
    }
    const record = item as Record<string, unknown>
    if (typeof record.fieldPath !== 'string' || !record.fieldPath.trim()) {
      throw new Error(`evidence_json[${index}].fieldPath is required`)
    }
    if (
      typeof record.quote !== 'string'
      || !record.quote.trim()
      || record.quote.length > MAX_EVIDENCE_QUOTE_LENGTH
    ) {
      throw new Error(`evidence_json[${index}].quote is invalid`)
    }
    if (record.locator !== null && typeof record.locator !== 'string') {
      throw new Error(`evidence_json[${index}].locator must be a string or null`)
    }
    if (typeof record.officialUrl !== 'string') {
      throw new Error(`evidence_json[${index}].officialUrl is required`)
    }
    const url = assertSafeSourceUrl(record.officialUrl, allowedHosts)
    url.hash = ''
    return {
      fieldPath: record.fieldPath.trim(),
      quote: record.quote.trim(),
      locator: record.locator as string | null,
      officialUrl: url.href,
    }
  })
  if (!evidence.some((item) => item.fieldPath === 'name')) {
    throw new Error('entity name lacks field-level evidence')
  }
  return evidence
}

function canonicalFacts(candidate: NormalizedCandidate): CanonicalFact[] {
  const facts: CanonicalFact[] = [
    {
      candidateFieldPath: 'name',
      fieldPath: 'localized.name',
      locale: candidate.nameLocale,
      valueType: 'localized_string',
      value: candidate.name,
      riskClass: 'medium',
      requiredForPublish: 1,
      validationProfile: 'non-empty-text',
    },
    {
      candidateFieldPath: 'officialUrl',
      fieldPath: 'official_url',
      locale: '',
      valueType: 'url',
      value: candidate.officialUrl,
      riskClass: candidate.row.entity_type === 'scholarship' ? 'critical' : 'high',
      requiredForPublish: 1,
      validationProfile: 'official-https-url',
    },
  ]
  if (candidate.row.entity_type === 'program') {
    facts.push({
      candidateFieldPath: 'degreeLevel',
      fieldPath: 'program_type',
      locale: '',
      valueType: 'string',
      value: candidate.programType!,
      riskClass: 'high',
      requiredForPublish: 1,
      validationProfile: 'program-type',
    })
    if (candidate.degreeLevel) {
      facts.push({
        candidateFieldPath: 'degreeLevel',
        fieldPath: 'degree_level',
        locale: '',
        valueType: 'string',
        value: candidate.degreeLevel,
        riskClass: 'high',
        requiredForPublish: 0,
        validationProfile: 'degree-level',
      })
    }
  }
  return facts
}

async function loadCandidate(
  database: D1Database,
  candidateId: string,
): Promise<CandidateRow | null> {
  return database.prepare(
    `SELECT candidate.candidate_id, candidate.institution_id,
            candidate.entity_type, candidate.entity_key, candidate.source_id,
            candidate.snapshot_id, candidate.candidate_status,
            candidate.facts_json, candidate.evidence_json,
            candidate.issues_json, candidate.entity_sha256,
            candidate.confidence_ppm, candidate.created_at,
            candidate.processed_at, candidate.registered_at,
            registry.registry_id, registry.identity_sha256,
            registry.registry_status, registry.canonical_record_id,
            reconciliation.reconciliation_id,
            reconciliation.disposition AS reconciliation_disposition,
            source.manifest_json,
            snapshot.r2_key, snapshot.raw_sha256, snapshot.content_type,
            snapshot.byte_length, snapshot.final_url, snapshot.fetched_at,
            binding.source_document_id,
            document.canonical_url AS source_document_url,
            document.official AS source_document_official,
            document.active AS source_document_active,
            document.authority_level AS source_document_authority,
            document.publisher_organization_id AS source_document_publisher
       FROM extracted_entity_candidates candidate
       JOIN entity_registry registry
         ON registry.institution_id = candidate.institution_id
        AND registry.entity_type = candidate.entity_type
        AND registry.entity_key = candidate.entity_key
       JOIN catalog_reconciliation_items reconciliation
         ON reconciliation.candidate_id = candidate.candidate_id
       JOIN ingestion_sources source ON source.source_id = candidate.source_id
       JOIN ingestion_snapshots snapshot
         ON snapshot.snapshot_id = candidate.snapshot_id
        AND snapshot.source_id = candidate.source_id
       LEFT JOIN promotion_source_bindings binding
         ON binding.source_id = candidate.source_id AND binding.enabled = 1
       LEFT JOIN source_documents document
         ON document.id = binding.source_document_id
      WHERE candidate.candidate_id = ?1`,
  ).bind(candidateId).first<CandidateRow>()
}

async function loadDecision(
  database: D1Database,
  candidateId: string,
): Promise<ExistingDecisionRow | null> {
  return database.prepare(
    `SELECT decision_status, registry_id, canonical_record_id,
            reason_code, issues_json
       FROM entity_materialization_decisions WHERE candidate_id = ?1`,
  ).bind(candidateId).first<ExistingDecisionRow>()
}

function resultFromDecision(
  candidateId: string,
  decision: ExistingDecisionRow,
): EntityMaterializationResult {
  const issues = parseArray(decision.issues_json, 'decision.issues_json').map(String)
  return {
    candidateId,
    registryId: decision.registry_id,
    status: decision.decision_status === 'materialized'
      ? 'already-materialized'
      : decision.decision_status,
    recordId: decision.canonical_record_id,
    mappedFields: 0,
    ...(decision.reason_code ? { reasonCode: decision.reason_code } : {}),
    ...(issues.length > 0 ? { issues } : {}),
  }
}

async function normalizeCandidate(
  row: CandidateRow,
  reviewDays: number,
): Promise<NormalizedCandidate> {
  let manifest: SourceManifestV1
  try {
    manifest = validateManifest(JSON.parse(row.manifest_json) as SourceManifestV1)
  } catch (error) {
    throw new RetryableSourceConfigurationError(
      `source manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (manifest.id !== row.source_id || manifest.institutionId !== row.institution_id) {
    throw new RetryableSourceConfigurationError(
      'candidate does not match its source manifest identity',
    )
  }
  if (
    row.source_document_id === null
    || row.source_document_url === null
    || row.source_document_official !== 1
    || row.source_document_active !== 1
    || !['primary_official', 'secondary_official'].includes(
      row.source_document_authority ?? '',
    )
  ) {
    throw new RetryableSourceConfigurationError(
      'candidate source has no enabled official source binding',
    )
  }

  const allowedHosts = [
    ...manifest.allowedHosts,
    ...(manifest.allowedRedirectHosts ?? []),
  ]
  try {
    const manifestUrl = assertSafeSourceUrl(manifest.officialUrl, manifest.allowedHosts)
    const documentUrl = assertSafeSourceUrl(row.source_document_url, allowedHosts)
    manifestUrl.hash = ''
    documentUrl.hash = ''
    if (manifestUrl.href !== documentUrl.href) {
      throw new Error('source document URL differs from the source manifest URL')
    }
    assertSafeSourceUrl(row.final_url, allowedHosts)
  } catch (error) {
    throw new RetryableSourceConfigurationError(
      `source URL binding is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!row.r2_key.includes(row.raw_sha256)) {
    throw new RetryableSourceConfigurationError(
      'snapshot R2 key is not bound to its raw SHA-256',
    )
  }

  const facts = parseObject(row.facts_json, 'facts_json')
  if (typeof facts.name !== 'string' || facts.name.trim().length < 2) {
    throw new Error('facts_json.name must be a non-empty entity name')
  }
  const name = facts.name.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (name.length > 240) throw new Error('facts_json.name exceeds 240 characters')
  if (typeof facts.officialUrl !== 'string') {
    throw new Error('facts_json.officialUrl is required')
  }
  const officialUrlValue = assertSafeSourceUrl(facts.officialUrl, allowedHosts)
  officialUrlValue.hash = ''
  const officialUrl = officialUrlValue.href
  const checkedAt = isoTimestamp(facts.checkedAt, 'facts_json.checkedAt')
  if (checkedAt !== isoTimestamp(row.fetched_at, 'snapshot.fetched_at')) {
    throw new Error('candidate checkedAt differs from its immutable snapshot timestamp')
  }
  if (facts.sourceCategory !== manifest.sourceCategory) {
    throw new Error('facts_json.sourceCategory does not match the source manifest')
  }
  const evidence = normalizedEvidence(parseArray(row.evidence_json, 'evidence_json'), allowedHosts)
  if (evidence.some((item) => item.officialUrl !== officialUrl)) {
    throw new Error('evidence official URL differs from the candidate official URL')
  }

  let providerOrganizationId: string | null = null
  if (row.entity_type === 'scholarship') {
    if (manifest.sourceCategory === 'government_scholarship') {
      if (
        typeof facts.providerOrganizationId !== 'string'
        || !/^[a-z0-9][a-z0-9_-]{0,199}$/u.test(facts.providerOrganizationId)
      ) {
        throw new Error(
          'government scholarship requires an explicit providerOrganizationId',
        )
      }
      providerOrganizationId = facts.providerOrganizationId
    } else {
      providerOrganizationId = row.institution_id
    }
  }
  const allowedPublishers = new Set([
    row.institution_id,
    ...(providerOrganizationId ? [providerOrganizationId] : []),
  ])
  if (!row.source_document_publisher || !allowedPublishers.has(row.source_document_publisher)) {
    throw new RetryableSourceConfigurationError(
      'official source publisher does not own the candidate source',
    )
  }

  const rawDegreeLevel = facts.degreeLevel
  const identity = {
    institutionId: row.institution_id,
    entityType: row.entity_type,
    degreeLevel: rawDegreeLevel ?? null,
    normalizedName: name.toLocaleLowerCase('en-US'),
  }
  const identitySha256 = await sha256Hex(stableJson(identity))
  const expectedEntityKey = [
    rawDegreeLevel ?? 'all',
    normalizedNameKey(name),
    identitySha256.slice(0, 16),
  ].join(':')
  if (identitySha256 !== row.identity_sha256 || expectedEntityKey !== row.entity_key) {
    throw new Error('candidate identity conflicts with its stable registry identity')
  }
  const entitySha256 = await sha256Hex(stableJson({ facts, evidence }))
  if (entitySha256 !== row.entity_sha256) {
    throw new Error('candidate payload digest does not match its immutable entity digest')
  }

  const ownerIdentity = [
    row.entity_type, providerOrganizationId ?? row.institution_id, row.entity_key,
  ].join('\u0000')
  const recordHash = await sha256Hex(ownerIdentity)
  const program = row.entity_type === 'program'
    ? programIdentity(rawDegreeLevel, manifest.sourceCategory)
    : null
  return {
    row,
    manifest,
    name,
    nameLocale: nameLocale(name),
    officialUrl,
    checkedAt,
    reviewAfter: addReviewDays(checkedAt, reviewDays),
    programType: program?.programType ?? null,
    degreeLevel: program?.degreeLevel ?? null,
    schemeType: row.entity_type === 'scholarship'
      ? scholarshipScheme(manifest.sourceCategory)
      : null,
    providerOrganizationId,
    evidence,
    recordId: `${row.entity_type}-${recordHash}`,
    slug: `${row.entity_type}-${recordHash.slice(0, 24)}`,
  }
}

async function findIdentityConflict(
  database: D1Database,
  candidate: NormalizedCandidate,
): Promise<string | null> {
  const result = await database.prepare(
    `SELECT registry_id
       FROM entity_registry
      WHERE institution_id = ?1 AND entity_type = ?2
        AND identity_sha256 = ?3 AND registry_id <> ?4
      ORDER BY registry_id LIMIT 1`,
  ).bind(
    candidate.row.institution_id,
    candidate.row.entity_type,
    candidate.row.identity_sha256,
    candidate.row.registry_id,
  ).all<{ registry_id: string }>()
  ensureSuccess(result, 'load entity identity conflicts')
  return result.results?.[0]?.registry_id ?? null
}

async function requireProviderOrganization(
  database: D1Database,
  candidate: NormalizedCandidate,
): Promise<void> {
  if (!candidate.providerOrganizationId) return
  const provider = await database.prepare(
    `SELECT organization.record_id
       FROM organizations organization
       JOIN records record ON record.id = organization.record_id
      WHERE organization.record_id = ?1
        AND record.kind = 'organization'
        AND record.workflow_status IN ('applied', 'published')`,
  ).bind(candidate.providerOrganizationId).first<{ record_id: string }>()
  if (!provider) {
    throw new RetryableSourceConfigurationError(
      `provider organization ${candidate.providerOrganizationId} is not registered`,
    )
  }
}

async function loadExistingRecord(
  database: D1Database,
  recordId: string,
): Promise<ExistingRecordRow | null> {
  return database.prepare(
    `SELECT id, public_id, kind, row_version, workflow_status
       FROM records WHERE id = ?1`,
  ).bind(recordId).first<ExistingRecordRow>()
}

function isolationReason(error: unknown): { code: string; issue: string; conflict: boolean } {
  const issue = error instanceof Error ? error.message : String(error)
  const conflict = /conflict|differs|digest|identity/iu.test(issue)
  return {
    code: conflict ? 'entity_identity_conflict' : 'entity_candidate_invalid',
    issue,
    conflict,
  }
}

async function isolateCandidate(
  database: D1Database,
  row: CandidateRow,
  code: string,
  issues: string[],
  conflict: boolean,
  decidedAt: string,
): Promise<EntityMaterializationResult> {
  const normalizedIssues = [...new Set(issues.map((issue) => issue.trim()).filter(Boolean))]
  if (normalizedIssues.length === 0) normalizedIssues.push(code)
  const statements = [
    statement(
      database,
      `UPDATE extracted_entity_candidates
          SET candidate_status = 'quarantined',
              issues_json = ?2,
              processed_at = COALESCE(processed_at, ?3),
              registered_at = NULL
        WHERE candidate_id = ?1
          AND candidate_status IN ('extracted', 'validated', 'registered', 'quarantined')`,
      row.candidate_id,
      stableJson(normalizedIssues),
      decidedAt,
    ),
    statement(
      database,
      `UPDATE catalog_reconciliation_items
          SET disposition = 'unparseable', reason_code = ?2,
              reason_detail = ?3, reconciled_at = ?4,
              updated_at = ?4
        WHERE reconciliation_id = ?1 AND disposition = 'pending'`,
      row.reconciliation_id,
      code,
      normalizedIssues.join('; ').slice(0, 2_000),
      decidedAt,
    ),
    statement(
      database,
      `INSERT OR IGNORE INTO entity_materialization_decisions (
         candidate_id, registry_id, decision_status, canonical_record_id,
         reason_code, issues_json, confidence_ppm, materializer_version,
         decided_at, created_at
       ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?8)`,
      row.candidate_id,
      row.registry_id,
      conflict ? 'conflict' : 'quarantined',
      code,
      stableJson(normalizedIssues),
      row.confidence_ppm,
      MATERIALIZER_VERSION,
      decidedAt,
    ),
  ]
  try {
    ensureBatch(await database.batch(statements), 'isolate entity candidate')
  } catch (error) {
    const existing = await loadDecision(database, row.candidate_id)
    if (existing) return resultFromDecision(row.candidate_id, existing)
    throw error
  }
  return {
    candidateId: row.candidate_id,
    registryId: row.registry_id,
    status: conflict ? 'conflict' : 'quarantined',
    recordId: null,
    mappedFields: 0,
    reasonCode: code,
    issues: normalizedIssues,
  }
}

async function materializationStatements(
  database: D1Database,
  candidate: NormalizedCandidate,
  existingRecord: ExistingRecordRow | null,
  decidedAt: string,
): Promise<D1PreparedStatement[]> {
  const { row } = candidate
  const facts = canonicalFacts(candidate)
  const statements: D1PreparedStatement[] = []
  for (const fact of facts) {
    statements.push(statement(
      database,
      `INSERT INTO field_definitions (
         record_kind, field_path, value_type, risk_class,
         required_for_publish, max_age_days, validation_profile
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(record_kind, field_path) DO NOTHING`,
      row.entity_type,
      fact.fieldPath,
      fact.valueType,
      fact.riskClass,
      fact.requiredForPublish,
      DEFAULT_REVIEW_DAYS,
      fact.validationProfile,
    ))
  }

  const fetchId = `entity-fetch-${await sha256Hex(stableJson({
    sourceDocumentId: row.source_document_id,
    snapshotId: row.snapshot_id,
  }))}`
  statements.push(statement(
    database,
    `INSERT OR IGNORE INTO source_fetches (
       id, source_id, status, requested_at, completed_at, http_status,
       content_type, content_length, sha256, artifact_uri,
       parser_key, parser_version, metadata_json
     ) VALUES (
       ?1, ?2, 'succeeded', ?3, ?3, 200, ?4, ?5, ?6, ?7,
       'entity-candidate-materializer', '1', ?8
     )`,
    fetchId,
    row.source_document_id,
    row.fetched_at,
    row.content_type,
    row.byte_length,
    row.raw_sha256,
    `r2://studyinchina-source-snapshots/${row.r2_key}`,
    stableJson({
      ingestionSourceId: row.source_id,
      ingestionSnapshotId: row.snapshot_id,
      finalUrl: row.final_url,
    }),
  ))

  const fragmentIds: string[] = []
  for (const evidence of candidate.evidence) {
    const locator = evidence.locator ?? `entity:${evidence.fieldPath}`
    const fragmentId = `fragment-${await sha256Hex(stableJson({
      fetchId,
      locator,
      quote: evidence.quote,
    }))}`
    fragmentIds.push(fragmentId)
    statements.push(statement(
      database,
      `INSERT OR IGNORE INTO source_fragments (
         id, fetch_id, locator_type, locator, page_number,
         text_excerpt, sha256, created_at
       ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)`,
      fragmentId,
      fetchId,
      locatorType(evidence.locator),
      locator,
      evidence.quote,
      await sha256Hex(evidence.quote),
      row.fetched_at,
    ))
  }

  const nextVersion = existingRecord ? existingRecord.row_version + 1 : 1
  if (existingRecord) {
    statements.push(statement(
      database,
      `UPDATE records
          SET slug = ?2, review_after = ?3,
              workflow_status = CASE
                WHEN workflow_status = 'published' THEN 'published'
                ELSE 'applied'
              END,
              row_version = row_version + 1, updated_at = ?4
        WHERE id = ?1 AND row_version = ?5 AND kind = ?6`,
      candidate.recordId,
      candidate.slug,
      candidate.reviewAfter,
      decidedAt,
      existingRecord.row_version,
      row.entity_type,
    ))
  } else {
    statements.push(statement(
      database,
      `INSERT INTO records (
         id, public_id, kind, slug, workflow_status, review_after,
         row_version, created_at, updated_at
       ) VALUES (?1, ?1, ?2, ?3, 'applied', ?4, 1, ?5, ?5)`,
      candidate.recordId,
      row.entity_type,
      candidate.slug,
      candidate.reviewAfter,
      decidedAt,
    ))
  }
  statements.push(statement(
    database,
    `INSERT OR IGNORE INTO record_slugs (
       record_id, slug, valid_from, valid_to, is_current
     ) VALUES (?1, ?2, ?3, NULL, 1)`,
    candidate.recordId,
    candidate.slug,
    decidedAt,
  ))

  if (row.entity_type === 'program') {
    statements.push(statement(
      database,
      `INSERT INTO programs (
         record_id, institution_id, academic_unit_id, parent_program_id,
         program_type, degree_level, credential_type, attendance_mode,
         delivery_mode, duration_min, duration_max, duration_unit,
         official_url
       ) VALUES (
         ?1, ?2, NULL, NULL, ?3, ?4, NULL, 'full_time',
         'on_campus', NULL, NULL, NULL, ?5
       )
       ON CONFLICT(record_id) DO UPDATE SET
         institution_id = excluded.institution_id,
         program_type = excluded.program_type,
         degree_level = excluded.degree_level,
         official_url = excluded.official_url`,
      candidate.recordId,
      row.institution_id,
      candidate.programType,
      candidate.degreeLevel,
      candidate.officialUrl,
    ))
  } else {
    statements.push(statement(
      database,
      `INSERT INTO scholarships (
         record_id, provider_organization_id, scheme_type, official_url
       ) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(record_id) DO UPDATE SET
         provider_organization_id = excluded.provider_organization_id,
         scheme_type = excluded.scheme_type,
         official_url = excluded.official_url`,
      candidate.recordId,
      candidate.providerOrganizationId,
      candidate.schemeType,
      candidate.officialUrl,
    ))
  }
  statements.push(statement(
    database,
    `INSERT INTO localized_content (
       record_id, locale, field_name, text_value,
       translation_status, source_locale, updated_at
     ) VALUES (?1, ?2, 'name', ?3, 'published', ?2, ?4)
     ON CONFLICT(record_id, locale, field_name) DO UPDATE SET
       text_value = excluded.text_value,
       translation_status = 'published',
       source_locale = excluded.source_locale,
       updated_at = excluded.updated_at`,
    candidate.recordId,
    candidate.nameLocale,
    candidate.name,
    decidedAt,
  ))

  for (const fact of facts) {
    const claimId = `claim-${await sha256Hex(stableJson({
      candidateId: row.candidate_id,
      fieldPath: fact.fieldPath,
      locale: fact.locale,
      value: fact.value,
    }))}`
    statements.push(statement(
      database,
      `INSERT OR IGNORE INTO claims (
         id, subject_record_id, field_path, locale, value_type,
         raw_value_text, normalized_value_json, confidence,
         extraction_method, extractor_version, claim_status,
         provenance_precision, discovered_at, decided_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
         'selector', ?9, 'candidate', 'field', ?10, NULL
       )`,
      claimId,
      candidate.recordId,
      fact.fieldPath,
      fact.locale,
      fact.valueType,
      fact.value,
      stableJson(fact.value),
      Number(row.confidence_ppm) / 1_000_000,
      MATERIALIZER_VERSION,
      candidate.checkedAt,
    ))
    for (const fragmentId of [...new Set(fragmentIds)].sort()) {
      statements.push(statement(
        database,
        `INSERT OR IGNORE INTO claim_evidence (
           claim_id, fragment_id, evidence_role
         ) VALUES (?1, ?2, 'primary')`,
        claimId,
        fragmentId,
      ))
    }
    statements.push(
      statement(
        database,
        `UPDATE claims SET claim_status = 'validated'
          WHERE id = ?1 AND claim_status = 'candidate'`,
        claimId,
      ),
      statement(
        database,
        `UPDATE claims SET claim_status = 'accepted', decided_at = ?2
          WHERE id = ?1 AND claim_status = 'validated'`,
        claimId,
        decidedAt,
      ),
      statement(
        database,
        `INSERT INTO canonical_fields (
           subject_record_id, field_path, locale, field_status,
           claim_id, value_json, verified_at, review_after, updated_at
         ) VALUES (?1, ?2, ?3, 'accepted', ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(subject_record_id, field_path, locale) DO UPDATE SET
           field_status = 'accepted', claim_id = excluded.claim_id,
           value_json = excluded.value_json, verified_at = excluded.verified_at,
           review_after = excluded.review_after, updated_at = excluded.updated_at`,
        candidate.recordId,
        fact.fieldPath,
        fact.locale,
        claimId,
        stableJson(fact.value),
        candidate.checkedAt,
        candidate.reviewAfter,
        decidedAt,
      ),
      statement(
        database,
        `UPDATE claims SET claim_status = 'superseded', decided_at = ?5
          WHERE subject_record_id = ?1 AND field_path = ?2 AND locale = ?3
            AND claim_status = 'accepted' AND id <> ?4`,
        candidate.recordId,
        fact.fieldPath,
        fact.locale,
        claimId,
        decidedAt,
      ),
    )
  }

  statements.push(
    statement(
      database,
      `INSERT INTO record_versions (
         id, record_id, version, snapshot_json, change_set_id,
         changed_by, change_reason, changed_at
       ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)`,
      `record-version-${await sha256Hex(stableJson({
        candidateId: row.candidate_id,
        recordId: candidate.recordId,
        version: nextVersion,
      }))}`,
      candidate.recordId,
      nextVersion,
      stableJson({
        name: candidate.name,
        officialUrl: candidate.officialUrl,
        programType: candidate.programType,
        degreeLevel: candidate.degreeLevel,
        schemeType: candidate.schemeType,
        providerOrganizationId: candidate.providerOrganizationId,
      }),
      MATERIALIZER_VERSION,
      'source-backed entity candidate materialization',
      decidedAt,
    ),
    statement(
      database,
      `UPDATE extracted_entity_candidates
          SET candidate_status = 'registered',
              processed_at = COALESCE(processed_at, ?2),
              registered_at = COALESCE(registered_at, ?2),
              issues_json = '[]'
        WHERE candidate_id = ?1
          AND candidate_status IN ('validated', 'registered')`,
      row.candidate_id,
      decidedAt,
    ),
    statement(
      database,
      `UPDATE entity_registry
          SET registry_status = 'active', canonical_record_id = ?2,
              updated_at = ?3
        WHERE registry_id = ?1
          AND registry_status IN ('pending', 'active')
          AND (canonical_record_id IS NULL OR canonical_record_id = ?2)`,
      row.registry_id,
      candidate.recordId,
      decidedAt,
    ),
    statement(
      database,
      `UPDATE catalog_reconciliation_items
          SET disposition = 'published', entity_key = ?2,
              candidate_id = ?3, registry_id = ?4,
              reason_code = NULL, reason_detail = NULL,
              reconciled_at = ?5, updated_at = ?5
        WHERE reconciliation_id = ?1 AND disposition IN ('pending', 'published')`,
      row.reconciliation_id,
      row.entity_key,
      row.candidate_id,
      row.registry_id,
      decidedAt,
    ),
    statement(
      database,
      `INSERT OR IGNORE INTO entity_materialization_decisions (
         candidate_id, registry_id, decision_status, canonical_record_id,
         reason_code, issues_json, confidence_ppm, materializer_version,
         decided_at, created_at
       ) VALUES (?1, ?2, 'materialized', ?3, NULL, '[]', ?4, ?5, ?6, ?6)`,
      row.candidate_id,
      row.registry_id,
      candidate.recordId,
      row.confidence_ppm,
      MATERIALIZER_VERSION,
      decidedAt,
    ),
  )
  for (const fact of facts) {
    statements.push(statement(
      database,
      `INSERT OR IGNORE INTO entity_candidate_field_mappings (
         candidate_id, candidate_field_path, registry_id, source_id,
         subject_record_id, canonical_field_path, locale, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      row.candidate_id,
      fact.candidateFieldPath,
      row.registry_id,
      row.source_id,
      candidate.recordId,
      fact.fieldPath,
      fact.locale,
      decidedAt,
    ))
  }
  statements.push(statement(
    database,
    `INSERT OR IGNORE INTO audit_log (
       id, occurred_at, actor_type, actor_id, action,
       subject_type, subject_id, after_json, correlation_id, detail
     ) VALUES (?1, ?2, 'worker', ?3, 'entity_materialized',
               ?4, ?5, ?6, ?7, ?8)`,
    `audit-${await sha256Hex(`entity-materialized\u0000${row.candidate_id}`)}`,
    decidedAt,
    MATERIALIZER_VERSION,
    row.entity_type,
    candidate.recordId,
    stableJson({
      candidateId: row.candidate_id,
      registryId: row.registry_id,
      mappedFields: facts.length,
    }),
    row.candidate_id,
    'Official directory entity passed deterministic materialization gates',
  ))
  return statements
}

export async function materializeExtractedEntityCandidate(
  database: D1Database,
  candidateId: string,
  options: EntityMaterializationOptions = {},
): Promise<EntityMaterializationResult> {
  const existingDecision = await loadDecision(database, candidateId)
  if (existingDecision) return resultFromDecision(candidateId, existingDecision)

  const row = await loadCandidate(database, candidateId)
  if (!row) throw new Error(`entity candidate ${candidateId} does not exist or lacks registry/reconciliation state`)
  if (row.candidate_status === 'extracted') {
    return {
      candidateId,
      registryId: row.registry_id,
      status: 'pending',
      recordId: null,
      mappedFields: 0,
      reasonCode: 'candidate_not_validated',
    }
  }
  const decidedAt = isoTimestamp(options.decidedAt ?? new Date().toISOString(), 'decidedAt')
  const minimumConfidence = options.minimumConfidencePpm
    ?? DEFAULT_MINIMUM_CONFIDENCE_PPM
  if (!Number.isInteger(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1_000_000) {
    throw new Error('minimumConfidencePpm must be an integer from 0 to 1000000')
  }
  const reviewDays = options.reviewDays ?? DEFAULT_REVIEW_DAYS
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 365) {
    throw new Error('reviewDays must be an integer from 1 to 365')
  }
  const persistedIssues = parseArray(row.issues_json, 'issues_json').map(String)
  if (
    row.candidate_status === 'quarantined'
    || row.confidence_ppm === null
    || row.confidence_ppm < minimumConfidence
    || persistedIssues.length > 0
  ) {
    const issues = [
      ...persistedIssues,
      ...(row.confidence_ppm === null
        ? ['candidate confidence is missing']
        : row.confidence_ppm < minimumConfidence
          ? [`candidate confidence ${row.confidence_ppm} is below ${minimumConfidence}`]
          : []),
    ]
    return isolateCandidate(
      database,
      row,
      row.confidence_ppm === null || row.confidence_ppm < minimumConfidence
        ? 'entity_confidence_below_threshold'
        : 'entity_candidate_has_issues',
      issues,
      false,
      decidedAt,
    )
  }
  if (!['validated', 'registered'].includes(row.candidate_status)) {
    throw new Error(`entity candidate ${candidateId} has terminal status ${row.candidate_status}`)
  }

  let candidate: NormalizedCandidate
  try {
    candidate = await normalizeCandidate(row, reviewDays)
  } catch (error) {
    if (error instanceof RetryableSourceConfigurationError) throw error
    const isolation = isolationReason(error)
    return isolateCandidate(
      database,
      row,
      isolation.code,
      [isolation.issue],
      isolation.conflict,
      decidedAt,
    )
  }
  await requireProviderOrganization(database, candidate)
  const conflictingRegistryId = await findIdentityConflict(database, candidate)
  if (conflictingRegistryId) {
    return isolateCandidate(
      database,
      row,
      'entity_identity_conflict',
      [
        `entity identity conflicts with registry ${conflictingRegistryId}`,
      ],
      true,
      decidedAt,
    )
  }

  const existingRecord = await loadExistingRecord(database, candidate.recordId)
  if (existingRecord && (
    existingRecord.public_id !== candidate.recordId
    || existingRecord.kind !== row.entity_type
    || (row.canonical_record_id !== null && row.canonical_record_id !== candidate.recordId)
  )) {
    return isolateCandidate(
      database,
      row,
      'canonical_record_identity_conflict',
      ['deterministic canonical record identity collides with an incompatible record'],
      true,
      decidedAt,
    )
  }

  const statements = await materializationStatements(
    database,
    candidate,
    existingRecord,
    decidedAt,
  )
  try {
    ensureBatch(await database.batch(statements), 'materialize entity candidate')
  } catch (error) {
    const decision = await loadDecision(database, candidateId)
    if (decision) return resultFromDecision(candidateId, decision)
    throw error
  }
  return {
    candidateId,
    registryId: row.registry_id,
    status: 'materialized',
    recordId: candidate.recordId,
    mappedFields: canonicalFacts(candidate).length,
  }
}

export async function requestEntityMaterializationRelease(
  database: D1Database,
  candidateIds: string[],
  requestedAt = new Date().toISOString(),
): Promise<EntityReleaseRequestResult> {
  const normalizedRequestedAt = isoTimestamp(requestedAt, 'requestedAt')
  const releaseWindow = normalizedRequestedAt.slice(0, 10)
  const normalizedCandidateIds = [...new Set(candidateIds.map((value) => value.trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (normalizedCandidateIds.length === 0) {
    throw new Error('candidateIds must contain at least one materialized candidate')
  }
  const digest = await sha256Hex(stableJson({
    releaseWindow,
    candidateIds: normalizedCandidateIds,
  }))
  const requestId = `entity-materialization-${digest.slice(0, 40)}`
  const publicationJobId = `entity-publication-${releaseWindow}-${digest.slice(0, 24)}`
  const catalogReleaseId = `catalog-entity-${releaseWindow}-${digest.slice(0, 24)}`
  const outboxEventId = `entity-release-event-${releaseWindow}-${digest.slice(0, 24)}`
  const candidateIdsJson = stableJson(normalizedCandidateIds)
  const payloadJson = stableJson({
    version: 1,
    entityMaterializationRequestId: requestId,
    publicationJobId,
    catalogReleaseId,
    releaseWindow,
    candidateIds: normalizedCandidateIds,
  })
  const result = await statement(
    database,
    `INSERT OR IGNORE INTO entity_materialization_release_requests (
       request_id, release_window, publication_job_id, catalog_release_id,
       outbox_event_id, candidate_ids_json, payload_json,
       requested_at, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    requestId,
    releaseWindow,
    publicationJobId,
    catalogReleaseId,
    outboxEventId,
    candidateIdsJson,
    payloadJson,
    normalizedRequestedAt,
  ).run()
  ensureSuccess(result, 'request entity materialization release')
  if (Number(result.meta?.changes ?? 0) > 0) {
    return {
      status: 'requested',
      requestId,
      releaseWindow,
      publicationJobId,
      catalogReleaseId,
      outboxEventId,
      candidateIds: normalizedCandidateIds,
    }
  }
  const existing = await database.prepare(
    `SELECT request_id, publication_job_id, catalog_release_id,
            outbox_event_id, candidate_ids_json
       FROM entity_materialization_release_requests
      WHERE release_window = ?1`,
  ).bind(releaseWindow).first<{
    request_id: string
    publication_job_id: string
    catalog_release_id: string
    outbox_event_id: string
    candidate_ids_json: string
  }>()
  if (!existing) throw new Error('entity materialization release insert was ignored without an existing window')
  return {
    status: 'already-requested',
    requestId: existing.request_id,
    releaseWindow,
    publicationJobId: existing.publication_job_id,
    catalogReleaseId: existing.catalog_release_id,
    outboxEventId: existing.outbox_event_id,
    candidateIds: parseArray(existing.candidate_ids_json, 'candidate_ids_json').map(String),
  }
}
