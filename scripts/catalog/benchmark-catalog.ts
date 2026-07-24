import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type BenchmarkOptions = {
  institutions: number
  programs: number
  cycles: number
  iterations: number
  warmup: number
  seed: number
  output: string
  workDirectory: string
  keepDatabase: boolean
}

export type MetricResult = {
  samples: number
  returnedRowsMin: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  thresholdMs: number
  passed: boolean
}

type SqlParameter = null | number | bigint | string | NodeJS.ArrayBufferView

const DEFAULT_OPTIONS: BenchmarkOptions = {
  institutions: 1_000,
  programs: 100_000,
  cycles: 300_000,
  iterations: 200,
  warmup: 20,
  seed: 20_260_720,
  output: resolve('.benchmark', 'catalog-performance.json'),
  workDirectory: resolve('.benchmark'),
  keepDatabase: false,
}

const LIST_DETAIL_THRESHOLD_MS = 250
const SEARCH_THRESHOLD_MS = 500

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive safe integer`)
  }
  return parsed
}

export function parseBenchmarkOptions(
  arguments_: string[],
  cwd = process.cwd(),
): BenchmarkOptions {
  const options = { ...DEFAULT_OPTIONS }
  options.output = resolve(cwd, '.benchmark', 'catalog-performance.json')
  options.workDirectory = resolve(cwd, '.benchmark')

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index]
    if (flag === '--keep-db') {
      options.keepDatabase = true
      continue
    }
    const value = arguments_[index + 1]
    if (!value) throw new Error(`${flag} requires a value`)
    index += 1
    if (flag === '--institutions') options.institutions = positiveInteger(value, flag)
    else if (flag === '--programs') options.programs = positiveInteger(value, flag)
    else if (flag === '--cycles') options.cycles = positiveInteger(value, flag)
    else if (flag === '--iterations') options.iterations = positiveInteger(value, flag)
    else if (flag === '--warmup') options.warmup = positiveInteger(value, flag)
    else if (flag === '--seed') options.seed = positiveInteger(value, flag)
    else if (flag === '--output') options.output = resolve(cwd, value)
    else if (flag === '--work-dir') options.workDirectory = resolve(cwd, value)
    else throw new Error(`Unknown benchmark option: ${flag}`)
  }

  if (options.programs < options.institutions) {
    throw new Error('--programs must be greater than or equal to --institutions')
  }
  if (options.cycles < options.programs) {
    throw new Error('--cycles must be greater than or equal to --programs')
  }
  return options
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without samples')
  if (percentileValue <= 0 || percentileValue > 1) {
    throw new Error('Percentile must be greater than 0 and at most 1')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[index]
}

function milliseconds(value: number): number {
  return Number(value.toFixed(3))
}

export function summarizeMetric(
  samples: number[],
  returnedRows: number[],
  thresholdMs: number,
): MetricResult {
  const p95Ms = milliseconds(percentile(samples, 0.95))
  return {
    samples: samples.length,
    returnedRowsMin: Math.min(...returnedRows),
    p50Ms: milliseconds(percentile(samples, 0.5)),
    p95Ms,
    p99Ms: milliseconds(percentile(samples, 0.99)),
    maxMs: milliseconds(Math.max(...samples)),
    thresholdMs,
    passed: p95Ms < thresholdMs,
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function syntheticId(prefix: string, index: number, width: number): string {
  return `${prefix}-${index.toString().padStart(width, '0')}`
}

function applyMigrations(database: DatabaseSync, repositoryRoot: string): string[] {
  const migrationsDirectory = resolve(repositoryRoot, 'infra', 'd1', 'catalog', 'migrations')
  const migrationNames = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (migrationNames.length === 0) throw new Error('No Catalog migrations found')
  for (const migrationName of migrationNames) {
    database.exec(readFileSync(join(migrationsDirectory, migrationName), 'utf8'))
  }
  return migrationNames
}

function insertCatalogData(database: DatabaseSync, options: BenchmarkOptions): void {
  const releaseId = 'benchmark-release'
  const contentHash = '0'.repeat(64)
  const verifiedAt = '2026-07-20'
  const reviewAfter = '2099-12-31'
  const subjectBuckets = Math.min(100, Math.max(1, Math.floor(options.programs / 10)))

  const insertRecord = database.prepare(`
    INSERT INTO catalog_records (
      release_id, record_id, record_kind, slug, gate_status,
      verified_at, review_after, content_sha256
    ) VALUES (?, ?, ?, ?, 'publishable', ?, ?, ?)
  `)
  const insertLocalizedName = database.prepare(`
    INSERT INTO localized_content (
      release_id, record_id, locale, field_name, text_value, translation_status
    ) VALUES (?, ?, 'en', 'name', ?, 'published')
  `)
  const insertRecordSource = database.prepare(`
    INSERT INTO record_sources (
      release_id, record_id, field_path, locale, source_id, evidence_role
    ) VALUES (?, ?, '*', '', 'benchmark-source', 'primary')
  `)
  const insertSearchDocument = database.prepare(`
    INSERT INTO search_documents (
      release_id, record_id, locale, record_kind, title, body, filter_text
    ) VALUES (?, ?, 'en', ?, ?, '', '')
  `)
  const insertOrganization = database.prepare(`
    INSERT INTO organizations (
      release_id, organization_id, organization_type, official_url
    ) VALUES (?, ?, 'university', ?)
  `)
  const insertInstitution = database.prepare(`
    INSERT INTO institutions (
      release_id, institution_id, city_id, institution_type, admissions_url, featured
    ) VALUES (?, ?, 'benchmark-city', 'comprehensive', ?, ?)
  `)
  const insertProgram = database.prepare(`
    INSERT INTO programs (
      release_id, program_id, institution_id, program_type, degree_level,
      attendance_mode, delivery_mode, official_url
    ) VALUES (?, ?, ?, 'degree', 'bachelor', 'full_time', 'on_campus', ?)
  `)
  const insertCycle = database.prepare(`
    INSERT INTO program_cycles (
      release_id, program_cycle_id, program_id, academic_year, intake_code,
      sequence, cycle_status, official_url
    ) VALUES (?, ?, ?, '2026-2027', 'autumn', ?, 'announced', ?)
  `)

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(`
        INSERT INTO catalog_releases (
          release_id, data_version, schema_version, release_status, data_date,
          generated_at, source_pipeline_run_id, content_sha256, counts_json,
          validated_at, activated_at
        ) VALUES (?, 1, 1, 'active', '2026-07-20', '2026-07-20T00:00:00.000Z',
          'synthetic-benchmark', ?, ?, '2026-07-20T00:00:00.000Z',
          '2026-07-20T00:00:00.000Z')
      `)
      .run(
        releaseId,
        contentHash,
        JSON.stringify({
          sources: 1,
          cities: 1,
          universities: options.institutions,
          programs: options.programs,
          admissionCycles: options.cycles,
          scholarships: 0,
        }),
      )

    database
      .prepare(`
        INSERT INTO source_summaries (
          release_id, source_id, url, title, publisher, source_kind,
          language_code, authority_level, checked_at
        ) VALUES (?, 'benchmark-source', 'https://benchmark.invalid/catalog',
          'Synthetic benchmark catalog', 'StudyInChina benchmark', 'institution',
          'en', 'primary_official', '2026-07-20T00:00:00.000Z')
      `)
      .run(releaseId)

    insertRecord.run(
      releaseId,
      'benchmark-city',
      'location',
      'benchmark-city',
      verifiedAt,
      reviewAfter,
      contentHash,
    )
    insertRecordSource.run(releaseId, 'benchmark-city')
    database
      .prepare(`
        INSERT INTO locations (
          release_id, location_id, location_type, country_code
        ) VALUES (?, 'benchmark-city', 'city', 'CN')
      `)
      .run(releaseId)

    for (let index = 0; index < options.institutions; index += 1) {
      const institutionId = syntheticId('institution', index, 6)
      const name = `Synthetic University ${index.toString().padStart(6, '0')}`
      insertRecord.run(
        releaseId,
        institutionId,
        'organization',
        institutionId,
        verifiedAt,
        reviewAfter,
        contentHash,
      )
      insertOrganization.run(
        releaseId,
        institutionId,
        `https://benchmark.invalid/institutions/${institutionId}`,
      )
      insertRecordSource.run(releaseId, institutionId)
      insertInstitution.run(
        releaseId,
        institutionId,
        `https://benchmark.invalid/institutions/${institutionId}/admissions`,
        index < 20 ? 1 : 0,
      )
      insertLocalizedName.run(releaseId, institutionId, name)
      insertSearchDocument.run(releaseId, institutionId, 'organization', name)
    }

    for (let index = 0; index < options.programs; index += 1) {
      const programId = syntheticId('program', index, 9)
      const institutionId = syntheticId('institution', index % options.institutions, 6)
      const subject = `subject${(index % subjectBuckets).toString().padStart(3, '0')}`
      const name = `Synthetic Program ${index.toString().padStart(9, '0')} ${subject}`
      insertRecord.run(
        releaseId,
        programId,
        'program',
        programId,
        verifiedAt,
        reviewAfter,
        contentHash,
      )
      insertProgram.run(
        releaseId,
        programId,
        institutionId,
        `https://benchmark.invalid/programs/${programId}`,
      )
      insertRecordSource.run(releaseId, programId)
      insertLocalizedName.run(releaseId, programId, name)
      insertSearchDocument.run(releaseId, programId, 'program', name)
    }

    for (let index = 0; index < options.cycles; index += 1) {
      const cycleId = syntheticId('cycle', index, 9)
      const programIndex = index % options.programs
      const programId = syntheticId('program', programIndex, 9)
      const sequence = Math.floor(index / options.programs) + 1
      insertRecord.run(
        releaseId,
        cycleId,
        'program_cycle',
        null,
        verifiedAt,
        reviewAfter,
        contentHash,
      )
      insertCycle.run(
        releaseId,
        cycleId,
        programId,
        sequence,
        `https://benchmark.invalid/programs/${programId}/cycles/${sequence}`,
      )
      insertRecordSource.run(releaseId, cycleId)
    }

    database
      .prepare(`
        UPDATE release_pointer
        SET current_release_id = ?, updated_at = '2026-07-20T00:00:00.000Z',
            updated_by = 'synthetic-benchmark'
        WHERE singleton_id = 1
      `)
      .run(releaseId)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  database.exec("INSERT INTO search_fts(search_fts) VALUES ('rebuild')")
  database.exec('ANALYZE')
  database.exec('PRAGMA optimize')
}

