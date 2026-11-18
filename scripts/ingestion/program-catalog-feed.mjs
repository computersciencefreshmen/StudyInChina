import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'
import { profileCapturedPrograms } from './program-catalog-quality.mjs'

export const FEED_BRANCH = 'catalog-program-feed'
export const MAX_INDEX_BYTES = 900_000
export const MAX_INDEX_RECORDS = 500
export const MAX_DETAIL_BYTES = 5_000_000
const MAX_STATE_BYTES = 8_000_000
const basicFields = ['degree', 'language', 'duration', 'startDate', 'deadline', 'tuition', 'applicationFee', 'providerServiceFee']
const allFields = [...basicFields, 'requirements', 'materials', 'description', 'fees']
const hashPattern = /^[a-f0-9]{64}$/
const idPattern = /^[a-z][a-z0-9-]{1,160}$/
const privateKey = /secret|password|authorization|cookie|credential|(?:api|access|refresh)[_-]?key|token|raw(?:body|html|path)|stack|headers/i

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('feed_json_invalid')
}
export const sha256 = value => createHash('sha256').update(value).digest('hex')
const encode = value => Buffer.from(canonicalJson(value) + '\n')
const text = (value, maximum = 300) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('feed_text_invalid')
  return value.trim()
}
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function publicProviderUrl(value, provider) {
  try {
    const u = new URL(value)
    const hostAllowed = provider === 'SICAS' ? ['www.sicas.com.cn', 'sicas.com.cn'].includes(u.hostname)
      : provider === 'CUCAS' && /^[a-z0-9-]+\.cucas\.cn$/.test(u.hostname)
    if (!hostAllowed || u.protocol !== 'https:' || u.port || u.username || u.password) throw new Error()
    u.hash = ''
    return u.href
  } catch { throw new Error('feed_source_url_invalid') }
}

export function assertPublicState(value, depth = 0) {
  if (depth > 20) throw new Error('feed_state_depth_invalid')
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value === 'string') {
    if (/(?:[A-Za-z]:[\\/](?:Users|work|tmp)|\/(?:home|Users)\/)|<\s*(?:html|script)\b/i.test(value)) throw new Error('feed_state_private_value')
    return
  }
  if (Array.isArray(value)) { for (const item of value) assertPublicState(item, depth + 1); return }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('feed_state_invalid')
  for (const [key, item] of Object.entries(value)) {
    if (privateKey.test(key)) throw new Error('feed_state_private_key')
    assertPublicState(item, depth + 1)
  }
}

