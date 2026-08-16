import { constants as bufferConstants } from 'node:buffer'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'

const [stateDirectory, kind, sqlPath] = process.argv.slice(2)

if (!stateDirectory || !['catalog', 'pipeline'].includes(kind) || !sqlPath) {
  throw new Error(
    'Usage: node import-restored-d1.mjs <local-state-directory> <catalog|pipeline> <data-only.sql>',
  )
}

const markerTable = kind === 'catalog' ? 'catalog_releases' : 'records'

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

function findIsolatedDatabase(directory) {
  const matches = []
  for (const path of sqliteFiles(resolve(directory))) {
    const database = new DatabaseSync(path)
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
    throw new Error(`Expected one isolated ${kind} SQLite file, found ${matches.length}`)
  }
  return matches[0]
}

function hasExplicitTransaction(sql) {
  return /^\s*(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?|SAVEPOINT\s+|RELEASE\s+)\b/imu.test(
    sql,
  )
}

function rollbackIfNeeded(database) {
  if (database.isTransaction) database.exec('ROLLBACK')
}

function importData(database, sql) {
  database.exec('PRAGMA foreign_keys = ON;')
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get()
  if (Number(foreignKeys.foreign_keys) !== 1) {
    throw new Error('Unable to enable foreign-key enforcement for the isolated restore')
  }

  if (hasExplicitTransaction(sql)) {
    try {
      database.exec(sql)
      if (database.isTransaction) {
        database.exec('ROLLBACK')
        throw new Error('Backup SQL left an explicit transaction open')
      }
      return 'archive'
    } catch (error) {
      rollbackIfNeeded(database)
      throw error
    }
  }

  database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = TRUE;')
  try {
    database.exec(sql)
    database.exec('COMMIT')
    return 'wrapper'
  } catch (error) {
    rollbackIfNeeded(database)
    throw error
  }
}

function main() {
  const resolvedSqlPath = resolve(sqlPath)
  const sqlBytes = statSync(resolvedSqlPath).size
  if (sqlBytes <= 0) throw new Error('Data-only SQL backup is empty')
  if (sqlBytes > bufferConstants.MAX_STRING_LENGTH) {
    throw new Error(
      `Data-only SQL backup is too large for the local bulk importer (${sqlBytes} bytes)`,
    )
  }

  const sql = readFileSync(resolvedSqlPath, 'utf8')
  if (Buffer.byteLength(sql, 'utf8') !== sqlBytes) {
    throw new Error('Data-only SQL backup is not valid UTF-8 text')
  }

  const { path, database } = findIsolatedDatabase(stateDirectory)
  const startedAt = performance.now()
  try {
    const transactionMode = importData(database, sql)
    process.stdout.write(
      JSON.stringify({
        databaseFile: basename(path),
        engine: 'node:sqlite',
        transactionMode,
        sqlBytes,
        elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      }),
    )
  } finally {
    rollbackIfNeeded(database)
    database.close()
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Local D1 bulk import failed: ${message}\n`)
  process.exitCode = 1
}
