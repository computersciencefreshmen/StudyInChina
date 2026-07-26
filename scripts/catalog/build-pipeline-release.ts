import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CATALOG_COLUMNS } from '../../workers/release-builder/src/catalog-schema'
import {
  parseArtifact,
  sha256,
  stableJson,
} from '../../workers/release-builder/src/artifact'
import { buildCompatibilityArtifact } from '../../workers/release-builder/src/compatibility'
import { isReleaseQueueJob } from '../../workers/release-builder/src/index'
import { buildArtifactFromPipeline } from '../../workers/release-builder/src/snapshot'
import {
  RELEASE_TABLES,
  type D1Database,
  type D1PreparedStatement,
  type D1Result,
  type ReleaseArtifact,
  type ReleaseQueueJob,
  type SqlValue,
} from '../../workers/release-builder/src/types'

type SqliteBinding = string | number | bigint | null | Uint8Array
const MODULE_URL = new URL(import.meta.url)
const REPOSITORY_ROOT = MODULE_URL.protocol === 'file:'
  ? fileURLToPath(new URL('../../', MODULE_URL))
  : process.cwd()

type ReleaseJobRow = {
  outbox_event_id: string
  publication_job_id: string
  catalog_release_id: string
  payload_json: string
  event_status: string
  job_status: string
  requested_at: string
}

export type PipelineReleaseBuildOptions = {
  pipelineExportPath: string
  outputDirectory: string
  publicationJobId?: string
  builtAt?: string
}

export type PipelineReleaseBuildManifest = {
  format: 'studyinchina.catalog.pipeline-release-build'
  formatVersion: 1
  builtAt: string
  source: {
    pipelineExportPath: string
    contentSha256: string
    byteLength: number
  }
  job: ReleaseQueueJob
  release: ReleaseArtifact['manifest']
  artifacts: {
    normalized: FileArtifact
    compatibility: FileArtifact
    catalogSql: FileArtifact
    catalogVerificationSql: FileArtifact
    pipelineSnapshotSql: FileArtifact
    pipelineSnapshotVerificationSql: FileArtifact
    pipelineFinalizeSql: FileArtifact
    pipelineFinalizeVerificationSql: FileArtifact
  }
  executionOrder: string[]
}

type FileArtifact = {
  path: string
  contentSha256: string
  byteLength: number
  r2Key?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function bindings(values: unknown[]): SqliteBinding[] {
  return values.map((value) => {
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'bigint'
      || value instanceof Uint8Array
    ) return value
    if (typeof value === 'boolean') return value ? 1 : 0
    throw new TypeError(`Unsupported SQLite binding: ${typeof value}`)
  })
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    readonly owner: SqliteD1Database,
    private readonly statement: StatementSync,
    private readonly values: SqliteBinding[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.owner, this.statement, bindings(values))
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.statement.get(...this.values) as T | undefined
    return row ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    try {
      return {
        success: true,
        results: this.statement.all(...this.values) as T[],
      }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    try {
      const result = this.statement.run(...this.values)
      return {
        success: true,
        meta: { changes: Number(result.changes) },
      }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  }
}

export class SqliteD1Database implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this, this.sqlite.prepare(query))
  }

  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<Array<D1Result<T>>> {
    const results: Array<D1Result<T>> = []
    for (const statement of statements) {
      if (!(statement instanceof SqliteD1Statement) || statement.owner !== this) {
        throw new TypeError('SQLite batch contains a statement from another database')
      }
      results.push(await statement.all<T>())
    }
    return results
  }
}

function initializePipelineSchemaForDataExport(database: DatabaseSync): string[] {
  const migrationDirectory = join(REPOSITORY_ROOT, 'infra', 'd1', 'pipeline', 'migrations')
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  if (migrations.length === 0) throw new Error('Pipeline migrations are missing')
  for (const migration of migrations) {
    database.exec(readFileSync(join(migrationDirectory, migration), 'utf8'))
  }
  const triggers = database.prepare(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `).all() as Array<{ name: string; sql: string }>
  if (triggers.length === 0) throw new Error('Pipeline schema has no validation triggers')
  for (const trigger of triggers) {
    database.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}";`)
  }
  return triggers.map((trigger) => `${trigger.sql};`)
}

