import type { DataBundle } from '@/lib/data/types'

export const CATALOG_COLLECTIONS = [
  'sources',
  'cities',
  'universities',
  'programs',
  'admissionCycles',
  'scholarships',
] as const

export type CatalogCollection = (typeof CATALOG_COLLECTIONS)[number]
export type CatalogBackendMode = 'json' | 'd1' | 'shadow'

export type CatalogRecordCounts = Record<CatalogCollection, number>

export type CatalogRelease = {
  id: string
  dataDate: string
  generatedAt: string
  recordCounts: CatalogRecordCounts
}

export interface CatalogRepository {
  readonly mode: CatalogBackendMode
  getBundle(): Promise<DataBundle>
  getRelease(): Promise<CatalogRelease>
}

export type CatalogBundleLoader = () => unknown | Promise<unknown>
export type CatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export class CatalogRepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CatalogRepositoryError'
  }
}
