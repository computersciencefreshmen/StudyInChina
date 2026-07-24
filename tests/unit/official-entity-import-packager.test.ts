import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  computeOfficialEntityPackageDigest,
  packageOfficialEntityImport,
  tokenizeSql,
  validateOfficialEntityMaterializationManifest,
  verifyOfficialEntityChunk,
  verifyOfficialEntityImportPackage,
} from '../../scripts/ingestion/package-official-entity-import'

const temporaryDirectories: string[] = []

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'studyinchina-import-'))
  temporaryDirectories.push(directory)
  return directory
}

function strictManifest(directory: string): {
  manifest: Record<string, unknown>
  manifestPath: string
} {
  const artifactPath = join(directory, 'live-capture.json')
  const artifactBody = '{"official":true}\n'
  writeFileSync(artifactPath, artifactBody, 'utf8')
  const artifactSha256 = sha256(artifactBody)
  const artifactUri = (
    `r2://studyinchina-source-snapshots/materializations/${artifactSha256}.json`
  )
  const paddingStatements = Array.from({ length: 18 }, (_, index) => (
    `INSERT OR IGNORE INTO field_definitions (
      record_kind, field_path, value_type, risk_class, required_for_publish
    ) VALUES (
      'program', 'test.padding.${index}', 'string', 'low', 0
    );`
  ))
  const sql = [
    '-- Official materializer payload; semicolons in comments do not split.',
    'PRAGMA foreign_keys = ON;',
    `INSERT INTO records (
      id, public_id, kind, slug, workflow_status, review_after,
      row_version, created_at, updated_at
    ) VALUES (
      'program-one', 'program-one', 'program', 'program-one', 'draft',
      '2026-08-23', 1, '2026-07-24T00:00:00.000Z',
      '2026-07-24T00:00:00.000Z'
    ) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO programs (
      record_id, institution_id, program_type, degree_level,
      attendance_mode, delivery_mode, official_url
    ) VALUES (
      'program-one', 'uni-tsinghua-university', 'degree', 'master',
      'full_time', 'on_campus', 'https://yz.tsinghua.edu.cn/'
    ) ON CONFLICT(record_id) DO NOTHING;`,
    `INSERT INTO source_documents (
      id, public_id, canonical_url, publisher_organization_id, source_kind,
      authority_level, official, language_code, active, robots_policy
    ) VALUES (
      'source-one', 'source-one', 'https://yz.tsinghua.edu.cn/',
      'uni-tsinghua-university', 'program', 'primary_official', 1, 'zh', 1,
      'enforce'
    ) ON CONFLICT(id) DO NOTHING;`,
    `INSERT INTO source_fetches (
      id, source_id, status, requested_at, completed_at, http_status,
      content_type, content_length, sha256, artifact_uri
    ) VALUES (
      'fetch-one', 'source-one', 'succeeded',
      '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z', 200,
      'application/json', ${Buffer.byteLength(artifactBody)}, '${artifactSha256}',
      '${artifactUri}'
    ) ON CONFLICT(id) DO NOTHING;`,
    ...paddingStatements,
    `UPDATE records SET workflow_status = 'applied' WHERE id = 'program-one';`,
    'PRAGMA optimize;',
  ].join('\n')
  const sqlPath = join(directory, 'materialization.sql')
  writeFileSync(sqlPath, `${sql}\n`, 'utf8')
  const manifest = {
    format: 'studyinchina.pipeline.materialization',
    formatVersion: 1,
    batchId: 'a'.repeat(64),
    materializerVersion: 'official-entity-materializer/v1',
    provenanceStatus: 'complete',
    batchPurpose: 'catalog_entities',
    generatedAt: '2026-07-24T00:00:00.000Z',
    contentSha256: sha256(`${sql}\n`),
    sqlPath: 'materialization.sql',
    inputPaths: ['live-harvest.json'],
    counts: {
      records: 1,
      programs: 1,
      scholarships: 0,
      organizations: 0,
      locations: 0,
      claims: 4,
      canonicalFields: 4,
      sourceDocuments: 1,
      sourceFragments: 4,
      programCycles: 0,
      scholarshipCycles: 0,
    },
    recordMappings: [
      { recordId: 'program-one', recordKind: 'program' },
    ],
    sourceArtifacts: [
      {
        sourceId: 'source-one',
        fetchId: 'fetch-one',
        localPath: pathToFileURL(artifactPath).href,
        artifactSha256,
        artifactUri,
        contentType: 'application/json',
        byteLength: Buffer.byteLength(artifactBody),
        capturedAt: '2026-07-24T00:00:00.000Z',
        isFixture: false,
        captureMode: 'live',
      },
    ],
  }
  const manifestPath = join(directory, 'materialization.manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return { manifest, manifestPath }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('official entity SQL tokenizer', () => {
  it('splits on real terminators while preserving quoted semicolons and comments', () => {
    const statements = tokenizeSql(`
-- comment with ; terminator
INSERT INTO example(value) VALUES('one;two
three');
/* block ; comment */
UPDATE example SET value = "four;five";
`)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain("'one;two")
    expect(statements[1]).toContain('"four;five"')
  })

  it('rejects unterminated quoted SQL and trailing un-terminated statements', () => {
    expect(() => tokenizeSql("SELECT 'broken;")).toThrow(/unterminated SQL/u)
    expect(() => tokenizeSql('SELECT 1')).toThrow(/without a semicolon/u)
  })
})

