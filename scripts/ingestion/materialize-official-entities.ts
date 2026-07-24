import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { isIP } from 'node:net'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS,
  officialEntityInputDocuments,
  resolveOfficialEntityInputPaths,
} from './official-entity-input-adapters'
import {
  INSTITUTION_HOST_ALLOWLISTS,
} from '../validate-source-manifests'

type SqlValue = string | number | boolean | null
type JsonRecord = Record<string, unknown>
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

type NormalizedEvidence = {
  locatorType: LocatorType
  locator: string
  quote: string
  officialUrl: string
  checkedAt: string
  fieldPaths: string[] | null
}

type NormalizedEntity = {
  entityType: EntityKind
  entityKey: string
  ownerOrganizationId: string
  institutionId: string | null
  providerOrganizationId: string | null
  programType: ProgramType | null
  degreeLevel: DegreeLevel | null
  schemeType: SchemeType | null
  attendanceMode: 'full_time' | 'part_time' | 'hybrid'
  deliveryMode: 'on_campus' | 'online' | 'hybrid'
  nameEn: string | null
  nameZh: string | null
  officialUrl: string
  checkedAt: string
  reviewAfter: string
  evidence: NormalizedEvidence[]
  sourceMetadata: SourceMetadataInput
}

type PreparedSource = {
  id: string
  publicId: string
  url: string
  publisherOrganizationId: string
  sourceKind: 'program' | 'scholarship'
  languageCode: string
  title: string
  publisher: string
  reviewedBy: string
  reviewedAt: string
}

type PreparedFetch = {
  id: string
  sourceId: string
  checkedAt: string
  status: 'queued' | 'succeeded'
  completedAt: string | null
  contentType: string | null
  contentLength: number | null
  sha256: string | null
  artifactUri: string | null
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
  isFixture: boolean
  captureMode: 'live' | 'fixture'
}

type ProvenanceStatus = 'fixture' | 'derived_only' | 'complete'

export type OfficialEntityMaterializationOptions = {
  provenanceManifest?: unknown
  provenanceBaseDirectory?: string
}

type RecordMapping = {
  recordId: string
  recordKind: EntityKind
}

type PreparedFragment = {
  id: string
  fetchId: string
  locatorType: LocatorType
  locator: string
  quote: string
  sha256: string
}

type PreparedFact = {
  recordId: string
  recordKind: EntityKind
  fieldPath: string
  locale: string
  valueType: 'localized_string' | 'url' | 'string'
  value: string
  checkedAt: string
  reviewAfter: string
  fragmentIds: string[]
}

type PreparedRecord = {
  id: string
  publicId: string
  slug: string
  kind: EntityKind
  entity: NormalizedEntity
  facts: PreparedFact[]
}

type SourceMetadataInput = {
  title?: string
  publisher?: string
  reviewedBy?: string
  languageCode?: string
  officialHosts: string[]
}

export type OfficialEntityMaterializationManifest = {
  format: 'studyinchina.pipeline.materialization'
  formatVersion: 1
  materializerVersion: string
  batchId: string
  batchPurpose: 'catalog_entities'
  provenanceStatus: ProvenanceStatus
  requiredSourceArtifacts: number
  sourceArtifacts: OfficialEntitySourceArtifact[]
  recordMappings: RecordMapping[]
  generatedAt: string
  contentSha256: string
  sqlStatements: number
  maxSqlStatementBytes: number
  counts: {
    records: number
    recordSlugs: number
    programs: number
    scholarships: number
    organizations: 0
    locations: 0
    localizedContent: number
    sourceDocuments: number
    sourceFetches: number
    sourceFragments: number
    claims: number
    canonicalFields: number
    programCycles: 0
    scholarshipCycles: 0
  }
  prerequisiteInstitutionIds: string[]
  prerequisiteProviderOrganizationIds: string[]
  prerequisiteLocationIds: string[]
  dependencyRecords: Array<{
    recordId: string
    recordKind: 'organization' | 'location'
  }>
  ignoredCycleHints: number
}

export type OfficialEntityMaterializationArtifacts = {
  sql: string
  manifest: OfficialEntityMaterializationManifest
}

