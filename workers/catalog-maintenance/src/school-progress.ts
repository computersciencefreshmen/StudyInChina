import { z } from 'zod'
import { schoolReconciliationSchema, evaluateSchoolReconciliation, type SchoolReconciliation } from '../../../scripts/maintenance/reconciliation'
import { maintenanceRecordTargetSchema } from '../../../scripts/maintenance/field-contracts'
import { control } from './repository'
import { isDailyD1QuotaError } from './backend-errors'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, ID, nowIso, record } from './util'

const receiptReferenceSchema = z.object({ objectKey: z.string(), sha256: z.string().regex(HASH) }).strict()
export const schoolReconciliationSubmissionSchema = z.object({
  report: schoolReconciliationSchema,
  reviewReceipt: receiptReferenceSchema.optional(),
}).strict()
export const schoolHumanReviewReceiptSchema = z.object({
  format: z.literal('studyinchina.school-reconciliation-human-review'), version: z.literal(1),
  universityId: z.string().min(1), scopeRegistrySha256: z.string().regex(HASH),
  observedReportSha256: z.string().regex(HASH),
  observedCatalogs: z.array(z.object({ sourceId: z.string().min(1), url: z.string().url(), snapshotSha256: z.string().regex(HASH) }).strict()).min(1).max(100),
  reviewer: z.object({ id: z.string().min(1).max(160), kind: z.literal('human') }).strict(),
  method: z.literal('independent-human-review'), decision: z.literal('accept'),
  reviewedAt: z.string().datetime(),
}).strict()

type School = { university_id: string; name_json: string; last_attempt_at: string | null }
type Source = { university_id: string; source_id: string; url: string; enabled: number; due_at: string;
  last_attempt_at: string | null; failures: number; error_code: string | null }
type Observation = { university_id: string; source_id: string; checked_at: string; final_url: string;
  http_status: number; raw_sha256: string | null; snapshot_key: string | null }
type Summary = { universityId: string; scopeRegistrySha256: string; inputCatalogSha256: string;
  reportKey: string; sha256: string; reportSha256: string; status: 'complete' | 'in_progress';
  published: number; accountedRows: number; officialRows: number | null; blockers: string[]; observedAt: string }
type StoredReport = { format: 'studyinchina.school-reconciliation-report'; version: 1; observedAt: string;
  scopeRegistrySha256: string; inputCatalogSha256: string; reportSha256: string; report: SchoolReconciliation;
  evaluation: ReturnType<typeof evaluateSchoolReconciliation>; reviewReceipt: z.infer<typeof receiptReferenceSchema> | null }

async function bytes(env: MaintenanceEnv, key: string, maxBytes: number): Promise<ArrayBuffer> {
  const object = await env.SNAPSHOTS_BUCKET.get(key)
  if (!object || object.size !== undefined && object.size > maxBytes) throw new MaintenanceError('reconciliation_artifact_unavailable')
  const value = await object.arrayBuffer()
  if (value.byteLength > maxBytes) throw new MaintenanceError('reconciliation_artifact_too_large')
  return value
}
const decode = (value: ArrayBuffer): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value))
const catalogBindings = (report: SchoolReconciliation) => report.catalogs.map(({ sourceId, url, snapshotSha256 }) => ({ sourceId, url, snapshotSha256 }))
  .sort((a, b) => a.sourceId.localeCompare(b.sourceId))

async function verifyHumanReceipt(env: MaintenanceEnv, ref: z.infer<typeof receiptReferenceSchema>, report: SchoolReconciliation,
  reportSha256: string, scopeSha256: string, latestObservation: string, now: number) {
  if (ref.objectKey !== `maintenance/reconciliations/human-reviews/${ref.sha256}.json`) throw new MaintenanceError('reconciliation_human_receipt_key_invalid')
  const raw = await bytes(env, ref.objectKey, 256 * 1024)
  if (await digest(raw) !== ref.sha256) throw new MaintenanceError('reconciliation_human_receipt_checksum_mismatch')
  const review = schoolHumanReviewReceiptSchema.parse(decode(raw))
  if (review.universityId !== report.universityId || review.scopeRegistrySha256 !== scopeSha256
    || review.observedReportSha256 !== reportSha256
    || canonical([...review.observedCatalogs].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) !== canonical(catalogBindings(report))
    || /minimax|automati|extractor|^model(?:$|[-_:])/iu.test(review.reviewer.id)
    || Date.parse(review.reviewedAt) > now || review.reviewedAt < latestObservation) throw new MaintenanceError('reconciliation_human_review_binding_invalid')
  return review
}

