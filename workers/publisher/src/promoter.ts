import { sha256Hex, stableJson } from '../../ingestion/src/hash'
import {
  candidateFieldEvidence,
  miniMaxExtractorFingerprint,
  miniMaxPromptFingerprint,
  ruleExtractorFingerprint,
} from '../../ingestion/src/provenance'
import { isFieldValueValid } from '../../ingestion/src/rules'
import { validateManifest } from '../../ingestion/src/security'
import type {
  CandidateFieldEvidence,
  Evidence,
  ExtractionEnvelope,
  ExtractionFact,
  SourceManifestV1,
} from '../../ingestion/src/types'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  PromotionResult,
} from './types'

const HEX_64 = /^[a-f0-9]{64}$/
const MAX_FACTS_PER_CANDIDATE = 100
const APPLY_LEASE_MS = 5 * 60 * 1_000

type CandidateRow = {
  candidate_id: string
  source_id: string
  snapshot_id: string
  extractor: 'rules' | 'minimax-dual'
  gate_status: 'rule-pass' | 'dual-pass' | 'quarantined'
  candidate_status: 'extracted' | 'validated' | 'quarantined' | 'applied'
  facts_json: string
  issues_json: string
  schema_version: string | null
  model_name: string | null
  prompt_fingerprint: string | null
  extractor_fingerprint: string | null
  primary_extraction_json: string | null
  secondary_extraction_json: string | null
  field_evidence_json: string | null
  contains_critical: number | null
  created_at: string
  manifest_json: string
  r2_key: string
  raw_sha256: string
  canonical_sha256: string
  content_type: string
  byte_length: number
  final_url: string
  fetched_at: string
  source_document_id: string | null
  source_official: number | null
  source_active: number | null
  authority_level: string | null
}

type PromotionRow = {
  promotion_status: 'applying' | 'applied' | 'quarantined'
  publication_job_id: string | null
  lease_expires_at: string | null
}

type MappingRow = {
  candidate_field_path: string
  subject_record_id: string
  canonical_field_path: string
  locale: string
  record_kind: string
  workflow_status: string
  row_version: number
  value_type: string
  risk_class: 'low' | 'medium' | 'high' | 'critical'
  max_age_days: number | null
  previous_claim_id: string | null
  previous_value_json: string | null
}

type CanonicalRow = {
  field_path: string
  locale: string
  value_json: string | null
}

type ValidCandidate = {
  row: CandidateRow
  manifest: SourceManifestV1
  facts: ExtractionFact[]
  evidence: CandidateFieldEvidence[]
  primary: ExtractionEnvelope | null
  secondary: ExtractionEnvelope | null
}

type PlannedFact = {
  fact: ExtractionFact
  evidence: CandidateFieldEvidence
  mapping: MappingRow
  claimId: string
  primaryFragmentId: string
  secondaryFragmentId: string | null
  reviewAfter: string
}

type PlannedRecord = {
  recordId: string
  expectedVersion: number
  nextVersion: number
  reviewAfter: string
  changeSetId: string
  maxRisk: MappingRow['risk_class']
  facts: PlannedFact[]
  snapshotJson: string
  diffJson: string
}

type PromotionPlan = {
  candidate: ValidCandidate
  token: string
  fetchId: string
  publicationJobId: string
  catalogReleaseId: string
  outboxEventId: string
  records: PlannedRecord[]
  facts: PlannedFact[]
}

class UnsafeCandidateError extends Error {
  constructor(
    readonly code: string,
    readonly issues: string[],
  ) {
    super(issues.join('; '))
    this.name = 'UnsafeCandidateError'
  }
}

function unsafe(code: string, issue: string | string[]): never {
  throw new UnsafeCandidateError(code, Array.isArray(issue) ? issue : [issue])
}

function ensureSuccess(result: D1Result, operation: string): void {
  if (!result.success) throw new Error(`${operation} failed: ${result.error ?? 'unknown D1 error'}`)
}

function ensureBatch(results: D1Result[], operation: string): void {
  for (const result of results) ensureSuccess(result, operation)
}

function parseJson(value: string | null, label: string): unknown {
  if (value === null) unsafe('candidate_provenance_missing', `${label} is missing`)
  try {
    return JSON.parse(value)
  } catch {
    return unsafe('candidate_provenance_invalid', `${label} is invalid JSON`)
  }
}

function isEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  return typeof evidence.quote === 'string'
    && evidence.quote.trim().length > 0
    && evidence.quote.length <= 1_000
    && (evidence.locator === undefined || typeof evidence.locator === 'string')
}

function isFact(value: unknown): value is ExtractionFact {
  if (!value || typeof value !== 'object') return false
  const fact = value as Record<string, unknown>
  return typeof fact.fieldPath === 'string'
    && fact.fieldPath.length > 0
    && Object.hasOwn(fact, 'value')
    && isEvidence(fact.evidence)
}

