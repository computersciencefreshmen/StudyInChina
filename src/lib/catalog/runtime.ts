import 'server-only'
import { createCatalogRepository } from './repository'
import type { CatalogRepository } from './types'

let repository: CatalogRepository | undefined

/** Shared server-side repository; JSON parsing and remote clients are reused per process. */
export function getCatalogRepository(): CatalogRepository {
  repository ??= createCatalogRepository()
  return repository
}

export function resetCatalogRepositoryRuntimeForTests(): void {
  repository = undefined
}
