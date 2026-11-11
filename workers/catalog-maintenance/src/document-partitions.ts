import type { CapturedSnapshot } from './capture'
import type { JobRow, MaintenanceEnv, SourceRow } from './types'
import type { MaintenanceRecordTarget } from '../../../scripts/maintenance/field-contracts'
import type { MaintenanceProposal } from '../../../scripts/maintenance/contracts'
import { persistProposals } from './proposals'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, record } from './util'
import { htmlToText } from '../../ingestion/src/rules'
import { decodeOfficialBody } from './capture'

export type PartitionEngine = 'program' | 'scholarship' | 'fields' | 'cycles'
type Span = { start: number; end: number; sha256: string; boundary: 'chapter' | 'paragraph' | 'continuous' | 'end' }
export type DocumentPartitionManifest = {
  format: 'studyinchina.complete-document-partitions'; version: 1; sourceId: string; rawSnapshotSha256: string;
  textSha256: string; textKey: string; textLength: number; chapterOffsets: number[]; partitions: Span[]; fullCoverage: true; sha256: string
}
export type DocumentPartitionContext = {
  manifestKey: string; manifestSha256: string; partitionIndex: number; unitIndex: number; rawSnapshotSha256: string;
  fullTextSha256: string; fullText: string; text: string; body: Span; contexts: Span[]; snapshot: CapturedSnapshot
}
export type PartitionSegmentResult = { proposals: MaintenanceProposal[]; held: Array<{ recordId: string; reason: string }>; capacityLimited?: boolean }
type ResultRef = { key: string; sha256: string }
type Cursor = { version: 1; jobId: string; checkedAt: string; manifestSha256: string; engine: PartitionEngine; targetScopeSha256: string;
  nextUnit: number; drainUnit: number; results: ResultRef[]; claimValues: Record<string, string>; conflicts: string[];
  ready: number; held: number; unfinishedSections: number; completed: boolean }
const BODY_LIMIT = 44_000, MAX_PARTS = 128, MAX_TEXT_BYTES = 2 * 1024 * 1024
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const quoteContexts = new WeakMap<DocumentPartitionContext, { full: string; ranges: Array<{ span: Span; text: string }> }>()

/** Every UTF-16 source position belongs to exactly one owned span. Headings and
 * paragraphs are preferred; oversized sections remain explicit continuous spans. */
