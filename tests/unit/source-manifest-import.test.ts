import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPilotSourceImport } from '../../scripts/ingestion/build-source-import'
import { validatePilotSourceManifestDirectory } from '../../scripts/validate-source-manifests'

function databaseWithPipelineSchema() {
  const database = new DatabaseSync(':memory:')
  for (const file of [
    '0001_domain.sql',
    '0002_evidence_workflow.sql',
    '0003_indexes_guards.sql',
    '0004_worker_runtime.sql',
    '0005_domain_throttle.sql',
    '0006_candidate_provenance_promotion.sql',
    '0007_snapshot_derivatives.sql',
    '0008_release_builder_contract.sql',
  ]) {
    database.exec(readFileSync(join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations', file), 'utf8'))
  }
  return database
}

describe('pilot Source Manifest import', () => {
  it('is idempotent, preserves fetch state, and disables removed pilot sources', () => {
    const records = validatePilotSourceManifestDirectory()
    const generatedAt = '2026-07-23T08:00:00.000Z'
    const artifacts = buildPilotSourceImport(records, generatedAt)
    expect(artifacts.institutions).toBe(10)
    expect(artifacts.sources).toBe(100)

    const database = databaseWithPipelineSchema()
    database.exec(artifacts.sql)
    database.prepare(`
      UPDATE ingestion_sources
      SET etag = '"stable"', raw_sha256 = ?, consecutive_failures = 2
      WHERE source_id = 'pku-intl-admissions-home'
    `).run('a'.repeat(64))
    database.exec(artifacts.sql)

    expect(database.prepare(`
      SELECT COUNT(*) AS sources, COUNT(DISTINCT json_extract(manifest_json, '$.institutionId')) AS institutions
      FROM ingestion_sources
    `).get()).toEqual({ sources: 100, institutions: 10 })
    expect(database.prepare(`
      SELECT etag, raw_sha256, consecutive_failures, next_fetch_at
      FROM ingestion_sources WHERE source_id = 'pku-intl-admissions-home'
    `).get()).toEqual({
      etag: '"stable"',
      raw_sha256: 'a'.repeat(64),
      consecutive_failures: 2,
      next_fetch_at: generatedAt,
    })

    const changed = structuredClone(records)
    const pku = changed.find((record) => record.institutionId === 'uni-peking-university')!
    pku.sources = pku.sources.filter((source) => source.id !== 'pku-intl-admissions-home')
    database.exec(buildPilotSourceImport(changed, '2026-07-23T09:00:00.000Z').sql)
    expect(database.prepare(`
      SELECT enabled, next_fetch_at FROM ingestion_sources
      WHERE source_id = 'pku-intl-admissions-home'
    `).get()).toEqual({ enabled: 0, next_fetch_at: null })
    database.close()
  })
})
