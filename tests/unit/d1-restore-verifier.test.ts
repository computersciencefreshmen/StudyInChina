import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = join(process.cwd(), 'scripts', 'cloudflare', 'verify-restored-d1.mjs')
const temporaryDirectories: string[] = []

function catalogFixture(declaredCycles: number) {
  const root = mkdtempSync(join(tmpdir(), 'studyinchina-local-d1-verify-'))
  temporaryDirectories.push(root)
  const stateDirectory = join(root, 'state', 'nested')
  mkdirSync(stateDirectory, { recursive: true })
  const databasePath = join(stateDirectory, 'catalog.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE catalog_releases (
      release_id TEXT PRIMARY KEY,
      release_status TEXT NOT NULL,
      data_date TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      counts_json TEXT NOT NULL
    );
    CREATE TABLE release_pointer (singleton_id INTEGER PRIMARY KEY, current_release_id TEXT);
    CREATE TABLE catalog_records (id TEXT PRIMARY KEY);
    CREATE TABLE institutions (release_id TEXT NOT NULL);
    CREATE TABLE programs (release_id TEXT NOT NULL);
    CREATE TABLE program_cycles (release_id TEXT NOT NULL);
    CREATE TABLE scholarships (release_id TEXT NOT NULL);
    CREATE TABLE search_documents (id INTEGER PRIMARY KEY);
    CREATE TABLE search_fts (id INTEGER PRIMARY KEY);
    CREATE TRIGGER validate_catalog_record
    BEFORE INSERT ON catalog_records
    WHEN NEW.id = ''
    BEGIN
      SELECT RAISE(ABORT, 'id is required');
    END;
    INSERT INTO catalog_releases VALUES (
      'release-1',
      'active',
      '2026-08-10',
      '2026-08-10T00:00:00.000Z',
      '{"universities":1,"programs":1,"admissionCycles":${declaredCycles},"scholarships":1}'
    );
    INSERT INTO release_pointer VALUES (1, 'release-1');
    INSERT INTO institutions VALUES ('release-1');
    INSERT INTO programs VALUES ('release-1');
    INSERT INTO scholarships VALUES ('release-1');
    INSERT INTO search_documents VALUES (1);
    INSERT INTO search_fts VALUES (1);
  `)
  database.close()
  return stateDirectory
}

function runVerifier(stateDirectory: string) {
  const env = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  delete env.CLOUDFLARE_D1_BACKUP_TOKEN
  delete env.CLOUDFLARE_D1_RESTORE_TOKEN
  return spawnSync(
    process.execPath,
    ['--no-warnings', verifier, stateDirectory, 'catalog'],
    { encoding: 'utf8', env },
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('isolated D1 restore verifier', () => {
  it('accepts a zero-cycle release when the versioned count contract declares zero', () => {
    const result = runVerifier(catalogFixture(0))
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).currentRelease).toMatchObject({
      id: 'release-1',
      institutions: 1,
      programs: 1,
      programCycles: 0,
      scholarships: 1,
    })
  })

  it('fails closed when restored rows disagree with the release count contract', () => {
    const result = runVerifier(catalogFixture(1))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Catalog current release program_cycles count mismatch: expected 1, restored 0',
    )
  })
})
