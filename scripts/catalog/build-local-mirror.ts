import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { buildLegacyRelease, readLegacyBundle } from './build-release'

type Counts = ReturnType<typeof buildLegacyRelease>['release']['recordCounts']
type FileProof = { path: string; bytes: number; sha256: string }

export type LocalMirrorOptions = {
  migrationDirectory?: string
  outputRoot?: string
  receiptDirectory?: string
  evaluatedForDate?: string
  expectedPublicPrograms: number
}

const tables: Record<keyof Counts, string> = {
  sources: 'source_summaries', cities: 'locations', universities: 'institutions',
  programs: 'programs', admissionCycles: 'program_cycles', scholarships: 'scholarships',
}
const filenames = { sql: 'normalized.sql', envelope: 'compat-envelope.json', database: 'catalog.sqlite' }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

function counts(bundle: DataBundle): Counts {
  return Object.fromEntries(Object.keys(tables).map(key => [key, bundle[key as keyof Counts].length])) as Counts
}

function calendarDate(value: string): string {
  const parsed = new Date(value + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('evaluatedForDate must be a valid YYYY-MM-DD calendar date')
  }
  return value
}

function fileProof(path: string, name: string): FileProof {
  const raw = readFileSync(path)
  return { path: name, bytes: raw.length, sha256: digest(raw) }
}

