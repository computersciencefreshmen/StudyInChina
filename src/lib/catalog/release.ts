import { getDataReleaseDate } from '@/lib/data/release'
import type { DataBundle } from '@/lib/data/types'
import {
  CATALOG_COLLECTIONS,
  CatalogRepositoryError,
  type CatalogRecordCounts,
  type CatalogRelease,
} from './types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function getCatalogRecordCounts(bundle: DataBundle): CatalogRecordCounts {
  return Object.fromEntries(
    CATALOG_COLLECTIONS.map((collection) => [collection, bundle[collection].length]),
  ) as CatalogRecordCounts
}

export function deriveCatalogRelease(bundle: DataBundle, idPrefix = 'json'): CatalogRelease {
  const dataDate = getDataReleaseDate(bundle)

  return {
    id: `${idPrefix}:${dataDate}`,
    dataDate,
    generatedAt: `${dataDate}T00:00:00.000Z`,
    recordCounts: getCatalogRecordCounts(bundle),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseCatalogRelease(value: unknown, bundle: DataBundle): CatalogRelease {
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
  if (!isObject(recordCounts)) {
    throw new CatalogRepositoryError('INVALID_RELEASE', 'Catalog release recordCounts is missing.')
  }

  const actualCounts = getCatalogRecordCounts(bundle)
  const parsedCounts = {} as CatalogRecordCounts
  for (const collection of CATALOG_COLLECTIONS) {
    const count = recordCounts[collection]
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new CatalogRepositoryError(
        'INVALID_RELEASE',
        `Catalog release count for ${collection} must be a non-negative integer.`,
      )
    }
    if (count !== actualCounts[collection]) {
      throw new CatalogRepositoryError(
        'RELEASE_COUNT_MISMATCH',
        `Catalog release count for ${collection} is ${String(count)}; bundle contains ${actualCounts[collection]}.`,
      )
    }
    parsedCounts[collection] = count as number
  }

  return { id, dataDate, generatedAt, recordCounts: parsedCounts }
}
