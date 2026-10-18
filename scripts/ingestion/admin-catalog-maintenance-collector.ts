import 'server-only'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { CATALOG_MAINTENANCE_COLLECTIONS, catalogMaintenanceObservationSchema, type CatalogMaintenanceObservation } from '../../src/lib/admin/catalog-maintenance-contract'

export const CATALOG_MAINTENANCE_BRIDGE_OPT_IN_ENV = 'ADMIN_CATALOG_MAINTENANCE_TELEMETRY_ENABLED'
export function catalogMaintenanceBridgeEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment[CATALOG_MAINTENANCE_BRIDGE_OPT_IN_ENV] === 'true'
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), stamp = z.string().datetime(), digest = z.string().regex(/^[a-f0-9]{64}$/)
// These read-only selectors validate selected native metadata, not factual evidence or execution eligibility.
const sourceMetadata = z.object({ schemaVersion: z.literal(1), policyVersion: z.literal('catalog-maintenance-source-frontier-v1'),
  tasks: z.record(z.string(), z.object({ fingerprint: digest, taskKey: digest, checkedAt: stamp,
    outcome: z.enum(['captured', 'partial', 'unconfirmed', 'held']), receiptPath: z.string().min(1), receiptSha256: digest }).strict()),
  heartbeats: z.record(z.string(), z.object({ state: z.enum(['started', 'completed']), at: stamp }).strict()),
}).strict()
const extractionMetadata = z.object({ schemaVersion: z.literal(1), updatedAt: stamp, consecutiveFailures: count,
  tasks: z.record(z.string(), z.object({ taskId: z.string().min(1), state: z.string().min(1), runId: z.string().regex(/^[a-f0-9]{16}$/),
    checkedAt: stamp, capturedSources: count }).passthrough()),
}).passthrough()
const pipelineMetadata = z.object({ schemaVersion: z.literal(1), policyVersion: z.literal('minimax-continuous-once-v1'),
  fullRecordCompleted: count, fullRecordFailed: count, fullRecordConsecutiveFailures: count, approvedPublications: count,
  stages: z.array(z.object({ manifestSha256: digest, taskIds: z.array(z.string().min(1).max(512)).min(1).max(90),
    state: z.enum(['pending', 'blocked', 'published']), kind: z.enum(['current-record', 'reviewed-correction']).optional() }).passthrough()).max(1000),
  jobs: z.record(digest, z.object({ manifestSha256: digest, taskId: z.string().min(1).max(512),
    state: z.enum(['submitted', 'completed', 'failed', 'reserved', 'ambiguous']) }).passthrough()),
  heartbeats: z.record(z.string(), z.object({ state: z.enum(['started', 'completed']), at: stamp }).strict()),
}).passthrough()

