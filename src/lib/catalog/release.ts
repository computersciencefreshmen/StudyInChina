import { getDataReleaseDate } from '@/lib/data/release'
import type { DataBundle } from '@/lib/data/types'
import {
  CATALOG_COLLECTIONS,
  CatalogRepositoryError,
  type CatalogRecordCounts,
  type CatalogRelease,
} from './types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DEPLOYMENT_SHA_PATTERN = /^[a-f0-9]{40}$/u
const BACKENDS = new Set(['json', 'shadow', 'd1'])

export function getCatalogRecordCounts(bundle: DataBundle): CatalogRecordCounts {
  return Object.fromEntries(
    CATALOG_COLLECTIONS.map((collection) => [collection, bundle[collection].length]),
  ) as CatalogRecordCounts
}

export function deriveCatalogRelease(bundle: DataBundle, idPrefix = 'json'): CatalogRelease {
  const dataDate = getDataReleaseDate(bundle)
  const generatedAt = `${dataDate}T00:00:00.000Z`
  const counts = getCatalogRecordCounts(bundle)

  return {
    id: `${idPrefix}:${dataDate}`,
    dataDate,
    generatedAt,
    recordCounts: counts,
    rawCounts: counts,
    publicCounts: counts,
    dataCheckedThrough: dataDate,
    evaluatedForDate: dataDate,
    activatedAt: generatedAt,
    catalogBackend: idPrefix === 'd1' ? 'd1' : 'json',
    deploymentSha: null,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseCounts(value: unknown, field: string): CatalogRecordCounts {
  if (!isObject(value)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', `Catalog release ${field} is missing.`)
  }
  const parsed = {} as CatalogRecordCounts
  for (const collection of CATALOG_COLLECTIONS) {
    const count = value[collection]
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new CatalogRepositoryError(
        'INVALID_RELEASE',
        `Catalog release ${field} count for ${collection} must be a non-negative integer.`,
      )
    }
    parsed[collection] = count as number
  }
  return parsed
}

function releaseDate(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', `Catalog release ${field} must use YYYY-MM-DD.`)
  }
  return value
}

function releaseTimestamp(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new CatalogRepositoryError('INVALID_RELEASE', `Catalog release ${field} must be an ISO timestamp.`)
  }
  return value
}

export function parseCatalogReleaseInfo(value: unknown): CatalogRelease {
  if (!isObject(value)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog API release metadata is missing.')
  }

  const { id, dataDate, generatedAt, recordCounts } = value
  if (typeof id !== 'string' || id.length === 0) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release id must be a non-empty string.')
  }
  if (typeof dataDate !== 'string' || !DATE_PATTERN.test(dataDate)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release dataDate must use YYYY-MM-DD.')
  }
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release generatedAt must be an ISO timestamp.')
  }

  const parsedRecordCounts = parseCounts(recordCounts, 'recordCounts')
  const parsedPublicCounts = value.publicCounts === undefined
    ? parsedRecordCounts
    : parseCounts(value.publicCounts, 'publicCounts')
  const parsedRawCounts = value.rawCounts === undefined
    ? parsedRecordCounts
    : parseCounts(value.rawCounts, 'rawCounts')
  for (const collection of CATALOG_COLLECTIONS) {
    if (parsedRecordCounts[collection] !== parsedPublicCounts[collection]) {
      throw new CatalogRepositoryError(
        'INVALID_RELEASE',
        `Catalog release recordCounts must remain an alias of publicCounts for ${collection}.`,
      )
    }
  }

  const catalogBackend = value.catalogBackend ?? 'd1'
  if (typeof catalogBackend !== 'string' || !BACKENDS.has(catalogBackend)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release catalogBackend is invalid.')
  }
  const deploymentSha = value.deploymentSha ?? null
  if (deploymentSha !== null && (typeof deploymentSha !== 'string' || !DEPLOYMENT_SHA_PATTERN.test(deploymentSha))) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release deploymentSha must be null or a 40-character lowercase hexadecimal SHA.')
  }

  return {
    id,
    dataDate,
    generatedAt,
    recordCounts: parsedPublicCounts,
    rawCounts: parsedRawCounts,
    publicCounts: parsedPublicCounts,
    dataCheckedThrough: releaseDate(value.dataCheckedThrough, dataDate, 'dataCheckedThrough'),
    evaluatedForDate: releaseDate(value.evaluatedForDate, dataDate, 'evaluatedForDate'),
    activatedAt: releaseTimestamp(value.activatedAt, generatedAt, 'activatedAt'),
    catalogBackend: catalogBackend as CatalogRelease['catalogBackend'],
    deploymentSha,
  }
}

export function parseCatalogRelease(value: unknown, bundle: DataBundle): CatalogRelease {
  const release = parseCatalogReleaseInfo(value)
  const actualCounts = getCatalogRecordCounts(bundle)
  for (const collection of CATALOG_COLLECTIONS) {
    const count = release.publicCounts[collection]
    if (count !== actualCounts[collection]) {
      throw new CatalogRepositoryError(
        'RELEASE_COUNT_MISMATCH',
        `Catalog release count for ${collection} is ${String(count)}; bundle contains ${actualCounts[collection]}.`,
      )
    }
  }
  return release
}
