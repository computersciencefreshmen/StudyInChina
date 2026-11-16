import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLegacyRelease } from '../../scripts/catalog/build-release'
import type { DataBundle } from '@/lib/data/types'

const directory = join(process.cwd(), 'infra/d1/catalog/migrations')
const migrationName = '0013_explicit_admission_year.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')

function fixture() {
  const db = new DatabaseSync(':memory:')
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < migrationName).sort()) {
    db.exec(readFileSync(join(directory, name), 'utf8').replaceAll("date('now')", "date('2026-11-16')"))
  }
  const audit = { sourceIds: ['source'], status: 'verified' as const, verifiedAt: '2026-11-16', reviewAfter: '2026-12-16' }
  const bundle: DataBundle = {
    sources: [{ id: 'source', url: 'https://example.edu/admissions/2027', title: 'Official 2027 programme guide', publisher: 'Example University', kind: 'program', language: 'en', official: true, accessedAt: '2026-11-16' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: null, officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'school', name: { en: 'Computer Science' }, degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['Chinese'], durationMonths: 48, programUrl: 'https://example.edu/admissions/2027', applyUrl: 'https://example.edu/apply', languageRequirements: [{ test: 'HSK', minimum: 'Level 5, 180' }], supplementaryDetails: { eligibility: [{ en: 'High school graduate' }] } }],
    admissionCycles: [{ ...audit, id: 'legacy-cycle', programId: 'program', academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-11-01', closesOn: '2027-05-30', dateStatus: 'published', tuitionCny: 25000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 400, evidenceBasis: 'cycle-specific', factScope: 'complete' }],
    scholarships: [],
  }
  db.exec(buildLegacyRelease(bundle).sql)
  db.exec(`INSERT INTO catalog_records (release_id,record_id,record_kind,gate_status,verified_at,review_after,content_sha256)
    SELECT release_id,'cycle-education','requirement',gate_status,verified_at,review_after,content_sha256 FROM catalog_records WHERE record_id='legacy-cycle';
    INSERT INTO requirements (release_id,requirement_id,owner_record_id,requirement_type,value_json)
    SELECT release_id,'cycle-education','legacy-cycle','education','"High school graduate"' FROM program_cycles WHERE program_cycle_id='legacy-cycle';`)
  return db
}

function tableRows(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))]))
}

function dependentSchema(db: DatabaseSync) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('view','trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: typeof row.sql === 'string' ? row.sql.replaceAll('\r\n', '\n') : row.sql }))
}

function foreignKeys(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`PRAGMA foreign_key_list("${name}")`).all()]))
}

function insertCycle(db: DatabaseSync, id: string, year: string | null, sequence = 1) {
  db.prepare(`INSERT INTO catalog_records (release_id,record_id,record_kind,slug,gate_status,verified_at,review_after,content_sha256)
    SELECT release_id,?,'program_cycle',NULL,gate_status,verified_at,review_after,content_sha256 FROM catalog_records WHERE record_id='legacy-cycle'`).run(id)
  db.prepare(`INSERT INTO program_cycles (release_id,program_cycle_id,program_id,academic_year,intake_code,sequence,starts_on,ends_on,cycle_status,official_url)
    SELECT release_id,?,program_id,?,intake_code,?,starts_on,ends_on,cycle_status,official_url FROM program_cycles WHERE program_cycle_id='legacy-cycle'`).run(id, year, sequence)
}

