import pinned from '../../../content/maintenance/lease-expired-quarantine-policy.v1.json'
import type { Control, MaintenanceEnv, ModelRequest } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, gateRequest, HASH, nowIso, record } from './util'
import { EXISTING_SCHOOLS_V2_SHA256, scopeUpgradeLineage } from './scope-config'

const PREFIX = 'maintenance/terminal-quarantine/'
const KIND = 'reviewed_terminal_quarantine'
const MAX_BODY = 32 * 1024
const ORIGINAL_SCOPE = 'c1703d2dd6b70ae533e7817e1e11393dbc6319672ba6ab97b01f0d2e66f53316'
const STATES = ['send_started', 'completed', 'unknown', 'known_failed'] as const
const tupleFields = ['job_id', 'source_id', 'stage', 'status', 'attempt', 'created_at', 'updated_at', 'due_at', 'lease_token', 'lease_until', 'snapshot_sha256', 'snapshot_key', 'error_code', 'target_ids_json'] as const
type Ref = { objectKey: string; sha256: string }
type Counts = Record<typeof STATES[number], number>
type Migration = { manifestSha256: string; finalizedAt: string; pageCount: number; importedPages: number; entryCount: number; requestCount: number; auxiliaryEntryCount?: number; states: Counts }
type Evidence = { format: 'studyinchina.reviewed-terminal-quarantine-evidence'; version: 1; operationId: string; policySha256: string; migrationId: string;
  sourceAccountId: string; targetAccountId: string; targetDatabaseId: string; scopeRegistrySha256: string; registeredAgainstRevision: number;
  inputCatalogSha256: string; auditedAt: string; relayReport: Ref; scopeUpgrade: Ref; migration: Migration; jobsSha256: string;
  artifacts: Array<{ snapshotKey: string; snapshotObjectSha256: string; rawKey: string; rawSha256: string; rawBytes: number; textKey: string; textSha256: string; textBytes: number }>;
  audit: { matchingSqlAttempts: 0; matchingProposals: 0; scopeSha256: string }; outcome: 'unknown_preserved_no_replay'; modelCallsPerformed: false }
type Proof = { format: 'studyinchina.reviewed-terminal-quarantine-proof'; version: 1; evidence: Evidence; evidenceSha256: string;
  review: { operatorId: string; decision: 'quarantine_preserve_unknown_no_replay'; reviewedAt: string }; jobOutcomesChanged: false; modelCallsPerformed: false }
type Commit = { format: 'studyinchina.reviewed-terminal-quarantine-commit'; version: 1; operationId: string; scopeRegistrySha256: string; policySha256: string; proofKey: string; proofSha256: string }
export type UnknownJobDisposition = { state: 'not_registered' | 'active' | 'scope_mismatch' | 'invalid'; totalUnknown: number; quarantinedUnknown: number; unresolvedUnknown: number;
  policySha256: string; proofSha256: string | null; importedDoStates: Counts | null; modelSuccessesClaimed: false; replayAllowed: false }
