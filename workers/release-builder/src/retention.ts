import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from './types'
import { RELEASE_TABLES } from './types'

export const CATALOG_RELEASE_LIMIT = 3
export const CATALOG_ROLLBACK_LIMIT = CATALOG_RELEASE_LIMIT - 1

type RetiredRelease = {
  release_id: string
}

export type CatalogReadiness = {
  activeRelease: boolean
  pointerConsistency: boolean
  retention: boolean
}

type CatalogReadinessRow = {
  active_releases: number
  valid_pointers: number
  rollback_releases: number
  purgeable_releases: number
}

function statement(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): D1PreparedStatement {
  return database.prepare(sql).bind(...values)
}

function ensureBatch(results: D1Result[], label: string): void {
  const failure = results.find((result) => !result.success)
  if (failure) throw new Error(`${label}: ${failure.error ?? 'D1 batch failed'}`)
}

async function all<T>(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  const result = await statement(database, sql, ...values).all<T>()
  if (!result.success) throw new Error(result.error ?? 'D1 query failed')
  return result.results ?? []
}

async function first<T>(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<T | null> {
  return statement(database, sql, ...values).first<T>()
}

export async function readCatalogReadiness(
  database: D1Database,
): Promise<CatalogReadiness> {
  const row = await first<CatalogReadinessRow>(database, `
    SELECT
      (SELECT count(*) FROM catalog_releases WHERE release_status = 'active')
        AS active_releases,
      (SELECT count(*)
         FROM release_pointer pointer
         JOIN catalog_releases release
           ON release.release_id = pointer.current_release_id
          AND release.release_status = 'active'
        WHERE pointer.singleton_id = 1)
        AS valid_pointers,
      (SELECT count(*) FROM catalog_releases WHERE release_status = 'retired')
        AS rollback_releases,
      (SELECT count(*)
         FROM catalog_releases candidate
        WHERE candidate.release_status = 'retired'
          AND (
            SELECT count(*)
            FROM catalog_releases newer
            WHERE newer.release_status = 'retired'
              AND (
                newer.activated_at > candidate.activated_at
                OR (
                  newer.activated_at = candidate.activated_at
                  AND newer.data_version > candidate.data_version
                )
              )
          ) >= ?1)
        AS purgeable_releases
  `, CATALOG_ROLLBACK_LIMIT)

  return {
    activeRelease: Number(row?.active_releases ?? 0) === 1,
    pointerConsistency: Number(row?.valid_pointers ?? 0) === 1,
    retention: Number(row?.rollback_releases ?? 0) <= CATALOG_ROLLBACK_LIMIT
      && Number(row?.purgeable_releases ?? 0) === 0,
  }
}

export async function enforceCatalogReleaseRetention(
  database: D1Database,
  now = new Date(),
): Promise<{ purged: number }> {
  const candidates = await all<RetiredRelease>(database, `
    SELECT release_id
    FROM catalog_releases
    WHERE release_status = 'retired'
    ORDER BY activated_at DESC, data_version DESC, release_id DESC
    LIMIT -1 OFFSET ?1
  `, CATALOG_ROLLBACK_LIMIT)

  for (const candidate of candidates) {
    const releaseId = candidate.release_id
    const purgedAt = now.toISOString()
    const statements = [
      statement(database, `
        INSERT INTO release_retention_audit (
          release_id, data_version, content_sha256, counts_json,
          normalized_artifact_key, compatibility_artifact_key,
          activated_at, purged_at, actor, reason
        )
        SELECT
          release.release_id,
          release.data_version,
          release.content_sha256,
          release.counts_json,
          'releases/' || release.release_id || '/catalog-release.v1.json',
          compatibility.artifact_key,
          release.activated_at,
          ?2,
          'release-builder-worker',
          'catalog_release_retention'
        FROM catalog_releases release
        JOIN release_compatibility_artifacts compatibility
          ON compatibility.release_id = release.release_id
        WHERE release.release_id = ?1
          AND release.release_status = 'retired'
      `, releaseId, purgedAt),
      statement(
        database,
        'UPDATE release_activation_requests SET previous_release_id = NULL WHERE previous_release_id = ?1',
        releaseId,
      ),
      statement(database, 'DELETE FROM release_audit_log WHERE release_id = ?1', releaseId),
      statement(database, 'DELETE FROM release_activation_requests WHERE release_id = ?1', releaseId),
      ...[...RELEASE_TABLES].reverse().map((table) => statement(
        database,
        `DELETE FROM "${table}" WHERE release_id = ?1`,
        releaseId,
      )),
      statement(
        database,
        'DELETE FROM release_compatibility_artifacts WHERE release_id = ?1',
        releaseId,
      ),
      statement(database, `
        DELETE FROM catalog_releases
        WHERE release_id = ?1
          AND release_status = 'retired'
          AND NOT EXISTS (
            SELECT 1 FROM release_pointer
            WHERE singleton_id = 1 AND current_release_id = ?1
          )
      `, releaseId),
    ]
    ensureBatch(await database.batch(statements), `purge Catalog release ${releaseId}`)

    const verification = await first<{ release_exists: number; audit_exists: number }>(
      database,
      `SELECT
        EXISTS(SELECT 1 FROM catalog_releases WHERE release_id = ?1) AS release_exists,
        EXISTS(SELECT 1 FROM release_retention_audit WHERE release_id = ?1) AS audit_exists`,
      releaseId,
    )
    if (Number(verification?.release_exists ?? 1) !== 0
      || Number(verification?.audit_exists ?? 0) !== 1) {
      throw new Error(`Catalog release retention verification failed for ${releaseId}`)
    }
  }

  return { purged: candidates.length }
}
