import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type JsonObject = Record<string, unknown>
type BatchPurpose = 'catalog_entities' | 'dependencies'

type MaterializationCounts = {
  records: number
  programs: number
  scholarships: number
  organizations: number
  locations: number
  programCycles: number
  scholarshipCycles: number
}

type MaterializationIdentity = {
  path: string
  batchId: string
  batchPurpose: BatchPurpose
  provenanceStatus: 'complete'
  counts: MaterializationCounts
}

export type MaterializationReleasePayload = {
  version: 1
  materializationRequestId: string
  publicationJobId: string
  catalogReleaseId: string
  catalogBatchId: string
  dependencyBatchId: string
}

export type MaterializationReleaseRequestPlan = {
  format: 'studyinchina.pipeline.materialization-release-request'
  formatVersion: 1
  requestedAt: string
  requestId: string
  publicationJobId: string
  catalogReleaseId: string
  outboxEventId: string
  catalog: MaterializationIdentity
  dependency: MaterializationIdentity
  payload: MaterializationReleasePayload
  requestSqlPath: string
  verificationSqlPath: string
}

export type BuildMaterializationReleaseRequestOptions = {
  catalogManifestPath: string
  dependencyManifestPath: string
  outputDirectory: string
  requestedAt?: string
  remote?: boolean
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const FORBIDDEN_REMOTE_PATH =
  /(?:^|[\\/])(?:tests?[\\/]fixtures?|fixtures?)(?:[\\/]|$)|(?:^|[\\/])[^\\/]*fixture[^\\/]*(?:[\\/]|$)/iu
const ACCEPTED_FORMATS = new Set([
  'studyinchina.pipeline.materialization',
  'studyinchina.pipeline.materialization-import-package',
])

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

export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

function asCount(value: unknown, label: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function sqlValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function normalizedPath(path: string): string {
  const absolute = resolve(path)
  return realpathSync(absolute)
}

function readMaterializationIdentity(
  path: string,
  expectedPurpose: BatchPurpose,
  remote: boolean,
): MaterializationIdentity {
  const manifestPath = normalizedPath(path)
  if (remote && FORBIDDEN_REMOTE_PATH.test(manifestPath)) {
    throw new Error(`Remote release request rejects fixture path: ${manifestPath}`)
  }
  const manifest = asObject(
    JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    basename(manifestPath),
  )
  const format = asString(manifest.format, `${basename(manifestPath)}.format`)
  if (!ACCEPTED_FORMATS.has(format) || manifest.formatVersion !== 1) {
    throw new Error(`${basename(manifestPath)} has an unsupported format`)
  }
  if (manifest.provenanceStatus !== 'complete') {
    throw new Error(`${basename(manifestPath)} provenance must be complete`)
  }
  if (manifest.batchPurpose !== expectedPurpose) {
    throw new Error(
      `${basename(manifestPath)} must be a ${expectedPurpose} batch`,
    )
  }
  const batchId = asString(
    manifest.batchId,
    `${basename(manifestPath)}.batchId`,
  )
  if (!SHA256_PATTERN.test(batchId)) {
    throw new Error(`${basename(manifestPath)}.batchId must be lowercase SHA-256`)
  }
  const rawCounts = asObject(
    manifest.counts,
    `${basename(manifestPath)}.counts`,
  )
  const counts: MaterializationCounts = {
    records: asCount(rawCounts.records, 'counts.records'),
    programs: asCount(rawCounts.programs, 'counts.programs'),
    scholarships: asCount(rawCounts.scholarships, 'counts.scholarships'),
    organizations: asCount(rawCounts.organizations, 'counts.organizations'),
    locations: asCount(rawCounts.locations, 'counts.locations'),
    programCycles: asCount(rawCounts.programCycles, 'counts.programCycles'),
    scholarshipCycles: asCount(
      rawCounts.scholarshipCycles,
      'counts.scholarshipCycles',
    ),
  }
  if (counts.programCycles !== 0 || counts.scholarshipCycles !== 0) {
    throw new Error('Identity materialization batches cannot contain cycles')
  }
  if (
    counts.records
    !== counts.programs
      + counts.scholarships
      + counts.organizations
      + counts.locations
  ) {
    throw new Error('Materialization record counts do not reconcile')
  }
  if (expectedPurpose === 'catalog_entities') {
    if (
      counts.programs < 1000
      || counts.scholarships < 50
      || counts.organizations !== 0
      || counts.locations !== 0
    ) {
      throw new Error(
        'Catalog release requires >=1000 programs, >=50 scholarships, '
        + 'and no dependency records',
      )
    }
  } else if (
    counts.programs !== 0
    || counts.scholarships !== 0
    || counts.organizations < 1
    || counts.locations < 1
  ) {
    throw new Error(
      'Dependency release batch requires organizations and locations only',
    )
  }
  return {
    path: manifestPath,
    batchId,
    batchPurpose: expectedPurpose,
    provenanceStatus: 'complete',
    counts,
  }
}

function normalizeRequestedAt(value: string | undefined): string {
  const date = value === undefined ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('requestedAt must be a valid ISO timestamp')
  }
  return date.toISOString()
}

export function materializationReleaseRequestSql(
  plan: Pick<
    MaterializationReleaseRequestPlan,
    | 'requestId'
    | 'publicationJobId'
    | 'catalogReleaseId'
    | 'outboxEventId'
    | 'requestedAt'
    | 'catalog'
    | 'dependency'
    | 'payload'
  >,
): string {
  return `INSERT OR IGNORE INTO materialization_release_requests (
  request_id,
  catalog_batch_id,
  dependency_batch_id,
  publication_job_id,
  catalog_release_id,
  outbox_event_id,
  payload_json,
  requested_at,
  created_at
) VALUES (
  ${sqlValue(plan.requestId)},
  ${sqlValue(plan.catalog.batchId)},
  ${sqlValue(plan.dependency.batchId)},
  ${sqlValue(plan.publicationJobId)},
  ${sqlValue(plan.catalogReleaseId)},
  ${sqlValue(plan.outboxEventId)},
  ${sqlValue(stableJson(plan.payload))},
  ${sqlValue(plan.requestedAt)},
  ${sqlValue(plan.requestedAt)}
);\n`
}

export function materializationReleaseVerificationSql(
  requestId: string,
): string {
  return `SELECT
  request.request_id,
  request.catalog_batch_id,
  request.dependency_batch_id,
  request.publication_job_id,
  request.catalog_release_id,
  request.outbox_event_id,
  request.payload_json,
  request.requested_at,
  job.job_status,
  job.source_change_set_ids_json,
  event.event_type,
  event.aggregate_id,
  event.payload_json AS event_payload_json,
  event.event_status,
  CASE
    WHEN event.aggregate_id = request.publication_job_id
      AND event.payload_json = request.payload_json
      AND job.id = request.publication_job_id
      AND job.catalog_release_id = request.catalog_release_id
    THEN 1 ELSE 0
  END AS relational_contract_valid
FROM materialization_release_requests request
JOIN publication_jobs job ON job.id = request.publication_job_id
JOIN outbox_events event ON event.id = request.outbox_event_id
WHERE request.request_id = ${sqlValue(requestId)};\n`
}

export function buildMaterializationReleaseRequest(
  options: BuildMaterializationReleaseRequestOptions,
): { plan: MaterializationReleaseRequestPlan; planPath: string } {
  const outputDirectory = resolve(options.outputDirectory)
  mkdirSync(outputDirectory, { recursive: true })
  const catalog = readMaterializationIdentity(
    options.catalogManifestPath,
    'catalog_entities',
    options.remote === true,
  )
  const dependency = readMaterializationIdentity(
    options.dependencyManifestPath,
    'dependencies',
    options.remote === true,
  )
  if (catalog.batchId === dependency.batchId) {
    throw new Error('Catalog and dependency batch IDs must differ')
  }
  const digest = sha256(stableJson({
    version: 1,
    catalogBatchId: catalog.batchId,
    dependencyBatchId: dependency.batchId,
  }))
  const requestId = `materialization-release-request-${digest}`
  const publicationJobId = `publication-job-materialization-${digest}`
  const catalogReleaseId = `catalog-release-materialization-${digest}`
  const outboxEventId = `outbox-materialization-${digest}`
  const requestedAt = normalizeRequestedAt(options.requestedAt)
  const payload: MaterializationReleasePayload = {
    version: 1,
    materializationRequestId: requestId,
    publicationJobId,
    catalogReleaseId,
    catalogBatchId: catalog.batchId,
    dependencyBatchId: dependency.batchId,
  }
  const prefix = `materialization-release-${digest.slice(0, 16)}`
  const requestSqlPath = join(outputDirectory, `${prefix}.request.sql`)
  const verificationSqlPath = join(outputDirectory, `${prefix}.verify.sql`)
  const planPath = join(outputDirectory, `${prefix}.request.json`)
  const plan: MaterializationReleaseRequestPlan = {
    format: 'studyinchina.pipeline.materialization-release-request',
    formatVersion: 1,
    requestedAt,
    requestId,
    publicationJobId,
    catalogReleaseId,
    outboxEventId,
    catalog,
    dependency,
    payload,
    requestSqlPath,
    verificationSqlPath,
  }
  writeFileSync(requestSqlPath, materializationReleaseRequestSql(plan), 'utf8')
  writeFileSync(
    verificationSqlPath,
    materializationReleaseVerificationSql(requestId),
    'utf8',
  )
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  return { plan, planPath }
}

type CliArguments = {
  catalogManifestPath?: string
  dependencyManifestPath?: string
  outputDirectory?: string
  requestedAt?: string
  remote: boolean
}

function parseArguments(args: string[]): CliArguments {
  const parsed: CliArguments = { remote: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const next = args[index + 1]
    if (argument === '--remote-contract') {
      parsed.remote = true
      continue
    }
    if (!next) throw new Error(`Missing value for ${argument}`)
    if (argument === '--catalog-manifest') {
      parsed.catalogManifestPath = next
    } else if (argument === '--dependency-manifest') {
      parsed.dependencyManifestPath = next
    } else if (argument === '--output') {
      parsed.outputDirectory = next
    } else if (argument === '--requested-at') {
      parsed.requestedAt = next
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
    index += 1
  }
  return parsed
}

function usage(): string {
  return [
    'Usage:',
    '  tsx scripts/ingestion/request-materialization-release.ts',
    '    --catalog-manifest <path>',
    '    --dependency-manifest <path>',
    '    --output <directory>',
    '    [--requested-at <ISO timestamp>] [--remote-contract]',
  ].join('\n')
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return pathToFileURL(resolve(entry)).href === import.meta.url
}

if (isMainModule()) {
  try {
    const args = parseArguments(process.argv.slice(2))
    if (
      !args.catalogManifestPath
      || !args.dependencyManifestPath
      || !args.outputDirectory
    ) {
      throw new Error(usage())
    }
    const result = buildMaterializationReleaseRequest({
      catalogManifestPath: args.catalogManifestPath,
      dependencyManifestPath: args.dependencyManifestPath,
      outputDirectory: args.outputDirectory,
      requestedAt: args.requestedAt,
      remote: args.remote,
    })
    process.stdout.write(`${result.planPath}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

