import { readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const [stateDirectory, kind] = process.argv.slice(2)

if (!stateDirectory || !['catalog', 'pipeline'].includes(kind)) {
  throw new Error('Usage: node verify-restored-d1.mjs <local-state-directory> <catalog|pipeline>')
}

function sqliteFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sqliteFiles(path))
    if (entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') {
      files.push(path)
    }
  }
  return files
}

const requiredTables =
  kind === 'catalog'
    ? [
        'catalog_releases',
        'release_pointer',
        'catalog_records',
        'institutions',
        'programs',
        'program_cycles',
        'scholarships',
      ]
    : [
        'records',
        'source_documents',
        'claims',
        'ingestion_sources',
        'ingestion_jobs',
        'ingestion_snapshots',
        'ingestion_candidates',
      ]

const markerTable = requiredTables[0]
const matches = []
for (const path of sqliteFiles(resolve(stateDirectory))) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const marker = database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(markerTable)
    if (marker.count === 1) matches.push({ path, database })
    else database.close()
  } catch (error) {
    database.close()
    throw error
  }
}

if (matches.length !== 1) {
  for (const match of matches) match.database.close()
  throw new Error(`Expected one restored ${kind} SQLite file, found ${matches.length}`)
}

const [{ path, database }] = matches
try {
  const tablePlaceholders = requiredTables.map(() => '?').join(', ')
  const actualTables = database
    .prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${tablePlaceholders}) ORDER BY name`,
    )
    .all(...requiredTables)
    .map((row) => row.name)
  const missingTables = requiredTables.filter((table) => !actualTables.includes(table))
  if (missingTables.length > 0) {
    throw new Error(`${kind} restore is missing core table(s): ${missingTables.join(', ')}`)
  }

  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyViolations.length > 0) {
    throw new Error(`${kind} restore has ${foreignKeyViolations.length} foreign-key violation(s)`)
  }

  const integrityRows = database.prepare('PRAGMA integrity_check').all()
  const integrityMessages = integrityRows.flatMap((row) => Object.values(row).map(String))
  if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
    throw new Error(`${kind} restore failed integrity_check: ${integrityMessages.join('; ')}`)
  }

  const { count: triggerCount } = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger'")
    .get()
  if (triggerCount < 1) throw new Error(`${kind} validation triggers were not restored`)

  const report = {
    databaseFile: basename(path),
    foreignKeyViolations: 0,
    integrityCheck: 'ok',
    coreTables: requiredTables,
    triggerCount,
  }

  if (kind === 'catalog') {
    const releases = database
      .prepare(`
        SELECT
          rp.current_release_id AS release_id,
          cr.release_status,
          cr.data_date,
          cr.generated_at,
          (SELECT COUNT(*) FROM institutions WHERE release_id = rp.current_release_id) AS institutions,
          (SELECT COUNT(*) FROM programs WHERE release_id = rp.current_release_id) AS programs,
          (SELECT COUNT(*) FROM program_cycles WHERE release_id = rp.current_release_id) AS program_cycles,
          (SELECT COUNT(*) FROM scholarships WHERE release_id = rp.current_release_id) AS scholarships
        FROM release_pointer rp
        JOIN catalog_releases cr ON cr.release_id = rp.current_release_id
        WHERE rp.singleton_id = 1
      `)
      .all()
    if (releases.length !== 1) {
      throw new Error('Catalog restore does not have exactly one current release pointer')
    }
    const release = releases[0]
    if (release.release_status !== 'active') throw new Error('Catalog current release is not active')
    for (const countName of ['institutions', 'programs', 'program_cycles', 'scholarships']) {
      if (release[countName] <= 0) throw new Error(`Catalog current release has no ${countName} rows`)
    }

    const fts = database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM search_documents) AS documents,
          (SELECT COUNT(*) FROM search_fts) AS indexed_documents
      `)
      .get()
    if (fts.documents !== fts.indexed_documents) {
      throw new Error(
        `Catalog FTS row count mismatch: ${fts.documents} documents, ${fts.indexed_documents} indexed`,
      )
    }

    report.currentRelease = {
      id: release.release_id,
      status: release.release_status,
      dataDate: release.data_date,
      generatedAt: release.generated_at,
      institutions: release.institutions,
      programs: release.programs,
      programCycles: release.program_cycles,
      scholarships: release.scholarships,
    }
    report.search = {
      documents: fts.documents,
      indexedDocuments: fts.indexed_documents,
    }
  } else {
    const counts = database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM ingestion_sources) AS ingestion_sources,
          (SELECT COUNT(*) FROM ingestion_jobs) AS ingestion_jobs,
          (SELECT COUNT(*) FROM ingestion_snapshots) AS ingestion_snapshots,
          (SELECT COUNT(*) FROM ingestion_candidates) AS ingestion_candidates
      `)
      .get()
    report.runtimeCounts = {
      ingestionSources: counts.ingestion_sources,
      ingestionJobs: counts.ingestion_jobs,
      ingestionSnapshots: counts.ingestion_snapshots,
      ingestionCandidates: counts.ingestion_candidates,
    }
  }

  process.stdout.write(JSON.stringify(report))
} finally {
  database.close()
}
