import { createD1CatalogRepository } from './d1'
import { createJsonCatalogRepository } from './json'
import {
  createShadowCatalogRepository,
  type CatalogShadowReport,
} from './shadow'
import {
  CatalogRepositoryError,
  type CatalogBackendMode,
  type CatalogBundleLoader,
  type CatalogFetch,
  type CatalogRepository,
} from './types'

export type CreateCatalogRepositoryOptions = {
  mode?: CatalogBackendMode
  jsonLoader?: CatalogBundleLoader
  apiUrl?: string
  apiToken?: string
  apiTokenHost?: string
  fetch?: CatalogFetch
  d1CacheTtlMs?: number
  d1TimeoutMs?: number
  d1MaxResponseBytes?: number
  d1Now?: () => number
  onShadowReport?: (report: CatalogShadowReport) => void | Promise<void>
  maxShadowDifferences?: number
  shadowNow?: () => Date
}

function resolveMode(value: string | undefined): CatalogBackendMode {
  const mode = value || 'json'
  if (mode === 'json' || mode === 'd1' || mode === 'shadow') return mode
  throw new CatalogRepositoryError(
    'INVALID_BACKEND_MODE',
    `Unsupported catalog backend mode: ${mode}`,
  )
}

export function createCatalogRepository(
  options: CreateCatalogRepositoryOptions = {},
): CatalogRepository {
  const mode = resolveMode(options.mode ?? process.env.CATALOG_BACKEND)
  if (mode === 'json') return createJsonCatalogRepository(options.jsonLoader)

  const apiUrl = options.apiUrl ?? process.env.CATALOG_API_URL ?? ''
  const apiToken = options.apiToken
    ?? process.env.CATALOG_API_TOKEN
    ?? process.env.CATALOG_API_BEARER_TOKEN
  const apiTokenHost = options.apiTokenHost ?? process.env.CATALOG_API_TOKEN_HOST
  const d1 = createD1CatalogRepository({
    apiUrl,
    apiToken,
    apiTokenHost,
    fetch: options.fetch,
    cacheTtlMs: options.d1CacheTtlMs,
    timeoutMs: options.d1TimeoutMs,
    maxResponseBytes: options.d1MaxResponseBytes,
    now: options.d1Now,
  })

  if (mode === 'd1') return d1

  return createShadowCatalogRepository({
    primary: createJsonCatalogRepository(options.jsonLoader),
    shadow: d1,
    onReport: options.onShadowReport,
    maxDifferences: options.maxShadowDifferences,
    now: options.shadowNow,
  })
}
