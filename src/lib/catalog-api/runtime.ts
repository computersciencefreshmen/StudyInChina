import 'server-only'
import { createCatalogRepository, getCatalogRecordCounts, type CatalogRepository } from '@/lib/catalog'
import { getTodayDate } from '@/lib/data/freshness'
import { CatalogApiService } from './service'
import { selectCatalogApiData } from './projection'
import { AUTOMATED_COLLECTION_NOTICE, type ApiEnvelope, type ReleaseInfo } from './types'

let repository: CatalogRepository | undefined

const DEPLOYMENT_SHA_PATTERN = /^[a-f0-9]{40}$/u

export function deploymentShaFromEnvironment(value = process.env.VERCEL_GIT_COMMIT_SHA): string | null {
  const candidate = value?.trim()
  return candidate && DEPLOYMENT_SHA_PATTERN.test(candidate) ? candidate : null
}

async function operationalRelease(activeRepository: CatalogRepository) {
  return activeRepository.getOperationalRelease
    ? activeRepository.getOperationalRelease()
    : activeRepository.getRelease()
}

function releaseInfo(release: Awaited<ReturnType<CatalogRepository['getRelease']>>, mode: CatalogRepository['mode']): ReleaseInfo {
  return { ...release, catalogBackend: mode, deploymentSha: deploymentShaFromEnvironment() }
}

function getRepository() {
  repository ??= createCatalogRepository()
  return repository
}

export async function getCatalogApiService(): Promise<CatalogApiService> {
  const activeRepository = getRepository()
  const [rawBundle, release] = await Promise.all([
    activeRepository.getBundle(),
    operationalRelease(activeRepository),
  ])
  const today = getTodayDate()
  const publicBundle = selectCatalogApiData(rawBundle, today)

  const isJson = activeRepository.mode === 'json'
  const rawCounts = isJson ? getCatalogRecordCounts(rawBundle) : release.rawCounts
  const publicCounts = isJson ? getCatalogRecordCounts(publicBundle) : release.publicCounts

  return new CatalogApiService(publicBundle, {
    ...releaseInfo(release, activeRepository.mode),
    recordCounts: publicCounts,
    rawCounts,
    publicCounts,
  }, today)
}

export async function getCurrentCatalogRelease(): Promise<ApiEnvelope<ReleaseInfo>> {
  const activeRepository = getRepository()
  const operational = await operationalRelease(activeRepository)
  let release = releaseInfo(operational, activeRepository.mode)
  if (activeRepository.mode === 'json') {
    const rawBundle = await activeRepository.getBundle()
    const publicBundle = selectCatalogApiData(rawBundle, getTodayDate())
    const rawCounts = getCatalogRecordCounts(rawBundle)
    const publicCounts = getCatalogRecordCounts(publicBundle)
    release = {
      ...release,
      recordCounts: publicCounts,
      rawCounts,
      publicCounts,
    }
  }
  return {
    data: release,
    meta: { release, notice: AUTOMATED_COLLECTION_NOTICE },
  }
}

export async function compareCatalogPrograms(ids: string[]) {
  const activeRepository = getRepository()
  if (activeRepository.comparePrograms) return activeRepository.comparePrograms(ids)
  return (await getCatalogApiService()).comparePrograms(ids)
}

export function resetCatalogApiRepositoryForTests() {
  repository = undefined
}
