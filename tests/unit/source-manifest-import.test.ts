import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildPilotSourceImport,
  normalizeSourceManifestsForImport,
} from '../../scripts/ingestion/build-source-import'
import type { SourceManifestV2 } from '../../scripts/source-manifest-contract'
import {
  loadPilotSourceManifestFiles,
  validatePilotSourceManifestDirectory,
  validatePilotSourceManifests,
} from '../../scripts/validate-source-manifests'

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
    const normalized = normalizeSourceManifestsForImport(records)
    expect(normalized).toHaveLength(10)
    expect(normalized.every((record) => record.manifestVersion === 2)).toBe(true)
    expect(normalized.every(
      (record) => record.catalogReconciliationComplete === false,
    )).toBe(true)
    const expectedPkuSource = records
      .find((record) => record.institutionId === 'uni-peking-university')!
      .sources.find((source) => source.id === 'pku-intl-admissions-home')!
    expect(normalized
      .find((record) => record.institutionId === 'uni-peking-university')!
      .sources).toContainEqual(expectedPkuSource)
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

    const storedPkuSource = database.prepare(`
      SELECT manifest_json FROM ingestion_sources
      WHERE source_id = 'pku-intl-admissions-home'
    `).get() as { manifest_json: string }
    expect(JSON.parse(storedPkuSource.manifest_json)).toEqual(expectedPkuSource)
    expect(JSON.parse(storedPkuSource.manifest_json)).toMatchObject({
      version: 1, enabled: true, schedule: expectedPkuSource.schedule,
      robots: expectedPkuSource.robots, officialUrl: expectedPkuSource.officialUrl,
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

  it('accepts an in-progress V2 envelope without treating it as reconciled', () => {
    const inputs = loadPilotSourceManifestFiles().map((input) => ({
      filePath: input.filePath,
      value: structuredClone(input.value),
    }))
    const records = validatePilotSourceManifests(inputs)
    expect(records.every((record) => (
      record.version === 2
      && record.manifestStatus === 'in_progress'
      && !normalizeSourceManifestsForImport([record])[0]!
        .catalogReconciliationComplete
    ))).toBe(true)

    const invalidComplete = inputs[0]!.value as SourceManifestV2
    invalidComplete.manifestStatus = 'complete'
    invalidComplete.catalogReconciliation.scope = 'full_official_catalog'
    invalidComplete.catalogReconciliation.status = 'complete'
    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /complete catalog reconciliation cannot contain pending entries/,
    )
  })
})
