import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type JsonObject = Record<string, unknown>
export type BatchPurpose = 'catalog_entities' | 'dependencies'
type RecordKind = 'program' | 'scholarship' | 'organization' | 'location'

export type OfficialEntityRecordMapping = {
  recordId: string
  recordKind: RecordKind
}

export type OfficialEntitySourceArtifact = {
  sourceId: string
  fetchId: string
  localPath: string
  artifactSha256: string
  artifactUri: string
  contentType: string
  byteLength: number
  capturedAt: string
  isFixture: false
  captureMode: 'live'
}

export type ValidatedOfficialEntityManifest = {
  batchId: string
  materializerVersion: string
  provenanceStatus: 'complete'
  batchPurpose: BatchPurpose
  generatedAt: string
  contentSha256: string
  sqlPath: string
  counts: {
    records: number
    programs: number
    scholarships: number
    organizations: number
    locations: number
    claims: number
    canonicalFields: number
    sourceDocuments: number
    sourceFragments: number
    programCycles: 0
    scholarshipCycles: 0
  }
  recordMappings: OfficialEntityRecordMapping[]
  sourceArtifacts: OfficialEntitySourceArtifact[]
  sourceManifestSha256: string
  raw: JsonObject
}

export type SqlChunk = {
  chunkNumber: number
  chunkSha256: string
  statementCount: number
  payloadBytes: number
  transportBytes: number
  path: string
}

export type OfficialEntityImportPackageManifest = {
  format: 'studyinchina.pipeline.materialization-import-package'
  formatVersion: 1
  generatedAt: string
  batchId: string
  packageDigest: string
  materializerVersion: string
  provenanceStatus: 'complete'
  sourceManifestPath: string
  batchPurpose: BatchPurpose
  sourceManifestSha256: string
  sourceSqlPath: string
  sourceSqlSha256: string
  counts: ValidatedOfficialEntityManifest['counts']
  recordMappings: OfficialEntityRecordMapping[]
  sourceArtifacts: OfficialEntitySourceArtifact[]
  transports: {
    file: {
      expectedChunks: 1
      chunks: [SqlChunk]
    }
    commandChunks: {
      expectedChunks: number
      maxTransportBytes: number
      chunks: SqlChunk[]
    }
  }
  finalizationSqlPath: string
  verificationSqlPath: string
}

type PackageOptions = {
  manifestPath: string
  outputDirectory: string
  remote: boolean
  maxCommandBytes?: number
}

type ChunkPayload = {
  statements: string[]
  payload: string
  sha256: string
  statementCount: number
  payloadBytes: number
}

export type VerifiedOfficialEntityChunk = {
  batchId: string
  packageDigest: string
  chunkNumber: number
  chunkSha256: string
  statementCount: number
  payloadBytes: number
  transportBytes: number
}

const PACKAGE_FORMAT = 'studyinchina.pipeline.materialization-import-package'
const DEFAULT_MAX_COMMAND_BYTES = 22_000
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const BATCH_R2_PREFIX = 'r2://studyinchina-source-snapshots/'
const FORBIDDEN_REMOTE_PATH = /(?:^|[\\/])(?:tests?[\\/]fixtures?|fixtures?)(?:[\\/]|$)|(?:^|[\\/])[^\\/]*fixture[^\\/]*(?:[\\/]|$)/iu

