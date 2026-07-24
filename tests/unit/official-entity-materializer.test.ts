import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildOfficialEntityMaterialization,
} from '../../scripts/ingestion/materialize-official-entities'

type JsonRecord = Record<string, unknown>

const fixtureDirectory = join(
  process.cwd(),
  'tests',
  'fixtures',
  'official-entity-materializer',
)

function readFixture(name: string): JsonRecord {
  return JSON.parse(readFileSync(join(fixtureDirectory, name), 'utf8')) as JsonRecord
}

function databaseWithPipelineSchema(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  const migrationDirectory = join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations')
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))

  expect(migrations.length).toBeGreaterThanOrEqual(9)
  for (const migration of migrations) {
    database.exec(readFileSync(join(migrationDirectory, migration), 'utf8'))
  }
  return database
}

function seedInstitution(
  database: DatabaseSync,
  institutionId: string,
  officialUrl: string,
): void {
  const cityId = `fixture-city-${institutionId}`
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'location', ?, 'draft', ?, ?)
  `).run(cityId, cityId, cityId, '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z')
  database.prepare(`
    INSERT INTO locations (record_id, location_type, country_code)
    VALUES (?, 'city', 'CN')
  `).run(cityId)
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'organization', ?, 'draft', ?, ?)
  `).run(
    institutionId,
    institutionId,
    institutionId,
    '2026-07-23T00:00:00.000Z',
    '2026-07-23T00:00:00.000Z',
  )
  database.prepare(`
    INSERT INTO organizations (record_id, organization_type, official_url)
    VALUES (?, 'university', ?)
  `).run(institutionId, officialUrl)
  database.prepare(`
    INSERT INTO institutions (
      record_id, city_id, institution_type, admissions_url, featured
    ) VALUES (?, ?, 'comprehensive', ?, 0)
  `).run(institutionId, cityId, officialUrl)
}

function seedProvider(
  database: DatabaseSync,
  providerId: string,
  officialUrl: string,
): void {
  database.prepare(`
    INSERT INTO records (
      id, public_id, kind, slug, workflow_status, created_at, updated_at
    ) VALUES (?, ?, 'organization', ?, 'draft', ?, ?)
  `).run(
    providerId,
    providerId,
    providerId,
    '2026-07-23T00:00:00.000Z',
    '2026-07-23T00:00:00.000Z',
  )
  database.prepare(`
    INSERT INTO organizations (record_id, organization_type, official_url)
    VALUES (?, 'scholarship_provider', ?)
  `).run(providerId, officialUrl)
}

function buildTsinghuaPrograms(count: number): JsonRecord {
  const input = structuredClone(readFixture('tsinghua-harvest.json'))
  const base = (input.entities as JsonRecord[])[0]
  input.entities = Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    return {
      ...structuredClone(base),
      entityKey: `tsinghua:master:024:${number}`,
      majorCode: number,
      nameEn: `Verified Tsinghua Program ${number}`,
      nameZh: `清华可核验项目${number}`,
      evidence: {
        ...(structuredClone(base.evidence) as JsonRecord),
        locator: `json:datas.programs[code=${number}]`,
        quote: `${number} Verified Tsinghua Program ${number}`,
      },
    }
  })
  return input
}

function scalarCount(database: DatabaseSync, sql: string): number {
  return (database.prepare(sql).get() as { count: number }).count
}

