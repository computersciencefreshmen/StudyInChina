import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS,
  resolveOfficialEntityInputPaths,
} from '../../scripts/ingestion/official-entity-input-adapters'
import {
  buildOfficialEntityMaterialization,
} from '../../scripts/ingestion/materialize-official-entities'
import {
  DEFAULT_SCHOLARSHIP_INDEX_SOURCES,
  harvestScholarshipIndexes,
} from '../../scripts/ingestion/scholarship-index-harvester'

type JsonRecord = Record<string, unknown>

const materializerFixtureDirectory = join(
  process.cwd(),
  'tests',
  'fixtures',
  'official-entity-materializer',
)
const scholarshipFixtureDirectory = join(
  process.cwd(),
  'tests',
  'fixtures',
  'scholarship-index',
)

function fixture(name: string): JsonRecord {
  return JSON.parse(
    readFileSync(join(materializerFixtureDirectory, name), 'utf8'),
  ) as JsonRecord
}

function databaseWithPipelineSchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const directory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  for (const migration of readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(join(directory, migration), 'utf8'))
  }
  return database
}

function seedOrganization(
  database: DatabaseSync,
  id: string,
  officialUrl: string,
): void {
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'organization', ?, 'draft', ?, ?)
  `).run(
    id,
    id,
    id,
    '2026-07-23T00:00:00.000Z',
    '2026-07-23T00:00:00.000Z',
  )
  database.prepare(`
    INSERT INTO organizations (record_id, organization_type, official_url)
    VALUES (?, 'university', ?)
  `).run(id, officialUrl)
}

function seedZju(database: DatabaseSync): void {
  const institutionId = 'uni-zhejiang-university'
  const cityId = 'fixture-city-hangzhou'
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'location', ?, 'draft', ?, ?)
  `).run(
    cityId,
    cityId,
    cityId,
    '2026-07-23T00:00:00.000Z',
    '2026-07-23T00:00:00.000Z',
  )
  database.prepare(`
    INSERT INTO locations (record_id, location_type, country_code)
    VALUES (?, 'city', 'CN')
  `).run(cityId)
  seedOrganization(database, institutionId, 'https://www.zju.edu.cn/')
  database.prepare(`
    INSERT INTO institutions (
      record_id, city_id, institution_type, admissions_url, featured
    ) VALUES (?, ?, 'comprehensive', ?, 0)
  `).run(institutionId, cityId, 'https://iczu.zju.edu.cn/')
}

function count(database: DatabaseSync, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
}

