import 'server-only'
import { createHash } from 'node:crypto'
import localData from '../../content/third-party/details.json'
import localManifest from '../../content/third-party/manifest.json'
import type { ThirdPartyProgram } from './third-party-programs'

export type ProgramFeedSummary = {
  capturedCount: number
  schoolCount: number
  sourceCount: number
}

export type ProgramFeedIndex = {
  revision: string
  generatedAt: string
  programs: ThirdPartyProgram[]
  summary: ProgramFeedSummary
}

const records = localData.programs as unknown as ThirdPartyProgram[]
const byId = new Map(records.map(record => [record.id, record]))
const basicFields = ['degree', 'language', 'duration', 'startDate', 'deadline', 'tuition', 'applicationFee', 'providerServiceFee'] as const
const localIndex: ProgramFeedIndex = {
  revision: `local-${localManifest.candidateSnapshot.sha256}`,
  generatedAt: localManifest.generatedAt,
  programs: records.map(record => ({
    ...record,
    fields: Object.fromEntries(basicFields.filter(key => record.fields[key] !== undefined).map(key => [key, record.fields[key]])),
  })),
  summary: {
    capturedCount: records.length,
    schoolCount: new Set(records.map(record => record.schoolId)).size,
    sourceCount: new Set(records.map(record => record.provider)).size,
  },
}

type Descriptor = { path: string; sha256: string; bytes: number; count?: number }
type FeedManifest = { schemaVersion: number; revision: string; generatedAt: string; official: boolean;
  counts: { programCount: number; capturedCount: number; schoolCount: number; sourceCount: number }; indexShards: Descriptor[] }
const feedBase = 'https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/catalog-program-feed/'
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
let currentIndex = localIndex
let references = new Map<string, Descriptor>()
let lastAttempt = 0
let pending: Promise<ProgramFeedIndex> | undefined
const detailCache = new Map<string, ThirdPartyProgram>()

function remoteEnabled() {
  return process.env.PROGRAM_FEED_ENABLED !== 'false'
    && (process.env.PROGRAM_FEED_ENABLED === 'true' || process.env.VERCEL_ENV === 'production')
}