export type VerifiedDisposition = { summary: UnknownJobDisposition; pinnedJobsJson: string; commit: { eventId: string; detailsJson: string; scopeUpgrade: Ref } | null }
const jobsJson = canonical(pinned.jobs.map(subject => subject.job))
const sourcesJson = canonical(pinned.jobs.map(subject => subject.job.source_id))
const rawJson = canonical(pinned.jobs.map(subject => subject.job.snapshot_sha256))
const textsJson = canonical([...new Set(pinned.jobs.map(subject => subject.textSha256))])
const policyContent = Object.fromEntries(Object.entries(pinned).filter(([key]) => key !== 'sha256'))
let checkedPolicy: Promise<void> | undefined
async function policy() {
  checkedPolicy ??= (async () => {
    if (await digest(canonical(policyContent)) !== pinned.sha256 || new TextEncoder().encode(jobsJson).length > 8192 || pinned.jobs.length !== 3 || pinned.registrationScopeSha256 !== EXISTING_SCHOOLS_V2_SHA256
      || new Set(pinned.jobs.map(subject => subject.job.job_id)).size !== 3 || new Set(pinned.jobs.map(subject => subject.job.source_id)).size !== 3
      || pinned.jobs.some(subject => subject.job.status !== 'unknown' || subject.job.error_code !== 'execution_lease_expired' || subject.job.lease_token !== null || subject.job.lease_until !== null))
      throw new MaintenanceError('terminal_quarantine_policy_invalid')
  })()
  await checkedPolicy
}
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const instant = (v: unknown, now: number) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now
const fail = (code: string): never => { throw new MaintenanceError(code) }
const ref = (v: unknown): Ref => {
  const r = record(v)
  if (!r || Object.keys(r).sort().join(',') !== 'objectKey,sha256' || !HASH.test(String(r.sha256)) || r.objectKey !== `${PREFIX}evidence/${r.sha256}.json`) return fail('terminal_quarantine_evidence_ref_invalid')
  return r as Ref
}
async function bytes(env: MaintenanceEnv, key: string, max: number) {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > max) return fail('terminal_quarantine_artifact_unavailable')
  const value = new Uint8Array(await object.arrayBuffer())
  if (!value.length || value.byteLength > max) return fail('terminal_quarantine_artifact_unavailable')
  return value
}
async function checkedJson(env: MaintenanceEnv, r: Ref) {
  const value = await bytes(env, r.objectKey, MAX_BODY)
  if (await digest(value) !== r.sha256) return fail('terminal_quarantine_artifact_hash_mismatch')
  return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value))) ?? fail('terminal_quarantine_artifact_invalid')
}
const eventId = (scope: string) => `terminal-quarantine:${pinned.operationId}:${scope}`
const sameBinding = (r: Record<string, unknown>) => r.migrationId === pinned.migrationId && r.sourceAccountId === pinned.sourceAccountId && r.targetAccountId === pinned.targetAccountId
function counts(v: unknown): Counts {
  const r = record(v)
  if (!r || Object.keys(r).sort().join(',') !== [...STATES].sort().join(',') || STATES.some(state => !integer(r[state]))) return fail('terminal_quarantine_do_counts_invalid')
  return r as Counts
}
function auxiliaryEntries(value: Record<string, unknown>): number {
  const count = value.auxiliaryEntryCount === undefined ? 0 : value.auxiliaryEntryCount
  if (!integer(count)) return fail('terminal_quarantine_do_counts_invalid')
  return count
}
function migration(v: unknown, now: number): Migration {
  const r = record(v)
  if (!r || !HASH.test(String(r.manifestSha256)) || !instant(r.finalizedAt, now) || !integer(r.pageCount) || r.pageCount < 1 || r.importedPages !== r.pageCount
    || !integer(r.entryCount) || !integer(r.requestCount)) return fail('terminal_quarantine_finalized_do_required')
  const states = counts(r.states), auxiliaryEntryCount = auxiliaryEntries(r), requestsAndAuxiliary = r.requestCount + auxiliaryEntryCount
  // Legacy fence/adoption KV entries are migrated evidence, never model calls.
  // Status has no gatePresent, so retain the original zero-or-one gate slot.
  if (!Number.isSafeInteger(requestsAndAuxiliary) || STATES.reduce((sum, state) => sum + states[state], 0) !== r.requestCount
    || ![0, 1].includes(r.entryCount - requestsAndAuxiliary)) return fail('terminal_quarantine_do_counts_invalid')
  return { manifestSha256: String(r.manifestSha256), finalizedAt: String(r.finalizedAt), pageCount: r.pageCount, importedPages: r.pageCount,
    entryCount: r.entryCount, requestCount: r.requestCount, ...(auxiliaryEntryCount ? { auxiliaryEntryCount } : {}), states }
}
function currentScope(env: MaintenanceEnv, cfg: Control | null): asserts cfg is Control {
  if (!cfg || cfg.scope_sha256 !== pinned.registrationScopeSha256 || env.SCOPE_REGISTRY_SHA256 !== cfg.scope_sha256 || env.SCOPE_SCHOOL_COUNT !== '295'
    || !cfg.seed_complete || !cfg.targets_complete) return fail('terminal_quarantine_current_295_scope_required')
}
async function control(env: MaintenanceEnv) { return env.PIPELINE_DB.prepare('SELECT * FROM maintenance_control WHERE singleton=1').first<Control>() }
function upgradeRef(value: unknown): Ref {
  const r = record(value)
  if (!r || Object.keys(r).sort().join(',') !== 'objectKey,sha256' || !HASH.test(String(r.sha256)) || r.objectKey !== `maintenance/scope-upgrades/receipts/${r.sha256}.json`) return fail('terminal_quarantine_scope_lineage_invalid')
  return r as Ref
}
async function scopeLineage(env: MaintenanceEnv): Promise<Ref> {
  if (!await scopeUpgradeLineage(env, ORIGINAL_SCOPE, pinned.registrationScopeSha256)) return fail('terminal_quarantine_scope_lineage_invalid')
  const row = await env.PIPELINE_DB.prepare("SELECT receipt_key,receipt_sha256 FROM maintenance_scope_upgrades WHERE previous_scope_sha256=? AND next_scope_sha256=? AND status='completed'")
    .bind(ORIGINAL_SCOPE, pinned.registrationScopeSha256).first<{ receipt_key: string; receipt_sha256: string }>()
  if (!row) return fail('terminal_quarantine_scope_lineage_invalid')
  return upgradeRef({ objectKey: row.receipt_key, sha256: row.receipt_sha256 })
}
const lineageSql = "EXISTS(SELECT 1 FROM maintenance_scope_upgrades WHERE previous_scope_sha256=? AND next_scope_sha256=? AND status='completed' AND receipt_key=? AND receipt_sha256=?)"
const lineageBindings = (r: Ref) => [ORIGINAL_SCOPE, pinned.registrationScopeSha256, r.objectKey, r.sha256]