describe('raw official entity input adapters', () => {
  it('materializes raw ZJU PDF harvest evidence as English pdf_region facts only', () => {
    const raw = fixture('zju-pdf-harvest.json')
    const artifacts = buildOfficialEntityMaterialization(raw)

    expect(artifacts.manifest).toMatchObject({
      prerequisiteInstitutionIds: ['uni-zhejiang-university'],
      prerequisiteProviderOrganizationIds: [],
      ignoredCycleHints: 0,
      counts: {
        records: 2,
        programs: 2,
        scholarships: 0,
        localizedContent: 2,
        sourceDocuments: 1,
        sourceFetches: 1,
        sourceFragments: 2,
        claims: 8,
        canonicalFields: 8,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(artifacts.sql).toContain("'pdf_region'")
    expect(artifacts.sql).toContain(
      "'pdf:page=1;lines=4-4;bbox=200,160,425,10'",
    )
    expect(artifacts.sql).toContain(
      "'School of Economics — Economics — 2 years — RMB 22,800 yuan/year'",
    )
    expect(artifacts.sql).not.toContain('INSERT INTO program_cycles')
    expect(artifacts.sql).not.toContain('INSERT INTO fee_items')

    const database = databaseWithPipelineSchema()
    seedZju(database)
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM programs) AS programs,
        (SELECT COUNT(*) FROM program_cycles) AS cycles,
        (SELECT COUNT(*) FROM localized_content WHERE locale = 'en') AS names_en,
        (SELECT COUNT(*) FROM localized_content WHERE locale = 'zh') AS names_zh,
        (SELECT COUNT(*) FROM source_fragments
          WHERE locator_type = 'pdf_region') AS pdf_regions
    `).get()).toEqual({
      programs: 2,
      cycles: 0,
      names_en: 2,
      names_zh: 0,
      pdf_regions: 2,
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })

  it('selects zh locale for Chinese ZJU catalogs and fails closed on host or geometry drift', () => {
    const chinese = structuredClone(fixture('zju-pdf-harvest.json'))
    chinese.instructionLanguage = 'Chinese'
    for (const [index, value] of (chinese.entities as JsonRecord[]).entries()) {
      value.instructionLanguage = 'Chinese'
      value.entityKey = `zju:master:chinese:fixture:${index + 1}`
      value.name = index === 0 ? '经济学' : '创新创业与全球领导力'
    }
    const chineseArtifacts = buildOfficialEntityMaterialization(chinese)
    expect(chineseArtifacts.manifest.counts.localizedContent).toBe(2)
    expect(chineseArtifacts.sql).toContain("'zh'")
    expect(chineseArtifacts.sql).not.toContain("'en', 'name'")

    const wrongHost = structuredClone(fixture('zju-pdf-harvest.json'))
    wrongHost.officialUrl = 'https://zju.edu.cn.evil.example/catalog.pdf'
    expect(() => buildOfficialEntityMaterialization(wrongHost))
      .toThrow(/Zhejiang University URL/u)

    const wrongLocator = structuredClone(fixture('zju-pdf-harvest.json'))
    const evidence = ((wrongLocator.entities as JsonRecord[])[0].evidence as JsonRecord)
    evidence.locator = 'pdf:page=1;lines=4-4;bbox=201,160,425,10'
    expect(() => buildOfficialEntityMaterialization(wrongLocator))
      .toThrow(/locator does not match/u)
  })

  it('deduplicates identical multi-input identities and rejects factual or owner conflicts', () => {
    const raw = fixture('zju-pdf-harvest.json')
    const single = buildOfficialEntityMaterialization(raw)
    const duplicate = buildOfficialEntityMaterialization([
      raw,
      structuredClone(raw),
    ])
    expect(duplicate).toEqual(single)

    const factualConflict = structuredClone(raw)
    ;(factualConflict.entities as JsonRecord[])[0].name = 'Conflicting Economics'
    expect(() => buildOfficialEntityMaterialization([raw, factualConflict]))
      .toThrow(/conflicting duplicate official entity identity/u)

    const generic = fixture('zju-normalized.json')
    const ownerConflict = structuredClone(generic)
    ;(ownerConflict.source as JsonRecord).officialHosts = ['yzbm.tsinghua.edu.cn']
    const ownerConflictEntity = (ownerConflict.entities as JsonRecord[])[0]
    ownerConflictEntity.institutionId = 'uni-tsinghua-university'
    ownerConflictEntity.officialUrl =
      'https://yzbm.tsinghua.edu.cn/official/program/120100'
    ;(ownerConflictEntity.evidence as JsonRecord[])[0].officialUrl =
      'https://yzbm.tsinghua.edu.cn/official/program/120100'
    expect(() => buildOfficialEntityMaterialization([generic, ownerConflict]))
      .toThrow(/maps to conflicting identities/u)

    const combined = buildOfficialEntityMaterialization([raw, generic])
    expect(combined.manifest.counts.programs).toBe(3)
  })

  it('supports repeated --input and one sorted --input-directory through the real CLI', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'official-entity-inputs-'))
    try {
      const inputDirectory = join(temporaryDirectory, 'inputs')
      const repeatedOutput = join(temporaryDirectory, 'repeated-output')
      const directoryOutput = join(temporaryDirectory, 'directory-output')
      mkdirSync(inputDirectory)
      const rawPath = join(inputDirectory, '02-zju-pdf-harvest.json')
      const genericPath = join(inputDirectory, '01-zju-normalized.json')
      copyFileSync(
        join(materializerFixtureDirectory, 'zju-pdf-harvest.json'),
        rawPath,
      )
      copyFileSync(
        join(materializerFixtureDirectory, 'zju-normalized.json'),
        genericPath,
      )

      expect(resolveOfficialEntityInputPaths([
        '--input-directory',
        inputDirectory,
      ])).toEqual([genericPath, rawPath])
      expect(() => resolveOfficialEntityInputPaths([
        '--input',
        rawPath,
        '--input-directory',
        inputDirectory,
      ])).toThrow(/not both/u)

      const node = process.execPath
      const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
      const script = join(
        process.cwd(),
        'scripts',
        'ingestion',
        'materialize-official-entities.ts',
      )
      const repeatedManifestPath = execFileSync(node, [
        tsx,
        script,
        '--input',
        rawPath,
        '--input',
        rawPath,
        '--output',
        repeatedOutput,
      ], { encoding: 'utf8', windowsHide: true }).trim()
      const repeatedManifest = JSON.parse(
        readFileSync(repeatedManifestPath, 'utf8'),
      ) as JsonRecord
      expect((repeatedManifest.inputPaths as string[])).toEqual([rawPath, rawPath])
      expect((repeatedManifest.counts as JsonRecord).programs).toBe(2)

      const directoryManifestPath = execFileSync(node, [
        tsx,
        script,
        '--input-directory',
        inputDirectory,
        '--output',
        directoryOutput,
      ], { encoding: 'utf8', windowsHide: true }).trim()
      const directoryManifest = JSON.parse(
        readFileSync(directoryManifestPath, 'utf8'),
      ) as JsonRecord
      expect(directoryManifest.inputPaths).toEqual([genericPath, rawPath])
      expect((directoryManifest.counts as JsonRecord).programs).toBe(3)
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }, 15_000)

  it('maps raw six-school scholarship identities conservatively and creates no cycles or funding', () => {
    const raw = fixture('scholarship-index-harvest.json')
    const artifacts = buildOfficialEntityMaterialization(raw)
    const providerIds = Object.keys(SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS).sort()

    expect(artifacts.manifest).toMatchObject({
      prerequisiteInstitutionIds: [],
      prerequisiteProviderOrganizationIds: providerIds,
      ignoredCycleHints: 0,
      counts: {
        records: 6,
        programs: 0,
        scholarships: 6,
        localizedContent: 6,
        sourceDocuments: 6,
        sourceFetches: 6,
        sourceFragments: 6,
        claims: 12,
        canonicalFields: 12,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(artifacts.sql).not.toContain('INSERT INTO scholarship_cycles')
    expect(artifacts.sql).not.toContain('INSERT INTO scholarship_coverage_items')
    expect(artifacts.sql).not.toContain('INSERT INTO fee_items')

    const database = databaseWithPipelineSchema()
    for (const providerId of providerIds) {
      const host = SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS[providerId]![0]
      seedOrganization(database, providerId, `https://${host}/`)
    }
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)
    expect(database.prepare(`
      SELECT scheme_type, COUNT(*) AS count
      FROM scholarships
      GROUP BY scheme_type
      ORDER BY scheme_type
    `).all()).toEqual([
      { scheme_type: 'government', count: 1 },
      { scheme_type: 'other', count: 4 },
      { scheme_type: 'university', count: 1 },
    ])
    expect(count(database, 'SELECT COUNT(*) AS count FROM scholarship_cycles')).toBe(0)
    expect(count(
      database,
      'SELECT COUNT(*) AS count FROM scholarship_coverage_items',
    )).toBe(0)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })

  it('preserves every 50+ verified ScholarshipIndexHarvest identity', async () => {
    const fixturesBySourceId = Object.fromEntries(
      DEFAULT_SCHOLARSHIP_INDEX_SOURCES.map((source) => [
        source.id,
        readFileSync(
          join(scholarshipFixtureDirectory, `${source.fixtureFile}.html`),
          'utf8',
        ),
      ]),
    )
    const harvest = await harvestScholarshipIndexes({
      checkedAt: '2026-07-23T08:00:00.000Z',
      fixturesBySourceId,
    })
    const artifacts = buildOfficialEntityMaterialization(harvest)

    expect(harvest.verifiedCandidateCount).toBeGreaterThanOrEqual(50)
    expect(artifacts.manifest.counts.scholarships)
      .toBe(harvest.verifiedCandidateCount)
    expect(artifacts.manifest.counts.records).toBe(harvest.entities.length)
    expect(artifacts.manifest.prerequisiteProviderOrganizationIds).toHaveLength(6)
    expect(artifacts.manifest.counts.scholarshipCycles).toBe(0)
  })

  it('rejects any ScholarshipIndexHarvest URL outside each exact institutional allowlist', () => {
    const raw = fixture('scholarship-index-harvest.json')
    for (const [index, value] of (raw.entities as JsonRecord[]).entries()) {
      const institutionId = value.institutionId as string
      const allowedHost = SCHOLARSHIP_INSTITUTION_OFFICIAL_HOSTS[institutionId]![0]
      const wrong = structuredClone(raw)
      ;(wrong.entities as JsonRecord[])[index].officialUrl =
        `https://subdomain.${allowedHost}/scholarship`
      expect(() => buildOfficialEntityMaterialization(wrong))
        .toThrow(/exact official host allowlist/u)
    }

    const wrongSource = structuredClone(raw)
    ;(wrongSource.sources as JsonRecord[])[0].officialUrl =
      'https://www.pku.edu.cn/scholarships'
    expect(() => buildOfficialEntityMaterialization(wrongSource))
      .toThrow(/exact official host allowlist/u)
  })
})
