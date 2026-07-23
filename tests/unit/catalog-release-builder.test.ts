import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLegacyRelease, readLegacyBundle } from '../../scripts/catalog/build-release'

function applyMigrations(database: DatabaseSync) {
  for (const file of ['0001_release_core.sql', '0002_programs_scholarships.sql', '0003_search_views.sql', '0004_atomic_release_cutover.sql']) {
    database.exec(readFileSync(join(process.cwd(), 'infra', 'd1', 'catalog', 'migrations', file), 'utf8'))
  }
}

describe('legacy JSON release builder', () => {
  it('builds an exact compatibility envelope and idempotent D1 release', () => {
    const bundle = readLegacyBundle()
    const artifacts = buildLegacyRelease(bundle)
    const envelope = JSON.parse(artifacts.envelope)
    expect(envelope.data).toEqual(bundle)
    expect(envelope.meta.release.recordCounts.programs).toBe(120)
    expect(artifacts.sql).not.toContain('BEGIN TRANSACTION')
    expect(artifacts.sql).not.toContain("SET release_status = 'retired'")
    expect(artifacts.sql).not.toContain('UPDATE release_pointer SET current_release_id')
    expect(artifacts.sql).toContain('INSERT OR IGNORE INTO release_activation_requests')
    expect(artifacts.r2Key).toContain(artifacts.release.id)
    expect(artifacts.contentSha256).toBe(
      createHash('sha256').update(Buffer.from(artifacts.envelope, 'utf8')).digest('hex'),
    )

    const database = new DatabaseSync(':memory:')
    applyMigrations(database)
    database.exec(artifacts.sql)
    database.exec(artifacts.sql)
    const release = database.prepare('SELECT release_id, release_status, content_sha256 FROM current_release').get() as Record<string, unknown>
    expect(release).toEqual({
      release_id: artifacts.release.id,
      release_status: 'active',
      content_sha256: artifacts.contentSha256,
    })
    const counts = database.prepare(`
      SELECT
        (SELECT count(*) FROM institutions WHERE release_id = ?) AS universities,
        (SELECT count(*) FROM programs WHERE release_id = ?) AS programs,
        (SELECT count(*) FROM program_cycles WHERE release_id = ?) AS cycles,
        (SELECT count(*) FROM scholarships WHERE release_id = ?) AS scholarships
    `).get(artifacts.release.id, artifacts.release.id, artifacts.release.id, artifacts.release.id) as Record<string, number>
    expect(counts).toEqual({ universities: 40, programs: 120, cycles: 122, scholarships: 24 })
    database.close()
  })

  it('keeps the current release when validation or row-count checks fail', () => {
    const artifacts = buildLegacyRelease(readLegacyBundle())
    const database = new DatabaseSync(':memory:')
    applyMigrations(database)
    database.exec(artifacts.sql)

    const zeroCounts = JSON.stringify({
      sources: 0,
      cities: 0,
      universities: 0,
      programs: 0,
      admissionCycles: 0,
      scholarships: 0,
    })
    const hash = 'a'.repeat(64)
    const addRelease = database.prepare(`
      INSERT INTO catalog_releases (
        release_id, data_version, schema_version, release_status,
        source_pipeline_run_id, data_date, generated_at, content_sha256,
        counts_json, created_at, validated_at
      ) VALUES (?, ?, 1, ?, 'test', '2026-07-21', '2026-07-21T00:00:00.000Z', ?, ?,
        '2026-07-21T00:00:00.000Z', ?)
    `)
    const activate = database.prepare(`
      INSERT INTO release_activation_requests (
        request_id, release_id, expected_content_sha256,
        expected_counts_json, actor, requested_at
      ) VALUES (?, ?, ?, ?, 'test', '2026-07-21T00:00:00.000Z')
    `)

    addRelease.run('unvalidated-release', 2, 'ready', hash, zeroCounts, null)
    expect(() => activate.run('activate-unvalidated', 'unvalidated-release', hash, zeroCounts))
      .toThrow(/ready and validated/)

    const mismatchedCounts = JSON.stringify({
      sources: 0,
      cities: 0,
      universities: 1,
      programs: 0,
      admissionCycles: 0,
      scholarships: 0,
    })
    addRelease.run(
      'count-mismatch-release',
      3,
      'ready',
      hash,
      mismatchedCounts,
      '2026-07-21T00:00:00.000Z',
    )
    expect(() => activate.run(
      'activate-count-mismatch',
      'count-mismatch-release',
      hash,
      mismatchedCounts,
    )).toThrow(/row counts/)

    const current = database.prepare('SELECT release_id FROM current_release').get() as { release_id: string }
    expect(current.release_id).toBe(artifacts.release.id)
    expect(database.prepare('SELECT count(*) AS count FROM release_activation_requests').get())
      .toEqual({ count: 1 })
    database.close()
  })
})