export function loadPipelineExport(path: string): {  database: DatabaseSync
  sql: string
} {
  const sql = readFileSync(path, 'utf8')
  if (!sql.trim()) throw new Error('Pipeline D1 export is empty')
  const database = new DatabaseSync(':memory:')
  try {
    const schemaIncluded = /^\s*CREATE\s+TABLE\b/imu.test(sql)
    const triggerDefinitions = schemaIncluded
      ? []
      : initializePipelineSchemaForDataExport(database)
    if (!schemaIncluded) database.exec('PRAGMA foreign_keys = OFF;')
    database.exec(sql)
    for (const triggerSql of triggerDefinitions) database.exec(triggerSql)
    database.exec('PRAGMA foreign_keys = ON;')
    const integrity = database.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined
    if (integrity?.integrity_check !== 'ok') {
      throw new Error(`Pipeline export integrity check failed: ${stableJson(integrity)}`)
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) {
      throw new Error(`Pipeline export has ${violations.length} foreign-key violation(s)`)
    }
    return { database, sql }
  } catch (error) {
    database.close()
    throw error
  }
}

export function selectReleaseJob(
  database: DatabaseSync,
  publicationJobId?: string,
): ReleaseQueueJob {
  const base = `
    SELECT event.id AS outbox_event_id,
           job.id AS publication_job_id,
           job.catalog_release_id,
           event.payload_json,
           event.event_status,
           job.job_status,
           event.created_at AS requested_at
      FROM outbox_events event
      JOIN publication_jobs job ON job.id = event.aggregate_id
     WHERE event.event_type = 'catalog.release.requested'`
  const rows = publicationJobId
    ? database.prepare(`${base} AND job.id = ? ORDER BY event.created_at DESC LIMIT 2`)
      .all(publicationJobId) as ReleaseJobRow[]
    : database.prepare(`${base}
         AND event.event_status IN ('pending', 'processing', 'failed', 'dead_letter')
         AND job.job_status IN ('queued', 'building', 'validated', 'failed')
       ORDER BY event.created_at DESC, event.id DESC LIMIT 2`).all() as ReleaseJobRow[]
  if (rows.length === 0) {
    throw new Error(
      publicationJobId
        ? `Publication job ${publicationJobId} has no Catalog release outbox event`
        : 'Pipeline export has no unfinished Catalog release job',
    )
  }
  if (rows.length !== 1) {
    throw new Error('Pipeline export has multiple unfinished releases; pass --publication-job-id')
  }
  const row = rows[0]
  let payload: unknown
  try {
    payload = JSON.parse(row.payload_json)
  } catch {
    throw new Error('Selected release outbox payload is not valid JSON')
  }
  if (
    !payload
    || typeof payload !== 'object'
    || (payload as Record<string, unknown>).version !== 1
    || (payload as Record<string, unknown>).publicationJobId !== row.publication_job_id
    || (payload as Record<string, unknown>).catalogReleaseId !== row.catalog_release_id
  ) {
    throw new Error('Selected release outbox payload does not match relational identities')
  }
  const job: ReleaseQueueJob = {
    version: 1,
    outboxEventId: row.outbox_event_id,
    publicationJobId: row.publication_job_id,
    catalogReleaseId: row.catalog_release_id,
    requestedAt: row.requested_at,
  }
  if (!isReleaseQueueJob(job)) throw new Error('Selected release identities are invalid')
  return job
}

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize non-finite SQL number')
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

function utf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}
function insertSql(
  table: string,
  columns: readonly string[],
  values: readonly SqlValue[],
  mode = 'INSERT',
): string {
  const quoted = columns.map((column) => `"${column}"`).join(', ')
  return `${mode} INTO "${table}" (${quoted}) VALUES (${values.map(sqlValue).join(', ')});`
}

function assertArtifactContract(
  artifact: ReleaseArtifact,
  job: ReleaseQueueJob,
): void {
  if (
    artifact.manifest.releaseId !== job.catalogReleaseId
    || artifact.manifest.sourcePipelineRunId !== job.publicationJobId
  ) throw new Error('Normalized artifact identity does not match the selected release job')
  const counts = {
    sources: artifact.tables.source_summaries.length,
    cities: artifact.tables.locations.filter((row) => row.location_type === 'city').length,
    universities: artifact.tables.institutions.length,
    programs: artifact.tables.programs.length,
    admissionCycles: artifact.tables.program_cycles.length,
    scholarships: artifact.tables.scholarships.length,
  }
  if (stableJson(counts) !== stableJson(artifact.manifest.counts)) {
    throw new Error('Normalized artifact manifest counts do not match its tables')
  }
  for (const table of RELEASE_TABLES) {
    const allowed = new Set(CATALOG_COLUMNS[table])
    for (const [index, row] of artifact.tables[table].entries()) {
      const extras = Object.keys(row).filter((key) => !allowed.has(key))
      if (extras.length > 0) {
        throw new Error(`${table}[${index}] has unsupported columns: ${extras.join(', ')}`)
      }
      if (row.release_id !== job.catalogReleaseId) {
        throw new Error(`${table}[${index}] is bound to another release`)
      }
    }
  }
}

