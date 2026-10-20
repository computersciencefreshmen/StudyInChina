import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { applyCatalogSnapshotFiles, readCatalogSnapshotBaseline } from '../automation/apply-catalog-snapshot'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema, scholarshipSchema, sourceSchema } from '../../src/lib/data/schema'
import type { DataBundle, Scholarship, Source } from '../../src/lib/data/types'
import type { Capture, FieldEvidence } from './approve-full-program-batch'

export type FullScholarshipEntry = {
  scholarship: Scholarship; evidence: FieldEvidence[]; reviewer: 'codex'; reviewedAt: string; notes?: string
}
export type FullScholarshipBatch = {
  schemaVersion: 1; batchId: string; sources: Source[]; captures: Capture[]; entries: FullScholarshipEntry[]
}
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const fields = ['name', 'providerType', 'universityIds', 'programIds', 'coverage.tuition', 'coverage.accommodation',
  'coverage.insurance', 'coverage.stipendCnyPerMonth', 'deadline', 'applicationUrl', 'summary', 'eligibility']
const fresh = (date: string) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now() + 5000
  && Date.now() - Date.parse(date) <= 24 * 60 * 60_000
function local(root: string, name: string) {
  const path = resolve(root, name), rel = relative(resolve(root), path)
  if (isAbsolute(name) || rel === '..' || rel.startsWith('..' + sep)) throw Error('evidence_path_outside_workspace')
  return path
}
function contract(batch: FullScholarshipBatch) {
  if (batch.schemaVersion !== 1 || !/^[a-z0-9-]{1,80}$/u.test(batch.batchId) || !Array.isArray(batch.entries)
    || !batch.entries.length || !Array.isArray(batch.sources) || !Array.isArray(batch.captures)) throw Error('scholarship_batch_contract_invalid')
  for (const values of [batch.sources.map(s => s.id), batch.captures.map(c => c.sourceId)]) {
    if (new Set(values).size !== values.length) throw Error('duplicate_scholarship_source_or_capture')
  }
}

/** Structural evidence gate; the independent reviewer must also assess every claim semantically. */
export function assessFullScholarshipBatch(root: string, batch: FullScholarshipBatch, catalog: DataBundle, today = getTodayDate()) {
  contract(batch)
  const sources = new Map(catalog.sources.map(s => [s.id, s]))
  for (const source of batch.sources) sources.set(source.id, sourceSchema.parse(source))
  const texts = new Map<string, string>()
  for (const capture of batch.captures) {
    try {
      const source = sources.get(capture.sourceId)
      if (!source?.official || source.url !== capture.url || capture.httpStatus !== 200 || !fresh(capture.retrievedAt)) continue
      const raw = readFileSync(local(root, capture.rawPath)), text = readFileSync(local(root, capture.textPath))
      if (sha(raw) !== capture.rawSha256 || sha(text) !== capture.textSha256 || !text.length) continue
      texts.set(source.id, normalize(text.toString('utf8')))
    } catch { /* Missing or changed captures are held, never repaired in place. */ }
  }
  const published = selectPublishedData(catalog, today)
  const universities = new Set(published.universities.map(u => u.id))
  const openPrograms = new Set(published.admissionCycles.map(c => c.programId))
  const seen = new Set<string>(), slugs = new Set<string>()
  const entries = batch.entries.map(entry => {
    const s = entry.scholarship, blockers: string[] = []
    if (!scholarshipSchema.safeParse(s).success) blockers.push('scholarship_schema_invalid')
    if (seen.has(s.id) || slugs.has(s.slug)) blockers.push('duplicate_scholarship_identity')
    seen.add(s.id); slugs.add(s.slug)
    if (s.status !== 'verified' || s.verifiedAt > today || s.reviewAfter < today
      || (Date.parse(s.reviewAfter) - Date.parse(s.verifiedAt)) / 86400000 > 31) blockers.push('scholarship_not_current_review')
    if (s.deadline !== null && s.deadline < today) blockers.push('scholarship_deadline_expired')
    if (!s.applicationUrl || !s.summary || !s.eligibility?.length) blockers.push('scholarship_admissions_incomplete')
    if (s.universityIds.some(id => !universities.has(id)) || s.programIds.some(id => !openPrograms.has(id))) blockers.push('scholarship_parent_not_current_public')
    if (s.programIds.some(id => s.universityIds.length && !s.universityIds.includes(catalog.programs.find(p => p.id === id)?.universityId ?? ''))) blockers.push('scholarship_program_university_mismatch')
    if (entry.reviewer !== 'codex' || !fresh(entry.reviewedAt)) blockers.push('independent_review_missing')
    const recordSources = new Set(s.sourceIds)
    if (!recordSources.size || [...recordSources].some(id => !texts.has(id))) blockers.push('fresh_official_capture_missing')
    for (const field of fields) {
      const proofs = entry.evidence.filter(proof => {
        const key = proof.field.replace(/^scholarship\./u, '')
        return key === field || key.startsWith(field + '.') || key.startsWith(field + '[')
      })
      if (!proofs.length) blockers.push('field_evidence_missing:' + field)
      else if (!proofs.some(proof => recordSources.has(proof.sourceId) && normalize(proof.quote).length > 0
        && texts.get(proof.sourceId)?.includes(normalize(proof.quote)))) blockers.push('quote_not_in_official_capture:' + field)
    }
    const collision = catalog.scholarships.find(item => item.slug === s.slug && item.id !== s.id)
    if (collision) blockers.push('scholarship_slug_collision')
    return { ...entry, ready: blockers.length === 0, blockers: [...new Set(blockers)] }
  })
  return { batchId: batch.batchId, assessedAt: new Date().toISOString(), today, entries,
    ready: entries.filter(e => e.ready).length, held: entries.filter(e => !e.ready).length }
}