function rowCount(statement: StatementSync, ...parameters: SqlParameter[]): number {
  return statement.all(...parameters).length
}

function measureStatement(
  statement: StatementSync,
  parameters: SqlParameter[][],
  warmup: number,
  thresholdMs: number,
): MetricResult {
  for (let index = 0; index < warmup; index += 1) {
    rowCount(statement, ...parameters[index % parameters.length])
  }
  const samples: number[] = []
  const returnedRows: number[] = []
  for (const bindings of parameters) {
    const startedAt = process.hrtime.bigint()
    const rows = rowCount(statement, ...bindings)
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    samples.push(elapsedMs)
    returnedRows.push(rows)
  }
  return summarizeMetric(samples, returnedRows, thresholdMs)
}

function benchmarkQueries(database: DatabaseSync, options: BenchmarkOptions) {
  const random = mulberry32(options.seed)
  const institutionId = () =>
    syntheticId('institution', Math.floor(random() * options.institutions), 6)
  const programId = () => syntheticId('program', Math.floor(random() * options.programs), 9)
  const subjectBuckets = Math.min(100, Math.max(1, Math.floor(options.programs / 10)))

  const institutionList = database.prepare(`
    SELECT i.institution_id, i.institution_type, o.official_url, name.text_value AS name
    FROM current_institutions i
    JOIN current_organizations o
      ON o.release_id = i.release_id AND o.organization_id = i.institution_id
    LEFT JOIN current_localized_content name
      ON name.release_id = i.release_id AND name.record_id = i.institution_id
      AND name.locale = 'en' AND name.field_name = 'name'
    WHERE i.institution_id > ?
    ORDER BY i.institution_id
    LIMIT 25
  `)
  const institutionDetail = database.prepare(`
    SELECT i.*, o.official_url, name.text_value AS name
    FROM current_institutions i
    JOIN current_organizations o
      ON o.release_id = i.release_id AND o.organization_id = i.institution_id
    LEFT JOIN current_localized_content name
      ON name.release_id = i.release_id AND name.record_id = i.institution_id
      AND name.locale = 'en' AND name.field_name = 'name'
    WHERE i.institution_id = ?
  `)
  const programList = database.prepare(`
    SELECT p.program_id, p.institution_id, p.program_type, p.degree_level,
           p.official_url, name.text_value AS name
    FROM current_programs p
    LEFT JOIN current_localized_content name
      ON name.release_id = p.release_id AND name.record_id = p.program_id
      AND name.locale = 'en' AND name.field_name = 'name'
    WHERE p.institution_id = ?
    ORDER BY p.program_id
    LIMIT 25
  `)
  const programDetail = database.prepare(`
    SELECT p.*, name.text_value AS name
    FROM current_programs p
    LEFT JOIN current_localized_content name
      ON name.release_id = p.release_id AND name.record_id = p.program_id
      AND name.locale = 'en' AND name.field_name = 'name'
    WHERE p.program_id = ?
  `)
  const search = database.prepare(`
    SELECT sd.record_id, sd.title, bm25(search_fts) AS rank
    FROM search_fts
    JOIN current_search_documents sd ON sd.search_rowid = search_fts.rowid
    WHERE search_fts MATCH ?
    ORDER BY rank
    LIMIT 20
  `)

  const institutionListParameters = Array.from({ length: options.iterations }, () => {
    const maximumCursor = Math.max(0, options.institutions - 25)
    return [syntheticId('institution', Math.floor(random() * (maximumCursor + 1)), 6)]
  })
  const institutionDetailParameters = Array.from({ length: options.iterations }, () => [
    institutionId(),
  ])
  const programListParameters = Array.from({ length: options.iterations }, () => [
    institutionId(),
  ])
  const programDetailParameters = Array.from({ length: options.iterations }, () => [programId()])
  const searchParameters = Array.from({ length: options.iterations }, () => [
    `subject${Math.floor(random() * subjectBuckets).toString().padStart(3, '0')}`,
  ])

  return {
    'institutions.list': measureStatement(
      institutionList,
      institutionListParameters,
      options.warmup,
      LIST_DETAIL_THRESHOLD_MS,
    ),
    'institutions.detail': measureStatement(
      institutionDetail,
      institutionDetailParameters,
      options.warmup,
      LIST_DETAIL_THRESHOLD_MS,
    ),
    'programs.list': measureStatement(
      programList,
      programListParameters,
      options.warmup,
      LIST_DETAIL_THRESHOLD_MS,
    ),
    'programs.detail': measureStatement(
      programDetail,
      programDetailParameters,
      options.warmup,
      LIST_DETAIL_THRESHOLD_MS,
    ),
    'search.fts': measureStatement(
      search,
      searchParameters,
      options.warmup,
      SEARCH_THRESHOLD_MS,
    ),
  }
}

