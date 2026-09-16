import { ReleaseValidationError } from './artifact'
import type { D1Database, ReleaseArtifact } from './types'

/** A partial crawl must never erase stable identities or still-current cycles. */
export async function assertAutomatedReleaseHealth(
  database: D1Database,
  artifact: ReleaseArtifact,
  now = new Date(),
): Promise<string | null> {
  if (!artifact.tables.institutions.length || !artifact.tables.programs.length) {
    throw new ReleaseValidationError('release_identity_empty', 'Automated releases require institutions and programs')
  }
  const active = await database.prepare(`
    SELECT release.release_id, release.generated_at
    FROM release_pointer pointer JOIN catalog_releases release
      ON release.release_id = pointer.current_release_id AND release.release_status = 'active'
    WHERE pointer.singleton_id = 1
  `).first<{ release_id: string; generated_at: string }>()
  if (!active) {
    const pointer = await database.prepare('SELECT current_release_id FROM release_pointer WHERE singleton_id = 1')
      .first<{ current_release_id: string | null }>()
    if (pointer?.current_release_id) {
      throw new ReleaseValidationError('release_pointer_inconsistent', 'Current release pointer is not active')
    }
    return null
  }
  if (Date.parse(artifact.manifest.generatedAt) < Date.parse(active.generated_at)) {
    throw new ReleaseValidationError('release_snapshot_superseded', 'A newer catalog is already active')
  }
  const currentDate = new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10)
  const previous = await database.prepare(`
    SELECT 'institution' AS kind, institution_id AS id FROM institutions WHERE release_id = ?1
    UNION ALL
    SELECT 'program', program_id FROM programs WHERE release_id = ?1
    UNION ALL
    SELECT 'cycle', cycle.program_cycle_id
    FROM program_cycles cycle JOIN catalog_records record
      ON record.release_id = cycle.release_id AND record.record_id = cycle.program_cycle_id
    WHERE cycle.release_id = ?1 AND cycle.cycle_status = 'announced'
      AND record.gate_status = 'publishable' AND record.review_after >= ?2
      AND (cycle.ends_on IS NULL OR cycle.ends_on >= ?2)
      AND CAST(substr(cycle.academic_year, 6, 4) AS INTEGER) >= CAST(substr(?2, 1, 4) AS INTEGER)
      AND (
        NOT EXISTS (
          SELECT 1 FROM application_routes route JOIN application_windows window
            ON window.release_id = route.release_id AND window.application_route_id = route.application_route_id
          WHERE route.release_id = cycle.release_id AND route.owner_record_id = cycle.program_cycle_id
        ) OR EXISTS (
          SELECT 1 FROM application_routes route JOIN application_windows window
            ON window.release_id = route.release_id AND window.application_route_id = route.application_route_id
          WHERE route.release_id = cycle.release_id AND route.owner_record_id = cycle.program_cycle_id
            AND (window.closes_on IS NULL OR window.closes_on >= ?2)
        )
      )
  `).bind(active.release_id, currentDate).all<{ kind: string; id: string }>()
  if (!previous.success) throw new Error(previous.error ?? 'Could not compare active release identities')
  const identities = new Set([
    ...artifact.tables.institutions.map((row) => 'institution:' + row.institution_id),
    ...artifact.tables.programs.map((row) => 'program:' + row.program_id),
    ...artifact.tables.program_cycles.map((row) => 'cycle:' + row.program_cycle_id),
  ])
  const missing = (previous.results ?? []).filter((row) => !identities.has(row.kind + ':' + row.id))
  if (missing.length) {
    throw new ReleaseValidationError('release_identity_loss',
      'Automated release would remove ' + missing.length + ' protected identities: '
        + missing.slice(0, 10).map((row) => row.kind + ':' + row.id).join(', '))
  }
  return active.release_id
}