function isEnvelope(value: unknown): value is ExtractionEnvelope {
  if (!value || typeof value !== 'object') return false
  const envelope = value as Record<string, unknown>
  return typeof envelope.schemaVersion === 'string'
    && typeof envelope.sourceId === 'string'
    && Array.isArray(envelope.facts)
    && envelope.facts.every(isFact)
}

function isFieldEvidence(value: unknown): value is CandidateFieldEvidence {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.fieldPath === 'string'
    && isEvidence(item.primary)
    && (item.secondary === null || isEvidence(item.secondary))
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue)
  }
  return false
}

function valueMatchesDefinition(valueType: string, value: unknown): boolean {
  switch (valueType) {
    case 'string':
    case 'localized_string':
      return typeof value === 'string' && value.trim().length > 0
    case 'integer':
    case 'decimal_minor':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    case 'url': {
      if (typeof value !== 'string') return false
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password
      } catch {
        return false
      }
    }
    case 'identifier':
      return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value)
    case 'json':
      return isJsonValue(value)
    default:
      return false
  }
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime()) || !Number.isInteger(days) || days <= 0) {
    unsafe('freshness_policy_invalid', 'A valid fetched_at and positive max_age_days are required')
  }
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function riskRank(risk: MappingRow['risk_class']): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[risk]
}

function maximumRisk(rows: PlannedFact[]): MappingRow['risk_class'] {
  return rows.reduce<MappingRow['risk_class']>(
    (maximum, item) => riskRank(item.mapping.risk_class) > riskRank(maximum)
      ? item.mapping.risk_class
      : maximum,
    'low',
  )
}

async function deterministicId(prefix: string, value: unknown): Promise<string> {
  return `${prefix}-${await sha256Hex(stableJson(value))}`
}

async function loadCandidate(database: D1Database, candidateId: string): Promise<CandidateRow | null> {
  return database.prepare(
    `SELECT c.candidate_id, c.source_id, c.snapshot_id, c.extractor,
            c.gate_status, c.candidate_status, c.facts_json, c.issues_json,
            provenance.schema_version, provenance.model_name,
            provenance.prompt_fingerprint, provenance.extractor_fingerprint,
            provenance.primary_extraction_json,
            provenance.secondary_extraction_json,
            provenance.field_evidence_json, provenance.contains_critical,
            c.created_at, s.manifest_json,
            snap.r2_key, snap.raw_sha256, snap.canonical_sha256,
            snap.content_type, snap.byte_length, snap.final_url, snap.fetched_at,
            binding.source_document_id,
            document.official AS source_official,
            document.active AS source_active,
            document.authority_level
       FROM ingestion_candidates c
       JOIN ingestion_sources s ON s.source_id = c.source_id
       JOIN ingestion_snapshots snap
         ON snap.snapshot_id = c.snapshot_id AND snap.source_id = c.source_id
       LEFT JOIN ingestion_candidate_provenance provenance
         ON provenance.candidate_id = c.candidate_id
       LEFT JOIN promotion_source_bindings binding
         ON binding.source_id = c.source_id AND binding.enabled = 1
       LEFT JOIN source_documents document ON document.id = binding.source_document_id
      WHERE c.candidate_id = ?1`,
  ).bind(candidateId).first<CandidateRow>()
}

async function loadPromotion(database: D1Database, candidateId: string): Promise<PromotionRow | null> {
  return database.prepare(
    `SELECT promotion_status, publication_job_id, lease_expires_at
       FROM candidate_promotions WHERE candidate_id = ?1`,
  ).bind(candidateId).first<PromotionRow>()
}

async function loadMappings(database: D1Database, sourceId: string): Promise<MappingRow[]> {
  const result = await database.prepare(
    `SELECT mapping.candidate_field_path, mapping.subject_record_id,
            mapping.canonical_field_path, mapping.locale,
            record.kind AS record_kind, record.workflow_status, record.row_version,
            definition.value_type, definition.risk_class, definition.max_age_days,
            current.claim_id AS previous_claim_id,
            current.value_json AS previous_value_json
       FROM promotion_field_mappings mapping
       JOIN records record ON record.id = mapping.subject_record_id
       JOIN field_definitions definition
         ON definition.record_kind = record.kind
        AND definition.field_path = mapping.canonical_field_path
       LEFT JOIN canonical_fields current
         ON current.subject_record_id = mapping.subject_record_id
        AND current.field_path = mapping.canonical_field_path
        AND current.locale = mapping.locale
      WHERE mapping.source_id = ?1 AND mapping.enabled = 1`,
  ).bind(sourceId).all<MappingRow>()
  ensureSuccess(result, 'load promotion mappings')
  return result.results ?? []
}

async function loadCanonicalSnapshot(
  database: D1Database,
  recordId: string,
): Promise<CanonicalRow[]> {
  const result = await database.prepare(
    `SELECT field_path, locale, value_json
       FROM canonical_fields
      WHERE subject_record_id = ?1 AND field_status = 'accepted'`,
  ).bind(recordId).all<CanonicalRow>()
  ensureSuccess(result, 'load canonical snapshot')
  return result.results ?? []
}

