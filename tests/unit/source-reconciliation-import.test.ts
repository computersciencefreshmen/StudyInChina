import { DatabaseSync } from 'node:sqlite'
import {
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildDoubleFirstClassTargetImport,
} from '../../scripts/ingestion/build-double-first-class-target-import'
import {
  buildSourceReconciliationImport,
} from '../../scripts/ingestion/build-source-reconciliation-import'
import {
  loadSourceReconciliations,
} from '../../scripts/ingestion/source-reconciliation'
import {
  validateDoubleFirstClassRegistry,
} from '../../scripts/ingestion/double-first-class-registry'

const reconciliationDirectory = join(
  process.cwd(),
  'content',
  'source-registry',
  'reconciliation',
)

function pipelineDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const migrationDirectory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const fileName of readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(migrationDirectory, fileName), 'utf8'))
  }
  return database
}

describe('final Double First-Class source reconciliation', () => {
  it('normalizes all 17 schools and enforces null unavailable values', () => {
    const institutions = loadSourceReconciliations(reconciliationDirectory)
    expect(institutions).toHaveLength(17)
    expect(institutions.flatMap((institution) => institution.categories)).toHaveLength(51)
    for (const institution of institutions) {
      expect(institution.categories).toHaveLength(3)
      for (const category of institution.categories) {
        expect(category.evidenceUrl).toMatch(/^https:\/\//u)
        if (category.status === 'verified_official') {
          expect(category.officialUrl).toMatch(/^https:\/\//u)
        } else {
          expect(category.officialUrl).toBeNull()
        }
      }
    }
  })

  it('imports all reconciled statuses idempotently into the real Pipeline schema', () => {
    const registry = validateDoubleFirstClassRegistry(JSON.parse(readFileSync(join(
      process.cwd(),
      'content',
      'source-manifests',
      'double-first-class',
      'targets.v1.json',
    ), 'utf8')) as unknown)
    const database = pipelineDatabase()
    database.exec(buildDoubleFirstClassTargetImport(
      registry,
      '2026-07-26T00:00:00.000Z',
    ).sql)
    const output = buildSourceReconciliationImport()
    expect(output.counts).toMatchObject({
      institutions: 17,
      categories: 51,
    })
    database.exec(output.sql)
    database.exec(output.sql)
    const names = loadSourceReconciliations(reconciliationDirectory)
      .map((institution) => institution.institutionNameZh)
    const placeholders = names.map(() => '?').join(',')
    expect(database.prepare(`
      SELECT
        COUNT(*) AS categories,
        SUM(CASE WHEN coverage.coverage_status = 'discovered' THEN 1 ELSE 0 END)
          AS discovered,
        SUM(CASE WHEN coverage.coverage_status = 'source_unavailable' THEN 1 ELSE 0 END)
          AS unavailable,
        SUM(CASE WHEN coverage.coverage_status = 'officially_not_provided' THEN 1 ELSE 0 END)
          AS not_provided,
        SUM(CASE WHEN coverage.coverage_status = 'discovery_pending' THEN 1 ELSE 0 END)
          AS pending
      FROM institution_target_source_coverage coverage
      JOIN institution_targets target ON target.target_id = coverage.target_id
      WHERE target.official_name_zh IN (${placeholders})
        AND coverage.source_category IN (
          'international_admissions_home',
          'catalog_anchor',
          'university_scholarship'
        )
    `).get(...names)).toEqual({
      categories: 51,
      discovered: output.counts.discovered,
      unavailable: output.counts.sourceUnavailable,
      not_provided: output.counts.officiallyNotProvided,
      pending: 0,
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })
})
