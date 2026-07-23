import 'server-only'
import { createCatalogRepository, getCatalogRecordCounts, type CatalogRepository } from '@/lib/catalog'
import { getTodayDate } from '@/lib/data/freshness'
import { CatalogApiService } from './service'
import { selectCatalogApiData } from './projection'

let repository: CatalogRepository | undefined

function getRepository() {
  repository ??= createCatalogRepository()
  return repository
}

export async function getCatalogApiService(): Promise<CatalogApiService> {
  const activeRepository = getRepository()
  const [rawBundle, release] = await Promise.all([
    activeRepository.getBundle(),
    activeRepository.getRelease(),
  ])
  const today = getTodayDate()
  const publicBundle = selectCatalogApiData(rawBundle, today)

  return new CatalogApiService(publicBundle, {
    ...release,
    recordCounts: getCatalogRecordCounts(publicBundle),
  }, today)
}

export function resetCatalogApiRepositoryForTests() {
  repository = undefined
}