function validateScale(database: DatabaseSync, options: BenchmarkOptions) {
  const counts = database
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM current_institutions) AS institutions,
        (SELECT COUNT(*) FROM current_programs) AS programs,
        (SELECT COUNT(*) FROM current_program_cycles) AS cycles,
        (SELECT COUNT(*) FROM search_documents) AS search_documents
    `)
    .get() as Record<string, number>
  const expected = {
    institutions: options.institutions,
    programs: options.programs,
    cycles: options.cycles,
    search_documents: options.institutions + options.programs,
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (counts[key] !== expectedValue) {
      throw new Error(`Scale validation failed for ${key}: expected ${expectedValue}, got ${counts[key]}`)
    }
  }
  return { expected, actual: counts, passed: true }
}

function safeRemoveRunDirectory(runDirectory: string, workDirectory: string): void {
  const resolvedRun = resolve(runDirectory)
  const resolvedWork = resolve(workDirectory)
  const prefix = resolvedWork.endsWith(sep) ? resolvedWork : `${resolvedWork}${sep}`
  if (!resolvedRun.startsWith(prefix) || !basename(resolvedRun).startsWith('run-')) {
    throw new Error(`Refusing to remove unverified benchmark directory: ${resolvedRun}`)
  }
  rmSync(resolvedRun, { recursive: true, force: true })
}

function writeJsonReport(path: string, report: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}

export function printBenchmarkHelp(): void {
  process.stdout.write(`Catalog synthetic benchmark\n\n`)
  process.stdout.write(`  --institutions N  default 1000\n`)
  process.stdout.write(`  --programs N      default 100000\n`)
  process.stdout.write(`  --cycles N        default 300000\n`)
  process.stdout.write(`  --iterations N    default 200\n`)
  process.stdout.write(`  --warmup N        default 20\n`)
  process.stdout.write(`  --seed N          default 20260720\n`)
  process.stdout.write(`  --output PATH     default .benchmark/catalog-performance.json\n`)
  process.stdout.write(`  --work-dir PATH   default .benchmark\n`)
  process.stdout.write(`  --keep-db         retain the generated SQLite database\n`)
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printBenchmarkHelp()
    return
  }

  const options = parseBenchmarkOptions(process.argv.slice(2))
  const scriptPath = fileURLToPath(import.meta.url)
  const repositoryRoot = resolve(dirname(scriptPath), '..', '..')
  mkdirSync(options.workDirectory, { recursive: true })
  const runDirectory = mkdtempSync(join(options.workDirectory, 'run-'))
  const databasePath = join(runDirectory, 'catalog-benchmark.sqlite')
  const startedAt = new Date()
  const buildStarted = process.hrtime.bigint()
  let database: DatabaseSync | undefined

  try {
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA synchronous = NORMAL')
    database.exec('PRAGMA temp_store = MEMORY')
    database.exec('PRAGMA cache_size = -262144')
    database.exec('PRAGMA foreign_keys = ON')
    const migrations = applyMigrations(database, repositoryRoot)
    insertCatalogData(database, options)
    const buildSeconds = Number(process.hrtime.bigint() - buildStarted) / 1_000_000_000
    const scaleValidation = validateScale(database, options)
    const metrics = benchmarkQueries(database, options)
    const metricsPassed = Object.values(metrics).every((metric) => metric.passed)
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const databaseBytes = statSync(databasePath).size
    const completedAt = new Date()
    const report = {
      schemaVersion: 1,
      status: metricsPassed ? 'passed' : 'failed',
      passed: metricsPassed,
      generatedAt: completedAt.toISOString(),
      elapsedSeconds: milliseconds((completedAt.getTime() - startedAt.getTime()) / 1_000),
      buildSeconds: milliseconds(buildSeconds),
      scale: {
        institutions: options.institutions,
        programs: options.programs,
        cycles: options.cycles,
      },
      configuration: {
        iterations: options.iterations,
        warmup: options.warmup,
        seed: options.seed,
        thresholdsMs: {
          listAndDetail: LIST_DETAIL_THRESHOLD_MS,
          ftsSearch: SEARCH_THRESHOLD_MS,
        },
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        sqlite: (
          database.prepare('SELECT sqlite_version() AS version').get() as {
            version: string
          }
        ).version,
      },
      database: {
        bytes: databaseBytes,
        migrations,
        retained: options.keepDatabase,
        path: options.keepDatabase ? databasePath : null,
      },
      scaleValidation,
      metrics,
      limitations: [
        'Measures local SQLite/D1 query execution, not Worker network latency or edge cache p95.',
        'Synthetic names and filters model cardinality and indexes, not production traffic distribution.',
      ],
    }
    writeJsonReport(options.output, report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!metricsPassed) process.exitCode = 1
  } catch (error) {
    const completedAt = new Date()
    const report = {
      schemaVersion: 1,
      status: 'error',
      passed: false,
      generatedAt: completedAt.toISOString(),
      scale: {
        institutions: options.institutions,
        programs: options.programs,
        cycles: options.cycles,
      },
      error: error instanceof Error ? error.message : String(error),
    }
    writeJsonReport(options.output, report)
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = 1
  } finally {
    database?.close()
    if (!options.keepDatabase) safeRemoveRunDirectory(runDirectory, options.workDirectory)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main()
}
