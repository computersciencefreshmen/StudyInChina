import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'
import { getTodayDate } from '@/lib/data/freshness'
import { parseD1InstitutionList, parseD1ProgramList, parseD1ScholarshipList } from './d1-list'
import { deriveCatalogRelease, parseCatalogRelease } from './release'
import {
  CATALOG_LIST_DEFAULT_LIMIT,
  CATALOG_LIST_MAX_LIMIT,
  CatalogRepositoryError,
  type CatalogFetch,
  type CatalogInstitutionListPage,
  type CatalogInstitutionListQuery,
  type CatalogProgramListPage,
  type CatalogProgramListQuery,
  type CatalogRelease,
  type CatalogRepository,
  type CatalogScholarshipListPage,
  type CatalogScholarshipListQuery,
} from './types'

type CatalogSnapshot = {
  bundle: DataBundle
  release: CatalogRelease
}

export type D1CatalogRepositoryOptions = {
  apiUrl: string
  apiToken?: string
  apiTokenHost?: string
  fetch?: CatalogFetch
  cacheTtlMs?: number
  timeoutMs?: number
  maxResponseBytes?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CatalogRepositoryError(
      'INVALID_D1_LIMIT',
      `D1 Catalog limit must be an integer between ${minimum} and ${maximum}.`,
    )
  }
  return value
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      throw new CatalogRepositoryError(
        'CATALOG_API_RESPONSE_TOO_LARGE',
        `Catalog API response exceeds the ${maximumBytes}-byte limit.`,
      )
    }
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel('Catalog API response exceeded the configured limit.')
        throw new CatalogRepositoryError(
          'CATALOG_API_RESPONSE_TOO_LARGE',
          `Catalog API response exceeds the ${maximumBytes}-byte limit.`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseApiPayload(value: unknown): { bundleValue: unknown; releaseValue?: unknown } {
  if (isObject(value) && Object.hasOwn(value, 'data')) {
    const meta = isObject(value.meta) ? value.meta : undefined
    return { bundleValue: value.data, releaseValue: meta?.release }
  }

  return { bundleValue: value }
}

function listLimit(value: number | undefined): number {
  if (value === undefined) return CATALOG_LIST_DEFAULT_LIMIT
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CatalogRepositoryError(
      'INVALID_LIST_LIMIT',
      'Catalog list limit must be a positive integer.',
    )
  }
  return Math.min(value, CATALOG_LIST_MAX_LIMIT)
}

function addParam(url: URL, name: string, value: string | number | undefined): void {
  if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
}

function tuitionRange(value: string | undefined): { minimum?: number; maximum?: number } {
  if (value === 'under-20000') return { maximum: 20_000 }
  if (value === '20000-40000') return { minimum: 20_001, maximum: 40_000 }
  if (value === 'over-40000') return { minimum: 40_001 }
  return {}
}

export class D1CatalogRepository implements CatalogRepository {
  readonly mode = 'd1' as const
  private readonly apiUrl: string
  private readonly apiToken: string | undefined
  private readonly parsedApiUrl: URL
  private readonly fetcher: CatalogFetch
  private readonly cacheTtlMs: number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly now: () => number
  private cached: { snapshot: CatalogSnapshot; expiresAt: number } | undefined
  private inFlight: Promise<CatalogSnapshot> | undefined