describe('additive source-declared admission year migration', () => {
  it('preserves populated tables, exact legacy labels, FK rules, indexes, views and activation triggers', () => {
    const db = fixture()
    try {
      const before = tableRows(db), schema = dependentSchema(db), keys = foreignKeys(db)
      expect(before.program_cycles).toHaveLength(1)
      expect(before.application_routes.length).toBeGreaterThan(0)
      expect(before.application_windows.length).toBeGreaterThan(0)
      expect(before.fee_items.length).toBeGreaterThan(0)
      expect(before.requirements.length).toBeGreaterThan(0)
      db.exec(migration)
      expect(tableRows(db)).toEqual(before)
      expect(dependentSchema(db)).toEqual(schema)
      expect(foreignKeys(db)).toEqual(keys)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      expect(db.prepare('PRAGMA legacy_alter_table').get()).toEqual({ legacy_alter_table: 0 })
      for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='view'").all() as { name: string }[]) {
        expect(() => db.prepare(`SELECT * FROM "${name}" LIMIT 1`).all(), name).not.toThrow()
      }
      // The repository validates every migration twice; rebuilding is repeatable.
      db.exec(migration)
      expect(tableRows(db)).toEqual(before)
      expect(dependentSchema(db)).toEqual(schema)
    } finally { db.close() }
  })

  it('stores both source forms verbatim and preserves constraint enforcement after the rebuild', () => {
    const db = fixture()
    try {
      db.exec(migration)
      insertCycle(db, 'literal-cycle', '2027')
      insertCycle(db, 'second-range-cycle', '2027-2028', 2)
      expect(db.prepare('SELECT program_cycle_id,academic_year FROM program_cycles ORDER BY program_cycle_id').all()).toEqual([
        { program_cycle_id: 'legacy-cycle', academic_year: '2027-2028' },
        { program_cycle_id: 'literal-cycle', academic_year: '2027' },
        { program_cycle_id: 'second-range-cycle', academic_year: '2027-2028' },
      ])
      expect(() => db.prepare("UPDATE program_cycles SET sequence=0 WHERE program_cycle_id='literal-cycle'").run()).toThrow(/CHECK constraint/u)
      expect(() => db.prepare("UPDATE program_cycles SET official_url='http://example.edu' WHERE program_cycle_id='literal-cycle'").run()).toThrow(/CHECK constraint/u)
      expect(() => db.prepare("UPDATE program_cycles SET program_id='missing' WHERE program_cycle_id='literal-cycle'").run()).toThrow(/FOREIGN KEY constraint/u)
      expect(() => db.prepare("DELETE FROM programs WHERE program_id='program'").run()).toThrow(/FOREIGN KEY constraint/u)
      expect(() => insertCycle(db, 'duplicate-cycle', '2027')).toThrow(/UNIQUE constraint/u)
      db.prepare("DELETE FROM catalog_records WHERE record_id='literal-cycle'").run()
      expect(db.prepare("SELECT count(*) AS count FROM program_cycles WHERE program_cycle_id='literal-cycle'").get()).toEqual({ count: 0 })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })

  it.each([null, '', 'unknown', '202', '20270', ' 2027', '2027 ', '2027/2028', '2027-2027', '2027-2029', '2028-2027', '2027-20x8', '2027–2028'])('rejects missing/malformed/nonconsecutive year %s', year => {
    const db = fixture()
    try {
      db.exec(migration)
      expect(() => insertCycle(db, 'invalid-cycle', year)).toThrow(/(?:CHECK|NOT NULL) constraint/u)
      expect(db.prepare("SELECT academic_year FROM program_cycles WHERE program_cycle_id='legacy-cycle'").get()).toEqual({ academic_year: '2027-2028' })
    } finally { db.close() }
  })

  it('fails atomically if previously injected nonconsecutive legacy data needs review', () => {
    const db = fixture()
    try {
      // The old D1 constraint checked shape only; do not silently delete or
      // relabel a pre-existing invalid range while tightening validation.
      insertCycle(db, 'invalid-legacy-cycle', '2027-2029')
      const before = tableRows(db), schema = dependentSchema(db)
      db.exec('BEGIN')
      expect(() => db.exec(migration)).toThrow(/CHECK constraint/u)
      db.exec('ROLLBACK; PRAGMA legacy_alter_table=OFF;')
      expect(tableRows(db)).toEqual(before)
      expect(dependentSchema(db)).toEqual(schema)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })
})