/** Installed before any waiver. This negative policy is deliberately not scope-,
 * model-, date- or request-key dependent. Caller-provided text hashes are ignored. */
export async function noReplayReason(env: MaintenanceEnv, input: ModelRequest, source: { raw_sha256: string | null; canonical_sha256?: string | null; snapshot_key?: string | null }): Promise<string | null> {
  await policy()
  if (pinned.jobs.some(subject => subject.job.source_id === input.sourceId || subject.job.snapshot_sha256 === input.snapshotSha256)) return 'terminal_quarantine_no_replay'
  // This pair was computed by the capturer, not supplied in /model/run.
  if (source.raw_sha256 !== input.snapshotSha256 || !HASH.test(String(source.canonical_sha256))) return 'terminal_quarantine_source_text_unproven'
  let textSha = source.canonical_sha256!
  if (textSha === source.raw_sha256) {
    const derived = await env.PIPELINE_DB.prepare('SELECT text_sha256 FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?')
      .bind(input.sourceId, input.snapshotSha256).first<{ text_sha256: string }>()
    if (derived) textSha = derived.text_sha256
    else {
      const key = `maintenance/snapshots/${input.sourceId}/${input.snapshotSha256}.json`
      if (source.snapshot_key !== key) return 'terminal_quarantine_source_text_unproven'
      const raw = record(JSON.parse(new TextDecoder().decode(await bytes(env, key, 64 * 1024))))
      if (raw?.sourceId !== input.sourceId || raw.rawSha256 !== input.snapshotSha256 || !HASH.test(String(raw.textSha256))) return 'terminal_quarantine_source_text_unproven'
      textSha = String(raw.textSha256)
    }
  }
  if (!HASH.test(textSha)) return 'terminal_quarantine_source_text_unproven'
  return pinned.jobs.some(subject => subject.textSha256 === textSha) ? 'terminal_quarantine_no_replay' : null
}

/** Every immutable job column available in the captured audit is compared.
 * The JSON contains three small rows, never the catalogue/target manifest. */