export function buildCatalogImportSql(
  artifact: ReleaseArtifact,
  contentSha256: string,
  compatibility: {
    key: string
    contentSha256: string
    byteLength: number
  },
  createdAt: string,
): string {
  const releaseId = artifact.manifest.releaseId
  const countsJson = stableJson(artifact.manifest.counts)
  const statements = [
    '-- Generated by scripts/catalog/build-pipeline-release.ts. Do not edit.',
    '-- Upload both immutable R2 artifacts before executing this SQL.',
    'PRAGMA foreign_keys = ON;',
    `DELETE FROM "search_documents" WHERE "release_id" = ${sqlValue(releaseId)};`,
    `DELETE FROM "catalog_releases" WHERE "release_id" = ${sqlValue(releaseId)} AND "release_status" IN ('building', 'ready', 'failed');`,
    insertSql(
      'catalog_releases',
      [
        'release_id', 'data_version', 'schema_version', 'release_status',
        'data_date', 'generated_at', 'source_pipeline_run_id',
        'content_sha256', 'counts_json', 'created_at',
      ],
      [
        releaseId,
        artifact.manifest.dataVersion,
        artifact.manifest.schemaVersion,
        'building',
        artifact.manifest.dataDate,
        artifact.manifest.generatedAt,
        artifact.manifest.sourcePipelineRunId,
        contentSha256,
        countsJson,
        createdAt,
      ],
    ),
    insertSql(
      'release_compatibility_artifacts',
      [
        'release_id', 'artifact_format', 'artifact_key', 'content_sha256',
        'byte_length', 'created_at',
      ],
      [
        releaseId,
        'studyinchina.frontend.bundle.v1',
        compatibility.key,
        compatibility.contentSha256,
        compatibility.byteLength,
        createdAt,
      ],
    ),
  ]
  for (const table of RELEASE_TABLES) {
    const columns = CATALOG_COLUMNS[table]
    for (const row of artifact.tables[table]) {
      statements.push(
        insertSql(table, columns, columns.map((column) => row[column] ?? null)),
      )
    }
  }
  const countGuards = RELEASE_TABLES.map(
    (table) => `(SELECT count(*) FROM "${table}" WHERE "release_id" = ${sqlValue(releaseId)}) = ${artifact.tables[table].length}`,
  )
  statements.push(
    `UPDATE "catalog_releases"
        SET "release_status" = 'ready', "validated_at" = ${sqlValue(createdAt)}
      WHERE "release_id" = ${sqlValue(releaseId)}
        AND "release_status" = 'building'
        AND ${countGuards.join('\n        AND ')};`,
    insertSql(
      'release_activation_requests',
      [
        'request_id', 'release_id', 'expected_content_sha256',
        'expected_counts_json', 'actor', 'requested_at',
        'previous_release_id', 'completed_at',
      ],
      [
        `activate-${releaseId}`,
        releaseId,
        contentSha256,
        countsJson,
        'local-pipeline-release-builder',
        createdAt,
        null,
        null,
      ],
    ),
    'PRAGMA optimize;',
  )
  return `${statements.join('\n')}\n`
}

export function buildCatalogVerificationSql(
  artifact: ReleaseArtifact,
  contentSha256: string,
): string {
  const releaseId = artifact.manifest.releaseId
  const countsJson = stableJson(artifact.manifest.counts)
  return `SELECT
  release.release_id,
  release.release_status,
  release.content_sha256,
  release.counts_json,
  pointer.current_release_id,
  activation.completed_at,
  CASE WHEN release.release_status = 'active'
         AND release.content_sha256 = ${sqlValue(contentSha256)}
         AND hex(release.counts_json) = ${sqlValue(utf8Hex(countsJson))}
         AND pointer.current_release_id = release.release_id
         AND activation.completed_at IS NOT NULL
       THEN 1 ELSE 0 END AS release_valid
FROM catalog_releases release
JOIN release_pointer pointer ON pointer.singleton_id = 1
JOIN release_activation_requests activation
  ON activation.release_id = release.release_id
WHERE release.release_id = ${sqlValue(releaseId)};\n`
}

