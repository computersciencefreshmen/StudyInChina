import { z } from 'zod'
import { sha256Schema, timestampSchema } from '../../../scripts/maintenance/contracts'
import { loadSnapshot } from './capture'
import { control, queueExtraction, source } from './repository'
import type { MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { digest } from './util'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_DOCUMENT_PAGES = 100
export const DOCUMENT_BATCH_LIMIT = 5

export type PendingDocument = {
  sourceId: string; sourceUrl: string; finalUrl: string; snapshotKey: string; rawKey: string;
  rawSha256: string; checkedAt: string; contentType: string
}

export const documentDerivativeSchema = z.object({
  sourceId: sha256Schema, snapshotKey: z.string().min(1), rawKey: z.string().min(1), rawSha256: sha256Schema,
  text: z.string().min(1).refine(text => Boolean(text.trim())), textSha256: sha256Schema,
  parser: z.enum(['poppler', 'tesseract']), pageCount: z.number().int().min(1).max(MAX_DOCUMENT_PAGES),
  processedAt: timestampSchema,
}).strict()
const documentFailureSchema = z.object({
  outcome: z.literal('held'), sourceId: sha256Schema, rawSha256: sha256Schema,
  reason: z.string().regex(/^document_[a-z_]{1,100}$/u), reportedAt: timestampSchema,
}).strict()

export async function listPendingDocuments(env: MaintenanceEnv, limit = DOCUMENT_BATCH_LIMIT): Promise<{ documents: PendingDocument[] }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > DOCUMENT_BATCH_LIMIT) throw new MaintenanceError('document_limit_invalid')
  const cfg = await control(env)
  if (!cfg?.seed_complete) throw new MaintenanceError('maintenance_seed_incomplete')
  const canary = JSON.parse(cfg.canary_json) as string[]
  const rows = (await env.PIPELINE_DB.prepare(`
    SELECT s.source_id,s.url,s.raw_sha256,s.snapshot_key FROM maintenance_sources s
    WHERE s.enabled=1 AND s.raw_sha256 IS NOT NULL AND s.snapshot_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM maintenance_observations o WHERE o.source_id=s.source_id
      AND o.raw_sha256=s.raw_sha256 AND o.outcome='rich_document_pending')
    AND NOT EXISTS(SELECT 1 FROM maintenance_document_derivatives d
      WHERE d.source_id=s.source_id AND d.raw_sha256=s.raw_sha256)
    AND NOT EXISTS(SELECT 1 FROM maintenance_document_failures f
      WHERE f.source_id=s.source_id AND f.raw_sha256=s.raw_sha256)
    ${canary.length ? `AND EXISTS(SELECT 1 FROM maintenance_source_schools x WHERE x.source_id=s.source_id AND x.university_id IN(${canary.map(() => '?').join(',')}))` : ''}
    ORDER BY s.last_success_at,s.source_id LIMIT ?
  `).bind(...canary, limit).all<{ source_id: string; url: string; raw_sha256: string; snapshot_key: string }>()).results ?? []
  const documents: PendingDocument[] = []
  for (const row of rows) {
    const snapshot = await loadSnapshot(env, row.snapshot_key)
    if (snapshot.sourceId !== row.source_id || snapshot.rawSha256 !== row.raw_sha256
      || !/^application\/pdf(?:;|$)/iu.test(snapshot.contentType)) continue
    documents.push({ sourceId: row.source_id, sourceUrl: snapshot.sourceUrl, finalUrl: snapshot.finalUrl,
      snapshotKey: row.snapshot_key, rawKey: snapshot.rawKey, rawSha256: snapshot.rawSha256,
      checkedAt: snapshot.checkedAt, contentType: snapshot.contentType })
  }
  return { documents }
}