async function validateCandidate(row: CandidateRow): Promise<ValidCandidate> {
  if (row.gate_status === 'quarantined' || row.candidate_status === 'quarantined') {
    unsafe('candidate_quarantined', 'A quarantined candidate can never be promoted')
  }
  if (row.candidate_status !== 'validated') {
    unsafe('candidate_not_validated', `Candidate status is ${row.candidate_status}`)
  }
  if (
    row.source_document_id === null
    || row.source_official !== 1
    || row.source_active !== 1
    || !['primary_official', 'secondary_official'].includes(row.authority_level ?? '')
  ) {
    unsafe('official_source_binding_missing', 'Candidate source has no enabled official promotion binding')
  }

  let manifest: SourceManifestV1
  try {
    manifest = validateManifest(JSON.parse(row.manifest_json) as SourceManifestV1)
  } catch (error) {
    unsafe('source_manifest_invalid', error instanceof Error ? error.message : String(error))
  }
  if (manifest.id !== row.source_id || row.schema_version !== manifest.extraction.schemaVersion) {
    unsafe('candidate_schema_mismatch', 'Candidate source or schema version differs from its manifest')
  }

  const factsValue = parseJson(row.facts_json, 'facts_json')
  if (!Array.isArray(factsValue) || !factsValue.every(isFact)) {
    unsafe('candidate_facts_invalid', 'facts_json is not an extraction fact array')
  }
  const facts = factsValue as ExtractionFact[]
  if (facts.length === 0 || facts.length > MAX_FACTS_PER_CANDIDATE) {
    unsafe('candidate_fact_count_invalid', `Candidate must contain 1-${MAX_FACTS_PER_CANDIDATE} facts`)
  }
  const fieldPaths = new Set<string>()
  const manifestFields = new Map(manifest.extraction.fields.map((field) => [field.path, field]))
  for (const fact of facts) {
    if (fieldPaths.has(fact.fieldPath)) unsafe('candidate_facts_invalid', `Duplicate fact ${fact.fieldPath}`)
    fieldPaths.add(fact.fieldPath)
    const field = manifestFields.get(fact.fieldPath)
    if (!field || !isFieldValueValid(field, fact.value)) {
      unsafe('candidate_facts_invalid', `Fact ${fact.fieldPath} is absent from or invalid for the manifest`)
    }
  }

  const evidenceValue = parseJson(row.field_evidence_json, 'field_evidence_json')
  if (!Array.isArray(evidenceValue) || !evidenceValue.every(isFieldEvidence)) {
    unsafe('candidate_evidence_invalid', 'field_evidence_json is invalid')
  }
  const evidence = evidenceValue as CandidateFieldEvidence[]
  if (evidence.length !== facts.length || new Set(evidence.map((item) => item.fieldPath)).size !== facts.length) {
    unsafe('candidate_evidence_invalid', 'Every fact must have exactly one field evidence record')
  }

  const containsCritical = manifest.extraction.fields.some((field) => field.critical === true)
  if (row.contains_critical !== (containsCritical ? 1 : 0)) {
    unsafe('candidate_criticality_mismatch', 'Persisted criticality differs from the source manifest')
  }
  if (!row.extractor_fingerprint || !HEX_64.test(row.extractor_fingerprint)) {
    unsafe('candidate_fingerprint_invalid', 'Extractor fingerprint is missing or invalid')
  }

  let primary: ExtractionEnvelope | null = null
  let secondary: ExtractionEnvelope | null = null
  if (row.extractor === 'rules') {
    if (row.gate_status !== 'rule-pass' || containsCritical) {
      unsafe('rule_promotion_not_allowed', 'Rule promotion is allowed only for noncritical fields')
    }
    const expected = await ruleExtractorFingerprint(manifest)
    if (expected !== row.extractor_fingerprint) {
      unsafe('candidate_fingerprint_mismatch', 'Rule extractor fingerprint does not match the manifest')
    }
    if (row.model_name !== null || row.prompt_fingerprint !== null) {
      unsafe('candidate_provenance_invalid', 'Rule candidates cannot carry model prompt provenance')
    }
  } else {
    if (row.gate_status !== 'dual-pass' || !row.model_name || !row.prompt_fingerprint) {
      unsafe('dual_promotion_not_allowed', 'MiniMax promotion requires a complete dual-pass candidate')
    }
    const primaryValue = parseJson(row.primary_extraction_json, 'primary_extraction_json')
    const secondaryValue = parseJson(row.secondary_extraction_json, 'secondary_extraction_json')
    if (!isEnvelope(primaryValue) || !isEnvelope(secondaryValue)) {
      unsafe('candidate_provenance_invalid', 'Dual extraction envelopes are invalid')
    }
    primary = primaryValue
    secondary = secondaryValue
    if (
      primary.sourceId !== row.source_id
      || secondary.sourceId !== row.source_id
      || primary.schemaVersion !== row.schema_version
      || secondary.schemaVersion !== row.schema_version
    ) {
      unsafe('candidate_provenance_invalid', 'Dual extraction envelope identity mismatch')
    }
    const expectedPrompt = await miniMaxPromptFingerprint(manifest)
    const expectedExtractor = await miniMaxExtractorFingerprint(
      manifest,
      row.model_name,
      expectedPrompt,
    )
    if (row.prompt_fingerprint !== expectedPrompt || row.extractor_fingerprint !== expectedExtractor) {
      unsafe('candidate_fingerprint_mismatch', 'MiniMax prompt or extractor fingerprint mismatch')
    }
    const expectedEvidence = candidateFieldEvidence(facts, primary, secondary)
    if (stableJson(expectedEvidence) !== stableJson(evidence)) {
      unsafe('candidate_evidence_invalid', 'Persisted field evidence differs from the dual extractions')
    }
    const primaryValues = new Map(primary.facts.map((fact) => [fact.fieldPath, stableJson(fact.value)]))
    const secondaryValues = new Map(secondary.facts.map((fact) => [fact.fieldPath, stableJson(fact.value)]))
    if (primaryValues.size !== facts.length || secondaryValues.size !== facts.length) {
      unsafe('candidate_dual_disagreement', 'Dual extraction field coverage differs from candidate facts')
    }
    for (const fact of facts) {
      const value = stableJson(fact.value)
      if (primaryValues.get(fact.fieldPath) !== value || secondaryValues.get(fact.fieldPath) !== value) {
        unsafe('candidate_dual_disagreement', `Dual values do not match candidate fact ${fact.fieldPath}`)
      }
    }
  }

  if (row.extractor === 'rules') {
    const expectedEvidence = candidateFieldEvidence(facts, null, null)
    if (stableJson(expectedEvidence) !== stableJson(evidence)) {
      unsafe('candidate_evidence_invalid', 'Persisted rule evidence differs from candidate facts')
    }
  }
  return { row, manifest, facts, evidence, primary, secondary }
}