export function sanitizeProgram(input, { requireFieldEvidence = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('feed_program_invalid')
  const provider = text(input.provider, 20).toUpperCase()
  if (!['CUCAS', 'SICAS'].includes(provider)) throw new Error('feed_provider_invalid')
  const id = text(input.id, 170), schoolId = text(input.schoolId, 170), sourceId = text(input.sourceId, 100)
  if (!idPattern.test(id) || !idPattern.test(schoolId) || id !== `${provider.toLowerCase()}-${sourceId}` || !schoolId.startsWith(`${provider.toLowerCase()}-`)) throw new Error('feed_identity_invalid')
  if (!['link_only', 'extracted'].includes(input.status)) throw new Error('feed_status_invalid')
  const result = { id, provider, sourceId, schoolId, schoolName: text(input.schoolName, 500), name: text(input.name, 2000),
    sourceUrl: publicProviderUrl(input.sourceUrl, provider), status: input.status, official: false, admissionYear: null, fields: {} }
  if (input.sourceUpdatedAt) result.sourceUpdatedAt = text(input.sourceUpdatedAt, 100)
  if (input.fetchedAt) {
    if (!instant(input.fetchedAt)) throw new Error('feed_timestamp_invalid')
    result.fetchedAt = input.fetchedAt
  }
  if (input.status === 'extracted') {
    if (!instant(input.fetchedAt) || !hashPattern.test(input.evidenceHash || '')) throw new Error('feed_evidence_identity_invalid')
    result.evidenceHash = input.evidenceHash
    if (input.archiveSha256 === result.evidenceHash) result.archiveSha256 = input.archiveSha256
    for (const key of allFields) if (typeof input.fields?.[key] === 'string' && input.fields[key].trim()) result.fields[key] = text(input.fields[key], 500_000)
    const evidence = input.fieldEvidence || input.evidence
    if (requireFieldEvidence && Object.keys(result.fields).length && (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))) throw new Error('feed_missing_field_evidence')
    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
      result.fieldEvidence = {}
      for (const [key, value] of Object.entries(result.fields)) {
        const quote = evidence[key]
        if (!quote || typeof quote.text !== 'string' || !quote.text.includes(value)) throw new Error('feed_unbound_field')
        result.fieldEvidence[key] = { text: text(quote.text, 600_000), selector: text(quote.selector, 2000) }
        if (quote.sourceUrl) result.fieldEvidence[key].sourceUrl = publicProviderUrl(quote.sourceUrl, provider)
        if (quote.evidenceHash) {
          if (!hashPattern.test(quote.evidenceHash)) throw new Error('feed_evidence_hash_invalid')
          result.fieldEvidence[key].evidenceHash = quote.evidenceHash
        }
        if (quote.fetchedAt) {
          if (!instant(quote.fetchedAt)) throw new Error('feed_timestamp_invalid')
          result.fieldEvidence[key].fetchedAt = quote.fetchedAt
        }
        if (quote.archiveSha256 && quote.archiveSha256 === quote.evidenceHash) result.fieldEvidence[key].archiveSha256 = quote.archiveSha256
      }
    }
    if (input.displayedDates) { assertPublicState(input.displayedDates); result.displayedDates = input.displayedDates }
  }
  return result
}

function safePath(root, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('feed_path_invalid')
  const absolute = resolve(root, name), rel = relative(resolve(root), absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('feed_path_invalid')
  let parent = absolute
  while (!existsSync(parent)) parent = dirname(parent)
  if (lstatSync(parent).isSymbolicLink()) throw new Error('feed_symlink_rejected')
  const realRoot = realpathSync(root), realParent = realpathSync(parent), realRel = relative(realRoot, realParent)
  if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('feed_symlink_rejected')
  return absolute
}
function saveImmutable(root, name, body) {
  const destination = safePath(root, name)
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(body)) throw new Error('feed_immutable_conflict')
  } else writeFileSync(destination, body, { flag: 'wx' })
}
function readDescriptor(root, item, maximum) {
  if (!item || !hashPattern.test(item.sha256 || '') || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > maximum) throw new Error('feed_descriptor_invalid')
  const body = readFileSync(safePath(root, item.path))
  if (body.length !== item.bytes || sha256(body) !== item.sha256) throw new Error('feed_hash_mismatch')
  return JSON.parse(body.toString('utf8'))
}
export function feedRevision(counts, indexShards) { return sha256(canonicalJson({ schemaVersion: 1, counts, indexShards })) }
export function emptyProgress() { return { schemaVersion: 1, provider: 'SICAS', cursor: 0, updatedAt: null, outcomes: {}, hosts: {} } }

