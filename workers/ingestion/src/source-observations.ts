import { sha256Hex } from './hash'
import { htmlToText } from './rules'
import type { IngestionEnv, IngestionJob } from './types'

const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1_000

/** Freshness follows a real complete body observation, never source.last_checked_at. */
export async function sourceRevalidationDue(
  database: IngestionEnv['INGESTION_DB'], snapshotId: string, now: Date,
): Promise<boolean> {
  const row = await database.prepare(`
    SELECT snapshot.fetched_at, snapshot.content_type, (
      SELECT MAX(observed_at) FROM ingestion_source_observations observation
      WHERE observation.snapshot_id = snapshot.snapshot_id
    ) AS observed_at FROM ingestion_snapshots snapshot WHERE snapshot.snapshot_id = ?1
  `).bind(snapshotId).first<{ fetched_at: string; content_type: string; observed_at: string | null }>()
  if (!row || !/^(text\/|application\/(?:json|xhtml\+xml))/i.test(row.content_type)) return false
  const lastObserved = Date.parse(row.observed_at ?? row.fetched_at)
  return Number.isFinite(lastObserved) && now.getTime() - lastObserved >= REVALIDATION_INTERVAL_MS
}

function comparableText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function evidencePresent(raw: string, bodyText: string): boolean {
  try {
    const rows: unknown = JSON.parse(raw)
    return Array.isArray(rows) && rows.length > 0 && rows.every((row) => {
      if (!row || typeof row !== 'object') return false
      const item = row as { primary?: { quote?: unknown }; secondary?: { quote?: unknown } | null }
      return [item.primary, ...(item.secondary ? [item.secondary] : [])].every((evidence) =>
        typeof evidence?.quote === 'string' && comparableText(evidence.quote).length > 0
          && bodyText.includes(comparableText(evidence.quote)))
    })
  } catch { return false }
}

/** Reuse only already accepted same-byte facts and the current extractor fingerprint.
 * The original immutable artifact is also the byte-for-byte artifact of this observation.
 * Binary documents await an equivalent derivative proof; they are never silently renewed.
 */
