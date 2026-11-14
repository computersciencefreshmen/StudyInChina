import { maintenanceRecordTargetSchema, type MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import type { MaintenanceEnv } from './types'
import { canonical, digest, HASH, record } from './util'
import { MaintenanceError } from './types'

const MAX_SOURCES = 8, MAX_DEPTH = 2, MAX_PARENTS = 256, MAX_FRONTIERS = 16, MAX_BYTES = 256 * 1024
type Ref = { objectKey: string; sha256: string }
type Pending = { childSourceId: string; parentSourceId: string | null; reason: string; lineage?: Ref; unprocessedParents?: number }
type Node = { sourceId: string; depth: number; child?: { sourceId: string; url: string }; frontierSha256?: string; lineage?: Ref }
export type RecordTargetGraph = { targets: MaintenanceRecordTarget[]; sourceId: string; scopeSha256: string | null; inputCatalogSha256: string | null;
  visitedSourceIds: string[]; pendingEdges: Pending[]; lineageRefs: Ref[]; complete: boolean; catalogueComplete: false; applicabilityEstablished: false }
type Source = { source_id: string; url: string; raw_sha256: string | null; allowed_hosts_json: string }
async function bounded(env: MaintenanceEnv, objectKey: string) {
  const object = await env.SNAPSHOTS_BUCKET.get(objectKey)
  if (!object) return null
  if (object.size !== undefined && object.size > MAX_BYTES) return { objectKey, oversized: true as const }
  const text = await object.text(), sha256 = await digest(text)
  return new TextEncoder().encode(text).length > MAX_BYTES ? { objectKey, oversized: true as const, sha256 } : { objectKey, text, sha256, oversized: false as const }
}

/** Bounded acquisition candidates, never a statement that navigation establishes
 * programme eligibility. Every inherited edge needs its real immutable frontier. */
export async function readRecordTargetGraph(env: MaintenanceEnv, sourceId: string): Promise<RecordTargetGraph> {
  const cfg = await env.PIPELINE_DB.prepare('SELECT scope_sha256,input_catalog_sha256,revision FROM maintenance_control WHERE singleton=1').first<{ scope_sha256: string; input_catalog_sha256: string; revision: number }>()
  const result: RecordTargetGraph = { targets: [], sourceId, scopeSha256: cfg?.scope_sha256 ?? null, inputCatalogSha256: cfg?.input_catalog_sha256 ?? null,
    visitedSourceIds: [], pendingEdges: [], lineageRefs: [], complete: false, catalogueComplete: false, applicabilityEstablished: false }
  const pending = (node: Node, reason: string, extra: Partial<Pending> = {}) => result.pendingEdges.push({ childSourceId: node.child?.sourceId ?? node.sourceId, parentSourceId: node.child ? node.sourceId : null, reason, ...(node.lineage ? { lineage: node.lineage } : {}), ...extra })
  if (!cfg || !HASH.test(sourceId)) { pending({ sourceId, depth: 0 }, 'current_scope_unproven'); return result }
  const queue: Node[] = [{ sourceId, depth: 0 }], seen = new Set<string>(), scheduled = new Set([sourceId]), targets = new Map<string, MaintenanceRecordTarget>(), frontiers = new Map<string, Awaited<ReturnType<typeof bounded>>>()
  while (queue.length) {
    const node = queue.shift()!; if (seen.has(node.sourceId)) continue
    if (seen.size >= MAX_SOURCES) { pending(node, 'source_budget_requires_review'); continue }
    seen.add(node.sourceId); result.visitedSourceIds.push(node.sourceId)
    const source = await env.PIPELINE_DB.prepare(`SELECT s.source_id,s.url,s.raw_sha256,s.allowed_hosts_json FROM maintenance_sources s WHERE s.source_id=? AND s.enabled=1 AND EXISTS(SELECT 1 FROM maintenance_source_schools own JOIN maintenance_source_schools root ON root.university_id=own.university_id AND root.source_id=? JOIN maintenance_schools u ON u.university_id=own.university_id AND u.scope_sha256=? WHERE own.source_id=s.source_id)`).bind(node.sourceId, sourceId, cfg.scope_sha256).first<Source>()
    if (!source || await digest(source.url) !== node.sourceId) { pending(node, 'same_scope_school_unproven'); continue }
    if (node.child) {
      const frontierSha256 = node.frontierSha256
      if (!frontierSha256 || !HASH.test(frontierSha256)) { pending(node, 'frontier_receipt_unavailable'); continue }
      if (!frontiers.has(frontierSha256)) {
        if (frontiers.size >= MAX_FRONTIERS) { pending(node, 'frontier_budget_requires_review'); continue }
        frontiers.set(frontierSha256, await bounded(env, `maintenance/frontiers/${frontierSha256}.json`))
      }
      const saved = frontiers.get(frontierSha256)
      if (!saved || saved.oversized || saved.sha256 !== frontierSha256) { pending(node, 'frontier_receipt_invalid'); continue }
      let frontier: Record<string, unknown> | null
      try { frontier = record(JSON.parse(saved.text)) } catch { frontier = null }
      if (!frontier || frontier.version !== 1 || frontier.sourceId !== node.sourceId || frontier.sourceUrl !== source.url || frontier.rawSha256 !== source.raw_sha256 || !Array.isArray(frontier.links) || !frontier.links.some(link => record(link)?.url === node.child!.url)) { pending(node, 'frontier_edge_or_snapshot_unproven'); continue }
      try { assertSafeSourceUrl(node.child.url, JSON.parse(source.allowed_hosts_json) as string[]) } catch { pending(node, 'frontier_host_unproven'); continue }
    }
    const rows = (await env.PIPELINE_DB.prepare(`SELECT t.target_id,t.record_scope_sha256,t.university_id,t.target_json FROM maintenance_record_targets t JOIN maintenance_target_sources x ON x.target_id=t.target_id JOIN maintenance_source_schools own ON own.source_id=x.source_id AND own.university_id=t.university_id JOIN maintenance_source_schools root ON root.source_id=? AND root.university_id=t.university_id JOIN maintenance_schools u ON u.university_id=t.university_id AND u.scope_sha256=? WHERE x.source_id=? AND t.active=1 ORDER BY t.target_id`).bind(sourceId, cfg.scope_sha256, node.sourceId).all<{ target_id: string; record_scope_sha256: string; university_id: string; target_json: string }>()).results ?? []
    for (const row of rows) {
      const target = maintenanceRecordTargetSchema.parse(JSON.parse(row.target_json)), id = `${target.entityType}:${target.recordId}`
      if (row.target_id !== id || row.record_scope_sha256 !== target.recordScopeSha256 || row.university_id !== target.universityId || !target.sourceIds.includes(node.sourceId)) throw new MaintenanceError('source_target_binding_invalid')
      if (node.depth && target.entityType !== 'program' || targets.has(id)) continue
      targets.set(id, node.depth ? { ...target, sourceIds: [...new Set([...target.sourceIds, sourceId])] } : target)
    }
    const saved = await bounded(env, `maintenance/discovery-lineage/${node.sourceId}.json`)
    if (!saved) continue
    if (saved.oversized) { pending(node, 'lineage_size_requires_review'); continue }
    const ref = { objectKey: saved.objectKey, sha256: saved.sha256 }; result.lineageRefs.push(ref)
    let lineage: Record<string, unknown> | null
    try { lineage = record(JSON.parse(saved.text)) } catch { lineage = null }
    if (!lineage || lineage.version !== 1 || lineage.sourceId !== node.sourceId || !Array.isArray(lineage.parents) || lineage.parents.some(id => typeof id !== 'string' || !HASH.test(id))) { pending(node, 'lineage_invalid', { lineage: ref }); continue }
    const parents = [...new Set(lineage.parents as string[])].sort()
    if (parents.length > MAX_PARENTS) { pending(node, 'parent_list_requires_review', { lineage: ref, unprocessedParents: parents.length }); continue }
    const receipts = record(lineage.parentFrontiers)
    for (const parent of parents) {
      if (seen.has(parent) || scheduled.has(parent)) continue
      const next: Node = { sourceId: parent, depth: node.depth + 1, child: { sourceId: node.sourceId, url: source.url }, lineage: ref,
        frontierSha256: typeof receipts?.[parent] === 'string' ? receipts[parent] as string : typeof lineage.frontierSha256 === 'string' ? lineage.frontierSha256 : undefined }
      if (node.depth >= MAX_DEPTH) { pending(next, 'depth_budget_requires_review'); continue }
      if (scheduled.size >= MAX_SOURCES) { pending(next, 'source_budget_requires_review'); continue }
      scheduled.add(parent); queue.push(next)
    }
  }
  const current = await env.PIPELINE_DB.prepare('SELECT scope_sha256,input_catalog_sha256,revision FROM maintenance_control WHERE singleton=1').first<typeof cfg>()
  if (!current || current.scope_sha256 !== cfg.scope_sha256 || current.input_catalog_sha256 !== cfg.input_catalog_sha256 || current.revision !== cfg.revision) pending({ sourceId, depth: 0 }, 'control_changed')
  else result.targets = [...targets.values()].sort((a, b) => `${a.entityType}:${a.recordId}`.localeCompare(`${b.entityType}:${b.recordId}`))
  result.complete = result.pendingEdges.length === 0; return result
}

export async function retainTargetGraphHold(env: MaintenanceEnv, graph: RecordTargetGraph, rawSha256: string) {
  if (graph.complete) return
  const text = canonical({ format: 'studyinchina.source-target-lineage-hold', version: 1, sourceId: graph.sourceId, snapshotSha256: rawSha256,
    scopeSha256: graph.scopeSha256, inputCatalogSha256: graph.inputCatalogSha256, visitedSourceIds: graph.visitedSourceIds,
    pendingEdges: graph.pendingEdges, lineageRefs: graph.lineageRefs, candidateTargetCount: graph.targets.length, catalogueComplete: false, applicabilityEstablished: false }), sha256 = await digest(text), objectKey = `maintenance/target-lineage-holds/${sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(objectKey, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const stored = await env.SNAPSHOTS_BUCKET.get(objectKey)
  if (!stored || await digest(await stored.text()) !== sha256) throw new MaintenanceError('source_target_hold_readback_invalid')
  await env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_events VALUES(?,?,?,?)').bind(`source-target-lineage-held:${sha256}`, 'source_target_lineage_held', new Date().toISOString(), canonical({ objectKey, sha256, sourceId: graph.sourceId, pendingEdges: graph.pendingEdges.length, catalogueComplete: false, applicabilityEstablished: false })).run()
}