async function observedSnapshot(env: MaintenanceEnv, source: Source, observation: Observation, rawSha256: string) {
  const key = `maintenance/snapshots/${source.source_id}/${rawSha256}.json`
  if (observation.snapshot_key !== key || !HASH.test(source.source_id)) throw new MaintenanceError('reconciliation_snapshot_key_invalid')
  const snapshot = record(decode(await bytes(env, key, 2 * 1024 * 1024)))
  const rawKey = `maintenance/snapshots/${source.source_id}/${rawSha256}.bin`
  if (!snapshot || snapshot.version !== 1 || snapshot.sourceId !== source.source_id || snapshot.sourceUrl !== source.url
    || snapshot.rawSha256 !== rawSha256 || snapshot.rawKey !== rawKey || snapshot.finalUrl !== observation.final_url)
    throw new MaintenanceError('reconciliation_snapshot_binding_invalid')
  if (await digest(await bytes(env, rawKey, 10 * 1024 * 1024)) !== rawSha256) throw new MaintenanceError('reconciliation_raw_checksum_mismatch')
}

/** Completeness is a separately reviewed catalogue claim, never a model count or seed side effect. */
export async function submitSchoolReconciliation(env: MaintenanceEnv, value: unknown, now = Date.now()) {
  const input = schoolReconciliationSubmissionSchema.parse(value), report = input.report
  if (!ID.test(report.universityId) || report.catalogs.length > 100 || report.entries.length > 10000
    || new TextEncoder().encode(canonical(input)).byteLength > 2 * 1024 * 1024) throw new MaintenanceError('reconciliation_input_too_large_or_invalid')
  const cfg = await control(env)
  if (!cfg || cfg.scope_sha256 !== env.SCOPE_REGISTRY_SHA256) throw new MaintenanceError('reconciliation_scope_not_ready')
  const school = await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools WHERE university_id=? AND scope_sha256=?')
    .bind(report.universityId, cfg.scope_sha256).first()
  if (!school) throw new MaintenanceError('reconciliation_school_outside_scope')
  const sources = (await env.PIPELINE_DB.prepare('SELECT s.*,x.university_id FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id WHERE x.university_id=?')
    .bind(report.universityId).all<Source>()).results ?? []
  const observations = (await env.PIPELINE_DB.prepare('SELECT o.*,x.university_id FROM maintenance_observations o JOIN maintenance_source_schools x ON x.source_id=o.source_id WHERE x.university_id=? AND o.http_status BETWEEN 200 AND 299 ORDER BY o.checked_at DESC')
    .bind(report.universityId).all<Observation>()).results ?? []
  let latestObservation = ''
  for (const catalog of report.catalogs) {
    const source = sources.find(source => source.source_id === catalog.sourceId && source.enabled === 1)
    const observation = observations.find(observation => observation.source_id === catalog.sourceId && observation.raw_sha256 === catalog.snapshotSha256
      && (catalog.url === source?.url || catalog.url === observation.final_url))
    if (!source || !observation || Date.parse(observation.checked_at) > now) throw new MaintenanceError('reconciliation_catalog_observation_mismatch')
    // A report cannot finish against superseded source bytes.
    if (observations.find(row => row.source_id === source.source_id)?.raw_sha256 !== catalog.snapshotSha256)
      throw new MaintenanceError('reconciliation_catalog_snapshot_superseded')
    await observedSnapshot(env, source, observation, catalog.snapshotSha256)
    if (observation.checked_at > latestObservation) latestObservation = observation.checked_at
  }
  for (const category of report.categories) {
    if (category.status === 'officially_not_provided' && !report.catalogs.some(catalog => catalog.url === category.evidenceUrl))
      throw new MaintenanceError('reconciliation_absence_evidence_not_captured')
  }
  const targets = (await env.PIPELINE_DB.prepare('SELECT t.*,x.source_id FROM maintenance_record_targets t JOIN maintenance_target_sources x ON x.target_id=t.target_id WHERE t.university_id=? AND t.active=1')
    .bind(report.universityId).all<{ record_id: string; entity_type: string; university_id: string; source_id: string; target_json: string }>()).results ?? []
  const publishedBindings = new Set<string>()
  for (const entry of report.entries.filter(entry => entry.status === 'published')) {
    const target = targets.find(target => target.record_id === entry.recordId && target.entity_type === 'program' && target.source_id === entry.sourceId)
    const parsed = target && maintenanceRecordTargetSchema.safeParse(JSON.parse(target.target_json))
    if (!target || !parsed || !parsed.success || parsed.data.recordId !== entry.recordId || parsed.data.entityType !== 'program'
      || parsed.data.universityId !== report.universityId || parsed.data.identity.universityId !== report.universityId
      || !parsed.data.sourceIds.includes(entry.sourceId)) throw new MaintenanceError('reconciliation_published_target_parent_mismatch')
    const binding = `${entry.sourceId}\u0000${entry.recordId}`
    if (publishedBindings.has(binding)) throw new MaintenanceError('reconciliation_duplicate_published_mapping')
    publishedBindings.add(binding)
  }
  const reportSha256 = await digest(canonical(report)), evaluation = evaluateSchoolReconciliation(report)
  if (!cfg.seed_complete || !cfg.targets_complete) evaluation.blockers.push('active_targets_not_ready')
  if (report.scope !== 'full_official_catalog') evaluation.blockers.push('full_school_catalog_scope_required')
  if (input.reviewReceipt) await verifyHumanReceipt(env, input.reviewReceipt, report, reportSha256, cfg.scope_sha256, latestObservation, now)
  else evaluation.blockers.push('independent_human_review_required')
  evaluation.blockers = [...new Set(evaluation.blockers)].sort()
  evaluation.status = evaluation.blockers.length ? 'in_progress' : 'complete'
  const stored: StoredReport = { format: 'studyinchina.school-reconciliation-report', version: 1, observedAt: nowIso(now),
    scopeRegistrySha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256, reportSha256,
    report, evaluation, reviewReceipt: input.reviewReceipt ?? null }
  const raw = canonical(stored), sha256 = await digest(raw)
  const reportKey = `maintenance/reconciliations/reports/${report.universityId}/${sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(reportKey, raw, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  if (await digest(await bytes(env, reportKey, 3 * 1024 * 1024)) !== sha256) throw new MaintenanceError('reconciliation_report_write_conflict')
  const summary: Summary = { universityId: report.universityId, scopeRegistrySha256: cfg.scope_sha256, inputCatalogSha256: cfg.input_catalog_sha256,
    reportKey, sha256, reportSha256, status: evaluation.status, published: evaluation.published, accountedRows: evaluation.accountedRows,
    officialRows: evaluation.officialRows, blockers: evaluation.blockers, observedAt: stored.observedAt }
  const saved = await env.PIPELINE_DB.prepare("INSERT INTO maintenance_events(event_id,kind,observed_at,details_json) SELECT ?,'school_reconciliation_report',?,? WHERE EXISTS(SELECT 1 FROM maintenance_control WHERE singleton=1 AND scope_sha256=? AND input_catalog_sha256=? AND revision=?)")
    .bind(crypto.randomUUID(), stored.observedAt, canonical(summary), cfg.scope_sha256, cfg.input_catalog_sha256, cfg.revision).run()
  if (saved.meta?.changes !== 1) throw new MaintenanceError('reconciliation_catalogue_changed_during_validation')
  return { ok: true, ...summary }
}

async function bootstrapSchools(env: MaintenanceEnv): Promise<School[]> {
  // R2 retains the full fixed scope even while a shared D1 quota blocks seeding.
  for (const pointerKey of ['maintenance/bootstrap-pending/initial.v1.json', 'maintenance/bootstrap-pending/upload.v1.json']) {
    const pointerObject = await env.SNAPSHOTS_BUCKET.get(pointerKey)
    if (!pointerObject) continue
    const pointer = record(decode(await bytes(env, pointerKey, 64 * 1024)))
    if (!pointer || pointer.scopeRegistrySha256 !== env.SCOPE_REGISTRY_SHA256) throw new MaintenanceError('school_progress_bootstrap_scope_invalid')
    const initial = pointerKey.endsWith('/initial.v1.json'), hash = String(initial ? pointer.envelopeSha256 : pointer.rawSha256)
    const key = String(initial ? pointer.envelopeKey : pointer.rawKey)
    const expectedKey = initial ? `maintenance/bootstrap-pending/envelopes/${hash}.json` : `maintenance/bootstrap-pending/raw/${hash}.json`
    if (!HASH.test(hash) || key !== expectedKey) throw new MaintenanceError('school_progress_bootstrap_pointer_invalid')
    const raw = await bytes(env, key, 8 * 1024 * 1024)
    if (await digest(raw) !== hash) throw new MaintenanceError('school_progress_bootstrap_checksum_invalid')
    const envelope = record(decode(raw)), seed = record(envelope?.seed)
    if (!seed || seed.scopeRegistrySha256 !== env.SCOPE_REGISTRY_SHA256 || !Array.isArray(seed.schools) || seed.schools.length !== 272)
      throw new MaintenanceError('school_progress_bootstrap_scope_invalid')
    const schools = seed.schools.map(value => {
      const school = record(value)
      if (!school || !ID.test(String(school.universityId)) || !record(school.name)) throw new MaintenanceError('school_progress_bootstrap_school_invalid')
      return { university_id: String(school.universityId), name_json: JSON.stringify(school.name), last_attempt_at: null }
    })
    if (new Set(schools.map(school => school.university_id)).size !== 272) throw new MaintenanceError('school_progress_bootstrap_school_invalid')
    return schools
  }
  return []
}

async function verifiedSummary(env: MaintenanceEnv, summary: Summary, observations: Observation[], catalogSha256: string | null, now: number) {
  if (!ID.test(summary.universityId) || !HASH.test(summary.sha256) || summary.reportKey !== `maintenance/reconciliations/reports/${summary.universityId}/${summary.sha256}.json`)
    throw new MaintenanceError('school_progress_report_reference_invalid')
  const raw = await bytes(env, summary.reportKey, 3 * 1024 * 1024)
  if (await digest(raw) !== summary.sha256) throw new MaintenanceError('school_progress_report_checksum_invalid')
  const stored = decode(raw) as StoredReport
  const report = schoolReconciliationSchema.parse(stored.report)
  if (stored.format !== 'studyinchina.school-reconciliation-report' || stored.version !== 1 || report.universityId !== summary.universityId
    || stored.scopeRegistrySha256 !== env.SCOPE_REGISTRY_SHA256 || stored.reportSha256 !== await digest(canonical(report)))
    throw new MaintenanceError('school_progress_report_binding_invalid')
  const current = stored.inputCatalogSha256 === catalogSha256 && report.catalogs.every(catalog =>
    observations.find(observation => observation.source_id === catalog.sourceId)?.raw_sha256 === catalog.snapshotSha256)
  const evaluated = evaluateSchoolReconciliation(report)
  if (stored.evaluation.status === 'complete') {
    if (!stored.reviewReceipt || evaluated.status !== 'complete' || report.scope !== 'full_official_catalog')
      throw new MaintenanceError('school_progress_human_review_missing_or_incomplete')
    await verifyHumanReceipt(env, stored.reviewReceipt, report, stored.reportSha256, stored.scopeRegistrySha256, '', now)
  }
  return { status: current ? stored.evaluation.status : 'in_progress' as const, reportKey: summary.reportKey, sha256: summary.sha256,
    observedAt: stored.observedAt, published: stored.evaluation.published, accountedRows: stored.evaluation.accountedRows,
    officialRows: stored.evaluation.officialRows, blockers: current ? stored.evaluation.blockers : ['catalogue_or_source_changed_since_reconciliation'] }
}

/** Authenticated operations view; registration and queued jobs are never presented as completed checks. */
export async function listSchoolProgress(env: MaintenanceEnv, now = Date.now()) {
  if (!env.SCOPE_REGISTRY_SHA256 || !HASH.test(env.SCOPE_REGISTRY_SHA256)) throw new MaintenanceError('school_progress_scope_unconfigured')
  let schools: School[] = [], sources: Source[] = [], observations: Observation[] = [], summaries: Array<{ details_json: string }> = []
  let catalogSha256: string | null = null, backendState: 'observed' | 'quota_wait' | 'unavailable' = 'observed'
  try {
    const cfg = await control(env)
    if (cfg && cfg.scope_sha256 !== env.SCOPE_REGISTRY_SHA256) throw new MaintenanceError('school_progress_scope_mismatch')
    catalogSha256 = cfg?.seed_complete && cfg.targets_complete ? cfg.input_catalog_sha256 : null
    schools = (await env.PIPELINE_DB.prepare('SELECT university_id,name_json,last_attempt_at FROM maintenance_schools WHERE scope_sha256=? ORDER BY university_id')
      .bind(env.SCOPE_REGISTRY_SHA256).all<School>()).results ?? []
    sources = (await env.PIPELINE_DB.prepare('SELECT x.university_id,s.source_id,s.url,s.enabled,s.due_at,s.last_attempt_at,s.failures,s.error_code FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id JOIN maintenance_schools u ON u.university_id=x.university_id WHERE u.scope_sha256=?')
      .bind(env.SCOPE_REGISTRY_SHA256).all<Source>()).results ?? []
    observations = (await env.PIPELINE_DB.prepare('SELECT x.university_id,o.* FROM maintenance_observations o JOIN maintenance_source_schools x ON x.source_id=o.source_id JOIN maintenance_schools u ON u.university_id=x.university_id WHERE u.scope_sha256=? AND o.http_status BETWEEN 200 AND 299 AND o.snapshot_key IS NOT NULL ORDER BY o.checked_at DESC')
      .bind(env.SCOPE_REGISTRY_SHA256).all<Observation>()).results ?? []
    summaries = (await env.PIPELINE_DB.prepare("SELECT details_json FROM maintenance_events WHERE kind='school_reconciliation_report' ORDER BY observed_at DESC,event_id DESC").all<{ details_json: string }>()).results ?? []
  } catch (error) {
    if (error instanceof MaintenanceError) throw error
    backendState = isDailyD1QuotaError(error) ? 'quota_wait' : 'unavailable'
    // Partial reads must not become evidence of absence when the backend fails.
    schools = []; sources = []; observations = []; summaries = []; catalogSha256 = null
  }
  const pending = schools.length === 272 && backendState === 'observed' ? [] : await bootstrapSchools(env)
  const schoolMap = new Map(pending.map(school => [school.university_id, school]))
  for (const school of schools) schoolMap.set(school.university_id, school)
  const rows = []
  for (const school of [...schoolMap.values()].sort((a, b) => a.university_id.localeCompare(b.university_id))) {
    const schoolSources = sources.filter(source => source.university_id === school.university_id), enabled = schoolSources.filter(source => source.enabled === 1)
    const latest = new Map<string, Observation>()
    for (const observation of observations.filter(observation => observation.university_id === school.university_id))
      if (!latest.has(observation.source_id)) latest.set(observation.source_id, observation)
    const attempted = schoolSources.filter(source => source.last_attempt_at !== null).length
    const failed = schoolSources.filter(source => source.failures > 0 || source.error_code !== null).length
    const captured = schoolSources.filter(source => latest.has(source.source_id)).length
    const capturedEnabled = enabled.filter(source => latest.has(source.source_id)).length
    const failedEnabled = enabled.filter(source => source.failures > 0 || source.error_code !== null).length
    const nextDueAt = enabled.map(source => source.due_at).sort()[0] ?? null
    const attempts = [school.last_attempt_at, ...schoolSources.map(source => source.last_attempt_at)].filter((value): value is string => Boolean(value)).sort()
    let reconciliation: { status: 'pending' | 'in_progress' | 'complete'; blockers: string[] } & Omit<Partial<Awaited<ReturnType<typeof verifiedSummary>>>, 'status' | 'blockers'> = {
      status: 'pending', blockers: backendState === 'observed' ? [] : ['reconciliation_backend_not_observed'] }
    const summary = summaries.map(row => record(JSON.parse(row.details_json))).find(value => value?.universityId === school.university_id && value.scopeRegistrySha256 === env.SCOPE_REGISTRY_SHA256)
    if (summary) {
      try { reconciliation = await verifiedSummary(env, summary as Summary, [...latest.values()], catalogSha256, now) }
      catch { reconciliation = { status: 'in_progress', blockers: ['stored_reconciliation_evidence_unavailable_or_invalid'] } }
    }
    rows.push({ universityId: school.university_id, name: JSON.parse(school.name_json) as Record<string, string>,
      firstInspectionStatus: backendState !== 'observed' ? 'unknown' : attempted === 0 && captured === 0 ? 'pending'
        : enabled.length > 0 && capturedEnabled === enabled.length && failedEnabled === 0 ? 'observed' : 'in_progress',
      lastAttemptAt: attempts.at(-1) ?? null, sourceCount: backendState === 'observed' ? schoolSources.length : null,
      enabledSourceCount: backendState === 'observed' ? enabled.length : null,
      capturedSourceCount: backendState === 'observed' ? captured : null, failedSourceCount: backendState === 'observed' ? failed : null,
      pendingSourceCount: backendState === 'observed' ? enabled.length - capturedEnabled : null, nextDueAt,
      snapshots: [...latest.values()].map(observation => ({ sourceId: observation.source_id,
        url: schoolSources.find(source => source.source_id === observation.source_id)?.url ?? observation.final_url,
        rawSha256: observation.raw_sha256, snapshotKey: observation.snapshot_key, checkedAt: observation.checked_at })), reconciliation })
  }
  return { format: 'studyinchina.school-maintenance-progress', version: 1, scopeRegistrySha256: env.SCOPE_REGISTRY_SHA256,
    observedAt: nowIso(now), backendState, expectedSchools: 272, seededSchoolCount: backendState === 'observed' ? schools.length : null,
    counts: { schools: rows.length, attempted: backendState === 'observed' ? rows.filter(school => school.lastAttemptAt).length : null,
      observed: backendState === 'observed' ? rows.filter(school => school.firstInspectionStatus === 'observed').length : null,
      reconciled: backendState === 'observed' ? rows.filter(school => school.reconciliation.status === 'complete').length : null }, schools: rows }
}
