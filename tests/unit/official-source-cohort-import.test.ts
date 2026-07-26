import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  buildDoubleFirstClassTargetImport,
} from '../../scripts/ingestion/build-double-first-class-target-import'
import {
  buildOfficialSourceCohortImport,
  loadOfficialSourceCohorts,
  validateOfficialSourceCohort,
} from '../../scripts/ingestion/build-official-source-cohort-import'
import {
  validateDoubleFirstClassRegistry,
} from '../../scripts/ingestion/double-first-class-registry'

function databaseWithSchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const directory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(directory, file), 'utf8'))
  }
  return database
}

function registry() {
  return validateDoubleFirstClassRegistry(JSON.parse(readFileSync(join(
    process.cwd(),
    'content',
    'source-manifests',
    'double-first-class',
    'targets.v1.json',
  ), 'utf8')) as unknown)
}

describe('official source cohort import', () => {
  it('maps verified sources onto official targets and promotes registered manifests', () => {
    const database = databaseWithSchema()
    const targetRegistry = registry()
    database.exec(buildDoubleFirstClassTargetImport(
      targetRegistry,
      '2026-07-26T08:00:00.000Z',
    ).sql)
    database.prepare(`
      INSERT INTO ingestion_sources (
        source_id, manifest_json, enabled, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?)
    `).run(
      'thu-intl-admissions-home',
      JSON.stringify({
        institutionId: 'uni-tsinghua-university',
        officialUrl: 'https://international.join-tsinghua.edu.cn/',
      }),
      '2026-07-26T08:00:00.000Z',
      '2026-07-26T08:00:00.000Z',
    )

    const cohorts = loadOfficialSourceCohorts()
    const cohortSources = cohorts.flatMap((cohort) => cohort.sources)
    const expectedInstitutionIds = new Set(
      cohortSources.map((source) => source.institutionId),
    )
    const expectedMappedNames = new Set(
      targetRegistry.targets
        .filter((target) => target.catalogInstitutionId)
        .map((target) => target.officialNameZh),
    )
    for (const source of cohortSources) {
      expectedMappedNames.add(source.institutionNameZh)
    }

    const artifact = buildOfficialSourceCohortImport(
      cohorts,
      targetRegistry,
      '2026-07-26T09:00:00.000Z',
    )
    database.exec(artifact.sql)
    database.exec(artifact.sql)

    expect(artifact).toMatchObject({
      cohorts: cohorts.length,
      institutions: expectedInstitutionIds.size,
      sources: cohortSources.length,
    })
    expect(database.prepare(`
      SELECT coverage_status, registered_source_id
      FROM institution_target_source_coverage
      WHERE target_id = 'dfc-2022-003'
        AND source_category = 'international_admissions_home'
    `).get()).toEqual({
      coverage_status: 'registered',
      registered_source_id: 'thu-intl-admissions-home',
    })
    expect(database.prepare(`
      SELECT coverage_status, official_url
      FROM institution_target_source_coverage
      WHERE target_id = 'dfc-2022-006'
        AND source_category = 'catalog_anchor'
    `).get()).toEqual({
      coverage_status: 'discovered',
      official_url: 'https://is.buaa.edu.cn/en/info/1029/3071.htm',
    })
    expect(database.prepare(`
      SELECT
        SUM(CASE WHEN coverage_status = 'registered' THEN 1 ELSE 0 END) AS registered,
        SUM(CASE WHEN coverage_status = 'discovered' THEN 1 ELSE 0 END) AS discovered,
        SUM(CASE WHEN coverage_status = 'discovery_pending' THEN 1 ELSE 0 END) AS pending
      FROM institution_target_source_coverage
    `).get()).toEqual({
      registered: 1,
      discovered: cohortSources.length - 1,
      pending: 2352 - cohortSources.length,
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM institution_targets
      WHERE catalog_institution_id IS NOT NULL
    `).get()).toEqual({ count: expectedMappedNames.size })
  })

  it('rejects a source whose hostname is outside its explicit allowlist', () => {
    const cohort = structuredClone(loadOfficialSourceCohorts()[0])
    if (!cohort) throw new Error('Expected source cohort fixture')
    cohort.sources[0] = {
      ...cohort.sources[0]!,
      officialUrl: 'https://evil.example/admissions',
    }

    expect(() => validateOfficialSourceCohort(cohort)).toThrow(
      'official URL host is not allowed',
    )
  })
})