export async function buildDocumentPartitions(sourceId: string, snapshot: CapturedSnapshot, text: string, chapterOffsets: number[] = []): Promise<DocumentPartitionManifest> {
  if (!snapshot.textKey || !snapshot.textSha256 || await digest(text) !== snapshot.textSha256) throw new MaintenanceError('partition_full_text_binding_invalid')
  const partitions: Span[] = []
  for (let start = 0; start < text.length;) {
    const hardEnd = Math.min(text.length, start + BODY_LIMIT)
    let end = hardEnd, boundary: Span['boundary'] = hardEnd === text.length ? 'end' : 'continuous'
    if (hardEnd < text.length) {
      const minimum = start + Math.floor(BODY_LIMIT / 2), window = text.slice(minimum, hardEnd)
      const headings = [...text.slice(start, hardEnd).matchAll(/(?:\n|\f)(?:#{1,6}\s|第[一二三四五六七八九十百\d]+[章节]|\d{1,2}[.、]\s)/gu)]
        .map(match => start + (match.index ?? 0)).filter(offset => offset > start)
      const chapter = [...headings, ...chapterOffsets.filter(offset => offset > start && offset <= hardEnd)].sort((a, b) => a - b).at(-1)
      if (chapter !== undefined) { end = chapter; boundary = 'chapter' }
      else {
        const paragraph = window.lastIndexOf('\n\n'), page = window.lastIndexOf('\f')
        const selected = Math.max(paragraph, page)
        if (selected >= 0) { end = minimum + selected + (selected === page ? 1 : 2); boundary = 'paragraph' }
        else {
          const whitespace = window.lastIndexOf(' ')
          if (whitespace >= 0) end = minimum + whitespace + 1
        }
      }
      // Never split one Unicode surrogate pair between requests.
      if (end > start && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--
    }
    if (end <= start) throw new MaintenanceError('partition_nonprogressing_boundary')
    partitions.push({ start, end, sha256: await digest(text.slice(start, end)), boundary }); start = end
  }
  if (!partitions.length || partitions.length > MAX_PARTS) throw new MaintenanceError('partition_capacity_requires_review')
  const content = { format: 'studyinchina.complete-document-partitions' as const, version: 1 as const, sourceId,
    rawSnapshotSha256: snapshot.rawSha256, textSha256: snapshot.textSha256, textKey: snapshot.textKey,
    textLength: text.length, chapterOffsets, partitions, fullCoverage: true as const }
  return { ...content, sha256: await digest(canonical(content)) }
}

export function partitionEvidenceLocator(context: DocumentPartitionContext | undefined, quote: string): string {
  if (!context) return 'text:document'
  const normalized = normalize(quote)
  let checked = quoteContexts.get(context)
  if (!checked) {
    checked = { full: normalize(context.fullText), ranges: [context.body, ...context.contexts].map(span => ({ span, text: normalize(context.fullText.slice(span.start, span.end)) })) }
    quoteContexts.set(context, checked)
  }
  if (!normalized || !checked.full.includes(normalized)) throw new MaintenanceError('partition_quote_not_in_original')
  const span = checked.ranges.find(range => range.text.includes(normalized))?.span
  if (!span) throw new MaintenanceError('partition_quote_outside_admitted_ranges')
  return `text:offset:${span.start}:${span.end}`
}

export function partitionReviewScope(context?: DocumentPartitionContext) {
  return context ? { documentPartition: { manifestKey: context.manifestKey, manifestSha256: context.manifestSha256,
    partitionIndex: context.partitionIndex, ownedRange: context.body, contextRanges: context.contexts,
    originalTextSha256: context.fullTextSha256, originalSnapshotSha256: context.rawSnapshotSha256 } } : {}
}

export function partitionSourceText(context: DocumentPartitionContext | undefined, snapshot: CapturedSnapshot, fullText: string): string {
  if (!context) return fullText
  if (context.rawSnapshotSha256 !== snapshot.rawSha256 || context.fullTextSha256 !== snapshot.textSha256 || context.fullText !== fullText) throw new MaintenanceError('partition_engine_context_binding_invalid')
  return context.text
}

async function immutable(env: MaintenanceEnv, key: string, text: string) {
  await env.SNAPSHOTS_BUCKET.put(key, text, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
  const saved = await env.SNAPSHOTS_BUCKET.get(key)
  if (!saved || await saved.text() !== text) throw new MaintenanceError('partition_immutable_artifact_conflict')
}

async function proposalClaims(proposal: MaintenanceProposal): Promise<Array<[string, string]>> {
  const fields = proposal.fields, patches = Array.isArray(fields.patches) ? fields.patches : null
  const scope = canonical({ universityId: proposal.universityId, entityType: proposal.entityType, recordId: proposal.recordId,
    scope: proposal.scope, ...(proposal.entityType === 'admission-cycle' ? { programId: fields.programId ?? null } : {}) })
  if (patches) {
    const claims = await Promise.all(patches.map(async value => {
    const patch = record(value)
    return [await digest(`${scope}:${String(patch?.fieldPath)}`), await digest(canonical({ value: patch?.value, factStatus: patch?.factStatus }))] as [string, string]
    }))
    if (proposal.operation === 'create') claims.push([await digest(`complete-create:${proposal.id}`), await digest(canonical(patches))])
    return claims
  }
  // Identity variants with the same official code must not silently pick a
  // different name/provider in a later chapter. Names are the fallback key.
  const key = canonical({ school: proposal.universityId, type: proposal.entityType, code: fields.officialProgramCode ?? fields.name,
    degree: fields.degreeLevel ?? null, programType: fields.programType ?? null })
  return [[await digest(key), await digest(canonical({ name: fields.name, degree: fields.degreeLevel ?? null,
    programType: fields.programType ?? null, provider: fields.providerType ?? null, department: fields.departmentCode ?? null }))]]
}

function quotesInProposal(proposal: MaintenanceProposal): string[] {
  const fields = proposal.fields
  return [proposal.source.quote, ...proposal.fieldEvidence.map(evidence => evidence.quote),
    ...['internationalAdmissionsEvidence', 'institutionEvidence', 'programEvidence', 'cycleScopeEvidence'].flatMap(key => {
      const evidence = record(fields[key]); return typeof evidence?.quote === 'string' ? [evidence.quote] : []
    })]
}

/** One invocation performs one bounded model segment OR one <=100-row publish
 * drain. Results precede cursor CAS; publication precedes drain CAS. Paid
 * unknowns stop the whole original source/snapshot, never skip to another part. */
export async function runPartitionedDocument(env: MaintenanceEnv, job: JobRow, row: SourceRow, snapshot: CapturedSnapshot,
  engine: PartitionEngine, targets: MaintenanceRecordTarget[],
  runSegment: (context: DocumentPartitionContext, targets: MaintenanceRecordTarget[]) => Promise<PartitionSegmentResult>) {
  const threshold = engine === 'program' || engine === 'scholarship' ? 50_000 : 100_000
  const unhandled = { handled: false, pending: false, ready: 0, held: 0, completeDocumentScan: false,
    completeSchoolCatalogueClaimed: false, conflictingClaims: 0, unfinishedSections: 0 }
  if (!snapshot.textKey || !snapshot.textSha256) return unhandled
  const object = await env.SNAPSHOTS_BUCKET.get(snapshot.textKey)
  if (!object || object.size !== undefined && object.size > MAX_TEXT_BYTES) throw new MaintenanceError('partition_full_text_unavailable')
  const fullText = await object.text()
  if (await digest(fullText) !== snapshot.textSha256 || snapshot.sourceId !== row.source_id || snapshot.rawSha256 !== job.snapshot_sha256) throw new MaintenanceError('partition_snapshot_binding_invalid')
  if (fullText.length <= threshold) return unhandled
  const chapterOffsets: number[] = []
  if (/html/iu.test(snapshot.contentType)) {
    const raw = await env.SNAPSHOTS_BUCKET.get(snapshot.rawKey)
    if (!raw || raw.size !== undefined && raw.size > 10 * 1024 * 1024) throw new MaintenanceError('partition_raw_html_unavailable')
    const bytes = await raw.arrayBuffer()
    if (await digest(bytes) !== snapshot.rawSha256) throw new MaintenanceError('partition_raw_html_checksum_invalid')
    let after = 0
    for (const heading of decodeOfficialBody(bytes, snapshot.contentType).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu)) {
      const label = htmlToText(heading[1]), position = label ? fullText.indexOf(label, after) : -1
      if (position >= 0) { chapterOffsets.push(position); after = position + label.length }
    }
  }
  const manifest = await buildDocumentPartitions(row.source_id, snapshot, fullText, chapterOffsets), manifestKey = `maintenance/partitions/manifests/${manifest.sha256}.json`
  await immutable(env, manifestKey, canonical(manifest))
  const sortedTargets = [...targets].sort((a, b) => a.recordId.localeCompare(b.recordId)), targetLimit = engine === 'cycles' ? 10 : 20
  const batches = Math.max(1, Math.ceil(sortedTargets.length / targetLimit)), totalUnits = manifest.partitions.length * batches
  if (totalUnits > 1024) throw new MaintenanceError('partition_target_capacity_requires_review')
  const targetScopeSha256 = await digest(canonical(sortedTargets)), auditScope = await digest(canonical({ jobId: job.job_id, checkedAt: snapshot.checkedAt, targetScopeSha256, engine }))
  const cursorKey = `maintenance/partitions/jobs/${job.job_id}/${auditScope}.json`
  const cursorObject = await env.SNAPSHOTS_BUCKET.get(cursorKey)
  const cursor: Cursor = cursorObject ? JSON.parse(await cursorObject.text()) as Cursor : { version: 1, jobId: job.job_id, checkedAt: snapshot.checkedAt,
    manifestSha256: manifest.sha256, engine, targetScopeSha256, nextUnit: 0, drainUnit: 0, results: [], claimValues: {}, conflicts: [], ready: 0, held: 0, unfinishedSections: 0, completed: false }
  if (cursor.jobId !== job.job_id || cursor.checkedAt !== snapshot.checkedAt || cursor.manifestSha256 !== manifest.sha256 || cursor.engine !== engine || cursor.targetScopeSha256 !== targetScopeSha256
    || cursor.nextUnit !== cursor.results.length || cursor.nextUnit > totalUnits || cursor.drainUnit > cursor.nextUnit) throw new MaintenanceError('partition_cursor_scope_changed')
  const save = async () => {
    const saved = await env.SNAPSHOTS_BUCKET.put(cursorKey, canonical(cursor), { onlyIf: cursorObject?.etag ? { etagMatches: cursorObject.etag } : { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } })
    if (saved === null) throw new MaintenanceError('partition_cursor_cas_conflict')
  }
  const observation = (pending: boolean) => ({ handled: true, pending, ready: cursor.ready, held: cursor.held,
    manifestSha256: manifest.sha256, completedPartitions: Math.floor(cursor.nextUnit / batches), totalPartitions: manifest.partitions.length,
    completeDocumentScan: cursor.nextUnit === totalUnits, unfinishedSections: cursor.unfinishedSections, conflictingClaims: cursor.conflicts.length, completeSchoolCatalogueClaimed: false })
  if (cursor.completed) return observation(false)
  // Equivalent captured text (including a later byte-only HTML change) cannot
  // escape an earlier unknown source scope by acquiring a fresh raw hash.
  const aliases = 'snapshot_sha256 IN(SELECT raw_sha256 FROM maintenance_observations WHERE source_id=? AND canonical_sha256=? UNION SELECT raw_sha256 FROM maintenance_document_derivatives WHERE source_id=? AND text_sha256=?)'
  const inFlight = await env.PIPELINE_DB.prepare(`SELECT * FROM(SELECT status,started_at FROM maintenance_model_attempts WHERE source_id=? AND (snapshot_sha256=? OR ${aliases}) AND status IN('unknown','send_started','reserved') UNION ALL SELECT 'unknown' status,NULL started_at FROM maintenance_jobs WHERE source_id=? AND (snapshot_sha256=? OR ${aliases}) AND status='unknown') ORDER BY status='unknown' DESC,started_at LIMIT 1`)
    .bind(row.source_id, snapshot.rawSha256, row.source_id, snapshot.textSha256, row.source_id, snapshot.textSha256,
      row.source_id, snapshot.rawSha256, row.source_id, snapshot.textSha256, row.source_id, snapshot.textSha256).first<{ status: string; started_at: string | null }>()
  if (inFlight) {
    if (inFlight.status === 'unknown' || !inFlight.started_at || !Number.isFinite(Date.parse(inFlight.started_at)) || Date.parse(inFlight.started_at) <= Date.now() - 120000) throw new MaintenanceError('partition_original_source_outcome_unknown')
    throw new MaintenanceError('model_capacity_partition_source_busy', 20)
  }
  if (cursor.nextUnit < totalUnits) {
    const unit = cursor.nextUnit, partIndex = Math.floor(unit / batches), body = manifest.partitions[partIndex]
    const contexts: Span[] = []
    if (body.start > 0) {
      const headerEnd = Math.min(1600, body.start)
      contexts.push({ start: 0, end: headerEnd, sha256: await digest(fullText.slice(0, headerEnd)), boundary: 'continuous' })
      const prior = fullText.slice(0, body.start), heading = [...prior.matchAll(/(?:\n|\f)(?:#{1,6}\s|第[一二三四五六七八九十百\d]+[章节]|\d{1,2}[.、]\s)[^\n\f]{1,180}/gu)].at(-1)
      const htmlHeading = chapterOffsets.filter(offset => offset < body.start).at(-1)
      const start = Math.max(heading?.index ?? -1, htmlHeading ?? -1)
      if (start >= 0) {
        const end = Math.min(body.start, start + (start === heading?.index ? heading[0].length : 180))
        contexts.push({ start, end, sha256: await digest(fullText.slice(start, end)), boundary: 'chapter' })
      }
    }
    const context: DocumentPartitionContext = { manifestKey, manifestSha256: manifest.sha256, partitionIndex: partIndex, unitIndex: unit,
      rawSnapshotSha256: snapshot.rawSha256, fullTextSha256: snapshot.textSha256, fullText,
      text: [...contexts.map(span => fullText.slice(span.start, span.end)), fullText.slice(body.start, body.end)].join('\n\n'), body, contexts,
      snapshot: { ...snapshot, ...(!snapshot.textArtifact ? { textArtifact: { objectKey: snapshot.textKey, sha256: snapshot.textSha256,
        rawSnapshotSha256: snapshot.rawSha256, parser: 'official-response-text-v1' as const } } : {}) } }
    const resultPrefix = `maintenance/partitions/results/${job.job_id}/${auditScope}/${unit}/`, resultPointerKey = `${resultPrefix}pointer.json`
    const priorResult = await env.SNAPSHOTS_BUCKET.get(resultPointerKey)
    let result: PartitionSegmentResult
    let resultRef: ResultRef
    if (priorResult) {
      const pointer = JSON.parse(await priorResult.text()) as ResultRef & { manifestSha256: string; unit: number }
      if (!HASH.test(pointer.sha256) || pointer.key !== `${resultPrefix}${pointer.sha256}.json` || pointer.manifestSha256 !== manifest.sha256 || pointer.unit !== unit) throw new MaintenanceError('partition_result_pointer_invalid')
      const object = await env.SNAPSHOTS_BUCKET.get(pointer.key), text = object ? await object.text() : ''
      if (await digest(text) !== pointer.sha256) throw new MaintenanceError('partition_result_checksum_invalid')
      result = JSON.parse(text) as PartitionSegmentResult; resultRef = { key: pointer.key, sha256: pointer.sha256 }
    }
    else {
      result = await runSegment(context, sortedTargets.slice((unit % batches) * targetLimit, (unit % batches + 1) * targetLimit))
      if (result.proposals.length > 100) throw new MaintenanceError('partition_result_capacity_exceeded')
      const checked: MaintenanceProposal[] = []
      for (const proposal of result.proposals) {
        if (proposal.source.id !== row.source_id || proposal.source.snapshotSha256 !== snapshot.rawSha256) throw new MaintenanceError('partition_proposal_source_changed')
        try { quotesInProposal(proposal).forEach(quote => partitionEvidenceLocator(context, quote)); checked.push(proposal) }
        catch { result.held.push({ recordId: proposal.recordId ?? proposal.id, reason: 'partition_quote_outside_original_ranges' }) }
      }
      result.proposals = [...new Map(checked.map(proposal => [proposal.id, proposal])).values()]
      const text = canonical(result), sha256 = await digest(text)
      resultRef = { key: `${resultPrefix}${sha256}.json`, sha256 }
      await immutable(env, resultRef.key, text)
      await immutable(env, resultPointerKey, canonical({ ...resultRef, manifestSha256: manifest.sha256, unit }))
    }
    for (const proposal of result.proposals) for (const [key, value] of await proposalClaims(proposal)) {
      if (cursor.claimValues[key] && cursor.claimValues[key] !== value && !cursor.conflicts.includes(key)) cursor.conflicts.push(key)
      else cursor.claimValues[key] = value
    }
    cursor.results.push(resultRef); cursor.nextUnit++; cursor.held += result.held.length
    if (result.capacityLimited) cursor.unfinishedSections++
    await save(); return observation(true)
  }
  const ref = cursor.results[cursor.drainUnit], resultObject = ref ? await env.SNAPSHOTS_BUCKET.get(ref.key) : null
  if (!ref || !resultObject) throw new MaintenanceError('partition_completed_result_missing')
  const resultText = await resultObject.text()
  if (await digest(resultText) !== ref.sha256) throw new MaintenanceError('partition_result_checksum_invalid')
  const result = JSON.parse(resultText) as PartitionSegmentResult, proposals: MaintenanceProposal[] = []
  for (const proposal of result.proposals) {
    if ((await proposalClaims(proposal)).some(([key]) => cursor.conflicts.includes(key))) { cursor.held++; continue }
    proposals.push(proposal)
  }
  await persistProposals(env, proposals, row.source_id, snapshot.rawSha256)
  cursor.ready += proposals.filter(proposal => proposal.status === 'ready').length; cursor.held += proposals.filter(proposal => proposal.status === 'held').length
  cursor.drainUnit++; cursor.completed = cursor.drainUnit === totalUnits
  await save(); return observation(!cursor.completed)
}
