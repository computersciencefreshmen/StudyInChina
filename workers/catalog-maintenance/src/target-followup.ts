import { z } from 'zod'
import { maintenanceRecordTargetSchema, type MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import type { Control, MaintenanceEnv, SourceRow } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, record } from './util'
import { runtimeModelNoReplayReason } from './runtime-model-guards'
import { legacyModelNoReplayReason } from './legacy-model-guards'
import { noReplayReason } from './reviewed-terminal-quarantine'

const PREFIX = 'maintenance/target-followup/', KIND = 'target_followup_ready', DAY = 86400000
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const pinSchema = z.object({ id: z.string().min(3).max(550), sha256: hash }).strict()
const groupSchema = z.object({ universityId: z.string().min(1), sourceId: hash, pins: z.array(pinSchema).min(1).max(20) }).strict()
const planSchema = z.object({ format: z.literal('studyinchina.target-followup-plan'), version: z.literal(1), refreshSha256: hash,
  scopeSha256: hash, inputCatalogSha256: hash, seedSha256: hash, legacyGuardSha256: hash, groups: z.array(groupSchema).max(2048) }).strict()
export type TargetFollowupPlan = z.infer<typeof planSchema>
export type FollowupRef = { sha256: string; objectKey: string }
type EventRef = FollowupRef & { refreshSha256: string; refreshPlanSha256: string }
export type FollowupQueueScope = { scopeSha256: string; inputCatalogSha256: string; seedSha256: string; legacyGuardSha256: string;
  revision: number; observationId: string; checkedAt: string; pins: z.infer<typeof pinSchema>[] }
const stateSchema = z.object({ format: z.literal('studyinchina.target-followup-progress'), version: z.literal(1), planSha256: hash,
  next: z.number().int().nonnegative(), done: z.array(z.number().int().nonnegative()).max(2048) }).strict()
const fail = (code: string): never => { throw new MaintenanceError(`target_followup_${code}`) }
const key = (sha: string) => `${PREFIX}plans/${sha}.json`
const eventId = (sha: string) => `target-followup:${sha}`
async function text(env: MaintenanceEnv, objectKey: string, max: number) {
  const object = await env.SNAPSHOTS_BUCKET.get(objectKey)
  if (!object || object.size !== undefined && object.size > max) return fail('artifact_unavailable')
  const value = await object.text(); if (new TextEncoder().encode(value).length > max) return fail('artifact_oversized')
  return { object, value }
}
async function latest(env: MaintenanceEnv) {
  const row = await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='target_followup_ready' ORDER BY observed_at DESC,event_id DESC LIMIT 1").first<{ details_json: string }>()
  if (!row) return null
  const ref = record(JSON.parse(row.details_json)) as EventRef | null
  if (!ref || !HASH.test(ref.sha256) || !HASH.test(ref.refreshSha256) || !HASH.test(ref.refreshPlanSha256) || ref.objectKey !== key(ref.sha256)) return fail('event_invalid')
  const saved = await text(env, ref.objectKey, 2 * 1024 * 1024)
  if (await digest(saved.value) !== ref.sha256) return fail('plan_checksum_invalid')
  const plan = planSchema.parse(JSON.parse(saved.value))
  if (canonical(plan) !== saved.value || plan.refreshSha256 !== ref.refreshSha256) return fail('plan_binding_invalid')
  const refresh = await env.PIPELINE_DB.prepare('SELECT status,plan_sha256,input_catalog_sha256 FROM maintenance_target_refreshes WHERE refresh_sha256=?').bind(ref.refreshSha256).first<{ status: string; plan_sha256: string; input_catalog_sha256: string }>()
  if (!refresh || refresh.status !== 'completed' || refresh.plan_sha256 !== ref.refreshPlanSha256 || refresh.input_catalog_sha256 !== plan.inputCatalogSha256) return fail('refresh_not_committed')
  const progress = await env.SNAPSHOTS_BUCKET.get(`${PREFIX}progress/${ref.sha256}.json`)
  if (progress && (!progress.etag || progress.size !== undefined && progress.size > 64 * 1024)) return fail('progress_invalid')
  const progressText = progress ? await progress.text() : null
  if (progressText && new TextEncoder().encode(progressText).length > 64 * 1024) return fail('progress_invalid')
  const state = progressText ? stateSchema.parse(JSON.parse(progressText)) : { format: 'studyinchina.target-followup-progress' as const, version: 1 as const, planSha256: ref.sha256, next: 0, done: [] }
  if (state.planSha256 !== ref.sha256 || state.next >= Math.max(1, plan.groups.length) || new Set(state.done).size !== state.done.length || state.done.some(n => n >= plan.groups.length)) return fail('progress_invalid')
  return { ref, plan, state, etag: progress?.etag }
}

