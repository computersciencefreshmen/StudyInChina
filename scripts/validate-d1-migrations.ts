import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type DatabaseTarget = {
  name: 'catalog' | 'pipeline'
  migrationsDirectory: string
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const targets: DatabaseTarget[] = (['catalog', 'pipeline'] as const).map((name) => ({
  name,
  migrationsDirectory: resolve(repositoryRoot, 'infra', 'd1', name, 'migrations'),
}))

function migrationFiles(directory: string): string[] {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'))

  if (files.length === 0) {
    throw new Error(`No D1 migrations found in ${directory}`)
  }

  for (const file of files) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) {
      throw new Error(`Migration filename is not sortable and portable: ${file}`)
    }
  }

  return files
}

function verifyDatabase(database: DatabaseSync, target: string, pass: number): void {
  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `${target} migrations pass ${pass} left ${foreignKeyViolations.length} foreign-key violation(s): ${JSON.stringify(foreignKeyViolations)}`,
    )
  }

  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<
    Record<string, unknown>
  >
  const integrityMessages = integrityRows.flatMap((row) => Object.values(row).map(String))
  if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
    throw new Error(
      `${target} migrations pass ${pass} failed integrity_check: ${integrityMessages.join('; ')}`,
    )
  }
}

function validateTarget(target: DatabaseTarget): void {
  const files = migrationFiles(target.migrationsDirectory)
  const database = new DatabaseSync(':memory:')

  try {
    database.exec('PRAGMA foreign_keys = ON')

    for (let pass = 1; pass <= 2; pass += 1) {
      for (const file of files) {
        const migrationPath = resolve(target.migrationsDirectory, file)
        const sql = readFileSync(migrationPath, 'utf8')
        try {
          database.exec(sql)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${target.name} migration ${file} failed on pass ${pass}: ${message}`)
        }
      }

      verifyDatabase(database, target.name, pass)
    }

    const schemaObjectCount = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'`,
      )
      .get() as { count: number }

    console.log(
      `Validated ${target.name}: ${files.length} migrations applied twice, ${schemaObjectCount.count} schema objects, foreign_key_check clean, integrity_check ok.`,
    )
  } finally {
    database.close()
  }
}

try {
  for (const target of targets) validateTarget(target)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