export async function observeUnchangedOfficialBody(
  environment: Pick<IngestionEnv, 'INGESTION_DB' | 'SNAPSHOTS_BUCKET'>,
  input: {
    job: IngestionJob; snapshotId: string; body: ArrayBuffer; contentType: string;
    finalUrl: string; checkedAt: string; httpStatus: number;
    extractorFingerprints: readonly string[];
  },
): Promise<{ observationId: string | null; candidatesCreated: number }> {
  if (input.httpStatus !== 200 || !/^(text\/|application\/(?:json|xhtml\+xml))/i.test(input.contentType)) {
    return { observationId: null, candidatesCreated: 0 }
  }
  const database = environment.INGESTION_DB
  if (!(await sourceRevalidationDue(database, input.snapshotId, new Date(input.checkedAt)))) {
    return { observationId: null, candidatesCreated: 0 }
  }
  const snapshot = await database.prepare(`
    SELECT snapshot.source_id, snapshot.raw_sha256, snapshot.byte_length, snapshot.final_url, snapshot.r2_key
    FROM ingestion_snapshots snapshot JOIN ingestion_sources source ON source.source_id = snapshot.source_id
    WHERE snapshot.snapshot_id = ?1 AND source.enabled = 1 AND source.raw_sha256 = snapshot.raw_sha256
  `).bind(input.snapshotId).first<{ source_id: string; raw_sha256: string; byte_length: number; final_url: string; r2_key: string }>()
  const hash = await sha256Hex(input.body)
  if (!snapshot || snapshot.source_id !== input.job.sourceId || snapshot.raw_sha256 !== hash
    || Number(snapshot.byte_length) !== input.body.byteLength || snapshot.final_url !== input.finalUrl) {
    throw new Error('Revalidation body does not match the immutable official snapshot')
  }
  if (!(await environment.SNAPSHOTS_BUCKET.head(snapshot.r2_key))) {
    throw new Error('Revalidation requires the matching immutable body artifact to remain available')
  }
  const observationId = 'observation-' + await sha256Hex(input.job.sourceId + ':' + input.snapshotId + ':' + input.job.jobId)
  const receipt = database.prepare(`
    INSERT OR IGNORE INTO ingestion_source_observations
      (observation_id, source_id, snapshot_id, job_id, observed_at, http_status,
       body_sha256, byte_length, final_url, proof_kind)
    VALUES (?1, ?2, ?3, ?4, ?5, 200, ?6, ?7, ?8, 'complete-body-sha256')
  `).bind(observationId, input.job.sourceId, input.snapshotId, input.job.jobId,
    input.checkedAt, hash, input.body.byteLength, input.finalUrl)
  const body = new TextDecoder().decode(input.body)
  const bodyText = comparableText(input.contentType.toLowerCase().includes('html') ? htmlToText(body) : body)
  const result = await database.prepare(`
    SELECT candidate.candidate_id, candidate.facts_json, provenance.field_evidence_json,
           provenance.extractor_fingerprint
    FROM ingestion_candidates candidate
    JOIN candidate_promotions promotion ON promotion.candidate_id = candidate.candidate_id
    JOIN ingestion_candidate_provenance provenance ON provenance.candidate_id = candidate.candidate_id
    WHERE candidate.source_id = ?1 AND candidate.snapshot_id = ?2
      AND candidate.candidate_status = 'applied' AND promotion.promotion_status = 'applied'
      AND candidate.gate_status IN ('rule-pass', 'dual-pass')
      AND json_array_length(candidate.facts_json) > 0
    ORDER BY candidate.created_at DESC, candidate.candidate_id LIMIT 100
  `).bind(input.job.sourceId, input.snapshotId).all<{
    candidate_id: string; facts_json: string; field_evidence_json: string; extractor_fingerprint: string
  }>()
  if (!result.success) throw new Error(result.error ?? 'Could not load prior accepted extraction')
  // One prior result per fingerprint prevents observation chains from multiplying candidates.
  const selected = new Set<string>()
  const statements = [receipt]
  let candidatesCreated = 0
  for (const candidate of result.results ?? []) {
    if (!input.extractorFingerprints.includes(candidate.extractor_fingerprint)
      || selected.has(candidate.extractor_fingerprint)
      || !evidencePresent(candidate.field_evidence_json, bodyText)) continue
    selected.add(candidate.extractor_fingerprint)
    const candidateId = 'renewal-' + await sha256Hex(observationId + ':' + candidate.candidate_id)
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO ingestion_candidates
        (candidate_id, source_id, snapshot_id, extractor, gate_status, candidate_status,
         facts_json, issues_json, created_at, validated_at)
      SELECT ?1, source_id, snapshot_id, extractor, gate_status, 'validated',
        facts_json, issues_json, ?3, ?3 FROM ingestion_candidates WHERE candidate_id = ?2
    `).bind(candidateId, candidate.candidate_id, input.checkedAt))
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO ingestion_candidate_provenance
        (candidate_id, schema_version, model_name, prompt_fingerprint, extractor_fingerprint,
         primary_extraction_json, secondary_extraction_json, field_evidence_json, contains_critical, created_at)
      SELECT ?1, schema_version, model_name, prompt_fingerprint, extractor_fingerprint,
        primary_extraction_json, secondary_extraction_json, field_evidence_json, contains_critical, ?3
      FROM ingestion_candidate_provenance WHERE candidate_id = ?2
    `).bind(candidateId, candidate.candidate_id, input.checkedAt))
    statements.push(database.prepare(`
      INSERT OR IGNORE INTO ingestion_candidate_observations
        (candidate_id, observation_id, original_candidate_id) VALUES (?1, ?2, ?3)
    `).bind(candidateId, observationId, candidate.candidate_id))
    candidatesCreated += 1
  }
  const persisted = await database.batch(statements)
  for (const row of persisted) if (!row.success) throw new Error(row.error ?? 'Could not persist revalidation receipt')
  return { observationId, candidatesCreated }
}