export function loadProgramFeed(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.official !== false || manifest.revision !== feedRevision(manifest.counts, manifest.indexShards) || !Array.isArray(manifest.indexShards)) throw new Error('feed_manifest_invalid')
  const records = [], ids = new Set()
  for (const shard of manifest.indexShards) {
    const data = readDescriptor(root, shard, MAX_INDEX_BYTES)
    if (data.schemaVersion !== 1 || !Array.isArray(data.programs) || data.programs.length !== shard.count || shard.count > MAX_INDEX_RECORDS) throw new Error('feed_index_invalid')
    for (const row of data.programs) {
      let record = row
      if (row.status === 'extracted') {
        record = readDescriptor(root, row.detail, MAX_DETAIL_BYTES)
        if (record.id !== row.id || record.schoolId !== row.schoolId || record.sourceUrl !== row.sourceUrl || record.status !== 'extracted') throw new Error('feed_detail_identity_mismatch')
      } else if (row.detail !== null) throw new Error('feed_link_detail_invalid')
      record = sanitizeProgram(record)
      if (ids.has(record.id)) throw new Error('feed_duplicate_identity')
      ids.add(record.id); records.push(record)
    }
  }
  const state = readDescriptor(root, manifest.state, MAX_STATE_BYTES)
  assertPublicState(state)
  if (records.length !== manifest.counts.programCount || records.filter(r => r.status === 'extracted').length !== manifest.counts.capturedCount) throw new Error('feed_count_mismatch')
  if (manifest.publication) {
    const { revision, ...snapshot } = manifest.publication
    const captured = records.filter(row => row.status === 'extracted')
    const withheld = captured.filter(programWithdrawalReason).map(row => row.id)
    const expected = new Map(captured.filter(row => !programWithdrawalReason(row)).map(row => [row.id, row]))
    if (revision !== sha256(canonicalJson(snapshot)) || snapshot.sourceRevision !== manifest.revision || snapshot.version !== 1
      || snapshot.visibleCount !== expected.size || canonicalJson(withheld) !== canonicalJson(snapshot.withdrawnIds)
      || canonicalJson(snapshot.quality) !== canonicalJson(profileCapturedPrograms(records))) throw new Error('publication_manifest_invalid')
    for (const part of snapshot.indexShards) {
      const shard = readDescriptor(root, part, MAX_INDEX_BYTES)
      if (shard.schemaVersion !== 1 || !Array.isArray(shard.programs) || shard.programs.length !== part.count || part.count > MAX_INDEX_RECORDS) throw new Error('publication_shard_invalid')
      for (const row of shard.programs) {
        const source = expected.get(row.id)
        if (!source || row.status !== 'extracted' || row.detail?.sha256 !== sha256(encode(source))) throw new Error('publication_record_mismatch')
        expected.delete(row.id)
      }
    }
    if (expected.size) throw new Error('publication_count_mismatch')
  }
  return { manifest, records, state }
}

export function mergeProgramRecords(current, incoming) {
  const records = new Map(current.map(record => [record.id, sanitizeProgram(record)])), rejected = [], held = []
  for (const input of incoming) {
    try {
      const record = sanitizeProgram(input, { requireFieldEvidence: true }), prior = records.get(record.id)
      if (prior && (prior.schoolId !== record.schoolId || prior.provider !== record.provider)) throw new Error('feed_conflicting_identity')
      if (prior?.status === 'extracted' && (record.status !== 'extracted' || Date.parse(prior.fetchedAt) > Date.parse(record.fetchedAt))) continue
      if (prior?.status === 'extracted') {
        if (Date.parse(prior.fetchedAt) === Date.parse(record.fetchedAt) && prior.evidenceHash !== record.evidenceHash) throw new Error('feed_ambiguous_observation')
        if (!preserveScopedFields(prior, record)) {
          held.push({ id: record.id, errorCode: 'incomplete_evidence_scope' })
          continue
        }
      }
      records.set(record.id, record)
    } catch { rejected.push({ id: typeof input?.id === 'string' && idPattern.test(input.id) ? input.id : null, errorCode: 'invalid_feed_record' }) }
  }
  return { records: [...records.values()], rejected, held }
}