const MATERIALIZER_VERSION = 'official-entity-materializer/v1'
const MAX_SQL_STATEMENT_BYTES = 20_000
const MAX_EVIDENCE_QUOTE_LENGTH = 2_000
const ALLOWED_LOCATOR_TYPES = new Set<LocatorType>([
  'css',
  'xpath',
  'json_pointer',
  'pdf_page',
  'pdf_region',
  'text_offset',
  'manual',
])
const PROGRAM_TYPES = new Set<ProgramType>([
  'degree',
  'language',
  'foundation',
  'exchange',
  'visiting',
  'short_term',
  'other',
])
const DEGREE_LEVELS = new Set<DegreeLevel>(['bachelor', 'master', 'doctorate'])
const SCHEME_TYPES = new Set<SchemeType>([
  'government',
  'university',
  'province',
  'city',
  'foundation',
  'other',
])
const ATTENDANCE_MODES = new Set(['full_time', 'part_time', 'hybrid'])
const DELIVERY_MODES = new Set(['on_campus', 'online', 'hybrid'])
const INSTITUTION_LOCATION_DEPENDENCIES: Readonly<Record<string, string>> = {
  'uni-tsinghua-university': 'city-beijing',
  'uni-peking-university': 'city-beijing',
  'uni-fudan-university': 'city-shanghai',
  'uni-shanghai-jiao-tong-university': 'city-shanghai',
  'uni-zhejiang-university': 'city-hangzhou',
  'uni-university-of-science-and-technology-of-china': 'city-hefei',
}
const MATERIALIZER_OWNER_HOSTS: Readonly<Record<string, readonly string[]>> = {
  ...INSTITUTION_HOST_ALLOWLISTS,
  ...Object.fromEntries(Object.entries(INSTITUTION_HOST_ALLOWLISTS).map(
    ([ownerId, hosts]) => [
      ownerId,
      [...new Set([
        ...hosts,
        ...(SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS[ownerId] ?? []),
      ])].sort(),
    ],
  )),
  'uni-peking-university': [
    ...new Set([
      ...INSTITUTION_HOST_ALLOWLISTS['uni-peking-university'],
      ...(SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS['uni-peking-university'] ?? []),
      'admission.pku.edu.cn',
    ]),
  ],
  'uni-zhejiang-university': [
    ...new Set([
      ...INSTITUTION_HOST_ALLOWLISTS['uni-zhejiang-university'],
      ...(SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS['uni-zhejiang-university'] ?? []),
      'zju.edu.cn',
    ]),
  ],
  'provider-china-scholarship-council': ['campuschina.org'],
}
const FIELD_DEFINITIONS = [
  {
    recordKind: 'program',
    fieldPath: 'localized.name',
    valueType: 'localized_string',
    riskClass: 'medium',
    requiredForPublish: 1,
    validationProfile: 'non-empty-text',
  },
  {
    recordKind: 'program',
    fieldPath: 'official_url',
    valueType: 'url',
    riskClass: 'high',
    requiredForPublish: 1,
    validationProfile: 'official-https-url',
  },
  {
    recordKind: 'program',
    fieldPath: 'program_type',
    valueType: 'string',
    riskClass: 'high',
    requiredForPublish: 1,
    validationProfile: 'program-type',
  },
  {
    recordKind: 'program',
    fieldPath: 'degree_level',
    valueType: 'string',
    riskClass: 'high',
    requiredForPublish: 0,
    validationProfile: 'degree-level',
  },
  {
    recordKind: 'scholarship',
    fieldPath: 'localized.name',
    valueType: 'localized_string',
    riskClass: 'medium',
    requiredForPublish: 1,
    validationProfile: 'non-empty-text',
  },
  {
    recordKind: 'scholarship',
    fieldPath: 'official_url',
    valueType: 'url',
    riskClass: 'critical',
    requiredForPublish: 1,
    validationProfile: 'official-https-url',
  },
] as const

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function optionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function oneOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  const normalized = nonEmptyString(value, label) as T
  if (!allowed.has(normalized)) {
    throw new Error(`${label} has unsupported value ${JSON.stringify(normalized)}`)
  }
  return normalized
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function resolveArtifactPath(
  baseDirectory: string,
  value: unknown,
  label: string,
): string {
  const localPath = nonEmptyString(value, label)
  if (isAbsolute(localPath)) {
    throw new Error(`${label} must be relative to the provenance manifest`)
  }
  const manifestDirectory = realpathSync(resolve(baseDirectory))
  const candidate = resolve(manifestDirectory, localPath)
  const relativePath = relative(manifestDirectory, candidate)
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes the provenance manifest directory`)
  }
  const stat = lstatSync(candidate)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must reference a regular non-symlink file`)
  }
  const realCandidate = realpathSync(candidate)
  const realRelative = relative(manifestDirectory, realCandidate)
  if (
    realRelative === '..'
    || realRelative.startsWith(`..${sep}`)
    || isAbsolute(realRelative)
  ) {
    throw new Error(`${label} resolves outside the provenance manifest directory`)
  }
  return realCandidate
}

function normalizeSourceArtifacts(
  value: unknown,
  baseDirectory = process.cwd(),
): OfficialEntitySourceArtifact[] {
  if (value === undefined) return []
  const root = asRecord(value, 'provenance manifest')
  if (!Array.isArray(root.sourceArtifacts)) {
    throw new Error('provenance manifest.sourceArtifacts must be an array')
  }
  const sourceIds = new Set<string>()
  const fetchIds = new Set<string>()
  const catalogArtifacts = root.sourceArtifacts.filter(
    (item) => optionalRecord(item)?.role !== 'dependency',
  )
  const artifacts = catalogArtifacts.map((item, index) => {
    const label = `provenance manifest.sourceArtifacts[${index}]`
    const artifact = asRecord(item, label)
    const sourceId = nonEmptyString(artifact.sourceId, `${label}.sourceId`)
    const fetchId = nonEmptyString(artifact.fetchId, `${label}.fetchId`)
    const localPath = resolveArtifactPath(
      baseDirectory,
      artifact.localPath,
      `${label}.localPath`,
    )
    const artifactSha256 = nonEmptyString(
      artifact.artifactSha256,
      `${label}.artifactSha256`,
    ).toLowerCase()
    if (!/^[0-9a-f]{64}$/u.test(artifactSha256)) {
      throw new Error(`${label}.artifactSha256 must be a lowercase SHA-256 digest`)
    }
    const artifactUri = nonEmptyString(artifact.artifactUri, `${label}.artifactUri`)
    const artifactUriMatch =
      /^r2:\/\/studyinchina-source-snapshots\/source-artifacts\/[0-9a-f]{24}\/([0-9a-f]{64})\.[a-z0-9]{1,12}$/u
        .exec(artifactUri)
    if (!artifactUriMatch || artifactUriMatch[1] !== artifactSha256) {
      throw new Error(
        `${label}.artifactUri must be the deterministic private content-addressed R2 URI`,
      )
    }
    const contentType = nonEmptyString(artifact.contentType, `${label}.contentType`)
    const byteLength = artifact.byteLength
    if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error(`${label}.byteLength must be a non-negative integer`)
    }
    const capturedAt = isoTimestamp(
      nonEmptyString(artifact.capturedAt, `${label}.capturedAt`),
      `${label}.capturedAt`,
    )
    if (typeof artifact.isFixture !== 'boolean') {
      throw new Error(`${label}.isFixture must be boolean`)
    }
    if (sourceIds.has(sourceId)) throw new Error(`duplicate provenance sourceId ${sourceId}`)
    if (fetchIds.has(fetchId)) throw new Error(`duplicate provenance fetchId ${fetchId}`)
    sourceIds.add(sourceId)
    fetchIds.add(fetchId)
    const bytes = readFileSync(localPath)
    if (bytes.byteLength !== byteLength) {
      throw new Error(`${label}.byteLength does not match localPath`)
    }
    if (createHash('sha256').update(bytes).digest('hex') !== artifactSha256) {
      throw new Error(`${label}.artifactSha256 does not match localPath`)
    }
    return {
      sourceId,
      fetchId,
      localPath,
      artifactSha256,
      artifactUri,
      contentType,
      byteLength,
      capturedAt,
      isFixture: artifact.isFixture,
      captureMode: artifact.isFixture ? 'fixture' as const : 'live' as const,
    }
  })
  return artifacts.sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'))
}

function inputContainsFixture(input: unknown): boolean {
  const documents = Array.isArray(input) ? input : [input]
  return documents.some((value) => optionalRecord(value)?.sourceMode === 'fixture')
}

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${value.replaceAll("'", "''")}'`
}

function isoTimestamp(value: string, label: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return timestamp.toISOString()
}

function reviewAfter(checkedAt: string): string {
  const date = new Date(checkedAt)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + 30)
  return date.toISOString().slice(0, 10)
}

