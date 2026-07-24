import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildOfficialEntityMaterialization,
} from '../../scripts/ingestion/materialize-official-entities'

type JsonRecord = Record<string, unknown>

const fixturePath = join(
  process.cwd(),
  'tests',
  'fixtures',
  'official-entity-materializer',
  'pku-masters-cn-harvest.json',
)
const smokeArtifactPath = join(
  process.cwd(),
  '.pipeline-build',
  'pku-discovery',
  'masters-cn-harvest.json',
)

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord
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

function seedPku(database: DatabaseSync): void {
  const cityId = 'fixture-city-beijing-pku'
  const institutionId = 'uni-peking-university'
  const timestamp = '2026-07-23T00:00:00.000Z'
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'location', ?, 'draft', ?, ?)
  `).run(cityId, cityId, cityId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO locations (record_id, location_type, country_code)
    VALUES (?, 'city', 'CN')
  `).run(cityId)
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'organization', ?, 'draft', ?, ?)
  `).run(institutionId, institutionId, institutionId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO organizations (record_id, organization_type, official_url)
    VALUES (?, 'university', 'https://www.pku.edu.cn/')
  `).run(institutionId)
  database.prepare(`
    INSERT INTO institutions (
      record_id, city_id, institution_type, admissions_url, featured
    ) VALUES (?, ?, 'comprehensive', 'https://admission.pku.edu.cn/', 0)
  `).run(institutionId, cityId)
}