export function matchingQuarantinedJobsSql() {
  return `SELECT j.job_id FROM maintenance_jobs j JOIN json_each(?) q ON j.job_id=json_extract(q.value,'$.job_id') WHERE ${tupleFields.map(field => `j.${field} IS json_extract(q.value,'$.${field}')`).join(' AND ')}`
}
function auditSql(alias: string) {
  return `(${alias}.source_id IN(SELECT value FROM json_each(?)) OR ${alias}.snapshot_sha256 IN(SELECT value FROM json_each(?))
    OR ${alias}.snapshot_sha256 IN(SELECT raw_sha256 FROM maintenance_observations WHERE canonical_sha256 IN(SELECT value FROM json_each(?)))
    OR ${alias}.snapshot_sha256 IN(SELECT raw_sha256 FROM maintenance_document_derivatives WHERE text_sha256 IN(SELECT value FROM json_each(?))))`
}
const auditBindings = () => [sourcesJson, rawJson, textsJson, textsJson]
function absenceSql() { return `NOT EXISTS(SELECT 1 FROM maintenance_model_attempts a WHERE ${auditSql('a')}) AND NOT EXISTS(SELECT 1 FROM maintenance_proposals p WHERE ${auditSql('p')})` }
async function audit(env: MaintenanceEnv) {
  const row = await env.PIPELINE_DB.prepare(`SELECT (SELECT COUNT(*) FROM maintenance_model_attempts a WHERE ${auditSql('a')}) attempts,(SELECT COUNT(*) FROM maintenance_proposals p WHERE ${auditSql('p')}) proposals`)
    .bind(...auditBindings(), ...auditBindings()).first<{ attempts: number; proposals: number }>()
  if (!row || row.attempts || row.proposals) return fail('terminal_quarantine_no_output_audit_changed')
}
async function exactJobs(env: MaintenanceEnv) {
  const rows = (await env.PIPELINE_DB.prepare(matchingQuarantinedJobsSql()).bind(jobsJson).all<{ job_id: string }>()).results ?? []
  if (rows.length !== 3) return fail('terminal_quarantine_job_snapshot_changed')
}
async function prepareEvidence(env: MaintenanceEnv, value: Record<string, unknown>, now: number): Promise<Evidence> {
  await policy()
  const cfg = await control(env); currentScope(env, cfg)
  if (value.expectedRevision !== cfg.revision || value.scopeRegistrySha256 !== cfg.scope_sha256) return fail('terminal_quarantine_control_conflict')
  if (env.MAINTENANCE_ENABLED !== 'false' || env.MODEL_STATE_MIGRATION_ROLE !== 'target' || env.MODEL_STATE_MIGRATION_ID !== pinned.migrationId
    || env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID !== pinned.sourceAccountId || env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID !== pinned.targetAccountId)
    return fail('terminal_quarantine_target_migration_freeze_required')
  const scopeUpgrade = await scopeLineage(env)
  const relayRef = ref(value.relayReport), relay = await checkedJson(env, relayRef)
  if (relay.format !== 'studyinchina.model-state-migration-report' || relay.version !== 1 || relay.migrationId !== pinned.migrationId || relay.state !== 'finalized'
    || relay.sourceFrozen !== true || relay.targetFinalized !== true || relay.modelCallsPerformed !== false || relay.controlsChanged !== false) return fail('terminal_quarantine_finalized_relay_required')
  const response = await gateRequest(env, '/model-state-migration/status', {})
  if (!response.ok) return fail('terminal_quarantine_finalized_do_required')
  const actual = record(await response.json())
  if (!actual || actual.ok !== true || !sameBinding(actual) || actual.role !== 'target' || actual.state !== 'finalized') return fail('terminal_quarantine_finalized_do_required')
  const finalized = migration(actual, now)
  if (relay.manifestSha256 !== finalized.manifestSha256 || relay.entryCount !== finalized.entryCount || relay.requestCount !== finalized.requestCount
    || auxiliaryEntries(relay) !== (finalized.auxiliaryEntryCount ?? 0) || relay.pageCount !== finalized.pageCount
    || canonical(counts(relay.states)) !== canonical(finalized.states)) return fail('terminal_quarantine_relay_do_mismatch')
  await exactJobs(env); await audit(env)
  const artifacts: Evidence['artifacts'] = []
  for (const subject of pinned.jobs) {
    const snapshotBytes = await bytes(env, subject.job.snapshot_key, 64 * 1024)
    if (await digest(snapshotBytes) !== subject.snapshotObjectSha256) return fail('terminal_quarantine_snapshot_hash_mismatch')
    const snapshot = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshotBytes)))
    if (snapshot?.sourceId !== subject.job.source_id || snapshot.rawSha256 !== subject.job.snapshot_sha256 || snapshot.sourceUrl !== subject.sourceUrl
      || snapshot.rawKey !== subject.rawKey || snapshot.textKey !== subject.textKey || snapshot.textSha256 !== subject.textSha256) return fail('terminal_quarantine_snapshot_binding_invalid')
    const raw = await bytes(env, subject.rawKey, 10 * 1024 * 1024), text = await bytes(env, subject.textKey, 2 * 1024 * 1024)
    if (await digest(raw) !== subject.job.snapshot_sha256 || await digest(text) !== subject.textSha256) return fail('terminal_quarantine_original_hash_mismatch')
    artifacts.push({ snapshotKey: subject.job.snapshot_key, snapshotObjectSha256: subject.snapshotObjectSha256, rawKey: subject.rawKey, rawSha256: subject.job.snapshot_sha256,
      rawBytes: raw.length, textKey: subject.textKey, textSha256: subject.textSha256, textBytes: text.length })
  }
  const auditedAt = value.auditedAt ?? nowIso(now)
  if (!instant(auditedAt, now) || now - Date.parse(String(auditedAt)) > 3600000) return fail('terminal_quarantine_audit_stale')
  return { format: 'studyinchina.reviewed-terminal-quarantine-evidence', version: 1, operationId: pinned.operationId, policySha256: pinned.sha256,
    migrationId: pinned.migrationId, sourceAccountId: pinned.sourceAccountId, targetAccountId: pinned.targetAccountId, targetDatabaseId: pinned.targetDatabaseId,
    scopeRegistrySha256: cfg.scope_sha256, registeredAgainstRevision: cfg.revision, inputCatalogSha256: cfg.input_catalog_sha256, auditedAt: String(auditedAt), relayReport: relayRef, scopeUpgrade,
    migration: finalized, jobsSha256: await digest(jobsJson), artifacts, audit: { matchingSqlAttempts: 0, matchingProposals: 0,
      scopeSha256: await digest(canonical({ sourcesJson, rawJson, textsJson })) }, outcome: 'unknown_preserved_no_replay', modelCallsPerformed: false }
}
async function immutable(env: MaintenanceEnv, key: string, text: string) {
  await env.SNAPSHOTS_BUCKET.put(key, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const readback = await bytes(env, key, MAX_BODY)
  if (new TextDecoder().decode(readback) !== text) return fail('terminal_quarantine_immutable_write_conflict')
}
function proofContent(value: unknown, scope: string, now: number): Proof {
  const p = record(value), e = record(p?.evidence), r = record(p?.review)
  if (!p || Object.keys(p).sort().join(',') !== 'evidence,evidenceSha256,format,jobOutcomesChanged,modelCallsPerformed,review,version'
    || p.format !== 'studyinchina.reviewed-terminal-quarantine-proof' || p.version !== 1 || p.modelCallsPerformed !== false || p.jobOutcomesChanged !== false
    || !e || e.format !== 'studyinchina.reviewed-terminal-quarantine-evidence' || e.version !== 1 || e.policySha256 !== pinned.sha256 || e.operationId !== pinned.operationId
    || !sameBinding(e) || e.targetDatabaseId !== pinned.targetDatabaseId || e.scopeRegistrySha256 !== scope || e.scopeRegistrySha256 !== pinned.registrationScopeSha256
    || !integer(e.registeredAgainstRevision) || !HASH.test(String(e.inputCatalogSha256)) || !instant(e.auditedAt, now) || !HASH.test(String(p.evidenceSha256))
    || e.outcome !== 'unknown_preserved_no_replay' || e.modelCallsPerformed !== false || !r || Object.keys(r).sort().join(',') !== 'decision,operatorId,reviewedAt' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(String(r.operatorId))
    || r.decision !== 'quarantine_preserve_unknown_no_replay' || !instant(r.reviewedAt, now) || Date.parse(String(r.reviewedAt)) < Date.parse(String(e.auditedAt))) return fail('terminal_quarantine_proof_invalid')
  migration(e.migration, now); ref(e.relayReport); upgradeRef(e.scopeUpgrade)
  return p as unknown as Proof
}

/** Prepare is read-only. Register rechecks the full evidence and commits only a
 * disposition event; no job, control, legacy guard or DO request is updated. */
export async function reviewedTerminalQuarantine(env: MaintenanceEnv, value: unknown, now = Date.now()) {
  const input = record(value)
  if (!input || new TextEncoder().encode(canonical(input)).length > MAX_BODY || !['prepare', 'register'].includes(String(input.phase))) return fail('terminal_quarantine_input_invalid')
  if (input.phase === 'prepare') {
    if (Object.keys(input).some(key => !['phase', 'expectedRevision', 'scopeRegistrySha256', 'relayReport'].includes(key))) return fail('terminal_quarantine_input_invalid')
    const evidence = await prepareEvidence(env, input, now)
    return { ok: true, phase: 'prepared' as const, evidence, evidenceSha256: await digest(canonical(evidence)), mutationPerformed: false, modelCallsPerformed: false }
  }
  if (Object.keys(input).some(key => !['phase', 'evidence', 'evidenceSha256', 'review'].includes(key))) return fail('terminal_quarantine_input_invalid')
  const proof = proofContent({ format: 'studyinchina.reviewed-terminal-quarantine-proof', version: 1, evidence: input.evidence,
    evidenceSha256: input.evidenceSha256, review: input.review, jobOutcomesChanged: false, modelCallsPerformed: false }, pinned.registrationScopeSha256, now)
  if (await digest(canonical(proof.evidence)) !== proof.evidenceSha256) return fail('terminal_quarantine_evidence_hash_mismatch')
  const text = canonical(proof), sha256 = await digest(text), key = `${PREFIX}proofs/${sha256}.json`, id = eventId(proof.evidence.scopeRegistrySha256)
  const existing = await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(id).first<{ kind: string; details_json: string }>()
  const commit: Commit = { format: 'studyinchina.reviewed-terminal-quarantine-commit', version: 1, operationId: pinned.operationId,
    scopeRegistrySha256: proof.evidence.scopeRegistrySha256, policySha256: pinned.sha256, proofKey: key, proofSha256: sha256 }
  if (existing) {
    if (existing.kind !== KIND || existing.details_json !== canonical(commit)) return fail('terminal_quarantine_registration_conflict')
    const cfg = await control(env); currentScope(env, cfg)
    const verified = await readUnknownJobDisposition(env, cfg, now)
    if (verified.summary.state !== 'active' || verified.summary.proofSha256 !== sha256) return fail('terminal_quarantine_existing_proof_invalid')
    return { ok: true, phase: 'registered' as const, reused: true, proofKey: key, ...verified.summary, jobOutcomesChanged: false }
  }
  const refreshed = await prepareEvidence(env, { expectedRevision: proof.evidence.registeredAgainstRevision, scopeRegistrySha256: proof.evidence.scopeRegistrySha256,
    relayReport: proof.evidence.relayReport, auditedAt: proof.evidence.auditedAt }, now)
  if (canonical(refreshed) !== canonical(proof.evidence)) return fail('terminal_quarantine_prepared_evidence_changed')
  await immutable(env, key, text)
  const guard = crypto.randomUUID()
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(`INSERT INTO maintenance_transaction_guards VALUES(?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND revision=? AND input_catalog_sha256=? AND seed_complete=1 AND targets_complete=1) AND ${lineageSql} AND (SELECT COUNT(*) FROM (${matchingQuarantinedJobsSql()}))=3 AND ${absenceSql()} AND NOT EXISTS(SELECT 1 FROM maintenance_jobs WHERE status='running') AND NOT EXISTS(SELECT 1 FROM maintenance_model_attempts WHERE status IN('reserved','send_started')) AND NOT EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=?) THEN 1 ELSE 0 END))`)
      .bind(guard, proof.evidence.scopeRegistrySha256, proof.evidence.registeredAgainstRevision, proof.evidence.inputCatalogSha256, ...lineageBindings(proof.evidence.scopeUpgrade), jobsJson, ...auditBindings(), ...auditBindings(), id),
    env.PIPELINE_DB.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(id, KIND, nowIso(now), canonical(commit)),
    env.PIPELINE_DB.prepare('DELETE FROM maintenance_transaction_guards WHERE guard_id=?').bind(guard),
  ])
  const cfg = await control(env); currentScope(env, cfg)
  const result = await readUnknownJobDisposition(env, cfg, now)
  if (result.summary.state !== 'active') return fail('terminal_quarantine_registration_readback_failed')
  return { ok: true, phase: 'registered' as const, reused: false, proofKey: key, ...result.summary, jobOutcomesChanged: false }
}