function exactSnapshotPredicate(
  job: ReleaseQueueJob,
  artifactKey: string,
  contentSha256: string,
  byteLength: number,
  countsJson: string,
  capturedAt: string,
): string {
  return `"publication_job_id" = ${sqlValue(job.publicationJobId)}
    AND "catalog_release_id" = ${sqlValue(job.catalogReleaseId)}
    AND "artifact_format_version" = 1
    AND "artifact_key" = ${sqlValue(artifactKey)}
    AND "content_sha256" = ${sqlValue(contentSha256)}
    AND "byte_length" = ${byteLength}
    AND hex("counts_json") = ${sqlValue(utf8Hex(countsJson))}
    AND "captured_at" = ${sqlValue(capturedAt)}`
}

export function buildPipelineSnapshotSql(
  job: ReleaseQueueJob,
  artifactKey: string,
  contentSha256: string,
  byteLength: number,
  countsJson: string,
): string {
  const predicate = exactSnapshotPredicate(
    job,
    artifactKey,
    contentSha256,
    byteLength,
    countsJson,
    job.requestedAt,
  )
  const columns = [
    'publication_job_id', 'catalog_release_id', 'artifact_format_version',
    'artifact_key', 'content_sha256', 'byte_length', 'counts_json', 'captured_at',
  ]
  const values: SqlValue[] = [
    job.publicationJobId,
    job.catalogReleaseId,
    1,
    artifactKey,
    contentSha256,
    byteLength,
    countsJson,
    job.requestedAt,
  ]
  return `-- Apply only after the normalized artifact is uploaded and hash-verified in R2.
PRAGMA foreign_keys = ON;
${insertSql('release_build_snapshots', columns, values, 'INSERT OR IGNORE')}
INSERT INTO "release_build_snapshots" (${columns.map((column) => `"${column}"`).join(', ')})
SELECT ${values.map(sqlValue).join(', ')}
WHERE NOT EXISTS (
  SELECT 1 FROM "release_build_snapshots" WHERE ${predicate}
);\n`
}

export function buildPipelineSnapshotVerificationSql(
  job: ReleaseQueueJob,
  artifactKey: string,
  contentSha256: string,
  byteLength: number,
  countsJson: string,
): string {
  const predicate = exactSnapshotPredicate(
    job,
    artifactKey,
    contentSha256,
    byteLength,
    countsJson,
    job.requestedAt,
  )
  return `SELECT *, CASE WHEN ${predicate} THEN 1 ELSE 0 END AS snapshot_valid
FROM release_build_snapshots
WHERE publication_job_id = ${sqlValue(job.publicationJobId)};\n`
}

export function buildPipelineFinalizeSql(
  job: ReleaseQueueJob,
  artifactKey: string,
  contentSha256: string,
  byteLength: number,
  countsJson: string,
  finishedAt: string,
): string {
  const snapshot = exactSnapshotPredicate(
    job,
    artifactKey,
    contentSha256,
    byteLength,
    countsJson,
    job.requestedAt,
  )
  return `-- Apply only after Catalog verification returns release_valid = 1.
PRAGMA foreign_keys = ON;
UPDATE publication_jobs
SET job_status = 'published',
    expected_counts_json = ${sqlValue(countsJson)},
    content_sha256 = ${sqlValue(contentSha256)},
    finished_at = ${sqlValue(finishedAt)},
    error_detail = NULL
WHERE id = ${sqlValue(job.publicationJobId)}
  AND catalog_release_id = ${sqlValue(job.catalogReleaseId)}
  AND job_status IN ('queued', 'building', 'validated', 'failed')
  AND EXISTS (SELECT 1 FROM release_build_snapshots WHERE ${snapshot});
UPDATE outbox_events
SET event_status = 'delivered',
    delivered_at = ${sqlValue(finishedAt)},
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error = NULL
WHERE id = ${sqlValue(job.outboxEventId)}
  AND event_type = 'catalog.release.requested'
  AND aggregate_id = ${sqlValue(job.publicationJobId)}
  AND event_status IN ('pending', 'processing', 'failed', 'dead_letter')
  AND EXISTS (
    SELECT 1 FROM publication_jobs
    WHERE id = ${sqlValue(job.publicationJobId)}
      AND catalog_release_id = ${sqlValue(job.catalogReleaseId)}
      AND job_status = 'published'
      AND content_sha256 = ${sqlValue(contentSha256)}
      AND expected_counts_json = ${sqlValue(countsJson)}
  );\n`
}