async function buildPlan(
  database: D1Database,
  candidate: ValidCandidate,
): Promise<PromotionPlan> {
  const mappings = await loadMappings(database, candidate.row.source_id)
  const byField = new Map(mappings.map((mapping) => [mapping.candidate_field_path, mapping]))
  const byEvidence = new Map(candidate.evidence.map((item) => [item.fieldPath, item]))
  const canonicalTargets = new Set<string>()
  const facts: PlannedFact[] = []
  for (const fact of candidate.facts) {
    const mapping = byField.get(fact.fieldPath)
    if (!mapping) unsafe('field_mapping_missing', `No exact promotion mapping for ${fact.fieldPath}`)
    if (['quarantined', 'archived', 'rejected'].includes(mapping.workflow_status)) {
      unsafe('target_record_blocked', `Target record ${mapping.subject_record_id} is ${mapping.workflow_status}`)
    }
    if (!valueMatchesDefinition(mapping.value_type, fact.value)) {
      unsafe(
        'canonical_type_mismatch',
        `${fact.fieldPath} cannot be safely stored as ${mapping.value_type}`,
      )
    }
    if (mapping.max_age_days === null) {
      unsafe('freshness_policy_missing', `${mapping.record_kind}.${mapping.canonical_field_path} has no max_age_days`)
    }
    const evidence = byEvidence.get(fact.fieldPath)
    if (!evidence) unsafe('candidate_evidence_invalid', `Evidence missing for ${fact.fieldPath}`)
    if (candidate.row.extractor === 'minimax-dual' && evidence.secondary === null) {
      unsafe('candidate_evidence_invalid', `Secondary evidence missing for ${fact.fieldPath}`)
    }
    const targetKey = `${mapping.subject_record_id}\u0000${mapping.canonical_field_path}\u0000${mapping.locale}`
    if (canonicalTargets.has(targetKey)) {
      unsafe('field_mapping_ambiguous', `Multiple facts target ${mapping.canonical_field_path}`)
    }
    canonicalTargets.add(targetKey)
    const idBasis = {
      candidateId: candidate.row.candidate_id,
      fieldPath: fact.fieldPath,
      targetKey,
    }
    facts.push({
      fact,
      evidence,
      mapping,
      claimId: await deterministicId('claim', idBasis),
      primaryFragmentId: await deterministicId('fragment-primary', idBasis),
      secondaryFragmentId: evidence.secondary
        ? await deterministicId('fragment-secondary', idBasis)
        : null,
      reviewAfter: addDays(candidate.row.fetched_at, mapping.max_age_days),
    })
  }

  const grouped = new Map<string, PlannedFact[]>()
  for (const fact of facts) {
    const group = grouped.get(fact.mapping.subject_record_id) ?? []
    group.push(fact)
    grouped.set(fact.mapping.subject_record_id, group)
  }
  const records: PlannedRecord[] = []
  for (const [recordId, recordFacts] of grouped) {
    const current = await loadCanonicalSnapshot(database, recordId)
    const snapshot = new Map(
      current.map((item) => [
        `${item.field_path}\u0000${item.locale}`,
        item.value_json === null ? null : JSON.parse(item.value_json),
      ]),
    )
    for (const item of recordFacts) {
      snapshot.set(
        `${item.mapping.canonical_field_path}\u0000${item.mapping.locale}`,
        item.fact.value,
      )
    }
    const mapping = recordFacts[0]!.mapping
    const changeSetId = await deterministicId('change-set', {
      candidateId: candidate.row.candidate_id,
      recordId,
    })
    const reviewAfter = recordFacts
      .map((item) => item.reviewAfter)
      .sort()[0]!
    const fields = [...snapshot.entries()]
      .map(([key, value]) => {
        const [fieldPath, locale] = key.split('\u0000')
        return { fieldPath, locale, value }
      })
      .sort((left, right) => `${left.fieldPath}:${left.locale}`.localeCompare(`${right.fieldPath}:${right.locale}`))
    const diff = recordFacts.map((item) => ({
      candidateFieldPath: item.fact.fieldPath,
      fieldPath: item.mapping.canonical_field_path,
      locale: item.mapping.locale,
      previous: item.mapping.previous_value_json === null
        ? null
        : JSON.parse(item.mapping.previous_value_json),
      value: item.fact.value,
      claimId: item.claimId,
    }))
    records.push({
      recordId,
      expectedVersion: Number(mapping.row_version),
      nextVersion: Number(mapping.row_version) + 1,
      reviewAfter,
      changeSetId,
      maxRisk: maximumRisk(recordFacts),
      facts: recordFacts,
      snapshotJson: stableJson({ recordId, fields }),
      diffJson: stableJson(diff),
    })
  }
  records.sort((left, right) => left.recordId.localeCompare(right.recordId))

  const basis = { candidateId: candidate.row.candidate_id }
  return {
    candidate,
    token: crypto.randomUUID(),
    fetchId: await deterministicId('source-fetch', { snapshotId: candidate.row.snapshot_id }),
    publicationJobId: await deterministicId('publication-job', basis),
    catalogReleaseId: await deterministicId('catalog-release', basis),
    outboxEventId: await deterministicId('outbox', basis),
    records,
    facts,
  }
}

