import 'server-only'
import type { ThirdPartyProgram } from './third-party-programs'
import {
  TRANSLATION_FIELDS, TRANSLATION_LOCALES, translationPath, validateTranslationRecord,
  type ProgramTranslationField, type ProgramTranslationLocale, type ProgramTranslationRecord,
} from './program-translation-contract'

export type ProgramTranslations = Partial<Record<ProgramTranslationField, ProgramTranslationRecord>>
const locales = new Set<string>(TRANSLATION_LOCALES)
const base = 'https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/catalog-program-feed/'
const maximumBytes = 1_000_000, timeoutMs = 10_000, negativeTtl = 60_000
const positive = new Map<string, { record: ProgramTranslationRecord; bytes: number }>()
const negative = new Map<string, number>()
const pending = new Map<string, Promise<ProgramTranslationRecord | null>>()
let cachedBytes = 0, active = 0
const waiters: Array<() => boolean> = []

export function isProgramTranslationLocale(value: string | null | undefined): value is ProgramTranslationLocale {
  return typeof value === 'string' && locales.has(value)
}
function enabled() {
  return process.env.PROGRAM_FEED_ENABLED !== 'false'
    && (process.env.PROGRAM_FEED_ENABLED === 'true' || process.env.VERCEL_ENV === 'production')
}
async function acquire(deadline: number): Promise<boolean> {
  if (active < 3) { active++; return true }
  if (waiters.length >= 128) return false
  return new Promise(resolve => {
    let finished = false
    const grant = () => {
      if (finished) return false
      finished = true; clearTimeout(timer); resolve(true); return true
    }
    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      const index = waiters.indexOf(grant)
      if (index >= 0) waiters.splice(index, 1)
      resolve(false)
    }, Math.max(1, deadline - Date.now()))
    waiters.push(grant)
  })
}
function release() {
  while (waiters.length) if (waiters.shift()!()) return
  active--
}
function remember(path: string, record: ProgramTranslationRecord) {
  const bytes = Buffer.byteLength(JSON.stringify(record))
  while (positive.size && (positive.size >= 128 || cachedBytes + bytes > 8_000_000)) {
    const oldest = positive.keys().next().value!
    cachedBytes -= positive.get(oldest)!.bytes; positive.delete(oldest)
  }
  positive.set(path, { record, bytes }); cachedBytes += bytes
}
function miss(path: string) {
  if (negative.size >= 256) negative.delete(negative.keys().next().value!)
  negative.set(path, Date.now() + negativeTtl)
}
async function download(path: string, source: string, locale: ProgramTranslationLocale) {
  const deadline = Date.now() + timeoutMs
  if (!await acquire(deadline)) return null
  try {
    if (Date.now() >= deadline) return null
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), next: { revalidate: 60 } })
    if (!response.ok || response.redirected || !response.body || Number(response.headers.get('content-length') || 0) > maximumBytes
      || response.url && response.url !== base + path) { await response.body?.cancel(); return null }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > maximumBytes) { await reader.cancel(); return null }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    return validateTranslationRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')), source, locale)
  } catch { return null }
  finally { release() }
}
async function translation(source: string, locale: ProgramTranslationLocale): Promise<ProgramTranslationRecord | null> {
  let path: string
  try { path = translationPath(source, locale) } catch { return null }
  if (!new RegExp(`^translations/v1/${locale}/[a-f0-9]{64}\\.json$`).test(path)) return null
  const cached = positive.get(path)
  if (cached) return cached.record
  const expires = negative.get(path)
  if (expires && expires > Date.now()) return null
  if (expires) negative.delete(path)
  const existing = pending.get(path)
  if (existing) return existing
  if (pending.size >= 256) return null
  const promise = download(path, source, locale).then(record => {
    if (record) remember(path, record)
    else miss(path)
    return record
  }).finally(() => pending.delete(path))
  pending.set(path, promise)
  return promise
}

/** Translation is an optional overlay bound to the current literal source text. */
export async function getProgramTranslations(record: Pick<ThirdPartyProgram, 'fields'>, locale: ProgramTranslationLocale): Promise<ProgramTranslations> {
  if (!enabled() || !isProgramTranslationLocale(locale)) return {}
  const result: ProgramTranslations = {}
  await Promise.all(TRANSLATION_FIELDS.map(async field => {
    const source = record.fields[field]
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > maximumBytes) return
    const translated = await translation(source, locale)
    if (translated) result[field] = translated
  }))
  return result
}
