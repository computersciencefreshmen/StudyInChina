import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/reviewed-sjtu-2027-20261117/review.json'
import { buildLegacyRelease } from '../../scripts/catalog/build-release'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { admissionCycleSchema, programSchema } from '@/lib/data/schema'

const cycles = review.reviewedAdmissionCycles.map(row => admissionCycleSchema.parse(row))
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const directory = join(process.cwd(), 'infra/d1/catalog/migrations')
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(join(directory, file), 'utf8'))
  return db
}

describe('SJTU native SQL literal-year and three-round projection', () => {
  let db: DatabaseSync
  let compatibility: ReturnType<typeof loadMaintenanceBundle>
  beforeAll(() => {
    const artifact = buildLegacyRelease(loadMaintenanceBundle(process.cwd()))
    compatibility = JSON.parse(artifact.envelope).data
    db = database()
    db.exec(artifact.sql)
  }, 30_000)
  afterAll(() => db?.close())

  it('retains fifteen source cycle IDs as three independent sequence rows for each literal-2027 programme', () => {
    expect(cycles).toHaveLength(15)
    for (const program of review.reviewedPrograms) {
      const rows = db.prepare('SELECT program_cycle_id,academic_year,intake_code,sequence FROM program_cycles WHERE program_id=? ORDER BY sequence').all(program.id)
      expect(rows).toEqual(cycles.filter(row => row.programId === program.id).map((cycle, index) => ({
        program_cycle_id: cycle.id, academic_year: '2027', intake_code: 'autumn', sequence: index + 1,
      })))
      expect(compatibility.programs.find(row => row.id === program.id)).toEqual(program)
    }
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('binds each native route and window to its own round without changing date, portal or source identity', () => {
    for (const cycle of cycles) {
      const rows = db.prepare(`SELECT route.application_route_id,route.owner_record_id,route.apply_url,
        window.application_window_id,window.round_label,window.opens_on,window.closes_on
        FROM application_routes AS route JOIN application_windows AS window
        ON window.release_id=route.release_id AND window.application_route_id=route.application_route_id
        WHERE route.owner_record_id=?`).all(cycle.id)
      expect(rows).toEqual([{
        application_route_id: `route-${cycle.id}`, owner_record_id: cycle.id, apply_url: 'https://apply.sjtu.edu.cn/',
        application_window_id: `window-${cycle.id}`, round_label: cycle.applicationRound,
        opens_on: cycle.opensOn, closes_on: cycle.closesOn,
      }])
      expect(compatibility.admissionCycles.find(row => row.id === cycle.id)).toEqual(cycle)
      expect(db.prepare('SELECT source_id FROM record_sources WHERE record_id=? ORDER BY source_id').all(cycle.id).map(row => row.source_id))
        .toEqual([...cycle.sourceIds].sort())
    }
  })

  it('does not let an unavailable annual route borrow the programme or another round route', () => {
    // Deliberately synthetic mutations exercise isolation; canonical source data is untouched.
    const fixture = loadMaintenanceBundle(process.cwd()), program = programSchema.parse(review.reviewedPrograms[0])
    fixture.programs = [program]
    fixture.scholarships = []
    fixture.admissionCycles = structuredClone(cycles.filter(row => row.programId === program.id))
    fixture.programs[0].applyUrl = 'https://example.edu/synthetic-program-route'
    fixture.admissionCycles[1].applyUrl = null
    fixture.admissionCycles[2].applyUrl = 'https://example.edu/synthetic-third-round'
    const isolated = database()
    try {
      isolated.exec(buildLegacyRelease(fixture).sql)
      expect(isolated.prepare('SELECT owner_record_id,apply_url FROM application_routes WHERE owner_record_id IN (?,?,?) ORDER BY owner_record_id')
        .all(...fixture.admissionCycles.map(row => row.id))).toEqual(fixture.admissionCycles.map(cycle => ({
          owner_record_id: cycle.id, apply_url: cycle.applyUrl,
        })).sort((a, b) => a.owner_record_id.localeCompare(b.owner_record_id)))
      expect(isolated.prepare('SELECT count(*) AS n FROM program_cycles WHERE program_id=?').get(program.id)).toEqual({ n: 3 })
      expect(isolated.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { isolated.close() }
  }, 30_000)
})