  constructor(options: D1CatalogRepositoryOptions) {
    this.apiUrl = options.apiUrl.trim()
    if (!this.apiUrl) {
      throw new CatalogRepositoryError('MISSING_API_URL', 'CATALOG_API_URL is required for d1 mode.')
    }
    let parsedApiUrl: URL
    try {
      parsedApiUrl = new URL(this.apiUrl)
    } catch (error) {
      throw new CatalogRepositoryError('INVALID_API_URL', 'CATALOG_API_URL must be an absolute URL.', { cause: error })
    }
    const localDevelopment = parsedApiUrl.protocol === 'http:'
      && (parsedApiUrl.hostname === 'localhost' || parsedApiUrl.hostname === '127.0.0.1')
    if (parsedApiUrl.protocol !== 'https:' && !localDevelopment) {
      throw new CatalogRepositoryError('INSECURE_API_URL', 'CATALOG_API_URL must use HTTPS outside local development.')
    }
    if (parsedApiUrl.username || parsedApiUrl.password) {
      throw new CatalogRepositoryError('INVALID_API_URL', 'CATALOG_API_URL must not contain credentials.')
    }
    this.parsedApiUrl = parsedApiUrl
    this.apiToken = options.apiToken?.trim() || undefined
    if (this.apiToken) {
      const expectedHost = options.apiTokenHost?.trim().toLowerCase()
      if (!expectedHost) {
        throw new CatalogRepositoryError(
          'MISSING_TOKEN_HOST',
          'CATALOG_API_TOKEN_HOST is required whenever CATALOG_API_TOKEN is configured.',
        )
      }
      if (expectedHost !== parsedApiUrl.hostname.toLowerCase()) {
        throw new CatalogRepositoryError(
          'TOKEN_HOST_MISMATCH',
          'CATALOG_API_URL hostname does not match CATALOG_API_TOKEN_HOST.',
        )
      }
    }
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 60_000)
    this.timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000)
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      50 * 1024 * 1024,
    )
    this.now = options.now ?? Date.now
  }

  async getBundle(): Promise<DataBundle> {
    return (await this.getSnapshot()).bundle
  }

  async getRelease(): Promise<CatalogRelease> {
    return (await this.getSnapshot()).release
  }

  async listInstitutions(
    query: CatalogInstitutionListQuery = {},
  ): Promise<CatalogInstitutionListPage> {
    const url = this.publicEndpoint('institutions')
    addParam(url, 'q', query.q)
    addParam(url, 'city', query.city)
    addParam(url, 'region', query.region)
    addParam(url, 'discipline', query.discipline)
    addParam(url, 'sort', query.sort)
    addParam(url, 'cursor', query.cursor)
    addParam(url, 'limit', listLimit(query.limit))
    return parseD1InstitutionList(
      await this.fetchListPayload(url),
      query.today ?? getTodayDate(),
    )
  }


  async listPrograms(
    query: CatalogProgramListQuery = {},
  ): Promise<CatalogProgramListPage> {
    const url = this.publicEndpoint('programs')
    const range = tuitionRange(query.tuition)
    addParam(url, 'q', query.q)
    addParam(url, 'institution', query.institution)
    addParam(url, 'city', query.city)
    addParam(url, 'type', query.type)
    addParam(url, 'degree', query.degree)
    addParam(url, 'discipline', query.discipline)
    addParam(url, 'language', query.language)
    addParam(url, 'academicYear', query.academicYear)
    addParam(url, 'intake', query.intake)
    addParam(url, 'tuition', query.tuition)
    addParam(url, 'tuitionMin', query.tuitionMin ?? range.minimum)
    addParam(url, 'tuitionMax', query.tuitionMax ?? range.maximum)
    addParam(url, 'applicationState', query.applicationState)
    addParam(url, 'scholarship', query.scholarship)
    addParam(url, 'sort', query.sort)
    addParam(url, 'cursor', query.cursor)
    addParam(url, 'limit', listLimit(query.limit))
    return parseD1ProgramList(
      await this.fetchListPayload(url),
      query.today ?? getTodayDate(),
    )
  }

  async listScholarships(
    query: CatalogScholarshipListQuery = {},
  ): Promise<CatalogScholarshipListPage> {
    const url = this.publicEndpoint('scholarships')
    addParam(url, 'q', query.q)
    addParam(url, 'provider', query.provider)
    addParam(url, 'institution', query.institution)
    addParam(url, 'program', query.program)
    addParam(url, 'degree', query.degree)
    addParam(url, 'funding', query.funding)
    addParam(url, 'deadline', query.deadline)
    addParam(url, 'sort', query.sort)
    addParam(url, 'cursor', query.cursor)
    addParam(url, 'limit', listLimit(query.limit))
    return parseD1ScholarshipList(
      await this.fetchListPayload(url),
      query.today ?? getTodayDate(),
    )
  }

  private publicEndpoint(resource: 'institutions' | 'programs' | 'scholarships'): URL {
    const url = new URL(this.parsedApiUrl)
    url.search = ''
    url.hash = ''
    const path = url.pathname.replace(/\/+$/u, '')
    if (path.endsWith('/internal/v1/catalog-bundle')) {
      url.pathname = path.slice(0, -'/internal/v1/catalog-bundle'.length) + `/api/v1/${resource}`
    } else if (/\/api\/v1(?:\/[^/]+)?$/u.test(path)) {
      url.pathname = path.replace(/\/api\/v1(?:\/[^/]+)?$/u, `/api/v1/${resource}`)
    } else {
      url.pathname = `${path}/api/v1/${resource}`.replace(/^\/\//u, '/')
    }
    return url
  }

  private async fetchListPayload(url: URL): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetcher(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      throw new CatalogRepositoryError(
        controller.signal.aborted ? 'CATALOG_API_TIMEOUT' : 'CATALOG_API_UNAVAILABLE',
        controller.signal.aborted
          ? `Catalog API request exceeded ${this.timeoutMs}ms.`
          : `Catalog API request failed for ${url.origin}.`,
        { cause: error },
      )
    }

    try {
      if (!response.ok) {
        throw new CatalogRepositoryError(
          'CATALOG_API_HTTP_ERROR',
          `Catalog API returned HTTP ${response.status} ${response.statusText}`.trim(),
        )
      }
      try {
        const bytes = await readBoundedResponse(response, this.maxResponseBytes)
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch (error) {
        if (error instanceof CatalogRepositoryError) throw error
        throw new CatalogRepositoryError(
          controller.signal.aborted ? 'CATALOG_API_TIMEOUT' : 'INVALID_API_RESPONSE',
          controller.signal.aborted
            ? `Catalog API request exceeded ${this.timeoutMs}ms.`
            : 'Catalog API did not return valid JSON.',
          { cause: error },
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private getSnapshot(): Promise<CatalogSnapshot> {
    const now = this.now()
    if (this.cached && this.cached.expiresAt >= now) return Promise.resolve(this.cached.snapshot)
    if (this.inFlight) return this.inFlight

    this.inFlight = this.fetchSnapshot()
      .then((snapshot) => {
        this.cached = { snapshot, expiresAt: this.now() + this.cacheTtlMs }
        return snapshot
      })
      .finally(() => {
        this.inFlight = undefined
      })

    return this.inFlight
  }

  private async fetchSnapshot(): Promise<CatalogSnapshot> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetcher(this.apiUrl, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      throw new CatalogRepositoryError(
        controller.signal.aborted ? 'CATALOG_API_TIMEOUT' : 'CATALOG_API_UNAVAILABLE',
        controller.signal.aborted
          ? `Catalog API request exceeded ${this.timeoutMs}ms.`
          : `Catalog API request failed for ${this.apiUrl}.`,
        { cause: error },
      )
    }

    try {
      if (!response.ok) {
        throw new CatalogRepositoryError(
          'CATALOG_API_HTTP_ERROR',
          `Catalog API returned HTTP ${response.status} ${response.statusText}`.trim(),
        )
      }

      let payload: unknown
      try {
        const bytes = await readBoundedResponse(response, this.maxResponseBytes)
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch (error) {
        if (error instanceof CatalogRepositoryError) throw error
        throw new CatalogRepositoryError(
          controller.signal.aborted ? 'CATALOG_API_TIMEOUT' : 'INVALID_API_RESPONSE',
          controller.signal.aborted
            ? `Catalog API request exceeded ${this.timeoutMs}ms.`
            : 'Catalog API did not return valid JSON.',
          { cause: error },
        )
      }

      const { bundleValue, releaseValue } = parseApiPayload(payload)
      let bundle: DataBundle
      try {
        bundle = bundleSchema.parse(bundleValue)
      } catch (error) {
        throw new CatalogRepositoryError(
          'INVALID_API_BUNDLE',
          'Catalog API returned a bundle that failed the existing data schema.',
          { cause: error },
        )
      }

      const release = releaseValue === undefined
        ? deriveCatalogRelease(bundle, 'd1')
        : parseCatalogRelease(releaseValue, bundle)

      return { bundle, release }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createD1CatalogRepository(options: D1CatalogRepositoryOptions): CatalogRepository {
  return new D1CatalogRepository(options)
}