async function readFeed(path: string, descriptor?: Descriptor): Promise<unknown> {
  const maximum = path === 'manifest.json' ? 256_000 : path.startsWith('indexes/') ? 1_000_000 : 5_000_000
  if (path !== 'manifest.json' && (!/^(?:indexes\/[a-f0-9]{64}|details\/[a-f0-9]{2}\/[a-f0-9]{64})\.json$/.test(path)
    || !descriptor || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > maximum
    || !/^[a-f0-9]{64}$/.test(descriptor.sha256))) throw new Error('program_feed_descriptor_invalid')
  const response = await fetch(`${feedBase}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(10_000),
    next: { revalidate: path === 'manifest.json' ? 60 : 86_400 },
  })
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maximum) throw new Error('program_feed_unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > maximum) { await reader.cancel(); throw new Error('program_feed_too_large') }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks)
  if (descriptor && (size !== descriptor.bytes || digest(bytes) !== descriptor.sha256)) throw new Error('program_feed_hash_mismatch')
  return JSON.parse(bytes.toString('utf8'))
}

function sourceRecord(value: unknown): ThirdPartyProgram {
  if (!value || typeof value !== 'object') throw new Error('program_feed_record_invalid')
  const row = value as ThirdPartyProgram
  if (!/^[a-z][a-z0-9-]{1,160}$/.test(row.id) || row.status !== 'extracted' || row.official !== false || row.admissionYear !== null
    || ![row.name, row.schoolName, row.schoolId, row.sourceId, row.provider].every(text => typeof text === 'string' && text.length > 0 && text.length < 2000)
    || !row.fetchedAt || Number.isNaN(Date.parse(row.fetchedAt)) || !row.fields || typeof row.fields !== 'object') throw new Error('program_feed_record_invalid')
  const url = new URL(row.sourceUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !(row.provider === 'SICAS' ? ['www.sicas.com.cn', 'sicas.com.cn'].includes(url.hostname)
      : row.provider === 'CUCAS' && /^[a-z0-9-]+\.cucas\.cn$/.test(url.hostname))) throw new Error('program_feed_source_invalid')
  const allowedFields = [...basicFields, 'requirements', 'materials', 'description', 'fees'] as const
  const fields: ThirdPartyProgram['fields'] = {}
  for (const key of allowedFields) if (row.fields[key] !== undefined) {
    if (typeof row.fields[key] !== 'string' || row.fields[key]!.length > 500_000) throw new Error('program_feed_field_invalid')
    fields[key] = row.fields[key]
  }
  return { id: row.id, name: row.name, schoolId: row.schoolId, schoolName: row.schoolName, provider: row.provider,
    sourceId: row.sourceId, sourceUrl: url.href, status: 'extracted', official: false, admissionYear: null,
    fetchedAt: row.fetchedAt, sourceUpdatedAt: row.sourceUpdatedAt, evidenceHash: row.evidenceHash, fields }
}

async function refreshIndex(): Promise<ProgramFeedIndex> {
  const manifest = await readFeed('manifest.json') as FeedManifest
  if (manifest.schemaVersion !== 1 || manifest.official !== false || !Array.isArray(manifest.indexShards)
    || manifest.indexShards.length > 1000 || !manifest.counts || !Number.isSafeInteger(manifest.counts.capturedCount)
    || !Number.isSafeInteger(manifest.counts.programCount) || manifest.counts.programCount > 100_000
    || manifest.counts.capturedCount > manifest.counts.programCount || manifest.counts.capturedCount < records.length
    || manifest.indexShards.some(part => !Number.isSafeInteger(part.count) || part.count! < 1 || part.count! > 500)
    || manifest.indexShards.reduce((size, part) => size + part.bytes, 0) > 64_000_000
    || manifest.revision !== digest(canonical({ schemaVersion: 1, counts: manifest.counts, indexShards: manifest.indexShards }))) throw new Error('program_feed_manifest_invalid')
  if (manifest.revision === currentIndex.revision) return currentIndex
  const programs: ThirdPartyProgram[] = [], refs = new Map<string, Descriptor>(), seen = new Set<string>()
  let offset = 0, indexed = 0
  await Promise.all(Array.from({ length: Math.min(6, manifest.indexShards.length) }, async () => {
    while (offset < manifest.indexShards.length) {
      const descriptor = manifest.indexShards[offset++]
      const shard = await readFeed(descriptor.path, descriptor) as { schemaVersion: number; programs: (ThirdPartyProgram & { detail: Descriptor | null })[] }
      if (shard.schemaVersion !== 1 || !Array.isArray(shard.programs) || shard.programs.length !== descriptor.count) throw new Error('program_feed_index_invalid')
      indexed += shard.programs.length
      for (const row of shard.programs) {
        if (seen.has(row.id)) throw new Error('program_feed_duplicate_identity')
        seen.add(row.id)
        if (row.status !== 'extracted') continue
        const program = sourceRecord(row)
        if (!row.detail) throw new Error('program_feed_detail_missing')
        programs.push(program); refs.set(program.id, row.detail)
      }
    }
  }))
  if (indexed !== manifest.counts.programCount || programs.length !== manifest.counts.capturedCount
    || records.some(record => !refs.has(record.id))) throw new Error('program_feed_count_mismatch')
  programs.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  const next = { revision: manifest.revision, generatedAt: manifest.generatedAt, programs,
    summary: { capturedCount: programs.length, schoolCount: new Set(programs.map(row => row.schoolId)).size,
      sourceCount: new Set(programs.map(row => row.provider)).size } }
  references = refs; currentIndex = next
  return next
}

/** Invalid or unavailable new snapshots leave the last complete revision online. */
export async function getProgramFeedIndex(): Promise<ProgramFeedIndex> {
  if (!remoteEnabled()) return currentIndex
  if (pending) return pending
  if (Date.now() - lastAttempt < 60_000) return currentIndex
  if (!pending) {
    lastAttempt = Date.now()
    pending = refreshIndex().catch(() => currentIndex).finally(() => { pending = undefined })
  }
  return pending
}

export async function getProgramFeedRecord(id: string): Promise<ThirdPartyProgram | undefined> {
  const index = await getProgramFeedIndex()
  const descriptor = references.get(id)
  if (!descriptor) return byId.get(id)
  const expected = index.programs.find(record => record.id === id)
  const key = `${id}:${descriptor.sha256}`
  const cached = detailCache.get(key)
  if (cached) return cached
  try {
    const record = sourceRecord(await readFeed(descriptor.path, descriptor))
    if (!expected || record.id !== id || record.schoolId !== expected.schoolId || record.provider !== expected.provider
      || record.sourceId !== expected.sourceId || record.sourceUrl !== expected.sourceUrl || record.name !== expected.name) throw new Error('program_feed_detail_identity_mismatch')
    if (detailCache.size >= 256) detailCache.delete(detailCache.keys().next().value!)
    detailCache.set(key, record)
    return record
  } catch { return byId.get(id) }
}