export async function readUnknownJobDisposition(env: MaintenanceEnv, cfg: Control | null, now = Date.now()): Promise<VerifiedDisposition> {
  await policy()
  const count = await env.PIPELINE_DB.prepare("SELECT COUNT(*) count FROM maintenance_jobs WHERE status='unknown'").first<{ count: number }>()
  const summary: UnknownJobDisposition = { state: 'not_registered', totalUnknown: count?.count ?? 0, quarantinedUnknown: 0, unresolvedUnknown: count?.count ?? 0,
    policySha256: pinned.sha256, proofSha256: null, importedDoStates: null, modelSuccessesClaimed: false, replayAllowed: false }
  const empty = () => ({ summary, pinnedJobsJson: '[]', commit: null })
  if (!cfg || cfg.scope_sha256 !== pinned.registrationScopeSha256 || env.SCOPE_REGISTRY_SHA256 !== cfg.scope_sha256 || env.SCOPE_SCHOOL_COUNT !== '295') { summary.state = 'scope_mismatch'; return empty() }
  const id = eventId(cfg.scope_sha256), row = await env.PIPELINE_DB.prepare('SELECT kind,details_json FROM maintenance_events WHERE event_id=?').bind(id).first<{ kind: string; details_json: string }>()
  if (!row) return empty()
  try {
    const c = record(JSON.parse(row.details_json))
    if (row.kind !== KIND || c?.format !== 'studyinchina.reviewed-terminal-quarantine-commit' || c.version !== 1 || c.operationId !== pinned.operationId
      || c.scopeRegistrySha256 !== cfg.scope_sha256 || c.policySha256 !== pinned.sha256 || !HASH.test(String(c.proofSha256)) || c.proofKey !== `${PREFIX}proofs/${c.proofSha256}.json`) return fail('terminal_quarantine_commit_invalid')
    const raw = await bytes(env, String(c.proofKey), MAX_BODY), text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    if (await digest(raw) !== c.proofSha256) return fail('terminal_quarantine_proof_hash_mismatch')
    const proof = proofContent(JSON.parse(text), cfg.scope_sha256, now)
    if (canonical(proof) !== text || await digest(canonical(proof.evidence)) !== proof.evidenceSha256 || proof.evidence.jobsSha256 !== await digest(jobsJson)
      || proof.evidence.registeredAgainstRevision > cfg.revision) return fail('terminal_quarantine_proof_invalid')
    if (canonical(await scopeLineage(env)) !== canonical(proof.evidence.scopeUpgrade)) return fail('terminal_quarantine_scope_lineage_invalid')
    await exactJobs(env); await audit(env)
    summary.state = 'active'; summary.quarantinedUnknown = 3; summary.unresolvedUnknown = summary.totalUnknown - 3
    if (summary.unresolvedUnknown < 0) return fail('terminal_quarantine_counts_invalid')
    summary.proofSha256 = String(c.proofSha256); summary.importedDoStates = proof.evidence.migration.states
    return { summary, pinnedJobsJson: jobsJson, commit: { eventId: id, detailsJson: row.details_json, scopeUpgrade: proof.evidence.scopeUpgrade } }
  } catch (error) {
    // D1/backend failures propagate; malformed/missing evidence never waives a job.
    if (!(error instanceof MaintenanceError) && error instanceof Error && /D1|SQLITE|quota|database/i.test(error.message)) throw error
    summary.state = 'invalid'; return empty()
  }
}