export function applyFullScholarshipBatch(root: string, batch: FullScholarshipBatch, expectedCatalogSha256: string, today = getTodayDate()) {
  contract(batch)
  const receiptPath = local(root, 'quality/scholarship-expansion-20261019/applied-' + batch.batchId + '.json')
  if (existsSync(receiptPath)) throw Error('scholarship_batch_already_reserved_or_applied')
  const baseline = readCatalogSnapshotBaseline(local(root, 'content/data'))
  const originalCatalogSha256 = sha(JSON.stringify(baseline.bundle))
  if (originalCatalogSha256 !== expectedCatalogSha256) throw Error('canonical_catalog_changed')
  const assessment = assessFullScholarshipBatch(root, batch, baseline.bundle, today)
  if (assessment.held || assessment.ready !== batch.entries.length) return { assessment, appliedScholarships: 0, newScholarships: 0 }
  const sources = new Map(baseline.bundle.sources.map(s => [s.id, s]))
  const needed = new Set(batch.entries.flatMap(e => e.scholarship.sourceIds))
  // Updating a reused source must not silently change its publisher/URL for unrelated existing facts.
  for (const source of batch.sources) if (needed.has(source.id)) {
    const existing = sources.get(source.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(source)) throw Error('existing_scholarship_source_changed')
    sources.set(source.id, source)
  }
  const scholarships = new Map(baseline.bundle.scholarships.map(s => [s.id, s]))
  const newScholarships = batch.entries.filter(e => !scholarships.has(e.scholarship.id)).length
  for (const entry of batch.entries) scholarships.set(entry.scholarship.id, entry.scholarship)
  const next = bundleSchema.parse({ ...baseline.bundle, sources: [...sources.values()], scholarships: [...scholarships.values()] })
  const receipt = { batchId: batch.batchId, reservedAt: new Date().toISOString(), status: 'reserved-awaiting-local-snapshot',
    batchSha256: sha(JSON.stringify(batch)), originalCatalogSha256, nextCatalogSha256: sha(JSON.stringify(next)), assessment,
    appliedScholarships: batch.entries.length, newScholarships,
    before: batch.entries.map(e => baseline.bundle.scholarships.find(s => s.id === e.scholarship.id) ?? null),
    after: batch.entries.map(e => e.scholarship) }
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  try {
    const snapshot = applyCatalogSnapshotFiles(baseline, next)
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, status: 'local-snapshot-applied-awaiting-publication', appliedAt: new Date().toISOString(), snapshot }, null, 2) + '\n')
  } catch (error) {
    // Keep the reservation permanently: an interrupted/failed operation needs reconciliation, never automatic replay.
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, status: 'snapshot-failed-reconciliation-required' }, null, 2) + '\n')
    throw error
  }
  return { assessment, appliedScholarships: batch.entries.length, newScholarships }
}
