import {
  materializeExtractedEntityCandidate,
  requestEntityMaterializationRelease,
  type EntityMaterializationResult,
  type EntityReleaseRequestResult,
} from './entity-materializer'
import type { D1Database } from './types'

type CandidateIdRow = { candidate_id: string }

export type EntityMaterializationBatchResult = {
  attempted: number
  materialized: number
  alreadyMaterialized: number
  quarantined: number
  conflicts: number
  pending: number
  failures: Array<{ candidateId: string; message: string }>
  release: EntityReleaseRequestResult | null
  results: EntityMaterializationResult[]
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`limit must be an integer from 1 to ${maximum}`)
  }
  return value
}

async function candidateIds(
  database: D1Database,
  sql: string,
  limit: number,
): Promise<string[]> {
  const result = await database.prepare(sql).bind(limit).all<CandidateIdRow>()
  if (!result.success) {
    throw new Error(`entity materialization queue query failed: ${result.error ?? 'unknown D1 error'}`)
  }
  return (result.results ?? []).map((row) => row.candidate_id)
}

export async function listPendingEntityMaterializationCandidates(
  database: D1Database,
  limit = 20,
): Promise<string[]> {
  return candidateIds(
    database,
    `SELECT candidate.candidate_id
       FROM extracted_entity_candidates candidate
       JOIN entity_registry registry
         ON registry.institution_id = candidate.institution_id
        AND registry.entity_type = candidate.entity_type
        AND registry.entity_key = candidate.entity_key
       JOIN catalog_reconciliation_items reconciliation
         ON reconciliation.candidate_id = candidate.candidate_id
       WHERE candidate.candidate_status IN ('validated', 'registered', 'quarantined')
         AND NOT EXISTS (
           SELECT 1 FROM entity_materialization_decisions decision
           WHERE decision.candidate_id = candidate.candidate_id
         )
       ORDER BY candidate.created_at, candidate.candidate_id
       LIMIT ?1`,
    boundedLimit(limit, 20, 100),
  )
}

export async function listUnreleasedMaterializedEntityCandidates(
  database: D1Database,
  limit = 500,
): Promise<string[]> {
  return candidateIds(
    database,
    `SELECT decision.candidate_id
       FROM entity_materialization_decisions decision
       WHERE decision.decision_status = 'materialized'
         AND NOT EXISTS (
           SELECT 1
           FROM entity_materialization_release_requests request,
                json_each(request.candidate_ids_json) requested
           WHERE requested.value = decision.candidate_id
         )
       ORDER BY decision.decided_at, decision.candidate_id
       LIMIT ?1`,
    boundedLimit(limit, 500, 1_000),
  )
}

export async function processEntityMaterializationBatch(
  database: D1Database,
  options: {
    candidateLimit?: number
    releaseCandidateLimit?: number
    now?: string
    requestRelease?: boolean
  } = {},
): Promise<EntityMaterializationBatchResult> {
  const now = options.now ?? new Date().toISOString()
  const ids = await listPendingEntityMaterializationCandidates(
    database,
    options.candidateLimit,
  )
  const results: EntityMaterializationResult[] = []
  const failures: Array<{ candidateId: string; message: string }> = []
  for (const candidateId of ids) {
    try {
      results.push(await materializeExtractedEntityCandidate(database, candidateId, {
        decidedAt: now,
      }))
    } catch (error) {
      failures.push({
        candidateId,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
      })
    }
  }

  let release: EntityReleaseRequestResult | null = null
  if (options.requestRelease !== false) {
    const releaseCandidates = await listUnreleasedMaterializedEntityCandidates(
      database,
      options.releaseCandidateLimit,
    )
    if (releaseCandidates.length > 0) {
      release = await requestEntityMaterializationRelease(database, releaseCandidates, now)
    }
  }

  const count = (status: EntityMaterializationResult['status']) => (
    results.filter((result) => result.status === status).length
  )
  return {
    attempted: ids.length,
    materialized: count('materialized'),
    alreadyMaterialized: count('already-materialized'),
    quarantined: count('quarantined'),
    conflicts: count('conflict'),
    pending: count('pending'),
    failures,
    release,
    results,
  }
}