/** Checks persisted facts rather than assuming successful INSERTs imply a faithful mirror. */
function verifyDatabase(database: DatabaseSync, bundle: DataBundle, releaseId: string) {
  const integrity = database.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check failed')
  const violations = database.prepare('PRAGMA foreign_key_check').all()
  if (violations.length) throw new Error(`SQLite foreign_key_check failed: ${violations.length} violations`)
  const current = database.prepare('SELECT release_id FROM current_release').get() as { release_id: string } | undefined
  if (current?.release_id !== releaseId) throw new Error('Local release activation failed')

  const persisted = {} as Counts
  for (const [key, table] of Object.entries(tables) as Array<[keyof Counts, string]>) {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE release_id = ?`).get(releaseId) as { count: number }
    persisted[key] = row.count
    if (row.count !== bundle[key].length) throw new Error(`Normalized row count mismatch: ${key}`)
  }

  let textualDurations = 0
  for (const program of bundle.programs) {
    if (!program.durationText) continue
    const duration = database.prepare('SELECT duration_min, duration_max, duration_unit FROM programs WHERE release_id = ? AND program_id = ?')
      .get(releaseId, program.id) as { duration_min: number | null; duration_max: number | null; duration_unit: string | null }
    if (duration.duration_min !== program.durationMonths || duration.duration_max !== (program.durationMonthsMax ?? null)
      || duration.duration_unit !== (program.durationMonths === null ? null : 'months')) {
      throw new Error(`Numeric duration changed: ${program.id}`)
    }
    for (const [locale, text] of Object.entries(program.durationText)) {
      if (!text) continue
      const localized = database.prepare("SELECT text_value FROM localized_content WHERE release_id = ? AND record_id = ? AND field_name = 'durationText' AND locale = ?")
        .get(releaseId, program.id, locale) as { text_value: string } | undefined
      if (localized?.text_value !== text) throw new Error(`Literal duration changed: ${program.id}/${locale}`)
      textualDurations += 1
    }
  }

  let referenceTuitionFees = 0
  for (const cycle of bundle.admissionCycles) {
    if (cycle.tuitionCny === null || cycle.tuitionStatus !== 'reference') continue
    const fee = database.prepare('SELECT value_status, amount_min_minor FROM fee_items WHERE release_id = ? AND fee_id = ?')
      .get(releaseId, `fee-tuition-${cycle.id}`) as { value_status: string; amount_min_minor: number } | undefined
    if (fee?.value_status !== 'reference' || fee.amount_min_minor !== Math.round(cycle.tuitionCny * 100)) {
      throw new Error(`Reference tuition changed: ${cycle.id}`)
    }
    referenceTuitionFees += 1
  }
  const sqlite = database.prepare('SELECT sqlite_version() AS version').get() as { version: string }
  return { integrityCheck: 'ok' as const, foreignKeyViolations: 0, sqliteVersion: sqlite.version,
    normalizedCounts: persisted, textualDurations, referenceTuitionFees }
}

/** All writes are local files. There is no cloud client, credential or deployment operation. */
export function buildLocalCatalogMirror(bundleInput: DataBundle, options: LocalMirrorOptions) {
  const bundle = bundleSchema.parse(bundleInput)
  const evaluatedForDate = calendarDate(options.evaluatedForDate ?? getTodayDate())
  if (!Number.isSafeInteger(options.expectedPublicPrograms) || options.expectedPublicPrograms < 0) {
    throw new Error('expectedPublicPrograms must be a non-negative integer')
  }
  const publicCounts = counts(selectPublishedData(bundle, evaluatedForDate))
  if (publicCounts.programs !== options.expectedPublicPrograms) {
    throw new Error(`Public programme count mismatch: expected ${options.expectedPublicPrograms}, found ${publicCounts.programs}`)
  }
  const built = buildLegacyRelease(bundle)
  const migrationsDirectory = resolve(options.migrationDirectory ?? 'infra/d1/catalog/migrations')
  const migrationNames = readdirSync(migrationsDirectory).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)).sort()
  if (!migrationNames.length) throw new Error('No catalogue migrations found')
  const migrations = migrationNames.map(name => ({ name, sql: readFileSync(join(migrationsDirectory, name), 'utf8') }))
  const sql = [
    '-- LOCAL-ONLY mirror. Apply only to a new, disposable local SQLite database.',
    '-- No R2 upload or cloud activation has taken place. This does not authorize cloud cutover.',
    ...migrations.map(migration => `-- Migration: ${migration.name}\n${migration.sql}`), built.sql,
  ].join('\n')
  const outputRoot = resolve(options.outputRoot ?? '.catalog-build/local-mirrors')
  const outputDirectory = join(outputRoot, built.release.id)
  const receiptDirectory = resolve(options.receiptDirectory ?? 'quality/catalog-local-mirrors')
  const receiptPath = join(receiptDirectory, built.release.id + '.receipt.json')
  if (existsSync(outputDirectory) || existsSync(receiptPath)) throw new Error('Immutable mirror identity already exists')

  // mkdir is exclusive. A failed build has no completion manifest or quality receipt and is never reused.
  mkdirSync(outputRoot, { recursive: true })
  mkdirSync(outputDirectory)
  const sqlPath = join(outputDirectory, filenames.sql)
  const envelopePath = join(outputDirectory, filenames.envelope)
  const databasePath = join(outputDirectory, filenames.database)
  writeFileSync(sqlPath, sql, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(envelopePath, built.envelope, { encoding: 'utf8', flag: 'wx' })
  const envelope = JSON.parse(readFileSync(envelopePath, 'utf8')) as { data: DataBundle }
  if (JSON.stringify(envelope.data) !== JSON.stringify(bundle)) throw new Error('Compatibility roundtrip changed the source bundle')
  if (digest(readFileSync(envelopePath)) !== built.contentSha256) throw new Error('Compatibility envelope digest mismatch')

  const database = new DatabaseSync(databasePath)
  let validation: ReturnType<typeof verifyDatabase>
  try {
    database.exec('PRAGMA foreign_keys = ON;')
    for (const migration of migrations) database.exec(migration.sql)
    database.exec('BEGIN IMMEDIATE;')
    database.exec(built.sql)
    validation = verifyDatabase(database, bundle, built.release.id)
    database.exec('COMMIT;')
  } finally {
    database.close()
  }

  const files = {
    sql: fileProof(sqlPath, filenames.sql), envelope: fileProof(envelopePath, filenames.envelope),
    database: fileProof(databasePath, filenames.database),
  }
  const manifest = {
    schemaVersion: 1, kind: 'studyinchina.local-catalog-mirror.v1', localOnly: true,
    release: built.release, createdAt: new Date().toISOString(), evaluatedForDate,
    runtime: { node: process.version, sqlite: validation.sqliteVersion },
    sourceBundleSha256: digest(JSON.stringify(bundle)), compatibilitySha256: built.contentSha256,
    rawCounts: built.release.recordCounts, publicCounts,
    migrations: migrations.map(migration => ({ path: migration.name, sha256: digest(migration.sql) })),
    files, validation,
    limitations: [
      'Website delivery remains JSON; no cloud database reads, backfills, uploads or cutovers were performed.',
      'The exact compatibility envelope preserves all schema fields, including supplementary materials and complete notes.',
      'Normalized SQL does not project every legacy narrative field; passing local integrity does not establish JSON/D1 public-view parity.',
      'A completed mirror is immutable. An existing directory without manifest.json is an incomplete attempt and must not be reused.',
    ],
  }
  const manifestPath = join(outputDirectory, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  const receipt = {
    schemaVersion: 1, kind: manifest.kind, localOnly: true, releaseId: built.release.id,
    createdAt: manifest.createdAt, evaluatedForDate, outputDirectory,
    manifest: fileProof(manifestPath, 'manifest.json'), files,
    rawCounts: manifest.rawCounts, publicCounts, validation,
    cloudOperations: 0, paidModelCalls: 0, websiteBackend: 'json',
  }
  mkdirSync(receiptDirectory, { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  return { outputDirectory, manifestPath, receiptPath, manifest }
}

function main(args: string[]) {
  const usage = 'node --import tsx scripts/catalog/build-local-mirror.ts --expected-public-programs <count> [--evaluated-for-date YYYY-MM-DD]'
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage + '\n'); return }
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--expected-public-programs', '--evaluated-for-date'].includes(key) || values.has(key) || !value || value.startsWith('--')) {
      throw new Error(usage)
    }
    values.set(key, value)
  }
  const expected = values.get('--expected-public-programs')
  if (!expected || !/^\d+$/u.test(expected)) throw new Error(usage)
  const result = buildLocalCatalogMirror(readLegacyBundle(), {
    expectedPublicPrograms: Number(expected), evaluatedForDate: values.get('--evaluated-for-date'),
  })
  process.stdout.write(JSON.stringify({ releaseId: result.manifest.release.id, outputDirectory: result.outputDirectory,
    receiptPath: result.receiptPath, publicPrograms: result.manifest.publicCounts.programs, localOnly: true }) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2))