// Retain independently attributable facts only on the same identified offering.
// Literal start dates must establish the same dated cohort before a prior
// admission condition can be reused. A capture timestamp is never an intake.
function preserveScopedFields(prior, record) {
  const normalized = value => value?.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
  if (normalized(prior.name) !== normalized(record.name) || normalized(prior.schoolName) !== normalized(record.schoolName)) throw new Error('feed_changed_identity')
  for (const [key, value] of Object.entries(record.fields)) {
    if (/^(?:TBA|TBD|N\/?A|unknown|not (?:provided|announced)|to be (?:confirmed|announced)|[-–—])$/iu.test(value)) {
      delete record.fields[key]
      if (record.fieldEvidence) delete record.fieldEvidence[key]
    }
  }
  if (['language', 'degree', 'startDate', 'deadline'].some(key =>
    prior.fields[key] && record.fields[key] && normalized(prior.fields[key]) !== normalized(record.fields[key]))) return true
  const sameDocument = prior.evidenceHash === record.evidenceHash
  const datedStart = prior.fields.startDate && /\b(?:19|20)\d{2}\b/.test(prior.fields.startDate)
    && normalized(prior.fields.startDate) === normalized(record.fields.startDate)
  const sameTrack = ['degree', 'language'].every(k => prior.fields[k] && record.fields[k]
    && normalized(prior.fields[k]) === normalized(record.fields[k]))
  const missing = Object.keys(prior.fields).filter(key => !record.fields[key])
  // A sparse observation without a provable cohort is still archived. Keep
  // the older entire projection (including its actual observation date) until
  // the new fields can be attributed; do not restamp or combine both scopes.
  if (missing.length && ((!sameDocument && !(datedStart && sameTrack)) || missing.some(key => !prior.fieldEvidence?.[key]))) return false
  for (const [field, value] of Object.entries(prior.fields)) {
    if (record.fields[field] || !prior.fieldEvidence?.[field]) continue
    if (!sameDocument && !(datedStart && sameTrack)) continue
    record.fields[field] = value
    const quote = prior.fieldEvidence[field]
    const evidenceHash = quote.evidenceHash || prior.evidenceHash
    const archiveSha256 = quote.archiveSha256 || (prior.archiveSha256 === evidenceHash ? prior.archiveSha256 : undefined)
    record.fieldEvidence ??= {}
    record.fieldEvidence[field] = { ...quote, sourceUrl: quote.sourceUrl || prior.sourceUrl, fetchedAt: quote.fetchedAt || prior.fetchedAt,
      evidenceHash, ...(archiveSha256 ? { archiveSha256 } : {}) }
  }
  return true
}

function sanitizeReceipt(row) {
  const provider = text(row.provider || 'SICAS', 20).toUpperCase()
  const result = { provider, sourceUrl: publicProviderUrl(row.sourceUrl, provider) }
  if (row.finalUrl) result.finalUrl = publicProviderUrl(row.finalUrl, provider)
  if (['GET', 'POST'].includes(row.method)) result.method = row.method
  for (const key of ['status', 'bytes']) if (Number.isSafeInteger(row[key]) && row[key] >= 0) result[key] = row[key]
  if (row.fetchedAt && instant(row.fetchedAt)) result.fetchedAt = row.fetchedAt
  if (hashPattern.test(row.rawSha256 || '')) result.rawSha256 = row.rawSha256
  if (result.rawSha256 && row.archiveSha256 === result.rawSha256) result.archiveSha256 = row.archiveSha256
  if (typeof row.errorCode === 'string' && /^[a-z0-9_-]{1,120}$/i.test(row.errorCode)) result.errorCode = row.errorCode
  return result
}

function saveIndexShards(root, indexRows) {
  const shards = []
  let rows = []
  const emptyBytes = encode({ schemaVersion: 1, programs: [] }).length
  let bytes = emptyBytes
  const flush = () => {
    if (!rows.length) return
    const body = encode({ schemaVersion: 1, programs: rows })
    const hash = sha256(body)
    const part = { path: `indexes/${hash}.json`, sha256: hash, bytes: body.length, count: rows.length }
    saveImmutable(root, part.path, body)
    shards.push(part)
    rows = []
    bytes = emptyBytes
  }
  for (const row of indexRows) {
    const rowBytes = Buffer.byteLength(canonicalJson(row))
    if (emptyBytes + rowBytes > MAX_INDEX_BYTES) throw new Error('feed_single_index_row_too_large')
    if (rows.length >= MAX_INDEX_RECORDS || bytes + Number(rows.length > 0) + rowBytes > MAX_INDEX_BYTES) flush()
    bytes += Number(rows.length > 0) + rowBytes
    rows.push(row)
  }
  flush()
  return shards
}

