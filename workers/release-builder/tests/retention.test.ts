import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SqliteD1Database } from '../../../scripts/catalog/build-pipeline-release'
import { handleFetch } from '../src/index'
import {
  enforceCatalogReleaseRetention,
  readCatalogReadiness,
} from '../src/retention'
import type { ReleaseBuilderEnv } from '../src/types'

const ZERO_COUNTS = JSON.stringify({
  sources: 0,
  cities: 0,
  universities: 0,
  programs: 0,
  admissionCycles: 0,
  scholarships: 0,
})

function applyCatalogMigrations(database: DatabaseSync): void {
  const directory = join(process.cwd(), 'infra', 'd1', 'catalog', 'migrations')
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(directory, file), 'utf8'))
  }
}

function activateRelease(database: DatabaseSync, version: number): void {
  const releaseId = `release-${version}`
  const timestamp = `2026-07-${String(version).padStart(2, '0')}T00:00:00.000Z`
  const hash = String(version).repeat(64)
  database.prepare(`
    INSERT INTO catalog_releases (
      release_id, data_version, schema_version, release_status,
      data_date, generated_at, source_pipeline_run_id, content_sha256,
      counts_json, created_at, validated_at
    ) VALUES (?, ?, 1, 'ready', date(?), ?, ?, ?, ?, ?, ?)
  `).run(
    releaseId,
    version,
    timestamp,
    timestamp,
    `pipeline-${version}`,
    hash,
    ZERO_COUNTS,
    timestamp,
    timestamp,
  )
  database.prepare(`
    INSERT INTO release_compatibility_artifacts (
      release_id, artifact_format, artifact_key, content_sha256,
      byte_length, created_at
    ) VALUES (?, 'studyinchina.frontend.bundle.v1', ?, ?, 2, ?)
  `).run(
    releaseId,
    `releases/${releaseId}/compat-envelope.json`,
    hash,
    timestamp,
  )
  database.prepare(`
    INSERT INTO release_activation_requests (
      request_id, release_id, expected_content_sha256,
      expected_counts_json, actor, requested_at
    ) VALUES (?, ?, ?, ?, 'retention-test', ?)
  `).run(`activate-${releaseId}`, releaseId, hash, ZERO_COUNTS, timestamp)
}

test('Catalog retention keeps current plus two rollback releases with immutable R2 tombstones', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  applyCatalogMigrations(sqlite)
  for (let version = 1; version <= 5; version += 1) activateRelease(sqlite, version)
  const database = new SqliteD1Database(sqlite)

  assert.deepEqual(await readCatalogReadiness(database), {
    activeRelease: true,
    pointerConsistency: true,
    retention: false,
  })

  const protectedRelease = sqlite.prepare(`
    SELECT release_id, data_version, content_sha256, counts_json, activated_at
    FROM catalog_releases WHERE release_id = 'release-3'
  `).get() as Record<string, string | number>
  assert.throws(() => sqlite.prepare(`
    INSERT INTO release_retention_audit (
      release_id, data_version, content_sha256, counts_json,
      normalized_artifact_key, compatibility_artifact_key,
      activated_at, purged_at, actor, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', 'catalog_release_retention')
  `).run(
    protectedRelease.release_id,
    protectedRelease.data_version,
    protectedRelease.content_sha256,
    protectedRelease.counts_json,
    'releases/release-3/catalog-release.v1.json',
    'releases/release-3/compat-envelope.json',
    protectedRelease.activated_at,
    '2026-08-05T00:00:00.000Z',
  ), /two newer rollback releases must exist/u)

  assert.deepEqual(
    await enforceCatalogReleaseRetention(database, new Date('2026-08-05T00:00:00.000Z')),
    { purged: 2 },
  )
  assert.deepEqual(
    sqlite.prepare(`
      SELECT release_id, release_status
      FROM catalog_releases
      ORDER BY data_version
    `).all().map((row) => ({ ...row })),
    [
      { release_id: 'release-3', release_status: 'retired' },
      { release_id: 'release-4', release_status: 'retired' },
      { release_id: 'release-5', release_status: 'active' },
    ],
  )
  assert.deepEqual(
    sqlite.prepare(`
      SELECT release_id, normalized_artifact_key, compatibility_artifact_key
      FROM release_retention_audit ORDER BY data_version
    `).all().map((row) => ({ ...row })),
    [
      {
        release_id: 'release-1',
        normalized_artifact_key: 'releases/release-1/catalog-release.v1.json',
        compatibility_artifact_key: 'releases/release-1/compat-envelope.json',
      },
      {
        release_id: 'release-2',
        normalized_artifact_key: 'releases/release-2/catalog-release.v1.json',
        compatibility_artifact_key: 'releases/release-2/compat-envelope.json',
      },
    ],
  )
  assert.deepEqual(await readCatalogReadiness(database), {
    activeRelease: true,
    pointerConsistency: true,
    retention: true,
  })
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
  sqlite.close()
})

function readinessEnvironment(row: Record<string, unknown> | null): ReleaseBuilderEnv {
  const statement = {
    bind() { return this },
    first: async () => row,
    all: async () => ({ success: true, results: [] }),
    run: async () => ({ success: true, meta: { changes: 0 } }),
  }
  return {
    CATALOG_DB: {
      prepare: () => statement,
      batch: async () => [],
    },
  } as unknown as ReleaseBuilderEnv
}

test('readiness endpoint exposes aggregate checks only and fails closed', async () => {
  const ready = await handleFetch(
    new Request('https://worker.example/ready'),
    readinessEnvironment({
      active_releases: 1,
      valid_pointers: 1,
      rollback_releases: 2,
      purgeable_releases: 0,
    }),
  )
  assert.equal(ready.status, 200)
  assert.deepEqual(await ready.json(), {
    ok: true,
    service: 'studyinchina-release-builder',
    version: '1.0.0',
    checks: {
      database: true,
      activeRelease: true,
      pointerConsistency: true,
      retention: true,
    },
  })

  const notReady = await handleFetch(
    new Request('https://worker.example/ready'),
    readinessEnvironment({
      active_releases: 1,
      valid_pointers: 1,
      rollback_releases: 3,
      purgeable_releases: 1,
    }),
  )
  assert.equal(notReady.status, 503)
  const body = await notReady.json() as Record<string, unknown>
  assert.equal(body.ok, false)
  assert.equal(JSON.stringify(body).includes('release-1'), false)
  assert.equal(notReady.headers.get('cache-control'), 'no-store')
})