export function projectCatalogMaintenanceObservation(input: { frontier?: unknown; extraction?: unknown; pipeline?: unknown }, now = Date.now()): CatalogMaintenanceObservation {
  const frontier = sourceMetadata.safeParse(input.frontier), extraction = extractionMetadata.safeParse(input.extraction), pipeline = pipelineMetadata.safeParse(input.pipeline)
  const timely = (date: string) => Date.parse(date) <= now + 30_000
  let sourceFrontier: CatalogMaintenanceObservation['sourceFrontier'] = null
  if (frontier.success) {
    const rows = Object.entries(frontier.data.tasks)
    const namedCollection = (id: string) => CATALOG_MAINTENANCE_COLLECTIONS.find(collection => id.startsWith(`${collection}:`) && id.length > collection.length + 1)
    if (rows.every(([id, row]) => namedCollection(id) && timely(row.checkedAt))) {
      const empty = () => ({ visitedRecordIdentities: 0, captured: 0, partial: 0, unconfirmed: 0, held: 0 })
      const collections = { cities: empty(), universities: empty(), programs: empty(), 'admission-cycles': empty(), scholarships: empty() }
      for (const [id, row] of rows) { const item = collections[namedCollection(id)!]; item.visitedRecordIdentities++; item[row.outcome]++ }
      const sum = (key: keyof ReturnType<typeof empty>) => Object.values(collections).reduce((total, row) => total + row[key], 0)
      sourceFrontier = { basis: 'saved-frontier-task-metadata', lastVisitedAt: rows.map(([, row]) => row.checkedAt).sort().at(-1) || null,
        visitedRecordIdentities: sum('visitedRecordIdentities'), captured: sum('captured'), partial: sum('partial'), unconfirmed: sum('unconfirmed'), held: sum('held'),
        collections, currentCatalogCoveragePercent: null }
    }
  }
  const tasks = extraction.success ? Object.values(extraction.data.tasks) : []
  const privateExtraction: CatalogMaintenanceObservation['privateExtraction'] = extraction.success && timely(extraction.data.updatedAt) && tasks.every(task => timely(task.checkedAt))
    ? { basis: 'saved-extraction-task-metadata', updatedAt: extraction.data.updatedAt, savedTasks: tasks.length,
      candidateReadyTasks: tasks.filter(task => task.state === 'candidate-ready').length, consecutiveFailures: extraction.data.consecutiveFailures } : null
  let recordPipeline: CatalogMaintenanceObservation['recordPipeline'] = null
  if (pipeline.success) {
    const heartbeatTimes = Object.values(pipeline.data.heartbeats).map(heartbeat => heartbeat.at)
    if (heartbeatTimes.every(timely)) {
      const stages = pipeline.data.stages.filter(stage => stage.kind === 'current-record'), pending = stages.filter(stage => stage.state === 'pending')
      const consumedBindings = new Set(Object.values(pipeline.data.jobs).map(job => JSON.stringify([job.manifestSha256, job.taskId])))
      recordPipeline = { basis: 'saved-continuous-consumer-state', lastCoordinatorHeartbeatAt: heartbeatTimes.sort().at(-1) || null,
        completedComparisons: pipeline.data.fullRecordCompleted, retainedFailedComparisons: pipeline.data.fullRecordFailed, consecutiveFailures: pipeline.data.fullRecordConsecutiveFailures,
        currentRecordStageTaskBindings: stages.reduce((total, stage) => total + stage.taskIds.length, 0),
        currentRecordPendingStageTaskBindings: pending.reduce((total, stage) => total + stage.taskIds.length, 0),
        unsubmittedCurrentRecordStageTaskBindings: pending.reduce((total, stage) => total + stage.taskIds.filter(taskId => !consumedBindings.has(JSON.stringify([stage.manifestSha256, taskId]))).length, 0),
        canonicalAppliedRecords: pipeline.data.approvedPublications, independentFactsApprovedRecords: null, publicReadbackRecords: null }
    }
  }
  return catalogMaintenanceObservationSchema.parse({ schemaVersion: 1, observedAt: new Date(now).toISOString(), sourceFrontier, privateExtraction, recordPipeline,
    semanticFactsApprovedByProjection: false, paidReplayAllowed: false })
}

async function readBoundedMetadata(root: string, path: string, maximumBytes: number): Promise<unknown | null> {
  try {
    let current = root
    for (const part of path.split('/')) {
      current = resolve(current, part)
      if ((await lstat(/* turbopackIgnore: true */ current)).isSymbolicLink()) return null
    }
    const actual = await realpath(/* turbopackIgnore: true */ current), within = relative(root, actual)
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) return null
    const info = await lstat(/* turbopackIgnore: true */ actual)
    if (!info.isFile() || info.size > maximumBytes) return null
    const bytes = await readFile(/* turbopackIgnore: true */ actual)
    if (bytes.length > maximumBytes) return null
    return JSON.parse(bytes.toString('utf8'))
  } catch { return null }
}

/** Reads only known local metadata; it never creates state, commands, locks or model requests. */
export async function readCatalogMaintenanceObservation(root = process.cwd(), now = Date.now()): Promise<CatalogMaintenanceObservation | null> {
  let actualRoot: string
  try { actualRoot = await realpath(/* turbopackIgnore: true */ resolve(root)) } catch { return null }
  const [frontier, extraction, pipeline] = await Promise.all([
    readBoundedMetadata(actualRoot, '.tmp/minimax-catalog-maintenance/state.json', 4 * 1024 * 1024),
    readBoundedMetadata(actualRoot, '.tmp/minimax-enrichment/progress.json', 32 * 1024 * 1024),
    readBoundedMetadata(actualRoot, '.tmp/minimax-continuous-pipeline/state.json', 4 * 1024 * 1024),
  ])
  const observation = projectCatalogMaintenanceObservation({ frontier, extraction, pipeline }, now)
  return observation.sourceFrontier || observation.privateExtraction || observation.recordPipeline ? observation : null
}
