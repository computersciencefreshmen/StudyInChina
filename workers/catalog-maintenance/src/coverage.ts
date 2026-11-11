import { z } from 'zod'
import { canonical, digest, nowIso } from './util'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { getTodayDate } from '../../../src/lib/data/freshness'

export const coverageBand = (count: number) => count === 0 ? 'zero' : count === 1 ? 'one' : count < 5 ? 'two-to-four' : 'five-plus'
export const schoolCoverageSchema = z.object({
  universityId: z.string().min(1), rawProgramCount: z.number().int().nonnegative(), directoryProgramCount: z.number().int().nonnegative(),
  currentProgramCount: z.number().int().nonnegative(), minimumProgramCount: z.literal(5), gap: z.number().int().min(0).max(5),
  coverageBand: z.enum(['zero', 'one', 'two-to-four', 'five-plus']), countedProgramIds: z.array(z.string().min(1)).max(10000),
  directoryScholarshipCount: z.number().int().nonnegative(), currentScholarshipCount: z.number().int().nonnegative(),
  reviewAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
}).strict().superRefine((row, ctx) => {
  if (row.currentProgramCount !== row.countedProgramIds.length || new Set(row.countedProgramIds).size !== row.countedProgramIds.length
    || row.gap !== Math.max(0, 5 - row.currentProgramCount) || row.coverageBand !== coverageBand(row.currentProgramCount))
    ctx.addIssue({ code: 'custom', message: 'Coverage counts must match distinct concrete programme identities' })
})
export const coverageSnapshotSchema = z.object({
  format: z.literal('studyinchina.school-program-coverage'), version: z.literal(1),
  scopeRegistrySha256: z.string().regex(/^[a-f0-9]{64}$/u), inputCatalogSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  evaluatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), schools: z.array(schoolCoverageSchema).min(1).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()
export type CoverageSnapshot = z.infer<typeof coverageSnapshotSchema>
export type SchoolCoverage = z.infer<typeof schoolCoverageSchema>

export async function validateCoverageSnapshot(value: unknown, binding: { scopeRegistrySha256: string; inputCatalogSha256: string; schoolIds: Set<string>; today: string }) {
  const snapshot = coverageSnapshotSchema.parse(value), { sha256, ...content } = snapshot
  if (await digest(canonical(content)) !== sha256 || snapshot.scopeRegistrySha256 !== binding.scopeRegistrySha256
    || snapshot.inputCatalogSha256 !== binding.inputCatalogSha256 || snapshot.evaluatedOn !== binding.today
    || snapshot.schools.length !== binding.schoolIds.size || new Set(snapshot.schools.map(s => s.universityId)).size !== binding.schoolIds.size
    || snapshot.schools.some(s => !binding.schoolIds.has(s.universityId))) throw new MaintenanceError('coverage_snapshot_binding_invalid')
  return snapshot
}

/** Content-addressed evidence is visible only through a matching catalog/date event. */
export async function storeCoverageSnapshot(env: MaintenanceEnv, snapshot: CoverageSnapshot) {
  const key = `maintenance/coverage/${snapshot.sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(key, canonical(snapshot), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  return key
}
export async function readCoverageSnapshot(env: MaintenanceEnv, catalog: string, scope: string, now = Date.now()): Promise<CoverageSnapshot | null> {
  const pointer = await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='coverage_snapshot' AND json_extract(details_json,'$.inputCatalogSha256')=? AND json_extract(details_json,'$.scopeRegistrySha256')=? ORDER BY observed_at DESC,event_id DESC LIMIT 1")
    .bind(catalog, scope).first<{ details_json: string }>()
  if (!pointer) return null
  try {
    const ref = JSON.parse(pointer.details_json), object = await env.SNAPSHOTS_BUCKET.get(`maintenance/coverage/${ref.sha256}.json`)
    if (!object || object.size !== undefined && object.size > 2 * 1024 * 1024) return null
    const value = coverageSnapshotSchema.parse(JSON.parse(await object.text())), { sha256, ...content } = value
    if (value.sha256 !== ref.sha256 || await digest(canonical(content)) !== sha256 || value.inputCatalogSha256 !== catalog
      || value.scopeRegistrySha256 !== scope || value.evaluatedOn !== getTodayDate(new Date(now))) return null
    return value
  } catch { return null }
}
export function coverageEvent(snapshot: CoverageSnapshot) {
  return { sha256: snapshot.sha256, scopeRegistrySha256: snapshot.scopeRegistrySha256, inputCatalogSha256: snapshot.inputCatalogSha256, evaluatedOn: snapshot.evaluatedOn }
}
export async function publishCoverageSnapshot(env: MaintenanceEnv, snapshot: CoverageSnapshot, now = Date.now()) {
  await storeCoverageSnapshot(env, snapshot)
  await env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(), 'coverage_snapshot', nowIso(now), canonical(coverageEvent(snapshot))).run()
}

/** Daily refresh is metadata only; it never rewrites the 4k+ record targets. */
export async function submitCoverageSnapshot(env: MaintenanceEnv, value: unknown, now = Date.now()) {
  const cfg = await env.PIPELINE_DB.prepare('SELECT scope_sha256,input_catalog_sha256,revision,seed_complete,targets_complete FROM maintenance_control WHERE singleton=1')
    .first<{ scope_sha256: string; input_catalog_sha256: string; revision: number; seed_complete: number; targets_complete: number }>()
  if (!cfg?.seed_complete || !cfg.targets_complete || cfg.scope_sha256 !== env.SCOPE_REGISTRY_SHA256) throw new MaintenanceError('coverage_control_not_ready')
  const rows = (await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools WHERE scope_sha256=?').bind(cfg.scope_sha256).all<{ university_id: string }>()).results ?? []
  const snapshot = await validateCoverageSnapshot(value, { scopeRegistrySha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256,
    schoolIds: new Set(rows.map(row => row.university_id)), today: getTodayDate(new Date(now)) })
  const current = await readCoverageSnapshot(env, cfg.input_catalog_sha256, cfg.scope_sha256, now)
  if (current?.sha256 === snapshot.sha256) return { ok: true, reused: true, coverageSnapshotSha256: snapshot.sha256 }
  await storeCoverageSnapshot(env, snapshot)
  const saved = await env.PIPELINE_DB.prepare("INSERT INTO maintenance_events(event_id,kind,observed_at,details_json) SELECT ?,'coverage_snapshot',?,? WHERE EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND revision=? AND seed_complete=1 AND targets_complete=1)")
    .bind(crypto.randomUUID(), nowIso(now), canonical(coverageEvent(snapshot)), cfg.scope_sha256, cfg.input_catalog_sha256, cfg.revision).run()
  if (saved.meta?.changes !== 1) throw new MaintenanceError('coverage_control_changed')
  return { ok: true, reused: false, coverageSnapshotSha256: snapshot.sha256 }
}
