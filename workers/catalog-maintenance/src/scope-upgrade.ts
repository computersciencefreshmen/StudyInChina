import { maintenanceScopeSchema, scopeContentSha256, type MaintenanceScope } from '../../../scripts/maintenance/contracts'
import { control, refreshTargets, setControls, type SeedSchool, validateSeed } from './repository'
import { maintenanceRecordTargetSchema, type MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import { isDailyD1QuotaError } from './backend-errors'
import { coalesceOperations, type SqlOperation } from './sql-plan'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { expectedScopeSchoolCount } from './scope-config'
import { canonical, digest, HASH, nowIso, record } from './util'

export type ScopeUpgrade = {
  format: 'studyinchina.maintenance-scope-upgrade'; version: 1; expectedRevision: number;
  inputCatalogSha256: string; legacyGuardSha256: string;
  previousScope: MaintenanceScope; nextScope: MaintenanceScope; recordTargets?: MaintenanceRecordTarget[]
}
type UpgradeRow = {
  upgrade_sha256: string; previous_scope_sha256: string; next_scope_sha256: string;
  paused_revision: number; input_catalog_sha256: string; legacy_guard_sha256: string;
  plan_key: string; plan_sha256: string; total_operations: number; completed_operations: number;
  status: 'staged' | 'completed'; receipt_key: string | null; receipt_sha256: string | null
  original_enabled: number; original_models_enabled: number
}
const uploadKey = (hash: string) => `maintenance/scope-upgrades/uploads/${hash}.json`
const PENDING = 'maintenance/scope-upgrades/pending.json'
const handoffKey = (hash: string) => `maintenance/scope-upgrades/handed-off/${hash}.json`
type PendingUpgrade = { format: string; version: number; upgradeSha256: string; expectedRevision?: number | null;
  inputCatalogSha256?: string | null; previousScopeSha256?: string | null; nextScopeSha256?: string | null }
// Exactly migration 0021, not an arbitrary SQL execution endpoint. A Queue may
// install this one additive table after a shared daily allowance recovers.
export const SCOPE_UPGRADE_SCHEMA = `CREATE TABLE IF NOT EXISTS maintenance_scope_upgrades (
  upgrade_sha256 TEXT PRIMARY KEY, previous_scope_sha256 TEXT NOT NULL,
  next_scope_sha256 TEXT NOT NULL UNIQUE, expected_revision INTEGER NOT NULL,
  paused_revision INTEGER NOT NULL, input_catalog_sha256 TEXT NOT NULL,
  legacy_guard_sha256 TEXT NOT NULL, original_canary_json TEXT NOT NULL,
  original_enabled INTEGER NOT NULL CHECK(original_enabled IN(0,1)),
  original_models_enabled INTEGER NOT NULL CHECK(original_models_enabled IN(0,1)),
  plan_key TEXT NOT NULL, plan_sha256 TEXT NOT NULL, total_operations INTEGER NOT NULL,
  completed_operations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN('staged','completed')),
  receipt_key TEXT, receipt_sha256 TEXT, created_at TEXT NOT NULL
);`
const idleFence = "NOT EXISTS(SELECT 1 FROM maintenance_exports WHERE status IN('prepared','applied')) AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE status='running') AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status IN('reserved','send_started'))"

export async function validateScopeUpgrade(value: unknown): Promise<ScopeUpgrade> {
  const raw = record(value)
  if (!raw || raw.format !== 'studyinchina.maintenance-scope-upgrade' || raw.version !== 1
    || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 0
    || !HASH.test(String(raw.inputCatalogSha256)) || !HASH.test(String(raw.legacyGuardSha256))) throw new MaintenanceError('scope_upgrade_invalid')
  const previousScope = maintenanceScopeSchema.parse(raw.previousScope), nextScope = maintenanceScopeSchema.parse(raw.nextScope)
  if (previousScope.formatVersion !== 1 || nextScope.formatVersion !== 2
    || previousScope.sha256 !== await scopeContentSha256(previousScope)
    || nextScope.sha256 !== await scopeContentSha256(nextScope)
    || nextScope.parentScopeSha256 !== previousScope.sha256) throw new MaintenanceError('scope_upgrade_registry_binding_invalid')
  // Preserve exact old host/source registrations, not merely their school IDs.
  for (const school of previousScope.schools) {
    const next = nextScope.schools.find(row => row.universityId === school.universityId)
    if (!next || canonical(next) !== canonical(school)) throw new MaintenanceError('scope_upgrade_original_school_changed')
  }
  // Reuse the producer's source-host and registration validation; no legacy
  // guards are replaced or reimported by this operation.
  if (raw.recordTargets !== undefined && (!Array.isArray(raw.recordTargets) || raw.recordTargets.length > 10000)) throw new MaintenanceError('scope_upgrade_targets_invalid')
  const recordTargets = raw.recordTargets === undefined ? undefined : (raw.recordTargets as unknown[]).map(value => maintenanceRecordTargetSchema.parse(value))
  validateSeed({ scopeRegistrySha256: nextScope.sha256, inputCatalogSha256: raw.inputCatalogSha256,
    schools: nextScope.schools, legacyGuards: { artifactSha256: raw.legacyGuardSha256, entries: [] }, recordTargets })
  return { format: raw.format, version: 1, expectedRevision: Number(raw.expectedRevision),
    inputCatalogSha256: String(raw.inputCatalogSha256), legacyGuardSha256: String(raw.legacyGuardSha256), previousScope, nextScope,
    ...(recordTargets ? { recordTargets } : {}) }
}

/** Keep the Free HTTP CPU path bounded; checksum/schema validation runs in Queue. */
export async function registerScopeUpgradeRequest(env: MaintenanceEnv, request: Request) {
  const hash = request.headers.get('x-maintenance-upgrade-sha256') ?? '', length = request.headers.get('content-length') ?? ''
  if (!HASH.test(hash) || !/^[1-9]\d*$/u.test(length) || Number(length) > 8 * 1024 * 1024
    || !request.headers.get('content-type')?.includes('application/json') || !request.body) throw new MaintenanceError('scope_upgrade_upload_invalid')
  const key = uploadKey(hash)
  await env.SNAPSHOTS_BUCKET.put(key, request.body, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const expected = request.headers.get('x-maintenance-expected-revision'), previous = request.headers.get('x-maintenance-previous-scope-sha256'), input = request.headers.get('x-maintenance-input-catalog-sha256')
  const metadata: PendingUpgrade = { format: 'studyinchina.pending-scope-upgrade', version: 1, upgradeSha256: hash,
    expectedRevision: expected !== null && /^(?:0|[1-9]\d*)$/u.test(expected) ? Number(expected) : null,
    inputCatalogSha256: input && HASH.test(input) ? input : null, previousScopeSha256: previous && HASH.test(previous) ? previous : null,
    nextScopeSha256: env.SCOPE_REGISTRY_SHA256 ?? null }
  let pointer = canonical(metadata)
  const priorObject = await env.SNAPSHOTS_BUCKET.get(PENDING), priorText = priorObject ? await priorObject.text() : null
  const prior = priorText ? JSON.parse(priorText) as PendingUpgrade : null
  if (prior && prior.upgradeSha256 !== hash) {
    if (request.headers.get('x-maintenance-supersedes-sha256') !== prior.upgradeSha256 || !priorObject?.etag) throw new MaintenanceError('scope_upgrade_pending_upload_conflict')
    const proof = await supersedeProof(env, prior)
    if (!proof.allow || metadata.expectedRevision !== proof.revision || metadata.inputCatalogSha256 !== proof.inputCatalogSha256
      || metadata.previousScopeSha256 !== prior.previousScopeSha256 || metadata.nextScopeSha256 !== prior.nextScopeSha256) throw new MaintenanceError('scope_upgrade_supersede_not_proven')
    await env.SNAPSHOTS_BUCKET.put(`maintenance/scope-upgrades/superseded/${prior.upgradeSha256}/${hash}.json`,
      canonical({ oldUpgradeSha256: prior.upgradeSha256, newUpgradeSha256: hash, proof, outcome: 'unstaged_automatic_head_change' }), { onlyIf: { etagDoesNotMatch: '*' } })
    await env.SNAPSHOTS_BUCKET.put(PENDING, pointer, { onlyIf: { etagMatches: priorObject.etag }, httpMetadata: { contentType: 'application/json' } })
  } else if (priorText) pointer = priorText
  else await env.SNAPSHOTS_BUCKET.put(PENDING, pointer, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const saved = await env.SNAPSHOTS_BUCKET.get(PENDING)
  if (!saved || await saved.text() !== pointer) throw new MaintenanceError('scope_upgrade_pending_upload_conflict')
  // A lost dispatch is recovered by the existing cloud tick, from the same R2 intent.
  await env.MAINTENANCE_QUEUE.send({ version: 1, jobId: hash, scopeUpgradeSha256: hash }).catch(() => undefined)
  return { ok: true, pending: true, validation: 'pending-queue', upgradeSha256: hash, modelCallsPerformed: false }
}

export async function resumePendingScopeUpgrade(env: MaintenanceEnv): Promise<boolean> {
  const object = await env.SNAPSHOTS_BUCKET.get(PENDING)
  if (!object) return false
  const pointer = record(JSON.parse(await object.text())), hash = String(pointer?.upgradeSha256)
  if (pointer?.format !== 'studyinchina.pending-scope-upgrade' || !HASH.test(hash)) throw new MaintenanceError('scope_upgrade_pending_pointer_invalid')
  if (await env.SNAPSHOTS_BUCKET.get(`maintenance/scope-upgrades/finished/${hash}.json`) || await env.SNAPSHOTS_BUCKET.get(handoffKey(hash))) return false
  await env.MAINTENANCE_QUEUE.send({ version: 1, jobId: hash, scopeUpgradeSha256: hash })
  return true
}

async function handOffScopeUpgrade(env: MaintenanceEnv, hash: string, reason: string, revision: number | null) {
  await env.SNAPSHOTS_BUCKET.put(handoffKey(hash), canonical({ format: 'studyinchina.scope-upgrade-manual-handoff', version: 1,
    upgradeSha256: hash, outcome: 'handed_off', reason, revision, observedAt: nowIso(), successfulUpgradeClaimed: false }), { onlyIf: { etagDoesNotMatch: '*' } })
  return { state: 'handed_off', reason }
}

async function readUpgrade(env: MaintenanceEnv, hash: string) {
  if (!HASH.test(hash)) throw new MaintenanceError('scope_upgrade_hash_invalid')
  const object = await env.SNAPSHOTS_BUCKET.get(uploadKey(hash))
  if (!object || object.size !== undefined && object.size > 8 * 1024 * 1024) throw new MaintenanceError('scope_upgrade_upload_missing')
  const text = await object.text()
  if (await digest(text) !== hash) throw new MaintenanceError('scope_upgrade_upload_checksum_invalid')
  const upgrade = await validateScopeUpgrade(JSON.parse(text)), pointer = await env.SNAPSHOTS_BUCKET.get(PENDING)
  if (pointer) {
    const pending = JSON.parse(await pointer.text()) as PendingUpgrade
    if (pending.upgradeSha256 !== hash) throw new MaintenanceError('scope_upgrade_superseded_intent')
    if (pending.expectedRevision !== null && pending.expectedRevision !== undefined && (pending.expectedRevision !== upgrade.expectedRevision
      || pending.inputCatalogSha256 !== upgrade.inputCatalogSha256 || pending.previousScopeSha256 !== upgrade.previousScope.sha256
      || pending.nextScopeSha256 !== upgrade.nextScope.sha256)) throw new MaintenanceError('scope_upgrade_upload_metadata_binding_invalid')
  }
  return upgrade
}

async function supersedeProof(env: MaintenanceEnv, pointer: PendingUpgrade) {
  const closed = { allow: false, revision: null as number | null, inputCatalogSha256: null as string | null, eventIds: [] as string[] }
  if (!Number.isSafeInteger(pointer.expectedRevision) || !pointer.inputCatalogSha256 || !pointer.previousScopeSha256) return closed
  const cfg = await control(env)
  if (!cfg || cfg.scope_sha256 !== pointer.previousScopeSha256 || cfg.revision <= Number(pointer.expectedRevision)
    || cfg.enabled !== 1 || cfg.models_enabled !== 1 || !cfg.targets_complete) return closed
  const safety = await env.PIPELINE_DB.prepare(`SELECT (SELECT COUNT(*) FROM maintenance_scope_upgrades) upgrades,(SELECT COUNT(*) FROM maintenance_schools) schools,CASE WHEN ${idleFence} THEN 1 ELSE 0 END idle`).first<{ upgrades: number; schools: number; idle: number }>()
  if (!safety || safety.upgrades !== 0 || safety.schools !== 272 || !safety.idle) return closed
  const rows = (await env.PIPELINE_DB.prepare("SELECT event_id,details_json FROM maintenance_events WHERE kind IN('control_revision_advanced','targets_refreshed','targets_revalidated') AND json_extract(details_json,'$.toRevision')>? ORDER BY json_extract(details_json,'$.fromRevision'),event_id LIMIT 100")
    .bind(pointer.expectedRevision).all<{ event_id: string; details_json: string }>()).results ?? []
  let revision = Number(pointer.expectedRevision), head = pointer.inputCatalogSha256
  const eventIds: string[] = []
  for (const row of rows) {
    const proof = record(JSON.parse(row.details_json))
    if (proof?.fromRevision !== revision) continue
    if (proof.toRevision !== revision + 1 || proof.previousInputCatalogSha256 !== undefined && proof.previousInputCatalogSha256 !== head
      || !HASH.test(String(proof.inputCatalogSha256))) return closed
    if (proof.previousInputCatalogSha256 === undefined && proof.inputCatalogSha256 !== head) return closed
    revision++; head = String(proof.inputCatalogSha256); eventIds.push(row.event_id)
  }
  return revision === cfg.revision && head === cfg.input_catalog_sha256
    ? { allow: true, revision, inputCatalogSha256: head, eventIds } : closed
}

async function insertPlan(env: MaintenanceEnv, hash: string, upgrade: ScopeUpgrade, now: number) {
  const cfg = await control(env)
  if (!cfg || cfg.scope_sha256 !== upgrade.previousScope.sha256 || cfg.revision !== upgrade.expectedRevision
    || cfg.input_catalog_sha256 !== upgrade.inputCatalogSha256 || cfg.legacy_guard_sha256 !== upgrade.legacyGuardSha256
    || !cfg.seed_complete || !cfg.targets_complete || env.SCOPE_REGISTRY_SHA256 !== upgrade.nextScope.sha256
    || expectedScopeSchoolCount(env) !== 295) throw new MaintenanceError('scope_upgrade_control_or_pin_changed')
  const oldIds = new Set(upgrade.previousScope.schools.map(school => school.universityId))
  const registered = (await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools').all<{ university_id: string }>()).results ?? []
  if (registered.length !== 272 || registered.some(row => !oldIds.has(row.university_id))) throw new MaintenanceError('scope_upgrade_previous_school_set_changed')
  const added = upgrade.nextScope.schools.filter(school => !oldIds.has(school.universityId)), operations: SqlOperation[] = []
  const schools = validateSeed({ scopeRegistrySha256: upgrade.nextScope.sha256, inputCatalogSha256: upgrade.inputCatalogSha256,
    schools: upgrade.nextScope.schools, legacyGuards: { artifactSha256: upgrade.legacyGuardSha256, entries: [] } }).schools
  const sourceRows = new Map<string, { url: string; hosts: string[]; categories: string[]; enabled: boolean }>()
  for (const addedSchool of added) {
    const school = schools.find(row => row.universityId === addedSchool.universityId) as SeedSchool
    operations.push({ sql: 'INSERT INTO maintenance_schools VALUES(?,?,?,?,NULL)', values: [school.universityId, JSON.stringify(school.name), JSON.stringify(school), upgrade.nextScope.sha256] })
    for (const source of school.sourceSeeds) {
      const id = await digest(source.url), previous = sourceRows.get(id)
      sourceRows.set(id, { url: source.url, hosts: [...new Set([...(previous?.hosts ?? []), ...source.allowedHosts])],
        categories: [...new Set([...(previous?.categories ?? []), source.sourceCategory])], enabled: Boolean(previous?.enabled || source.enabled) })
    }
  }
  const existingRows = (await env.PIPELINE_DB.prepare('SELECT source_id,url,allowed_hosts_json,categories_json,category,enabled FROM maintenance_sources WHERE source_id IN(SELECT value FROM json_each(?))')
    .bind(canonical([...sourceRows.keys()])).all<{ source_id: string; url: string; allowed_hosts_json: string; categories_json: string; category: string; enabled: number }>()).results ?? []
  const existingSources = new Map(existingRows.map(source => [source.source_id, source]))
  for (const [id, source] of sourceRows) {
    const existing = existingSources.get(id)
    if (existing) {
      const categories = existing.categories_json ? JSON.parse(existing.categories_json) as string[] : [existing.category]
      const hosts = JSON.parse(existing.allowed_hosts_json) as string[]
      if (existing.url !== source.url || source.hosts.some(host => !hosts.includes(host)) || source.categories.some(category => !categories.includes(category))
        || source.enabled && !existing.enabled) throw new MaintenanceError('scope_upgrade_shared_source_requires_review')
    } else operations.push({ sql: 'INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at) VALUES(?,?,?,?,?,?,168,?)',
      values: [id, source.url, JSON.stringify(source.hosts), source.categories[0], JSON.stringify(source.categories), source.enabled ? 1 : 0, nowIso(now)] })
  }
  for (const school of schools.filter(row => !oldIds.has(row.universityId))) {
    for (const source of school.sourceSeeds) operations.push({ sql: 'INSERT OR IGNORE INTO maintenance_source_schools VALUES(?,?)', values: [await digest(source.url), school.universityId] })
  }
  const plan = { upgradeSha256: hash, operations: coalesceOperations(operations), nextCanaryIds: added.slice(0, 5).map(school => school.universityId) }
  const text = canonical(plan), planSha = await digest(text), key = `maintenance/scope-upgrades/plans/${planSha}.json`
  await env.SNAPSHOTS_BUCKET.put(key, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const guard = crypto.randomUUID()
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND scope_sha256=? AND input_catalog_sha256=? AND legacy_guard_sha256=? AND seed_complete=1 AND targets_complete=1) AND ${idleFence} AND NOT EXISTS(SELECT 1 FROM maintenance_scope_upgrades WHERE status='staged') THEN 1 ELSE 0 END))`)
      .bind(guard, cfg.revision, cfg.scope_sha256, cfg.input_catalog_sha256, cfg.legacy_guard_sha256),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_scope_upgrades(upgrade_sha256,previous_scope_sha256,next_scope_sha256,expected_revision,paused_revision,input_catalog_sha256,legacy_guard_sha256,original_canary_json,original_enabled,original_models_enabled,plan_key,plan_sha256,total_operations,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,\'staged\',?)')
      .bind(hash, cfg.scope_sha256, upgrade.nextScope.sha256, cfg.revision, cfg.revision + 1, cfg.input_catalog_sha256, cfg.legacy_guard_sha256, cfg.canary_json, cfg.enabled, cfg.models_enabled, key, planSha, plan.operations.length, nowIso(now)),
    env.PIPELINE_DB.prepare('UPDATE maintenance_control SET enabled=0,models_enabled=0,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?').bind(nowIso(now), cfg.revision),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])
}

export async function processScopeUpgrade(env: MaintenanceEnv, hash: string, now = Date.now()) {
  const upgrade = await readUpgrade(env, hash)
  if (await env.SNAPSHOTS_BUCKET.get(handoffKey(hash))) return { ok: true, completed: false, upgradeSha256: hash, state: 'handed_off' }
  await env.PIPELINE_DB.prepare(SCOPE_UPGRADE_SCHEMA).run()
  let row = await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_scope_upgrades WHERE upgrade_sha256=?').bind(hash).first<UpgradeRow>()
  if (row?.status === 'completed') return { ok: true, completed: true, reused: true, upgradeSha256: hash,
    recovery: await finishScopeUpgradeInCloud(env, hash, upgrade, row) }
  if (!row) {
    const cfg = await control(env)
    if (cfg && cfg.revision !== upgrade.expectedRevision) {
      const manual = await env.PIPELINE_DB.prepare("SELECT event_id FROM maintenance_events WHERE kind='controls_changed' AND json_extract(details_json,'$.revision')>? LIMIT 1").bind(upgrade.expectedRevision).first()
      if (!cfg.enabled || !cfg.models_enabled || manual) return { ok: true, completed: false, upgradeSha256: hash,
        ...await handOffScopeUpgrade(env, hash, 'newer_operator_control_preserved', cfg.revision) }
      return { ok: true, completed: false, upgradeSha256: hash, state: 'waiting_for_automatic_head_reconciliation' }
    }
    await insertPlan(env, hash, upgrade, now); row = await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_scope_upgrades WHERE upgrade_sha256=?').bind(hash).first<UpgradeRow>()
  }
  if (!row) throw new MaintenanceError('scope_upgrade_plan_unavailable')
  const activeControl = await control(env)
  if (!activeControl || activeControl.revision !== row.paused_revision || activeControl.enabled !== 0 || activeControl.models_enabled !== 0) {
    return { ok: true, completed: false, upgradeSha256: hash, ...await handOffScopeUpgrade(env, hash, 'newer_operator_control_preserved', activeControl?.revision ?? null) }
  }
  const object = await env.SNAPSHOTS_BUCKET.get(row.plan_key), text = object ? await object.text() : ''
  if (await digest(text) !== row.plan_sha256) throw new MaintenanceError('scope_upgrade_plan_checksum_invalid')
  const plan = JSON.parse(text) as { upgradeSha256: string; operations: SqlOperation[]; nextCanaryIds: string[] }
  if (plan.upgradeSha256 !== hash || plan.operations.length !== row.total_operations || plan.nextCanaryIds.length !== 5) throw new MaintenanceError('scope_upgrade_plan_binding_invalid')
  const chunk = plan.operations.slice(row.completed_operations, row.completed_operations + 28), offset = row.completed_operations + chunk.length, guard = crypto.randomUUID()
  const fence = 'EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND revision=? AND enabled=0 AND models_enabled=0 AND scope_sha256=? AND input_catalog_sha256=? AND legacy_guard_sha256=?)'
  const bindings = [row.paused_revision, row.previous_scope_sha256, row.input_catalog_sha256, row.legacy_guard_sha256]
  if (chunk.length) await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${fence} AND EXISTS(SELECT 1 FROM maintenance_scope_upgrades WHERE upgrade_sha256=? AND status='staged' AND completed_operations=?) AND ${idleFence} THEN 1 ELSE 0 END))`).bind(guard, ...bindings, hash, row.completed_operations),
    ...chunk.map(operation => env.PIPELINE_DB.prepare(operation.sql).bind(...operation.values)),
    env.PIPELINE_DB.prepare('UPDATE maintenance_scope_upgrades SET completed_operations=? WHERE upgrade_sha256=? AND completed_operations=?').bind(offset, hash, row.completed_operations),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])
  if (offset < row.total_operations) {
    await env.MAINTENANCE_QUEUE.send({ version: 1, jobId: hash, scopeUpgradeSha256: hash })
    return { ok: true, completed: false, upgradeSha256: hash, completedOperations: offset, totalOperations: row.total_operations }
  }
  // Completion never restores enabled flags: a newer manual pause is authoritative.
  const receipt = canonical({ format: 'studyinchina.maintenance-scope-upgrade-receipt', version: 1, upgradeSha256: hash,
    previousScopeSha256: row.previous_scope_sha256, nextScopeSha256: row.next_scope_sha256, outcome: 'completed',
    inputCatalogSha256: row.input_catalog_sha256, legacyGuardSha256: row.legacy_guard_sha256, legacyGuardsPreserved: true,
    originalSeedPreserved: true, oldExportsPreserved: true, expectedSchoolCount: 295, addedSchools: 23,
    completedRevision: row.paused_revision + 1, completedAt: nowIso(now) })
  const receiptSha = await digest(receipt), receiptKey = `maintenance/scope-upgrades/receipts/${receiptSha}.json`
  await env.SNAPSHOTS_BUCKET.put(receiptKey, receipt, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN ${fence} AND ${idleFence} AND (SELECT COUNT(*) FROM maintenance_schools)=295 AND EXISTS(SELECT 1 FROM maintenance_scope_upgrades WHERE upgrade_sha256=? AND status='staged' AND completed_operations=total_operations) THEN 1 ELSE 0 END))`).bind(guard, ...bindings, hash),
    env.PIPELINE_DB.prepare('UPDATE maintenance_schools SET scope_sha256=? WHERE scope_sha256=?').bind(row.next_scope_sha256, row.previous_scope_sha256),
    env.PIPELINE_DB.prepare('UPDATE maintenance_control SET scope_sha256=?,targets_complete=0,canary_json=?,revision=revision+1,updated_at=? WHERE singleton=1 AND revision=?').bind(row.next_scope_sha256, canonical(plan.nextCanaryIds), nowIso(now), row.paused_revision),
    env.PIPELINE_DB.prepare("UPDATE maintenance_scope_upgrades SET status='completed',receipt_key=?,receipt_sha256=? WHERE upgrade_sha256=? AND status='staged'").bind(receiptKey, receiptSha, hash),
    env.PIPELINE_DB.prepare("INSERT INTO maintenance_events VALUES(?,'scope_upgraded',?,?)").bind(`scope-upgrade:${hash}`, nowIso(now), canonical({ upgradeSha256: hash, receiptKey, receiptSha256: receiptSha })),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])
  await env.MAINTENANCE_QUEUE.send({ version: 1, jobId: hash, scopeUpgradeSha256: hash })
  return { ok: true, completed: true, upgradeSha256: hash, receiptKey, receiptSha256: receiptSha, enabled: false, targetsComplete: false }
}

async function finishScopeUpgradeInCloud(env: MaintenanceEnv, hash: string, upgrade: ScopeUpgrade, row: UpgradeRow) {
  if (!upgrade.recordTargets) return { state: 'waiting_for_targets' }
  const cfg = await control(env), completedRevision = row.paused_revision + 1
  if (!cfg || cfg.scope_sha256 !== row.next_scope_sha256 || cfg.input_catalog_sha256 !== row.input_catalog_sha256
    || cfg.legacy_guard_sha256 !== row.legacy_guard_sha256) return handOffScopeUpgrade(env, hash, 'scope_upgrade_recovery_head_changed', cfg?.revision ?? null)
  if (cfg.revision === completedRevision && cfg.enabled === 0 && cfg.models_enabled === 0 && !cfg.targets_complete) {
    await refreshTargets(env, { inputCatalogSha256: row.input_catalog_sha256, recordTargets: upgrade.recordTargets }, true)
    return { state: 'target_refresh_queued' }
  }
  if (cfg.revision === completedRevision + 1 && cfg.targets_complete && cfg.enabled === 0 && cfg.models_enabled === 0) {
    const intent = canonical({ upgradeSha256: hash, expectedRevision: cfg.revision, enabled: row.original_enabled === 1,
      modelsEnabled: row.original_models_enabled === 1, canaryUniversityIds: JSON.parse(cfg.canary_json) })
    await env.SNAPSHOTS_BUCKET.put(`maintenance/scope-upgrades/resume-intent/${hash}.json`, intent, { onlyIf: { etagDoesNotMatch: '*' } })
    await setControls(env, { expectedRevision: cfg.revision, legacyGuardSha256: cfg.legacy_guard_sha256,
      enabled: row.original_enabled === 1, modelsEnabled: row.original_models_enabled === 1, canaryUniversityIds: JSON.parse(cfg.canary_json) })
  } else if (!(cfg.revision === completedRevision + 2 && Boolean(cfg.enabled) === Boolean(row.original_enabled)
    && Boolean(cfg.models_enabled) === Boolean(row.original_models_enabled))) return handOffScopeUpgrade(env, hash, 'newer_operator_control_preserved', cfg.revision)
  const intent = await env.SNAPSHOTS_BUCKET.get(`maintenance/scope-upgrades/resume-intent/${hash}.json`)
  if (!intent) return { state: 'resume_outcome_not_proven' }
  await env.SNAPSHOTS_BUCKET.put(`maintenance/scope-upgrades/finished/${hash}.json`, canonical({ upgradeSha256: hash,
    scopeRegistrySha256: row.next_scope_sha256, outcome: 'targets_ready_original_controls_restored', restoredRevision: completedRevision + 2 }), { onlyIf: { etagDoesNotMatch: '*' } })
  return { state: 'finished' }
}

export async function scopeUpgradeStatus(env: MaintenanceEnv, hash: string) {
  if (!HASH.test(hash)) throw new MaintenanceError('scope_upgrade_hash_invalid')
  let row: UpgradeRow | null
  try { row = await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_scope_upgrades WHERE upgrade_sha256=?').bind(hash).first<UpgradeRow>() }
  catch (error) {
    if (isDailyD1QuotaError(error)) return { format: 'studyinchina.maintenance-scope-upgrade-status', version: 1, upgradeSha256: hash, status: 'quota_wait', durablyQueued: Boolean(await env.SNAPSHOTS_BUCKET.get(PENDING)) }
    if (/no such table: maintenance_scope_upgrades/u.test(error instanceof Error ? error.message : String(error))) return { format: 'studyinchina.maintenance-scope-upgrade-status', version: 1, upgradeSha256: hash, status: 'pending-validation' }
    throw error
  }
  const finished = Boolean(await env.SNAPSHOTS_BUCKET.get(`maintenance/scope-upgrades/finished/${hash}.json`))
  const handedOff = Boolean(await env.SNAPSHOTS_BUCKET.get(handoffKey(hash)))
  const pendingObject = !row ? await env.SNAPSHOTS_BUCKET.get(PENDING) : null
  const pending = pendingObject ? JSON.parse(await pendingObject.text()) as PendingUpgrade : null
  const canSupersede = pending?.upgradeSha256 === hash ? (await supersedeProof(env, pending)).allow : false
  return { format: 'studyinchina.maintenance-scope-upgrade-status', version: 1, upgradeSha256: hash, finished,
    canSupersede,
    status: handedOff ? 'handed_off' : row?.status ?? 'pending-validation', completedOperations: row?.completed_operations ?? null,
    totalOperations: row?.total_operations ?? null, receiptKey: row?.receipt_key ?? null, receiptSha256: row?.receipt_sha256 ?? null,
    completedRevision: row?.status === 'completed' ? row.paused_revision + 1 : null,
    originalEnabled: row ? row.original_enabled === 1 : null, originalModelsEnabled: row ? row.original_models_enabled === 1 : null }
}
