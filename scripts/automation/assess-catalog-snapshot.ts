import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { parseCatalogRelease } from '../../src/lib/catalog/release'
import { readCatalogBundle } from './build-catalog-seeds'

const files = { universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships', cities: 'cities', sources: 'sources' } as const

/** A newer record date does not prove that omitted facts were deliberately withdrawn. */
function findErasedFacts(previous: unknown, next: unknown, path = ''): string[] {
  const isEmpty = (value: unknown): boolean => value === null || value === undefined
    || (typeof value === 'string' && (!value.trim() || value.trim().toLowerCase() === 'unknown'))
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
  if (isEmpty(previous)) return []
  if (isEmpty(next)) return [path]
  if (Array.isArray(previous)) {
    if (!Array.isArray(next) || next.length < previous.length) return [path]
    // Reordering is harmless; losing a language, source, association, or requirement is not.
    if (previous.every(value => typeof value === 'string')) {
      return previous.some(value => !next.includes(value)) ? [path] : []
    }
    if (previous.every(value => value && typeof value === 'object' && 'test' in value)) {
      return previous.flatMap(value => {
        const match = next.find(candidate => candidate && typeof candidate === 'object' && candidate.test === value.test)
        return findErasedFacts(value, match, path + '[' + value.test + ']')
      })
    }
    // Lists of localized text have no stable entry IDs. Preserve each locale's coverage
    // without coupling evidence completeness to incidental list order or wording.
    const localeCounts = (values: unknown[]) => {
      const counts = new Map<string, number>()
      for (const value of values) if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) if (!isEmpty(entry)) counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return counts
    }
    const nextCounts = localeCounts(next)
    return [...localeCounts(previous)].filter(([key, count]) => (nextCounts.get(key) ?? 0) < count).map(([key]) => path + '[].' + key)
  }
  if (typeof previous === 'object' && previous !== null) {
    if (typeof next !== 'object' || next === null) return [path]
    const nextRecord = next as Record<string, unknown>
    return Object.entries(previous).flatMap(([key, value]) => findErasedFacts(value, nextRecord[key], path ? path + '.' + key : key))
  }
  return []
}

/** A complete immutable release may replace JSON only after preserving the baseline's identities and evidence. */
export function assessCatalogSnapshot(baseline: DataBundle, bytes: Uint8Array, expectedSha256: string, now = new Date()) {
  const issues: string[] = []
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new Error('snapshot_checksum_mismatch')
  const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { data?: unknown; meta?: { release?: unknown } }
  const bundle = bundleSchema.parse(envelope.data)
  const release = parseCatalogRelease(envelope.meta?.release, bundle)
  if (release.catalogBackend !== 'd1') issues.push('snapshot_not_pipeline_release')
  const generated = Date.parse(release.generatedAt)
  if (generated > now.getTime() + 300000 || now.getTime() - generated > 48 * 3600000) issues.push('snapshot_outside_48_hour_window')
  for (const key of ['universities', 'programs', 'scholarships', 'cities'] as const) {
    const next = new Map(bundle[key].map(row => [row.id, row]))
    for (const previous of baseline[key].filter(row => row.status !== 'draft')) {
      const row = next.get(previous.id)
      if (!row || row.status === 'draft') issues.push(`identity_missing:${key}:${previous.id}`)
      else if (row.verifiedAt < previous.verifiedAt) issues.push(`evidence_regression:${key}:${previous.id}`)
    }
  }
  // Apply to matching historical cycles too: reference fees and requirements are
  // still useful evidence even when a cycle is no longer open. Existing identity
  // gates below remain responsible for deciding which cycle IDs must be present.
  for (const key of ['universities', 'programs', 'admissionCycles', 'scholarships', 'cities'] as const) {
    const next = new Map<string, unknown>(bundle[key].map(row => [row.id, row]))
    for (const previous of baseline[key].filter(row => row.status !== 'draft')) {
      const row = next.get(previous.id)
      if (!row) continue
      for (const field of findErasedFacts(previous, row)) issues.push('field_erasure:' + key + ':' + previous.id + ':' + field)
    }
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const nextCycles = new Map(bundle.admissionCycles.map(row => [row.id, row]))
  for (const previous of baseline.admissionCycles.filter(row => row.status === 'verified' && row.reviewAfter >= today && (!row.closesOn || row.closesOn >= today))) {
    const next = nextCycles.get(previous.id)
    if (!next || next.verifiedAt < previous.verifiedAt || next.status === 'draft') issues.push(`current_cycle_missing_or_older:${previous.id}`)
  }
  return { eligible: issues.length === 0, issues, release, bundle }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (flag: string) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1] }
  const snapshot = arg('--snapshot'); const checksum = arg('--sha256')
  if (!snapshot || !checksum) throw new Error('--snapshot and --sha256 are required')
  const output = resolve(arg('--output') ?? '.pipeline-build/automation-catalog-candidate')
  const result = assessCatalogSnapshot(readCatalogBundle(resolve(arg('--data-dir') ?? 'content/data')), readFileSync(resolve(snapshot)), checksum)
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'assessment.json'), JSON.stringify({ eligible: result.eligible, issues: result.issues, release: result.release }, null, 2))
  if (result.eligible) {
    mkdirSync(join(output, 'content/data'), { recursive: true })
    for (const [key, filename] of Object.entries(files)) writeFileSync(join(output, 'content/data', `${filename}.json`), `${JSON.stringify(result.bundle[key as keyof typeof files], null, 2)}\n`)
  }
  console.log(JSON.stringify({ eligible: result.eligible, issues: result.issues.length, output }))
  if (!result.eligible) process.exitCode = 2
}