function canonicalHost(value: unknown, label: string): string {
  const host = nonEmptyString(value, label).toLowerCase().replace(/\.$/u, '')
  if (
    host.includes('/')
    || host.includes(':')
    || host.includes('*')
    || host === 'localhost'
    || isIP(host) !== 0
  ) {
    throw new Error(`${label} must be a registrable official hostname`)
  }
  return host
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

function officialUrl(
  value: unknown,
  allowedHosts: readonly string[],
  label: string,
): string {
  let url: URL
  try {
    url = new URL(nonEmptyString(value, label))
  } catch {
    throw new Error(`${label} must be a valid official HTTPS URL`)
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || isIP(hostname) !== 0
    || !hostAllowed(hostname, allowedHosts)
  ) {
    throw new Error(`${label} is not on an allowed official HTTPS host`)
  }
  url.hash = ''
  return url.href
}

function sourceMetadata(root: JsonRecord): SourceMetadataInput {
  const source = optionalRecord(root.source)
  const hosts = source?.officialHosts
  const officialHosts = Array.isArray(hosts)
    ? [...new Set(hosts.map((host, index) => canonicalHost(
      host,
      `source.officialHosts[${index}]`,
    )))]
    : []
  return {
    title: optionalString(source?.title) ?? undefined,
    publisher: optionalString(source?.publisher) ?? undefined,
    reviewedBy: optionalString(source?.reviewedBy) ?? undefined,
    languageCode: optionalString(source?.languageCode) ?? undefined,
    officialHosts,
  }
}

function entityNames(entity: JsonRecord): { nameEn: string | null; nameZh: string | null } {
  const name = optionalRecord(entity.name)
  const nameEn = optionalString(entity.nameEn) ?? optionalString(name?.en)
  const nameZh = optionalString(entity.nameZh) ?? optionalString(name?.zh)
  if (!nameEn && !nameZh) throw new Error('entity must provide nameEn, nameZh, or name.{en,zh}')
  return { nameEn, nameZh }
}

function inferLocatorType(locator: string): LocatorType {
  if (locator.startsWith('json:') || locator.startsWith('/')) return 'json_pointer'
  if (locator.startsWith('xpath:')) return 'xpath'
  if (locator.startsWith('css:')) return 'css'
  if (/^page\s+\d+/iu.test(locator)) return 'pdf_page'
  return 'manual'
}

function normalizeEvidence(
  value: unknown,
  fallbackCheckedAt: string | null,
  allowedHosts: readonly string[],
  label: string,
): NormalizedEvidence[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  if (values.length === 0) throw new Error(`${label} must contain official evidence`)
  return values.map((item, index) => {
    const evidence = asRecord(item, `${label}[${index}]`)
    const locator = nonEmptyString(evidence.locator, `${label}[${index}].locator`)
    const quote = nonEmptyString(evidence.quote, `${label}[${index}].quote`)
      .slice(0, MAX_EVIDENCE_QUOTE_LENGTH)
    const checkedAtValue = optionalString(evidence.checkedAt) ?? fallbackCheckedAt
    if (!checkedAtValue) throw new Error(`${label}[${index}].checkedAt is required`)
    const rawFieldPaths = evidence.fieldPaths
    const fieldPaths = rawFieldPaths === undefined
      ? null
      : Array.isArray(rawFieldPaths)
        ? [...new Set(rawFieldPaths.map((path, pathIndex) => nonEmptyString(
          path,
          `${label}[${index}].fieldPaths[${pathIndex}]`,
        )))]
        : (() => {
          throw new Error(`${label}[${index}].fieldPaths must be an array`)
        })()
    const explicitLocatorType = optionalString(evidence.locatorType)
    const locatorType = explicitLocatorType
      ? oneOf(explicitLocatorType, ALLOWED_LOCATOR_TYPES, `${label}[${index}].locatorType`)
      : inferLocatorType(locator)
    return {
      locatorType,
      locator,
      quote,
      officialUrl: officialUrl(
        evidence.officialUrl,
        allowedHosts,
        `${label}[${index}].officialUrl`,
      ),
      checkedAt: isoTimestamp(checkedAtValue, `${label}[${index}].checkedAt`),
      fieldPaths,
    }
  })
}

function normalizeEntity(
  value: unknown,
  index: number,
  rootCheckedAt: string | null,
  metadata: SourceMetadataInput,
): NormalizedEntity {
  const entity = asRecord(value, `entities[${index}]`)
  const entityType = oneOf(
    entity.entityType,
    new Set<EntityKind>(['program', 'scholarship']),
    `entities[${index}].entityType`,
  )
  const entityKey = nonEmptyString(entity.entityKey, `entities[${index}].entityKey`)
    .toLocaleLowerCase('en-US')
  if (entityKey.length > 512) throw new Error(`entities[${index}].entityKey is too long`)
  const institutionId = entityType === 'program'
    ? nonEmptyString(entity.institutionId, `entities[${index}].institutionId`)
    : optionalString(entity.institutionId)
  const providerOrganizationId = entityType === 'scholarship'
    ? nonEmptyString(
      entity.providerOrganizationId,
      `entities[${index}].providerOrganizationId`,
    )
    : null
  const ownerOrganizationId = institutionId ?? providerOrganizationId
  if (!ownerOrganizationId) throw new Error(`entities[${index}] has no official owner`)
  const registeredHosts = MATERIALIZER_OWNER_HOSTS[ownerOrganizationId]
  if (!registeredHosts?.length) {
    throw new Error(
      `entities[${index}] has unknown owner ${ownerOrganizationId}; no registered official hosts`,
    )
  }
  const allowedHosts = [...registeredHosts]
  for (const declaredHost of metadata.officialHosts) {
    if (!hostAllowed(declaredHost, allowedHosts)) {
      throw new Error(
        `source.officialHosts declares ${declaredHost}, which is not registered for owner ${ownerOrganizationId}`,
      )
    }
  }

  const declaredCheckedAt =
    optionalString(entity.sourceCheckedAt)
    ?? optionalString(entity.checkedAt)
    ?? rootCheckedAt
  const evidence = normalizeEvidence(
    entity.evidence,
    declaredCheckedAt,
    allowedHosts,
    `entities[${index}].evidence`,
  )
  const checkedAt = [declaredCheckedAt, ...evidence.map((item) => item.checkedAt)]
    .filter((item): item is string => item !== null)
    .map((item) => isoTimestamp(item, `entities[${index}].checkedAt`))
    .sort()
    .at(-1)!
  const names = entityNames(entity)
  const programType = entityType === 'program'
    ? oneOf(
      entity.programType ?? 'degree',
      PROGRAM_TYPES,
      `entities[${index}].programType`,
    )
    : null
  const degreeLevelValue = optionalString(entity.degreeLevel)
  const degreeLevel = degreeLevelValue
    ? oneOf(degreeLevelValue, DEGREE_LEVELS, `entities[${index}].degreeLevel`)
    : null
  if (programType === 'degree' && !degreeLevel) {
    throw new Error(`entities[${index}].degreeLevel is required for a degree program`)
  }
  if (programType !== 'degree' && degreeLevel) {
    throw new Error(`entities[${index}].degreeLevel must be absent for a non-degree program`)
  }
  const schemeType = entityType === 'scholarship'
    ? oneOf(
      entity.schemeType ?? 'other',
      SCHEME_TYPES,
      `entities[${index}].schemeType`,
    )
    : null
  const attendanceMode = entityType === 'program'
    ? oneOf(
      entity.attendanceMode ?? 'full_time',
      ATTENDANCE_MODES,
      `entities[${index}].attendanceMode`,
    ) as NormalizedEntity['attendanceMode']
    : 'full_time'
  const deliveryMode = entityType === 'program'
    ? oneOf(
      entity.deliveryMode ?? 'on_campus',
      DELIVERY_MODES,
      `entities[${index}].deliveryMode`,
    ) as NormalizedEntity['deliveryMode']
    : 'on_campus'
  return {
    entityType,
    entityKey,
    ownerOrganizationId,
    institutionId,
    providerOrganizationId,
    programType,
    degreeLevel,
    schemeType,
    attendanceMode,
    deliveryMode,
    ...names,
    officialUrl: officialUrl(
      entity.officialUrl,
      allowedHosts,
      `entities[${index}].officialUrl`,
    ),
    checkedAt,
    reviewAfter: reviewAfter(checkedAt),
    evidence,
    sourceMetadata: metadata,
  }
}

function normalizedEntityDocument(input: unknown): {
  root: JsonRecord
  metadata: SourceMetadataInput
  entities: NormalizedEntity[]
  ignoredCycleHints: number
} {
  const root = asRecord(input, 'input')
  if (!Array.isArray(root.entities) || root.entities.length === 0) {
    throw new Error('input.entities must be a non-empty array')
  }
  const metadata = sourceMetadata(root)
  const rootCheckedAt = optionalString(root.checkedAt)
  const entities = root.entities
    .map((entity, index) => normalizeEntity(entity, index, rootCheckedAt, metadata))
    .sort((left, right) => (
      `${left.entityType}:${left.entityKey}`.localeCompare(
        `${right.entityType}:${right.entityKey}`,
        'en',
      )
    ))
  const ignoredCycleHints = root.entities.filter((value) => {
    const entity = optionalRecord(value)
    return Boolean(entity && (
      entity.academicYear !== undefined
      || entity.deadline !== undefined
      || entity.applicationDeadline !== undefined
    ))
  }).length
  return { root, metadata, entities, ignoredCycleHints }
}

function normalizedEntityIdentity(entity: NormalizedEntity): string {
  return [
    entity.entityType,
    entity.ownerOrganizationId,
    entity.entityKey,
  ].join('\u0000')
}

function normalizedEntityKey(entity: NormalizedEntity): string {
  return `${entity.entityType}\u0000${entity.entityKey}`
}

function normalizedEntities(input: unknown): {
  entities: NormalizedEntity[]
  ignoredCycleHints: number
} {
  const documents = officialEntityInputDocuments(input)
    .map((document) => normalizedEntityDocument(document))
  const candidates = documents
    .flatMap((document) => document.entities)
    .sort((left, right) => (
      normalizedEntityIdentity(left).localeCompare(
        normalizedEntityIdentity(right),
        'en',
      )
    ))
  const entitiesByIdentity = new Map<string, NormalizedEntity>()
  const identityByEntityKey = new Map<string, string>()
  for (const entity of candidates) {
    const identity = normalizedEntityIdentity(entity)
    const entityKey = normalizedEntityKey(entity)
    const identityForKey = identityByEntityKey.get(entityKey)
    if (identityForKey && identityForKey !== identity) {
      throw new Error(
        `official entity key ${JSON.stringify(entity.entityKey)} maps to conflicting identities`,
      )
    }
    identityByEntityKey.set(entityKey, identity)
    const existing = entitiesByIdentity.get(identity)
    if (existing && stableJson(existing) !== stableJson(entity)) {
      throw new Error(
        `conflicting duplicate official entity identity: ${entity.entityType}:${entity.entityKey}`,
      )
    }
    if (!existing) entitiesByIdentity.set(identity, entity)
  }
  return {
    entities: [...entitiesByIdentity.values()],
    ignoredCycleHints: documents.reduce(
      (total, document) => total + document.ignoredCycleHints,
      0,
    ),
  }
}

function evidenceForField(
  entity: NormalizedEntity,
  fieldPath: string,
): NormalizedEvidence[] {
  const evidence = entity.evidence.filter((item) => (
    item.fieldPaths === null || item.fieldPaths.includes(fieldPath)
  ))
  if (evidence.length === 0) {
    throw new Error(`${entity.entityKey}.${fieldPath} lacks field-level official evidence`)
  }
  return evidence
}

function prepare(
  input: unknown,
  options: OfficialEntityMaterializationOptions,
): {
  batchId: string
  provenanceStatus: ProvenanceStatus
  sourceArtifacts: OfficialEntitySourceArtifact[]
  records: PreparedRecord[]
  sources: PreparedSource[]
  fetches: PreparedFetch[]
  fragments: PreparedFragment[]
  prerequisiteInstitutionIds: string[]
  prerequisiteProviderOrganizationIds: string[]
  ignoredCycleHints: number
  generatedAt: string
} {
  const normalized = normalizedEntities(input)
  const artifactJson = stableJson(normalized.entities)
  const artifactSha256 = sha256(artifactJson)
  const sourceArtifacts = normalizeSourceArtifacts(
    options.provenanceManifest,
    options.provenanceBaseDirectory,
  )
  const sourceArtifactsById = new Map(
    sourceArtifacts.map((artifact) => [artifact.sourceId, artifact]),
  )
  const sources = new Map<string, PreparedSource>()
  const fetches = new Map<string, PreparedFetch>()
  const fragments = new Map<string, PreparedFragment>()
  const records: PreparedRecord[] = []

  for (const entity of normalized.entities) {
    const identityHash = sha256(
      `${entity.entityType}\u0000${entity.ownerOrganizationId}\u0000${entity.entityKey}`,
    )
    const recordId = `${entity.entityType}-${identityHash}`
    const facts: PreparedFact[] = []
    const addFact = (
      fieldPath: string,
      locale: string,
      valueType: PreparedFact['valueType'],
      value: string,
    ) => {
      const matchingEvidence = evidenceForField(entity, fieldPath)
      const fragmentIds: string[] = []
      for (const evidence of matchingEvidence) {
        const sourceId = `source-document-${sha256(evidence.officialUrl).slice(0, 24)}`
        const source: PreparedSource = {
          id: sourceId,
          publicId: sourceId,
          url: evidence.officialUrl,
          publisherOrganizationId: entity.ownerOrganizationId,
          sourceKind: entity.entityType,
          languageCode: entity.sourceMetadata.languageCode ?? 'other',
          title: entity.sourceMetadata.title
            ?? `Official ${entity.entityType} source — ${entity.ownerOrganizationId}`,
          publisher: entity.sourceMetadata.publisher ?? entity.ownerOrganizationId,
          reviewedBy: entity.sourceMetadata.reviewedBy ?? MATERIALIZER_VERSION,
          reviewedAt: evidence.checkedAt,
        }
        const existingSource = sources.get(sourceId)
        if (
          existingSource
          && existingSource.publisherOrganizationId !== source.publisherOrganizationId
        ) {
          throw new Error(`official source ${source.url} has conflicting publishers`)
        }
        if (!existingSource || existingSource.reviewedAt < source.reviewedAt) {
          sources.set(sourceId, source)
        }
        const sourceArtifact = sourceArtifactsById.get(sourceId)
        const fetchId = sourceArtifact?.fetchId ?? `fetch-${sha256([
          sourceId,
          evidence.checkedAt,
        ].join('\u0000'))}`
        if (!fetches.has(fetchId)) {
          fetches.set(fetchId, {
            id: fetchId,
            sourceId,
            checkedAt: sourceArtifact?.capturedAt ?? evidence.checkedAt,
            status: sourceArtifact ? 'succeeded' : 'queued',
            completedAt: sourceArtifact?.capturedAt ?? null,
            contentType: sourceArtifact?.contentType ?? null,
            contentLength: sourceArtifact?.byteLength ?? null,
            sha256: sourceArtifact?.artifactSha256 ?? null,
            artifactUri: sourceArtifact?.artifactUri ?? null,
          })
        }
        const fragmentId = `fragment-${sha256([
          fetchId,
          evidence.locatorType,
          evidence.locator,
          evidence.quote,
        ].join('\u0000'))}`
        if (!fragments.has(fragmentId)) {
          fragments.set(fragmentId, {
            id: fragmentId,
            fetchId,
            locatorType: evidence.locatorType,
            locator: evidence.locator,
            quote: evidence.quote,
            sha256: sha256(evidence.quote),
          })
        }
        fragmentIds.push(fragmentId)
      }
      facts.push({
        recordId,
        recordKind: entity.entityType,
        fieldPath,
        locale,
        valueType,
        value,
        checkedAt: entity.checkedAt,
        reviewAfter: entity.reviewAfter,
        fragmentIds: [...new Set(fragmentIds)].sort(),
      })
    }

    if (entity.nameEn) addFact('localized.name', 'en', 'localized_string', entity.nameEn)
    if (entity.nameZh) addFact('localized.name', 'zh', 'localized_string', entity.nameZh)
    addFact('official_url', '', 'url', entity.officialUrl)
    if (entity.entityType === 'program') {
      addFact('program_type', '', 'string', entity.programType!)
      if (entity.degreeLevel) addFact('degree_level', '', 'string', entity.degreeLevel)
    }
    records.push({
      id: recordId,
      publicId: recordId,
      slug: `${entity.entityType}-${identityHash.slice(0, 24)}`,
      kind: entity.entityType,
      entity,
      facts,
    })
  }

  const sortedSources = [...sources.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
  for (const artifact of sourceArtifacts) {
    if (!sources.has(artifact.sourceId)) {
      throw new Error(`provenance sourceId ${artifact.sourceId} is not used by official evidence`)
    }
    if (!fetches.has(artifact.fetchId)) {
      throw new Error(`provenance fetchId ${artifact.fetchId} is not used by official evidence`)
    }
    if (![...fragments.values()].some((fragment) => fragment.fetchId === artifact.fetchId)) {
      throw new Error(`provenance sourceId ${artifact.sourceId} has no primary evidence fragment`)
    }
  }
  const completeProvenance = sourceArtifacts.length === sortedSources.length
    && sortedSources.every((source) => sourceArtifactsById.has(source.id))
    && sourceArtifacts.every((artifact) => !artifact.isFixture)
  const provenanceStatus: ProvenanceStatus = sourceArtifacts.some(
    (artifact) => artifact.isFixture,
  ) || inputContainsFixture(input)
    ? 'fixture'
    : completeProvenance ? 'complete' : 'derived_only'

  return {
    batchId: artifactSha256,
    provenanceStatus,
    sourceArtifacts,
    records,
    sources: sortedSources,
    fetches: [...fetches.values()].sort((left, right) => left.id.localeCompare(right.id)),
    fragments: [...fragments.values()].sort((left, right) => left.id.localeCompare(right.id)),
    prerequisiteInstitutionIds: [...new Set(
      normalized.entities
        .map((entity) => entity.institutionId)
        .filter((value): value is string => value !== null),
    )].sort(),
    prerequisiteProviderOrganizationIds: [...new Set(
      normalized.entities
        .map((entity) => entity.providerOrganizationId)
        .filter((value): value is string => value !== null),
    )].sort(),
    ignoredCycleHints: normalized.ignoredCycleHints,
    generatedAt: normalized.entities.map((entity) => entity.checkedAt).sort().at(-1)!,
  }
}

function dependencyGuardStatements(
  prepared: ReturnType<typeof prepare>,
): string[] {
  const statements: string[] = []
  for (const institutionId of prepared.prerequisiteInstitutionIds) {
    const guardId = `guard-${sha256(`institution\u0000${institutionId}`).slice(0, 32)}`
    statements.push(`
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action, subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(prepared.generatedAt)},
  CASE WHEN EXISTS (
    SELECT 1
    FROM institutions institution
    JOIN organizations organization ON organization.record_id = institution.record_id
    JOIN records record ON record.id = institution.record_id
    WHERE institution.record_id = ${sqlValue(institutionId)}
      AND record.kind = 'organization'
  ) THEN 'system' ELSE 'missing_dependency' END,
  ${sqlValue(MATERIALIZER_VERSION)}, 'dependency_guard', 'institution',
  ${sqlValue(institutionId)}, 'Official entity materialization prerequisite'
);
DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`.trim())
  }
  for (const providerId of prepared.prerequisiteProviderOrganizationIds) {
    const guardId = `guard-${sha256(`provider\u0000${providerId}`).slice(0, 32)}`
    statements.push(`
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action, subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(prepared.generatedAt)},
  CASE WHEN EXISTS (
    SELECT 1
    FROM organizations organization
    JOIN records record ON record.id = organization.record_id
    WHERE organization.record_id = ${sqlValue(providerId)}
      AND record.kind = 'organization'
  ) THEN 'system' ELSE 'missing_dependency' END,
  ${sqlValue(MATERIALIZER_VERSION)}, 'dependency_guard', 'organization',
  ${sqlValue(providerId)}, 'Official scholarship provider prerequisite'
);
DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`.trim())
  }
  return statements
}

function fieldDefinitionStatements(): string[] {
  return FIELD_DEFINITIONS.map((definition) => `
INSERT INTO field_definitions (
  record_kind, field_path, value_type, risk_class,
  required_for_publish, max_age_days, validation_profile
) VALUES (
  ${sqlValue(definition.recordKind)}, ${sqlValue(definition.fieldPath)},
  ${sqlValue(definition.valueType)}, ${sqlValue(definition.riskClass)},
  ${definition.requiredForPublish}, 30, ${sqlValue(definition.validationProfile)}
)
ON CONFLICT(record_kind, field_path) DO NOTHING;`.trim())
}

function sourceStatements(source: PreparedSource, generatedAt: string): string[] {
  return [
    `
INSERT INTO source_documents (
  id, public_id, canonical_url, publisher_organization_id, source_kind,
  authority_level, official, language_code, active, fetch_cadence_minutes,
  robots_policy, created_at, updated_at
) VALUES (
  ${sqlValue(source.id)}, ${sqlValue(source.publicId)}, ${sqlValue(source.url)},
  ${sqlValue(source.publisherOrganizationId)}, ${sqlValue(source.sourceKind)},
  'primary_official', 1, ${sqlValue(source.languageCode)}, 1, NULL,
  'unknown', ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  canonical_url = excluded.canonical_url,
  publisher_organization_id = excluded.publisher_organization_id,
  source_kind = excluded.source_kind,
  authority_level = 'primary_official',
  official = 1,
  language_code = excluded.language_code,
  active = 1,
  updated_at = CASE
    WHEN source_documents.canonical_url <> excluded.canonical_url
      OR source_documents.publisher_organization_id IS NOT excluded.publisher_organization_id
      OR source_documents.source_kind <> excluded.source_kind
      OR source_documents.authority_level <> 'primary_official'
      OR source_documents.official <> 1
      OR source_documents.language_code <> excluded.language_code
      OR source_documents.active <> 1
    THEN excluded.updated_at
    ELSE source_documents.updated_at
  END;`.trim(),
    `
INSERT INTO publication_source_metadata (
  source_id, title, publisher, reviewed_by, reviewed_at, updated_at
) VALUES (
  ${sqlValue(source.id)}, ${sqlValue(source.title)}, ${sqlValue(source.publisher)},
  ${sqlValue(source.reviewedBy)}, ${sqlValue(source.reviewedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(source_id) DO UPDATE SET
  title = excluded.title,
  publisher = excluded.publisher,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = CASE
    WHEN publication_source_metadata.reviewed_at < excluded.reviewed_at
    THEN excluded.reviewed_at
    ELSE publication_source_metadata.reviewed_at
  END,
  updated_at = CASE
    WHEN publication_source_metadata.title <> excluded.title
      OR publication_source_metadata.publisher <> excluded.publisher
      OR publication_source_metadata.reviewed_by <> excluded.reviewed_by
      OR publication_source_metadata.reviewed_at < excluded.reviewed_at
    THEN excluded.updated_at
    ELSE publication_source_metadata.updated_at
  END;`.trim(),
  ]
}

function fetchStatement(fetch: PreparedFetch): string {
  return `
INSERT INTO source_fetches (
  id, source_id, status, requested_at, completed_at, http_status,
  content_type, content_length, sha256, artifact_uri, parser_key,
  parser_version, metadata_json
) VALUES (
  ${sqlValue(fetch.id)}, ${sqlValue(fetch.sourceId)}, ${sqlValue(fetch.status)},
  ${sqlValue(fetch.checkedAt)}, ${sqlValue(fetch.completedAt)}, NULL,
  ${sqlValue(fetch.contentType)}, ${sqlValue(fetch.contentLength)}, ${sqlValue(fetch.sha256)},
  ${sqlValue(fetch.artifactUri)}, 'official-entity-materializer', '1',
  ${sqlValue(stableJson({
    normalizedOfficialEntities: true,
    provenanceBacked: fetch.status === 'succeeded',
  }))}
)
ON CONFLICT(id) DO UPDATE SET
  status = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.status
    ELSE excluded.status
  END,
  completed_at = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.completed_at
    ELSE excluded.completed_at
  END,
  content_type = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.content_type
    ELSE excluded.content_type
  END,
  content_length = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.content_length
    ELSE excluded.content_length
  END,
  sha256 = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.sha256
    ELSE excluded.sha256
  END,
  artifact_uri = CASE
    WHEN source_fetches.status = 'succeeded' THEN source_fetches.artifact_uri
    ELSE excluded.artifact_uri
  END,
  parser_key = excluded.parser_key,
  parser_version = excluded.parser_version,
  metadata_json = excluded.metadata_json;`.trim()
}


function fragmentStatement(fragment: PreparedFragment): string {
  return `
INSERT OR IGNORE INTO source_fragments (
  id, fetch_id, locator_type, locator, page_number,
  text_excerpt, sha256, created_at
) VALUES (
  ${sqlValue(fragment.id)}, ${sqlValue(fragment.fetchId)},
  ${sqlValue(fragment.locatorType)}, ${sqlValue(fragment.locator)}, NULL,
  ${sqlValue(fragment.quote)}, ${sqlValue(fragment.sha256)}, CURRENT_TIMESTAMP
);`.trim()
}

function recordStatements(record: PreparedRecord, generatedAt: string): string[] {
  const entity = record.entity
  const statements = [
    `
INSERT INTO records (
  id, public_id, kind, slug, workflow_status, review_after,
  row_version, created_at, updated_at
) VALUES (
  ${sqlValue(record.id)}, ${sqlValue(record.publicId)}, ${sqlValue(record.kind)},
  ${sqlValue(record.slug)}, 'draft', ${sqlValue(entity.reviewAfter)}, 1,
  ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  review_after = excluded.review_after,
  updated_at = CASE
    WHEN records.review_after IS NOT excluded.review_after THEN excluded.updated_at
    ELSE records.updated_at
  END;`.trim(),
    `
INSERT INTO record_slugs (record_id, slug, valid_from, valid_to, is_current)
VALUES (
  ${sqlValue(record.id)}, ${sqlValue(record.slug)},
  ${sqlValue(generatedAt)}, NULL, 1
)
ON CONFLICT(record_id, slug) DO UPDATE SET
  valid_to = NULL,
  is_current = 1;`.trim(),
  ]
  if (record.kind === 'program') {
    statements.push(`
INSERT INTO programs (
  record_id, institution_id, academic_unit_id, parent_program_id,
  program_type, degree_level, credential_type, attendance_mode,
  delivery_mode, duration_min, duration_max, duration_unit, official_url
) VALUES (
  ${sqlValue(record.id)}, ${sqlValue(entity.institutionId)}, NULL, NULL,
  ${sqlValue(entity.programType)}, ${sqlValue(entity.degreeLevel)}, NULL,
  ${sqlValue(entity.attendanceMode)}, ${sqlValue(entity.deliveryMode)},
  NULL, NULL, NULL, ${sqlValue(entity.officialUrl)}
)
ON CONFLICT(record_id) DO UPDATE SET
  institution_id = excluded.institution_id,
  program_type = excluded.program_type,
  degree_level = excluded.degree_level,
  attendance_mode = excluded.attendance_mode,
  delivery_mode = excluded.delivery_mode,
  official_url = excluded.official_url;`.trim())
  } else {
    statements.push(`
INSERT INTO scholarships (
  record_id, provider_organization_id, scheme_type, official_url
) VALUES (
  ${sqlValue(record.id)}, ${sqlValue(entity.providerOrganizationId)},
  ${sqlValue(entity.schemeType)}, ${sqlValue(entity.officialUrl)}
)
ON CONFLICT(record_id) DO UPDATE SET
  provider_organization_id = excluded.provider_organization_id,
  scheme_type = excluded.scheme_type,
  official_url = excluded.official_url;`.trim())
  }
  if (entity.nameEn) {
    statements.push(localizedStatement(record.id, 'en', entity.nameEn, generatedAt))
  }
  if (entity.nameZh) {
    statements.push(localizedStatement(record.id, 'zh', entity.nameZh, generatedAt))
  }
  return statements
}

function localizedStatement(
  recordId: string,
  locale: string,
  text: string,
  generatedAt: string,
): string {
  return `
INSERT INTO localized_content (
  record_id, locale, field_name, text_value,
  translation_status, source_locale, updated_at
) VALUES (
  ${sqlValue(recordId)}, ${sqlValue(locale)}, 'name', ${sqlValue(text)},
  'published', ${sqlValue(locale)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(record_id, locale, field_name) DO UPDATE SET
  text_value = excluded.text_value,
  translation_status = 'published',
  source_locale = excluded.source_locale,
  updated_at = CASE
    WHEN localized_content.text_value <> excluded.text_value
      OR localized_content.translation_status <> 'published'
      OR localized_content.source_locale IS NOT excluded.source_locale
    THEN excluded.updated_at
    ELSE localized_content.updated_at
  END;`.trim()
}

function claimStatements(fact: PreparedFact): string[] {
  const claimId = `claim-${sha256([
    fact.recordId,
    fact.fieldPath,
    fact.locale,
    stableJson(fact.value),
    fact.checkedAt,
    ...fact.fragmentIds,
  ].join('\u0000'))}`
  const statements = [
    `
INSERT OR IGNORE INTO claims (
  id, subject_record_id, field_path, locale, value_type,
  raw_value_text, normalized_value_json, confidence,
  extraction_method, extractor_version, claim_status,
  provenance_precision, discovered_at, decided_at
) VALUES (
  ${sqlValue(claimId)}, ${sqlValue(fact.recordId)}, ${sqlValue(fact.fieldPath)},
  ${sqlValue(fact.locale)}, ${sqlValue(fact.valueType)}, ${sqlValue(fact.value)},
  ${sqlValue(stableJson(fact.value))}, 1.0, 'api',
  ${sqlValue(MATERIALIZER_VERSION)}, 'candidate', 'field',
  ${sqlValue(fact.checkedAt)}, NULL
);`.trim(),
  ]
  for (const fragmentId of fact.fragmentIds) {
    statements.push(`
INSERT OR IGNORE INTO claim_evidence (
  claim_id, fragment_id, evidence_role
) VALUES (
  ${sqlValue(claimId)}, ${sqlValue(fragmentId)}, 'primary'
);`.trim())
  }
  statements.push(
    `
UPDATE claims
SET claim_status = 'validated', decided_at = NULL
WHERE id = ${sqlValue(claimId)}
  AND claim_status = 'candidate';`.trim(),
    `
UPDATE claims
SET claim_status = 'accepted', decided_at = ${sqlValue(fact.checkedAt)}
WHERE id = ${sqlValue(claimId)}
  AND claim_status = 'validated';`.trim(),
    `
INSERT INTO canonical_fields (
  subject_record_id, field_path, locale, field_status,
  claim_id, value_json, verified_at, review_after, updated_at
)
SELECT
  ${sqlValue(fact.recordId)}, ${sqlValue(fact.fieldPath)}, ${sqlValue(fact.locale)},
  'accepted', ${sqlValue(claimId)}, ${sqlValue(stableJson(fact.value))},
  ${sqlValue(fact.checkedAt)}, ${sqlValue(fact.reviewAfter)}, ${sqlValue(fact.checkedAt)}
FROM claims
WHERE id = ${sqlValue(claimId)} AND claim_status = 'accepted'
ON CONFLICT(subject_record_id, field_path, locale) DO UPDATE SET
  field_status = 'accepted',
  claim_id = excluded.claim_id,
  value_json = excluded.value_json,
  verified_at = excluded.verified_at,
  review_after = excluded.review_after,
  updated_at = excluded.updated_at;`.trim(),
    `
UPDATE claims
SET claim_status = 'superseded', decided_at = ${sqlValue(fact.checkedAt)}
WHERE subject_record_id = ${sqlValue(fact.recordId)}
  AND field_path = ${sqlValue(fact.fieldPath)}
  AND locale = ${sqlValue(fact.locale)}
  AND claim_status = 'accepted'
  AND id <> ${sqlValue(claimId)};`.trim(),
  )
  return statements
}

function canonicalGuardStatement(record: PreparedRecord): string {
  const guardId = `guard-${sha256(`canonical\u0000${record.id}`).slice(0, 32)}`
  const factKeys = record.facts
    .map((fact) => `(${sqlValue(fact.fieldPath)}, ${sqlValue(fact.locale)})`)
    .join(', ')
  return `
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action, subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(record.entity.checkedAt)},
  CASE WHEN (
    SELECT COUNT(*)
    FROM canonical_fields
    WHERE subject_record_id = ${sqlValue(record.id)}
      AND field_status = 'accepted'
      AND (field_path, locale) IN (${factKeys})
  ) = ${record.facts.length}
  THEN 'system' ELSE 'incomplete_materialization' END,
  ${sqlValue(MATERIALIZER_VERSION)}, 'canonical_guard',
  ${sqlValue(record.kind)}, ${sqlValue(record.id)},
  'All canonical fields must be accepted before workflow application'
);
DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`.trim()
}

function materializationCounts(prepared: ReturnType<typeof prepare>) {
  return {
    records: prepared.records.length,
    recordSlugs: prepared.records.length,
    programs: prepared.records.filter((record) => record.kind === 'program').length,
    scholarships: prepared.records.filter((record) => record.kind === 'scholarship').length,
    organizations: 0 as const,
    locations: 0 as const,
    localizedContent: prepared.records.reduce(
      (total, record) => total + Number(Boolean(record.entity.nameEn))
        + Number(Boolean(record.entity.nameZh)),
      0,
    ),
    sourceDocuments: prepared.sources.length,
    sourceFetches: prepared.fetches.length,
    sourceFragments: prepared.fragments.length,
    claims: prepared.records.reduce((total, record) => total + record.facts.length, 0),
    canonicalFields: prepared.records.reduce((total, record) => total + record.facts.length, 0),
    programCycles: 0 as const,
    scholarshipCycles: 0 as const,
  }
}


export function buildOfficialEntityMaterialization(
  input: unknown,
  options: OfficialEntityMaterializationOptions = {},
): OfficialEntityMaterializationArtifacts {
  const prepared = prepare(input, options)
  const counts = materializationCounts(prepared)
  const statements = [
    '-- Generated by scripts/ingestion/materialize-official-entities.ts. Do not edit.',
    '-- Entity identity only: this script intentionally creates no cycles or deadlines.',
    '-- Batch reservation, evidence binding, validation, and apply are owned by the strict importer.',
    'PRAGMA foreign_keys = ON;',
    ...dependencyGuardStatements(prepared),
    ...fieldDefinitionStatements(),
  ]
  for (const source of prepared.sources) {
    statements.push(...sourceStatements(source, prepared.generatedAt))
  }
  for (const fetch of prepared.fetches) statements.push(fetchStatement(fetch))
  for (const fragment of prepared.fragments) statements.push(fragmentStatement(fragment))
  for (const record of prepared.records) {
    statements.push(...recordStatements(record, prepared.generatedAt))
    for (const fact of record.facts) statements.push(...claimStatements(fact))
    statements.push(canonicalGuardStatement(record))
  }
  statements.push('PRAGMA optimize;')
  const maxSqlStatementBytes = Math.max(
    ...statements.map((statement) => Buffer.byteLength(statement, 'utf8')),
  )
  if (maxSqlStatementBytes >= MAX_SQL_STATEMENT_BYTES) {
    throw new Error(
      `generated SQL statement is ${maxSqlStatementBytes} bytes; limit is below ${MAX_SQL_STATEMENT_BYTES}`,
    )
  }
  const sql = `${statements.join('\n')}\n`
  const prerequisiteOrganizationIds = [...new Set([
    ...prepared.prerequisiteInstitutionIds,
    ...prepared.prerequisiteProviderOrganizationIds,
  ])].sort()
  const prerequisiteLocationIds = [...new Set(
    prerequisiteOrganizationIds
      .map((organizationId) => INSTITUTION_LOCATION_DEPENDENCIES[organizationId])
      .filter((value): value is string => Boolean(value)),
  )].sort()
  const dependencyRecords: OfficialEntityMaterializationManifest['dependencyRecords'] = [
    ...prerequisiteOrganizationIds.map((recordId) => ({ recordId, recordKind: 'organization' as const })),
    ...prerequisiteLocationIds.map((recordId) => ({ recordId, recordKind: 'location' as const })),
  ]
  return {
    sql,
    manifest: {
      format: 'studyinchina.pipeline.materialization',
      formatVersion: 1,
      materializerVersion: MATERIALIZER_VERSION,
      batchId: prepared.batchId,
      batchPurpose: 'catalog_entities',
      provenanceStatus: prepared.provenanceStatus,
      requiredSourceArtifacts: prepared.sources.length,
      sourceArtifacts: prepared.sourceArtifacts,
      recordMappings: prepared.records.map((record) => ({
        recordId: record.id,
        recordKind: record.kind,
      })),
      generatedAt: prepared.generatedAt,
      contentSha256: sha256(sql),
      sqlStatements: statements.length,
      maxSqlStatementBytes,
      counts,
      prerequisiteInstitutionIds: prepared.prerequisiteInstitutionIds,
      prerequisiteProviderOrganizationIds: prepared.prerequisiteProviderOrganizationIds,
      prerequisiteLocationIds,
      dependencyRecords,
      ignoredCycleHints: prepared.ignoredCycleHints,
    },
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function main(): void {
  const inputPaths = resolveOfficialEntityInputPaths(process.argv.slice(2))
  const outputDirectory = resolve(argument('--output') ?? '.pipeline-build')
  const provenanceManifestArgument = argument('--provenance-manifest')
  const provenanceManifestPath = provenanceManifestArgument
    ? resolve(provenanceManifestArgument)
    : null
  const inputs = inputPaths.map((inputPath) => (
    JSON.parse(readFileSync(inputPath, 'utf8')) as unknown
  ))
  const artifacts = buildOfficialEntityMaterialization(inputs, {
    provenanceManifest: provenanceManifestPath
      ? JSON.parse(readFileSync(provenanceManifestPath, 'utf8')) as unknown
      : undefined,
    provenanceBaseDirectory: provenanceManifestPath
      ? dirname(provenanceManifestPath)
      : undefined,
  })
  const basename = `official-entities-${artifacts.manifest.contentSha256.slice(0, 12)}`
  const sqlPath = resolve(outputDirectory, `${basename}.sql`)
  const manifestPath = resolve(outputDirectory, `${basename}.manifest.json`)
  mkdirSync(dirname(sqlPath), { recursive: true })
  writeFileSync(sqlPath, artifacts.sql, 'utf8')
  writeFileSync(manifestPath, JSON.stringify({
    ...artifacts.manifest,
    inputPaths,
    ...(inputPaths.length === 1 ? { inputPath: inputPaths[0] } : {}),
    ...(provenanceManifestPath ? { provenanceManifestPath } : {}),
    sqlPath,
  }, null, 2), 'utf8')
  process.stdout.write(`${manifestPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