/** The health read and the atomic rollout commit use this same exact tuple
 * predicate. A changed row or a fourth unknown remains an unresolved blocker. */
export function dispositionFence(disposition: VerifiedDisposition, additional: { sql: string; bindings: string[] } = {sql:'SELECT NULL WHERE 0',bindings:[]}) {
  const unknown = `NOT EXISTS(SELECT 1 FROM maintenance_jobs j WHERE j.status='unknown' AND j.job_id NOT IN(${matchingQuarantinedJobsSql()}) AND j.job_id NOT IN(${additional.sql}))`
  const commit = disposition.commit ? ` AND (SELECT COUNT(*) FROM (${matchingQuarantinedJobsSql()}))=3 AND EXISTS(SELECT 1 FROM maintenance_events WHERE event_id=? AND kind='reviewed_terminal_quarantine' AND details_json=?) AND ${lineageSql} AND ${absenceSql()}` : ''
  return { sql: `${unknown}${commit}`, bindings: [disposition.pinnedJobsJson, ...additional.bindings, ...(disposition.commit ? [disposition.pinnedJobsJson, disposition.commit.eventId, disposition.commit.detailsJson, ...lineageBindings(disposition.commit.scopeUpgrade), ...auditBindings(), ...auditBindings()] : [])] }
}

export const TERMINAL_QUARANTINE_POLICY = pinned