describe('strict official entity import packager', () => {
  it('creates one marked file and server-resumable marked command chunks', () => {
    const directory = temporaryDirectory()
    const { manifestPath } = strictManifest(directory)
    const outputDirectory = join(directory, 'package')
    const result = packageOfficialEntityImport({
      manifestPath,
      outputDirectory,
      remote: false,
      maxCommandBytes: 4_000,
    })

    expect(result.manifest).toMatchObject({
      batchId: 'a'.repeat(64),
      batchPurpose: 'catalog_entities',
      provenanceStatus: 'complete',
      packageDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      counts: {
        records: 1,
        programs: 1,
        scholarships: 0,
        organizations: 0,
        locations: 0,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    })
    expect(result.manifest.transports.file.expectedChunks).toBe(1)
    expect(result.manifest.transports.file.chunks).toHaveLength(1)
    expect(result.manifest.transports.commandChunks.expectedChunks).toBeGreaterThan(1)

    for (const chunk of [
      ...result.manifest.transports.file.chunks,
      ...result.manifest.transports.commandChunks.chunks,
    ]) {
      const text = readFileSync(chunk.path, 'utf8')
      const markerStart = text.lastIndexOf('INSERT INTO materialization_batch_chunks')
      expect(markerStart).toBeGreaterThan(0)
      const payload = text.slice(0, markerStart)
      expect(sha256(payload)).toBe(chunk.chunkSha256)
      expect(payload).not.toContain(chunk.chunkSha256)
      expect(text).toContain(`'${chunk.chunkSha256}'`)
      expect(text).toContain(`'${result.manifest.packageDigest}'`)
      expect(text.match(/INSERT INTO materialization_batch_chunks/gu)).toHaveLength(1)
      expect(verifyOfficialEntityChunk(chunk.path)).toMatchObject({
        batchId: result.manifest.batchId,
        packageDigest: result.manifest.packageDigest,
        chunkNumber: chunk.chunkNumber,
        chunkSha256: chunk.chunkSha256,
        statementCount: chunk.statementCount,
      })
    }
    for (const chunk of result.manifest.transports.commandChunks.chunks) {
      expect(chunk.transportBytes).toBeLessThanOrEqual(4_000)
    }

    const combinedFileSql = readFileSync(
      result.manifest.transports.file.chunks[0].path,
      'utf8',
    )
    expect(combinedFileSql).not.toMatch(
      /UPDATE\s+records\s+SET\s+workflow_status\s*=\s*'applied'/iu,
    )
    expect(combinedFileSql).toContain("ELSE 'validated'")
    expect(combinedFileSql).toContain('materialization_batch_records')
    expect(combinedFileSql).toContain('materialization_batch_source_artifacts')
    const intentIndex = combinedFileSql.indexOf(
      'INSERT OR IGNORE INTO materialization_batch_record_intents',
    )
    const reservedIndex = combinedFileSql.indexOf("SET batch_status = 'reserved'")
    const importingIndex = combinedFileSql.indexOf("SET batch_status = 'importing'")
    const businessMutationIndex = combinedFileSql.indexOf('INSERT INTO records (')
    expect(intentIndex).toBeGreaterThan(0)
    expect(reservedIndex).toBeGreaterThan(intentIndex)
    expect(importingIndex).toBeGreaterThan(reservedIndex)
    expect(businessMutationIndex).toBeGreaterThan(importingIndex)
    expect(verifyOfficialEntityImportPackage(result.manifestPath)).toEqual({
      batchId: result.manifest.batchId,
      packageDigest: result.manifest.packageDigest,
      fileExpectedChunks: 1,
      commandExpectedChunks: result.manifest.transports.commandChunks.expectedChunks,
    })
    const verify = readFileSync(result.manifest.verificationSqlPath, 'utf8')
    expect(verify).toContain('COUNT(DISTINCT evidence.fragment_id)')
    expect(verify).toContain('NOT EXISTS')
    const finalize = readFileSync(result.manifest.finalizationSqlPath, 'utf8')
    expect(tokenizeSql(finalize)).toHaveLength(1)
    expect(finalize).not.toMatch(/UPDATE\s+records/iu)
    expect(finalize).toMatch(/UPDATE\s+materialization_batches/iu)
    expect(finalize).toContain("batch_status = 'applied'")
  })

  it('binds package identity deterministically and rejects chunk/package tampering', () => {
    const directory = temporaryDirectory()
    const { manifestPath } = strictManifest(directory)
    const validated = validateOfficialEntityMaterializationManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
      manifestPath,
      false,
    )
    const input = {
      materializerVersion: validated.materializerVersion,
      batchPurpose: validated.batchPurpose,
      sourceSqlSha256: validated.contentSha256,
      counts: validated.counts,
      recordMappings: validated.recordMappings,
      sourceArtifacts: validated.sourceArtifacts,
    }
    const digest = computeOfficialEntityPackageDigest(input)
    expect(computeOfficialEntityPackageDigest({
      ...input,
      recordMappings: [...input.recordMappings].reverse(),
      sourceArtifacts: input.sourceArtifacts.map((artifact) => ({
        ...artifact,
        localPath: join(directory, 'relocated-local-copy.json'),
      })),
    })).toBe(digest)
    expect(computeOfficialEntityPackageDigest({
      ...input,
      recordMappings: [{ recordId: 'program-two', recordKind: 'program' }],
    })).not.toBe(digest)
    expect(computeOfficialEntityPackageDigest({
      ...input,
      sourceArtifacts: input.sourceArtifacts.map((artifact) => ({
        ...artifact,
        contentType: 'application/pdf',
      })),
    })).not.toBe(digest)

    const packaged = packageOfficialEntityImport({
      manifestPath,
      outputDirectory: join(directory, 'tamper-package'),
      remote: false,
      maxCommandBytes: 4_000,
    })
    expect(packaged.manifest.packageDigest).toBe(digest)
    const chunkPath = packaged.manifest.transports.commandChunks.chunks[0].path
    const originalChunk = readFileSync(chunkPath, 'utf8')
    writeFileSync(chunkPath, originalChunk.replace('INSERT INTO', 'INSERT  INTO'), 'utf8')
    expect(() => verifyOfficialEntityChunk(chunkPath)).toThrow(/SHA-256/u)
    const markerDigestOffset = originalChunk.lastIndexOf(digest)
    writeFileSync(
      chunkPath,
      originalChunk.slice(0, markerDigestOffset)
        + 'c'.repeat(64)
        + originalChunk.slice(markerDigestOffset + digest.length),
      'utf8',
    )
    expect(verifyOfficialEntityChunk(chunkPath).packageDigest).toBe('c'.repeat(64))
    expect(() => verifyOfficialEntityImportPackage(packaged.manifestPath))
      .toThrow(/not reproducible|packageDigest/u)
    writeFileSync(chunkPath, originalChunk, 'utf8')
    expect(verifyOfficialEntityImportPackage(packaged.manifestPath).packageDigest)
      .toBe(digest)

    const packageJson = JSON.parse(
      readFileSync(packaged.manifestPath, 'utf8'),
    ) as Record<string, unknown>
    packageJson.packageDigest = 'd'.repeat(64)
    writeFileSync(packaged.manifestPath, JSON.stringify(packageJson), 'utf8')
    expect(() => verifyOfficialEntityImportPackage(packaged.manifestPath))
      .toThrow(/packageDigest does not match/u)
  })

  it('fails closed for incomplete provenance or fixture/missing remote fields', () => {
    const directory = temporaryDirectory()
    const { manifest, manifestPath } = strictManifest(directory)

    const missingBatch = structuredClone(manifest)
    delete missingBatch.batchId
    expect(() => validateOfficialEntityMaterializationManifest(
      missingBatch,
      manifestPath,
      true,
    )).toThrow(/batchId/u)

    const fixtureDirectory = join(directory, 'tests', 'fixtures')
    mkdirSync(fixtureDirectory, { recursive: true })
    const originalArtifact = (
      (manifest.sourceArtifacts as Array<Record<string, unknown>>)[0]
    )
    const fixturePath = join(fixtureDirectory, 'capture.json')
    const bytes = readFileSync(
      new URL(originalArtifact.localPath as string),
    )
    writeFileSync(fixturePath, bytes)
    const fixtureManifest = structuredClone(manifest)
    const fixtureArtifact = (
      (fixtureManifest.sourceArtifacts as Array<Record<string, unknown>>)[0]
    )
    fixtureArtifact.localPath = fixturePath
    expect(() => validateOfficialEntityMaterializationManifest(
      fixtureManifest,
      manifestPath,
      true,
    )).toThrow(/fixture source artifact/u)

    const incomplete = structuredClone(manifest)
    incomplete.provenanceStatus = 'fixture'
    expect(() => validateOfficialEntityMaterializationManifest(
      incomplete,
      manifestPath,
      true,
    )).toThrow(/provenanceStatus must be complete/u)
  })

  it('enforces the remote catalog gate without blocking dependency batches', () => {
    const directory = temporaryDirectory()
    const { manifest, manifestPath } = strictManifest(directory)

    expect(() => validateOfficialEntityMaterializationManifest(
      manifest,
      manifestPath,
      true,
    )).toThrow(/1000 programs and 50 scholarships/u)

    const dependencies = structuredClone(manifest)
    dependencies.batchPurpose = 'dependencies'
    dependencies.counts = {
      ...(dependencies.counts as Record<string, unknown>),
      records: 2,
      programs: 0,
      scholarships: 0,
      organizations: 1,
      locations: 1,
    }
    dependencies.recordMappings = [
      { recordId: 'location-beijing', recordKind: 'location' },
      { recordId: 'uni-tsinghua-university', recordKind: 'organization' },
    ]
    expect(validateOfficialEntityMaterializationManifest(
      dependencies,
      manifestPath,
      true,
    )).toMatchObject({
      batchPurpose: 'dependencies',
      counts: { organizations: 1, locations: 1 },
    })
  })

  it('keeps PowerShell resume state server-owned and parses Wrangler JSON', () => {
    const script = readFileSync(
      join(process.cwd(), 'scripts', 'ingestion', 'import-official-entities.ps1'),
      'utf8',
    )
    expect(script).not.toContain('StartChunk')
    expect(script).toContain('ConvertFrom-Json')
    expect(script).toContain('materialization_batch_chunks')
    expect(script).toContain('"r2", "object", "get"')
    expect(script).toContain('"r2", "object", "put"')
    expect(script).toContain('Assert-Counts')
    expect(script).toContain('Assert-BatchIdentity $serverBatch $package')
    expect(script).toContain('$packager, "--verify-package", $packagePath')
    expect(script).toContain('$packager, "--verify-chunk"')
    expect(script).toContain('if ($Applied)')
    expect(script.indexOf('$serverBatch = Get-Batch')).toBeLessThan(
      script.indexOf('Sync-R2 $package'),
    )
    const r2Block = script.slice(
      script.indexOf('function Sync-R2'),
      script.indexOf('function Import-Transport'),
    )
    expect(r2Block).toContain('The specified key does not exist.')
    expect(r2Block).not.toContain('404|not found|does not exist|NoSuchKey')
    expect(r2Block.indexOf('"r2", "object", "get"')).toBeLessThan(
      r2Block.indexOf('"r2", "object", "put"'),
    )
    const importBlock = script.slice(
      script.indexOf('function Import-Transport'),
      script.indexOf('function Assert-Counts'),
    )
    expect(importBlock.indexOf('Assert-LocalChunk')).toBeLessThan(
      importBlock.indexOf('Invoke-D1File'),
    )
    expect(script).not.toContain('Verified file marker was not produced')
    expect(script).toContain('"catalog_entities", "dependencies"')
    expect(script).toContain('Get-Command "node"')
    expect(script).toContain('"tsx.cmd"')
    expect(script).toContain('"tsx"')
    expect(script).toContain('"npx"')
    expect(script).not.toContain('Get-Command node.exe')
    expect(script).toContain('"../.."')
    expect(script).toContain('".pipeline-build/materialized"')
    expect(script).toContain('"node_modules/wrangler/bin/wrangler.js"')
  })

  it('passes the PowerShell parser', () => {
    const scriptPath = join(
      process.cwd(),
      'scripts',
      'ingestion',
      'import-official-entities.ps1',
    )
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
