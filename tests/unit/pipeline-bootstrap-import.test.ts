import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  buildPipelineBootstrap,
  readPipelineBootstrapBundle,
} from '../../scripts/ingestion/build-pipeline-bootstrap'
import { validatePilotSourceManifestDirectory } from '../../scripts/validate-source-manifests'

function databaseWithPipelineSchema() {
  const database = new DatabaseSync(':memory:')
  const migrationDirectory = join(
    process.cwd(),
    'infra',
    'd1',
    'pipeline',
    'migrations',
  )
  for (const file of readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    database.exec(readFileSync(
      join(migrationDirectory, file),
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
      records: 53,
      locations: 13,
      institutions: 40,
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
      records: 53,
      locations: 13,
      organizations: 40,
      institutions: 40,
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
    expect(database.prepare(`
      SELECT
        record.workflow_status,
        organization.official_url,
        institution.city_id,
        institution.admissions_url
      FROM records record
      JOIN organizations organization ON organization.record_id = record.id
      JOIN institutions institution ON institution.record_id = record.id
      WHERE record.id = 'uni-university-of-science-and-technology-of-china'
    `).get()).toEqual({
      workflow_status: 'validated',
      official_url: 'https://www.ustc.edu.cn/',
      city_id: 'city-hefei',
      admissions_url: 'https://ic.ustc.edu.cn/en/admission.php',
    })
    expect(database.prepare(`
      SELECT domain, is_primary
      FROM organization_domains
      WHERE organization_id =
        'uni-university-of-science-and-technology-of-china'
      ORDER BY domain
    `).all()).toEqual([
      { domain: 'ic.ustc.edu.cn', is_primary: 0 },
      { domain: 'ustc.edu.cn', is_primary: 1 },
    ])
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM source_documents
      WHERE canonical_url LIKE 'https://ic.ustc.edu.cn/%'
         OR canonical_url LIKE 'https://isa.ustc.edu.cn/%'
    `).get()).toEqual({ count: 9 })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM source_documents
      WHERE (
        canonical_url LIKE 'https://ic.ustc.edu.cn/%'
        OR canonical_url LIKE 'https://isa.ustc.edu.cn/%'
      )
      AND publisher_organization_id IS NOT
        'uni-university-of-science-and-technology-of-china'
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
      records: 53,
      ingestion_sources: 100,
      enabled_bindings: 86,
      field_definitions: first.fieldDefinitions,
    })
    expect(database.prepare(`
      SELECT workflow_status
      FROM records
      WHERE id = 'uni-university-of-science-and-technology-of-china'
    `).get()).toEqual({ workflow_status: 'validated' })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([
      { integrity_check: 'ok' },
    ])
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

  it('keeps the bootstrap importer parseable and cross-platform', () => {
    const scriptPath = join(
      process.cwd(),
      'scripts',
      'ingestion',
      'import-pipeline-bootstrap.ps1',
    )
    const script = readFileSync(scriptPath, 'utf8')
    expect(script).toContain('Get-Command node -CommandType Application')
    expect(script).toContain('"tsx.cmd"')
    expect(script).toContain('"tsx"')
    expect(script).toContain('"node_modules/wrangler/bin/wrangler.js"')
    expect(script).not.toContain('Get-Command node.exe')
    expect(script).not.toContain('wrangler.cmd')

    const escapedScriptPath = scriptPath.replaceAll("'", "''")
    const parserScript = [
      '$errors = $null',
      `[System.Management.Automation.Language.Parser]::ParseFile('${escapedScriptPath}', `
        + '[ref]$null, [ref]$errors) | Out-Null',
      'if ($errors.Count -gt 0) {',
      '  $errors | ForEach-Object { Write-Error $_.Message }',
      '  exit 1',
      '}',
    ].join('; ')
    const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    const result = spawnSync(executable, [
      '-NoProfile', '-NonInteractive', '-Command', parserScript,
    ], { encoding: 'utf8' })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })
})
