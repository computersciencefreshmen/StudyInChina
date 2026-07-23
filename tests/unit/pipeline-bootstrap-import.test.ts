import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildPipelineBootstrap,
  readPipelineBootstrapBundle,
} from '../../scripts/ingestion/build-pipeline-bootstrap'
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
    database.exec(readFileSync(
      join(process.cwd(), 'infra', 'd1', 'pipeline', 'migrations', file),
      'utf8',
    ))
  }
  return database
}

describe('Pipeline stable-entity bootstrap', () => {
  it('is idempotent, binds every enabled official source, and excludes draft templates', () => {
    const bundle = readPipelineBootstrapBundle()
    const manifests = validatePilotSourceManifestDirectory()
    const firstGeneratedAt = '2026-07-23T12:00:00.000Z'
    const first = buildPipelineBootstrap(bundle, manifests, firstGeneratedAt)
    expect(first).toMatchObject({
      records: 51,
      locations: 12,
      institutions: 39,
      ingestionSources: 100,
      enabledSources: 86,
      sourceBindings: 86,
      fieldMappings: 0,
      excludedDraftPrograms: 112,
    })
    expect(first.sourceDocuments).toBeLessThan(bundle.sources.length + first.ingestionSources)

    const database = databaseWithPipelineSchema()
    const sharedUrl = 'https://international.join-tsinghua.edu.cn/'
    database.prepare(`
      INSERT INTO source_documents (
        id, public_id, canonical_url, source_kind, authority_level,
        official, language_code, active, robots_policy
      ) VALUES (?, ?, ?, 'institution', 'primary_official', 1, 'en', 1, 'enforce')
    `).run('preexisting-source-document', 'preexisting-source-document', sharedUrl)

    database.exec(first.sql)
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM records) AS records,
        (SELECT COUNT(*) FROM locations) AS locations,
        (SELECT COUNT(*) FROM organizations) AS organizations,
        (SELECT COUNT(*) FROM institutions) AS institutions,
        (SELECT COUNT(*) FROM programs) AS programs,
        (SELECT COUNT(*) FROM promotion_field_mappings) AS mappings
    `).get()).toEqual({
      records: 51,
      locations: 12,
      organizations: 39,
      institutions: 39,
      programs: 0,
      mappings: 0,
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM promotion_source_bindings
      WHERE enabled = 1
    `).get()).toEqual({ count: 86 })
    expect(database.prepare(`
      SELECT binding.source_document_id
      FROM promotion_source_bindings binding
      WHERE binding.source_id = 'thu-intl-admissions-home'
    `).get()).toEqual({ source_document_id: 'preexisting-source-document' })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM promotion_source_bindings binding
      JOIN source_documents document ON document.id = binding.source_document_id
      WHERE binding.enabled = 1
        AND document.official = 1
        AND document.active = 1
        AND document.authority_level IN ('primary_official', 'secondary_official')
    `).get()).toEqual({ count: 86 })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM records
      WHERE kind = 'program'
         OR id = 'uni-nanjing-normal-university'
    `).get()).toEqual({ count: 0 })

    database.prepare(`
      UPDATE ingestion_sources
      SET etag = '"stable"', raw_sha256 = ?, consecutive_failures = 3
      WHERE source_id = 'thu-intl-admissions-home'
    `).run('a'.repeat(64))
    database.prepare(`
      UPDATE records
      SET workflow_status = 'applied', review_after = '2026-08-01',
          row_version = 7, updated_at = '2026-07-23T12:30:00.000Z'
      WHERE id = 'uni-tsinghua-university'
    `).run()
    const sourceUpdatedAt = database.prepare(`
      SELECT updated_at FROM source_documents WHERE canonical_url = ?
    `).get(sharedUrl)

    const second = buildPipelineBootstrap(
      bundle,
      manifests,
      '2026-07-23T13:00:00.000Z',
    )
    database.exec(second.sql)
    expect(database.prepare(`
      SELECT etag, raw_sha256, consecutive_failures
      FROM ingestion_sources
      WHERE source_id = 'thu-intl-admissions-home'
    `).get()).toEqual({
      etag: '"stable"',
      raw_sha256: 'a'.repeat(64),
      consecutive_failures: 3,
    })
    expect(database.prepare(`
      SELECT workflow_status, review_after, row_version, updated_at
      FROM records WHERE id = 'uni-tsinghua-university'
    `).get()).toEqual({
      workflow_status: 'applied',
      review_after: '2026-08-01',
      row_version: 7,
      updated_at: '2026-07-23T12:30:00.000Z',
    })
    expect(database.prepare(`
      SELECT updated_at FROM source_documents WHERE canonical_url = ?
    `).get(sharedUrl)).toEqual(sourceUpdatedAt)
    expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM records) AS records,
        (SELECT COUNT(*) FROM ingestion_sources) AS ingestion_sources,
        (SELECT COUNT(*) FROM promotion_source_bindings WHERE enabled = 1) AS enabled_bindings,
        (SELECT COUNT(*) FROM field_definitions) AS field_definitions
    `).get()).toEqual({
      records: 51,
      ingestion_sources: 100,
      enabled_bindings: 86,
      field_definitions: first.fieldDefinitions,
    })
    database.close()
  })

  it('disables a removed managed source and its no-longer-current document', () => {
    const bundle = readPipelineBootstrapBundle()
    const manifests = validatePilotSourceManifestDirectory()
    const database = databaseWithPipelineSchema()
    database.exec(buildPipelineBootstrap(
      bundle,
      manifests,
      '2026-07-23T12:00:00.000Z',
    ).sql)

    const allUrls = [
      ...bundle.sources.map((source) => source.url),
      ...manifests.flatMap((manifest) => manifest.sources.map((source) => source.officialUrl)),
    ]
    const removable = manifests
      .flatMap((manifest) => manifest.sources)
      .find((source) => (
        source.enabled
        && allUrls.filter((url) => url === source.officialUrl).length === 1
      ))
    expect(removable).toBeDefined()
    const changed = structuredClone(manifests)
    const owner = changed.find((manifest) => manifest.institutionId === removable!.institutionId)!
    owner.sources = owner.sources.filter((source) => source.id !== removable!.id)

    database.exec(buildPipelineBootstrap(
      bundle,
      changed,
      '2026-07-23T13:00:00.000Z',
    ).sql)
    expect(database.prepare(`
      SELECT enabled, next_fetch_at
      FROM ingestion_sources WHERE source_id = ?
    `).get(removable!.id)).toEqual({ enabled: 0, next_fetch_at: null })
    expect(database.prepare(`
      SELECT enabled
      FROM promotion_source_bindings WHERE source_id = ?
    `).get(removable!.id)).toEqual({ enabled: 0 })
    expect(database.prepare(`
      SELECT active
      FROM source_documents WHERE canonical_url = ?
    `).get(removable!.officialUrl)).toEqual({ active: 0 })
    database.close()
  })
})
