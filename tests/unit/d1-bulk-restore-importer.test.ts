import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

const importer = join(process.cwd(), 'scripts', 'cloudflare', 'import-restored-d1.mjs')
const temporaryDirectories: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studyinchina-local-d1-import-'))
  temporaryDirectories.push(root)
  const stateDirectory = join(root, 'state', 'nested')
  mkdirSync(stateDirectory, { recursive: true })
  const databasePath = join(stateDirectory, 'pipeline.sqlite')
  const sqlPath = join(root, 'pipeline.sql')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE records (id TEXT PRIMARY KEY);
    CREATE TABLE restored_rows (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES records(id)
    );
    CREATE TRIGGER validate_restored_row
    BEFORE INSERT ON restored_rows
    WHEN NEW.id = ''
    BEGIN
      SELECT RAISE(ABORT, 'id is required');
    END;
  `)
  database.close()
  return { root, stateDirectory, databasePath, sqlPath }
}

function runImporter(stateDirectory: string, sqlPath: string) {
  const env = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  delete env.CLOUDFLARE_D1_BACKUP_TOKEN
  delete env.CLOUDFLARE_D1_RESTORE_TOKEN
  return spawnSync(
    process.execPath,
    ['--no-warnings', importer, stateDirectory, 'pipeline', sqlPath],
    { encoding: 'utf8', env },
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('isolated D1 bulk restore importer', () => {
  it('imports a data-only dump atomically without Cloudflare credentials', () => {
    const { stateDirectory, databasePath, sqlPath } = fixture()
    writeFileSync(
      sqlPath,
      [
        'PRAGMA defer_foreign_keys=TRUE;',
        `INSERT INTO restored_rows (id, record_id) VALUES ('row-1', 'record-1');`,
        `INSERT INTO records (id) VALUES ('record-1');`,
      ].join('\n'),
    )

    const result = runImporter(stateDirectory, sqlPath)
    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report).toMatchObject({
      engine: 'node:sqlite',
      transactionMode: 'wrapper',
      sqlBytes: expect.any(Number),
      elapsedMs: expect.any(Number),
    })

    const restored = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(restored.prepare('SELECT * FROM restored_rows').all()).toEqual([
        { id: 'row-1', record_id: 'record-1' },
      ])
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      restored.close()
    }
  })

  it('rolls back the complete dump when any statement fails', () => {
    const { stateDirectory, databasePath, sqlPath } = fixture()
    writeFileSync(
      sqlPath,
      [
        `INSERT INTO records (id) VALUES ('must-roll-back');`,
        `INSERT INTO table_that_does_not_exist (id) VALUES ('failure');`,
      ].join('\n'),
    )

    const result = runImporter(stateDirectory, sqlPath)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Local D1 bulk import failed')

    const restored = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(restored.prepare('SELECT COUNT(*) AS count FROM records').get()).toEqual({ count: 0 })
    } finally {
      restored.close()
    }
  })
})