/** A text derivative proves parsing of already captured bytes; it never renews the acquisition time. */
export async function acceptDocumentDerivative(env: MaintenanceEnv, input: unknown) {
  const failure = documentFailureSchema.safeParse(input)
  if (failure.success) {
    const value = failure.data, row = await source(env, value.sourceId)
    if (!row?.enabled || row.raw_sha256 !== value.rawSha256) throw new MaintenanceError('document_source_changed')
    await env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_document_failures(source_id,raw_sha256,reason,reported_at) VALUES(?,?,?,?)')
      .bind(value.sourceId, value.rawSha256, value.reason, value.reportedAt).run()
    return { ok: true, held: true, sourceId: value.sourceId, rawSha256: value.rawSha256 }
  }
  const parsed = documentDerivativeSchema.safeParse(input)
  if (!parsed.success) throw new MaintenanceError('document_derivative_invalid')
  const value = parsed.data, row = await source(env, value.sourceId)
  if (!row?.enabled || row.raw_sha256 !== value.rawSha256 || row.snapshot_key !== value.snapshotKey) throw new MaintenanceError('document_source_changed')
  const snapshot = await loadSnapshot(env, value.snapshotKey)
  if (snapshot.sourceId !== value.sourceId || snapshot.rawSha256 !== value.rawSha256 || snapshot.rawKey !== value.rawKey
    || !/^application\/pdf(?:;|$)/iu.test(snapshot.contentType)) throw new MaintenanceError('document_snapshot_binding_invalid')
  if (new Date(value.processedAt).valueOf() < new Date(snapshot.checkedAt).valueOf()) throw new MaintenanceError('document_processed_before_capture')
  const textBytes = new TextEncoder().encode(value.text)
  if (textBytes.byteLength > MAX_DOCUMENT_TEXT_BYTES || await digest(textBytes) !== value.textSha256) throw new MaintenanceError('document_text_checksum_or_size_invalid')
  const pages = value.text.split('\f').filter((page, index, all) => index !== all.length - 1 || page.trim())
  if (pages.length > value.pageCount) throw new MaintenanceError('document_text_page_count_invalid')
  const raw = await env.SNAPSHOTS_BUCKET.get(value.rawKey)
  if (!raw || raw.size !== undefined && raw.size > MAX_DOCUMENT_BYTES) throw new MaintenanceError('document_raw_unavailable')
  const rawBytes = await raw.arrayBuffer()
  if (rawBytes.byteLength > MAX_DOCUMENT_BYTES || await digest(rawBytes) !== value.rawSha256
    || !new TextDecoder().decode(rawBytes.slice(0, 5)).startsWith('%PDF-')) throw new MaintenanceError('document_raw_checksum_invalid')
  const prior = await env.PIPELINE_DB.prepare('SELECT text_key,text_sha256,parser,page_count FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?')
    .bind(value.sourceId, value.rawSha256).first<{ text_key: string; text_sha256: string; parser: string; page_count: number }>()
  if (prior) {
    if (prior.text_sha256 !== value.textSha256 || prior.parser !== value.parser || prior.page_count !== value.pageCount) throw new MaintenanceError('document_derivative_conflict')
    await queueExtraction(env, row, value.rawSha256, value.snapshotKey)
    return { ok: true, reused: true, textKey: prior.text_key, textSha256: prior.text_sha256, checkedAt: snapshot.checkedAt }
  }
  const textKey = `maintenance/text/${value.sourceId}/${value.textSha256}.txt`
  await env.SNAPSHOTS_BUCKET.put(textKey, value.text, { httpMetadata: { contentType: 'text/plain;charset=utf-8' } })
  await env.PIPELINE_DB.prepare(`INSERT OR IGNORE INTO maintenance_document_derivatives
    (source_id,raw_sha256,snapshot_key,raw_key,text_key,text_sha256,parser,page_count,processed_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM maintenance_sources
      WHERE source_id=? AND enabled=1 AND raw_sha256=? AND snapshot_key=?)`)
    .bind(value.sourceId, value.rawSha256, value.snapshotKey, value.rawKey, textKey, value.textSha256,
      value.parser, value.pageCount, value.processedAt, value.sourceId, value.rawSha256, value.snapshotKey).run()
  const saved = await env.PIPELINE_DB.prepare('SELECT text_key,text_sha256 FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=?')
    .bind(value.sourceId, value.rawSha256).first<{ text_key: string; text_sha256: string }>()
  if (!saved || saved.text_sha256 !== value.textSha256) throw new MaintenanceError('document_source_changed_or_derivative_conflict')
  await queueExtraction(env, row, value.rawSha256, value.snapshotKey)
  return { ok: true, reused: false, textKey, textSha256: value.textSha256, checkedAt: snapshot.checkedAt }
}