describe('raw PKU master Chinese PDF directory input', () => {
  it('materializes verified identities as zh pdf_page facts and excludes prefix mismatch rows', () => {
    const artifacts = buildOfficialEntityMaterialization(readJson(fixturePath))

    expect(artifacts.manifest).toMatchObject({
      generatedAt: '2026-07-23T16:45:36.886Z',
      prerequisiteInstitutionIds: ['uni-peking-university'],
      prerequisiteProviderOrganizationIds: [],
      ignoredCycleHints: 0,
      counts: {
        records: 2,
        programs: 2,
        scholarships: 0,
        localizedContent: 2,
        sourceDocuments: 2,
        sourceFetches: 2,
        sourceFragments: 2,
        claims: 8,
        canonicalFields: 8,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(artifacts.sql).toContain("'pdf_page'")
    expect(artifacts.sql).toContain(
      "'pdf:page=1;lines=4-6;code=070501'",
    )
    expect(artifacts.sql).not.toContain('zsml_bs_lxs_cn_00240.pdf')
    expect(artifacts.sql).not.toContain('先进制造与机器人学院')
    expect(artifacts.sql).not.toContain('INSERT INTO program_cycles')
    expect(artifacts.sql).not.toContain('INSERT INTO fee_items')

    const database = databaseWithPipelineSchema()
    seedPku(database)
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM programs) AS programs,
        (SELECT COUNT(*) FROM program_cycles) AS cycles,
        (SELECT COUNT(*) FROM localized_content WHERE locale = 'zh') AS names_zh,
        (SELECT COUNT(*) FROM localized_content WHERE locale = 'en') AS names_en,
        (SELECT COUNT(*) FROM source_fragments
          WHERE locator_type = 'pdf_page') AS pdf_pages,
        (SELECT COUNT(*) FROM canonical_fields
          WHERE subject_record_id IN (SELECT record_id FROM programs)) AS canonical
    `).get()).toEqual({
      programs: 2,
      cycles: 0,
      names_zh: 2,
      names_en: 0,
      pdf_pages: 2,
      canonical: 8,
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM records
      WHERE kind = 'program'
        AND workflow_status = 'draft'
        AND review_after = '2026-08-22'
    `).get()).toEqual({ count: 2 })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })

  it('fails closed on owner, catalog, identity, locator, and duplicate fact conflicts', () => {
    const raw = readJson(fixturePath)

    const wrongOwner = structuredClone(raw)
    wrongOwner.institutionId = 'uni-zhejiang-university'
    expect(() => buildOfficialEntityMaterialization(wrongOwner))
      .toThrow(/uni-peking-university/u)

    const zeroCoverage = structuredClone(raw)
    ;(zeroCoverage.reconciliation as JsonRecord).documentCoverageRate = 0
    expect(() => buildOfficialEntityMaterialization(zeroCoverage))
      .toThrow(/document coverage is incomplete/u)

    const zeroLoaded = structuredClone(raw)
    ;(zeroLoaded.reconciliation as JsonRecord).loadedDocuments = 0
    expect(() => buildOfficialEntityMaterialization(zeroLoaded))
      .toThrow(/document coverage is incomplete/u)

    const missingDocument = structuredClone(raw)
    const missingReconciliation = missingDocument.reconciliation as JsonRecord
    missingReconciliation.loadedDocuments = 1
    missingReconciliation.missingDocuments = 1
    missingReconciliation.documentCoverageRate = 50
    expect(() => buildOfficialEntityMaterialization(missingDocument))
      .toThrow(/document coverage is incomplete/u)

    const wrongHost = structuredClone(raw)
    ;(wrongHost.entities as JsonRecord[])[0].officialUrl =
      'https://admission.pku.edu.cn.evil.example/catalog.pdf'
    expect(() => buildOfficialEntityMaterialization(wrongHost))
      .toThrow(/registered admission\.pku\.edu\.cn/u)

    const wrongPrefix = structuredClone(raw)
    const wrongPrefixEntity = (wrongPrefix.entities as JsonRecord[])[0]
    wrongPrefixEntity.officialUrl =
      'https://admission.pku.edu.cn/zsxx/lxszs/lxszyml/2026/ss/zsml_bs_lxs_cn_00126.pdf'
    ;(wrongPrefixEntity.evidence as JsonRecord).officialUrl =
      wrongPrefixEntity.officialUrl
    expect(() => buildOfficialEntityMaterialization(wrongPrefix))
      .toThrow(/catalog prefix or directory mismatch/u)

    const wrongIdentity = structuredClone(raw)
    ;(wrongIdentity.entities as JsonRecord[])[0].department = '伪造院系'
    expect(() => buildOfficialEntityMaterialization(wrongIdentity))
      .toThrow(/derived from department and programCode/u)

    const wrongLocator = structuredClone(raw)
    ;((wrongLocator.entities as JsonRecord[])[0].evidence as JsonRecord).locator =
      'pdf:page=1;lines=4-6;code=999999'
    expect(() => buildOfficialEntityMaterialization(wrongLocator))
      .toThrow(/locator does not match/u)

    const factualConflict = structuredClone(raw)
    ;(factualConflict.entities as JsonRecord[])[0].name = '冲突项目名称'
    expect(() => buildOfficialEntityMaterialization([raw, factualConflict]))
      .toThrow(/conflicting duplicate official entity identity/u)
  })

  it.runIf(existsSync(smokeArtifactPath))(
    'materializes the full local smoke artifact into exactly 177 idempotent records',
    () => {
      const artifacts = buildOfficialEntityMaterialization(
        readJson(smokeArtifactPath),
      )
      expect(artifacts.manifest).toMatchObject({
        prerequisiteInstitutionIds: ['uni-peking-university'],
        ignoredCycleHints: 0,
        counts: {
          records: 177,
          programs: 177,
          localizedContent: 177,
          sourceDocuments: 36,
          sourceFetches: 36,
          sourceFragments: 177,
          claims: 708,
          canonicalFields: 708,
          programCycles: 0,
        },
      })
      expect(artifacts.sql).not.toContain('zsml_bs_lxs_cn_00240.pdf')

      const database = databaseWithPipelineSchema()
      seedPku(database)
      database.exec(artifacts.sql)
      database.exec(artifacts.sql)
      expect(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM records WHERE kind = 'program') AS records,
          (SELECT COUNT(*) FROM programs) AS programs,
          (SELECT COUNT(*) FROM program_cycles) AS cycles,
          (SELECT COUNT(*) FROM claims
            WHERE subject_record_id IN (SELECT record_id FROM programs)) AS claims,
          (SELECT COUNT(*) FROM canonical_fields
            WHERE subject_record_id IN (SELECT record_id FROM programs)) AS canonical
      `).get()).toEqual({
        records: 177,
        programs: 177,
        cycles: 0,
        claims: 708,
        canonical: 708,
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
      expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
        { integrity_check: 'ok' },
      ])
      database.close()
    },
    20_000,
  )
})