/** Once per metadata refresh, never a per-request full-history scan. Only new
 * identities/scopes/source bindings and still-unfinished prior increments enter. */
export async function prepareTargetFollowup(env: MaintenanceEnv, cfg: Control, targets: MaintenanceRecordTarget[], sourceIds: Set<string>, refreshSha256: string): Promise<FollowupRef | null> {
  const previous = (await env.PIPELINE_DB.prepare('SELECT target_json FROM maintenance_record_targets WHERE active=1').all<{ target_json: string }>()).results ?? []
  const old = new Map(previous.map(row => { const t = maintenanceRecordTargetSchema.parse(JSON.parse(row.target_json)); return [`${t.entityType}:${t.recordId}`, t] }))
  const current = new Map(targets.map(t => [`${t.entityType}:${t.recordId}`, t])), pending = new Map<string, { universityId: string; sourceId: string; pins: Map<string, string> }>()
  const add = (t: MaintenanceRecordTarget, sourceId: string) => { if (!sourceIds.has(sourceId)) return; const id = `${t.entityType}:${t.recordId}`, groupId = `${t.universityId}:${sourceId}`, group = pending.get(groupId) ?? { universityId: t.universityId, sourceId, pins: new Map<string, string>() }; group.pins.set(id, t.recordScopeSha256); pending.set(groupId, group) }
  for (const t of targets) { const prior = old.get(`${t.entityType}:${t.recordId}`); for (const sourceId of t.sourceIds) if (!prior || prior.recordScopeSha256 !== t.recordScopeSha256 || !prior.sourceIds.includes(sourceId)) add(t, sourceId) }
  const prior = await latest(env)
  if (prior?.plan.scopeSha256 === cfg.scope_sha256 && prior.plan.seedSha256 === cfg.seed_sha256 && prior.plan.legacyGuardSha256 === cfg.legacy_guard_sha256) {
    const done = new Set(prior.state.done)
    for (const [index, group] of prior.plan.groups.entries()) if (!done.has(index)) for (const pin of group.pins) {
      const t = current.get(pin.id); if (t && t.recordScopeSha256 === pin.sha256 && t.universityId === group.universityId && t.sourceIds.includes(group.sourceId)) add(t, group.sourceId)
    }
  }
  const schools = new Map<string, Array<z.infer<typeof groupSchema>>>()
  for (const group of [...pending.values()].sort((a, b) => a.universityId.localeCompare(b.universityId) || a.sourceId.localeCompare(b.sourceId))) {
    const pins = [...group.pins].sort(([a], [b]) => a.localeCompare(b)).map(([id, sha256]) => ({ id, sha256 })), list = schools.get(group.universityId) ?? []
    for (let i = 0; i < pins.length; i += 20) list.push({ universityId: group.universityId, sourceId: group.sourceId, pins: pins.slice(i, i + 20) })
    schools.set(group.universityId, list)
  }
  const groups: TargetFollowupPlan['groups'] = []; for (;;) { let added = false; for (const list of schools.values()) { const group = list.shift(); if (group) { groups.push(group); added = true } }; if (!added) break }
  if (!groups.length) return null
  const plan = planSchema.parse({ format: 'studyinchina.target-followup-plan', version: 1, refreshSha256, scopeSha256: cfg.scope_sha256,
    inputCatalogSha256: cfg.input_catalog_sha256, seedSha256: cfg.seed_sha256, legacyGuardSha256: cfg.legacy_guard_sha256, groups })
  const body = canonical(plan), sha256 = await digest(body), objectKey = key(sha256)
  await env.SNAPSHOTS_BUCKET.put(objectKey, body, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  if ((await text(env, objectKey, 2 * 1024 * 1024)).value !== body) return fail('plan_readback_invalid')
  return { sha256, objectKey }
}
export function targetFollowupEvent(ref: FollowupRef, refreshSha256: string, refreshPlanSha256: string) {
  if (!HASH.test(ref.sha256) || ref.objectKey !== key(ref.sha256)) return fail('reference_invalid')
  return { id: eventId(refreshSha256), kind: KIND, details: canonical({ ...ref, refreshSha256, refreshPlanSha256 }) }
}
type QueueFollowup = (row: SourceRow, snapshotSha256: string, snapshotKey: string, scope: FollowupQueueScope) => Promise<void>

/** Creates durable existing jobs only. The ordinary scheduler alone sends them,
 * preserving its job bound, two lanes, school fairness and model admission. */
export async function seedTargetFollowupJobs(env: MaintenanceEnv, cfg: Control, queue: QueueFollowup, now = Date.now()) {
  if (env.MAINTENANCE_ENABLED !== 'true' || !cfg.enabled || !cfg.models_enabled || !cfg.seed_complete || !cfg.targets_complete) return { sources: 0, pending: 0 }
  const pending = await latest(env); if (!pending) return { sources: 0, pending: 0 }
  const { plan, ref, state } = pending
  if (plan.scopeSha256 !== cfg.scope_sha256 || plan.inputCatalogSha256 !== cfg.input_catalog_sha256 || plan.seedSha256 !== cfg.seed_sha256 || plan.legacyGuardSha256 !== cfg.legacy_guard_sha256) return { sources: 0, pending: plan.groups.length - state.done.length }
  if (state.done.length === plan.groups.length) return { sources: 0, pending: 0 }
  const done = new Set(state.done), canary = JSON.parse(cfg.canary_json) as string[], used = new Set<string>(); let next = state.next, scanned = 0, sources = 0
  while (scanned < Math.min(32, plan.groups.length) && used.size < 8) {
    const index = next; next = (next + 1) % plan.groups.length; scanned++
    const group = plan.groups[index]; if (done.has(index) || used.has(group.sourceId) || canary.length && !canary.includes(group.universityId)) continue
    used.add(group.sourceId)
    const row = await env.PIPELINE_DB.prepare('SELECT s.* FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id JOIN maintenance_schools u ON u.university_id=x.university_id WHERE s.source_id=? AND x.university_id=? AND u.scope_sha256=? AND s.enabled=1').bind(group.sourceId, group.universityId, cfg.scope_sha256).first<SourceRow>()
    if (!row?.raw_sha256 || !row.snapshot_key || row.failures || row.error_code || !row.last_success_at) continue
    const checked = Date.parse(row.last_success_at)
    if (!Number.isFinite(checked) || checked > now || now - checked > DAY || row.snapshot_key !== `maintenance/snapshots/${row.source_id}/${row.raw_sha256}.json`) continue
    const observation = await env.PIPELINE_DB.prepare('SELECT observation_id,checked_at FROM maintenance_observations WHERE source_id=? AND raw_sha256=? AND snapshot_key=? AND http_status BETWEEN 200 AND 299 ORDER BY checked_at DESC,observation_id DESC LIMIT 1').bind(row.source_id, row.raw_sha256, row.snapshot_key).first<{ observation_id: string; checked_at: string }>()
    if (observation?.checked_at !== row.last_success_at) continue
    const uncertain = await env.PIPELINE_DB.prepare("SELECT 1 found FROM maintenance_model_attempts WHERE source_id=? AND status IN('unknown','reserved','send_started') UNION ALL SELECT 1 FROM maintenance_jobs WHERE source_id=? AND snapshot_sha256=? AND status='unknown' LIMIT 1").bind(row.source_id,row.source_id,row.raw_sha256).first()
    if (uncertain) continue
    const saved = await text(env, row.snapshot_key, 2 * 1024 * 1024), snapshot = record(JSON.parse(saved.value))
    if (!snapshot || snapshot.version !== 1 || snapshot.sourceId !== row.source_id || snapshot.sourceUrl !== row.url || snapshot.rawSha256 !== row.raw_sha256 || snapshot.rawKey !== `maintenance/snapshots/${row.source_id}/${row.raw_sha256}.bin` || typeof snapshot.finalUrl !== 'string') return fail('snapshot_binding_invalid')
    const hosts = JSON.parse(row.allowed_hosts_json) as string[]; assertSafeSourceUrl(row.url, hosts); assertSafeSourceUrl(snapshot.finalUrl, hosts)
    const derived = await env.PIPELINE_DB.prepare('SELECT text_key,text_sha256 FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=? AND snapshot_key=? AND raw_key=?').bind(row.source_id, row.raw_sha256, row.snapshot_key, snapshot.rawKey).first<{ text_key: string; text_sha256: string }>()
    const textKey = derived?.text_key ?? snapshot.textKey, textSha = derived?.text_sha256 ?? snapshot.textSha256
    if (typeof textKey !== 'string' || !textKey.startsWith('maintenance/') || textKey.includes('..') || typeof textSha !== 'string' || !HASH.test(textSha) || row.canonical_sha256 !== textSha) continue
    const raw = await env.SNAPSHOTS_BUCKET.get(String(snapshot.rawKey)), official = await env.SNAPSHOTS_BUCKET.get(textKey)
    if (!raw || !official || raw.size !== undefined && raw.size > 10 * 1024 * 1024 || official.size !== undefined && official.size > 2 * 1024 * 1024) continue
    const rawBytes = await raw.arrayBuffer(), textBytes = await official.arrayBuffer()
    if (!rawBytes.byteLength || rawBytes.byteLength > 10 * 1024 * 1024 || textBytes.byteLength > 2 * 1024 * 1024 || await digest(rawBytes) !== row.raw_sha256 || await digest(textBytes) !== textSha) return fail('snapshot_checksum_invalid')
    const request = { sourceId: row.source_id, snapshotSha256: row.raw_sha256, reservationKey: 'target-followup', payload: '', pass: 'primary' as const, lane: 'maintenance' as const, universityIds: [group.universityId] }
    if (await runtimeModelNoReplayReason(env, request) || await legacyModelNoReplayReason(env, request, row) || await noReplayReason(env, request, row)) continue
    await queue(row, row.raw_sha256, row.snapshot_key, { scopeSha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256,
      seedSha256: cfg.seed_sha256, legacyGuardSha256: cfg.legacy_guard_sha256, revision: cfg.revision, observationId: observation.observation_id, checkedAt: observation.checked_at, pins: group.pins })
    done.add(index); sources++
  }
  const stateKey = `${PREFIX}progress/${ref.sha256}.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await env.SNAPSHOTS_BUCKET.get(stateKey), existing = current ? stateSchema.parse(JSON.parse(await current.text())) : null
    if (current && (!current.etag || current.size !== undefined && current.size > 64 * 1024) || existing && (existing.planSha256 !== ref.sha256 || existing.next >= plan.groups.length || new Set(existing.done).size !== existing.done.length || existing.done.some(n => n >= plan.groups.length))) return fail('progress_invalid')
    const merged = [...new Set([...done, ...(existing?.done ?? [])])].sort((a, b) => a - b)
    const value = canonical({ format: 'studyinchina.target-followup-progress', version: 1, planSha256: ref.sha256, next, done: merged })
    const result = await env.SNAPSHOTS_BUCKET.put(stateKey, value, { onlyIf: current?.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
    if (result !== null) return { sources, pending: plan.groups.length - merged.length }
  }
  return fail('progress_conflict')
}
