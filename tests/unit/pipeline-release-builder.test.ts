import { strict as assert } from 'node:assert'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'vitest'
import {
  buildCatalogImportSql,
  buildCatalogVerificationSql,
  buildPipelineSnapshotVerificationSql,
  loadPipelineExport,
  selectReleaseJob,
} from '../../scripts/catalog/build-pipeline-release'
import {
  RELEASE_TABLES,
  type ReleaseArtifact,
  type ReleaseQueueJob,
  type SqlRow,
} from '../../workers/release-builder/src/types'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'studyinchina-pipeline-release-'))
  temporaryDirectories.push(path)
  return path
}

function applyCatalogMigrations(database: DatabaseSync): void {
  const directory = join(process.cwd(), 'infra', 'd1', 'catalog', 'migrations')
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(directory, name), 'utf8'))
  }
}

function cityArtifact(): ReleaseArtifact {
  const releaseId = 'catalog-release-local-test'
  const tables = Object.fromEntries(
    RELEASE_TABLES.map((table) => [table, [] as SqlRow[]]),
  ) as ReleaseArtifact['tables']
  tables.catalog_records.push({
    release_id: releaseId,
    record_id: 'city-test',
    record_kind: 'location',
    slug: 'test-city',
    gate_status: 'publishable',
    verified_at: '2026-07-25',
    review_after: '2026-08-26',
    content_sha256: 'c'.repeat(64),
  })
  tables.locations.push({
    release_id: releaseId,
    location_id: 'city-test',
    parent_location_id: null,
    location_type: 'city',
    country_code: 'CN',
    region_code: null,
    latitude: null,
    longitude: null,
  })
  return {
    format: 'studyinchina.catalog.release',
    formatVersion: 1,
    manifest: {
      releaseId,
      dataVersion: 1,
      schemaVersion: 1,
      dataDate: '2026-07-26',
      generatedAt: '2026-07-26T00:00:00.000Z',
      sourcePipelineRunId: 'publication-job-local-test',
      counts: {
        sources: 0,
        cities: 1,
        universities: 0,
        programs: 0,
        admissionCycles: 0,
        scholarships: 0,
      },
    },
    tableDigests: Object.fromEntries(
      RELEASE_TABLES.map((table) => [table, '0'.repeat(64)]),
    ) as ReleaseArtifact['tableDigests'],
    tables,
  }
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('local Pipeline release builder', () => {
  it('loads a repository-standard data-only export and restores validation triggers', () => {
    const directory = temporaryDirectory()
    const exportPath = join(directory, 'pipeline.sql')
    writeFileSync(exportPath, `
PRAGMA defer_foreign_keys=TRUE;
INSERT INTO publication_jobs (
  id, catalog_release_id, job_status, source_change_set_ids_json,
  expected_counts_json, created_at
) VALUES (
  'publication-job-local-test', 'catalog-release-local-test', 'building', '[]',
  '{"programs":0,"scholarships":0}', '2026-07-26T00:00:00.000Z'
);
INSERT INTO outbox_events (
  id, event_type, aggregate_id, payload_json, event_status,
  attempt_count, available_at, created_at
) VALUES (
  'outbox-local-test', 'catalog.release.requested',
  'publication-job-local-test',
  '{"version":1,"publicationJobId":"publication-job-local-test","catalogReleaseId":"catalog-release-local-test"}',
  'processing', 1, '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
);
`, 'utf8')

    const loaded = loadPipelineExport(exportPath)
    try {
      assert.deepEqual(selectReleaseJob(loaded.database), {
        version: 1,
        outboxEventId: 'outbox-local-test',
        publicationJobId: 'publication-job-local-test',
        catalogReleaseId: 'catalog-release-local-test',
        requestedAt: '2026-07-26T00:00:00.000Z',
      })
      const triggerCount = loaded.database
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'trigger'")
        .get() as { count: number }
      assert.ok(triggerCount.count > 0)
      assert.deepEqual(loaded.database.prepare('PRAGMA foreign_key_check').all(), [])
    } finally {
      loaded.database.close()
    }
  })

  it('keeps all-table count checks and atomically activates generated Catalog SQL', () => {
    const artifact = cityArtifact()
    const normalizedHash = 'a'.repeat(64)
    const countsJson = JSON.stringify(artifact.manifest.counts)
    const compatibility = {
      key: `releases/${artifact.manifest.releaseId}/compat-envelope.json`,
      contentSha256: 'b'.repeat(64),
      byteLength: 2,
    }
    const sql = buildCatalogImportSql(
      artifact,
      normalizedHash,
      compatibility,
      '2026-07-26T00:05:00.000Z',
    )
    const verification = buildCatalogVerificationSql(artifact, normalizedHash)
    assert.match(sql, /SELECT count\(\*\) FROM "catalog_records"/u)
    assert.match(sql, /SELECT count\(\*\) FROM "search_documents"/u)
    assert.match(verification, /hex\(release\.counts_json\)/u)
    assert.ok(!verification.includes(countsJson))

    const database = new DatabaseSync(':memory:')
    try {
      applyCatalogMigrations(database)
      database.exec(sql)
      const row = database.prepare(verification).get() as {
        current_release_id: string
        release_status: string
        release_valid: number
      }
      assert.equal(row.current_release_id, artifact.manifest.releaseId)
      assert.equal(row.release_status, 'active')
      assert.equal(row.release_valid, 1)
      assert.equal(
        (database.prepare('SELECT count(*) AS count FROM locations').get() as {
          count: number
        }).count,
        1,
      )
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    } finally {
      database.close()
    }
  })

  it('uses quote-safe hex for Pipeline snapshot JSON verification', () => {
    const job: ReleaseQueueJob = {
      version: 1,
      outboxEventId: 'outbox-local-test',
      publicationJobId: 'publication-job-local-test',
      catalogReleaseId: 'catalog-release-local-test',
      requestedAt: '2026-07-26T00:00:00.000Z',
    }
    const countsJson = '{"programs":1006,"scholarships":55}'
    const verification = buildPipelineSnapshotVerificationSql(
      job,
      'releases/catalog-release-local-test/catalog-release.v1.json',
      'a'.repeat(64),
      123,
      countsJson,
    )
    assert.match(verification, /hex\("counts_json"\)/u)
    assert.ok(!verification.includes(countsJson))
  })
})
