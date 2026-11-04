import 'server-only'
import { createCatalogRepository, deriveCatalogRelease, getCatalogRecordCounts, type CatalogRepository } from '@/lib/catalog'
import { getTodayDate } from '@/lib/data/freshness'
import { discoveryCounts, selectDiscoveryData } from '@/lib/data/discovery'
import { directoryRevision } from '@/lib/catalog/directory-revision'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { directoryCoverage } from '@/lib/data/directory-coverage'
import { CatalogApiService, type InstitutionQuery, type ProgramQuery, type ScholarshipQuery } from './service'
import { selectCatalogApiData } from './projection'
import { AUTOMATED_COLLECTION_NOTICE, type ApiEnvelope, type ReleaseInfo } from './types'

let repository: CatalogRepository | undefined

const DEPLOYMENT_SHA_PATTERN = /^[a-f0-9]{40}$/u

export function deploymentShaFromEnvironment(value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT): string | null {
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

async function bundleAndRelease(activeRepository: CatalogRepository) {
  if (activeRepository.mode === 'json') {
    const bundle = await activeRepository.getBundle()
    return [bundle, deriveCatalogRelease(bundle)] as const
  }
  return Promise.all([activeRepository.getBundle(), operationalRelease(activeRepository)])
}

class DirectoryApiService extends CatalogApiService {
  constructor(bundle: Parameters<typeof selectDiscoveryData>[0], release: ReleaseInfo, private readonly projectionDate: string,
    private readonly projectionRevision: string) { super(bundle, release, projectionDate) }
  override listInstitutions(query: InstitutionQuery = {}) {
    return super.listInstitutions({ ...query, ...this.cursorContext() })
  }
  override listPrograms(query: ProgramQuery = {}) {
    return super.listPrograms({ ...query, ...this.cursorContext() })
  }
  override listScholarships(query: ScholarshipQuery = {}) {
    return super.listScholarships({ ...query, ...this.cursorContext() })
  }
  private cursorContext() {
    return { view: 'directory' as const, evaluatedForDate: this.projectionDate, directoryRevision: this.projectionRevision }
  }
}

export async function getCatalogApiService(): Promise<CatalogApiService> {
  const activeRepository = getRepository()
  const [rawBundle, release] = await bundleAndRelease(activeRepository)
  const today = getTodayDate()
  const publicBundle = activeRepository.mode === 'json'
    ? getPublicCatalogSnapshot(rawBundle, today).current : selectCatalogApiData(rawBundle, today)

  const isJson = activeRepository.mode === 'json'
  const rawCounts = isJson ? getCatalogRecordCounts(rawBundle) : release.rawCounts
  const publicCounts = isJson ? getCatalogRecordCounts(publicBundle) : release.publicCounts

  return new CatalogApiService(publicBundle, {
    ...releaseInfo(release, activeRepository.mode),
    recordCounts: publicCounts,
    rawCounts,
    publicCounts,
    evaluatedForDate: isJson ? today : release.evaluatedForDate,
  }, today)
}

/** Explicit discovery endpoint; legacy APIs keep their current-only contract. */
export async function getCatalogDirectoryService(): Promise<CatalogApiService> {
  const activeRepository = getRepository()
  const [rawBundle, release] = await bundleAndRelease(activeRepository)
  const today = getTodayDate()
  const snapshot = activeRepository.mode === 'json' ? getPublicCatalogSnapshot(rawBundle, today) : undefined
  const current = snapshot?.current ?? selectCatalogApiData(rawBundle, today)
  const directory = snapshot?.directory ?? selectDiscoveryData(rawBundle, today)
  const revision = snapshot?.revision ?? directoryRevision(rawBundle, today, [], [])
  const publicCounts = activeRepository.mode === 'json' ? getCatalogRecordCounts(current) : release.publicCounts
  return new DirectoryApiService(directory, { ...releaseInfo(release, activeRepository.mode), directoryRevision: revision,
    ...directoryCoverage(directory, rawBundle.universities.length, today),
    rawCounts: activeRepository.mode === 'json' ? getCatalogRecordCounts(rawBundle) : release.rawCounts,
    publicCounts, recordCounts: publicCounts, directoryCounts: discoveryCounts(directory),
    currentFactsCounts: { universities: current.universities.length, programs: current.programs.length,
      admissionCycles: current.admissionCycles.length, scholarships: current.scholarships.length },
    evaluatedForDate: today }, today, revision)
}

export async function getCurrentCatalogRelease(): Promise<ApiEnvelope<ReleaseInfo>> {
  const activeRepository = getRepository()
  // JSON metadata and counts must come from the same immutable file generation.
  const jsonBundle = activeRepository.mode === 'json' ? await activeRepository.getBundle() : undefined
  const operational = jsonBundle ? deriveCatalogRelease(jsonBundle) : await operationalRelease(activeRepository)
  let release = releaseInfo(operational, activeRepository.mode)
  if (activeRepository.mode === 'json') {
    const evaluatedForDate = getTodayDate()
    const rawBundle = jsonBundle!
    const snapshot = getPublicCatalogSnapshot(rawBundle, evaluatedForDate)
    const publicBundle = snapshot.current
    const rawCounts = getCatalogRecordCounts(rawBundle)
    const publicCounts = getCatalogRecordCounts(publicBundle)
    const directory = snapshot.directory
    release = {
      ...release,
      recordCounts: publicCounts,
      rawCounts,
      publicCounts,
      directoryCounts: discoveryCounts(directory),
      ...directoryCoverage(directory, rawBundle.universities.length, evaluatedForDate),
      directoryRevision: snapshot.revision,
      currentFactsCounts: { universities: publicBundle.universities.length, programs: publicBundle.programs.length,
        admissionCycles: publicBundle.admissionCycles.length, scholarships: publicBundle.scholarships.length },
      evaluatedForDate,
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