describe('official program and scholarship entity materializer', () => {
  it('accepts the current Tsinghua harvest shape and reserved ZJU normalized shape', () => {
    const tsinghua = buildOfficialEntityMaterialization(
      readFixture('tsinghua-harvest.json'),
    )
    const tsinghuaAgain = buildOfficialEntityMaterialization(
      readFixture('tsinghua-harvest.json'),
    )
    const zju = buildOfficialEntityMaterialization(readFixture('zju-normalized.json'))

    expect(tsinghua).toEqual(tsinghuaAgain)
    expect(tsinghua.manifest).toMatchObject({
      generatedAt: '2026-07-23T10:00:00.000Z',
      prerequisiteInstitutionIds: ['uni-tsinghua-university'],
      prerequisiteProviderOrganizationIds: [],
      ignoredCycleHints: 1,
      counts: {
        records: 1,
        programs: 1,
        scholarships: 0,
        localizedContent: 2,
        claims: 5,
        canonicalFields: 5,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(zju.manifest).toMatchObject({
      prerequisiteInstitutionIds: ['uni-zhejiang-university'],
      prerequisiteProviderOrganizationIds: [],
      ignoredCycleHints: 0,
      counts: {
        records: 1,
        programs: 1,
        scholarships: 0,
        claims: 5,
      },
    })
    expect(tsinghua.sql).toContain("'2026-08-22'")
    expect(tsinghua.sql.indexOf("claim_status = 'validated'")).toBeLessThan(
      tsinghua.sql.indexOf("claim_status = 'accepted'"),
    )
    expect(tsinghua.sql.indexOf("claim_status = 'accepted'")).toBeLessThan(
      tsinghua.sql.indexOf('INSERT INTO canonical_fields'),
    )
    expect(tsinghua.sql).not.toContain('materialization_batches')
    expect(tsinghua.sql).not.toContain('materialization_batch_records')
    expect(tsinghua.sql).not.toContain('SET workflow_status')
  })

  it('rejects missing evidence, field-level evidence gaps, and non-official URLs', () => {
    const missingEvidence = structuredClone(readFixture('tsinghua-harvest.json'))
    delete (missingEvidence.entities as JsonRecord[])[0].evidence
    expect(() => buildOfficialEntityMaterialization(missingEvidence))
      .toThrow(/must contain official evidence/u)

    const fieldGap = structuredClone(readFixture('zju-normalized.json'))
    ;((fieldGap.entities as JsonRecord[])[0].evidence as JsonRecord[])[0].fieldPaths = [
      'localized.name',
    ]
    expect(() => buildOfficialEntityMaterialization(fieldGap))
      .toThrow(/official_url lacks field-level official evidence/u)

    const nonOfficial = structuredClone(readFixture('zju-normalized.json'))
    const nonOfficialEntity = (nonOfficial.entities as JsonRecord[])[0]
    nonOfficialEntity.officialUrl = 'https://example.com/program/120100'
    ;(nonOfficialEntity.evidence as JsonRecord[])[0].officialUrl =
      'https://example.com/program/120100'
    expect(() => buildOfficialEntityMaterialization(nonOfficial))
      .toThrow(/not on an allowed official HTTPS host/u)

    const selfDeclaredHost = structuredClone(readFixture('zju-normalized.json'))
    ;(selfDeclaredHost.source as JsonRecord).officialHosts = ['example.com']
    const selfDeclaredEntity = (selfDeclaredHost.entities as JsonRecord[])[0]
    selfDeclaredEntity.institutionId = 'uni-tsinghua-university'
    selfDeclaredEntity.officialUrl = 'https://example.com/program/120100'
    ;(selfDeclaredEntity.evidence as JsonRecord[])[0].officialUrl =
      'https://example.com/program/120100'
    expect(() => buildOfficialEntityMaterialization(selfDeclaredHost))
      .toThrow(
        /example\.com, which is not registered for owner uni-tsinghua-university/u,
      )
  })

  it('fails before writes when an institution dependency is absent', () => {
    const database = databaseWithPipelineSchema()
    const artifacts = buildOfficialEntityMaterialization(buildTsinghuaPrograms(1))

    expect(() => database.exec(artifacts.sql)).toThrow()
    expect(scalarCount(database, 'SELECT COUNT(*) AS count FROM records')).toBe(0)
    expect(scalarCount(database, 'SELECT COUNT(*) AS count FROM source_documents')).toBe(0)
    database.close()
  })

  it('materializes 99 verified programs twice with accepted official evidence and clean SQLite', () => {
    const artifacts = buildOfficialEntityMaterialization(buildTsinghuaPrograms(99))
    expect(artifacts.manifest.materializerVersion).toBe(
      'official-entity-materializer/v1',
    )
    expect(artifacts.manifest.batchId).toMatch(/^[0-9a-f]{64}$/u)
    expect(artifacts.manifest).toMatchObject({
      provenanceStatus: 'fixture',
      requiredSourceArtifacts: 1,
      prerequisiteInstitutionIds: ['uni-tsinghua-university'],
      prerequisiteProviderOrganizationIds: [],
      ignoredCycleHints: 99,
      counts: {
        records: 99,
        recordSlugs: 99,
        programs: 99,
        scholarships: 0,
        localizedContent: 198,
        sourceDocuments: 1,
        sourceFetches: 1,
        sourceFragments: 99,
        claims: 495,
        canonicalFields: 495,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })

    const database = databaseWithPipelineSchema()
    seedInstitution(
      database,
      'uni-tsinghua-university',
      'https://www.tsinghua.edu.cn/',
    )
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)

    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM materialization_batches) AS batches,
        (SELECT COUNT(*) FROM materialization_batch_records) AS mappings,
        (SELECT COUNT(*) FROM materialization_batch_source_artifacts) AS artifacts
    `).get()).toEqual({ batches: 0, mappings: 0, artifacts: 0 })
    expect(artifacts.manifest.recordMappings).toHaveLength(99)
    expect(artifacts.sql).toContain(
      'Batch reservation, evidence binding, validation, and apply are owned by the strict importer.',
    )
    expect(database.prepare(`
      SELECT status, completed_at, http_status, artifact_uri
      FROM source_fetches
    `).get()).toEqual({
      status: 'queued',
      completed_at: null,
      http_status: null,
      artifact_uri: null,
    })

    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM records WHERE kind = 'program') AS programs,
        (SELECT COUNT(*) FROM record_slugs
          WHERE record_id IN (SELECT record_id FROM programs)) AS slugs,
        (SELECT COUNT(*) FROM localized_content
          WHERE record_id IN (SELECT record_id FROM programs)) AS localized,
        (SELECT COUNT(*) FROM claims
          WHERE subject_record_id IN (SELECT record_id FROM programs)) AS claims,
        (SELECT COUNT(*) FROM canonical_fields
          WHERE subject_record_id IN (SELECT record_id FROM programs)) AS canonical,
        (SELECT COUNT(*) FROM program_cycles) AS cycles,
        (SELECT COUNT(*) FROM source_documents) AS sources,
        (SELECT COUNT(*) FROM source_fetches) AS fetches,
        (SELECT COUNT(*) FROM source_fragments) AS fragments
    `).get()).toEqual({
      programs: 99,
      slugs: 99,
      localized: 198,
      claims: 495,
      canonical: 495,
      cycles: 0,
      sources: 1,
      fetches: 1,
      fragments: 99,
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM records
      WHERE kind = 'program'
        AND workflow_status = 'draft'
        AND review_after = '2026-08-22'
    `).get()).toEqual({ count: 99 })
    expect(database.prepare(`
      SELECT workflow_status
      FROM records
      WHERE id = 'uni-tsinghua-university'
    `).get()).toEqual({ workflow_status: 'draft' })
    expect(scalarCount(database, `
      SELECT COUNT(*) AS count
      FROM canonical_fields canonical
      WHERE canonical.subject_record_id IN (SELECT record_id FROM programs)
        AND (
          canonical.field_status <> 'accepted'
          OR NOT EXISTS (
            SELECT 1
            FROM claims claim
            JOIN claim_evidence evidence ON evidence.claim_id = claim.id
            JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
            JOIN source_fetches fetch ON fetch.id = fragment.fetch_id
            JOIN source_documents source ON source.id = fetch.source_id
            WHERE claim.id = canonical.claim_id
              AND claim.claim_status = 'accepted'
              AND evidence.evidence_role = 'primary'
              AND source.official = 1
              AND source.authority_level = 'primary_official'
          )
        )
    `)).toBe(0)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })

  it('links complete non-fixture R2 provenance to every accepted batch claim', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'official-provenance-'))
    try {
      const input = buildTsinghuaPrograms(1)
      input.sourceMode = 'live'
      const entity = (input.entities as JsonRecord[])[0]
      const officialUrl = entity.officialUrl as string
      const sourceId = `source-document-${createHash('sha256')
        .update(officialUrl)
        .digest('hex')
        .slice(0, 24)}`
      const localPathValue = 'official-source.html'
      const localPath = join(temporaryDirectory, localPathValue)
      const bytes = Buffer.from('<html>official Tsinghua catalog snapshot</html>', 'utf8')
      writeFileSync(localPath, bytes)
      const capturedAt = '2026-07-23T10:00:00.000Z'
      const artifactSha256 = createHash('sha256').update(bytes).digest('hex')
      const sourceArtifact = {
        sourceId,
        fetchId: 'fetch-official-provenance-fixture',
        localPath: localPathValue,
        artifactSha256,
        artifactUri:
          `r2://studyinchina-source-snapshots/source-artifacts/0123456789abcdef01234567/${artifactSha256}.html`,
        contentType: 'text/html; charset=utf-8',
        byteLength: bytes.byteLength,
        capturedAt,
        isFixture: false,
      }
      const dependencyArtifact = {
        role: 'dependency',
        sourceId: 'source-dependency-owned-by-canonicalizer',
      }
      expect(() => buildOfficialEntityMaterialization(input, {
        provenanceManifest: {
          sourceArtifacts: [
            { ...sourceArtifact, localPath },
            dependencyArtifact,
          ],
        },
        provenanceBaseDirectory: temporaryDirectory,
      })).toThrow(/localPath must be relative to the provenance manifest/u)
      expect(() => buildOfficialEntityMaterialization(input, {
        provenanceManifest: {
          sourceArtifacts: [
            {
              ...sourceArtifact,
              artifactUri: sourceArtifact.artifactUri.replace(
                artifactSha256,
                '0'.repeat(64),
              ),
            },
            dependencyArtifact,
          ],
        },
        provenanceBaseDirectory: temporaryDirectory,
      })).toThrow(
        /artifactUri must be the deterministic private content-addressed R2 URI/u,
      )
      const artifacts = buildOfficialEntityMaterialization(input, {
        provenanceManifest: {
          sourceArtifacts: [sourceArtifact, dependencyArtifact],
        },
        provenanceBaseDirectory: temporaryDirectory,
      })
      expect(artifacts.manifest).toMatchObject({
        provenanceStatus: 'complete',
        requiredSourceArtifacts: 1,
        sourceArtifacts: [{
          ...sourceArtifact,
          localPath,
        }],
        recordMappings: [{ recordKind: 'program' }],
      })

      const database = databaseWithPipelineSchema()
      seedInstitution(
        database,
        'uni-tsinghua-university',
        'https://www.tsinghua.edu.cn/',
      )
      database.exec(artifacts.sql)
      database.exec(artifacts.sql)
      expect(database.prepare(`
        SELECT status, completed_at, http_status, sha256, artifact_uri
        FROM source_fetches
        WHERE id = ?
      `).get(sourceArtifact.fetchId)).toEqual({
        status: 'succeeded',
        completed_at: capturedAt,
        http_status: null,
        sha256: sourceArtifact.artifactSha256,
        artifact_uri: sourceArtifact.artifactUri,
      })
      expect(artifacts.manifest.sourceArtifacts[0].capturedAt).toBe(capturedAt)
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM claims claim
        WHERE claim.subject_record_id IN (SELECT record_id FROM programs)
          AND claim.claim_status = 'accepted'
          AND NOT EXISTS (
            SELECT 1
            FROM claim_evidence evidence
            JOIN source_fragments fragment ON fragment.id = evidence.fragment_id
            WHERE evidence.claim_id = claim.id
              AND evidence.evidence_role = 'primary'
              AND fragment.fetch_id = ?
          )
      `).get(sourceArtifact.fetchId)).toEqual({ count: 0 })
      expect(database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM materialization_batches) AS batches,
          (SELECT COUNT(*) FROM materialization_batch_records) AS mappings,
          (SELECT COUNT(*) FROM materialization_batch_source_artifacts) AS artifacts
      `).get()).toEqual({ batches: 0, mappings: 0, artifacts: 0 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
      database.close()
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('preserves A-to-B-to-A claim history and leaves one accepted canonical A', () => {
    const version = (nameEn: string, checkedAt: string) => {
      const input = buildTsinghuaPrograms(1)
      input.checkedAt = checkedAt
      const entity = (input.entities as JsonRecord[])[0]
      entity.nameEn = nameEn
      entity.sourceCheckedAt = checkedAt
      const evidence = entity.evidence as JsonRecord
      evidence.checkedAt = checkedAt
      evidence.quote = `001 ${nameEn}`
      return buildOfficialEntityMaterialization(input)
    }
    const firstA = version('Canonical A', '2026-07-23T10:00:00.000Z')
    const middleB = version('Canonical B', '2026-07-23T11:00:00.000Z')
    const finalA = version('Canonical A', '2026-07-23T12:00:00.000Z')
    expect(new Set([
      firstA.manifest.batchId,
      middleB.manifest.batchId,
      finalA.manifest.batchId,
    ]).size).toBe(3)

    const database = databaseWithPipelineSchema()
    seedInstitution(
      database,
      'uni-tsinghua-university',
      'https://www.tsinghua.edu.cn/',
    )
    database.exec(firstA.sql)
    database.exec(middleB.sql)
    database.exec(finalA.sql)
    database.exec(finalA.sql)

    expect(database.prepare(`
      SELECT claim_status, COUNT(*) AS count
      FROM claims
      WHERE field_path = 'localized.name' AND locale = 'en'
      GROUP BY claim_status
      ORDER BY claim_status
    `).all()).toEqual([
      { claim_status: 'accepted', count: 1 },
      { claim_status: 'superseded', count: 2 },
    ])
    expect(database.prepare(`
      SELECT canonical.value_json, claim.claim_status
      FROM canonical_fields canonical
      JOIN claims claim ON claim.id = canonical.claim_id
      WHERE canonical.field_path = 'localized.name' AND canonical.locale = 'en'
    `).get()).toEqual({
      value_json: JSON.stringify('Canonical A'),
      claim_status: 'accepted',
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    database.close()
  })

  it('materializes a scholarship without inventing its provider dependency', () => {
    const artifacts = buildOfficialEntityMaterialization(
      readFixture('scholarship-normalized.json'),
    )
    expect(artifacts.manifest).toMatchObject({
      prerequisiteInstitutionIds: [],
      prerequisiteProviderOrganizationIds: ['provider-china-scholarship-council'],
      counts: {
        records: 1,
        programs: 0,
        scholarships: 1,
        localizedContent: 2,
        claims: 3,
        canonicalFields: 3,
        scholarshipCycles: 0,
      },
    })

    const database = databaseWithPipelineSchema()
    seedProvider(
      database,
      'provider-china-scholarship-council',
      'https://www.campuschina.org/',
    )
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)

    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM scholarships) AS scholarships,
        (SELECT COUNT(*) FROM scholarship_cycles) AS cycles,
        (SELECT COUNT(*) FROM canonical_fields
          WHERE subject_record_id IN (SELECT record_id FROM scholarships)) AS canonical
    `).get()).toEqual({
      scholarships: 1,
      cycles: 0,
      canonical: 3,
    })
    expect(database.prepare(`
      SELECT workflow_status
      FROM records
      WHERE id = 'provider-china-scholarship-council'
    `).get()).toEqual({ workflow_status: 'draft' })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
    database.close()
  })
})
