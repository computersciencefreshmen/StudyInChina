import 'server-only'
import { createCatalogRepository } from './repository'
import type { CatalogRepository } from './types'
import { assertPublicProgramQualityBackend } from './public-snapshot'

let repository: CatalogRepository | undefined

/** Shared server-side repository; JSON parsing and remote clients are reused per process. */
export function getCatalogRepository(): CatalogRepository {
  repository ??= createCatalogRepository()
  assertPublicProgramQualityBackend(repository.mode)
  return repository
}

export function resetCatalogRepositoryRuntimeForTests(): void {
  repository = undefined
}
