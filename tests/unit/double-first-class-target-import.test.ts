import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  buildDoubleFirstClassTargetImport,
} from '../../scripts/ingestion/build-double-first-class-target-import'
import {
  validateDoubleFirstClassRegistry,
} from '../../scripts/ingestion/double-first-class-registry'

function applyPipelineMigrations(database: DatabaseSync): void {
  const directory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(directory, file), 'utf8'))
  }
}

function registry() {
  return validateDoubleFirstClassRegistry(
    JSON.parse(readFileSync(join(
      process.cwd(),
      'content',
      'source-manifests',
      'double-first-class',
      'targets.v1.json',
    ), 'utf8')) as unknown,
  )
}

describe('Double First-Class Pipeline target import', () => {
  it('registers all 147 targets and all 16 required source categories', () => {
    const database = new DatabaseSync(':memory:')
    applyPipelineMigrations(database)
    const artifact = buildDoubleFirstClassTargetImport(
      registry(),
      '2026-07-26T08:00:00.000Z',
    )

    database.exec(artifact.sql)

    expect(artifact.targets).toBe(147)
    expect(artifact.coverageRows).toBe(2352)
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM institution_targets',
    ).get()).toEqual({ count: 147 })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM institution_target_source_coverage',
    ).get()).toEqual({ count: 2352 })
    expect(database.prepare(`
      SELECT MIN(required_category_count) AS minimum,
             MAX(required_category_count) AS maximum
      FROM institution_target_coverage_summary
    `).get()).toEqual({ minimum: 16, maximum: 16 })
  })

  it('is idempotent and preserves onboarding progress', () => {
    const database = new DatabaseSync(':memory:')
    applyPipelineMigrations(database)
    const artifact = buildDoubleFirstClassTargetImport(
      registry(),
      '2026-07-26T08:00:00.000Z',
    )
    database.exec(artifact.sql)
    database.prepare(`
      UPDATE institution_targets
      SET onboarding_status = 'source_discovery'
      WHERE target_id = 'dfc-2022-001'
    `).run()
    database.prepare(`
      UPDATE institution_target_source_coverage
      SET coverage_status = 'discovered',
          official_url = 'https://www.isd.pku.edu.cn/',
          checked_at = '2026-07-26T08:30:00.000Z'
      WHERE target_id = 'dfc-2022-001'
        AND source_category = 'international_admissions_home'
    `).run()

    database.exec(artifact.sql)

    expect(database.prepare(`
      SELECT onboarding_status
      FROM institution_targets
      WHERE target_id = 'dfc-2022-001'
    `).get()).toEqual({ onboarding_status: 'source_discovery' })
    expect(database.prepare(`
      SELECT coverage_status, official_url
      FROM institution_target_source_coverage
      WHERE target_id = 'dfc-2022-001'
        AND source_category = 'international_admissions_home'
    `).get()).toEqual({
      coverage_status: 'discovered',
      official_url: 'https://www.isd.pku.edu.cn/',
    })
  })
})