export function buildPipelineFinalizeVerificationSql(job: ReleaseQueueJob): string {
  return `SELECT
  job.id AS publication_job_id,
  job.catalog_release_id,
  job.job_status,
  job.content_sha256,
  event.id AS outbox_event_id,
  event.event_status,
  event.delivered_at,
  CASE WHEN job.job_status = 'published'
         AND event.event_status = 'delivered'
         AND event.delivered_at IS NOT NULL
       THEN 1 ELSE 0 END AS finalization_valid
FROM publication_jobs job
JOIN outbox_events event
  ON event.aggregate_id = job.id
 AND event.id = ${sqlValue(job.outboxEventId)}
WHERE job.id = ${sqlValue(job.publicationJobId)}
  AND job.catalog_release_id = ${sqlValue(job.catalogReleaseId)};\n`
}

async function fileArtifact(path: string, text: string, r2Key?: string): Promise<FileArtifact> {
  return {
    path,
    contentSha256: await sha256(text),
    byteLength: new TextEncoder().encode(text).byteLength,
    ...(r2Key ? { r2Key } : {}),
  }
}

export async function buildPipelineRelease(
  options: PipelineReleaseBuildOptions,
): Promise<{ manifest: PipelineReleaseBuildManifest; manifestPath: string }> {
  const pipelineExportPath = resolve(options.pipelineExportPath)
  if (!existsSync(pipelineExportPath)) {
    throw new Error(`Pipeline D1 export does not exist: ${pipelineExportPath}`)
  }
  const outputDirectory = resolve(options.outputDirectory)
  const builtAt = new Date(options.builtAt ?? Date.now()).toISOString()
  const loaded = loadPipelineExport(pipelineExportPath)
  try {
    const job = selectReleaseJob(loaded.database, options.publicationJobId)
    const built = await buildArtifactFromPipeline(
      new SqliteD1Database(loaded.database),
      job,
      new Date(job.requestedAt),
    )
    const artifact = await parseArtifact(built.text)
    if (await sha256(built.text) !== built.contentSha256) {
      throw new Error('Normalized artifact byte hash changed after construction')
    }
    assertArtifactContract(artifact, job)
    const compatibility = await buildCompatibilityArtifact(artifact)
    const artifactKey = `releases/${job.catalogReleaseId}/catalog-release.v1.json`
    const artifactByteLength = new TextEncoder().encode(built.text).byteLength
    const countsJson = stableJson(artifact.manifest.counts)
    const catalogSql = buildCatalogImportSql(
      artifact,
      built.contentSha256,
      compatibility,
      builtAt,
    )
    const catalogVerificationSql = buildCatalogVerificationSql(
      artifact,
      built.contentSha256,
    )
    const pipelineSnapshotSql = buildPipelineSnapshotSql(
      job,
      artifactKey,
      built.contentSha256,
      artifactByteLength,
      countsJson,
    )
    const pipelineSnapshotVerificationSql = buildPipelineSnapshotVerificationSql(
      job,
      artifactKey,
      built.contentSha256,
      artifactByteLength,
      countsJson,
    )
    const pipelineFinalizeSql = buildPipelineFinalizeSql(
      job,
      artifactKey,
      built.contentSha256,
      artifactByteLength,
      countsJson,
      builtAt,
    )
    const pipelineFinalizeVerificationSql = buildPipelineFinalizeVerificationSql(job)
    mkdirSync(outputDirectory, { recursive: true })
    const prefix = job.catalogReleaseId
    const paths = {
      normalized: join(outputDirectory, `${prefix}.catalog-release.v1.json`),
      compatibility: join(outputDirectory, `${prefix}.compat-envelope.json`),
      catalogSql: join(outputDirectory, `${prefix}.catalog.sql`),
      catalogVerificationSql: join(outputDirectory, `${prefix}.catalog.verify.sql`),
      pipelineSnapshotSql: join(outputDirectory, `${prefix}.pipeline-snapshot.sql`),
      pipelineSnapshotVerificationSql: join(
        outputDirectory,
        `${prefix}.pipeline-snapshot.verify.sql`,
      ),
      pipelineFinalizeSql: join(outputDirectory, `${prefix}.pipeline-finalize.sql`),
      pipelineFinalizeVerificationSql: join(
        outputDirectory,
        `${prefix}.pipeline-finalize.verify.sql`,
      ),
    }
    writeFileSync(paths.normalized, built.text, 'utf8')
    writeFileSync(paths.compatibility, compatibility.text, 'utf8')
    writeFileSync(paths.catalogSql, catalogSql, 'utf8')
    writeFileSync(paths.catalogVerificationSql, catalogVerificationSql, 'utf8')
    writeFileSync(paths.pipelineSnapshotSql, pipelineSnapshotSql, 'utf8')
    writeFileSync(
      paths.pipelineSnapshotVerificationSql,
      pipelineSnapshotVerificationSql,
      'utf8',
    )
    writeFileSync(paths.pipelineFinalizeSql, pipelineFinalizeSql, 'utf8')
    writeFileSync(
      paths.pipelineFinalizeVerificationSql,
      pipelineFinalizeVerificationSql,
      'utf8',
    )
    const manifest: PipelineReleaseBuildManifest = {
      format: 'studyinchina.catalog.pipeline-release-build',
      formatVersion: 1,
      builtAt,
      source: {
        pipelineExportPath,
        contentSha256: await sha256(loaded.sql),
        byteLength: new TextEncoder().encode(loaded.sql).byteLength,
      },
      job,
      release: artifact.manifest,
      artifacts: {
        normalized: await fileArtifact(paths.normalized, built.text, artifactKey),
        compatibility: await fileArtifact(
          paths.compatibility,
          compatibility.text,
          compatibility.key,
        ),
        catalogSql: await fileArtifact(paths.catalogSql, catalogSql),
        catalogVerificationSql: await fileArtifact(
          paths.catalogVerificationSql,
          catalogVerificationSql,
        ),
        pipelineSnapshotSql: await fileArtifact(
          paths.pipelineSnapshotSql,
          pipelineSnapshotSql,
        ),
        pipelineSnapshotVerificationSql: await fileArtifact(
          paths.pipelineSnapshotVerificationSql,
          pipelineSnapshotVerificationSql,
        ),
        pipelineFinalizeSql: await fileArtifact(
          paths.pipelineFinalizeSql,
          pipelineFinalizeSql,
        ),
        pipelineFinalizeVerificationSql: await fileArtifact(
          paths.pipelineFinalizeVerificationSql,
          pipelineFinalizeVerificationSql,
        ),
      },
      executionOrder: [
        `Upload ${basename(paths.normalized)} to R2 key ${artifactKey}.`,
        `Upload ${basename(paths.compatibility)} to R2 key ${compatibility.key}.`,
        `Apply and verify ${basename(paths.pipelineSnapshotSql)} against Pipeline D1.`,
        `Apply ${basename(paths.catalogSql)} against migrated Catalog D1.`,
        `Require release_valid = 1 from ${basename(paths.catalogVerificationSql)}.`,
        `Only then apply ${basename(paths.pipelineFinalizeSql)} against Pipeline D1.`,
        `Require finalization_valid = 1 from ${basename(paths.pipelineFinalizeVerificationSql)}.`,
      ],
    }
    const manifestPath = join(outputDirectory, `${prefix}.manifest.json`)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return { manifest, manifestPath }
  } finally {
    loaded.database.close()
  }
}

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function usage(): string {
  return [
    'Usage:',
    '  tsx scripts/catalog/build-pipeline-release.ts',
    '    --pipeline-export <wrangler-d1-export.sql>',
    '    [--output <directory>]',
    '    [--publication-job-id <id>]',
    '    [--built-at <ISO timestamp>]',
  ].join('\n')
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const pipelineExportPath = argument(args, '--pipeline-export')
    if (!pipelineExportPath) throw new Error(usage())
    const result = await buildPipelineRelease({
      pipelineExportPath,
      outputDirectory: argument(args, '--output') ?? '.catalog-build/pipeline-release',
      publicationJobId: argument(args, '--publication-job-id'),
      builtAt: argument(args, '--built-at'),
    })
    process.stdout.write(`${result.manifestPath}\n`)
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}

if (isMainModule()) void main()