export function writeProgramFeed(root, { records, state = emptyProgress(), receipts = [], generatedAt, publicIndex = false }) {
  mkdirSync(root, { recursive: true })
  assertPublicState(state)
  const progress = encode(state)
  if (progress.length > MAX_STATE_BYTES) throw new Error('feed_state_too_large')
  const programs = records.map(record => sanitizeProgram(record)).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  if (new Set(programs.map(p => p.id)).size !== programs.length) throw new Error('feed_duplicate_identity')
  const indexRows = programs.map(program => {
    let detail = null
    if (program.status === 'extracted') {
      const body = encode(program), hash = sha256(body)
      if (body.length > MAX_DETAIL_BYTES) throw new Error('feed_detail_too_large')
      detail = { path: `details/${hash.slice(0, 2)}/${hash}.json`, sha256: hash, bytes: body.length }
      saveImmutable(root, detail.path, body)
    }
    const row = Object.fromEntries(['id', 'provider', 'sourceId', 'schoolId', 'schoolName', 'name', 'sourceUrl', 'sourceUpdatedAt', 'fetchedAt', 'status', 'official', 'admissionYear', 'evidenceHash'].filter(key => program[key] !== undefined).map(key => [key, program[key]]))
    row.fields = Object.fromEntries(basicFields.filter(key => program.fields[key] !== undefined).map(key => [key, program.fields[key]]))
    return { ...row, detail }
  })
  const indexShards = saveIndexShards(root, indexRows)
  const counts = { programCount: programs.length, capturedCount: programs.filter(p => p.status === 'extracted').length,
    schoolCount: new Set(programs.map(p => p.schoolId)).size, sourceCount: new Set(programs.map(p => p.sourceUrl)).size }
  const stateDescriptor = { path: 'state/progress.json', sha256: sha256(progress), bytes: progress.length }
  const statePath = safePath(root, stateDescriptor.path)
  mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, progress)
  const publicReceipts = encode({ schemaVersion: 1, receipts: receipts.map(sanitizeReceipt) })
  saveImmutable(root, `receipts/${sha256(publicReceipts)}.json`, publicReceipts)
  const timestamp = generatedAt || state.updatedAt || programs.map(p => p.fetchedAt || p.sourceUpdatedAt).filter(Boolean).sort().at(-1) || new Date().toISOString()
  if (!instant(timestamp)) throw new Error('feed_timestamp_invalid')
  const manifest = { schemaVersion: 1, revision: feedRevision(counts, indexShards), generatedAt: timestamp, official: false, counts, indexShards, state: stateDescriptor }
  if (state.monitor) manifest.monitor = { eligibleWindowsWithoutGrowth: state.monitor.eligibleWindowsWithoutGrowth, reason: state.monitor.reason }
  if (publicIndex) {
    const captured = indexRows.filter(row => row.status === 'extracted')
    const withheld = captured.filter(programWithdrawalReason).map(row => row.id)
    const visible = captured.filter(row => !programWithdrawalReason(row))
    const publication = { version: 1, sourceRevision: manifest.revision, visibleCount: visible.length,
      withdrawnIds: withheld, indexShards: saveIndexShards(root, visible), quality: profileCapturedPrograms(programs) }
    manifest.publication = { ...publication, revision: sha256(canonicalJson(publication)) }
  }
  writeFileSync(safePath(root, 'manifest.json'), encode(manifest))
  return manifest
}