function sha256Bytes(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

export type OfficialEntityPackageDigestInput = {
  materializerVersion: string
  batchPurpose: BatchPurpose
  sourceSqlSha256: string
  counts: ValidatedOfficialEntityManifest['counts']
  recordMappings: OfficialEntityRecordMapping[]
  sourceArtifacts: OfficialEntitySourceArtifact[]
}

export function computeOfficialEntityPackageDigest(
  input: OfficialEntityPackageDigestInput,
): string {
  const recordMappings = [...input.recordMappings].sort((left, right) => (
    left.recordId.localeCompare(right.recordId, 'en')
      || left.recordKind.localeCompare(right.recordKind, 'en')
  ))
  const sourceArtifacts = input.sourceArtifacts.map((artifact) => ({
    sourceId: artifact.sourceId,
    fetchId: artifact.fetchId,
    artifactSha256: artifact.artifactSha256,
    artifactUri: artifact.artifactUri,
    contentType: artifact.contentType,
    byteLength: artifact.byteLength,
    capturedAt: artifact.capturedAt,
    isFixture: artifact.isFixture,
    captureMode: artifact.captureMode,
  })).sort((left, right) => (
    left.sourceId.localeCompare(right.sourceId, 'en')
      || left.fetchId.localeCompare(right.fetchId, 'en')
  ))
  return sha256Bytes(stableJson({
    materializerVersion: input.materializerVersion,
    batchPurpose: input.batchPurpose,
    sourceSqlSha256: input.sourceSqlSha256,
    counts: input.counts,
    recordMappings,
    sourceArtifacts,
  }))
}

function sqlValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('SQL integer must be safe')
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function asCount(value: unknown, label: string, allowZero = true): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} integer`)
  }
  return value
}

function asIsoTimestamp(value: unknown, label: string): string {
  const text = asString(value, label)
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return date.toISOString()
}

function resolveManifestPath(value: string, manifestPath: string): string {
  if (value.startsWith('file://')) return fileURLToPath(value)
  if (isAbsolute(value)) return resolve(value)
  return resolve(dirname(manifestPath), value)
}

function sourceArtifactKey(uri: string): string {
  if (!uri.startsWith(BATCH_R2_PREFIX)) {
    throw new Error(
      `source artifact URI must use private bucket ${BATCH_R2_PREFIX}`,
    )
  }
  const key = uri.slice(BATCH_R2_PREFIX.length)
  if (
    !key
    || key.startsWith('/')
    || key.includes('\\')
    || key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`source artifact URI has an unsafe R2 key: ${uri}`)
  }
  return key
}

function validateRecordMappings(
  value: unknown,
  expectedRecords: number,
  expectedPrograms: number,
  expectedScholarships: number,
  expectedOrganizations: number,
  expectedLocations: number,
): OfficialEntityRecordMapping[] {
  if (!Array.isArray(value)) {
    throw new Error('recordMappings is required for a strict materialization import')
  }
  const seen = new Set<string>()
  const mappings = value.map((item, index) => {
    const mapping = asObject(item, `recordMappings[${index}]`)
    const recordId = asString(mapping.recordId, `recordMappings[${index}].recordId`)
    const recordKind = asString(
      mapping.recordKind,
      `recordMappings[${index}].recordKind`,
    )
    if (![
      'program', 'scholarship', 'organization', 'location',
    ].includes(recordKind)) {
      throw new Error(`recordMappings[${index}].recordKind is unsupported`)
    }
    if (seen.has(recordId)) {
      throw new Error(`recordMappings contains duplicate record ${recordId}`)
    }
    seen.add(recordId)
    return { recordId, recordKind: recordKind as RecordKind }
  })
  const programs = mappings.filter((item) => item.recordKind === 'program').length
  const scholarships = mappings.filter((item) => item.recordKind === 'scholarship').length
  const organizations = mappings.filter((item) => item.recordKind === 'organization').length
  const locations = mappings.filter((item) => item.recordKind === 'location').length
  if (
    mappings.length !== expectedRecords
    || programs !== expectedPrograms
    || scholarships !== expectedScholarships
    || organizations !== expectedOrganizations
    || locations !== expectedLocations
  ) {
    throw new Error('recordMappings does not match manifest record counts')
  }
  return mappings.sort((left, right) => (
    left.recordId.localeCompare(right.recordId, 'en')
  ))
}

function validateSourceArtifacts(
  value: unknown,
  manifestPath: string,
  expectedSources: number,
  remote: boolean,
): OfficialEntitySourceArtifact[] {
  if (!Array.isArray(value)) {
    throw new Error('sourceArtifacts is required for a strict materialization import')
  }
  const sourceIds = new Set<string>()
  const fetchIds = new Set<string>()
  const uris = new Set<string>()
  const artifacts = value.map((item, index) => {
    const artifact = asObject(item, `sourceArtifacts[${index}]`)
    const sourceId = asString(artifact.sourceId, `sourceArtifacts[${index}].sourceId`)
    const fetchId = asString(artifact.fetchId, `sourceArtifacts[${index}].fetchId`)
    const localPathValue = asString(
      artifact.localPath,
      `sourceArtifacts[${index}].localPath`,
    )
    const localPath = resolveManifestPath(localPathValue, manifestPath)
    const artifactSha256 = asString(
      artifact.artifactSha256,
      `sourceArtifacts[${index}].artifactSha256`,
    ).toLowerCase()
    if (!SHA256_PATTERN.test(artifactSha256)) {
      throw new Error(`sourceArtifacts[${index}].artifactSha256 must be lowercase SHA-256`)
    }
    const artifactUri = asString(
      artifact.artifactUri,
      `sourceArtifacts[${index}].artifactUri`,
    )
    const artifactKey = sourceArtifactKey(artifactUri)
    if (!artifactKey.includes(artifactSha256)) {
      throw new Error(
        `sourceArtifacts[${index}].artifactUri must contain the full artifact SHA-256`,
      )
    }
    const contentType = asString(
      artifact.contentType,
      `sourceArtifacts[${index}].contentType`,
    )
    const byteLength = asCount(
      artifact.byteLength,
      `sourceArtifacts[${index}].byteLength`,
    )
    const capturedAt = asIsoTimestamp(
      artifact.capturedAt,
      `sourceArtifacts[${index}].capturedAt`,
    )
    if (artifact.isFixture !== false) {
      throw new Error(`sourceArtifacts[${index}] must explicitly set isFixture=false`)
    }
    if (artifact.captureMode !== 'live') {
      throw new Error(`sourceArtifacts[${index}] must have captureMode="live"`)
    }
    if (!existsSync(localPath) || !statSync(localPath).isFile()) {
      throw new Error(`source artifact file does not exist: ${localPath}`)
    }
    if (remote && (
      FORBIDDEN_REMOTE_PATH.test(localPath)
      || FORBIDDEN_REMOTE_PATH.test(localPathValue)
    )) {
      throw new Error(`remote import rejects fixture source artifact: ${localPath}`)
    }
    const bytes = readFileSync(localPath)
    if (bytes.length !== byteLength) {
      throw new Error(`source artifact byte length mismatch: ${localPath}`)
    }
    if (sha256Bytes(bytes) !== artifactSha256) {
      throw new Error(`source artifact SHA-256 mismatch: ${localPath}`)
    }
    if (sourceIds.has(sourceId)) {
      throw new Error(`sourceArtifacts contains duplicate sourceId ${sourceId}`)
    }
    if (fetchIds.has(fetchId)) {
      throw new Error(`sourceArtifacts contains duplicate fetchId ${fetchId}`)
    }
    if (uris.has(artifactUri)) {
      throw new Error(`sourceArtifacts contains duplicate artifactUri ${artifactUri}`)
    }
    sourceIds.add(sourceId)
    fetchIds.add(fetchId)
    uris.add(artifactUri)
    return {
      sourceId,
      fetchId,
      localPath,
      artifactSha256,
      artifactUri,
      contentType,
      byteLength,
      capturedAt,
      isFixture: false as const,
      captureMode: 'live' as const,
    }
  })
  if (artifacts.length !== expectedSources) {
    throw new Error('sourceArtifacts does not match counts.sourceDocuments')
  }
  return artifacts.sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'))
}

export function validateOfficialEntityMaterializationManifest(
  value: unknown,
  manifestPath: string,
  remote: boolean,
): ValidatedOfficialEntityManifest {
  const raw = asObject(value, 'manifest')
  if (raw.format !== 'studyinchina.pipeline.materialization') {
    throw new Error('manifest format is not a StudyInChina materialization')
  }
  const batchId = asString(raw.batchId, 'batchId').toLowerCase()
  if (!SHA256_PATTERN.test(batchId)) {
    throw new Error('batchId must be a lowercase SHA-256 value')
  }
  const materializerVersion = asString(raw.materializerVersion, 'materializerVersion')
  const batchPurposeValue = asString(raw.batchPurpose, 'batchPurpose')
  if (
    batchPurposeValue !== 'catalog_entities'
    && batchPurposeValue !== 'dependencies'
  ) {
    throw new Error('batchPurpose must be catalog_entities or dependencies')
  }
  const batchPurpose = batchPurposeValue as BatchPurpose
  if (raw.provenanceStatus !== 'complete') {
    throw new Error('provenanceStatus must be complete')
  }
  const generatedAt = asIsoTimestamp(raw.generatedAt, 'generatedAt')
  const contentSha256 = asString(raw.contentSha256, 'contentSha256').toLowerCase()
  if (!SHA256_PATTERN.test(contentSha256)) {
    throw new Error('contentSha256 must be a lowercase SHA-256 value')
  }
  const sqlPath = resolveManifestPath(asString(raw.sqlPath, 'sqlPath'), manifestPath)
  if (!existsSync(sqlPath) || !statSync(sqlPath).isFile()) {
    throw new Error(`materialization SQL does not exist: ${sqlPath}`)
  }
  const sqlBytes = readFileSync(sqlPath)
  if (sha256Bytes(sqlBytes) !== contentSha256) {
    throw new Error('materialization SQL SHA-256 does not match contentSha256')
  }
  const countValues = asObject(raw.counts, 'counts')
  const counts = {
    records: asCount(countValues.records, 'counts.records', false),
    programs: asCount(countValues.programs, 'counts.programs'),
    scholarships: asCount(countValues.scholarships, 'counts.scholarships'),
    organizations: asCount(countValues.organizations, 'counts.organizations'),
    locations: asCount(countValues.locations, 'counts.locations'),
    claims: asCount(countValues.claims, 'counts.claims', false),
    canonicalFields: asCount(
      countValues.canonicalFields,
      'counts.canonicalFields',
      false,
    ),
    sourceDocuments: asCount(
      countValues.sourceDocuments,
      'counts.sourceDocuments',
      false,
    ),
    sourceFragments: asCount(
      countValues.sourceFragments,
      'counts.sourceFragments',
      false,
    ),
    programCycles: asCount(countValues.programCycles, 'counts.programCycles') as 0,
    scholarshipCycles: asCount(
      countValues.scholarshipCycles,
      'counts.scholarshipCycles',
    ) as 0,
  }
  if (
    counts.records !== counts.programs + counts.scholarships
      + counts.organizations + counts.locations
  ) {
    throw new Error('manifest record counts are inconsistent')
  }
  if (
    batchPurpose === 'catalog_entities'
    && (counts.organizations !== 0 || counts.locations !== 0)
  ) {
    throw new Error('catalog_entities batches cannot contain dependencies')
  }
  if (
    batchPurpose === 'dependencies'
    && (
      counts.programs !== 0
      || counts.scholarships !== 0
      || counts.organizations === 0
      || counts.locations === 0
    )
  ) {
    throw new Error(
      'dependencies batches require organization and location records only',
    )
  }
  if (counts.programCycles !== 0 || counts.scholarshipCycles !== 0) {
    throw new Error('identity materialization must contain zero cycles')
  }
  const inputPaths = Array.isArray(raw.inputPaths)
    ? raw.inputPaths.map((path, index) => asString(path, `inputPaths[${index}]`))
    : []
  if (remote && inputPaths.some((path) => FORBIDDEN_REMOTE_PATH.test(path))) {
    throw new Error('remote import rejects fixture materialization inputs')
  }
  const recordMappings = validateRecordMappings(
    raw.recordMappings,
    counts.records,
    counts.programs,
    counts.scholarships,
    counts.organizations,
    counts.locations,
  )
  const sourceArtifacts = validateSourceArtifacts(
    raw.sourceArtifacts,
    manifestPath,
    counts.sourceDocuments,
    remote,
  )
  if (
    remote
    && batchPurpose === 'catalog_entities'
    && (counts.programs < 1_000 || counts.scholarships < 50)
  ) {
    throw new Error('remote catalog_entities requires 1000 programs and 50 scholarships')
  }
  return {
    batchId,
    batchPurpose,
    materializerVersion,
    provenanceStatus: 'complete',
    generatedAt,
    contentSha256,
    sqlPath,
    counts,
    recordMappings,
    sourceArtifacts,
    sourceManifestSha256: sha256Bytes(stableJson(raw)),
    raw,
  }
}

export function tokenizeSql(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let state:
    | 'normal'
    | 'single'
    | 'double'
    | 'backtick'
    | 'bracket'
    | 'line-comment'
    | 'block-comment' = 'normal'
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]
    if (state === 'line-comment') {
      if (character === '\n') state = 'normal'
      continue
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'normal'
        index += 1
      }
      continue
    }
    if (state === 'single') {
      if (character === "'" && next === "'") {
        index += 1
      } else if (character === "'") {
        state = 'normal'
      }
      continue
    }
    if (state === 'double') {
      if (character === '"' && next === '"') {
        index += 1
      } else if (character === '"') {
        state = 'normal'
      }
      continue
    }
    if (state === 'backtick') {
      if (character === '`' && next === '`') {
        index += 1
      } else if (character === '`') {
        state = 'normal'
      }
      continue
    }
    if (state === 'bracket') {
      if (character === ']' && next === ']') {
        index += 1
      } else if (character === ']') {
        state = 'normal'
      }
      continue
    }
    if (character === '-' && next === '-') {
      state = 'line-comment'
      index += 1
    } else if (character === '/' && next === '*') {
      state = 'block-comment'
      index += 1
    } else if (character === "'") {
      state = 'single'
    } else if (character === '"') {
      state = 'double'
    } else if (character === '`') {
      state = 'backtick'
    } else if (character === '[') {
      state = 'bracket'
    } else if (character === ';') {
      const statement = sql.slice(start, index + 1).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
  }
  if (state !== 'normal' && state !== 'line-comment') {
    throw new Error(`unterminated SQL ${state}`)
  }
  const trailing = sql.slice(start).trim()
  if (trailing && !/^(?:--[^\n]*(?:\r?\n|$)|\/\*[\s\S]*\*\/\s*)+$/u.test(trailing)) {
    throw new Error('SQL contains a trailing statement without a semicolon')
  }
  return statements
}

