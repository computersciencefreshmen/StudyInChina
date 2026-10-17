import { z } from 'zod'

export const CATALOG_MAINTENANCE_COLLECTIONS = ['cities', 'universities', 'programs', 'admission-cycles', 'scholarships'] as const
export const CATALOG_MAINTENANCE_OBSERVATION_STALE_MS = 120_000
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const stamp = z.string().datetime()
const outcomes = ['captured', 'partial', 'unconfirmed', 'held'] as const
const outcomeCounts = z.object({ visitedRecordIdentities: count, captured: count, partial: count, unconfirmed: count, held: count }).strict()

/** Sanitized metadata only; historical capture identities never imply current fact approval. */
export const catalogMaintenanceObservationSchema = z.object({
  schemaVersion: z.literal(1), observedAt: stamp,
  sourceFrontier: z.object({
    basis: z.literal('saved-frontier-task-metadata'), lastVisitedAt: stamp.nullable(),
    visitedRecordIdentities: count, captured: count, partial: count, unconfirmed: count, held: count,
    collections: z.object({ cities: outcomeCounts, universities: outcomeCounts, programs: outcomeCounts,
      'admission-cycles': outcomeCounts, scholarships: outcomeCounts }).strict(),
    currentCatalogCoveragePercent: z.null(),
  }).strict().nullable(),
  privateExtraction: z.object({ basis: z.literal('saved-extraction-task-metadata'), updatedAt: stamp,
    savedTasks: count, candidateReadyTasks: count, consecutiveFailures: count }).strict().nullable(),
  recordPipeline: z.object({ basis: z.literal('saved-continuous-consumer-state'), lastCoordinatorHeartbeatAt: stamp.nullable(),
    completedComparisons: count, retainedFailedComparisons: count, consecutiveFailures: count,
    currentRecordStageTaskBindings: count, currentRecordPendingStageTaskBindings: count, unsubmittedCurrentRecordStageTaskBindings: count,
    canonicalAppliedRecords: count, independentFactsApprovedRecords: z.null(), publicReadbackRecords: z.null(),
  }).strict().nullable(),
  semanticFactsApprovedByProjection: z.literal(false), paidReplayAllowed: z.literal(false),
}).strict().superRefine((value, context) => {
  const source = value.sourceFrontier
  if (source) {
    const rows = Object.values(source.collections)
    for (const row of [source, ...rows]) if (outcomes.reduce((sum, key) => sum + row[key], 0) !== row.visitedRecordIdentities) context.addIssue({ code: 'custom', message: 'Source outcome counts differ' })
    for (const key of ['visitedRecordIdentities', ...outcomes] as const) if (rows.reduce((sum, row) => sum + row[key], 0) !== source[key]) context.addIssue({ code: 'custom', message: 'Collection source counts differ' })
  }
  if (value.privateExtraction && value.privateExtraction.candidateReadyTasks > value.privateExtraction.savedTasks) context.addIssue({ code: 'custom', message: 'Private ready tasks exceed saved tasks' })
  const pipeline = value.recordPipeline
  if (pipeline && (pipeline.currentRecordPendingStageTaskBindings > pipeline.currentRecordStageTaskBindings || pipeline.unsubmittedCurrentRecordStageTaskBindings > pipeline.currentRecordPendingStageTaskBindings)) context.addIssue({ code: 'custom', message: 'Pending stage bindings exceed total' })
  const dates = [source?.lastVisitedAt, value.privateExtraction?.updatedAt, pipeline?.lastCoordinatorHeartbeatAt].filter((date): date is string => Boolean(date))
  if (dates.some(date => Date.parse(date) > Date.parse(value.observedAt) + 30_000)) context.addIssue({ code: 'custom', message: 'Future source metadata' })
})

export type CatalogMaintenanceObservation = z.infer<typeof catalogMaintenanceObservationSchema>

export function catalogMaintenanceObservationIsStale(value: CatalogMaintenanceObservation, now = Date.now()): boolean {
  const age = now - Date.parse(value.observedAt)
  return !Number.isFinite(age) || age < -30_000 || age > CATALOG_MAINTENANCE_OBSERVATION_STALE_MS
}
