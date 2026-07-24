import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLegacyRelease, readLegacyBundle } from '../../scripts/catalog/build-release'

function catalogDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  const directory = join(process.cwd(), 'infra', 'd1', 'catalog', 'migrations')
  for (const file of readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(directory, file), 'utf8'))
  }
  database.exec(buildLegacyRelease(readLegacyBundle()).sql)
  return database
}

describe('Catalog identity-only program visibility', () => {
  it('keeps a verified degree identity searchable without inventing a current cycle', () => {
    const database = catalogDatabase()
    const program = database.prepare(`
      SELECT program.release_id, program.program_id
      FROM current_programs AS program
      WHERE program.program_type NOT IN ('exchange', 'visiting', 'short_term')
        AND EXISTS (
          SELECT 1 FROM program_cycles AS cycle
          WHERE cycle.release_id = program.release_id
            AND cycle.program_id = program.program_id
        )
      ORDER BY program.program_id
      LIMIT 1
    `).get() as { release_id: string; program_id: string }

    database.prepare(`
      UPDATE program_cycles
      SET cycle_status = 'archived'
      WHERE release_id = ? AND program_id = ?
    `).run(program.release_id, program.program_id)

    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM current_programs
      WHERE release_id = ? AND program_id = ?
    `).get(program.release_id, program.program_id)!.count).toBe(1)
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM current_program_cycles
      WHERE release_id = ? AND program_id = ?
    `).get(program.release_id, program.program_id)!.count).toBe(0)
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM current_application_routes AS route
      JOIN program_cycles AS cycle
        ON cycle.release_id = route.release_id
       AND cycle.program_cycle_id = route.owner_record_id
      WHERE cycle.release_id = ? AND cycle.program_id = ?
    `).get(program.release_id, program.program_id)!.count).toBe(0)
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM current_search_documents
      WHERE release_id = ? AND record_id = ?
    `).get(program.release_id, program.program_id)!.count).toBeGreaterThan(0)

    database.close()
  })
})
