import { IngestionError } from './errors'
import { sourceManifestSchema } from './manifest-schema'
import type { Fetcher, SourceManifestV1 } from './types'

const SOURCE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/
const FIELD_PATH = /^[a-zA-Z][a-zA-Z0-9_.-]{0,159}$/
const SOURCE_CATEGORIES = new Set([
  'international_admissions_home',
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'current_guide',
  'dates_deadlines',
  'fees',
  'eligibility_language',
  'application_portal',
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
  'program_detail',
  'contacts',
  'catalog_anchor',
])
const FORBIDDEN_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.onion',
]
const MAX_IN_MEMORY_SOURCE_BYTES = 10 * 1024 * 1024

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function isForbiddenHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname)
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.includes(':')) return true
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return true
  return FORBIDDEN_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  )
}

export function normalizeAllowedHost(host: string): string {
  const normalized = normalizedHostname(host)
  if (
    isForbiddenHostname(normalized) ||
    normalized.includes('/') ||
    normalized.includes('@') ||
    normalized.includes('*') ||
    !normalized.includes('.')
  ) {
    throw new Error(`Invalid allowed host: ${host}`)
  }
  return normalized
}

export function validateManifest(manifest: SourceManifestV1): SourceManifestV1 {
  const structural = sourceManifestSchema.safeParse(manifest)
  if (!structural.success) {
    const detail = structural.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid source manifest: ${detail}`)
  }
  manifest = structural.data as SourceManifestV1
  const issues: string[] = []
  if (manifest.version !== 1) issues.push('version must be 1')
  if (!SOURCE_ID.test(manifest.id)) issues.push('id must be a stable lowercase identifier')
  if (!SOURCE_ID.test(manifest.institutionId)) {
    issues.push('institutionId must be a stable lowercase identifier')
  }
  if (!SOURCE_CATEGORIES.has(manifest.sourceCategory)) {
    issues.push(`unsupported sourceCategory: ${String(manifest.sourceCategory)}`)
  }
  let allowedHosts: string[] = []
  let redirectHosts: string[] = []
  try {
    allowedHosts = [...new Set(manifest.allowedHosts.map(normalizeAllowedHost))]
    redirectHosts = [
      ...new Set((manifest.allowedRedirectHosts ?? []).map(normalizeAllowedHost)),
    ]
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }
  if (allowedHosts.length === 0) issues.push('allowedHosts must not be empty')

  try {
    const officialUrl = assertSafeSourceUrl(manifest.officialUrl, allowedHosts)
    if (!allowedHosts.includes(officialUrl.hostname)) {
      issues.push('officialUrl hostname must be listed in allowedHosts')
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }

  if (
    !Number.isInteger(manifest.schedule.intervalHours) ||
    manifest.schedule.intervalHours < 1 ||
    manifest.schedule.intervalHours > 24 * 31
  ) {
    issues.push('schedule.intervalHours must be an integer from 1 to 744')
  }
  if (
    manifest.schedule.jitterMinutes !== undefined &&
    (!Number.isInteger(manifest.schedule.jitterMinutes) ||
      manifest.schedule.jitterMinutes < 0 ||
      manifest.schedule.jitterMinutes > 12 * 60)
  ) {
    issues.push('schedule.jitterMinutes must be an integer from 0 to 720')
  }

  if (
    manifest.fetch.timeoutMs !== undefined &&
    (!Number.isInteger(manifest.fetch.timeoutMs) ||
      manifest.fetch.timeoutMs < 1_000 ||
      manifest.fetch.timeoutMs > 60_000)
  ) {
    issues.push('fetch.timeoutMs must be an integer from 1000 to 60000')
  }
  if (
    manifest.fetch.maxBytes !== undefined &&
    (!Number.isInteger(manifest.fetch.maxBytes) ||
      manifest.fetch.maxBytes < 1_024 ||
      manifest.fetch.maxBytes > MAX_IN_MEMORY_SOURCE_BYTES)
  ) {
    issues.push('fetch.maxBytes must be between 1KB and 10MB')
  }

  const fieldPaths = new Set<string>()
  for (const field of manifest.extraction.fields) {
    if (!FIELD_PATH.test(field.path)) issues.push(`invalid field path: ${field.path}`)
    if (fieldPaths.has(field.path)) issues.push(`duplicate field path: ${field.path}`)
    fieldPaths.add(field.path)
  }
  if (fieldPaths.size === 0) issues.push('extraction.fields must not be empty')
  if (
    manifest.extraction.mode === 'rules-only' &&
    manifest.extraction.fields.some((field) => field.critical)
  ) {
    issues.push('critical fields require rules-then-minimax or minimax dual extraction')
  }

  for (const rule of manifest.extraction.rules ?? []) {
    if (!fieldPaths.has(rule.fieldPath)) {
      issues.push(`rule references unknown field: ${rule.fieldPath}`)
    }
    if (rule.kind === 'regex') {
      if (rule.pattern.length === 0 || rule.pattern.length > 500) {
        issues.push(`regex rule for ${rule.fieldPath} must be 1 to 500 characters`)
      } else if (isPotentiallyUnsafeRegex(rule.pattern)) {
        issues.push(`regex rule for ${rule.fieldPath} is outside the safe subset`)
      } else {
        try {
          const flags = sanitizeRegexFlags(rule.flags)
          new RegExp(rule.pattern, flags)
        } catch {
          issues.push(`invalid regex rule for ${rule.fieldPath}`)
        }
      }
    } else if (!rule.pointer.startsWith('/')) {
      issues.push(`JSON pointer for ${rule.fieldPath} must start with /`)
    }
  }

  for (const pattern of manifest.canonicalization?.ignorePatterns ?? []) {
    if (pattern.length === 0 || pattern.length > 500) {
      issues.push('canonicalization ignore patterns must be 1 to 500 characters')
      continue
    }
    if (isPotentiallyUnsafeRegex(pattern)) {
      issues.push('canonicalization ignore pattern is outside the safe subset')
      continue
    }
    try {
      new RegExp(pattern, 'giu')
    } catch {
      issues.push(`invalid canonicalization pattern: ${pattern}`)
    }
  }

  if (issues.length > 0) throw new Error(`Invalid source manifest: ${issues.join('; ')}`)
  return {
    ...manifest,
    allowedHosts,
    allowedRedirectHosts: redirectHosts,
  }
}

export function isPotentiallyUnsafeRegex(pattern: string): boolean {
  if (/\\[1-9]/.test(pattern)) return true
  if (/\(\?(?:[=!]|<[=!])/.test(pattern)) return true
  const quantifiedGroup = /\((?:\\.|[^()])*\)(?:[+*]|\{\d+(?:,\d*)?\})/
  const nestedQuantifier = /\((?:\\.|[^()])*(?:[+*]|\{\d+(?:,\d*)?\})(?:\\.|[^()])*\)(?:[+*]|\{\d+(?:,\d*)?\})/
  const repeatedAlternation = /\((?:\\.|[^()])*\|(?:\\.|[^()])*\)(?:[+*]|\{\d+(?:,\d*)?\})/
  return nestedQuantifier.test(pattern)
    || (quantifiedGroup.test(pattern) && repeatedAlternation.test(pattern))
}

export function sanitizeRegexFlags(flags = ''): string {
  const unique = [...new Set(flags.replace(/g/g, '').split(''))].join('')
  if (!/^[imsuy]*$/.test(unique)) throw new Error('Unsupported regular expression flags')
  return unique
}

function parseSafeHttpsUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value.href) : new URL(value)
  url.hostname = normalizedHostname(url.hostname)
  if (url.protocol !== 'https:') throw new Error('Only HTTPS source URLs are allowed')
  if (url.username || url.password) throw new Error('Source URLs must not contain credentials')
  if (url.port && url.port !== '443') throw new Error('Source URLs must use the default HTTPS port')
  if (isForbiddenHostname(url.hostname)) throw new Error('Private, local, and IP hosts are forbidden')
  if (url.href.length > 4096) throw new Error('Source URL exceeds 4096 characters')
  return url
}

export function assertSafeSourceUrl(value: string | URL, allowedHosts: string[]): URL {
  const url = parseSafeHttpsUrl(value)
  const normalizedAllowedHosts = allowedHosts.map(normalizeAllowedHost)
  if (!normalizedAllowedHosts.includes(url.hostname)) {
    throw new Error(`Source hostname is not allowlisted: ${url.hostname}`)
  }
  return url
}

export function assertSafeRedirectUrl(
  value: string | URL,
  manifest: Pick<SourceManifestV1, 'allowedHosts' | 'allowedRedirectHosts'>,
): URL {
  return assertSafeSourceUrl(value, [
    ...manifest.allowedHosts,
    ...(manifest.allowedRedirectHosts ?? []),
  ])
}

export type SafeFetchResult = {
  response: Response
  finalUrl: URL
  redirects: URL[]
}

export async function fetchWithValidatedRedirects(
  fetcher: Fetcher,
  initialUrl: URL,
  manifest: Pick<SourceManifestV1, 'allowedHosts' | 'allowedRedirectHosts'>,
  init: RequestInit,
  maxRedirects = 5,
  minimumRedirectDelayMs = 0,
): Promise<SafeFetchResult> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Ingestion fetches may only use GET or HEAD')
  }

  let currentUrl = assertSafeSourceUrl(initialUrl, manifest.allowedHosts)
  const redirects: URL[] = []
  for (let index = 0; index <= maxRedirects; index += 1) {
    let response: Response
    try {
      response = await fetcher(currentUrl, { ...init, redirect: 'manual' })
    } catch (error) {
      throw new IngestionError(
        `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
        'network_error',
        true,
      )
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl, redirects }
    }

    if (index === maxRedirects) {
      throw new IngestionError('Redirect limit exceeded', 'redirect_limit', false)
    }
    const location = response.headers.get('location')
    if (!location) {
      throw new IngestionError('Redirect response omitted Location', 'redirect_missing_location', false)
    }
    let nextUrl: URL
    try {
      nextUrl = assertSafeRedirectUrl(new URL(location, currentUrl), manifest)
    } catch {
      throw new IngestionError(
        'Redirect target is not HTTPS or allowlisted',
        'redirect_unsafe',
        false,
      )
    }
    redirects.push(nextUrl)
    if (minimumRedirectDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, minimumRedirectDelayMs))
    }
    currentUrl = nextUrl
  }

  throw new IngestionError('Unreachable redirect state', 'redirect_state', false)
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}