function withoutLeadingComments(statement: string): string {
  let result = statement.trimStart()
  while (result.startsWith('--') || result.startsWith('/*')) {
    if (result.startsWith('--')) {
      const newline = result.indexOf('\n')
      if (newline < 0) return ''
      result = result.slice(newline + 1).trimStart()
    } else {
      const end = result.indexOf('*/', 2)
      if (end < 0) throw new Error('unterminated leading SQL comment')
      result = result.slice(end + 2).trimStart()
    }
  }
  return result
}

function sanitizedMaterializerStatements(sql: string): string[] {
  const kept: string[] = []
  for (const statement of tokenizeSql(sql)) {
    const normalized = withoutLeadingComments(statement)
    if (!normalized) continue
    if (/^PRAGMA\s+(?:foreign_keys|optimize)\b/iu.test(normalized)) continue
    if (/^PRAGMA\b/iu.test(normalized)) {
      throw new Error('materializer SQL contains an unsupported PRAGMA')
    }
    if (/^WITH\b/iu.test(normalized)) {
      throw new Error('materializer SQL must not hide mutations in a CTE')
    }
    if (/^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/iu.test(normalized)) {
      throw new Error('materializer SQL must not control transactions')
    }
    if (/^(?:CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/iu.test(normalized)) {
      throw new Error('materializer SQL contains a forbidden database operation')
    }
    if (
      /\b(?:program_cycles|scholarship_cycles)\b/iu
        .test(normalized)
    ) {
      throw new Error('materializer SQL must not mutate application cycle tables')
    }
    if (
      /^(?:INSERT|UPDATE|DELETE|REPLACE)\b[\s\S]*\bmaterialization_batch(?:es|_chunks|_record_intents|_records|_source_artifacts)\b/iu
        .test(normalized)
    ) {
      continue
    }
    if (/^UPDATE\s+records\b[\s\S]*\bworkflow_status\b/iu.test(normalized)) {
      continue
    }
    kept.push(normalized)
  }
  if (kept.length === 0) throw new Error('materializer SQL has no import statements')
  return kept
}

function databaseManifest(
  manifest: ValidatedOfficialEntityManifest,
  packageDigest: string,
): string {
  return stableJson({
    format: 'studyinchina.pipeline.materialization-batch',
    formatVersion: 1,
    batchId: manifest.batchId,
    packageDigest,
    batchPurpose: manifest.batchPurpose,
    materializerVersion: manifest.materializerVersion,
    provenanceStatus: manifest.provenanceStatus,
    generatedAt: manifest.generatedAt,
    sourceManifestSha256: manifest.sourceManifestSha256,
    sourceSqlSha256: manifest.contentSha256,
    counts: manifest.counts,
    sourceArtifactCount: manifest.sourceArtifacts.length,
  })
}

function batchInitializationStatement(
  manifest: ValidatedOfficialEntityManifest,
  packageDigest: string,
  expectedChunks: number,
): string {
  const counts = manifest.counts
  return `
INSERT INTO materialization_batches (
  batch_id, materializer_version, package_digest, batch_purpose,
  batch_status, provenance_status,
  expected_chunks, expected_records, expected_programs, expected_scholarships,
  expected_organizations, expected_locations,
  expected_claims, expected_canonical_fields, expected_evidence_fragments,
  expected_source_documents, manifest_json, created_at, started_at, updated_at
) VALUES (
  ${sqlValue(manifest.batchId)}, ${sqlValue(manifest.materializerVersion)},
  ${sqlValue(packageDigest)}, ${sqlValue(manifest.batchPurpose)},
  'prepared', 'complete', ${expectedChunks}, ${counts.records},
  ${counts.programs}, ${counts.scholarships}, ${counts.organizations},
  ${counts.locations}, ${counts.claims},
  ${counts.canonicalFields}, ${counts.sourceFragments},
  ${counts.sourceDocuments}, ${sqlValue(databaseManifest(manifest, packageDigest))},
  ${sqlValue(manifest.generatedAt)}, NULL, CURRENT_TIMESTAMP
)
ON CONFLICT(batch_id) DO NOTHING;`.trim()
}

function batchStateStatement(
  batchId: string,
  packageDigest: string,
  fromStatus: 'prepared' | 'reserving' | 'reserved',
  toStatus: 'reserving' | 'reserved' | 'importing',
): string {
  const startedAt = toStatus === 'importing'
    ? ', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)'
    : ''
  return `
UPDATE materialization_batches
SET batch_status = ${sqlValue(toStatus)}${startedAt},
    updated_at = CURRENT_TIMESTAMP
WHERE batch_id = ${sqlValue(batchId)}
  AND package_digest = ${sqlValue(packageDigest)}
  AND batch_status = ${sqlValue(fromStatus)};`.trim()
}

function recordIntentStatement(
  batchId: string,
  packageDigest: string,
  mapping: OfficialEntityRecordMapping,
  reservedAt: string,
): string {
  return `
INSERT OR IGNORE INTO materialization_batch_record_intents (
  batch_id, record_id, record_kind, package_digest, reserved_at
) VALUES (
  ${sqlValue(batchId)}, ${sqlValue(mapping.recordId)},
  ${sqlValue(mapping.recordKind)}, ${sqlValue(packageDigest)},
  ${sqlValue(reservedAt)}
);`.trim()
}

function recordMappingStatement(
  batchId: string,
  mapping: OfficialEntityRecordMapping,
  createdAt: string,
): string {
  return `
INSERT OR IGNORE INTO materialization_batch_records (
  batch_id, record_id, record_kind, created_at
) VALUES (
  ${sqlValue(batchId)}, ${sqlValue(mapping.recordId)},
  ${sqlValue(mapping.recordKind)}, ${sqlValue(createdAt)}
);`.trim()
}

function sourceArtifactStatement(
  batchId: string,
  artifact: OfficialEntitySourceArtifact,
): string {
  return `
INSERT OR IGNORE INTO materialization_batch_source_artifacts (
  batch_id, source_id, fetch_id, artifact_sha256, artifact_uri,
  content_type, byte_length, captured_at
) VALUES (
  ${sqlValue(batchId)}, ${sqlValue(artifact.sourceId)},
  ${sqlValue(artifact.fetchId)}, ${sqlValue(artifact.artifactSha256)},
  ${sqlValue(artifact.artifactUri)}, ${sqlValue(artifact.contentType)},
  ${artifact.byteLength}, ${sqlValue(artifact.capturedAt)}
);`.trim()
}

function validationStageStatement(batchId: string): string {
  return `
UPDATE records
SET workflow_status = CASE
      WHEN workflow_status = 'published' THEN 'published'
      ELSE 'validated'
    END,
    updated_at = CASE
      WHEN workflow_status = 'published' THEN updated_at
      ELSE CURRENT_TIMESTAMP
    END
WHERE id IN (
  SELECT record_id FROM materialization_batch_records
  WHERE batch_id = ${sqlValue(batchId)}
);`.trim()
}

function markerStatement(
  batchId: string,
  packageDigest: string,
  chunkNumber: number,
  chunkSha256: string,
  statementCount: number,
): string {
  return `
INSERT INTO materialization_batch_chunks (
  batch_id, chunk_number, package_digest, chunk_sha256,
  statement_count, applied_at
) VALUES (
  ${sqlValue(batchId)}, ${chunkNumber}, ${sqlValue(packageDigest)},
  ${sqlValue(chunkSha256)}, ${statementCount}, CURRENT_TIMESTAMP
)
ON CONFLICT(batch_id, chunk_number) DO NOTHING;`.trim()
}

function payloadFor(statements: string[]): ChunkPayload {
  const payload = `${statements.join('\n')}\n`
  return {
    statements,
    payload,
    sha256: sha256Bytes(payload),
    statementCount: statements.length,
    payloadBytes: Buffer.byteLength(payload, 'utf8'),
  }
}

function renderMarkedPayload(
  batchId: string,
  packageDigest: string,
  chunkNumber: number,
  statements: string[],
): { payload: ChunkPayload; sql: string; transportBytes: number } {
  const payload = payloadFor(statements)
  const sql = `${payload.payload}${markerStatement(
    batchId,
    packageDigest,
    chunkNumber,
    payload.sha256,
    payload.statementCount,
  )}\n`
  return {
    payload,
    sql,
    transportBytes: Buffer.byteLength(sql, 'utf8'),
  }
}

function splitCommandStatements(
  batchId: string,
  packageDigest: string,
  statements: string[],
  maxTransportBytes: number,
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  for (const statement of statements) {
    const candidate = [...current, statement]
    const chunkNumber = chunks.length + 1
    const bytes = renderMarkedPayload(
      batchId,
      packageDigest,
      chunkNumber,
      candidate,
    ).transportBytes
    if (bytes <= maxTransportBytes) {
      current = candidate
      continue
    }
    if (current.length === 0) {
      throw new Error(
        `one SQL statement exceeds the ${maxTransportBytes}-byte command limit`,
      )
    }
    chunks.push(current)
    current = [statement]
    const singleBytes = renderMarkedPayload(
      batchId,
      packageDigest,
      chunks.length + 1,
      current,
    ).transportBytes
    if (singleBytes > maxTransportBytes) {
      throw new Error(
        `one SQL statement exceeds the ${maxTransportBytes}-byte command limit`,
      )
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function transportStatements(
  manifest: ValidatedOfficialEntityManifest,
  packageDigest: string,
  materializerStatements: string[],
  expectedChunks: number,
): string[] {
  return [
    batchInitializationStatement(manifest, packageDigest, expectedChunks),
    batchStateStatement(manifest.batchId, packageDigest, 'prepared', 'reserving'),
    ...manifest.recordMappings.map((mapping) => recordIntentStatement(
      manifest.batchId,
      packageDigest,
      mapping,
      manifest.generatedAt,
    )),
    batchStateStatement(manifest.batchId, packageDigest, 'reserving', 'reserved'),
    batchStateStatement(manifest.batchId, packageDigest, 'reserved', 'importing'),
    ...materializerStatements,
    ...manifest.recordMappings.map((mapping) => recordMappingStatement(
      manifest.batchId,
      mapping,
      manifest.generatedAt,
    )),
    ...manifest.sourceArtifacts.map((artifact) => sourceArtifactStatement(
      manifest.batchId,
      artifact,
    )),
    validationStageStatement(manifest.batchId),
  ]
}

function writeTransport(
  outputDirectory: string,
  prefix: string,
  batchId: string,
  packageDigest: string,
  chunks: string[][],
): SqlChunk[] {
  return chunks.map((statements, index) => {
    const chunkNumber = index + 1
    const rendered = renderMarkedPayload(
      batchId,
      packageDigest,
      chunkNumber,
      statements,
    )
    const path = join(outputDirectory, `${prefix}.chunk-${String(chunkNumber).padStart(4, '0')}.sql`)
    writeFileSync(path, rendered.sql, 'utf8')
    return {
      chunkNumber,
      chunkSha256: rendered.payload.sha256,
      statementCount: rendered.payload.statementCount,
      payloadBytes: rendered.payload.payloadBytes,
      transportBytes: rendered.transportBytes,
      path,
    }
  })
}

export function verifyOfficialEntityChunk(
  chunkPathValue: string,
): VerifiedOfficialEntityChunk {
  const chunkPath = resolve(chunkPathValue)
  if (!existsSync(chunkPath) || !statSync(chunkPath).isFile()) {
    throw new Error(`chunk file does not exist: ${chunkPath}`)
  }
  const sql = readFileSync(chunkPath, 'utf8')
  const statements = tokenizeSql(sql)
  const markerIndexes = statements.flatMap((statement, index) => (
    /^INSERT\s+INTO\s+materialization_batch_chunks\b/u.test(
      withoutLeadingComments(statement),
    ) ? [index] : []
  ))
  if (
    markerIndexes.length !== 1
    || markerIndexes[0] !== statements.length - 1
  ) {
    throw new Error('chunk must contain exactly one final marker statement')
  }
  const marker = statements[statements.length - 1]
  const normalizedMarker = withoutLeadingComments(marker)
  if (marker !== normalizedMarker) {
    throw new Error('chunk marker cannot have leading comments')
  }
  const match = normalizedMarker.match(
    /^INSERT INTO materialization_batch_chunks\s*\(\s*batch_id\s*,\s*chunk_number\s*,\s*package_digest\s*,\s*chunk_sha256\s*,\s*statement_count\s*,\s*applied_at\s*\)\s*VALUES\s*\(\s*'([0-9a-f]{64})'\s*,\s*([1-9][0-9]*)\s*,\s*'([0-9a-f]{64})'\s*,\s*'([0-9a-f]{64})'\s*,\s*([1-9][0-9]*)\s*,\s*CURRENT_TIMESTAMP\s*\)\s*ON CONFLICT\s*\(\s*batch_id\s*,\s*chunk_number\s*\)\s*DO NOTHING;$/u,
  )
  if (!match) throw new Error('chunk marker is malformed')
  const markerOffset = sql.lastIndexOf(marker)
  if (markerOffset < 0 || sql.slice(markerOffset) !== `${marker}\n`) {
    throw new Error('chunk marker must be the exact tail statement')
  }
  const payload = sql.slice(0, markerOffset)
  const payloadStatements = tokenizeSql(payload)
  const statementCount = Number.parseInt(match[5], 10)
  const chunkSha256 = sha256Bytes(payload)
  if (payloadStatements.length !== statementCount) {
    throw new Error('chunk marker statement count does not match payload')
  }
  if (chunkSha256 !== match[4]) {
    throw new Error('chunk marker SHA-256 does not match payload')
  }
  return {
    batchId: match[1],
    chunkNumber: Number.parseInt(match[2], 10),
    packageDigest: match[3],
    chunkSha256,
    statementCount,
    payloadBytes: Buffer.byteLength(payload, 'utf8'),
    transportBytes: Buffer.byteLength(sql, 'utf8'),
  }
}

function finalizationSql(batchId: string): string {
  return `
UPDATE materialization_batches
SET batch_status = 'applied',
    completed_at = CASE
      WHEN julianday(CURRENT_TIMESTAMP) >= julianday(created_at)
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ELSE created_at
    END,
    updated_at = CURRENT_TIMESTAMP,
    error_code = NULL,
    error_detail = NULL
WHERE batch_id = ${sqlValue(batchId)}
  AND batch_status = 'importing';\n`.trimStart()
}

export function verificationSql(batchId: string): string {
  return `
SELECT
  batch.batch_id,
  batch.batch_status,
  batch.provenance_status,
  batch.materializer_version,
  batch.batch_purpose,
  batch.package_digest,
  json_extract(batch.manifest_json, '$.batchId') AS manifest_batch_id,
  json_extract(batch.manifest_json, '$.packageDigest')
    AS manifest_package_digest,
  json_extract(batch.manifest_json, '$.sourceSqlSha256')
    AS manifest_source_sql_sha256,
  json_extract(batch.manifest_json, '$.sourceArtifactCount')
    AS manifest_source_artifact_count,
  batch.expected_chunks,
  batch.expected_records,
  batch.expected_programs,
  batch.expected_scholarships,
  batch.expected_organizations,
  batch.expected_locations,
  batch.expected_claims,
  batch.expected_canonical_fields,
  batch.expected_evidence_fragments,
  batch.expected_source_documents,
  (SELECT COUNT(*) FROM materialization_batch_chunks chunk
    WHERE chunk.batch_id = batch.batch_id
      AND chunk.package_digest = batch.package_digest) AS actual_chunks,
  (SELECT COUNT(*) FROM materialization_batch_chunks chunk
    WHERE chunk.batch_id = batch.batch_id
      AND chunk.package_digest <> batch.package_digest) AS foreign_package_chunks,
  (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = batch.batch_id
      AND intent.package_digest = batch.package_digest) AS actual_intents,
  (SELECT COUNT(*) FROM materialization_batch_record_intents intent
    WHERE intent.batch_id = batch.batch_id
      AND NOT EXISTS (
        SELECT 1 FROM materialization_batch_records mapped
        WHERE mapped.batch_id = intent.batch_id
          AND mapped.record_id = intent.record_id
          AND mapped.record_kind = intent.record_kind
      )) AS unmatched_intents,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    WHERE mapped.batch_id = batch.batch_id) AS actual_records,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN programs program ON program.record_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'program'
      AND record.kind = 'program') AS actual_programs,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN scholarships scholarship ON scholarship.record_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'scholarship'
      AND record.kind = 'scholarship') AS actual_scholarships,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN organizations organization ON organization.record_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'organization'
      AND record.kind = 'organization') AS actual_organizations,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    JOIN locations location ON location.record_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'location'
      AND record.kind = 'location') AS actual_locations,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND claim.extractor_version = batch.materializer_version
      AND claim.claim_status = 'accepted') AS actual_claims,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN canonical_fields canonical ON canonical.subject_record_id = mapped.record_id
    JOIN claims claim ON claim.id = canonical.claim_id
    WHERE mapped.batch_id = batch.batch_id
      AND canonical.field_status = 'accepted'
      AND claim.extractor_version = batch.materializer_version
      AND claim.claim_status = 'accepted') AS actual_canonical_fields,
  (SELECT COUNT(DISTINCT evidence.fragment_id)
    FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    JOIN claim_evidence evidence ON evidence.claim_id = claim.id
    JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
    JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
    JOIN materialization_batch_source_artifacts artifact
      ON artifact.batch_id = batch.batch_id
     AND artifact.fetch_id = fetch.id
    JOIN source_documents source ON source.id = fetch.source_id
    WHERE mapped.batch_id = batch.batch_id
      AND claim.extractor_version = batch.materializer_version
      AND claim.claim_status = 'accepted'
      AND evidence.evidence_role = 'primary'
      AND source.authority_level = 'primary_official'
      AND source.official = 1) AS actual_evidence_fragments,
  (SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN canonical_fields canonical ON canonical.subject_record_id = mapped.record_id
    JOIN claims claim ON claim.id = canonical.claim_id
    WHERE mapped.batch_id = batch.batch_id
      AND canonical.field_status = 'accepted'
      AND claim.extractor_version = batch.materializer_version
      AND claim.claim_status = 'accepted'
      AND NOT EXISTS (
        SELECT 1
        FROM claim_evidence evidence
        JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
        JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
        JOIN materialization_batch_source_artifacts artifact
          ON artifact.batch_id = batch.batch_id
         AND artifact.fetch_id = fetch.id
        JOIN source_documents source ON source.id = fetch.source_id
        WHERE evidence.claim_id = claim.id
          AND evidence.evidence_role = 'primary'
          AND source.authority_level = 'primary_official'
          AND source.official = 1
      )) AS canonical_claims_without_batch_primary_evidence,
  (SELECT COUNT(*) FROM materialization_batch_source_artifacts artifact
    WHERE artifact.batch_id = batch.batch_id) AS actual_source_documents,
  (SELECT COUNT(*)
    FROM materialization_batch_records mapped
    JOIN claims claim ON claim.subject_record_id = mapped.record_id
    JOIN claim_evidence evidence ON evidence.claim_id = claim.id
    JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
    WHERE mapped.batch_id = batch.batch_id
      AND claim.extractor_version = batch.materializer_version
      AND claim.claim_status = 'accepted'
      AND evidence.evidence_role = 'primary'
      AND NOT EXISTS (
        SELECT 1 FROM materialization_batch_source_artifacts artifact
        WHERE artifact.batch_id = batch.batch_id
          AND artifact.fetch_id = fragment.fetch_id
      )) AS unbatched_primary_evidence,
  (SELECT COUNT(*)
    FROM materialization_batch_source_artifacts artifact
    WHERE artifact.batch_id = batch.batch_id
      AND NOT EXISTS (
        SELECT 1
        FROM materialization_batch_records mapped
        JOIN claims claim ON claim.subject_record_id = mapped.record_id
        JOIN claim_evidence evidence ON evidence.claim_id = claim.id
        JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
        WHERE mapped.batch_id = batch.batch_id
          AND claim.extractor_version = batch.materializer_version
          AND claim.claim_status = 'accepted'
          AND evidence.evidence_role = 'primary'
          AND fragment.fetch_id = artifact.fetch_id
      )) AS unused_source_artifacts,
  (SELECT COUNT(*) FROM materialization_batch_source_artifacts artifact
    LEFT JOIN source_fetches fetch ON fetch.id = artifact.fetch_id
    WHERE artifact.batch_id = batch.batch_id
      AND (
        fetch.id IS NULL
        OR fetch.source_id <> artifact.source_id
        OR fetch.status <> 'succeeded'
        OR fetch.sha256 <> artifact.artifact_sha256
        OR fetch.artifact_uri <> artifact.artifact_uri
        OR fetch.content_type <> artifact.content_type
        OR fetch.content_length <> artifact.byte_length
        OR fetch.completed_at <> artifact.captured_at
      )) AS artifact_identity_mismatches,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND record.workflow_status IN ('validated', 'published')) AS ready_records,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN records record ON record.id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND record.workflow_status IN ('applied', 'published')) AS applied_records,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN program_cycles cycle ON cycle.program_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'program') AS associated_program_cycles,
  (SELECT COUNT(*) FROM materialization_batch_records mapped
    JOIN scholarship_cycles cycle ON cycle.scholarship_id = mapped.record_id
    WHERE mapped.batch_id = batch.batch_id
      AND mapped.record_kind = 'scholarship') AS associated_scholarship_cycles
FROM materialization_batches batch
WHERE batch.batch_id = ${sqlValue(batchId)};\n`.trimStart()
}

export function packageOfficialEntityImport(
  options: PackageOptions,
): { manifest: OfficialEntityImportPackageManifest; manifestPath: string } {
  const manifestPath = resolve(options.manifestPath)
  const outputDirectory = resolve(options.outputDirectory)
  const maxCommandBytes = options.maxCommandBytes ?? DEFAULT_MAX_COMMAND_BYTES
  if (maxCommandBytes < 4_000 || maxCommandBytes > 24_000) {
    throw new Error('maxCommandBytes must be between 4000 and 24000')
  }
  const rawManifestText = readFileSync(manifestPath, 'utf8')
  const sourceManifest = validateOfficialEntityMaterializationManifest(
    JSON.parse(rawManifestText) as unknown,
    manifestPath,
    options.remote,
  )
  const materializerSql = readFileSync(sourceManifest.sqlPath, 'utf8')
  const materializerStatements = sanitizedMaterializerStatements(materializerSql)
  const packageDigest = computeOfficialEntityPackageDigest({
    materializerVersion: sourceManifest.materializerVersion,
    batchPurpose: sourceManifest.batchPurpose,
    sourceSqlSha256: sourceManifest.contentSha256,
    counts: sourceManifest.counts,
    recordMappings: sourceManifest.recordMappings,
    sourceArtifacts: sourceManifest.sourceArtifacts,
  })
  mkdirSync(outputDirectory, { recursive: true })
  const prefix = `official-entities-${sourceManifest.batchId.slice(0, 12)}`

  const fileStatements = transportStatements(
    sourceManifest,
    packageDigest,
    materializerStatements,
    1,
  )
  const fileChunks = writeTransport(
    outputDirectory,
    `${prefix}.file`,
    sourceManifest.batchId,
    packageDigest,
    [fileStatements],
  ) as [SqlChunk]

  let expectedChunks = 1
  let commandStatementChunks: string[][] = []
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const statements = transportStatements(
      sourceManifest,
      packageDigest,
      materializerStatements,
      expectedChunks,
    )
    commandStatementChunks = splitCommandStatements(
      sourceManifest.batchId,
      packageDigest,
      statements,
      maxCommandBytes,
    )
    if (commandStatementChunks.length === expectedChunks) break
    expectedChunks = commandStatementChunks.length
  }
  if (commandStatementChunks.length !== expectedChunks) {
    throw new Error('command chunk count did not converge')
  }
  const commandChunks = writeTransport(
    outputDirectory,
    `${prefix}.command`,
    sourceManifest.batchId,
    packageDigest,
    commandStatementChunks,
  )
  const finalizationSqlPath = join(outputDirectory, `${prefix}.finalize.sql`)
  const verificationSqlPath = join(outputDirectory, `${prefix}.verify.sql`)
  writeFileSync(finalizationSqlPath, finalizationSql(sourceManifest.batchId), 'utf8')
  writeFileSync(verificationSqlPath, verificationSql(sourceManifest.batchId), 'utf8')

  const packageManifest: OfficialEntityImportPackageManifest = {
    format: PACKAGE_FORMAT,
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    batchId: sourceManifest.batchId,
    packageDigest,
    batchPurpose: sourceManifest.batchPurpose,
    materializerVersion: sourceManifest.materializerVersion,
    provenanceStatus: 'complete',
    sourceManifestPath: manifestPath,
    sourceManifestSha256: sourceManifest.sourceManifestSha256,
    sourceSqlPath: sourceManifest.sqlPath,
    sourceSqlSha256: sourceManifest.contentSha256,
    counts: sourceManifest.counts,
    recordMappings: sourceManifest.recordMappings,
    sourceArtifacts: sourceManifest.sourceArtifacts,
    transports: {
      file: {
        expectedChunks: 1,
        chunks: fileChunks,
      },
      commandChunks: {
        expectedChunks: commandChunks.length,
        maxTransportBytes: maxCommandBytes,
        chunks: commandChunks,
      },
    },
    finalizationSqlPath,
    verificationSqlPath,
  }
  const outputManifestPath = join(outputDirectory, `${prefix}.import-package.json`)
  writeFileSync(outputManifestPath, JSON.stringify(packageManifest, null, 2), 'utf8')
  return { manifest: packageManifest, manifestPath: outputManifestPath }
}

export type VerifiedOfficialEntityImportPackage = {
  batchId: string
  packageDigest: string
  fileExpectedChunks: number
  commandExpectedChunks: number
}

export function verifyOfficialEntityImportPackage(
  packagePathValue: string,
): VerifiedOfficialEntityImportPackage {
  const packagePath = resolve(packagePathValue)
  if (!existsSync(packagePath) || !statSync(packagePath).isFile()) {
    throw new Error(`import package does not exist: ${packagePath}`)
  }
  const raw = asObject(
    JSON.parse(readFileSync(packagePath, 'utf8')) as unknown,
    'import package',
  )
  if (raw.format !== PACKAGE_FORMAT || raw.formatVersion !== 1) {
    throw new Error('import package format is unsupported')
  }
  if (raw.provenanceStatus !== 'complete') {
    throw new Error('import package provenanceStatus must be complete')
  }
  asIsoTimestamp(raw.generatedAt, 'generatedAt')
  const sourceManifestPath = resolveManifestPath(
    asString(raw.sourceManifestPath, 'sourceManifestPath'),
    packagePath,
  )
  if (!existsSync(sourceManifestPath) || !statSync(sourceManifestPath).isFile()) {
    throw new Error(`source manifest does not exist: ${sourceManifestPath}`)
  }
  const sourceManifest = validateOfficialEntityMaterializationManifest(
    JSON.parse(readFileSync(sourceManifestPath, 'utf8')) as unknown,
    sourceManifestPath,
    false,
  )
  const packageDigest = asString(raw.packageDigest, 'packageDigest')
  if (!SHA256_PATTERN.test(packageDigest)) {
    throw new Error('packageDigest must be a lowercase SHA-256 value')
  }
  const expectedDigest = computeOfficialEntityPackageDigest({
    materializerVersion: sourceManifest.materializerVersion,
    batchPurpose: sourceManifest.batchPurpose,
    sourceSqlSha256: sourceManifest.contentSha256,
    counts: sourceManifest.counts,
    recordMappings: sourceManifest.recordMappings,
    sourceArtifacts: sourceManifest.sourceArtifacts,
  })
  if (packageDigest !== expectedDigest) {
    throw new Error('packageDigest does not match package identity')
  }
  const identityChecks: Array<[unknown, unknown, string]> = [
    [raw.batchId, sourceManifest.batchId, 'batchId'],
    [raw.batchPurpose, sourceManifest.batchPurpose, 'batchPurpose'],
    [raw.materializerVersion, sourceManifest.materializerVersion, 'materializerVersion'],
    [raw.sourceManifestSha256, sourceManifest.sourceManifestSha256, 'sourceManifestSha256'],
    [raw.sourceSqlSha256, sourceManifest.contentSha256, 'sourceSqlSha256'],
  ]
  for (const [actual, expected, label] of identityChecks) {
    if (actual !== expected) throw new Error(`import package ${label} mismatch`)
  }
  if (
    resolveManifestPath(asString(raw.sourceSqlPath, 'sourceSqlPath'), packagePath)
      !== sourceManifest.sqlPath
  ) {
    throw new Error('import package sourceSqlPath mismatch')
  }
  if (stableJson(raw.counts) !== stableJson(sourceManifest.counts)) {
    throw new Error('import package counts mismatch')
  }
  if (stableJson(raw.recordMappings) !== stableJson(sourceManifest.recordMappings)) {
    throw new Error('import package recordMappings mismatch')
  }
  if (stableJson(raw.sourceArtifacts) !== stableJson(sourceManifest.sourceArtifacts)) {
    throw new Error('import package sourceArtifacts mismatch')
  }

  const materializerStatements = sanitizedMaterializerStatements(
    readFileSync(sourceManifest.sqlPath, 'utf8'),
  )
  const transports = asObject(raw.transports, 'transports')
  const fileDefinition = asObject(transports.file, 'transports.file')
  const commandDefinition = asObject(
    transports.commandChunks,
    'transports.commandChunks',
  )
  const fileExpectedChunks = asCount(
    fileDefinition.expectedChunks,
    'transports.file.expectedChunks',
    false,
  )
  if (fileExpectedChunks !== 1) {
    throw new Error('file transport must contain exactly one chunk')
  }
  const commandExpectedChunks = asCount(
    commandDefinition.expectedChunks,
    'transports.commandChunks.expectedChunks',
    false,
  )
  const maxTransportBytes = asCount(
    commandDefinition.maxTransportBytes,
    'transports.commandChunks.maxTransportBytes',
    false,
  )
  if (maxTransportBytes < 4_000 || maxTransportBytes > 24_000) {
    throw new Error('command transport byte limit is invalid')
  }
  const expectedFileStatements = [transportStatements(
    sourceManifest,
    packageDigest,
    materializerStatements,
    1,
  )]
  const expectedCommandStatements = splitCommandStatements(
    sourceManifest.batchId,
    packageDigest,
    transportStatements(
      sourceManifest,
      packageDigest,
      materializerStatements,
      commandExpectedChunks,
    ),
    maxTransportBytes,
  )
  if (expectedCommandStatements.length !== commandExpectedChunks) {
    throw new Error('command transport chunk count is not reproducible')
  }

  function verifyTransport(
    definition: JsonObject,
    expectedChunks: string[][],
    label: string,
  ): void {
    if (!Array.isArray(definition.chunks)) {
      throw new Error(`${label}.chunks must be an array`)
    }
    if (definition.chunks.length !== expectedChunks.length) {
      throw new Error(`${label}.chunks count mismatch`)
    }
    definition.chunks.forEach((value, index) => {
      const chunk = asObject(value, `${label}.chunks[${index}]`)
      const chunkPath = resolveManifestPath(
        asString(chunk.path, `${label}.chunks[${index}].path`),
        packagePath,
      )
      const verified = verifyOfficialEntityChunk(chunkPath)
      const expected = renderMarkedPayload(
        sourceManifest.batchId,
        packageDigest,
        index + 1,
        expectedChunks[index],
      )
      if (readFileSync(chunkPath, 'utf8') !== expected.sql) {
        throw new Error(`${label}.chunks[${index}] SQL is not reproducible`)
      }
      const comparisons: Array<[unknown, unknown, string]> = [
        [chunk.chunkNumber, index + 1, 'chunkNumber'],
        [chunk.chunkSha256, expected.payload.sha256, 'chunkSha256'],
        [chunk.statementCount, expected.payload.statementCount, 'statementCount'],
        [chunk.payloadBytes, expected.payload.payloadBytes, 'payloadBytes'],
        [chunk.transportBytes, expected.transportBytes, 'transportBytes'],
        [verified.batchId, sourceManifest.batchId, 'marker.batchId'],
        [verified.packageDigest, packageDigest, 'marker.packageDigest'],
        [verified.chunkNumber, index + 1, 'marker.chunkNumber'],
        [verified.chunkSha256, expected.payload.sha256, 'marker.chunkSha256'],
        [verified.statementCount, expected.payload.statementCount, 'marker.statementCount'],
      ]
      for (const [actual, expectedValue, field] of comparisons) {
        if (actual !== expectedValue) {
          throw new Error(`${label}.chunks[${index}] ${field} mismatch`)
        }
      }
    })
  }

  verifyTransport(fileDefinition, expectedFileStatements, 'transports.file')
  verifyTransport(
    commandDefinition,
    expectedCommandStatements,
    'transports.commandChunks',
  )
  const finalizationPath = resolveManifestPath(
    asString(raw.finalizationSqlPath, 'finalizationSqlPath'),
    packagePath,
  )
  const verificationPath = resolveManifestPath(
    asString(raw.verificationSqlPath, 'verificationSqlPath'),
    packagePath,
  )
  if (
    !existsSync(finalizationPath)
    || readFileSync(finalizationPath, 'utf8') !== finalizationSql(sourceManifest.batchId)
  ) {
    throw new Error('finalization SQL is not reproducible')
  }
  if (
    !existsSync(verificationPath)
    || readFileSync(verificationPath, 'utf8') !== verificationSql(sourceManifest.batchId)
  ) {
    throw new Error('verification SQL is not reproducible')
  }
  return {
    batchId: sourceManifest.batchId,
    packageDigest,
    fileExpectedChunks,
    commandExpectedChunks,
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function main(): void {
  const chunkPath = argument('--verify-chunk')
  if (chunkPath) {
    process.stdout.write(`${JSON.stringify(verifyOfficialEntityChunk(chunkPath))}\n`)
    return
  }
  const packagePath = argument('--verify-package')
  if (packagePath) {
    process.stdout.write(`${JSON.stringify(verifyOfficialEntityImportPackage(packagePath))}\n`)
    return
  }
  const manifestPath = argument('--manifest')
  if (!manifestPath) throw new Error('--manifest is required')
  const outputDirectory = argument('--output') ?? '.pipeline-build/materialized-import'
  const maxCommandBytesValue = argument('--max-command-bytes')
  const maxCommandBytes = maxCommandBytesValue === undefined
    ? undefined
    : Number.parseInt(maxCommandBytesValue, 10)
  const result = packageOfficialEntityImport({
    manifestPath,
    outputDirectory,
    remote: process.argv.includes('--remote'),
    maxCommandBytes,
  })
  process.stdout.write(`${result.manifestPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