async function acquirePromotion(
  database: D1Database,
  plan: PromotionPlan,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString()
  const leaseExpiresAt = new Date(now.getTime() + APPLY_LEASE_MS).toISOString()
  const result = await database.prepare(
    `INSERT INTO candidate_promotions (
       candidate_id, promotion_status, promotion_token, lease_expires_at,
       change_set_ids_json, created_at, updated_at
     ) VALUES (?1, 'applying', ?2, ?3, '[]', ?4, ?4)
     ON CONFLICT(candidate_id) DO UPDATE SET
       promotion_token = excluded.promotion_token,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = excluded.updated_at
     WHERE candidate_promotions.promotion_status = 'applying'
       AND candidate_promotions.lease_expires_at <= ?4`,
  ).bind(plan.candidate.row.candidate_id, plan.token, leaseExpiresAt, nowIso).run()
  ensureSuccess(result, 'acquire candidate promotion')
  return Number(result.meta?.changes ?? 0) > 0
}

function prepared(database: D1Database, sql: string, ...values: unknown[]): D1PreparedStatement {
  return database.prepare(sql).bind(...values)
}

function rawValue(value: unknown): string {
  return typeof value === 'string' ? value : stableJson(value)
}

async function applyPlan(database: D1Database, plan: PromotionPlan, now: Date): Promise<void> {
  const nowIso = now.toISOString()
  const candidate = plan.candidate.row
  const sourceDocumentId = candidate.source_document_id!
  const fragmentRows: Array<Record<string, unknown>> = []
  const claimRows: Array<Record<string, unknown>> = []
  const evidenceRows: Array<Record<string, unknown>> = []
  const canonicalRows: Array<Record<string, unknown>> = []
  const changeSetClaimRows: Array<Record<string, unknown>> = []
  const previousClaimIds = new Set<string>()

  for (const item of plan.facts) {
    fragmentRows.push({
      id: item.primaryFragmentId,
      fetchId: plan.fetchId,
      locator: item.evidence.primary.locator ?? `candidate:${item.fact.fieldPath}:primary`,
      textExcerpt: item.evidence.primary.quote,
      sha256: await sha256Hex(item.evidence.primary.quote),
    })
    evidenceRows.push({
      claimId: item.claimId,
      fragmentId: item.primaryFragmentId,
      role: 'primary',
    })
    if (item.secondaryFragmentId && item.evidence.secondary) {
      fragmentRows.push({
        id: item.secondaryFragmentId,
        fetchId: plan.fetchId,
        locator: item.evidence.secondary.locator ?? `candidate:${item.fact.fieldPath}:secondary`,
        textExcerpt: item.evidence.secondary.quote,
        sha256: await sha256Hex(item.evidence.secondary.quote),
      })
      evidenceRows.push({
        claimId: item.claimId,
        fragmentId: item.secondaryFragmentId,
        role: 'corroborating',
      })
    }
    claimRows.push({
      id: item.claimId,
      subjectRecordId: item.mapping.subject_record_id,
      fieldPath: item.mapping.canonical_field_path,
      locale: item.mapping.locale,
      valueType: item.mapping.value_type,
      rawValueText: rawValue(item.fact.value),
      normalizedValueJson: stableJson(item.fact.value),
      extractionMethod: candidate.extractor === 'rules' ? 'selector' : 'llm',
      extractorVersion: candidate.extractor_fingerprint,
      discoveredAt: candidate.created_at,
      decidedAt: nowIso,
    })
    canonicalRows.push({
      subjectRecordId: item.mapping.subject_record_id,
      fieldPath: item.mapping.canonical_field_path,
      locale: item.mapping.locale,
      claimId: item.claimId,
      valueJson: stableJson(item.fact.value),
      verifiedAt: candidate.fetched_at,
      reviewAfter: item.reviewAfter,
      updatedAt: nowIso,
    })
    const record = plan.records.find((entry) => entry.recordId === item.mapping.subject_record_id)!
    changeSetClaimRows.push({ changeSetId: record.changeSetId, claimId: item.claimId })
    if (item.mapping.previous_claim_id && item.mapping.previous_claim_id !== item.claimId) {
      previousClaimIds.add(item.mapping.previous_claim_id)
    }
  }

  const changeSetRows = plan.records.map((record) => ({
    id: record.changeSetId,
    subjectRecordId: record.recordId,
    baseRowVersion: record.expectedVersion,
    maxRisk: record.maxRisk,
    diffJson: record.diffJson,
    createdAt: nowIso,
  }))
  const recordRows = plan.records.map((record) => ({
    id: record.recordId,
    expectedVersion: record.expectedVersion,
    nextVersion: record.nextVersion,
    reviewAfter: record.reviewAfter,
    changedAt: nowIso,
    changeSetId: record.changeSetId,
    versionId: `record-version-${record.changeSetId}`,
    snapshotJson: record.snapshotJson,
  }))
  const changeSetIds = plan.records.map((record) => record.changeSetId)
  const publicationPayload = {
    version: 1,
    publicationJobId: plan.publicationJobId,
    catalogReleaseId: plan.catalogReleaseId,
    candidateId: candidate.candidate_id,
    changeSetIds,
  }
  const provenanceMetadata = stableJson({
    candidateId: candidate.candidate_id,
    schemaVersion: candidate.schema_version,
    model: candidate.model_name,
    promptFingerprint: candidate.prompt_fingerprint,
    extractorFingerprint: candidate.extractor_fingerprint,
  })

  const statements = [
    prepared(
      database,
      `INSERT OR IGNORE INTO source_fetches (
         id, source_id, status, requested_at, completed_at, http_status,
         content_type, content_length, sha256, artifact_uri,
         parser_key, parser_version, metadata_json
       ) VALUES (?1, ?2, 'succeeded', ?3, ?3, 200, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      plan.fetchId,
      sourceDocumentId,
      candidate.fetched_at,
      candidate.content_type,
      candidate.byte_length,
      candidate.raw_sha256,
      `r2://${candidate.r2_key}`,
      candidate.extractor,
      candidate.extractor_fingerprint,
      provenanceMetadata,
    ),
    prepared(
      database,
      `INSERT INTO change_sets (
         id, subject_record_id, base_row_version, change_status,
         max_risk, diff_json, created_at, updated_at
       )
       SELECT json_extract(value, '$.id'),
              json_extract(value, '$.subjectRecordId'),
              json_extract(value, '$.baseRowVersion'),
              'validated', json_extract(value, '$.maxRisk'),
              json_extract(value, '$.diffJson'),
              json_extract(value, '$.createdAt'), json_extract(value, '$.createdAt')
       FROM json_each(?1)`,
      stableJson(changeSetRows),
    ),
    prepared(
      database,
      `INSERT INTO source_fragments (
         id, fetch_id, locator_type, locator, text_excerpt, sha256, created_at
       )
       SELECT json_extract(value, '$.id'), json_extract(value, '$.fetchId'),
              'text_offset', json_extract(value, '$.locator'),
              json_extract(value, '$.textExcerpt'), json_extract(value, '$.sha256'), ?2
       FROM json_each(?1)`,
      stableJson(fragmentRows),
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO claims (
         id, subject_record_id, field_path, locale, value_type,
         raw_value_text, normalized_value_json, confidence,
         extraction_method, extractor_version, claim_status,
         provenance_precision, discovered_at, decided_at
       )
       SELECT json_extract(value, '$.id'), json_extract(value, '$.subjectRecordId'),
              json_extract(value, '$.fieldPath'), json_extract(value, '$.locale'),
              json_extract(value, '$.valueType'), json_extract(value, '$.rawValueText'),
              json_extract(value, '$.normalizedValueJson'), 1.0,
              json_extract(value, '$.extractionMethod'),
              json_extract(value, '$.extractorVersion'), 'candidate', 'field',
              json_extract(value, '$.discoveredAt'), json_extract(value, '$.decidedAt')
       FROM json_each(?1)`,
      stableJson(claimRows),
    ),
    prepared(
      database,
      `INSERT INTO claim_evidence (claim_id, fragment_id, evidence_role)
       SELECT json_extract(value, '$.claimId'), json_extract(value, '$.fragmentId'),
              json_extract(value, '$.role')
       FROM json_each(?1)`,
      stableJson(evidenceRows),
    ),
    prepared(
      database,
      `UPDATE claims SET claim_status = 'validated', decided_at = ?2
       WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
      stableJson(claimRows),
      nowIso,
    ),
    prepared(
      database,
      `UPDATE claims SET claim_status = 'accepted', decided_at = ?2
       WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
      stableJson(claimRows),
      nowIso,
    ),
    prepared(
      database,
      `UPDATE claims SET claim_status = 'superseded', decided_at = ?2
       WHERE claim_status = 'accepted'
         AND id IN (SELECT value FROM json_each(?1))`,
      stableJson([...previousClaimIds]),
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO canonical_fields (
         subject_record_id, field_path, locale, field_status, claim_id,
         value_json, verified_at, review_after, updated_at
       )
       SELECT json_extract(value, '$.subjectRecordId'),
              json_extract(value, '$.fieldPath'), json_extract(value, '$.locale'),
              'accepted', json_extract(value, '$.claimId'),
              json_extract(value, '$.valueJson'), json_extract(value, '$.verifiedAt'),
              json_extract(value, '$.reviewAfter'), json_extract(value, '$.updatedAt')
       FROM json_each(?1) WHERE 1
       ON CONFLICT(subject_record_id, field_path, locale) DO UPDATE SET
         field_status = excluded.field_status,
         claim_id = excluded.claim_id,
         value_json = excluded.value_json,
         verified_at = excluded.verified_at,
         review_after = excluded.review_after,
         updated_at = excluded.updated_at`,
      stableJson(canonicalRows),
    ),
    prepared(
      database,
      `INSERT INTO change_set_claims (change_set_id, claim_id)
       SELECT json_extract(value, '$.changeSetId'), json_extract(value, '$.claimId')
       FROM json_each(?1)`,
      stableJson(changeSetClaimRows),
    ),
    prepared(
      database,
      `UPDATE records
          SET workflow_status = 'applied',
              review_after = (
                SELECT MIN(field.review_after)
                FROM canonical_fields field
                WHERE field.subject_record_id = records.id
                  AND field.field_status = 'accepted'
              ),
              row_version = row_version + 1,
              updated_at = ?2
        WHERE EXISTS (
          SELECT 1 FROM json_each(?1)
          WHERE json_extract(value, '$.id') = records.id
            AND json_extract(value, '$.expectedVersion') = records.row_version
        )`,
      stableJson(recordRows),
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO record_versions (
         id, record_id, version, snapshot_json, change_set_id,
         changed_by, change_reason, changed_at
       )
       SELECT json_extract(value, '$.versionId'), json_extract(value, '$.id'),
              json_extract(value, '$.nextVersion'), json_extract(value, '$.snapshotJson'),
              json_extract(value, '$.changeSetId'), 'publisher-worker',
              'automatic validated candidate promotion', json_extract(value, '$.changedAt')
       FROM json_each(?1)`,
      stableJson(recordRows),
    ),
    prepared(
      database,
      `UPDATE change_sets SET change_status = 'applied', applied_at = ?2, updated_at = ?2
       WHERE id IN (SELECT value FROM json_each(?1)) AND change_status = 'validated'`,
      stableJson(changeSetIds),
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO publication_jobs (
         id, catalog_release_id, job_status, source_change_set_ids_json, created_at
       ) VALUES (?1, ?2, 'queued', ?3, ?4)`,
      plan.publicationJobId,
      plan.catalogReleaseId,
      stableJson(changeSetIds),
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO outbox_events (
         id, event_type, aggregate_id, payload_json, event_status,
         attempt_count, available_at, created_at
       ) VALUES (?1, 'catalog.release.requested', ?2, ?3, 'pending', 0, ?4, ?4)`,
      plan.outboxEventId,
      plan.publicationJobId,
      stableJson(publicationPayload),
      nowIso,
    ),
    prepared(
      database,
      `UPDATE candidate_promotions
          SET promotion_status = 'applied', promotion_token = NULL,
              lease_expires_at = NULL, change_set_ids_json = ?3,
              publication_job_id = ?4, updated_at = ?5, applied_at = ?5
        WHERE candidate_id = ?1 AND promotion_status = 'applying'
          AND promotion_token = ?2`,
      candidate.candidate_id,
      plan.token,
      stableJson(changeSetIds),
      plan.publicationJobId,
      nowIso,
    ),
    prepared(
      database,
      `UPDATE ingestion_candidates
          SET candidate_status = 'applied', applied_at = ?2
        WHERE candidate_id = ?1 AND candidate_status = 'validated'`,
      candidate.candidate_id,
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO audit_log (
         id, occurred_at, actor_type, actor_id, action,
         subject_type, subject_id, after_json, correlation_id, detail
       ) VALUES (?1, ?2, 'worker', 'publisher-worker', 'candidate.promoted',
                 'ingestion_candidate', ?3, ?4, ?3,
                 'automatic deterministic promotion')`,
      await deterministicId('audit', { candidateId: candidate.candidate_id, action: 'promoted' }),
      nowIso,
      candidate.candidate_id,
      stableJson(publicationPayload),
    ),
  ]
  const results = await database.batch(statements)
  ensureBatch(results, 'apply candidate promotion transaction')
  const promotionResult = results.at(-3)
  const candidateResult = results.at(-2)
  if (
    Number(promotionResult?.meta?.changes ?? 0) !== 1
    || Number(candidateResult?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error('Promotion lease or candidate status changed during apply')
  }
}

export async function isolateCandidate(
  database: D1Database,
  candidateId: string,
  code: string,
  issues: string[],
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString()
  const detail = issues.join('; ').slice(0, 4_000)
  const statements = [
    prepared(
      database,
      `UPDATE ingestion_candidates
          SET candidate_status = 'quarantined'
        WHERE candidate_id = ?1 AND candidate_status IN ('extracted', 'validated', 'quarantined')`,
      candidateId,
    ),
    prepared(
      database,
      `INSERT INTO candidate_promotions (
         candidate_id, promotion_status, change_set_ids_json,
         error_code, error_detail, created_at, updated_at
       ) VALUES (?1, 'quarantined', '[]', ?2, ?3, ?4, ?4)
       ON CONFLICT(candidate_id) DO UPDATE SET
         promotion_status = 'quarantined', promotion_token = NULL,
         lease_expires_at = NULL, error_code = excluded.error_code,
         error_detail = excluded.error_detail, updated_at = excluded.updated_at
       WHERE candidate_promotions.promotion_status <> 'applied'`,
      candidateId,
      code,
      detail,
      nowIso,
    ),
    prepared(
      database,
      `INSERT INTO promotion_isolations (candidate_id, reason_code, issues_json, isolated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(candidate_id) DO UPDATE SET
         reason_code = excluded.reason_code,
         issues_json = excluded.issues_json,
         isolated_at = excluded.isolated_at`,
      candidateId,
      code,
      stableJson(issues),
      nowIso,
    ),
  ]
  ensureBatch(await database.batch(statements), 'isolate unsafe candidate')
}

export async function promoteCandidate(
  database: D1Database,
  candidateId: string,
  now = new Date(),
): Promise<PromotionResult> {
  const existing = await loadPromotion(database, candidateId)
  if (existing?.promotion_status === 'applied') {
    return {
      candidateId,
      status: 'already-applied',
      publicationJobId: existing.publication_job_id ?? undefined,
    }
  }
  if (existing?.promotion_status === 'quarantined') {
    return { candidateId, status: 'quarantined' }
  }

  const row = await loadCandidate(database, candidateId)
  if (!row) throw new Error(`Candidate not found: ${candidateId}`)

  let plan: PromotionPlan
  try {
    const candidate = await validateCandidate(row)
    plan = await buildPlan(database, candidate)
  } catch (error) {
    if (!(error instanceof UnsafeCandidateError)) throw error
    await isolateCandidate(database, candidateId, error.code, error.issues, now)
    return { candidateId, status: 'quarantined', reasonCode: error.code }
  }

  if (!(await acquirePromotion(database, plan, now))) {
    const current = await loadPromotion(database, candidateId)
    if (current?.promotion_status === 'applied') {
      return {
        candidateId,
        status: 'already-applied',
        publicationJobId: current.publication_job_id ?? undefined,
      }
    }
    if (current?.promotion_status === 'quarantined') {
      return { candidateId, status: 'quarantined' }
    }
    return { candidateId, status: 'busy' }
  }

  try {
    await applyPlan(database, plan, now)
  } catch (error) {
    const committed = await loadPromotion(database, candidateId)
    if (committed?.promotion_status === 'applied') {
      return {
        candidateId,
        status: 'applied',
        publicationJobId: committed.publication_job_id ?? plan.publicationJobId,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    await isolateCandidate(
      database,
      candidateId,
      'promotion_transaction_failed',
      [message],
      now,
    )
    return {
      candidateId,
      status: 'quarantined',
      reasonCode: 'promotion_transaction_failed',
    }
  }
  return {
    candidateId,
    status: 'applied',
    publicationJobId: plan.publicationJobId,
  }
}
